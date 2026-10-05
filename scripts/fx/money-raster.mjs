/**
 * Money stage render tiers, measured (docs/MONEY-EVENTS.md §12.2): plays one toll cut-in in the real
 * game per tier and reads, while it is up, (1) the compositor layer tree (CDP LayerTree: bounds in
 * CSS px — what `npm run perf` sums as w × h × 4 × DPR²) and (2) Chromium's own picture-layer
 * snapshot from a trace (cc contents_scale = the raster scale actually used, tiles' GPU bytes), so a
 * scaled-down layer that Chromium re-rasterized at full resolution would show here.
 *
 *   npx vite build && node scripts/fx/money-raster.mjs [--viewport 1600x1000] [--dpr 2] [--tiers high,mid,low] [--m3d 1]
 */
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const [VW, VH] = String(arg('viewport', '1600x1000')).split('x').map(Number);
const DPR = Number(arg('dpr', 2));
const TIERS = String(arg('tiers', 'high,mid,low')).split(',');
const M3D = arg('m3d', null);
const PORT = Number(arg('port', 4185));

const pw = process.env.PLAYWRIGHT_MODULE ?? '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(pw).href);
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
process.on('exit', () => {
  try {
    process.kill(-server.pid);
  } catch {
    /* gone */
  }
});
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
  } catch {
    /* not yet */
  }
  await new Promise((r) => setTimeout(r, 250));
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined), args: ['--no-sandbox'] });

function pictureLayers(events) {
  const out = [];
  const seen = new Set();
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== 'object') return;
    if (o.bounds && o.raster_scales && o.layer_id !== undefined && !seen.has(o.layer_id)) {
      seen.add(o.layer_id);
      out.push({ id: o.layer_id, w: o.bounds.width, h: o.bounds.height, scale: o.raster_scales.contents_scale?.[0] ?? o.ideal_contents_scale, gpuMB: (o.gpu_memory_usage ?? 0) / 1048576 });
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(events);
  return out;
}

for (const tier of TIERS) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DPR });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto(`http://localhost:${PORT}/?dev=1&mres=${tier}${M3D ? `&m3d=${M3D}` : ''}`);
  await page.waitForFunction(() => window.__lotAndRoll && document.getElementById('app')?.dataset.screen === 'title', null, { timeout: 30000 });
  await page.evaluate(() => {
    const h = window.__lotAndRoll;
    h.setPromptTimer(0);
    h.startGame({ ...h.demoSettings(4, false), rules: 'easy' }, 7);
    const s = h.getState();
    s.current = 0;
    s.phase = { kind: 'preRoll', playerId: 0, rollAgain: false };
    s.players[0].position = 0;
    s.properties[4] = { owner: 2, level: 2 };
    s.testHooks = { diceQueue: [[1, 3]] };
    h.loadState(s);
  });
  await page.waitForSelector('.game .board');
  await page.evaluate(() => window.__lotAndRoll.whenIdle());
  await page.waitForTimeout(1500);
  let tree = [];
  let peakMB = 0;
  const dev = DPR * DPR;
  cdp.on('LayerTree.layerTreeDidChange', (e) => {
    if (!e.layers) return;
    const mb = e.layers.reduce((a, l) => a + (l.drawsContent ? l.width * l.height * 4 * dev : 0), 0) / 1048576;
    if (mb >= peakMB) {
      peakMB = mb;
      tree = e.layers.filter((l) => l.drawsContent);
    }
  });
  await cdp.send('DOM.getDocument', { depth: 0 });
  await cdp.send('LayerTree.enable');
  void page.evaluate(() => window.__lotAndRoll.dispatch({ type: 'Roll', playerId: 0 }));
  await page.waitForFunction(() => window.__lotAndRoll.money()?.live && window.__lotAndRoll.money().t > 900, null, { timeout: 30000 });
  // Picture-layer snapshot (raster scale) while the cut-in is up.
  const events = [];
  cdp.on('Tracing.dataCollected', (e) => events.push(...e.value));
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.start', { categories: 'disabled-by-default-devtools.timeline.layers,disabled-by-default-devtools.timeline.picture,disabled-by-default-cc.debug,devtools.timeline', transferMode: 'ReportEvents' });
  await page.waitForTimeout(700);
  await cdp.send('Tracing.end');
  await done;
  const info = await page.evaluate(() => window.__lotAndRoll.money());
  await page.evaluate(() => window.__lotAndRoll.whenIdle());
  const names = [];
  for (const l of [...tree].sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 8)) {
    let who = '?';
    if (l.backendNodeId) {
      const d = await cdp.send('DOM.describeNode', { backendNodeId: l.backendNodeId }).catch(() => null);
      if (d?.node) who = `${d.node.localName || d.node.nodeName}${(d.node.attributes ?? []).reduce((a, v, i, arr) => (arr[i - 1] === 'class' ? `${a}.${v.split(' ').join('.')}` : a), '')}`;
    }
    names.push(`${who} ${Math.round(l.width)}x${Math.round(l.height)} ${((l.width * l.height * 4 * dev) / 1048576).toFixed(1)}MB`);
  }
  const pics = pictureLayers(events).filter((p) => p.w * p.h > 20000).sort((a, b) => b.w * b.h - a.w * a.h);
  console.log(
    JSON.stringify({
      viewport: `${VW}x${VH}@${DPR}`,
      tier: `${info.tier} ×${info.scale} ${info.tilt ? '3D' : '2D'} (${info.source}, budget ${info.budgetMB} MB)`,
      cutInPeakMB: Math.round(peakMB * 10) / 10,
      layers: names,
      raster: pics.map((p) => `${p.w}x${p.h} @${p.scale} = ${Math.round(p.w * p.scale)}x${Math.round(p.h * p.scale)} px, tiles ${p.gpuMB.toFixed(1)} MB`),
    }),
  );
  await ctx.close();
}
await browser.close();
process.exit(0);
