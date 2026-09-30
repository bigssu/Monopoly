/**
 * VFX engine cost on the demo page (vfx-demo.html): real 30 Hz clock, CPU throttle (default 4×),
 * 1600×1000 @ DPR 2. For each scenario: JS ms per engine tick (update + draw, avg / p95 / max),
 * live-particle peak, canvas region and backing size, and whether the engine went idle afterwards
 * (canvas hidden, backing freed, no frame callback).
 *
 *   node scripts/fx/vfx-perf.mjs [scenario …] [--throttle 4] [--runs 3] [--json out.json] [--retain]
 *
 * --retain: the demo keeps the hidden canvas backing store between effects (`retainBacking`).
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
const PORT = +opt('--port', '5187');
const RETAIN = args.includes('--retain') ? (args.splice(args.indexOf('--retain'), 1), true) : false;
const list = args.length ? args : ['build4', 'landmarkMonopoly', 'victoryHubs', 'takeover', 'tollXL', 'group', 'stress'];

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
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`http://localhost:${PORT}/vfx-demo.html${RETAIN ? '?retain' : ''}`);
  await page.waitForFunction(() => window.__vfxDemo);
  await page.evaluate(() => window.__vfxDemo.fx.preload());
  // Warm the tint cache once per scenario at 1× (first-use tint builds are a one-off, measured separately).
  const cdp = await page.context().newCDPSession(page);
  for (const name of list) {
    const r = { name, runs: [] };
    for (let run = 0; run < RUNS + 1; run++) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: run === 0 ? 1 : THROTTLE });
      await page.evaluate((soft) => {
        const d = window.__vfxDemo;
        d.reset(soft);
        d.manual(false);
      }, RETAIN);
      const f0 = await page.evaluate(() => window.__vfxDemo.stats().frame);
      await page.evaluate((n) => void window.__vfxDemo.run(n), name);
      let region = null;
      const t0 = Date.now();
      for (;;) {
        await page.waitForTimeout(200);
        const s = await page.evaluate(() => window.__vfxDemo.stats());
        if (s.canvas && !s.canvas.hidden && (!region || s.canvas.w * s.canvas.h > region.w * region.h)) region = s.canvas;
        if (!s.ticking && Date.now() - t0 > 500) break;
        if (Date.now() - t0 > 20000) break;
      }
      const s = await page.evaluate(() => window.__vfxDemo.stats());
      const ms = Date.now() - t0;
      const row = {
        throttle: run === 0 ? 1 : THROTTLE,
        tickAvg: +s.tick.avg.toFixed(2),
        tickP95: +s.tick.p95.toFixed(2),
        tickMax: +s.tick.max.toFixed(2),
        maxAt: `f${s.tick.maxAt - f0} ×${s.tick.maxFrames}`,
        ticks: s.tick.n,
        peak: s.peak,
        spawned: s.spawned,
        dropped: s.dropped,
        region: region ? `${Math.round(region.w)}×${Math.round(region.h)}` : '-',
        backing: region ? `${region.backingW}×${region.backingH} @${region.scale.toFixed(2)}` : '-',
        backingMP: region ? +((region.backingW * region.backingH) / 1e6).toFixed(2) : 0,
        idleAfter: !s.ticking && (s.canvas?.hidden ?? true) && (RETAIN || (s.canvas?.backingW ?? 0) === 0),
        wallMs: ms,
        tintCacheKB: Math.round(s.tintCacheBytes / 1024),
      };
      if (run > 0) r.runs.push(row);
      else r.warm = row;
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const pick = (k) => r.runs.map((x) => x[k]);
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    r.summary = {
      tickAvg: med(pick('tickAvg')),
      tickP95: med(pick('tickP95')),
      tickMax: Math.max(...pick('tickMax')),
      peak: Math.max(...pick('peak')),
      region: r.runs[0].region,
      backing: r.runs[0].backing,
      backingMP: r.runs[0].backingMP,
      idleAfter: r.runs.every((x) => x.idleAfter),
      warm1x: { tickAvg: r.warm.tickAvg, tickMax: r.warm.tickMax },
    };
    results.push(r);
    console.log(r.runs.map((x) => `  run: avg ${x.tickAvg} p95 ${x.tickP95} max ${x.tickMax} at ${x.maxAt}`).join('\n'));
    console.log(`${name.padEnd(18)} ${THROTTLE}×: tick avg ${r.summary.tickAvg} p95 ${r.summary.tickP95} max ${r.summary.tickMax} ms · peak ${r.summary.peak} · region ${r.summary.region} backing ${r.summary.backing} (${r.summary.backingMP} MP) · tint cache ${r.runs[r.runs.length - 1].tintCacheKB} KB · idle after ${r.summary.idleAfter} · 1× first run avg ${r.warm.tickAvg} max ${r.warm.tickMax}`);
  }
} finally {
  await browser.close();
  vite.kill();
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ throttle: THROTTLE, dpr: 2, viewport: [1600, 1000], results }, null, 2));
