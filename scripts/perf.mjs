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
 * Phases (default: boot,idle,cap,play,layers,mount,fx)
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
 *   floor   (with play) info only, not a gate: the same rAF interval measurement on an empty page
 *           (same throttle / DPR / length). This machine's own long frames (VM scheduling, CPU
 *           throttler time slices): at 4x an empty page already shows 1-2 frames > 2 vsyncs per
 *           60 s here, so a play count at that level is the environment, not the game.
 *   tap     (--phases tap) roll pad press/release (a toss) input-to-paint (Event Timing), info only.
 *   fx      VFX gates F1–F10 (docs/VFX.md §10.3, §15): the worst-case effect chain replayed on a live
 *           4-human game at 4x (toll XL → takeover → landmark + monopoly → bankruptcy → hub
 *           victory): particles, layers / layer memory, presented + unique fps, rAF p95, then idle
 *           zero, 20 replays (leaks), atlas bytes, skipped finale. F6: the seeded 4x CPU demo game
 *           with effects on vs off (main-thread ms/s ratio <= 1.35).
 *
 * Presented fps = max(renderer DrawFrame, viz Display::DrawAndSwap): the FX worker's canvas frames
 * reach the display without a renderer DrawFrame.
 *
 * Chromium: CHROMIUM_PATH, else /opt/pw-browsers/chromium, else Playwright's own (scripts/fx/common.mjs).
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, launchChromium, serve } from './fx/common.mjs';

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
  // No log line for this long = the run is stuck (a CDP reply that never comes): exit 3 with the
  // phase it was in, instead of waiting forever (2026-10-06: a cap trace hung for 26 min).
  stallSeconds: Number(opt('stall-seconds', 300)),
  f6Seconds: Number(opt('f6-seconds', 30)),
  layerSeconds: Number(opt('layer-seconds', 40)),
  phases: String(opt('phases', 'boot,idle,cap,play,layers,mount,fx')).split(','),
  json: opt('json', null),
  /** Extra dev query for every game page, e.g. `--query mcam=3d` (money cut-in board camera). */
  query: opt('query', null),
  /** Viewport (CSS px), e.g. `--viewport 1280x800 --dpr 1.5` (money tiers per device, MONEY-EVENTS §12). */
  viewport: String(opt('viewport', '1600x1000')).split('x').map(Number),
};
const DEV = '/?dev=1' + (CFG.query ? `&${CFG.query}` : '');
if (opt('full', false) && !CFG.phases.includes('full')) CFG.phases.push('full');
if (opt('unique', false) && !CFG.phases.includes('unique')) CFG.phases.push('unique');

// ------------------------------------------------------------------------------------ setup
const base = CFG.url || (await serve(CFG.port));
const browser = await launchChromium();
const [VW, VH] = CFG.viewport;
const out = { cpuThrottle: `${CFG.throttle}x`, dpr: CFG.dpr, viewport: [VW, VH], chromium: browser.version() };
let lastLog = Date.now();
let phase = 'setup';
const log = (...a) => {
  lastLog = Date.now();
  console.error(...a);
};
/** Name the phase in progress (for the stall watchdog's message) and count it as progress. */
const enter = (name) => {
  phase = name;
  lastLog = Date.now();
};
const watchdog = setInterval(() => {
  const idle = (Date.now() - lastLog) / 1000;
  if (idle < CFG.stallSeconds) return;
  console.error(`\nperf: STALLED — no progress for ${Math.round(idle)} s in phase "${phase}" (--stall-seconds ${CFG.stallSeconds}). Exiting 3.`);
  process.exit(3);
}, 5000);
watchdog.unref();

/** Reject when `p` has not settled within `ms` (a CDP event or reply that never arrives). */
class TraceTimeout extends Error {}
function within(p, ms, what) {
  let t;
  return Promise.race([p, new Promise((_, rej) => (t = setTimeout(() => rej(new TraceTimeout(`${what}: no reply in ${Math.round(ms / 1000)} s`)), ms)))]).finally(() => clearTimeout(t));
}

async function newPage(throttle = CFG.throttle) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: CFG.dpr });
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
  // Bounded: a lost Tracing.tracingComplete used to hang the whole run (no other await here has
  // a timeout of its own). Collection normally takes a few seconds per traced minute.
  const limit = Math.max(60000, wall * 4000);
  try {
    await within(cdp.send('Tracing.end'), limit, 'Tracing.end');
    await within(done, limit, 'Tracing.tracingComplete');
  } finally {
    cdp.off('Tracing.dataCollected', onData);
  }
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
  const ts = (list) => list.map((e) => e.ts / 1000).sort((a, b) => a - b);
  return {
    // Timestamps (ms, trace clock) for the active-fps and cut-in splits below.
    drawTs: ts(pick('DrawFrame', inRenderer)),
    swapTs: ts(events.filter((e) => e.name === 'Display::DrawAndSwap' && complete(e))),
    paintTs: ts(pick('Paint', inRenderer)),
    rasterTs: ts(pick('RasterTask', inRenderer)),
    marks: events.filter((e) => e.cat?.includes('blink.user_timing') && e.name.startsWith('perf:')).map((e) => [e.name, e.ts / 1000]).sort((a, b) => a[1] - b[1]),
    sec: wall,
    layout: layouts.length,
    layoutMaxMs: r1(Math.max(0, ...layouts.map((e) => (e.dur || 0) / 1000))),
    paint: pick('Paint', inRenderer).length,
    raster: pick('RasterTask', inRenderer).length,
    style: pick('UpdateLayoutTree', onMain).length,
    raf: pick('FireAnimationFrame', onMain).length,
    timers: pick('TimerFire', onMain).length,
    drawFrames: pick('DrawFrame', inRenderer).length,
    // Display swaps (viz): frames actually presented, including the FX worker's OffscreenCanvas
    // frames, which reach the display without a renderer DrawFrame. Only with the 'viz' category.
    swaps: events.filter((e) => e.name === 'Display::DrawAndSwap' && complete(e)).length,
  };
}

async function taskMs(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return (metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0) * 1000;
}

/**
 * Presented frames per second WHILE THE SCREEN CHANGES: frame intervals up to `STILL_GAP_MS` count
 * as animation; longer gaps are still holds (the game's pacing: reading time, the turn rest, the
 * dice result hold), where zero idle load means no frames at all. Averaging those holds in made a
 * correctly capped game read ~20 fps (docs/PERFORMANCE.md "라운드 2").
 */
const STILL_GAP_MS = 200;
function activeRate(ts) {
  let n = 0;
  let ms = 0;
  for (let i = 1; i < ts.length; i++) {
    const d = ts[i] - ts[i - 1];
    if (d <= STILL_GAP_MS) {
      n++;
      ms += d;
    }
  }
  return { fps: ms > 0 ? r1((n * 1000) / ms) : 0, activeSec: r1(ms / 1000) };
}

/**
 * A trace window + LayerTree repaint count + main-thread task time.
 * `layerTree: false` leaves the LayerTree agent off: with it on, Chromium repaints and re-rasters
 * EVERY layer on any commit that changes a layer property — a compositor-only opacity change of a
 * `will-change` element read paint 4 / raster 44 with the agent and 0 / 0 without (measured,
 * docs/PERFORMANCE.md "라운드 2"). Windows that contain such changes (the decorative window: the
 * dealer's bubble fading out) count Paint / Raster without it; `layerPainted` is then null.
 */
async function measureWindow(page, cdp, ms, { layerTree = true } = {}) {
  await cdp.send('Performance.enable');
  let painted = 0;
  const onPaint = () => painted++;
  if (layerTree) {
    cdp.on('LayerTree.layerPainted', onPaint);
    await cdp.send('LayerTree.enable');
  }
  const t0 = await taskMs(cdp);
  const tr = await trace(page, cdp, () => page.waitForTimeout(ms));
  const task = (await taskMs(cdp)) - t0;
  if (layerTree) {
    await cdp.send('LayerTree.disable').catch(() => {});
    cdp.off('LayerTree.layerPainted', onPaint);
  }
  const { drawTs, swapTs, paintTs, rasterTs, marks, ...rest } = tr;
  return { ...rest, layerPainted: layerTree ? painted : null, taskMs: Math.round(task) };
}

// ------------------------------------------------------------------------------------ boot
if (CFG.phases.includes('boot')) {
  enter('boot');
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
const decoVerdict = (r) => r.layout === 0 && r.paint === 0 && r.raster === 0 && (r.layerPainted ?? 0) === 0;
async function idlePair(page, cdp, label) {
  // Decorative window: from ~1.5 s after the screen settled until the loops stop. Without the
  // LayerTree agent (see measureWindow): it forces a full repaint on compositor-only changes.
  const deco = await measureWindow(page, cdp, 7000, { layerTree: false });
  deco.pass = decoVerdict(deco);
  await page.waitForTimeout(Math.max(0, CALM_WAIT_MS - 1500 - 7000));
  const calm = await measureWindow(page, cdp, 10000);
  calm.pass = idleVerdict(calm);
  log(`idle ${label}: decorative ${JSON.stringify(deco)}`);
  log(`idle ${label}: calm       ${JSON.stringify(calm)}`);
  return { decorative: deco, calm, pass: deco.pass && calm.pass };
}
if (CFG.phases.includes('idle')) {
  enter('idle');
  out.idle = {};
  {
    const { ctx, page, cdp } = await newPage();
    await page.goto(base + DEV);
    await onTitle(page);
    await page.waitForTimeout(1500);
    out.idle.title = await idlePair(page, cdp, 'title');
    await page.evaluate(() => {
      window.__lotAndRoll.setPromptTimer(0);
      window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(4, false), 11);
    });
    await page.waitForFunction(() => window.__lotAndRoll.getState()?.phase.kind === 'preRoll' && !window.__lotAndRoll.isBusy() && document.querySelector('.roll-pad:not([disabled])'), null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    out.idle.game = await idlePair(page, cdp, 'game (4 humans, roll prompt, timer off)');
    await ctx.close();
  }
  {
    const { ctx, page, cdp } = await newPage();
    await page.goto(base + DEV);
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
  await page.goto(base + DEV);
  await onTitle(page);
  await page.evaluate((v) => window.__lotAndRollShell.prefs.set({ batterySaver: v }), saver);
  await page.evaluate(() => window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(4, true), 20260929));
  await page.waitForFunction(() => window.__lotAndRoll.getState(), null, { timeout: 30000 });
  await page.waitForTimeout(2000);
  await cdp.send('Performance.enable');
  const t0 = await taskMs(cdp);
  const tr = await trace(page, cdp, () => page.waitForTimeout(CFG.capSeconds * 1000), ['viz']);
  const task = (await taskMs(cdp)) - t0;
  await ctx.close();
  const per = (n) => r1(n / tr.sec);
  // Presented = the more of renderer DrawFrames and display swaps (docs/PERFORMANCE.md §2), while
  // the screen changes (activeRate); `windowFps` is the plain average over the window, still holds
  // included (info).
  const ad = activeRate(tr.drawTs);
  const as = activeRate(tr.swapTs);
  const act = as.fps > ad.fps ? as : ad;
  return { fps: act.fps, activeSec: act.activeSec, stillSec: r1(tr.sec - act.activeSec), windowFps: per(Math.max(tr.drawFrames, tr.swaps)), drawFramesPerSec: per(tr.drawFrames), swapsPerSec: per(tr.swaps), taskMsPerSec: per(task), paintsPerSec: per(tr.paint), rasterPerSec: per(tr.raster), stylePerSec: per(tr.style), rafPerSec: per(tr.raf) };
}
/** One fresh-page retry when a trace never completes; a second hang fails loudly. */
async function capRunRetry(saver) {
  try {
    return await capRun(saver);
  } catch (e) {
    if (!(e instanceof TraceTimeout)) throw e;
    log(`cap (${saver ? 'saver on' : 'saver off'}): ${e.message}; retrying once in a fresh page`);
    return capRun(saver);
  }
}
if (CFG.phases.includes('cap')) {
  enter('cap');
  const on = await capRunRetry(true);
  const off = await capRunRetry(false);
  out.cap = { seconds: CFG.capSeconds, on, off, pass: on.fps >= 26 && on.fps <= 34 && off.fps >= 55 };
  log('cap', JSON.stringify(out.cap));
}

// ------------------------------------------------------------------------------------ unique frames (info)
if (CFG.phases.includes('unique')) {
  enter('unique');
  out.unique = {};
  for (const saver of [true, false]) {
    const { ctx, page, cdp } = await newPage(1);
    await page.goto(base + DEV);
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
  enter('play');
  const { ctx, page, cdp } = await newPage();
  await page.goto(base + DEV);
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
  // Frame stats first: the forced GC below blocks the main thread for ~150-250 ms at 4x and was
  // being recorded as the run's longest "frame" (the harness's own pause, not the game's).
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
      // "> 33 ms" = longer than two vsync intervals (one missed vsync is allowed by the p99 gate).
      // rAF timestamps are quantized to 0.1 ms and vsync jitters by ~0.1 ms, so ONE missed vsync
      // reads 33.3-33.6 ms: the old `x > 33.4` counted some of those and not others. Intervals come
      // in vsync multiples (33.3 / 50 / 66.7 ms), so `> 34` separates them cleanly.
      over33: f.filter((x) => x > 34).length,
      over33raw: f.filter((x) => x > 33.4).length,
      over50: f.filter((x) => x > 50).length,
      longTasks: lt.length,
      longTaskMax: Math.max(0, ...lt),
    };
  });
  await cdp.send('HeapProfiler.collectGarbage');
  const heap1 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  const nodes1 = await nodes(page);
  out.play = { seconds: Math.round((Date.now() - t0) / 1000), ...st, heapMB: [r1(heap0 / 1048576), r1(heap1 / 1048576)], domNodes: [nodes0, nodes1], frameTimes: f };
  log('play', JSON.stringify(out.play));
  await ctx.close();
}

// ------------------------------------------------------------------------------------ floor (info)
if (CFG.phases.includes('play') || CFG.phases.includes('floor')) {
  const { ctx, page } = await newPage();
  await page.setContent('<div id="d" style="font:40px sans-serif">0</div>');
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = (t) => {
      window.__frames.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.waitForTimeout(CFG.seconds * 1000);
  out.floor = await page.evaluate(() => {
    const f = window.__frames.slice(1).sort((a, b) => a - b);
    return {
      frames: f.length,
      p99: +f[Math.floor(f.length * 0.99)].toFixed(1),
      max: Math.round(f[f.length - 1]),
      over20: f.filter((x) => x > 20).length,
      over33: f.filter((x) => x > 34).length,
    };
  });
  log('floor', JSON.stringify(out.floor));
  await ctx.close();
}

// ------------------------------------------------------------------------------------ layers (C)
if (CFG.phases.includes('layers')) {
  enter('layers');
  const { ctx, page, cdp } = await newPage();
  await page.goto(base + DEV);
  await onTitle(page);
  await page.evaluate(() => window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(4, true), 20260929));
  await page.waitForFunction(() => window.__lotAndRoll.getState(), null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  // The money stage's render tier for this device (MONEY-EVENTS §12): its layer-memory budget is the gate.
  const tier0 = await page.evaluate(() => window.__lotAndRoll.money?.() ?? null);
  const counts = [];
  let peak = 0;
  let peakMB = 0;
  let peakTree = [];
  let peakDuring = '';
  const dev = CFG.dpr * CFG.dpr;
  const onTree = (ev) => {
    if (!ev.layers) return;
    counts.push(ev.layers.length);
    peak = Math.max(peak, ev.layers.length);
    const mb = ev.layers.reduce((a, l) => a + (l.drawsContent ? l.width * l.height * 4 * dev : 0), 0) / 1048576;
    if (mb > peakMB) {
      peakMB = mb;
      peakTree = ev.layers.filter((l) => l.drawsContent);
      // What was running at the peak (dev hook): money stage, animated elements, the last events.
      void page
        .evaluate(() => {
          const anims = document.getAnimations().map((a) => {
            const t = a.effect && a.effect.target;
            return t ? `${t.tagName.toLowerCase()}.${String(t.className).split(' ').join('.')}` : '?';
          });
          const ms = document.querySelector('.money-stage');
          const log = window.__moneyLog ?? [];
          return `stage ${ms && ms.classList.contains('is-live') ? 'live' : 'parked'}; scenes ${log.length} (last ${log.at(-1)?.play ?? '-'}); fx ${window.__lotAndRoll.fx()?.effects?.join('+') || '-'}; anims ${[...new Set(anims)].join(' ') || '-'}`;
        })
        .then((v) => (peakDuring = v))
        .catch(() => {});
    }
  };
  cdp.on('LayerTree.layerTreeDidChange', onTree);
  await cdp.send('DOM.getDocument', { depth: 0 });
  await cdp.send('LayerTree.enable');
  await markCutIns(page);
  const tr = await trace(page, cdp, () => page.waitForTimeout(CFG.layerSeconds * 1000), ['blink.user_timing']);
  await cdp.send('LayerTree.disable').catch(() => {});
  cdp.off('LayerTree.layerTreeDidChange', onTree);
  const cutAgent = cutInSplit(tr);
  // What the peak-memory layers were (node + class), largest first.
  const peakLayersList = [];
  for (const l of [...peakTree].sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 12)) {
    let who = '?';
    if (l.backendNodeId) {
      const d = await cdp.send('DOM.describeNode', { backendNodeId: l.backendNodeId }).catch(() => null);
      if (d?.node) who = `${d.node.localName || d.node.nodeName}${(d.node.attributes ?? []).reduce((a, v, i, arr) => (arr[i - 1] === 'class' ? `${a}.${v.split(' ').join('.')}` : a), '')}`;
    }
    peakLayersList.push(`${who} ${Math.round(l.width)}x${Math.round(l.height)} ${r1((l.width * l.height * 4 * dev) / 1048576)}MB`);
  }
  await cdp.send('DOM.disable').catch(() => {});
  const sorted = [...counts].sort((a, b) => a - b);
  out.layers = {
    seconds: r1(tr.sec),
    medianLayers: sorted[sorted.length >> 1] ?? 0,
    peakLayers: peak,
    peakLayerMemoryMB: r1(peakMB),
    paintsPerSec: r1(tr.paint / tr.sec),
    rasterPerSec: r1(tr.raster / tr.sec),
    withLayerTreeAgent: cutAgent,
    layoutMaxMs: tr.layoutMaxMs,
    peakMemoryLayers: peakLayersList,
    peakMemoryDuring: peakDuring,
    moneyTier: tier0 ? { start: `${tier0.tier} ×${tier0.scale}${tier0.tilt ? ' 3D' : ' 2D'} (${tier0.source})`, budgetMB: tier0.budgetMB, end: await page.evaluate(() => { const m = window.__lotAndRoll.money(); return m ? `${m.tier} ×${m.scale}${m.tilt ? ' 3D' : ' 2D'} (${m.source}; cut-ins ${m.health.join(',')})` : '-'; }).catch(() => '-') } : null,
  };
  await ctx.close();
  // Paint/s: the same seeded game again WITHOUT the LayerTree agent (it repaints every layer on any
  // commit that changes a layer property, which during a cut-in is every frame), split outside /
  // inside the money cut-ins (docs/PERFORMANCE.md "라운드 2": a cut-in's coins are script-driven by
  // design; the play budget applies outside them, cut-ins have their own).
  {
    const { ctx, page, cdp } = await newPage();
    await page.goto(base + DEV);
    await onTitle(page);
    await page.evaluate(() => window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(4, true), 20260929));
    await page.waitForFunction(() => window.__lotAndRoll.getState(), null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    await markCutIns(page);
    const tp = await trace(page, cdp, () => page.waitForTimeout(CFG.layerSeconds * 1000), ['blink.user_timing']);
    Object.assign(out.layers, { paintsPerSecNoAgent: r1(tp.paint / tp.sec), ...cutInSplit(tp) });
    await ctx.close();
  }
  log('layers', JSON.stringify(out.layers));
}

/** Mark the money cut-ins on the trace clock (User Timing marks perf:money-live / perf:money-park). */
async function markCutIns(page) {
  await page.evaluate(() => {
    const el = document.querySelector('.money-stage');
    if (!el) return;
    let live = el.classList.contains('is-live');
    if (live) performance.mark('perf:money-live');
    new MutationObserver(() => {
      const now = el.classList.contains('is-live');
      if (now !== live) performance.mark(now ? 'perf:money-live' : 'perf:money-park');
      live = now;
    }).observe(el, { attributes: true, attributeFilter: ['class'] });
  });
}

/**
 * Split a trace's Paint / RasterTask counts into "outside money cut-ins" and "inside" by the
 * perf:money-live / perf:money-park marks. The window spans from the first to the last trace event
 * that counts (frames, paints), so a window without cut-ins reproduces the plain average.
 */
function cutInSplit(tr) {
  const all = [...tr.drawTs, ...tr.paintTs];
  const t0 = all.length ? Math.min(...all) : 0;
  const t1 = t0 + tr.sec * 1000;
  const spans = [];
  let open = null;
  for (const [name, t] of tr.marks) {
    if (name === 'perf:money-live' && open === null) open = t;
    if (name === 'perf:money-park' && open !== null) {
      spans.push([open, t]);
      open = null;
    }
  }
  if (open !== null) spans.push([open, t1]);
  const inCut = (t) => spans.some(([a, b]) => t >= a && t < b);
  const liveMs = spans.reduce((a, [x, y]) => a + Math.max(0, Math.min(y, t1) - Math.max(x, t0)), 0);
  const outMs = Math.max(1, tr.sec * 1000 - liveMs);
  const pIn = tr.paintTs.filter(inCut).length;
  const rIn = tr.rasterTs.filter(inCut).length;
  return {
    cutIns: spans.length,
    cutInSec: r1(liveMs / 1000),
    paintsPerSecPlay: r1(((tr.paintTs.length - pIn) * 1000) / outMs),
    paintsPerSecCutIn: liveMs > 0 ? r1((pIn * 1000) / liveMs) : null,
    rasterPerSecPlay: r1(((tr.rasterTs.length - rIn) * 1000) / outMs),
    rasterPerSecCutIn: liveMs > 0 ? r1((rIn * 1000) / liveMs) : null,
  };
}

// ------------------------------------------------------------------------------------ mount
if (CFG.phases.includes('mount')) {
  enter('mount');
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const { ctx, page, cdp } = await newPage();
    await page.goto(base + DEV);
    await onTitle(page);
    await page.waitForTimeout(1000);
    const tr = await trace(page, cdp, async () => {
      await page.evaluate(() => window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(4, false), 11));
      await page.waitForFunction(() => document.querySelector('.roll-pad'), null, { timeout: 30000 });
      await page.waitForTimeout(1500);
    });
    runs.push(tr.layoutMaxMs);
    await ctx.close();
  }
  out.mount = { layoutMaxMs: runs.sort((a, b) => a - b)[1], runs };
  log('mount', JSON.stringify(out.mount));
}

// ------------------------------------------------------------------------------------ fx (F1–F10)
/**
 * VFX gates (docs/VFX.md §10.3). A 4-human game (4x, DPR 2) waiting at the roll prompt; the worst
 * case of the catalogue is replayed on the live board through the dev hook: toll XL → takeover →
 * landmark + monopoly → bankruptcy → hub victory (each awaited to its block frame, like the
 * sequencer). Measured over that window: live particles (poll 100 ms), GPU layers / layer memory
 * (LayerTree), presented / unique fps, rAF intervals, main-thread task time; then the 10 s idle
 * window, a 20x replay for leaks, the atlas size, and a skipped finale.
 */
const FX_SCENARIO = [
  ['tollPay', { payer: 0, receiver: 2, amount: 3000, space: 22, payerCashAfter: 200 }],
  ['takeoverStamp', { space: 20, buyer: 1, seller: 3 }],
  ['landmarkReveal', { space: 31, player: 2, group: { spaces: [30, 31], color: '#4A6CF7' } }],
  ['bankruptcy', { player: 3 }],
  ['victory', { winner: 1, kind: 'hubs', spaces: [5, 13, 21, 29] }],
];
async function fxScenario(page) {
  await page.evaluate(async (list) => {
    for (const [name, params] of list) await window.__lotAndRoll.playFx(name, params);
  }, FX_SCENARIO);
  await page.waitForFunction(() => !window.__lotAndRoll.fx().ticking, null, { timeout: 60000, polling: 100 });
}
async function fxPage(throttle) {
  const p = await newPage(throttle);
  await p.page.goto(base + DEV);
  await onTitle(p.page);
  await p.page.evaluate(() => {
    window.__lotAndRoll.setPromptTimer(0);
    window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(4, false), 11);
  });
  await p.page.waitForFunction(() => window.__lotAndRoll.getState()?.phase.kind === 'preRoll' && !window.__lotAndRoll.isBusy() && window.__lotAndRoll.fx()?.atlas === 'ready', null, { timeout: 60000 });
  await p.page.waitForTimeout(1500);
  // Warm-up pass (atlas decode, tint cache, first backing store) — as after the first minutes of a game.
  await fxScenario(p.page);
  await p.page.waitForTimeout(1000);
  await p.page.evaluate(() => window.__fx.resetStats());
  return p;
}
if (CFG.phases.includes('fx')) {
  enter('fx');
  // F4 at 1x (like gate A / the unique phase: at 4x the screencast itself cannot deliver 30 frames/s).
  let fps1;
  {
    const { ctx, page, cdp } = await fxPage(1);
    let frames = 0;
    let unique = 0;
    let lastHash = '';
    const onCast = (f) => {
      frames++;
      const h = createHash('md5').update(f.data).digest('hex');
      if (h !== lastHash) unique++;
      lastHash = h;
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    };
    cdp.on('Page.screencastFrame', onCast);
    await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 800, maxHeight: 500, everyNthFrame: 1 });
    const tr = await trace(page, cdp, () => fxScenario(page), ['viz']);
    await cdp.send('Page.stopScreencast');
    fps1 = { sec: r1(tr.sec), drawFps: r1(Math.max(tr.drawFrames, tr.swaps) / tr.sec), rendererDrawFps: r1(tr.drawFrames / tr.sec), swapFps: r1(tr.swaps / tr.sec), uniqueFps: r1(unique / tr.sec), screencastFps: r1(frames / tr.sec) };
    log('fx 1x frames', JSON.stringify(fps1));
    await ctx.close();
  }
  // F6 (relative): main-thread task time of the same seeded 4x CPU demo game with effects on (the
  // default setting, auto) vs off (Settings → Effects: off = static highlight + sound), alternated
  // twice, medians. An absolute ms/s budget measured on the demo page does not transfer to the real
  // game (its commits / style / paint of 16 layers are there with or without effects); what effects
  // must not do is add much on top of the game (docs/PERFORMANCE.md §1.2).
  const f6Run = async (q) => {
    const { ctx, page, cdp } = await newPage();
    await page.goto(base + DEV + (q ? '&fxq=' + q : ''));
    await onTitle(page);
    await page.evaluate(() => window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(4, true), 20260929));
    await page.waitForTimeout(3000);
    await cdp.send('Performance.enable');
    const t0 = await taskMs(cdp);
    const w0 = Date.now();
    await page.waitForTimeout(CFG.f6Seconds * 1000);
    const v = ((await taskMs(cdp)) - t0) / ((Date.now() - w0) / 1000);
    const q2 = await page.evaluate(() => window.__lotAndRoll.fx()?.quality ?? null);
    await ctx.close();
    return { taskMsPerSec: r1(v), quality: q2 };
  };
  const f6 = { on: [], off: [] };
  for (let i = 0; i < 2; i++) {
    f6.on.push(await f6Run(''));
    f6.off.push(await f6Run('off'));
  }
  const med = (a) => a.map((x) => x.taskMsPerSec).sort((x, y) => x - y)[a.length >> 1];
  f6.onMs = med(f6.on);
  f6.offMs = med(f6.off);
  f6.ratio = +(f6.onMs / f6.offMs).toFixed(2);
  log('fx F6', JSON.stringify(f6));
  const playTask = f6.offMs;
  const { ctx, page, cdp } = await fxPage(CFG.throttle);
  // Run A (4x): layers + trace (no page-side rAF recorder: it would add frames).
  let peakLayers = 0;
  let peakMB = 0;
  let peakTree = [];
  let peakAt = Promise.resolve('');
  const dev = CFG.dpr * CFG.dpr;
  const onTree = (ev) => {
    if (!ev.layers) return;
    peakLayers = Math.max(peakLayers, ev.layers.length);
    const mb = ev.layers.reduce((a, l) => a + (l.drawsContent ? l.width * l.height * 4 * dev : 0), 0) / 1048576;
    if (mb > peakMB) {
      peakMB = mb;
      peakTree = ev.layers.filter((l) => l.drawsContent);
      peakAt = page.evaluate(() => {
        const s = window.__lotAndRoll.fx();
        return `${s?.effects.join('+')} canvas ${s?.canvas?.w}x${s?.canvas?.h}`;
      }).catch(() => '?');
    }
  };
  cdp.on('LayerTree.layerTreeDidChange', onTree);
  await cdp.send('DOM.getDocument', { depth: 0 });
  await cdp.send('LayerTree.enable');
  const livePeak = [];
  const poll = setInterval(() => {
    page
      .evaluate(() => window.__lotAndRoll.fx()?.live ?? 0)
      .then((n) => livePeak.push(n))
      .catch(() => {});
  }, 100);
  const tr = await trace(page, cdp, () => fxScenario(page));
  clearInterval(poll);
  await cdp.send('LayerTree.disable').catch(() => {});
  cdp.off('LayerTree.layerTreeDidChange', onTree);
  // What the peak-memory layers were (node + class), largest first.
  const peakLayersList = [];
  for (const l of [...peakTree].sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 12)) {
    let who = '?';
    if (l.backendNodeId) {
      const d = await cdp.send('DOM.describeNode', { backendNodeId: l.backendNodeId }).catch(() => null);
      if (d?.node) who = `${d.node.localName || d.node.nodeName}${(d.node.attributes ?? []).reduce((a, v, i, arr) => (arr[i - 1] === 'class' ? `${a}.${v.split(' ').join('.')}` : a), '')}`;
    }
    peakLayersList.push(`${who} ${Math.round(l.width)}x${Math.round(l.height)} ${r1((l.width * l.height * 4 * dev) / 1048576)}MB`);
  }
  await cdp.send('DOM.disable').catch(() => {});
  const stats = await page.evaluate(() => window.__lotAndRoll.fx());
  // Run B: rAF intervals + main-thread task time (no tracing / screencast overhead).
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    window.__fx.resetStats();
    window.__frames = [];
    window.__rafOn = true;
    let last = performance.now();
    const tick = (t) => {
      window.__frames.push(t - last);
      last = t;
      if (window.__rafOn) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await cdp.send('Performance.enable');
  const t0 = await taskMs(cdp);
  const w0 = Date.now();
  await fxScenario(page);
  const wallB = (Date.now() - w0) / 1000;
  const task = (await taskMs(cdp)) - t0;
  const raf = await page.evaluate(() => {
    window.__rafOn = false;
    const f = window.__frames.slice(1).sort((a, b) => a - b);
    const p = (q) => +f[Math.min(f.length - 1, Math.floor(f.length * q))].toFixed(1);
    return { frames: f.length, p50: p(0.5), p95: p(0.95), p99: p(0.99), max: Math.round(f[f.length - 1]), over34: f.filter((x) => x > 34).length };
  });
  const statsB = await page.evaluate(() => window.__lotAndRoll.fx());
  const fxWindow = {
    sec: r1(tr.sec),
    drawFps4x: r1(tr.drawFrames / tr.sec),
    drawFps: fps1.drawFps,
    uniqueFps: fps1.uniqueFps,
    screencastFps: fps1.screencastFps,
    taskMsPerSec: r1(task / wallB),
    playTaskMsPerSec: playTask,
    f6,
    paintsPerSec: r1(tr.paint / tr.sec),
    rasterPerSec: r1(tr.raster / tr.sec),
    layoutMaxMs: tr.layoutMaxMs,
    raf,
    peakLive: Math.max(stats.peak, ...livePeak),
    dropped: stats.dropped,
    peakLayers,
    peakLayerMemoryMB: r1(peakMB),
    peakMemoryLayers: peakLayersList,
    peakMemoryDuring: await peakAt,
    tick: statsB.tick,
    canvas: stats.canvas,
    tintCacheMB: r1(stats.tintCacheBytes / 1048576),
  };
  log('fx window', JSON.stringify(fxWindow));
  // F1: back to idle.
  await page.waitForTimeout(500);
  const idle = await measureWindow(page, cdp, 10000);
  // Main-thread task time on its own window: after a big effect run, (re-)enabling the LayerTree
  // agent inside measureWindow costs ~120 ms at 4x by itself (the harness, not the page: a plain
  // window reads ~1 ms).
  idle.taskMsWithLayerTreeAgent = idle.taskMs;
  {
    const t0 = await taskMs(cdp);
    await page.waitForTimeout(10000);
    idle.taskMs = Math.round((await taskMs(cdp)) - t0);
  }
  const after = await page.evaluate(() => ({ fx: window.__lotAndRoll.fx(), ticks: window.__lotAndRoll.activeTicks() }));
  idle.pass = idleVerdict(idle) && !after.fx.ticking && (after.fx.canvas?.hidden ?? true) && after.ticks === 0;
  idle.canvasHidden = after.fx.canvas?.hidden ?? true;
  idle.backing = after.fx.canvas ? [after.fx.canvas.backingW, after.fx.canvas.backingH] : null;
  idle.activeTicks = after.ticks;
  log('fx idle', JSON.stringify(idle));
  // F7: 20 replays (animation speed 3: same code paths, shorter run) — heap, DOM nodes, canvases.
  await cdp.send('HeapProfiler.collectGarbage');
  const heap0 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  const nodes0 = await nodes(page);
  const canvases0 = await page.evaluate(() => document.querySelectorAll('canvas.fx-canvas').length);
  await page.evaluate(() => window.__lotAndRoll.setAnimSpeed(3));
  for (let i = 0; i < 20; i++) await fxScenario(page);
  await page.evaluate(() => window.__lotAndRoll.setAnimSpeed(1));
  await page.waitForTimeout(1000);
  await cdp.send('HeapProfiler.collectGarbage');
  const heap1 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  const nodes1 = await nodes(page);
  const leak = { heapMB: [r1(heap0 / 1048576), r1(heap1 / 1048576)], domNodes: [nodes0, nodes1], canvases0, canvases: await page.evaluate(() => document.querySelectorAll('canvas.fx-canvas').length) };
  log('fx leak', JSON.stringify(leak));
  // F10: skip the finale 300 ms in → engine idle.
  const skipMs = await page.evaluate(async () => {
    const hook = window.__lotAndRoll;
    void hook.playFx('victory', { winner: 0, kind: 'hubs', spaces: [5, 13, 21, 29] });
    await new Promise((r) => setTimeout(r, 300));
    const t = performance.now();
    window.__fx.skip();
    while (hook.fx().ticking) await new Promise((r) => requestAnimationFrame(r));
    return Math.round(performance.now() - t);
  });
  await ctx.close();
  // F8: atlas bytes.
  const { statSync, readdirSync } = await import('node:fs');
  const fxDir = resolve(ROOT, 'public/fx');
  const atlasKB = r1(readdirSync(fxDir).reduce((a, f) => a + statSync(resolve(fxDir, f)).size, 0) / 1024);
  out.fx = { window: fxWindow, idle, leak, skipMs, atlasKB };
  log('fx', JSON.stringify({ skipMs, atlasKB }));
}

// ------------------------------------------------------------------------------------ full game DOM
if (CFG.phases.includes('full')) {
  enter('full');
  const { ctx, page } = await newPage(1);
  await page.goto(base + DEV);
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
  enter('tap');
  const { ctx, page } = await newPage();
  await page.goto(base + DEV);
  await onTitle(page);
  await page.evaluate(() => {
    window.__lotAndRoll.setPromptTimer(0);
    window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(2, false), 7);
  });
  const samples = [];
  for (let i = 0; i < 3; i++) {
    await page.waitForFunction(() => window.__lotAndRoll.getState()?.phase.kind === 'preRoll' && !window.__lotAndRoll.isBusy(), null, { timeout: 60000 });
    const btn = page.locator('.roll-pad:not([disabled])');
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
  const capV = (c) => `${c.fps} fps while animating (${c.activeSec} s; still holds ${c.stillSec} s; window average ${c.windowFps})`;
  gate('A  presented fps, battery saver ON, no throttle: 26-34', out.cap.on.fps >= 26 && out.cap.on.fps <= 34, capV(out.cap.on));
  gate('A  presented fps, battery saver OFF, no throttle: >= 55', out.cap.off.fps >= 55, capV(out.cap.off));
}
if (out.idle) {
  for (const k of ['game', 'title', 'result']) {
    const r = out.idle[k];
    const c = r.calm;
    gate(`B  idle zero, ${k}: 10 s calm window`, c.pass, `layout ${c.layout}, paint ${c.paint}, raster ${c.raster}, style ${c.style}, rAF ${c.raf}, timers ${c.timers}, layerPainted ${c.layerPainted}, task ${c.taskMs} ms`);
    const d = r.decorative;
    gate(`B  decorative loops compositor-only, ${k}`, d.pass, `layout ${d.layout}, paint ${d.paint}, raster ${d.raster} (${d.drawFrames} compositor frames; LayerTree agent off)`);
  }
}
if (out.play) {
  const f = out.play.frameTimes;
  gate('C  frame p99 <= 20 ms (4x, after the first 2 s)', f.p99 <= 20, `${f.p99} ms`);
  // This VM's empty page already shows frames > 2 vsyncs (floor phase, same run): PASS within floor + 3.
  const fl = out.floor?.over33 ?? 0;
  gate('C  frames > 33 ms <= empty-page floor + 3 (4x)', f.over33 <= fl + 3, `${f.over33} frames > 2 vsyncs (floor ${fl}; max ${f.max} ms; raw > 33.4 ms: ${f.over33raw}; > 20 ms: ${f.over20})`);
}
if (out.mount) gate('C  mount layout <= 100 ms (4x)', out.mount.layoutMaxMs <= 100, `${out.mount.layoutMaxMs} ms`);
if (out.layers) {
  const L = out.layers;
  gate('C  peak layers <= 20 (4x play)', L.peakLayers <= 20, `${L.peakLayers} (median ${L.medianLayers})`);
  gate('C  median layers <= 25', L.medianLayers <= 25, `${L.medianLayers}`);
  // Per money tier (docs/MONEY-EVENTS.md §12): low 100 MB, mid 150 MB, high 250 MB; 100 MB without a stage.
  const budget = L.moneyTier?.budgetMB ?? 100;
  gate(`C  peak layer memory <= ${budget} MB (money tier ${L.moneyTier?.start ?? '-'})`, L.peakLayerMemoryMB <= budget, `${L.peakLayerMemoryMB} MB`);
  // Outside money cut-ins (play) <= 20/s; inside them (coins are script-driven by design) <= 40/s.
  gate('C  Paint <= 20/s (4x play, outside money cut-ins)', L.paintsPerSecPlay <= 20, `${L.paintsPerSecPlay}/s (LayerTree agent off; with it on, as before round 2: ${L.withLayerTreeAgent.paintsPerSecPlay}/s outside, ${L.paintsPerSec}/s whole window)`);
  gate('C  Paint <= 40/s inside money cut-ins (4x)', L.paintsPerSecCutIn === null || L.paintsPerSecCutIn <= 40, L.paintsPerSecCutIn === null ? 'no cut-in in the window' : `${L.paintsPerSecCutIn}/s over ${L.cutIns} cut-ins, ${L.cutInSec} s (raster ${L.rasterPerSecCutIn}/s vs ${L.rasterPerSecPlay}/s outside; agent on: ${L.withLayerTreeAgent.paintsPerSecCutIn}/s)`);
  gate('C  no forced layout > 50 ms during play', L.layoutMaxMs <= 50, `max Layout ${L.layoutMaxMs} ms`);
}
if (out.boot) gate('C  boot to Title painted <= 1500 ms (4x)', out.boot.medianTitlePaintedMs <= 1500, `${out.boot.medianTitlePaintedMs} ms`);
if (out.fx) {
  const w = out.fx.window;
  const i = out.fx.idle;
  const L = out.fx.leak;
  gate('F1 fx: idle zero after the effects (10 s window)', i.pass, `layout ${i.layout}, paint ${i.paint}, raster ${i.raster}, style ${i.style}, rAF ${i.raf}, timers ${i.timers}, layerPainted ${i.layerPainted}, task ${i.taskMs} ms; canvas hidden ${i.canvasHidden}, clock callbacks ${i.activeTicks}`);
  gate('F2 fx: live particles <= 300', w.peakLive <= 300, `peak ${w.peakLive} (dropped ${w.dropped})`);
  gate('F3 fx: peak layers <= 20, layer memory <= 100 MB', w.peakLayers <= 20 && w.peakLayerMemoryMB <= 100, `${w.peakLayers} layers, ${w.peakLayerMemoryMB} MB`);
  gate('F4 fx: presented fps <= 34, unique >= 24 (no throttle)', w.drawFps <= 34 && w.uniqueFps >= 24, `${w.drawFps} fps presented, ${w.uniqueFps} unique (4x: ${w.drawFps4x} presented)`);
  gate('F5 fx: rAF interval p95 <= 33 ms (4x)', w.raf.p95 <= 33.4, `p95 ${w.raf.p95} ms (p99 ${w.raf.p99}, max ${w.raf.max}, ${w.raf.over34} > 2 vsyncs)`);
  gate('F6 fx: main thread, effects on <= 1.35x off (4x demo game)', w.f6.ratio <= 1.35, `${w.f6.onMs} vs ${w.f6.offMs} ms/s = x${w.f6.ratio} (fx replay window: ${w.taskMsPerSec} ms/s)`);
  gate('F7 fx: 20 replays: heap +<= 5 MB, DOM +0, canvases +0', L.heapMB[1] - L.heapMB[0] <= 5 && L.domNodes[1] - L.domNodes[0] <= 0 && L.canvases <= L.canvases0, `heap ${L.heapMB[0]} -> ${L.heapMB[1]} MB, nodes ${L.domNodes[0]} -> ${L.domNodes[1]}, canvases ${L.canvases0} -> ${L.canvases}`);
  gate('F8 fx: atlas + json <= 500 KB', out.fx.atlasKB <= 500, `${out.fx.atlasKB} KB`);
  if (out.boot) gate('F9 fx: boot to Title <= 1500 ms (unchanged)', out.boot.medianTitlePaintedMs <= 1500, `${out.boot.medianTitlePaintedMs} ms`);
  gate('F10 fx: skipped finale idle <= 500 ms', out.fx.skipMs <= 500, `${out.fx.skipMs} ms`);
}
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
if (out.floor) {
  const fl = out.floor;
  log(`\nenvironment floor (info, not a gate): an EMPTY page with the same ${CFG.throttle}x throttle / DPR ${CFG.dpr} / ${CFG.seconds} s: p99 ${fl.p99} ms, ${fl.over20} frames > 20 ms, ${fl.over33} frames > 2 vsyncs (max ${fl.max} ms)`);
}
if (out.unique) log(`\nunique presented frames/s (screencast hash): ON ${out.unique.on.uniquePerSec}, OFF ${out.unique.off.uniquePerSec}`);
const failed = rows.filter((r) => !r.pass).length;
log(`\n${rows.length - failed}/${rows.length} gates passed`);
if (CFG.json) writeFileSync(resolve(ROOT, CFG.json), JSON.stringify(out, null, 1) + '\n');
// Exit explicitly: the (detached) preview server's child handle would keep the loop alive; the
// 'exit' handler kills its process group.
process.exit(failed ? 1 : 0);
