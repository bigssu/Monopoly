// Generates every Android launcher / splash asset and the Play listing graphics from the 1K launcher mark.
//   node scripts/gen-android-icons.mjs [--no-android] [--no-play] [--splash-only]
// Needs playwright + Chromium (same lookup as scripts/icon-sheet.mjs). Re-run after changing the mark,
// then commit android/app/src/main/res/** and docs/assets/*.png.
//
// Outputs
//   android/app/src/main/res/mipmap-*dpi/ic_launcher_foreground.png   adaptive foreground (108dp canvas, logo ~62%)
//   android/app/src/main/res/mipmap-*dpi/ic_launcher{,_round}.png      legacy launcher icons (pre-API 26)
//   android/app/src/main/res/drawable/ic_launcher_background.xml      adaptive background (radial felt gradient)
//   android/app/src/main/res/drawable-nodpi/splash_icon.png             shared 512px splash icon (50% safe-zone canvas)
//   android/app/src/main/res/drawable/splash.xml                        shared splash background + centered icon
//   docs/assets/play-icon-512.png, docs/assets/feature-graphic-1024x500.png
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = path.join(root, 'android', 'app', 'src', 'main', 'res');

const GOLD = '#F2B633';
const GOLD_HI = '#FFD968';
const FELT = '#1E2A3A'; // must match capacitor.config.ts / colors.xml (table_bg)
const FELT_HI = '#2B3C53';
const FELT_LO = '#111925';

const mark = path.join(root, 'docs', 'assets', 'launcher-mark-1024.png');
const markPng = fs.readFileSync(mark);
if (markPng.readUInt32BE(16) !== 1024 || markPng.readUInt32BE(20) !== 1024) throw new Error('launcher mark must be 1024x1024');
const logoData = `data:image/png;base64,${markPng.toString('base64')}`;

const DENS = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
const splashOnly = process.argv.includes('--splash-only');
const obsoleteSplashPaths = [
  'drawable/splash.png',
  ...DENS.flatMap((density) => [
    `drawable-${density}/splash_icon.png`,
    `drawable-land-${density}/splash.png`,
    `drawable-port-${density}/splash.png`,
  ]),
];

// ---------- browser ----------
const req = createRequire(import.meta.url);
let pw;
for (const p of ['/opt/node22/lib/node_modules/playwright', 'playwright', 'playwright-core']) {
  try { pw = req(p); break; } catch {}
}
if (!pw) throw new Error('playwright not found');
const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ deviceScaleFactor: 1 });

const logoBox = (px) => `<img alt="" src="${logoData}" style="width:${px}px;height:${px}px;display:block">`;
const wrap = (body, css = '') =>
  `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}` +
  `body{display:flex;align-items:center;justify-content:center;overflow:hidden}${css}</style>${body}`;

async function shot(html, w, h, { transparent = false, file = null } = {}) {
  await page.setViewportSize({ width: w, height: h });
  if (file) {
    await page.goto('file://' + file);
    await page.evaluate(() => document.fonts.ready);
  } else {
    await page.setContent(html);
  }
  return page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
}

// ---------- minimal PNG helper: drop the alpha channel (Play rejects alpha on the feature graphic; splash was RGB) ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function stripAlpha(png) {
  let off = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off), type = png.toString('ascii', off + 4, off + 8), d = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; if (d[8] !== 8 || d[12] !== 0) throw new Error('unsupported PNG'); }
    if (type === 'IDAT') idat.push(d);
    off += 12 + len;
  }
  if (ct !== 6) return png; // already RGB
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  const cur = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  const out = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    out[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) { out[y * (w * 3 + 1) + 1 + x * 3] = cur[x * 4]; out[y * (w * 3 + 1) + 2 + x * 3] = cur[x * 4 + 1]; out[y * (w * 3 + 1) + 3 + x * 3] = cur[x * 4 + 2]; }
    cur.copy(prev);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([png.subarray(0, 8), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(out, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const write = (file, buf) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf); console.log('wrote', path.relative(root, file), `(${buf.length} B)`); };

// ---------- renderers ----------
// dark felt behind the logo: the yellow swoosh disappears on a gold background
const iconBg = `radial-gradient(circle at 50% 40%, ${FELT_HI} 0%, ${FELT} 70%)`;
const foreground = (s) => shot(wrap(logoBox(s), `body{width:${s}px;height:${s}px}`), s, s, { transparent: true });
const legacy = (s, round) =>
  shot(
    wrap(logoBox(Math.round(s * 1.18)),
      `body{width:${s}px;height:${s}px;background:${iconBg};border-radius:${round ? '50%' : s * 0.2 + 'px'}}`),
    s, s, { transparent: true });
const splashIcon = () => shot(wrap(logoBox(256), 'body{width:512px;height:512px}'), 512, 512, { transparent: true });

function removeObsoleteSplashAssets() {
  for (const relative of obsoleteSplashPaths) {
    const file = path.resolve(res, relative);
    if (path.relative(res, file).startsWith('..') || path.basename(file) !== (relative.endsWith('splash.png') ? 'splash.png' : 'splash_icon.png')) {
      throw new Error(`refusing to remove unexpected splash asset: ${relative}`);
    }
    fs.rmSync(file, { force: true });
  }
}

function assertSplashSafeZone(png) {
  let off = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off), type = png.toString('ascii', off + 4, off + 8), d = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; }
    if (type === 'IDAT') idat.push(d);
    off += 12 + len;
  }
  if (w !== 512 || h !== 512 || ct !== 6) throw new Error('shared splash icon must be a 512px RGBA PNG');
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * 4, cur = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? cur[i - 4] : 0, b = prev[i], c = i >= 4 ? prev[i - 4] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) if (cur[x * 4 + 3] && Math.hypot(x + .5 - 256, y + .5 - 256) > 170.667) throw new Error('splash icon exceeds the Android 12 safe-zone circle');
    cur.copy(prev);
  }
}

// ---------- Android resources ----------
if (!process.argv.includes('--no-android')) {
  if (!fs.existsSync(res)) throw new Error('android/ missing - run `npx cap add android` first');
  if (!splashOnly) {
    const fg = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
    const lg = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
    for (const d of DENS) {
      write(path.join(res, `mipmap-${d}`, 'ic_launcher_foreground.png'), await foreground(fg[d]));
      write(path.join(res, `mipmap-${d}`, 'ic_launcher.png'), await legacy(lg[d], false));
      write(path.join(res, `mipmap-${d}`, 'ic_launcher_round.png'), await legacy(lg[d], true));
    }
    write(path.join(res, 'drawable', 'ic_launcher_background.xml'),
      Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <gradient
        android:type="radial"
        android:centerX="0.5"
        android:centerY="0.4"
        android:gradientRadius="70%p"
        android:startColor="${FELT_HI}"
        android:endColor="${FELT}" />
</shape>
`));
  }
  removeObsoleteSplashAssets();
  const sharedSplashIcon = await splashIcon();
  assertSplashSafeZone(sharedSplashIcon);
  write(path.join(res, 'drawable-nodpi', 'splash_icon.png'), sharedSplashIcon);
  write(path.join(res, 'drawable', 'splash.xml'), Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/table_bg" />
    <item android:width="288dp" android:height="288dp" android:gravity="center">
        <bitmap android:src="@drawable/splash_icon" android:gravity="fill" android:filter="true" />
    </item>
</layer-list>
`));
}

// ---------- Play listing graphics ----------
if (!splashOnly && !process.argv.includes('--no-play')) {
  const assets = path.join(root, 'docs', 'assets');
  // 512x512 full-bleed (Play applies its own rounded mask)
  write(path.join(assets, 'play-icon-512.png'),
    await shot(wrap(logoBox(604), `body{width:512px;height:512px;background:${iconBg}}`), 512, 512));

  const fonts = path.join(root, 'public', 'fonts', 'fonts.css');
  const tmp = path.join(os.tmpdir(), 'lotandroll-feature-graphic.html');
  fs.writeFileSync(tmp, `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="file://${fonts}">
<style>
html,body{margin:0}
body{width:1024px;height:500px;overflow:hidden;position:relative;font-family:'Jua','Noto Sans KR',sans-serif;
  background:radial-gradient(90% 120% at 28% 45%, ${FELT_HI} 0%, ${FELT} 50%, ${FELT_LO} 100%)}
.glow{position:absolute;left:-40px;top:20px;width:520px;height:520px;border-radius:50%;
  background:radial-gradient(circle, rgba(242,182,51,.30) 0%, rgba(242,182,51,0) 68%)}
.logo{position:absolute;left:20px;top:30px;width:440px;height:440px;filter:drop-shadow(0 14px 18px rgba(0,0,0,.45))}
.txt{position:absolute;left:452px;top:0;height:500px;width:540px;display:flex;flex-direction:column;justify-content:center}
h1{margin:0;font-weight:400;font-size:168px;line-height:1.05;letter-spacing:2px;color:${GOLD};
  background:linear-gradient(180deg, ${GOLD_HI} 0%, ${GOLD} 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
  filter:drop-shadow(0 6px 0 #B5841A) drop-shadow(0 10px 14px rgba(0,0,0,.4))}
.en{margin:6px 0 0 6px;font-size:56px;line-height:1;color:#F4F6FA;letter-spacing:1px}
.tag{margin:26px 0 0 6px;font-size:28px;line-height:1.25;color:#B9C4D6}
.bar{position:absolute;left:0;right:0;bottom:0;height:10px;background:linear-gradient(90deg, #EF5B5B, ${GOLD}, #5CC689, #4A6CF7)}
</style>
<div class="glow"></div>
<div class="logo">${logoBox(440)}</div>
<div class="txt"><h1>랏앤롤</h1><div class="en">Lot &amp; Roll</div><div class="tag">한 대의 태블릿, 네 명의 여행자<br>One tablet · 2–4 players</div></div>
<div class="bar"></div>`);
  const png = stripAlpha(await shot(null, 1024, 500, { file: tmp }));
  const ok = await page.evaluate(() => document.fonts.check("40px 'Jua'", '랏앤롤'));
  console.log('Jua loaded for Hangul:', ok);
  write(path.join(assets, 'feature-graphic-1024x500.png'), png);
}

await browser.close();
