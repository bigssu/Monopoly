#!/usr/bin/env node
/**
 * Rendering-cost baseline for Lot & Roll ("draw calls" of a WebView: composited layers,
 * paint/raster work, SVG/effect cost, DOM/JS counters).
 *
 *   npm run build && node scripts/perf-render.mjs
 *   node scripts/perf-render.mjs --seconds 45 --throttle 4 --out docs/assets/perf-render-baseline.json
 *   node scripts/perf-render.mjs --url http://localhost:4173     # measure an already running server
 *
 * Options
 *   --url <base>        Base URL of a running server. Default: spawn `npx vite preview` on --port.
 *   --port <n>          Port for the spawned preview server (default 4183).
 *   --seconds <n>       Length of the CPU-play window (default 45).
 *   --title-seconds <n> Length of the Title-screen window (default 8).
 *   --throttle <n>      CDP CPU throttling rate (default 4).
 *   --dpr <n>           deviceScaleFactor (default 2).   --width/--height  viewport (1600x1000).
 *   --out <file>        JSON output (default docs/assets/perf-render-baseline.json).
 *   --scenarios <list>  comma list of `title,play` (default both).
 *   --quiet             only print the JSON.
 *
 * Chromium: CHROMIUM_PATH, else /opt/pw-browsers/chromium, else Playwright's own (scripts/fx/common.mjs).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ROOT, launchChromium, serve } from './fx/common.mjs';

const args = (() => {
  const a = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    a[k] = v;
  }
  return a;
})();
const CFG = {
  url: args.url || null,
  port: Number(args.port || 4183),
  seconds: Number(args.seconds || 45),
  titleSeconds: Number(args['title-seconds'] || 8),
  throttle: Number(args.throttle || 4),
  dpr: Number(args.dpr || 2),
  width: Number(args.width || 1600),
  height: Number(args.height || 1000),
  out: resolve(ROOT, args.out || 'docs/assets/perf-render-baseline.json'),
  scenarios: String(args.scenarios || 'title,play').split(','),
  quiet: !!args.quiet,
};
const log = (...m) => { if (!CFG.quiet) console.error(...m); };

const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------------------------
// server
let base = CFG.url || (await serve(CFG.port));
base = base.replace(/\/$/, '');

// ---------------------------------------------------------------------------------------------
// in-page probes
const svgProbe = () => {
  const out = {};
  const all = [...document.querySelectorAll('*')];
  out.domElements = all.length;
  const svgs = [...document.querySelectorAll('svg')];
  out.svgElements = svgs.length;
  out.svgTopLevel = svgs.filter((s) => !s.parentElement?.closest('svg')).length;
  out.svgChildElements = document.querySelectorAll('svg *').length;
  const groups = new Map();
  for (const s of svgs) {
    const key = s.dataset?.icon ? `data-icon=${s.dataset.icon}` : 'html:' + s.innerHTML.slice(0, 60);
    const g = groups.get(key) || { key, count: 0, children: 0 };
    g.count++;
    g.children += s.querySelectorAll('*').length;
    groups.set(key, g);
  }
  out.distinctIcons = groups.size;
  out.iconGroups = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 25);
  const sel = (el) => {
    const id = el.id ? '#' + el.id : '';
    const cls = [...(el.classList || [])].slice(0, 3).map((c) => '.' + c).join('');
    let p = el.parentElement?.closest('[class],[id]');
    const pp = p && p !== el ? (p.id ? '#' + p.id : '') + [...p.classList].slice(0, 1).map((c) => '.' + c).join('') : '';
    return (pp ? pp + ' > ' : '') + el.tagName.toLowerCase() + id + cls;
  };
  const fx = { filter: {}, 'backdrop-filter': {}, 'box-shadow': {}, 'mix-blend-mode': {}, 'will-change': {}, animated: {}, 'text-shadow': {}, opacity: {} };
  const tot = Object.fromEntries(Object.keys(fx).map((k) => [k, 0]));
  const bump = (k, el) => { tot[k]++; const s = sel(el); fx[k][s] = (fx[k][s] || 0) + 1; };
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.filter && cs.filter !== 'none') bump('filter', el);
    const bf = cs.backdropFilter || cs.webkitBackdropFilter;
    if (bf && bf !== 'none') bump('backdrop-filter', el);
    if (cs.boxShadow && cs.boxShadow !== 'none') bump('box-shadow', el);
    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') bump('mix-blend-mode', el);
    if (cs.willChange && cs.willChange !== 'auto') bump('will-change', el);
    if (cs.animationName && cs.animationName !== 'none') bump('animated', el);
    if (cs.textShadow && cs.textShadow !== 'none') bump('text-shadow', el);
    if (cs.opacity !== '1' && cs.opacity !== '') bump('opacity', el);
  }
  out.effects = {};
  for (const k of Object.keys(fx)) {
    out.effects[k] = { total: tot[k], top: Object.entries(fx[k]).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([selector, count]) => ({ selector, count })) };
  }
  return out;
};

// ---------------------------------------------------------------------------------------------
// trace analysis
const NAME_ALIASES = {
  Paint: ['Paint'],
  RasterTask: ['RasterTask'],
  CompositeLayers: ['CompositeLayers'],
  Commit: ['Commit'],
  UpdateLayerTree: ['UpdateLayerTree'],
  Layout: ['Layout'],
  RecalculateStyles: ['RecalculateStyles', 'UpdateLayoutTree'],
  PrePaint: ['PrePaint'],
  PaintImage: ['PaintImage'],
  DecodeImage: ['Decode Image', 'DecodeImage', 'ImageDecodeTask', 'Decode LazyPixelRef'],
  ImageDecodeTask: ['ImageDecodeTask'],
  DrawFrame: ['DrawFrame'],
  FunctionCall: ['FunctionCall'],
  GPUTask: ['GPUTask'],
  UpdateLayer: ['UpdateLayer'],
};
function analyzeTrace(events, windowSec) {
  const byName = {};
  const want = new Map();
  for (const [k, names] of Object.entries(NAME_ALIASES)) for (const n of names) want.set(n, k);
  // pair B/E per thread; take X directly
  const stacks = new Map();
  const slow = {};
  const add = (key, dur, ev, ts) => {
    const d = byName[key] || (byName[key] = { count: 0, totalMs: 0, maxMs: 0 });
    d.count++;
    d.totalMs += dur;
    if (dur > d.maxMs) d.maxMs = dur;
    if (['Layout', 'Paint', 'RasterTask', 'FunctionCall', 'RecalculateStyles'].includes(key) && dur > 8) {
      const a = { ...(ev.args?.data || {}), ...(ev.args?.beginData || {}), ...(ev.args?.endData || {}) };
      (slow[key] || (slow[key] = [])).push({ ms: r1(dur), atSec: r1((ts - t0) / 1e6), dirty: a.dirtyObjects, total: a.totalObjects, fn: a.functionName, url: a.url ? String(a.url).split('/').pop() : undefined, line: a.lineNumber, elements: a.elementCount });
    }
  };
  const t0 = events.reduce((m, e) => (e.ts && e.ts < m ? e.ts : m), Infinity);
  const raw = new Map();
  for (const e of events) {
    const key = want.get(e.name);
    if (!key) continue;
    raw.set(e.name, (raw.get(e.name) || 0) + (e.ph === 'E' ? 0 : 1));
    if (e.ph === 'X') add(key, (e.dur || 0) / 1000, e, e.ts);
    else if (e.ph === 'B') {
      const k = `${e.pid}:${e.tid}`;
      if (!stacks.has(k)) stacks.set(k, []);
      stacks.get(k).push(e);
    } else if (e.ph === 'E') {
      const st = stacks.get(`${e.pid}:${e.tid}`);
      const b = st?.pop();
      if (b) { const k2 = want.get(b.name); if (k2) add(k2, (e.ts - b.ts) / 1000, { args: { ...b.args, ...e.args } }, b.ts); }
    } else if (e.ph === 'I' || e.ph === 'i' || e.ph === 'R' || e.ph === 'n') add(key, 0, e, e.ts);
  }
  // Frames: prefer DrawFrame (compositor produced a frame); fall back to CompositeLayers/Commit counts.
  const frames = byName.DrawFrame?.count || byName.CompositeLayers?.count || byName.Commit?.count || 0;
  const table = {};
  for (const k of Object.keys(NAME_ALIASES)) {
    const d = byName[k];
    if (!d) { table[k] = { count: 0, totalMs: 0, perSec: 0, msPerSec: 0, perFrame: 0, msPerFrame: 0, maxMs: 0 }; continue; }
    table[k] = {
      count: d.count,
      totalMs: r1(d.totalMs),
      perSec: r2(d.count / windowSec),
      msPerSec: r1(d.totalMs / windowSec),
      perFrame: frames ? r2(d.count / frames) : null,
      msPerFrame: frames ? r2(d.totalMs / frames) : null,
      maxMs: r2(d.maxMs),
    };
  }
  const slowest = Object.fromEntries(Object.entries(slow).map(([k, v]) => [k, v.sort((a, b) => b.ms - a.ms).slice(0, 5)]));
  return { frames, framesPerSec: r1(frames / windowSec), events: table, slowest, totalTraceEvents: events.length };
}

// ---------------------------------------------------------------------------------------------
// one scenario
async function runScenario(browser, name, url, seconds, play) {
  log(`\n== ${name}: ${url} (${seconds}s, cpu x${CFG.throttle}, dpr ${CFG.dpr}) ==`);
  const ctx = await browser.newContext({ viewport: { width: CFG.width, height: CFG.height }, deviceScaleFactor: CFG.dpr });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 200)));

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CFG.throttle });
  await cdp.send('Performance.enable');
  await cdp.send('DOM.enable');

  // --- layer tree tracking
  let layers = [];
  let peak = { mem: -1, layers: [] };
  const samples = []; // {t, count, mem}
  const paintCounts = new Map(); // layerId -> painted events
  const info = new Map(); // layerId -> {node, reasons, w, h, backendNodeId}   (fetched while the layer is alive)
  const queue = [];
  let pumping = false;
  let layerEvents = 0;
  let paintedEvents = 0;
  let t00 = Date.now();
  let windowOpen = false;
  const memOf = (ls) => ls.reduce((a, l) => a + (l.drawsContent ? l.width * l.height * 4 : 0), 0);
  const describeNode = async (backendNodeId) => {
    if (!backendNodeId) return null;
    try {
      const { node } = await cdp.send('DOM.describeNode', { backendNodeId });
      const at = {};
      for (let i = 0; i < (node.attributes || []).length; i += 2) at[node.attributes[i]] = node.attributes[i + 1];
      return `${node.nodeName.toLowerCase()}${at.id ? '#' + at.id : ''}${at.class ? '.' + String(at.class).trim().split(/\s+/).slice(0, 3).join('.') : ''}`;
    } catch { return null; }
  };
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    while (queue.length) {
      const l = queue.shift();
      const rec = { node: await describeNode(l.backendNodeId), reasons: [], w: l.width, h: l.height };
      try {
        const r = await cdp.send('LayerTree.compositingReasons', { layerId: l.layerId });
        rec.reasons = r.compositingReasonIds || r.compositingReasons || [];
      } catch { /* layer already gone */ }
      info.set(l.layerId, rec);
    }
    pumping = false;
  };
  cdp.on('LayerTree.layerTreeDidChange', (ev) => {
    if (windowOpen) layerEvents++;
    if (!ev.layers) return;
    layers = ev.layers;
    const mem = memOf(layers);
    if (windowOpen) samples.push({ t: Date.now() - t00, count: layers.length, drawing: layers.filter((l) => l.drawsContent).length, mem });
    if (windowOpen && mem > peak.mem) peak = { mem, layers };
    for (const l of layers) if (!info.has(l.layerId)) { info.set(l.layerId, null); queue.push(l); }
    void pump();
  });
  cdp.on('LayerTree.layerPainted', (ev) => {
    if (!windowOpen) return;
    paintedEvents++;
    paintCounts.set(ev.layerId, (paintCounts.get(ev.layerId) || 0) + 1);
  });

  await cdp.send('LayerTree.enable');

  await page.goto(url);
  if (play) {
    await page.waitForFunction(() => window.__lotAndRoll && window.__lotAndRoll.getState(), null, { timeout: 30000 });
    await page.evaluate(() => window.__lotAndRoll.setAnimSpeed(1));
  } else {
    await page.waitForFunction(() => document.getElementById('app')?.dataset.screen, null, { timeout: 30000 });
  }
  await page.waitForTimeout(1500); // let entrance animations settle before the window opens

  // --- open the measurement window: seed the layer stats with the tree as it stands now
  t00 = Date.now();
  windowOpen = true;
  if (layers.length) {
    const mem = memOf(layers);
    samples.push({ t: 0, count: layers.length, drawing: layers.filter((l) => l.drawsContent).length, mem });
    peak = { mem, layers };
  }

  // --- counters before
  const perfBefore = await getMetrics(cdp);
  const domBefore = await cdp.send('Memory.getDOMCounters');
  const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null).catch(() => null);
  const svgBefore = await page.evaluate(svgProbe);

  // --- tracing
  const traceEvents = [];
  cdp.on('Tracing.dataCollected', (ev) => traceEvents.push(...ev.value));
  const traceDone = new Promise((res) => cdp.once('Tracing.tracingComplete', res));
  await cdp.send('Tracing.start', {
    categories: 'disabled-by-default-devtools.timeline,devtools.timeline,disabled-by-default-devtools.timeline.frame,cc,gpu',
    transferMode: 'ReportEvents',
  });
  const tStart = Date.now();
  let turnsStart = null, turnsEnd = null, games = 1;
  if (play) turnsStart = await page.evaluate(() => window.__lotAndRoll.getState().turn);
  while (Date.now() - tStart < seconds * 1000) {
    await page.waitForTimeout(1000);
    if (play) {
      const k = await page.evaluate(() => window.__lotAndRoll.getState()?.phase.kind);
      if (k === 'gameOver') {
        games++;
        await page.evaluate((n) => window.__lotAndRoll.startGame(window.__lotAndRoll.demoSettings(4, true), 20260929 + n), games);
      }
    }
  }
  const windowSec = (Date.now() - tStart) / 1000;
  await cdp.send('Tracing.end');
  await traceDone;
  if (play) turnsEnd = await page.evaluate(() => window.__lotAndRoll.getState()?.turn ?? null);

  // --- counters after
  const perfAfter = await getMetrics(cdp);
  const domAfter = await cdp.send('Memory.getDOMCounters');
  const heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null).catch(() => null);
  const svgAfter = await page.evaluate(svgProbe);

  // --- layer report (peak snapshot + over-time stats)
  await cdp.send('LayerTree.disable').catch(() => {});
  while (pumping || queue.length) await new Promise((r) => setTimeout(r, 20));
  const final = layers;
  const snap = peak.layers.length ? peak.layers : final; // layer set at peak memory
  const drawing = snap.filter((l) => l.drawsContent);
  const counts = samples.map((s) => s.count);
  const mems = samples.map((s) => s.mem);
  const withTransform = snap.filter((l) => l.transform && !isIdentity(l.transform));
  const top = [...snap].sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 10);
  const reasonCount = {};
  let willChange = 0, transformReason = 0, animReason = 0;
  for (const l of snap) {
    const ids = info.get(l.layerId)?.reasons || [];
    for (const id of ids) reasonCount[id] = (reasonCount[id] || 0) + 1;
    if (ids.some((x) => /willChange/i.test(x))) willChange++;
    if (ids.some((x) => /3DTransform|willChangeTransform|ActiveTransformAnimation/i.test(x))) transformReason++;
    if (ids.some((x) => /Animation/i.test(x))) animReason++;
  }
  const topDescribed = top.map((l) => ({
    layerId: l.layerId,
    node: info.get(l.layerId)?.node ?? null,
    w: l.width,
    h: l.height,
    mb: r2((l.width * l.height * 4) / 1048576),
    deviceMB: r2((l.width * l.height * 4 * CFG.dpr * CFG.dpr) / 1048576),
    drawsContent: !!l.drawsContent,
    paints: paintCounts.get(l.layerId) || 0,
    hasTransform: !!(l.transform && !isIdentity(l.transform)),
    reasons: (info.get(l.layerId)?.reasons || []).slice(0, 4),
  }));
  // which layers churn (repaint) the most, over the whole window (includes layers gone by the end)
  const topPainted = [...paintCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id, n]) => {
    const i = info.get(id);
    return { layerId: id, node: i?.node ?? null, paints: n, w: i?.w ?? null, h: i?.h ?? null, reasons: (i?.reasons || []).slice(0, 3) };
  });
  // repaint totals grouped by node description (many layers share a node type)
  const paintsByNode = {};
  for (const [id, n] of paintCounts) { const k = info.get(id)?.node ?? '(unknown/removed)'; paintsByNode[k] = (paintsByNode[k] || 0) + n; }

  const trace = analyzeTrace(traceEvents, windowSec);
  const layerReport = {
    samples: samples.length,
    layerTreeChangedEvents: layerEvents,
    layerPaintedEvents: paintedEvents,
    count: { min: Math.min(...counts, final.length), median: median(counts) || final.length, max: Math.max(...counts, final.length), final: final.length },
    memoryMB: {
      min: r2(Math.min(...mems, memOf(final)) / 1048576),
      median: r2((median(mems) || memOf(final)) / 1048576),
      max: r2(Math.max(...mems, memOf(final)) / 1048576),
      final: r2(memOf(final) / 1048576),
      note: 'sum(width*height*4) of drawsContent layers, in the pixel units CDP reports (DPR-scaled if width matches viewport*DPR)',
    },
    rootLayerSize: snap.length ? [Math.max(...snap.map((l) => l.width)), Math.max(...snap.map((l) => l.height))] : null,
    snapshot: 'layer set at peak layer memory',
    peakCount: snap.length,
    peakDrawing: drawing.length,
    peakDeviceMemoryMB: r2((drawing.reduce((a, l) => a + l.width * l.height * 4, 0) * CFG.dpr * CFG.dpr) / 1048576),
    withTransform: withTransform.length,
    willChange,
    transformOrAnimationPromoted: { transformReasons: transformReason, animationReasons: animReason },
    compositingReasons: Object.fromEntries(Object.entries(reasonCount).sort((a, b) => b[1] - a[1])),
    top10BySize: topDescribed,
    top12MostRepainted: topPainted,
    paintsByNode: Object.fromEntries(Object.entries(paintsByNode).sort((a, b) => b[1] - a[1]).slice(0, 15)),
  };
  const delta = (k) => r2((perfAfter[k] ?? 0) - (perfBefore[k] ?? 0));
  const counters = {
    before: { ...pick(perfBefore), domCounters: domBefore, jsHeapMB: mb(heapBefore) },
    after: { ...pick(perfAfter), domCounters: domAfter, jsHeapMB: mb(heapAfter) },
    delta: {
      LayoutCount: delta('LayoutCount'),
      RecalcStyleCount: delta('RecalcStyleCount'),
      LayoutDurationMs: r1(delta('LayoutDuration') * 1000),
      RecalcStyleDurationMs: r1(delta('RecalcStyleDuration') * 1000),
      ScriptDurationMs: r1(delta('ScriptDuration') * 1000),
      TaskDurationMs: r1(delta('TaskDuration') * 1000),
      layoutPerSec: r2(delta('LayoutCount') / windowSec),
      recalcStylePerSec: r2(delta('RecalcStyleCount') / windowSec),
    },
  };
  await ctx.close();
  return {
    name, url, windowSec: r1(windowSec), throttle: CFG.throttle, dpr: CFG.dpr,
    play: play ? { turnsStart, turnsEnd, gamesStarted: games } : undefined,
    layers: layerReport,
    trace,
    svg: { atEnd: svgAfter, atStart: { svgElements: svgBefore.svgElements, svgChildElements: svgBefore.svgChildElements, domElements: svgBefore.domElements } },
    counters,
    consoleErrors,
  };
}

const isIdentity = (m) => !Array.isArray(m) || m.length !== 16 || m.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-9);
const mb = (b) => (b == null ? null : r2(b / 1048576));
const pick = (m) => ({
  LayoutCount: m.LayoutCount, RecalcStyleCount: m.RecalcStyleCount,
  LayoutDurationMs: r1((m.LayoutDuration ?? 0) * 1000), RecalcStyleDurationMs: r1((m.RecalcStyleDuration ?? 0) * 1000),
  JSHeapUsedMB: mb(m.JSHeapUsedSize), JSHeapTotalMB: mb(m.JSHeapTotalSize), Nodes: m.Nodes, Documents: m.Documents, JSEventListeners: m.JSEventListeners,
});
async function getMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

// ---------------------------------------------------------------------------------------------
// printing
function printTable(res) {
  const out = [];
  const P = (s = '') => out.push(s);
  for (const s of res.scenarios) {
    P(`\n=== ${s.name.toUpperCase()}  (${s.windowSec}s, cpu x${s.throttle}, dpr ${s.dpr}${s.play ? `, turns ${s.play.turnsStart}->${s.play.turnsEnd}, games ${s.play.gamesStarted}` : ''}) ===`);
    const L = s.layers;
    P(`Layers: count min/median/max = ${L.count.min}/${L.count.median}/${L.count.max} (final ${L.count.final}; peak snapshot ${L.peakCount}, drawing ${L.peakDrawing})  root ${L.rootLayerSize?.join('x')}`);
    P(`Layer memory MB (CSS px, w*h*4) min/median/max = ${L.memoryMB.min}/${L.memoryMB.median}/${L.memoryMB.max}; peak at device px (x${s.dpr}^2) = ${L.peakDeviceMemoryMB}MB\n  peak snapshot: with transform: ${L.withTransform}   will-change: ${L.willChange}   anim/3D/wc-transform reasons: ${L.transformOrAnimationPromoted.animationReasons}/${L.transformOrAnimationPromoted.transformReasons}`);
    P(`layerPainted events ${L.layerPaintedEvents}, layerTreeDidChange ${L.layerTreeChangedEvents}`);
    P(`Compositing reasons: ${Object.entries(L.compositingReasons).map(([k, v]) => `${k}:${v}`).join(', ') || '-'}`);
    P('Top 10 layers by size (peak snapshot):');
    for (const t of L.top10BySize) P(`  ${String(t.w).padStart(5)}x${String(t.h).padEnd(5)} ${String(t.mb).padStart(6)}MB(${String(t.deviceMB).padStart(6)} dev) draws=${t.drawsContent ? 'y' : 'n'} paints=${String(t.paints).padStart(4)} xf=${t.hasTransform ? 'y' : 'n'}  ${t.node}  [${t.reasons.join(',')}]`);
    P('Most repainted layers:');
    for (const t of L.top12MostRepainted.slice(0, 8)) P(`  paints=${String(t.paints).padStart(4)} ${t.w}x${t.h}  ${t.node}  [${t.reasons.join(',')}]`);
    P(`Paints by node: ${Object.entries(L.paintsByNode).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(' | ')}`);
    P(`Trace: ${s.trace.frames} frames (${s.trace.framesPerSec}/s), ${s.trace.totalTraceEvents} events`);
    P('  event              count   /sec  ms/sec   /frame  ms/frame   max ms   total ms');
    for (const [k, v] of Object.entries(s.trace.events)) {
      if (!v.count) continue;
      P(`  ${k.padEnd(18)} ${String(v.count).padStart(6)} ${String(v.perSec).padStart(6)} ${String(v.msPerSec).padStart(7)} ${String(v.perFrame ?? '-').padStart(8)} ${String(v.msPerFrame ?? '-').padStart(9)} ${String(v.maxMs).padStart(8)} ${String(v.totalMs).padStart(10)}`);
    }
    for (const [k, v] of Object.entries(s.trace.slowest || {})) P(`  slowest ${k}: ${v.slice(0, 4).map((x) => `${x.ms}ms@${x.atSec}s${x.dirty != null ? ` dirty=${x.dirty}/${x.total}` : ''}${x.fn ? ` ${x.fn} ${x.url}:${x.line}` : ''}`).join(' | ')}`);
    const e = s.svg.atEnd;
    P(`SVG: ${e.svgElements} <svg> (${e.svgTopLevel} top-level), ${e.svgChildElements} svg children, ${e.domElements} DOM elements, ${e.distinctIcons} distinct icons`);
    for (const g of e.iconGroups.slice(0, 8)) P(`  x${String(g.count).padStart(3)} (${g.children} children)  ${g.key.slice(0, 70)}`);
    P('Effects (elements with computed value):');
    for (const [k, v] of Object.entries(e.effects)) {
      P(`  ${k.padEnd(16)} ${String(v.total).padStart(5)}   ${v.top.slice(0, 4).map((t) => `${t.selector} x${t.count}`).join(' | ')}`);
    }
    const c = s.counters;
    P(`Counters before -> after: Layout ${c.before.LayoutCount}->${c.after.LayoutCount} (${c.delta.layoutPerSec}/s, ${c.delta.LayoutDurationMs}ms), RecalcStyle ${c.before.RecalcStyleCount}->${c.after.RecalcStyleCount} (${c.delta.recalcStylePerSec}/s, ${c.delta.RecalcStyleDurationMs}ms), script ${c.delta.ScriptDurationMs}ms, task ${c.delta.TaskDurationMs}ms`);
    P(`  JSHeapUsed MB ${c.before.JSHeapUsedMB}->${c.after.JSHeapUsedMB}; DOM counters nodes ${c.before.domCounters.nodes}->${c.after.domCounters.nodes}, listeners ${c.before.domCounters.jsEventListeners}->${c.after.domCounters.jsEventListeners}, documents ${c.before.domCounters.documents}->${c.after.domCounters.documents}`);
    if (s.consoleErrors.length) P(`Page errors: ${s.consoleErrors.join(' | ')}`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------
let exitCode = 0;
try {
  const browser = await launchChromium();
  const version = browser.version();
  const scenarios = [];
  if (CFG.scenarios.includes('title')) scenarios.push(await runScenario(browser, 'title', `${base}/?dev=1`, CFG.titleSeconds, false));
  if (CFG.scenarios.includes('play')) scenarios.push(await runScenario(browser, 'play', `${base}/?dev=1#game`, CFG.seconds, true));
  await browser.close();
  const result = {
    generatedAt: new Date().toISOString(),
    chromium: version,
    config: { base, seconds: CFG.seconds, titleSeconds: CFG.titleSeconds, throttle: CFG.throttle, dpr: CFG.dpr, viewport: [CFG.width, CFG.height] },
    scenarios,
  };
  mkdirSync(dirname(CFG.out), { recursive: true });
  writeFileSync(CFG.out, JSON.stringify(result, null, 1));
  if (!CFG.quiet) console.log(printTable(result));
  console.log('\n--- JSON (compact) ---');
  console.log(JSON.stringify(result));
  log(`\nwrote ${CFG.out}`);
} catch (e) {
  console.error(e);
  exitCode = 1;
}
process.exit(exitCode);
