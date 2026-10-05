/**
 * Money-stage filmstrips: runs scenes of the demo page (money-demo.html, src/ui/fx/money/demo.ts)
 * on the manual clock and writes one PNG per scenario × seat × viewport to docs/assets/money-strips/
 * (one thumbnail every 2 ticks = 2 frames at 30 fps; label = scene frame, coins in flight).
 * JPEG by default (`--format png` for lossless; ~2.4 MB per strip as PNG).
 *
 *   node scripts/fx/money-strips.mjs                       # the default set
 *   node scripts/fx/money-strips.mjs toll@E@800x450 build4 # scenario[@seat[@WxH]]
 *   options: --out dir  --every 2  --cols 6  --thumb 420  --port 5189  --max 150
 *
 * Starts its own Vite dev server. Playwright: PLAYWRIGHT_MODULE (default the global install),
 * Chromium: CHROMIUM_PATH (default /opt/pw-browsers/chromium), run with --no-sandbox.
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
const OUT = resolve(opt('--out', 'docs/assets/money-strips'));
const EVERY = +opt('--every', '2');
const COLS = +opt('--cols', '8');
const THUMB = +opt('--thumb', '320');
/** jpg (default, ~10× smaller for these dark full-screen frames) or png. */
const FORMAT = opt('--format', 'jpg');
const PORT = +opt('--port', '5189');
const MAX = +opt('--max', '150');
/** Also save these ticks as full-size PNGs (review): --full 12,30,50 */
const FULL = new Set(String(opt('--full', '')).split(',').filter(Boolean).map(Number));

const ALL = ['purchase', 'build1', 'build2', 'build3', 'build4', 'toll', 'tollFestival', 'takeover', 'collect', 'collectXL', 'payAll', 'salary', 'potBonus', 'tax', 'donation', 'bail', 'bankruptcy', 'fromBank'];
const DEFAULT = [
  ...ALL.map((n) => `${n}@S@1600x1000`),
  ...['toll', 'purchase', 'build4', 'collectXL'].flatMap((n) => ['E', 'N', 'W'].map((s) => `${n}@${s}@1600x1000`)),
  ...['toll', 'purchase', 'build3', 'collect', 'salary', 'tax'].flatMap((n) => ['S', 'E'].map((s) => `${n}@${s}@800x450`)),
];
const list = (args.length ? args : DEFAULT).map((a) => {
  const [name, seat = 'S', vp = '1600x1000'] = a.split('@');
  const [w, h] = vp.split('x').map(Number);
  return { name, seat, w, h };
});

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
  const composer = await browser.newPage();
  mkdirSync(OUT, { recursive: true });
  let page = null;
  let vp = '';
  for (const { name, seat, w, h } of list) {
    if (`${w}x${h}` !== vp) {
      await page?.close();
      page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      page.on('pageerror', (e) => console.error('pageerror', e.message));
      page.on('console', (m) => m.type() === 'error' && console.error('console', m.text()));
      await page.goto(`http://localhost:${PORT}/money-demo.html`);
      await page.waitForFunction(() => window.__moneyDemo);
      await page.evaluate(() => window.__moneyDemo.preload());
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.__moneyDemo.ui(false));
      vp = `${w}x${h}`;
    }
    await page.evaluate(() => {
      const d = window.__moneyDemo;
      d.manual(false);
      d.reset();
      d.manual(true);
    });
    await page.evaluate(({ name, seat }) => void window.__moneyDemo.run(name, seat), { name, seat });
    await page.waitForTimeout(20);
    const shots = [];
    let tick = 0;
    for (;;) {
      await page.evaluate((n) => window.__moneyDemo.step(n), tick === 0 ? 1 : EVERY);
      tick += tick === 0 ? 1 : EVERY;
      const st = await page.evaluate(() => window.__moneyDemo.stats());
      const buf = await page.screenshot({ type: 'png' });
      if (FULL.has(tick)) writeFileSync(resolve(OUT, `${name}-${seat}-${w}x${h}-t${tick}.png`), buf);
      shots.push({ img: buf.toString('base64'), label: `f${st.frame} c${st.flying}` });
      if (tick >= MAX || (!st.live && tick > 3)) break;
    }
    const stats = await page.evaluate(() => window.__moneyDemo.stats());
    const png = await composer.evaluate(
      async ({ fmt, shots, cols, thumb, w, h, title }) => {
        const k = thumb / w;
        const tw = Math.round(w * k);
        const th = Math.round(h * k);
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
        return c.toDataURL(fmt === 'png' ? 'image/png' : 'image/jpeg', 0.82).split(',')[1];
      },
      { fmt: FORMAT, shots, cols: Math.min(COLS, shots.length), thumb: Math.min(THUMB, w), w, h, title: `${name} @${seat} ${w}x${h} — every ${EVERY} ticks (f = scene frame, c = coins in flight), peak ${stats.peakFlying} coins / ${stats.peakNodes} nodes` },
    );
    const file = resolve(OUT, `${name}-${seat}-${w}x${h}.${FORMAT === 'png' ? 'png' : 'jpg'}`);
    writeFileSync(file, Buffer.from(png, 'base64'));
    console.log(`${name}@${seat} ${w}x${h}: ${shots.length} shots, ${tick} ticks, peak ${stats.peakFlying} → ${file}`);
  }
} finally {
  await browser.close();
  vite.kill();
}
