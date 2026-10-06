#!/usr/bin/env node
/**
 * Money atlas baker (docs/MONEY-EVENTS.md §8, §10). `npm run fx:atlas` runs it after bake.mjs.
 *
 *   src/content/fx/sprites-money.ts MONEY_SPRITES → headless Chromium raster (DPR 2 · k)
 *   → alpha trim (fixed-box sprites keep their whole cell) → MaxRects pack (pad 2, ≤ 1024)
 *   → ONE WebP sheet public/fx/money.webp + public/fx/money.json
 *   + standalone repeatable tiles public/fx/money-tile-<name>.webp (sprites with `tile: true`)
 *   + src/content/fx/money-manifest.ts (typed names / files) + docs/assets/money-contact-sheet.png
 *
 * The money atlas is separate from the canvas-VFX atlases (atlas-color / atlas-mask): only the money
 * stage loads it. White (borrowed mask) sprites are tinted in the DOM with `mask-image`.
 * Flags: --no-sheet. Env: FX_QUALITY (0.9), FX_DPR (2), CHROMIUM_PATH.
 */
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { MaxRectsPacker } from 'maxrects-packer';
import { OUT_DIR, ROOT, launchChromium, loadSprites } from './common.mjs';

const args = new Set(process.argv.slice(2));
const QUALITY = Number(process.env.FX_QUALITY ?? 0.9);
const PAD = 2;
const MAX = 1024;
const ALPHA_MIN = 4;
const SHEET = resolve(ROOT, 'docs/assets/money-contact-sheet.png');

const { MONEY_SPRITES: SPRITES } = await loadSprites('src/content/fx/sprites-money.ts');
const DPR = Number(process.env.FX_DPR ?? 2);

const seen = new Set();
const frames = [];
for (const s of SPRITES) {
  if (seen.has(s.name)) throw new Error(`duplicate sprite ${s.name}`);
  seen.add(s.name);
  if (!/^[a-z0-9_]+$/.test(s.name)) throw new Error(`bad sprite name ${s.name}`);
  const scale = DPR * (s.k ?? 1);
  const sw = Math.ceil(s.w * scale);
  const sh = Math.ceil(s.h * scale);
  for (let i = 0; i < s.n; i++) {
    let svg = s.svg(i, s.n);
    if (!svg.includes(`viewBox="0 0 ${s.w} ${s.h}"`)) throw new Error(`${s.name}/${i}: viewBox must be 0 0 ${s.w} ${s.h}`);
    if (/<text|<tspan|font-family/.test(svg)) throw new Error(`${s.name}/${i}: text is forbidden in FX sprites`);
    svg = svg.replace('<svg ', `<svg width="${sw}" height="${sh}" `);
    frames.push({ key: `${s.name}/${i}`, name: s.name, svg, sw, sh, edgeOk: !!s.edgeOk, fixedBox: !!s.fixedBox, tile: !!s.tile && i === 0 });
  }
}

const b64of = (page, key, q) =>
  page.evaluate(
    async ({ key, q }) => {
      const blob = await new Promise((res) => window.__fx.get(key).toBlob(res, 'image/webp', q));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    },
    { key, q },
  );

const browser = await launchChromium();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.setContent('<!doctype html><meta charset=utf-8><body></body>');
  const boxes = await page.evaluate(
    async ({ list, alphaMin }) => {
      window.__fx = new Map();
      const out = {};
      for (const fr of list) {
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(fr.svg);
        await img.decode();
        const cv = document.createElement('canvas');
        cv.width = fr.sw;
        cv.height = fr.sh;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, fr.sw, fr.sh);
        const d = ctx.getImageData(0, 0, fr.sw, fr.sh).data;
        let x0 = fr.sw, y0 = fr.sh, x1 = -1, y1 = -1;
        for (let y = 0; y < fr.sh; y++) {
          for (let x = 0; x < fr.sw; x++) {
            if (d[(y * fr.sw + x) * 4 + 3] >= alphaMin) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        }
        window.__fx.set(fr.key, cv);
        out[fr.key] = x1 < 0 ? null : { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1, clip: x0 === 0 || y0 === 0 || x1 === fr.sw - 1 || y1 === fr.sh - 1 };
      }
      return out;
    },
    { list: frames, alphaMin: ALPHA_MIN },
  );
  const clipped = [];
  for (const fr of frames) {
    const b = boxes[fr.key];
    if (!b) throw new Error(`${fr.key}: frame is empty`);
    if (b.clip && !fr.edgeOk) clipped.push(fr.key);
    fr.box = fr.fixedBox ? { x0: 0, y0: 0, w: fr.sw, h: fr.sh } : b;
  }
  if (clipped.length) console.warn(`warn: ${clipped.length} frame(s) touch the sprite box edge (clipped?): ${clipped.join(', ')}`);

  // Shelf packing (tallest first) — the uniform coin cells line up in rows; prefer a 1024×512 sheet
  // (2 MB decoded), else MaxRects in 1024².
  const shelf = () => {
    const list = [...frames].sort((a, b) => b.box.h - a.box.h || b.box.w - a.box.w);
    const rects = [];
    let x = 0, y = 0, rowH = 0;
    for (const f of list) {
      if (x + f.box.w > MAX) {
        x = 0;
        y += rowH + PAD;
        rowH = 0;
      }
      rects.push({ x, y, width: f.box.w, height: f.box.h, data: f.key });
      x += f.box.w + PAD;
      rowH = Math.max(rowH, f.box.h);
    }
    return { bins: [{ rects }], height: y + rowH };
  };
  let packer = shelf();
  if (packer.height > MAX / 2 - PAD) {
    const p = new MaxRectsPacker(MAX, MAX, PAD, { smart: true, pot: false, square: false, allowRotation: false });
    p.addArray(frames.map((f) => ({ width: f.box.w, height: f.box.h, data: f.key })));
    if (p.bins.length !== 1) throw new Error(`money: does not fit one ${MAX}px atlas`);
    packer = p;
  }
  const placed = {};
  let aw = 0, ah = 0;
  for (const r of packer.bins[0].rects) {
    placed[r.data] = { x: r.x, y: r.y };
    aw = Math.max(aw, r.x + r.width);
    ah = Math.max(ah, r.y + r.height);
  }
  const pot = (v) => 2 ** Math.ceil(Math.log2(v));
  const W = pot(aw + PAD);
  const H = pot(ah + PAD);
  const items = frames.map((f) => ({ key: f.key, sx: f.box.x0, sy: f.box.y0, w: f.box.w, h: f.box.h, x: placed[f.key].x, y: placed[f.key].y }));
  const sheetB64 = await page.evaluate(
    async ({ items, w, h, q }) => {
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d');
      for (const it of items) ctx.drawImage(window.__fx.get(it.key), it.sx, it.sy, it.w, it.h, it.x, it.y, it.w, it.h);
      window.__fx.set('__sheet', cv);
      const blob = await new Promise((res) => cv.toBlob(res, 'image/webp', q));
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    },
    { items, w: W, h: H, q: QUALITY },
  );
  const sheet = Buffer.from(sheetB64, 'base64');
  if (sheet.subarray(8, 12).toString('latin1') !== 'WEBP') throw new Error('money: Chromium did not produce WebP');

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, 'money.webp'), sheet);
  const tiles = {};
  for (const fr of frames.filter((f) => f.tile)) {
    const buf = Buffer.from(await b64of(page, fr.key, QUALITY), 'base64');
    const file = `money-tile-${fr.name}.webp`;
    writeFileSync(resolve(OUT_DIR, file), buf);
    tiles[fr.name] = { file, w: fr.sw, h: fr.sh, bytes: buf.length };
  }
  const jsonFrames = {};
  const anims = {};
  for (const s of SPRITES) {
    const keys = [];
    for (let i = 0; i < s.n; i++) {
      const key = `${s.name}/${i}`;
      const fr = frames.find((f) => f.key === key);
      jsonFrames[key] = { x: placed[key].x, y: placed[key].y, w: fr.box.w, h: fr.box.h, ox: fr.box.x0, oy: fr.box.y0, sw: fr.sw, sh: fr.sh };
      keys.push(key);
    }
    anims[s.name] = { n: s.n, frames: keys, fps: s.fps, loop: s.loop, w: s.w, h: s.h, k: s.k ?? 1, scale: DPR * (s.k ?? 1), fixedBox: !!s.fixedBox };
  }
  const atlas = { file: 'money.webp', w: W, h: H, bytes: sheet.length };
  const lines = ['{', `"v":1,"dpr":${DPR},`, `"atlas":${JSON.stringify(atlas)},`, `"tiles":${JSON.stringify(tiles)},`, '"anims":{'];
  lines.push(Object.entries(anims).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n'), '},', '"frames":{');
  lines.push(Object.entries(jsonFrames).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n'), '}', '}');
  writeFileSync(resolve(OUT_DIR, 'money.json'), lines.join('\n') + '\n');

  const names = SPRITES.map((s) => s.name);
  const manifest =
    `// GENERATED by scripts/fx/bake-money.mjs (npm run fx:atlas) - do not edit.\n` +
    `// Source of truth: MONEY_SPRITES in src/content/fx/sprites-money.ts.\n\n` +
    `export const MONEY_ANIM_NAMES = [\n${names.map((n) => `  '${n}',`).join('\n')}\n] as const;\n\n` +
    `export type MoneyAnimName = (typeof MONEY_ANIM_NAMES)[number];\n\n` +
    `/** Paths relative to the app base (public/fx/*). Loaded only by the money stage. */\n` +
    `export const MONEY_FILES = { json: 'fx/money.json', atlas: 'fx/money.webp' } as const;\n\n` +
    `export const MONEY_FRAME_TOTAL = ${frames.length};\n\n` +
    `/** Nominal size (CSS px at scale 1), frame count, fps, bake shrink, whole-cell frames. */\n` +
    `export const MONEY_ANIMS: Record<MoneyAnimName, { n: number; fps: number; w: number; h: number; k: number; fixedBox: boolean }> = {\n` +
    SPRITES.map((s) => `  ${s.name}: { n: ${s.n}, fps: ${s.fps}, w: ${s.w}, h: ${s.h}, k: ${s.k ?? 1}, fixedBox: ${!!s.fixedBox} },`).join('\n') +
    `\n};\n\n` +
    `/** Standalone repeatable tiles (wallet coin columns): name -> path and raster size. */\n` +
    `export const MONEY_TILES: Record<string, { file: string; w: number; h: number }> = {\n` +
    Object.entries(tiles).map(([n, t]) => `  ${n}: { file: 'fx/${t.file}', w: ${t.w}, h: ${t.h} },`).join('\n') +
    `\n};\n`;
  writeFileSync(resolve(ROOT, 'src/content/fx/money-manifest.ts'), manifest);

  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  const jsonBytes = statSync(resolve(OUT_DIR, 'money.json')).size;
  const tileBytes = Object.values(tiles).reduce((s, t) => s + t.bytes, 0);
  const used = frames.reduce((s, f) => s + f.box.w * f.box.h, 0);
  console.log(`money atlas: ${SPRITES.length} animations, ${frames.length} frames, DPR ${DPR}, q${QUALITY}`);
  console.log(`  money.webp  ${W}x${H}  ${kb(sheet.length)}  fill ${((used / (W * H)) * 100).toFixed(0)}%`);
  console.log(`  money.json  ${kb(jsonBytes)} · tiles ${Object.keys(tiles).length} files ${kb(tileBytes)}`);
  console.log(`  total ${kb(sheet.length + jsonBytes + tileBytes)}`);

  if (!args.has('--no-sheet')) {
    // Contact sheet: every animation on dark and light, plus wallet columns built from the tiles.
    const png = await page.evaluate(
      async ({ anims, frames, tiles, tileData }) => {
        const src = window.__fx.get('__sheet');
        const W = 1600;
        const rowH = (a) => Math.min(160, a.h * 1.6) + 26;
        const names = Object.keys(anims);
        const total = names.reduce((s, n) => s + rowH(anims[n]), 0) + 260;
        const c = document.createElement('canvas');
        c.width = W;
        c.height = total;
        const g = c.getContext('2d');
        g.fillStyle = '#1E2233';
        g.fillRect(0, 0, W, total);
        g.fillStyle = '#F4F1E8';
        g.fillRect(W / 2, 0, W / 2, total);
        let y = 8;
        for (const n of names) {
          const a = anims[n];
          const k = Math.min(1.6, 160 / a.h);
          g.fillStyle = '#9FB0C8';
          g.font = '12px monospace';
          g.fillText(`${n} ×${a.n} (${a.w}×${a.h}, k ${a.k})`, 6, y + 12);
          for (const half of [0, 1]) {
            let x = half * (W / 2) + 6;
            for (let i = 0; i < a.n; i++) {
              const f = frames[`${n}/${i}`];
              const dw = (f.w / a.scale) * k;
              const dh = (f.h / a.scale) * k;
              g.drawImage(src, f.x, f.y, f.w, f.h, x + (f.ox / a.scale) * k, y + 18 + (f.oy / a.scale) * k, dw, dh);
              x += a.w * k + 6;
              if (x > (half + 1) * (W / 2) - a.w * k) break;
            }
          }
          y += rowH(a);
        }
        // Columns from the tiles (1, 5, 15 coins).
        let x = 10;
        for (const m of ['gold', 'silver', 'bronze']) {
          const img = new Image();
          img.src = tileData[m];
          await img.decode();
          const t = tiles[`coin_slice_${m}`];
          for (const nCoins of [1, 5, 15]) {
            for (let i = 0; i < nCoins; i++) g.drawImage(img, x, y + 220 - (i + 1) * (t.h / 2) * 1.2, (t.w / 2) * 1.2, (t.h / 2) * 1.2);
            const top = anims[`coin_top_${m}`];
            const f = frames[`coin_top_${m}/0`];
            g.drawImage(src, f.x, f.y, f.w, f.h, x, y + 220 - nCoins * (t.h / 2) * 1.2 - (f.h / top.scale) * 0.6, (f.w / top.scale) * 1.2, (f.h / top.scale) * 1.2);
            x += 70;
          }
          x += 30;
        }
        return c.toDataURL('image/png').split(',')[1];
      },
      {
        anims,
        frames: jsonFrames,
        tiles,
        tileData: Object.fromEntries(
          ['gold', 'silver', 'bronze'].map((m) => [m, 'data:image/webp;base64,' + readFileSync(resolve(OUT_DIR, tiles[`coin_slice_${m}`].file)).toString('base64')]),
        ),
      },
    ).catch((e) => (console.warn('contact sheet failed:', e.message), null));
    if (png) {
      writeFileSync(SHEET, Buffer.from(png, 'base64'));
      console.log(`  contact sheet -> ${SHEET}`);
    }
  }
} finally {
  await browser.close();
}
