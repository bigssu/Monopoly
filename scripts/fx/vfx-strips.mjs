/**
 * VFX filmstrips: renders preset scenarios of the demo page (vfx-demo.html, src/ui/fx/vfx/demo.ts)
 * with the manual clock, one thumbnail every 2 ticks (= 2 FX frames, 67 ms; hit-stop ticks show the
 * same FX frame), and writes one PNG per scenario to docs/assets/vfx-strips/.
 *
 *   node scripts/fx/vfx-strips.mjs [scenario …] [--out dir] [--every 2] [--cols 8]
 *
 * Starts its own Vite dev server. PLAYWRIGHT_MODULE / CHROMIUM_PATH as in scripts/perf.mjs.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  if (i < 0) return d;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const OUT = resolve(opt('--out', 'docs/assets/vfx-strips'));
const EVERY = +opt('--every', '2');
const COLS = +opt('--cols', '6');
const THUMB = +opt('--thumb', '380');
const PORT = +opt('--port', '5188');
const DEFAULT = [
  ['build1', 30],
  ['build2', 32],
  ['build3', 42],
  ['build4', 64],
  ['build4N', 64],
  ['tollM', 44],
  ['tollXL', 50],
  ['takeover', 56],
  ['group', 54],
  ['groupFinale', 40],
  ['plot650', 34],
  ['free3', 36],
  ['passStartLanded', 40],
  ['victoryHubs', 70],
];
const list = args.length ? args.map((a) => [a.split(':')[0], +(a.split(':')[1] || 60)]) : DEFAULT;

async function loadChromium() {
  const c = [process.env.PLAYWRIGHT_MODULE, '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const m of c) if (existsSync(m)) return (await import(pathToFileURL(m).href)).chromium;
  return (await import('playwright')).chromium;
}

const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((ok, fail) => {
  const t = setTimeout(() => fail(new Error('vite did not start')), 30000);
  vite.stdout.on('data', (d) => {
    if (String(d).includes('Local')) {
      clearTimeout(t);
      ok();
    }
  });
});

const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`http://localhost:${PORT}/vfx-demo.html`);
  await page.waitForFunction(() => window.__vfxDemo);
  await page.evaluate(() => window.__vfxDemo.fx.preload());
  await page.evaluate(() => document.querySelector('.vd-ui').style.display = 'none');
  const composer = await browser.newPage();
  mkdirSync(OUT, { recursive: true });
  for (const [name, ticks] of list) {
    if (process.env.DEBUG) console.log('scenario', name);
    await page.evaluate(() => {
      const d = window.__vfxDemo;
      d.reset();
      d.manual(true);
    });
    await page.evaluate((n) => void window.__vfxDemo.run(n), name);
    // Let the atlas promise settle and the effect arm, then run tick 1 (FX frame 0).
    await page.waitForTimeout(30);
    const f0 = await page.evaluate(() => window.__vfxDemo.stats().frame);
    await page.evaluate(() => window.__vfxDemo.step(1));
    const region = await page.evaluate(() => {
      const s = window.__vfxDemo.stats();
      const b = window.__vfxDemo.rects().board;
      return s.canvas && !s.canvas.hidden ? s.canvas : { x: b.x, y: b.y, w: b.width, h: b.height };
    });
    const m = 12;
    const clip = {
      x: Math.max(0, region.x - m),
      y: Math.max(0, region.y - m),
      width: Math.min(1600 - Math.max(0, region.x - m), region.w + 2 * m),
      height: Math.min(1000 - Math.max(0, region.y - m), region.h + 2 * m),
    };
    const shots = [];
    let tick = 1;
    for (;;) {
      const st = await page.evaluate(() => window.__vfxDemo.stats());
      const buf = await page.screenshot({ clip, type: 'png' });
      shots.push({ img: buf.toString('base64'), label: `t${tick} f${st.frame - f0 - 1} n${st.live}` });
      if (tick >= ticks || (!st.ticking && tick > 3)) break;
      await page.evaluate((n) => window.__vfxDemo.step(n), EVERY);
      tick += EVERY;
    }
    const peak = await page.evaluate(() => window.__vfxDemo.stats().peak);
    const log = await page.evaluate(() => window.__vfxDemo.log.slice(0, 40).join(' · '));
    const png = await composer.evaluate(
      async ({ shots, cols, thumb, clip, title }) => {
        const tw = thumb;
        const th = Math.round((clip.height / clip.width) * tw);
        const rows = Math.ceil(shots.length / cols);
        const c = document.createElement('canvas');
        c.width = cols * tw;
        c.height = rows * (th + 16) + 26;
        const g = c.getContext('2d');
        g.fillStyle = '#0E141C';
        g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#E8EDF5';
        g.font = 'bold 15px sans-serif';
        g.fillText(title, 6, 18);
        for (let i = 0; i < shots.length; i++) {
          const img = new Image();
          img.src = `data:image/png;base64,${shots[i].img}`;
          await img.decode();
          const x = (i % cols) * tw;
          const y = 26 + Math.floor(i / cols) * (th + 16);
          g.drawImage(img, x, y, tw - 2, th);
          g.fillStyle = '#9FB0C8';
          g.font = '11px monospace';
          g.fillText(shots[i].label, x + 3, y + th + 12);
        }
        return c.toDataURL('image/png').split(',')[1];
      },
      { shots, cols: Math.min(COLS, shots.length), thumb: THUMB, clip, title: `${name} — every ${EVERY} ticks (t = tick, f = FX frame, n = live particles), peak ${peak}` },
    );
    const file = resolve(OUT, `${name}.png`);
    writeFileSync(file, Buffer.from(png, 'base64'));
    console.log(`${name}: ${shots.length} frames, peak ${peak} → ${file}`);
    console.log(`  log: ${log}`);
  }
} finally {
  await browser.close();
  vite.kill();
}
