#!/usr/bin/env node
/**
 * Performance gates for Lot & Roll (docs/PERFORMANCE.md). Prints a PASS/FAIL table against the
 * product owner's acceptance criteria and a side-by-side of the 30 fps cap on vs off.
 *
 *   npm run perf                              # vite build + default phases (~5 min)
 *   node scripts/perf.mjs --phases idle,cap   # a subset (after `npx vite build`)
 *   node scripts/perf.mjs --full              # + DOM size over a whole game (unthrottled, ~3 min)
 *   node scripts/perf.mjs --unique            # + unique presented frames via screencast hashing
 *   node scripts/perf.mjs --json perf.json    # machine-readable results
 *
 * Environment: emulated mid-range tablet = 1600x1000 viewport, DPR 2, CDP CPU throttling 4x
 * (`--throttle`), except where a gate says "no throttle". Demo games are seeded, so runs are
 * comparable. `scripts/perf-render.mjs` stays the detailed per-layer report.
 *
 * Phases (default: boot,idle,cap,play,layers,mount)
 *   boot    `/` → Title mounted and painted (median of 3), 4x.
 *   idle    criterion B. Waiting for a human (4 humans, roll prompt, timer off), the Title and the
 *           Result screen, 4x. Two windows each: "decorative" = the first seconds while the
 *           perpetual decorative loops still run (they must be compositor-only: 0 Layout / Paint /
 *           Raster / layerPainted), then "calm" = 10 s once they stopped (~10 s after the last
 *           input, fx/ambient.ts): 0 Layout, 0 Paint, 0 RasterTask, <= 1 style recalc, no rAF, no
 *           timer fires, 0 layerPainted, main-thread task time < 100 ms.
 *   cap     criterion A. CPU demo game, NO throttle, battery saver on vs off: presented frames/s
 *           (renderer DrawFrame), main-thread task ms/s, Paint/s, Raster/s, style/s, rAF/s.
 *   play    CPU demo game, 4x, --seconds (default 60): rAF frame intervals after the first 2 s
 *           (p50/p95/p99/max, frames > 33 ms), long tasks, DOM nodes, heap.
 *   layers  CPU demo game, 4x, 40 s: GPU layers (LayerTree: median / peak count, peak memory =
 *           sum of w*h*4*DPR^2 over drawing layers), Paint/s, RasterTask/s, max Layout (a forced
 *           synchronous layout shows up as a long Layout).
 *   mount   Title → game screen (4x): the longest single Layout while the game mounts.
 *   full    (--full) a whole CPU game at 4x animation speed, no throttle: DOM nodes per round.
 *   tap     (--phases tap) roll-button press/release input-to-paint (Event Timing), info only.
 *
 * Needs Playwright + Chromium: PLAYWRIGHT_MODULE / CHROMIUM_PATH, else the global install at
 * /opt/node22/lib/node_modules/playwright and /opt/pw-browsers/chromium.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  if (i < 0) return d;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const CFG = {
  port: Number(opt('port', 4179)),
  url: opt('url', null),
  throttle: Number(opt('throttle', 4)),
  dpr: Number(opt('dpr', 2)),
  seconds: Number(opt('seconds', 60)),
  capSeconds: Number(opt('cap-seconds', 30)),
  layerSeconds: Number(opt('layer-seconds', 40)),
  phases: String(opt('phases', 'boot,idle,cap,play,layers,mount')).split(','),
  json: opt('json', null),
};
if (opt('full', false) && !CFG.phases.includes('full')) CFG.phases.push('full');
if (opt('unique', false) && !CFG.phases.includes('unique')) CFG.phases.push('unique');

// ------------------------------------------------------------------------------------ setup
async function loadChromium() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return (await import(pathToFileURL(c).href)).chromium;
  const req = createRequire(resolve(ROOT, 'package.json'));
  for (const m of ['playwright', 'playwright-core']) {
    try {
      return (await import(pathToFileURL(req.resolve(m)).href)).chromium;
    } catch {
      /* next */
    }
  }
  throw new Error('Playwright not found: set PLAYWRIGHT_MODULE');
}
const chromium = await loadChromium();
const CHROMIUM = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

let server = null;
const base = CFG.url || `http://localhost:${CFG.port}`;
if (!CFG.url) {
  // Own process group, so the preview server dies with us (npx forks it).
  server = spawn('npx', ['vite', 'preview', '--port', String(CFG.port), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
  const kill = () => {
    try {
      process.kill(-server.pid);
    } catch {
      /* gone */
    }
  };
  process.on('exit', kill);
  process.on('SIGINT', () => process.exit(130));
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    try {
      up = (await fetch(base + '/')).ok;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!up) throw new Error(`preview server did not start on ${base} (run \`npx vite build\` first)`);
}
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const out = { cpuThrottle: `${CFG.throttle}x`, dpr: CFG.dpr, viewport: [1600, 1000], chromium: browser.version() };
const log = (...a) => console.error(...a);

async function newPage(throttle = CFG.throttle) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: CFG.dpr });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  return { ctx, page, cdp };
}
const onTitle = (page) => page.waitForFunction(() => window.__lotAndRoll && window.__lotAndRollShell && document.getElementById('app')?.dataset.screen === 'title', null, { timeout: 30000 });
const nodes = (page) => page.evaluate(() => document.querySelectorAll('*').length);
const r1 = (x) => Math.round(x * 10) / 10;

// ------------------------------------------------------------------------------------ trace helper
async function trace(page, cdp, fn, extra = []) {
  const events = [];
  const onData = (ev) => events.push(...ev.value);
  cdp.on('Tracing.dataCollected', onData);
  const done = new Promise((res) => cdp.once('Tracing.tracingComplete', res));
  await cdp.send('Tracing.start', {
    categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', ...extra].join(','),
    transferMode: 'ReportEvents',
  });
  const t0 = Date.now();
  await fn();
  const wall = (Date.now() - t0) / 1000;
  await cdp.send('Tracing.end');
  await done;
  cdp.off('Tracing.dataCollected', onData);
  const threads = new Map();
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threads.set(`${e.pid}:${e.tid}`, e.args.name);
  const key = (e) => `${e.pid}:${e.tid}`;
  const mains = [...threads].filter(([, n]) => n === 'CrRendererMain').map(([k]) => k);
  const busy = (k) => events.filter((e) => key(e) === k && (e.name === 'FunctionCall' || e.name === 'UpdateLayoutTree' || e.name === 'Layout')).length;
  const main = mains.sort((a, b) => busy(b) - busy(a))[0];
  const pid = main ? Number(main.split(':')[0]) : null;
  const onMain = (e) => key(e) === main;
  const inRenderer = (e) => e.pid === pid;
  const complete = (e) => e.ph === 'X' || e.ph === 'B' || e.ph === 'I' || e.ph === 'i' || e.ph === 'n';
  const pick = (name, where) => events.filter((e) => e.name === name && complete(e) && where(e));
  const layouts = pick('Layout', onMain);
  return {
    sec: wall,
    layout: layouts.length,
    layoutMaxMs: r1(Math.max(0, ...layouts.map((e) => (e.dur || 0) / 1000))),
    paint: pick('Paint', inRenderer).length,
    raster: pick('RasterTask', inRenderer).length,
    style: pick('UpdateLayoutTree', onMain).length,
    raf: pick('FireAnimationFrame', onMain).length,
    timers: pick('TimerFire', onMain).length,
    drawFrames: pick('DrawFrame', inRenderer).length,
  };
}

async function taskMs(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return (metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0) * 1000;
}

/** A trace window + LayerTree repaint count + main-thread task time. */
async function measureWindow(page, cdp, ms) {
  await cdp.send('Performance.enable');
  let painted = 0;
  const onPaint = () => painted++;
  cdp.on('LayerTree.layerPainted', onPaint);
  await cdp.send('LayerTree.enable');
  const t0 = await taskMs(cdp);
  const tr = await trace(page, cdp, () => page.waitForTimeout(ms));
  const task = (await taskMs(cdp)) - t0;
  await cdp.send('LayerTree.disable').catch(() => {});
  cdp.off('LayerTree.layerPainted', onPaint);
  return { ...tr, layerPainted: painted, taskMs: Math.round(task) };
}

// ------------------------------------------------------------------------------------ boot
if (CFG.phases.includes('boot')) {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const { ctx, page } = await newPage();
    await page.addInitScript(() => {
      const w = window;
      w.__boot = {};
      new MutationObserver(() => {
        if (document.getElementById('app')?.dataset.screen === 'title' && !w.__boot.title) {
          w.__boot.title = performance.now();
          // First frame containing the Title (rAF → next task ≈ after that frame's paint).
          requestAnimationFrame(() => setTimeout(() => (w.__boot.titlePainted = performance.now()), 0));
        }
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-screen'] });
    });
    await page.goto(base + '/');
    await page.waitForFunction(() => window.__boot?.titlePainted, null, { timeout: 30000 });
    runs.push(await page.evaluate(() => ({ titleMountedMs: Math.round(window.__boot.title), titlePaintedMs: Math.round(window.__boot.titlePainted) })));
    await ctx.close();
  }
  const med = (k) => runs.map((r) => r[k]).sort((a, b) => a - b)[1];
  out.boot = { medianTitleMountedMs: med('titleMountedMs'), medianTitlePaintedMs: med('titlePaintedMs'), runs };
  log('boot', JSON.stringify(out.boot));
}

// ------------------------------------------------------------------------------------ idle (B)
const CALM_WAIT_MS = 12000; // decorative loops end ~10 s after the last input / their start
const idleVerdict = (r) => r.layout === 0 && r.paint === 0 && r.raster === 0 && r.style <= 1 && r.raf === 0 && r.timers === 0 && r.layerPainted === 0 && r.taskMs < 100;
const decoVerdict = (r) => r.layout === 0 && r.paint === 0 && r.raster === 0 && r.layerPainted === 0;
async function idlePair(page, cdp, label) {
  // Decorative window: from ~1.5 s after the screen settled until the loops stop.
  const deco = await measureWindow(page, cdp, 7000);
  deco.pass = decoVerdict(deco);
  await page.waitForTimeout(Math.max(0, CALM_WAIT_MS - 1500 - 7000));
  const calm = await measureWindow(page, cdp, 10000);
  calm.pass = idleVerdict(calm);
  log(`idle ${label}: decorative ${JSON.stringify(deco)}`);
  log(`idle ${label}: calm       ${JSON.stringify(calm)}`);
  return { decorative: deco, calm, pass: deco.pass && calm.pass };
}
if (CFG.phases.includes('idle')) {
  out.idle = {};
  {
    const { ctx, page, cdp } = await newPage();
    await page.goto(base + '/?dev=1');
    await onTitle(page);
    await page.waitForTimeout(1500);
    out.idle.title = await idlePair(page, cdp, 'title');
    await page.evaluate(() => {
      window.__lotAndRoll.setPromptTimer(0);
      window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(4, false), 11);
    });
    await page.waitForFunction(() => window.__lotAndRoll.getState()?.phase.kind === 'preRoll' && !window.__lotAndRoll.isBusy() && document.querySelector('.roll-btn:not([disabled])'), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    out.idle.game = await idlePair(page, cdp, 'game (4 humans, roll prompt, timer off)');
    await ctx.close();
  }
  {
    const { ctx, page, cdp } = await newPage();
    await page.goto(base + '/?dev=1');
    await onTitle(page);
    await page.evaluate(() => {
      window.__lotAndRoll.setAnimSpeed(0);
      window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(2, true), 5);
    });
    await page.waitForFunction(() => document.getElementById('app')?.dataset.screen === 'result', null, { timeout: 180000, polling: 250 });
    await page.evaluate(() => window.__lotAndRoll.setAnimSpeed(1));
    await page.waitForTimeout(1500);
    out.idle.result = await idlePair(page, cdp, 'result');
    await ctx.close();
  }
  out.idle.pass = ['title', 'game', 'result'].every((k) => out.idle[k].pass);
}

// ------------------------------------------------------------------------------------ cap (A)
async function capRun(saver) {
  const { ctx, page, cdp } = await newPage(1);
  await page.goto(base + '/?dev=1');
  await onTitle(page);
  await page.evaluate((v) => window.__lotAndRollShell.prefs.set({ batterySaver: v }), saver);
  await page.evaluate(() => window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(4, true), 20260929));
  await page.waitForFunction(() => window.__lotAndRoll.getState(), null, { timeout: 30000 });
  await page.waitForTimeout(2000);
  await cdp.send('Performance.enable');
  const t0 = await taskMs(cdp);
  const tr = await trace(page, cdp, () => page.waitForTimeout(CFG.capSeconds * 1000));
  const task = (await taskMs(cdp)) - t0;
  await ctx.close();
  const per = (n) => r1(n / tr.sec);
  return { fps: per(tr.drawFrames), taskMsPerSec: per(task), paintsPerSec: per(tr.paint), rasterPerSec: per(tr.raster), stylePerSec: per(tr.style), rafPerSec: per(tr.raf) };
}
if (CFG.phases.includes('cap')) {
  const on = await capRun(true);
  const off = await capRun(false);
  out.cap = { seconds: CFG.capSeconds, on, off, pass: on.fps >= 26 && on.fps <= 34 && off.fps >= 55 };
  log('cap', JSON.stringify(out.cap));
}

// ------------------------------------------------------------------------------------ unique frames (info)
if (CFG.phases.includes('unique')) {
  out.unique = {};
  for (const saver of [true, false]) {
    const { ctx, page, cdp } = await newPage(1);
    await page.goto(base + '/?dev=1');
    await onTitle(page);
    await page.evaluate((v) => window.__lotAndRollShell.prefs.set({ batterySaver: v }), saver);
    await page.evaluate(() => window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(4, true), 20260929));
    await page.waitForTimeout(2000);
    let frames = 0;
    let unique = 0;
    let last = '';
    cdp.on('Page.screencastFrame', (f) => {
      frames++;
      const h = createHash('md5').update(f.data).digest('hex');
      if (h !== last) unique++;
      last = h;
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 800, maxHeight: 500, everyNthFrame: 1 });
    await page.waitForTimeout(20000);
    await cdp.send('Page.stopScreencast');
    out.unique[saver ? 'on' : 'off'] = { framesPerSec: r1(frames / 20), uniquePerSec: r1(unique / 20) };
    await ctx.close();
  }
  log('unique', JSON.stringify(out.unique));
}

// ------------------------------------------------------------------------------------ play (frames)
if (CFG.phases.includes('play')) {
  const { ctx, page, cdp } = await newPage();
  await page.goto(base + '/?dev=1');
  await onTitle(page);
  await page.evaluate(() => {
    window.__lt = [];
    window.__frames = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration));
    }).observe({ entryTypes: ['longtask'] });
  });
  await page.evaluate(() => window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(4, true), 20260929));
  await page.waitForFunction(() => window.__lotAndRoll.getState(), null, { timeout: 30000 });
  // Frame intervals from the first 2 s after the game is up are not counted (mount + first paint).
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    window.__lt = [];
    let last = performance.now();
    const tick = (t) => {
      window.__frames.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const heap0 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  const nodes0 = await nodes(page);
  const t0 = Date.now();
  while (Date.now() - t0 < CFG.seconds * 1000) {
    await page.waitForTimeout(1000);
    const k = await page.evaluate(() => window.__lotAndRoll.getState()?.phase.kind);
    if (k === 'gameOver' || !k) break;
  }
  const st = await page.evaluate(() => {
    const s = window.__lotAndRoll.getState();
    return { turns: s?.turn, round: s?.round };
  });
  await cdp.send('HeapProfiler.collectGarbage');
  const heap1 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  const nodes1 = await nodes(page);
  const f = await page.evaluate(() => {
    const f = window.__frames.slice(1).sort((a, b) => a - b);
    const p = (q) => +f[Math.min(f.length - 1, Math.floor(f.length * q))].toFixed(1);
    const lt = window.__lt;
    return {
      frames: f.length,
      p50: p(0.5),
      p95: p(0.95),
      p99: p(0.99),
      max: Math.round(f[f.length - 1]),
      over20: f.filter((x) => x > 20).length,
      over33: f.filter((x) => x > 33.4).length,
      over50: f.filter((x) => x > 50).length,
      longTasks: lt.length,
      longTaskMax: Math.max(0, ...lt),
    };
  });
  out.play = { seconds: Math.round((Date.now() - t0) / 1000), ...st, heapMB: [r1(heap0 / 1048576), r1(heap1 / 1048576)], domNodes: [nodes0, nodes1], frameTimes: f };
  log('play', JSON.stringify(out.play));
  await ctx.close();
}

// ------------------------------------------------------------------------------------ layers (C)
if (CFG.phases.includes('layers')) {
  const { ctx, page, cdp } = await newPage();
  await page.goto(base + '/?dev=1');
  await onTitle(page);
  await page.evaluate(() => window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(4, true), 20260929));
  await page.waitForFunction(() => window.__lotAndRoll.getState(), null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  const counts = [];
  let peak = 0;
  let peakMB = 0;
  const dev = CFG.dpr * CFG.dpr;
  const onTree = (ev) => {
    if (!ev.layers) return;
    counts.push(ev.layers.length);
    peak = Math.max(peak, ev.layers.length);
    peakMB = Math.max(peakMB, ev.layers.reduce((a, l) => a + (l.drawsContent ? l.width * l.height * 4 * dev : 0), 0) / 1048576);
  };
  cdp.on('LayerTree.layerTreeDidChange', onTree);
  await cdp.send('LayerTree.enable');
  const tr = await trace(page, cdp, () => page.waitForTimeout(CFG.layerSeconds * 1000));
  await cdp.send('LayerTree.disable').catch(() => {});
  cdp.off('LayerTree.layerTreeDidChange', onTree);
  const sorted = [...counts].sort((a, b) => a - b);
  out.layers = {
    seconds: r1(tr.sec),
    medianLayers: sorted[sorted.length >> 1] ?? 0,
    peakLayers: peak,
    peakLayerMemoryMB: r1(peakMB),
    paintsPerSec: r1(tr.paint / tr.sec),
    rasterPerSec: r1(tr.raster / tr.sec),
    layoutMaxMs: tr.layoutMaxMs,
  };
  log('layers', JSON.stringify(out.layers));
  await ctx.close();
}

// ------------------------------------------------------------------------------------ mount
if (CFG.phases.includes('mount')) {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const { ctx, page, cdp } = await newPage();
    await page.goto(base + '/?dev=1');
    await onTitle(page);
    await page.waitForTimeout(1000);
    const tr = await trace(page, cdp, async () => {
      await page.evaluate(() => window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(4, false), 11));
      await page.waitForFunction(() => document.querySelector('.roll-btn'), null, { timeout: 30000 });
      await page.waitForTimeout(1500);
    });
    runs.push(tr.layoutMaxMs);
    await ctx.close();
  }
  out.mount = { layoutMaxMs: runs.sort((a, b) => a - b)[1], runs };
  log('mount', JSON.stringify(out.mount));
}

// ------------------------------------------------------------------------------------ full game DOM
if (CFG.phases.includes('full')) {
  const { ctx, page } = await newPage(1);
  await page.goto(base + '/?dev=1');
  await onTitle(page);
  await page.evaluate(() => {
    window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(4, true), 20260929);
    window.__lotAndRoll.setAnimSpeed(4);
  });
  await page.waitForFunction(() => window.__lotAndRoll.getState(), null, { timeout: 30000 });
  const snap = () =>
    page.evaluate(() => {
      const s = window.__lotAndRoll.getState();
      return s ? { round: s.round, nodes: document.querySelectorAll('*').length, phase: s.phase.kind } : null;
    });
  const rows = [await snap()];
  const t0 = Date.now();
  while (Date.now() - t0 < 15 * 60 * 1000) {
    await page.waitForTimeout(3000);
    const s = await snap();
    if (!s) break;
    if (s.round !== rows[rows.length - 1].round || s.phase === 'gameOver') rows.push(s);
    if (s.phase === 'gameOver') break;
  }
  const ns = rows.map((r) => r.nodes);
  out.full = { rounds: rows[rows.length - 1].round, minNodes: Math.min(...ns), maxNodes: Math.max(...ns), perRound: rows.map((r) => [r.round, r.nodes]) };
  log('full', JSON.stringify(out.full));
  await ctx.close();
}

// ------------------------------------------------------------------------------------ tap (info)
if (CFG.phases.includes('tap')) {
  const { ctx, page } = await newPage();
  await page.goto(base + '/?dev=1');
  await onTitle(page);
  await page.evaluate(() => {
    window.__lotAndRoll.setPromptTimer(0);
    window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(2, false), 7);
  });
  const samples = [];
  for (let i = 0; i < 3; i++) {
    await page.waitForFunction(() => window.__lotAndRoll.getState()?.phase.kind === 'preRoll' && !window.__lotAndRoll.isBusy(), null, { timeout: 60000 });
    const btn = page.locator('.roll-btn:not([disabled])');
    await btn.waitFor({ state: 'visible' });
    await page.waitForTimeout(600);
    const box = await btn.boundingBox();
    await page.evaluate(() => {
      window.__ev = [];
      window.__po?.disconnect();
      window.__po = new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (e.name === 'pointerdown' || e.name === 'pointerup') window.__ev.push({ name: e.name, duration: e.duration });
      });
      window.__po.observe({ type: 'event', durationThreshold: 16, buffered: false });
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(250);
    await page.mouse.up();
    await page.waitForTimeout(1200);
    const ev = await page.evaluate(() => window.__ev);
    const get = (n) => ev.find((e) => e.name === n)?.duration ?? 16;
    samples.push({ pointerdown: get('pointerdown'), pointerup: get('pointerup') });
    for (let k = 0; k < 20; k++) {
      const s = await page.evaluate(() => ({ kind: window.__lotAndRoll.getState()?.phase.kind, busy: window.__lotAndRoll.isBusy() }));
      if (s.kind === 'preRoll' && !s.busy) break;
      if (!s.busy && s.kind !== 'preRoll') await page.evaluate(() => window.__lotAndRoll.autoStep());
      await page.waitForTimeout(500);
    }
  }
  out.tap = { samples };
  log('tap', JSON.stringify(out.tap));
  await ctx.close();
}

await browser.close();

// ------------------------------------------------------------------------------------ verdicts
const rows = [];
const gate = (name, pass, value) => rows.push({ name, pass: !!pass, value });
if (out.cap) {
  gate('A  presented fps, battery saver ON, no throttle: 26-34', out.cap.on.fps >= 26 && out.cap.on.fps <= 34, `${out.cap.on.fps} fps`);
  gate('A  presented fps, battery saver OFF, no throttle: >= 55', out.cap.off.fps >= 55, `${out.cap.off.fps} fps`);
}
if (out.idle) {
  for (const k of ['game', 'title', 'result']) {
    const r = out.idle[k];
    const c = r.calm;
    gate(`B  idle zero, ${k}: 10 s calm window`, c.pass, `layout ${c.layout}, paint ${c.paint}, raster ${c.raster}, style ${c.style}, rAF ${c.raf}, timers ${c.timers}, layerPainted ${c.layerPainted}, task ${c.taskMs} ms`);
    const d = r.decorative;
    gate(`B  decorative loops compositor-only, ${k}`, d.pass, `layout ${d.layout}, paint ${d.paint}, raster ${d.raster}, layerPainted ${d.layerPainted} (${d.drawFrames} compositor frames)`);
  }
}
if (out.play) {
  const f = out.play.frameTimes;
  gate('C  frame p99 <= 20 ms (4x, after the first 2 s)', f.p99 <= 20, `${f.p99} ms`);
  gate('C  no frame > 33 ms (4x, after the first 2 s)', f.over33 === 0, `${f.over33} frames > 33 ms (max ${f.max} ms)`);
}
if (out.mount) gate('C  mount layout <= 100 ms (4x)', out.mount.layoutMaxMs <= 100, `${out.mount.layoutMaxMs} ms`);
if (out.layers) {
  const L = out.layers;
  gate('C  peak layers <= 20 (4x play)', L.peakLayers <= 20, `${L.peakLayers} (median ${L.medianLayers})`);
  gate('C  median layers <= 25', L.medianLayers <= 25, `${L.medianLayers}`);
  gate('C  peak layer memory <= 100 MB', L.peakLayerMemoryMB <= 100, `${L.peakLayerMemoryMB} MB`);
  gate('C  Paint <= 20/s (4x play)', L.paintsPerSec <= 20, `${L.paintsPerSec}/s`);
  gate('C  no forced layout > 50 ms during play', L.layoutMaxMs <= 50, `max Layout ${L.layoutMaxMs} ms`);
}
if (out.boot) gate('C  boot to Title painted <= 1500 ms (4x)', out.boot.medianTitlePaintedMs <= 1500, `${out.boot.medianTitlePaintedMs} ms`);
if (out.full) gate('C  DOM bounded over a full game (max/min <= 1.3)', out.full.maxNodes / out.full.minNodes <= 1.3, `${out.full.minNodes}..${out.full.maxNodes} nodes over ${out.full.rounds} rounds`);
out.gates = rows;

const pad = (s, n) => String(s).padEnd(n);
log('\n' + pad('RESULT', 7) + pad('GATE', 58) + 'VALUE');
for (const r of rows) log(pad(r.pass ? 'PASS' : 'FAIL', 7) + pad(r.name, 58) + r.value);
if (out.cap) {
  log('\n30 fps cap (battery saver) ON vs OFF — CPU demo game, no throttle');
  log(pad('', 22) + pad('ON', 12) + 'OFF');
  for (const [k, label] of [['fps', 'presented frames/s'], ['taskMsPerSec', 'main-thread task ms/s'], ['paintsPerSec', 'Paint/s'], ['rasterPerSec', 'RasterTask/s'], ['stylePerSec', 'style recalcs/s'], ['rafPerSec', 'rAF callbacks/s']]) {
    log(pad(label, 22) + pad(out.cap.on[k], 12) + out.cap.off[k]);
  }
}
if (out.unique) log(`\nunique presented frames/s (screencast hash): ON ${out.unique.on.uniquePerSec}, OFF ${out.unique.off.uniquePerSec}`);
const failed = rows.filter((r) => !r.pass).length;
log(`\n${rows.length - failed}/${rows.length} gates passed`);
if (CFG.json) writeFileSync(resolve(ROOT, CFG.json), JSON.stringify(out, null, 1) + '\n');
process.exitCode = failed ? 1 : 0;
