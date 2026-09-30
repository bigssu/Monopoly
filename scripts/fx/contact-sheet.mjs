#!/usr/bin/env node
/**
 * FX contact sheet: reads the BAKED public/fx atlas (so anchors/trim/packing are verified too) and renders every
 * animation as a filmstrip on dark + light backgrounds, a size check at 24/48/96 px and tinted mask samples.
 * Output: docs/assets/fx-contact-sheet.png.   Standalone: `node scripts/fx/contact-sheet.mjs [--parts <dir>]`.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OUT_DIR, ROOT, launchChromium } from './common.mjs';

const SHEET = resolve(ROOT, 'docs/assets/fx-contact-sheet.png');

export async function renderContactSheet(browser, { partsDir } = {}) {
  const atlas = JSON.parse(readFileSync(resolve(OUT_DIR, 'atlas.json'), 'utf8'));
  const img = {
    color: 'data:image/webp;base64,' + readFileSync(resolve(OUT_DIR, atlas.atlases.color.file)).toString('base64'),
    mask: 'data:image/webp;base64,' + readFileSync(resolve(OUT_DIR, atlas.atlases.mask.file)).toString('base64'),
  };
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.setContent('<!doctype html><meta charset=utf-8><body style="margin:0"></body>');
  const png = await page.evaluate(
    async ({ atlas, img }) => {
      const load = (src) =>
        new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = src;
        });
      const imgs = { color: await load(img.color), mask: await load(img.mask) };
      const W = 2000;
      const DARK = '#1E2233';
      const LIGHT = '#F4F1E8';
      const X_LABEL = 10;
      const X_DARK = 170;
      const SW = 560;
      const X_LIGHT = X_DARK + SW + 10;
      const X_SIZE = X_LIGHT + SW + 10; // dark + light size checks
      const SIZES = [24, 48, 96];
      const X_TINT = X_SIZE + 2 * 200 + 10;
      const TINTS = ['#FFC94A', '#E8564F', '#6EC1E4', '#5CC689'];

      const names = Object.keys(atlas.anims);
      // ---- layout pass
      const rows = [];
      let y = 46;
      let lastCls = '';
      for (const name of names) {
        const a = atlas.anims[name];
        if (a.atlas !== lastCls) {
          rows.push({ header: a.atlas === 'color' ? 'COLOR ATLAS  (fixed colours)' : 'MASK ATLAS  (white + alpha, tinted / additive at runtime)', y });
          y += 34;
          lastCls = a.atlas;
        }
        const cs = Math.min(1, 128 / Math.max(a.w, a.h) * (a.w > 128 || a.h > 128 ? 1 : 1)); // cell scale
        const cw = Math.ceil(a.w * cs);
        const ch = Math.ceil(a.h * cs);
        const perLine = Math.max(1, Math.floor((SW - 8) / (cw + 6)));
        const lines = Math.ceil(a.frames.length / perLine);
        const h = Math.max(lines * (ch + 6) + 10, 96 + 20);
        rows.push({ name, a, cs, cw, ch, perLine, y, h });
        y += h + 4;
      }
      const atlasY = y + 20;
      const H = atlasY + Math.max(atlas.atlases.color.h, atlas.atlases.mask.h) * 0.5 + 60;
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = Math.ceil(H);
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#E9EBF3';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#2B3245';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(`FX sprite contact sheet - ${Object.keys(atlas.frames).length} frames, ${names.length} animations, baked DPR ${atlas.dpr}`, 10, 28);

      const tintCache = new Map();
      const tinted = (fr, a, color) => {
        const key = fr + color;
        let t = tintCache.get(key);
        if (!t) {
          const f = atlas.frames[fr];
          t = document.createElement('canvas');
          t.width = f.w;
          t.height = f.h;
          const c = t.getContext('2d');
          c.drawImage(imgs[f.a], f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
          c.globalCompositeOperation = 'source-in';
          c.fillStyle = color;
          c.fillRect(0, 0, f.w, f.h);
          tintCache.set(key, t);
        }
        return t;
      };
      /** Draw frame with its nominal box at (x,y), box scaled by s. mode: 'plain' | {tint, add}. */
      const drawFrame = (key, a, x, y, s, mode) => {
        const f = atlas.frames[key];
        const k = s / a.scale;
        const dx = x + f.ox * k;
        const dy = y + f.oy * k;
        if (mode && mode.tint) {
          if (mode.add) ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(tinted(key, a, mode.tint), dx, dy, f.w * k, f.h * k);
          ctx.globalCompositeOperation = 'source-over';
        } else {
          ctx.drawImage(imgs[f.a], f.x, f.y, f.w, f.h, dx, dy, f.w * k, f.h * k);
        }
      };
      const box = (x, y, w, h, fill, stroke) => {
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, w, h);
        if (stroke) {
          ctx.strokeStyle = stroke;
          ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        }
      };

      for (const r of rows) {
        if (r.header) {
          ctx.fillStyle = '#2B3245';
          ctx.font = 'bold 16px sans-serif';
          ctx.fillText(r.header, 10, r.y + 22);
          continue;
        }
        const { name, a, cs, cw, ch, perLine, y: ry, h } = r;
        const isMask = a.atlas === 'mask';
        // label
        ctx.fillStyle = '#2B3245';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(name, X_LABEL, ry + 20);
        ctx.font = '12px sans-serif';
        ctx.fillStyle = '#5a6278';
        ctx.fillText(`${a.n}f  ${a.w}x${a.h}  k${a.k}  ${a.fps}fps`, X_LABEL, ry + 38);
        // strips
        for (const [sx, bg, tint] of [
          [X_DARK, DARK, { tint: '#FFC94A', add: true }],
          [X_LIGHT, LIGHT, { tint: '#3A56C8', add: false }],
        ]) {
          box(sx, ry, SW, h, bg, null);
          a.frames.forEach((fr, i) => {
            const col = i % perLine;
            const line = Math.floor(i / perLine);
            const x = sx + 6 + col * (cw + 6);
            const yy = ry + 8 + line * (ch + 6);
            ctx.strokeStyle = bg === DARK ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.12)';
            ctx.strokeRect(x + 0.5, yy + 0.5, cw - 1, ch - 1);
            drawFrame(fr, a, x, yy, cs, isMask ? tint : null);
          });
        }
        // size checks (peak-ish frame)
        const peak = a.frames[Math.min(a.frames.length - 1, Math.floor((a.frames.length - 1) * 0.45))];
        for (const [gx, bg, tint] of [
          [X_SIZE, DARK, { tint: '#FFC94A', add: true }],
          [X_SIZE + 200, LIGHT, { tint: '#E8564F', add: false }],
        ]) {
          box(gx, ry, 200, h, bg, null);
          let x = gx + 6;
          for (const sz of SIZES) {
            const s = sz / Math.max(a.w, a.h);
            drawFrame(peak, a, x, ry + 10, s, isMask ? tint : null);
            ctx.fillStyle = bg === DARK ? '#8b93ad' : '#7a8299';
            ctx.font = '10px sans-serif';
            ctx.fillText(String(sz), x, ry + h - 6);
            x += sz + 12;
          }
        }
        // tinted samples
        box(X_TINT, ry, W - X_TINT - 4, h, DARK, null);
        if (isMask) {
          TINTS.forEach((c, i) => {
            const s = Math.min(1, 84 / Math.max(a.w, a.h));
            drawFrame(peak, a, X_TINT + 6 + i * 96, ry + 8, s, { tint: c, add: true });
          });
        } else {
          ctx.fillStyle = '#5a6278';
          ctx.font = '12px sans-serif';
          ctx.fillText('(fixed colour)', X_TINT + 8, ry + 24);
        }
      }
      // atlases at 50 % on checker
      ctx.fillStyle = '#2B3245';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('ATLASES (50 %)', 10, atlasY - 6);
      let ax = 10;
      for (const id of ['color', 'mask']) {
        const at = atlas.atlases[id];
        const w = at.w * 0.5;
        const h = at.h * 0.5;
        for (let yy = 0; yy < h; yy += 10)
          for (let xx = 0; xx < w; xx += 10) {
            ctx.fillStyle = (xx / 10 + yy / 10) % 2 ? '#7f8598' : '#5f6578';
            ctx.fillRect(ax + xx, atlasY + yy, 10, 10);
          }
        ctx.drawImage(imgs[id], ax, atlasY, w, h);
        ctx.strokeStyle = '#fff';
        ctx.strokeRect(ax + 0.5, atlasY + 0.5, w - 1, h - 1);
        ctx.fillStyle = '#2B3245';
        ctx.font = '12px sans-serif';
        ctx.fillText(`${id}  ${at.w}x${at.h}  ${(at.bytes / 1024).toFixed(1)} KB`, ax, atlasY + h + 16);
        ax += w + 30;
      }
      return { url: cv.toDataURL('image/png'), rows: rows.filter((r) => r.name).map((r) => ({ name: r.name, y: r.y, h: r.h })), H: cv.height, W };
    },
    { atlas, img },
  );
  await page.close();
  const buf = Buffer.from(png.url.split(',')[1], 'base64');
  mkdirSync(resolve(ROOT, 'docs/assets'), { recursive: true });
  writeFileSync(SHEET, buf);
  console.log(`  contact sheet -> docs/assets/fx-contact-sheet.png (${png.W}x${png.H}, ${(buf.length / 1024).toFixed(0)} KB)`);
  if (partsDir) {
    // split into viewable chunks for review (not committed)
    mkdirSync(partsDir, { recursive: true });
    const p2 = await browser.newPage();
    await p2.setContent('<body style="margin:0"></body>');
    const chunks = await p2.evaluate(async ({ url, W, H }) => {
      const i = new Image();
      await new Promise((r) => ((i.onload = r), (i.src = url)));
      const out = [];
      const CH = 1000;
      for (let y = 0; y < H; y += CH) {
        const c = document.createElement('canvas');
        c.width = W;
        c.height = Math.min(CH, H - y);
        c.getContext('2d').drawImage(i, 0, y, W, c.height, 0, 0, W, c.height);
        out.push(c.toDataURL('image/png'));
      }
      return out;
    }, png);
    chunks.forEach((u, i) => writeFileSync(resolve(partsDir, `part${i}.png`), Buffer.from(u.split(',')[1], 'base64')));
    await p2.close();
    console.log(`  ${chunks.length} review parts -> ${partsDir}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--parts');
  const browser = await launchChromium();
  try {
    await renderContactSheet(browser, { partsDir: i > 0 ? process.argv[i + 1] : undefined });
  } finally {
    await browser.close();
  }
}
