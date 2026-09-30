#!/usr/bin/env node
/**
 * Long-frame attribution for the 4x CPU demo game (docs/PERFORMANCE.md): which game event a
 * frame longer than two vsyncs followed, and whether the main thread was busy (Long Animation
 * Frames API: script time, time to rendering, style/layout start) or idle (a compositor / raster /
 * environment stall). No tracing, so the numbers are not inflated by the tracer.
 *
 *   npx vite build && node scripts/perf-frames.mjs [--seconds 60] [--throttle 4] [--dpr 2] [--runs 1]
 *
 * Needs the dev hook (`?dev=1`): the game marks every event (`lr:<EventType>`) and every prompt
 * build (`lr:prompt-build`, with its element count) with the User Timing API.
 * Also prints the per-kind prompt build stats (`window.__lrPromptStats`: JS ms, DOM elements).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i < 0 ? d : argv[i + 1];
};
const SECS = Number(opt('seconds', 60));
const THROTTLE = Number(opt('throttle', 4));
const DPR = Number(opt('dpr', 2));
const RUNS = Number(opt('runs', 1));
const PORT = Number(opt('port', 4186));

const PW = process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(PW).href).then((m) => (m.chromium ? m : m.default));
const CHROMIUM = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
const kill = () => {
  try {
    process.kill(-server.pid);
  } catch {
    /* gone */
  }
};
process.on('exit', kill);
const base = `http://localhost:${PORT}`;
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(base + '/')).ok) break;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ['--no-sandbox'] });

for (let run = 1; run <= RUNS; run++) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: DPR });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await page.goto(base + '/?dev=1');
  await page.waitForFunction(() => window.__lotAndRoll && document.getElementById('app')?.dataset.screen === 'title', null, { timeout: 30000 });
  await page.evaluate(() => window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(4, true), 20260929));
  await page.waitForFunction(() => window.__lotAndRoll.getState(), null, { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const L = (window.__L = { loaf: [], marks: [], frames: [] });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        L.loaf.push({
          start: e.startTime,
          dur: e.duration,
          block: e.blockingDuration,
          render: e.renderStart,
          style: e.styleAndLayoutStart,
          scripts: e.scripts.map((s) => ({ inv: s.invoker, fn: s.sourceFunctionName, dur: Math.round(s.duration), forced: Math.round(s.forcedStyleAndLayoutDuration) })),
        });
      }
    }).observe({ type: 'long-animation-frame' });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.name.startsWith('lr:')) L.marks.push([e.name, e.startTime]);
    }).observe({ entryTypes: ['mark', 'measure'] });
    let last = performance.now();
    const tick = (t) => {
      L.frames.push([t, t - last]);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.waitForTimeout(SECS * 1000);
  const { L, stats } = await page.evaluate(() => ({ L: window.__L, stats: window.__lrPromptStats ?? [] }));
  const iv = L.frames.map(([, d]) => d).slice(1);
  const sorted = iv.slice().sort((a, b) => a - b);
  console.log(
    `run ${run}: ${iv.length} frames, p99 ${sorted[Math.floor(sorted.length * 0.99)].toFixed(1)} ms, ` +
      `${iv.filter((d) => d > 20).length} > 20 ms (one missed vsync), ${iv.filter((d) => d > 34).length} > 2 vsyncs, max ${Math.round(sorted[sorted.length - 1])} ms`,
  );
  for (const [t, d] of L.frames.slice(1).filter(([, d]) => d > 34)) {
    const lo = L.loaf
      .filter((e) => e.start < t + 5 && e.start + e.dur > t - d - 20)
      .map(
        (e) =>
          `LoAF ${Math.round(e.dur)} ms, blocking ${Math.round(e.block)}, rendering from +${Math.round(e.render - e.start)}, style/layout from +${Math.round(e.style - e.start)}` +
          (e.scripts.length ? '; ' + e.scripts.map((s) => `${s.inv}${s.fn ? '/' + s.fn : ''} ${s.dur} ms${s.forced ? ` (forced layout ${s.forced})` : ''}`).join(', ') : ''),
      );
    const mk = [...new Set(L.marks.filter(([, mt]) => mt > t - d - 60 && mt < t).map(([n]) => n))];
    console.log(`  ${d.toFixed(1)} ms @${(t / 1000).toFixed(1)} s | ${mk.join(', ') || '-'} | ${lo.join(' || ') || 'no long animation frame (main thread idle: pipeline / environment)'}`);
  }
  const by = {};
  for (const s of stats) (by[s.kind] ??= []).push(s);
  const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  for (const [k, a] of Object.entries(by)) {
    console.log(`  prompt ${k.padEnd(11)} n ${String(a.length).padStart(2)}  DOM elements median ${med(a.map((s) => s.els))} (max ${Math.max(...a.map((s) => s.els))})  build JS median ${med(a.map((s) => s.ms)).toFixed(1)} ms (max ${Math.max(...a.map((s) => s.ms)).toFixed(1)})`);
  }
  await ctx.close();
}
await browser.close();
process.exit(0);
