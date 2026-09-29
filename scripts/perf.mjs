#!/usr/bin/env node
/**
 * Runtime performance check for Lot & Roll on an emulated mid-range tablet
 * (CDP CPU throttling 4x, DPR 2, 1600x1000). See docs/PERFORMANCE.md.
 *
 *   npm run perf                      # build + all phases (~3 min)
 *   node scripts/perf.mjs --phases boot,tap --throttle 4
 *   node scripts/perf.mjs --full      # also: DOM size across a whole 15-round game (unthrottled)
 *   node scripts/perf.mjs --json out.json
 *
 * Phases
 *   boot   real path `/` → time until the Title screen is mounted and the splash starts hiding.
 *   play   `/?dev=1#game` (seeded 4-CPU demo) for --seconds: frame intervals (rAF), long tasks,
 *          heap after GC, DOM node count at start/end.
 *   tap    2-human game: press + release the roll button with the mouse; Event Timing duration
 *          (input → next paint) of pointerdown / pointerup.
 *   idle   criterion B ("zero idle load"): 4-human game waiting at the roll prompt (timer off),
 *          the Title and the Result screen; 10 s each (throttled): Layout / Paint / RasterTask /
 *          style recalcs / rAF callbacks / timer fires from a trace, LayerTree.layerPainted, and
 *          main-thread TaskDuration (Performance.getMetrics).
 *   cap    criterion A (frame budget): CPU demo game, NO throttle, battery saver on vs off:
 *          presented frames/s (compositor DrawFrame), main-thread task ms/s, paints/s, raster/s.
 *   full   (--full) whole game at 4x animation speed, no throttle: DOM nodes per round.
 *
 * Needs the global Playwright (/opt/node22/lib/node_modules/playwright) + Chromium
 * (/opt/pw-browsers/chromium); override with PLAYWRIGHT_MODULE / CHROMIUM_PATH.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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
  seconds: Number(opt('seconds', 120)),
  phases: String(opt('phases', 'boot,play,tap,idle,cap')).split(','),
  capSeconds: Number(opt('cap-seconds', 40)),
  full: !!opt('full', false),
  json: opt('json', null),
};
if (CFG.full && !CFG.phases.includes('full')) CFG.phases.push('full');

const PW = process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(PW).href).then((m) => (m.chromium ? m : m.default));
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

let server = null;
const base = CFG.url || `http://localhost:${CFG.port}`;
if (!CFG.url) {
  server = spawn('npx', ['vite', 'preview', '--port', String(CFG.port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + '/')).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });
const out = { cpuThrottle: `${CFG.throttle}x`, dpr: CFG.dpr, viewport: [1600, 1000] };

async function newPage(throttle = CFG.throttle) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: CFG.dpr });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  return { ctx, page, cdp };
}

const nodes = (page) => page.evaluate(() => document.querySelectorAll('*').length);

// ------------------------------------------------------------------------------------ boot
if (CFG.phases.includes('boot')) {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const { ctx, page } = await newPage();
    await page.addInitScript(() => {
      const w = window;
      w.__boot = {};
      let sawSplash = false;
      new MutationObserver(() => {
        const app = document.getElementById('app');
        if (app?.dataset.screen === 'title' && !w.__boot.title) {
          w.__boot.title = performance.now();
          // First frame that contains the Title (rAF → next task ≈ after that frame's paint).
          requestAnimationFrame(() => setTimeout(() => (w.__boot.titlePainted = performance.now()), 0));
        }
        const sp = document.getElementById('splash');
        if (sp) sawSplash = true;
        if (sawSplash && (!sp || sp.classList.contains('is-hidden')) && !w.__boot.splash) w.__boot.splash = performance.now();
      }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-screen'] });
    });
    await page.goto(base + '/');
    await page.waitForFunction(() => window.__boot?.titlePainted && window.__boot?.splash, null, { timeout: 30000 });
    await page.waitForTimeout(500);
    runs.push(
      await page.evaluate(() => {
        const n = performance.getEntriesByType('navigation')[0];
        const fcp = performance.getEntriesByType('paint').find((x) => x.name === 'first-contentful-paint');
        const res = performance.getEntriesByType('resource');
        const fonts = res.filter((r) => r.name.includes('.woff2'));
        return {
          titleMountedMs: Math.round(window.__boot.title),
          titlePaintedMs: Math.round(window.__boot.titlePainted),
          splashHideMs: Math.round(window.__boot.splash),
          domContentLoadedMs: Math.round(n.domContentLoadedEventEnd),
          fcpMs: Math.round(fcp?.startTime ?? -1),
          fontFiles: fonts.length,
          fontKB: Math.round(fonts.reduce((a, r) => a + (r.encodedBodySize || r.transferSize || 0), 0) / 1024),
        };
      }),
    );
    await ctx.close();
  }
  const med = (k) => [...runs.map((r) => r[k])].sort((a, b) => a - b)[1];
  out.boot = { runs: runs.length, medianTitleMountedMs: med('titleMountedMs'), medianTitlePaintedMs: med('titlePaintedMs'), medianSplashHideMs: med('splashHideMs'), detail: runs };
  console.error('boot', JSON.stringify(out.boot));
}

// ------------------------------------------------------------------------------------ play
if (CFG.phases.includes('play')) {
  const { ctx, page, cdp } = await newPage();
  const t0 = Date.now();
  await page.goto(base + '/?dev=1#game');
  await page.waitForFunction(() => window.__lotAndRoll && window.__lotAndRoll.getState(), null, { timeout: 30000 });
  const bootToGameMs = Date.now() - t0;
  await page.evaluate(() => {
    window.__lt = [];
    window.__frames = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration));
    }).observe({ entryTypes: ['longtask'] });
    let last = performance.now();
    const tick = (t) => {
      window.__frames.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__lotAndRoll.setAnimSpeed(1);
  });
  const heap0 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  const nodes0 = await nodes(page);
  const start = Date.now();
  while (Date.now() - start < CFG.seconds * 1000) {
    await page.waitForTimeout(1000);
    const k = await page.evaluate(() => window.__lotAndRoll.getState()?.phase.kind);
    if (k === 'gameOver' || !k) break;
  }
  const st = await page.evaluate(() => {
    const s = window.__lotAndRoll.getState();
    return { turns: s.turn, round: s.round, owned: s.properties.filter((p) => p && p.owner !== null).length };
  });
  await cdp.send('HeapProfiler.collectGarbage');
  const heap1 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  const nodes1 = await nodes(page);
  const frames = await page.evaluate(() => {
    const f = window.__frames.slice(5).sort((a, b) => a - b);
    const p = (q) => +f[Math.floor(f.length * q)].toFixed(1);
    const lt = window.__lt;
    return {
      frames: f.length,
      p50: p(0.5),
      p95: p(0.95),
      p99: p(0.99),
      max: Math.round(f[f.length - 1]),
      over33: f.filter((x) => x > 33).length,
      over50: f.filter((x) => x > 50).length,
      over100: f.filter((x) => x > 100).length,
      longTasks: lt.length,
      longTasksOver100: lt.filter((x) => x > 100).length,
      longTaskMax: Math.max(0, ...lt),
    };
  });
  out.play = {
    seconds: Math.round((Date.now() - start) / 1000),
    bootToGameMs,
    ...st,
    heapMB: [+(heap0 / 1048576).toFixed(1), +(heap1 / 1048576).toFixed(1)],
    domNodes: [nodes0, nodes1],
    frameTimes: frames,
  };
  console.error('play', JSON.stringify(out.play));
  await ctx.close();
}

// ------------------------------------------------------------------------------------ tap
if (CFG.phases.includes('tap')) {
  const { ctx, page } = await newPage();
  await page.goto(base + '/?dev=1');
  await page.waitForFunction(() => window.__lotAndRoll && document.getElementById('app')?.dataset.screen === 'title', null, { timeout: 30000 });
  await page.evaluate(() => {
    window.__lotAndRoll.setPromptTimer(0);
    window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(2, false), 7);
  });
  const samples = [];
  for (let i = 0; i < 4; i++) {
    await page.waitForFunction(() => window.__lotAndRoll.getState()?.phase.kind === 'preRoll' && !window.__lotAndRoll.isBusy(), null, { timeout: 60000 });
    const btn = page.locator('.roll-btn:not([disabled])');
    await btn.waitFor({ state: 'visible' });
    await page.waitForTimeout(600); // let the prompt's entry animation finish
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
    const get = (n) => ev.find((e) => e.name === n)?.duration ?? 16; // below threshold = ≤ 16 ms
    samples.push({ pointerdown: get('pointerdown'), pointerup: get('pointerup') });
    // Let the move finish and any follow-up prompt be answered by the CPU policy.
    for (let k = 0; k < 20; k++) {
      const s = await page.evaluate(() => ({ kind: window.__lotAndRoll.getState()?.phase.kind, busy: window.__lotAndRoll.isBusy() }));
      if (s.kind === 'preRoll' && !s.busy) break;
      if (!s.busy && s.kind !== 'preRoll') await page.evaluate(() => window.__lotAndRoll.autoStep());
      await page.waitForTimeout(500);
    }
  }
  const worst = (k) => Math.max(...samples.map((s) => s[k]));
  out.tap = { samples, worstPointerdownMs: worst('pointerdown'), worstPointerupMs: worst('pointerup') };
  console.error('tap', JSON.stringify(out.tap));
  await ctx.close();
}

// ------------------------------------------------------------------------------------ trace helper
async function traceWindow(page, cdp, ms, extraCategories = []) {
  const events = [];
  const onData = (ev) => events.push(...ev.value);
  cdp.on('Tracing.dataCollected', onData);
  const done = new Promise((res) => cdp.once('Tracing.tracingComplete', res));
  await cdp.send('Tracing.start', {
    categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', ...extraCategories].join(','),
    transferMode: 'ReportEvents',
  });
  await page.waitForTimeout(ms);
  await cdp.send('Tracing.end');
  await done;
  cdp.off('Tracing.dataCollected', onData);
  const threads = new Map();
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threads.set(`${e.pid}:${e.tid}`, e.args.name);
  const procs = new Map();
  for (const e of events) if (e.ph === 'M' && e.name === 'process_name') procs.set(e.pid, e.args.name);
  const main = [...threads].find(([k, n]) => n === 'CrRendererMain' && events.some((e) => `${e.pid}:${e.tid}` === k && e.name === 'FunctionCall' || `${e.pid}:${e.tid}` === k && e.name === 'UpdateLayoutTree'))?.[0]
    ?? [...threads].find(([, n]) => n === 'CrRendererMain')?.[0];
  const rendererPid = main ? Number(main.split(':')[0]) : null;
  const count = (name, where = () => true) => events.filter((e) => e.name === name && (e.ph === 'X' || e.ph === 'B' || e.ph === 'I' || e.ph === 'i' || e.ph === 'n') && where(e)).length;
  const onMain = (e) => `${e.pid}:${e.tid}` === main;
  const inRenderer = (e) => e.pid === rendererPid;
  const ts = events.filter((e) => e.ts).map((e) => e.ts);
  const sec = ts.length ? (Math.max(...ts) - Math.min(...ts)) / 1e6 : ms / 1000;
  return {
    sec,
    layout: count('Layout', onMain),
    paint: count('Paint', inRenderer),
    raster: count('RasterTask', inRenderer),
    style: count('UpdateLayoutTree', onMain),
    raf: count('FireAnimationFrame', onMain),
    timers: count('TimerFire', onMain),
    drawFrames: count('DrawFrame', inRenderer),
  };
}

async function taskMs(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return (metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0) * 1000;
}

async function measureIdle(page, cdp, label) {
  await cdp.send('Performance.enable');
  let painted = 0;
  const onPaint = () => painted++;
  cdp.on('LayerTree.layerPainted', onPaint);
  await cdp.send('LayerTree.enable');
  const t0 = await taskMs(cdp);
  const tr = await traceWindow(page, cdp, 10000);
  const taskDelta = (await taskMs(cdp)) - t0;
  await cdp.send('LayerTree.disable').catch(() => {});
  cdp.off('LayerTree.layerPainted', onPaint);
  const r = { ...tr, layerPainted: painted, taskMs: Math.round(taskDelta) };
  r.pass = r.layout === 0 && r.paint === 0 && r.raster === 0 && r.style <= 1 && r.raf === 0 && r.timers === 0 && r.layerPainted === 0 && r.taskMs < 100;
  console.error(`idle ${label}`, JSON.stringify(r));
  return r;
}

// ------------------------------------------------------------------------------------ idle (B)
if (CFG.phases.includes('idle')) {
  out.idle = {};
  {
    const { ctx, page, cdp } = await newPage();
    await page.goto(base + '/?dev=1');
    await page.waitForFunction(() => window.__lotAndRoll && document.getElementById('app')?.dataset.screen === 'title', null, { timeout: 30000 });
    await page.waitForTimeout(3000);
    out.idle.title = await measureIdle(page, cdp, 'title');
    await page.evaluate(() => {
      window.__lotAndRoll.setPromptTimer(0);
      window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(4, false), 11);
    });
    await page.waitForFunction(() => window.__lotAndRoll.getState()?.phase.kind === 'preRoll' && !window.__lotAndRoll.isBusy() && document.querySelector('.roll-btn:not([disabled])'), null, { timeout: 60000 });
    await page.waitForTimeout(3000);
    out.idle.game = await measureIdle(page, cdp, 'game (4 humans, roll prompt, timer off)');
    await ctx.close();
  }
  {
    const { ctx, page, cdp } = await newPage();
    await page.goto(base + '/?dev=1');
    await page.waitForFunction(() => window.__lotAndRoll && document.getElementById('app')?.dataset.screen === 'title', null, { timeout: 30000 });
    await page.evaluate(() => {
      window.__lotAndRoll.setAnimSpeed(0);
      window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(2, true), 5);
    });
    await page.waitForFunction(() => document.getElementById('app')?.dataset.screen === 'result', null, { timeout: 120000, polling: 250 });
    await page.evaluate(() => window.__lotAndRoll.setAnimSpeed(1));
    await page.waitForTimeout(3000);
    out.idle.result = await measureIdle(page, cdp, 'result');
    await ctx.close();
  }
  out.idle.pass = Object.values(out.idle).every((r) => r.pass);
}

// ------------------------------------------------------------------------------------ cap (A)
if (CFG.phases.includes('cap')) {
  const runCap = async (saver) => {
    const { ctx, page, cdp } = await newPage(1);
    await page.goto(base + '/?dev=1');
    await page.waitForFunction(() => window.__lotAndRollShell && window.__lotAndRoll, null, { timeout: 30000 });
    await page.evaluate((v) => window.__lotAndRollShell.prefs.set({ batterySaver: v }), saver);
    await page.evaluate(() => window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(4, true), 20260929));
    await page.waitForFunction(() => window.__lotAndRoll.getState(), null, { timeout: 30000 });
    await page.waitForTimeout(2000);
    await cdp.send('Performance.enable');
    const t0 = await taskMs(cdp);
    const tr = await traceWindow(page, cdp, CFG.capSeconds * 1000);
    const task = (await taskMs(cdp)) - t0;
    await ctx.close();
    return {
      fps: +(tr.drawFrames / tr.sec).toFixed(1),
      taskMsPerSec: +(task / tr.sec).toFixed(1),
      paintsPerSec: +(tr.paint / tr.sec).toFixed(1),
      rasterPerSec: +(tr.raster / tr.sec).toFixed(1),
      stylePerSec: +(tr.style / tr.sec).toFixed(1),
      rafPerSec: +(tr.raf / tr.sec).toFixed(1),
    };
  };
  const on = await runCap(true);
  const off = await runCap(false);
  out.cap = { seconds: CFG.capSeconds, on, off, pass: on.fps >= 26 && on.fps <= 34 && off.fps >= 55 };
  console.error('cap', JSON.stringify(out.cap));
}

// ------------------------------------------------------------------------------------ full game DOM
if (CFG.phases.includes('full')) {
  const { ctx, page } = await newPage(1);
  await page.goto(base + '/?dev=1#game');
  await page.waitForFunction(() => window.__lotAndRoll && window.__lotAndRoll.getState(), null, { timeout: 30000 });
  await page.evaluate(() => window.__lotAndRoll.setAnimSpeed(4));
  const snap = () =>
    page.evaluate(() => {
      const s = window.__lotAndRoll.getState();
      if (!s) return null;
      const svg = document.querySelector('.board-svg');
      return {
        round: s.round,
        nodes: document.querySelectorAll('*').length,
        boardSvg: svg ? svg.querySelectorAll('*').length : 0,
        owned: s.properties.filter((p) => p && p.owner !== null).length,
        phase: s.phase.kind,
      };
    });
  const rows = [await snap()];
  const t0 = Date.now();
  while (Date.now() - t0 < 15 * 60 * 1000) {
    await page.waitForTimeout(4000);
    const s = await snap();
    if (!s) break;
    if (s.round !== rows[rows.length - 1].round || s.phase === 'gameOver') rows.push(s);
    if (s.phase === 'gameOver') break;
  }
  const a = rows[0];
  const b = rows[rows.length - 1];
  out.full = {
    rounds: b.round,
    start: a,
    end: b,
    nonBoardGrowth: b.nodes - b.boardSvg - (a.nodes - a.boardSvg),
    perRound: rows.map((r) => [r.round, r.nodes, r.boardSvg, r.owned]),
  };
  console.error('full', JSON.stringify({ start: a, end: b, nonBoardGrowth: out.full.nonBoardGrowth }));
  await ctx.close();
}

await browser.close();
server?.kill();

// ------------------------------------------------------------------------------------ verdicts
const verdicts = [];
const check = (name, ok, detail) => verdicts.push({ name, pass: !!ok, detail });
if (out.cap) check('A frame budget: 26-34 fps with battery saver, >= 55 without (no throttle)', out.cap.pass, `on ${out.cap.on.fps} fps, off ${out.cap.off.fps} fps`);
if (out.idle) check('B zero idle load (game / title / result)', out.idle.pass, ['game', 'title', 'result'].map((k) => `${k}: ${out.idle[k]?.pass ? 'ok' : 'FAIL'}`).join(', '));
if (out.boot) check('boot: Title painted <= 1500 ms (4x throttle)', out.boot.medianTitlePaintedMs <= 1500, `${out.boot.medianTitlePaintedMs} ms`);
if (out.play) {
  const f = out.play.frameTimes;
  check('play: long tasks > 100 ms <= 3', f.longTasksOver100 <= 3, `${f.longTasksOver100} (max ${f.longTaskMax} ms)`);
  check('play: frames > 50 ms <= 10', f.over50 <= 10, `${f.over50}`);
  check('play: p99 frame <= 34 ms', f.p99 <= 34, `${f.p99} ms`);
}
if (out.tap) check('tap: roll button input-to-paint < 100 ms', Math.max(out.tap.worstPointerdownMs, out.tap.worstPointerupMs) < 100, `down ${out.tap.worstPointerdownMs} ms, up ${out.tap.worstPointerupMs} ms`);
out.verdicts = verdicts;
for (const v of verdicts) console.error(`${v.pass ? 'PASS' : 'FAIL'}  ${v.name}  (${v.detail})`);
const text = JSON.stringify(out, null, 1);
if (CFG.json) writeFileSync(resolve(ROOT, CFG.json), text + '\n');
console.log(text);
