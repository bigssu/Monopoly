#!/usr/bin/env node
/**
 * FX sprite atlas baker.  `npm run fx:atlas`
 *
 *   src/content/fx/sprites*.ts  ->  headless Chromium raster (DPR 2) -> alpha trim -> MaxRects pack (pad 2, no rot, <=1024)
 *   -> canvas.toBlob WebP q0.9 (no native deps)  ->  public/fx/atlas-color.webp, atlas-mask.webp, atlas.json
 *   + src/content/fx/manifest.ts (typed animation table)  + docs/assets/fx-contact-sheet.png
 *
 * Flags:  --no-sheet   skip the contact sheet
 *         FX_QUALITY=0.9 (webp quality), FX_DPR=2 (override baked DPR), CHROMIUM_PATH / PLAYWRIGHT_MODULE as perf.mjs.
 */
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { MaxRectsPacker } from 'maxrects-packer';
import { OUT_DIR, ROOT, launchChromium, loadSprites } from './common.mjs';

const args = new Set(process.argv.slice(2));
const QUALITY = Number(process.env.FX_QUALITY ?? 0.9);
const PAD = 2;
const MAX = 1024;
const ALPHA_MIN = 4; // trim threshold (0..255)

const { SPRITES, BAKE_DPR } = await loadSprites();
const DPR = Number(process.env.FX_DPR ?? BAKE_DPR);

// ---- validate + expand frames --------------------------------------------------------------------------
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
    frames.push({ key: `${s.name}/${i}`, cls: s.cls, svg, sw, sh, edgeOk: !!s.edgeOk });
  }
}

const browser = await launchChromium();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.setContent('<!doctype html><meta charset=utf-8><body></body>');

  // ---- 1) rasterize + trim inside Chromium (frames stay in page memory) ---------------------------------
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
        // report edge touching (content clipped by the sprite box) to catch bad art
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
    fr.box = b;
  }
  if (clipped.length) console.warn(`warn: ${clipped.length} frame(s) touch the sprite box edge (clipped?): ${clipped.join(', ')}`);

  // ---- 2) pack per class -------------------------------------------------------------------------------
  const atlases = {};
  const placed = {};
  for (const cls of ['color', 'mask']) {
    const list = frames.filter((f) => f.cls === cls);
    const packer = new MaxRectsPacker(MAX, MAX, PAD, { smart: true, pot: false, square: false, allowRotation: false });
    packer.addArray(list.map((f) => ({ width: f.box.w, height: f.box.h, data: f.key })));
    if (packer.bins.length !== 1) throw new Error(`${cls}: does not fit one ${MAX}px atlas (${packer.bins.length} bins)`);
    const bin = packer.bins[0];
    let w = 0, h = 0;
    for (const r of bin.rects) {
      placed[r.data] = { x: r.x, y: r.y };
      w = Math.max(w, r.x + r.width);
      h = Math.max(h, r.y + r.height);
    }
    const pot = (v) => 2 ** Math.ceil(Math.log2(v));
    atlases[cls] = { w: pot(w + PAD), h: pot(h + PAD) };
  }

  // ---- 3) composite + WebP encode inside Chromium ------------------------------------------------------
  const files = {};
  for (const cls of ['color', 'mask']) {
    const items = frames
      .filter((f) => f.cls === cls)
      .map((f) => ({ key: f.key, sx: f.box.x0, sy: f.box.y0, w: f.box.w, h: f.box.h, x: placed[f.key].x, y: placed[f.key].y }));
    const { w, h } = atlases[cls];
    const b64 = await page.evaluate(
      async ({ items, w, h, q }) => {
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        const ctx = cv.getContext('2d');
        for (const it of items) ctx.drawImage(window.__fx.get(it.key), it.sx, it.sy, it.w, it.h, it.x, it.y, it.w, it.h);
        const blob = await new Promise((res) => cv.toBlob(res, 'image/webp', q));
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      },
      { items, w, h, q: QUALITY },
    );
    files[cls] = Buffer.from(b64, 'base64');
    if (files[cls].subarray(8, 12).toString('latin1') !== 'WEBP') throw new Error(`${cls}: Chromium did not produce WebP`);
  }

  // ---- 4) write outputs -----------------------------------------------------------------------------------
  mkdirSync(OUT_DIR, { recursive: true });
  const jsonAtlases = {};
  for (const cls of ['color', 'mask']) {
    const file = `atlas-${cls}.webp`;
    writeFileSync(resolve(OUT_DIR, file), files[cls]);
    jsonAtlases[cls] = { file, w: atlases[cls].w, h: atlases[cls].h, bytes: files[cls].length };
  }
  const jsonFrames = {};
  const anims = {};
  for (const s of SPRITES) {
    const names = [];
    for (let i = 0; i < s.n; i++) {
      const key = `${s.name}/${i}`;
      const fr = frames.find((f) => f.key === key);
      const p = placed[key];
      jsonFrames[key] = { a: s.cls, x: p.x, y: p.y, w: fr.box.w, h: fr.box.h, ox: fr.box.x0, oy: fr.box.y0, sw: fr.sw, sh: fr.sh };
      names.push(key);
    }
    anims[s.name] = { atlas: s.cls, n: s.n, frames: names, fps: s.fps, loop: s.loop, w: s.w, h: s.h, k: s.k ?? 1, scale: DPR * (s.k ?? 1) };
  }
  const atlasJson = { v: 1, dpr: DPR, ref: 30, atlases: jsonAtlases, anims, frames: jsonFrames };
  // one line per anim / frame keeps diffs readable
  const lines = ['{', `"v":1,"dpr":${DPR},"ref":30,`, `"atlases":${JSON.stringify(jsonAtlases)},`, '"anims":{'];
  lines.push(Object.entries(anims).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n'), '},', '"frames":{');
  lines.push(Object.entries(jsonFrames).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n'), '}', '}');
  writeFileSync(resolve(OUT_DIR, 'atlas.json'), lines.join('\n') + '\n');

  // typed manifest
  const names = SPRITES.map((s) => s.name);
  const manifest =
    `// GENERATED by scripts/fx/bake.mjs (npm run fx:atlas) - do not edit.\n` +
    `// Source of truth: the sprite definitions in src/content/fx/sprites-*.ts.\n` +
    `import type { FxAnimMeta } from './types';\n\n` +
    `export const FX_ANIM_NAMES = [\n${names.map((n) => `  '${n}',`).join('\n')}\n] as const;\n\n` +
    `export type FxAnimName = (typeof FX_ANIM_NAMES)[number];\n\n` +
    `/** Baked device-pixel ratio (raster px per nominal px, before per-sprite k) and reference unit. */\n` +
    `export const FX_BAKE = { dpr: ${DPR}, ref: 30 } as const;\n\n` +
    `/** Paths relative to the app base (public/fx/*). */\n` +
    `export const FX_FILES = { json: 'fx/atlas.json', color: 'fx/atlas-color.webp', mask: 'fx/atlas-mask.webp' } as const;\n\n` +
    `export const FX_FRAME_TOTAL = ${frames.length};\n\n` +
    `export const FX_ANIMS: Record<FxAnimName, FxAnimMeta> = {\n` +
    SPRITES.map(
      (s) => `  ${s.name}: { atlas: '${s.cls}', n: ${s.n}, fps: ${s.fps}, loop: ${s.loop}, w: ${s.w}, h: ${s.h}, k: ${s.k ?? 1} },`,
    ).join('\n') +
    `\n};\n\n` +
    `/** Frame key inside atlas.json: \`\${anim}/\${index}\`. */\n` +
    `export const fxFrameKey = (anim: FxAnimName, index: number): string => \`\${anim}/\${index}\`;\n`;
  writeFileSync(resolve(ROOT, 'src/content/fx/manifest.ts'), manifest);

  // ---- report -----------------------------------------------------------------------------------------------
  const count = (c) => frames.filter((f) => f.cls === c).length;
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  const jsonBytes = statSync(resolve(OUT_DIR, 'atlas.json')).size;
  console.log(`fx atlas: ${SPRITES.length} animations, ${frames.length} frames (color ${count('color')}, mask ${count('mask')}), DPR ${DPR}, q${QUALITY}`);
  for (const cls of ['color', 'mask']) {
    const a = atlases[cls];
    const used = frames.filter((f) => f.cls === cls).reduce((s, f) => s + f.box.w * f.box.h, 0);
    console.log(`  atlas-${cls}.webp  ${a.w}x${a.h}  ${kb(files[cls].length)}  fill ${((used / (a.w * a.h)) * 100).toFixed(0)}%`);
  }
  console.log(`  atlas.json  ${kb(jsonBytes)}`);
  console.log(`  total ${kb(files.color.length + files.mask.length + jsonBytes)} (target <= 300 KB, budget 500 KB)`);

  if (!args.has('--no-sheet')) {
    const { renderContactSheet } = await import('./contact-sheet.mjs');
    await renderContactSheet(browser);
  }
} finally {
  await browser.close();
}
