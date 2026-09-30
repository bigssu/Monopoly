#!/usr/bin/env node
/**
 * Controlled FX cost bench (docs/VFX.md §15): a 4-human game waiting at the roll prompt (nothing else
 * moves) while a fixed mix of the most common effects (turn halo, dice, hop dust, buy, toll, build,
 * card, coins — one turn's worth every 2.4 s) is replayed on a timer; 4x CPU throttle, DPR 2.
 * Per URL variant (dev knobs, see src/ui/game/view.ts): main-thread task ms/s, rAF frames > 20 / > 34 ms,
 * FX canvas backing px uploaded per second, canvas frames/s, show/hide toggles/s, engine tick ms.
 *
 *   npx vite build && node scripts/fx/fx-mix.mjs [--secs 29] [--runs 2] [--trace 1] [--layers 1] "" "fxq=off" "fxq=low"
 *
 * Main-thread ms/s here is stable to ±5 (unlike the CPU demo game), so it is the A/B tool for engine
 * changes; "fxq=off" is the same scenario with effects off (static highlight + sound).
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const ROOT = opt('root', resolve(dirname(fileURLToPath(import.meta.url)), '../..')); const SECS = +opt('secs', 29), RUNS = +opt('runs', 1), PORT = +opt('port', 4195), TRACE = opt('trace', '0') === '1', LAYERS = opt('layers', '0') === '1';
const variants = argv.length ? argv : [''];
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs').href);
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
process.on('exit', () => { try { process.kill(-server.pid); } catch {} });
const base = `http://localhost:${PORT}`;
for (let i = 0; i < 80; i++) { try { if ((await fetch(base)).ok) break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const MIX = [
  [0, 'ringPulse', { at: { space: 3 }, player: 0, sparkles: 3 }], [300, 'diceLand', {}], [900, 'hopDust', { space: 8, long: false, dir: 180 }], [1100, 'plotClaim', { space: 8, player: 0, price: 300 }],
  [2400, 'ringPulse', { at: { space: 14 }, player: 1, sparkles: 3 }], [2700, 'diceLand', {}], [3300, 'hopDust', { space: 14, long: true, dir: 90 }], [3500, 'tollPay', { payer: 1, receiver: 0, amount: 600, space: 14 }],
  [4800, 'ringPulse', { at: { space: 22 }, player: 2, sparkles: 3 }], [5100, 'diceLand', {}], [5700, 'hopDust', { space: 22, long: false, dir: 0 }], [5900, 'buildSeq', { space: 22, player: 2, level: 2 }],
  [7200, 'ringPulse', { at: { space: 31 }, player: 3, sparkles: 3 }], [7500, 'diceLand', {}], [8100, 'hopDust', { space: 31, long: false, dir: 270 }], [8300, 'cardReveal', { tone: 'good' }], [8900, 'coinIn', { from: { panel: 3 }, to: { space: 31 }, n: 5 }],
];
for (let run = 0; run < RUNS; run++) for (const q of variants) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto(`${base}/?dev=1${q ? '&' + q : ''}`);
  await page.waitForFunction(() => window.__lotAndRoll && document.getElementById('app')?.dataset.screen === 'title');
  await page.evaluate(() => { window.__lotAndRoll.setPromptTimer(0); window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(4, false), 11); });
  await page.waitForFunction(() => window.__lotAndRoll.getState()?.phase.kind === 'preRoll' && !window.__lotAndRoll.isBusy() && (window.__lotAndRoll.fx()?.atlas === 'ready' || location.search.includes('fxq=off')), null, { timeout: 60000 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  // warm-up cycle
  const cycle = async (secs) => page.evaluate(async ({ mix, secs }) => {
    const t0 = performance.now(); const period = 9600;
    await new Promise((done) => {
      let k = 0; let cyc = 0;
      const next = () => {
        const [at, name, params] = mix[k];
        const due = t0 + cyc * period + at;
        setTimeout(() => {
          if (performance.now() - t0 > secs * 1000) return done();
          void window.__lotAndRoll.playFx(name, params);
          k++; if (k === mix.length) { k = 0; cyc++; }
          next();
        }, Math.max(0, due - performance.now()));
      };
      next();
    });
  }, { mix: MIX, secs });
  await cycle(9.6);
  await page.waitForTimeout(3000);
  let layers = 0, mem = 0;
  if (LAYERS) { cdp.on('LayerTree.layerTreeDidChange', (ev) => { if (ev.layers) { layers = Math.max(layers, ev.layers.length); mem = Math.max(mem, ev.layers.reduce((a, l) => a + (l.drawsContent ? l.width * l.height * 16 : 0), 0) / 1048576); } }); await cdp.send('LayerTree.enable'); }
  const ev = []; cdp.on('Tracing.dataCollected', (e) => ev.push(...e.value));
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  if (TRACE) await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,cc,blink', transferMode: 'ReportEvents' });
  await page.evaluate(() => { window.__fx?.resetStats(); window.__frames = []; let last = performance.now(); window.__rafOn = true; const tick = (t) => { window.__frames.push(t - last); last = t; if (window.__rafOn) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await cdp.send('Performance.enable');
  const tm = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value * 1000;
  const t0 = await tm(); const w0 = Date.now();
  await cycle(SECS);
  const wall = (Date.now() - w0) / 1000;
  const task = ((await tm()) - t0) / wall;
  if (TRACE) { await cdp.send('Tracing.end'); await done; }
  if (LAYERS) await cdp.send('LayerTree.disable');
  const f = await page.evaluate(() => { window.__rafOn = false; return window.__frames.slice(1).sort((a, b) => a - b); });
  const st = await page.evaluate(() => window.__fx?.stats?.());
  const res = { q, taskMsPerS: Math.round(task), over20: f.filter((x) => x > 20).length, over34: f.filter((x) => x > 34).length, p99: +f[Math.floor(f.length * 0.99)].toFixed(1), frames: f.length };
  if (st) Object.assign(res, { ...(st.upload ? { kpxPerS: Math.round(st.upload.px / 1000 / wall), canvasFps: +(st.upload.frames / wall).toFixed(1), togglesPerS: +(st.upload.toggles / wall).toFixed(2) } : {}), tickAvg: +st.tick.avg.toFixed(2), tickP95: +st.tick.p95.toFixed(2), ticks: st.tick.n, peak: st.peak });
  if (TRACE) {
    const th = new Map(); for (const e of ev) if (e.ph === 'M' && e.name === 'thread_name') th.set(e.pid + ':' + e.tid, e.args.name);
    const agg = {};
    for (const e of ev) { if (e.ph !== 'X') continue; if (th.get(e.pid + ':' + e.tid) !== 'CrRendererMain') continue; agg[e.name] = (agg[e.name] || 0) + (e.dur || 0) / 1000 / wall; }
    res.main = Object.entries(agg).filter(([, v]) => v > 3).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => k + ' ' + v.toFixed(0)).join(' | ');
  }
  if (TRACE) res.paintPerS = +(ev.filter((e) => e.name === 'Paint' && e.ph === 'X').length / wall).toFixed(1);
  if (LAYERS) Object.assign(res, { layers, memMB: Math.round(mem) });
  console.log(JSON.stringify(res));
  await ctx.close();
}
await browser.close(); process.exit(0);
