/**
 * Money-stage cost on the demo page (money-demo.html): real 30 Hz clock, CPU throttle (default 4×),
 * 1600×1000 @ DPR 2. Per scenario:
 *   - JS per frame: the scene clock's own step (frame-step loop: coins, tweens, counters; avg / p95 /
 *     max) and all main-thread script per frame (CDP Performance.ScriptDuration / frames), plus
 *     style recalc and layout per frame;
 *   - flying-coin peak and pool nodes in use;
 *   - compositor layers: idle before, peak during the scene, after (CDP LayerTree, separate run);
 *   - layer paints per second during the scene;
 *   - idle after: no frame step registered, stage parked.
 *
 *   node scripts/fx/money-perf.mjs [scenario[@seat] …] [--throttle 4] [--runs 3] [--json out.json]
 */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  if (i < 0) return d;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const THROTTLE = +opt('--throttle', '4');
const RUNS = +opt('--runs', '3');
const JSON_OUT = opt('--json', '');
const PORT = +opt('--port', '5197');
/** --no-camera: leave the mock board camera unbound (counts only the stage's own layers). */
const NO_CAMERA = args.includes('--no-camera') ? (args.splice(args.indexOf('--no-camera'), 1), true) : false;
const list = (args.length ? args : ['collectXL@S', 'tollFestival@S', 'build4@S', 'takeover@S']).map((a) => a.split('@'));

async function loadChromium() {
  const c = [process.env.PLAYWRIGHT_MODULE, '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const m of c) if (existsSync(m)) return (await import(pathToFileURL(m).href)).chromium;
  return (await import('playwright')).chromium;
}

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((ok, fail) => {
  const t = setTimeout(() => fail(new Error('vite did not start')), 30000);
  vite.stdout.on('data', (d) => String(d).includes('Local') && (clearTimeout(t), ok()));
});
const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const results = [];
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0;
};
const r2 = (v) => +v.toFixed(2);

async function runScene(page, name, seat) {
  await page.evaluate(() => {
    const d = window.__moneyDemo;
    d.manual(false);
    d.reset();
    d.perf(true);
  });
  await page.evaluate(({ name, seat }) => void window.__moneyDemo.run(name, seat), { name, seat });
  const t0 = Date.now();
  await page.waitForFunction(() => window.__moneyDemo.stats().live, null, { timeout: 5000 });
  await page.waitForFunction(() => !window.__moneyDemo.stats().live, null, { timeout: 30000, polling: 100 });
  const wall = Date.now() - t0;
  await page.waitForTimeout(300);
  const s = await page.evaluate(() => window.__moneyDemo.stats());
  return { wall, s };
}

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`http://localhost:${PORT}/money-demo.html${process.env.FLATCAM ? '?flatcam' : ''}`);
  await page.waitForFunction(() => window.__moneyDemo);
  await page.evaluate(() => window.__moneyDemo.preload());
  await page.evaluate(() => window.__moneyDemo.ui(false));
  if (NO_CAMERA) await page.evaluate(() => window.__moneyDemo.camera(false));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));

  for (const [name, seat = 'S'] of list) {
    // Warm-up at 1× (atlas decode, first layout).
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await runScene(page, name, seat);
    const runs = [];
    for (let k = 0; k < RUNS; k++) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
      const m0 = await metric();
      const { wall, s } = await runScene(page, name, seat);
      const m1 = await metric();
      const frames = s.perf.n || 1;
      runs.push({
        wall,
        frames,
        stepAvg: r2(s.perf.total / frames),
        stepP95: r2(pct(s.perf.samples, 0.95)),
        stepMax: r2(s.perf.max),
        scriptPerFrame: r2(((m1.ScriptDuration - m0.ScriptDuration) * 1000) / frames),
        stylePerFrame: r2(((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000) / frames),
        layoutPerFrame: r2(((m1.LayoutDuration - m0.LayoutDuration) * 1000) / frames),
        peakFlying: s.peakFlying,
        peakNodes: s.peakNodes,
        stageNodes: s.stageNodes,
        idleAfter: !s.live && s.ticks === 0,
      });
    }
    // Layers + paints (separate run: LayerTree reporting itself costs time).
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    let layers = 0;
    let paints = 0;
    let counting = false;
    const onTree = (e) => {
      if (e.layers) layers = e.layers.length;
      if (counting) peak = Math.max(peak, layers);
    };
    const onPaint = () => counting && paints++;
    let peak = 0;
    cdp.on('LayerTree.layerTreeDidChange', onTree);
    cdp.on('LayerTree.layerPainted', onPaint);
    await cdp.send('LayerTree.enable');
    // Force one compositing update so the idle tree is reported.
    const nudge = () => page.evaluate(() => new Promise((r) => { document.body.style.outline = '1px solid transparent'; requestAnimationFrame(() => requestAnimationFrame(() => { document.body.style.outline = ''; requestAnimationFrame(() => r()); })); }));
    await nudge();
    await page.waitForTimeout(300);
    const idleBefore = layers;
    counting = true;
    peak = layers;
    const { wall } = await runScene(page, name, seat);
    counting = false;
    await page.waitForTimeout(400);
    await nudge();
    await page.waitForTimeout(300);
    const idleAfterLayers = layers;
    await cdp.send('LayerTree.disable');
    cdp.off('LayerTree.layerTreeDidChange', onTree);
    cdp.off('LayerTree.layerPainted', onPaint);
    const med = (k) => pct(runs.map((r) => r[k]), 0.5);
    const row = {
      name: `${name}@${seat}`,
      throttle: THROTTLE,
      frames: med('frames'),
      stepAvg: med('stepAvg'),
      stepP95: med('stepP95'),
      stepMax: Math.max(...runs.map((r) => r.stepMax)),
      scriptPerFrame: med('scriptPerFrame'),
      stylePerFrame: med('stylePerFrame'),
      layoutPerFrame: med('layoutPerFrame'),
      peakFlying: Math.max(...runs.map((r) => r.peakFlying)),
      peakNodes: Math.max(...runs.map((r) => r.peakNodes)),
      stageNodes: runs[0].stageNodes,
      layersIdle: idleBefore,
      layersPeak: peak,
      layersExtra: peak - idleBefore,
      layersAfter: idleAfterLayers,
      paintsPerSec: r2(paints / (wall / 1000)),
      idleAfter: runs.every((r) => r.idleAfter) && idleAfterLayers === idleBefore,
      runs,
    };
    results.push(row);
    console.log(
      `${row.name.padEnd(16)} ${THROTTLE}×: step avg ${row.stepAvg} p95 ${row.stepP95} max ${row.stepMax} ms · script/frame ${row.scriptPerFrame} style ${row.stylePerFrame} layout ${row.layoutPerFrame} ms · coins ${row.peakFlying}/${row.peakNodes} nodes · layers ${row.layersIdle}→${row.layersPeak} (+${row.layersExtra}) → ${row.layersAfter} · paints ${row.paintsPerSec}/s · idle after ${row.idleAfter}`,
    );
  }
} finally {
  await browser.close();
  vite.kill();
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ throttle: THROTTLE, dpr: 2, viewport: [1600, 1000], results }, null, 2));
