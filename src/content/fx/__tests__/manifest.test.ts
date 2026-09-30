import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FX_ANIMS, FX_ANIM_NAMES, FX_BAKE, FX_FILES, FX_FRAME_TOTAL } from '../manifest';
import { SPRITES } from '../sprites';
import type { FxAtlasId, FxAtlasJson } from '../types';

const PUBLIC = resolve(__dirname, '../../../../public');
const atlas = JSON.parse(readFileSync(resolve(PUBLIC, FX_FILES.json), 'utf8')) as FxAtlasJson;
const IDS: FxAtlasId[] = ['color', 'mask'];
const BUDGET_BYTES = 500 * 1024;
const MAX_SIDE = 2048;

/** Read width/height from a WebP header (VP8 / VP8L / VP8X). */
function webpSize(buf: Buffer): { w: number; h: number } {
  expect(buf.subarray(0, 4).toString('latin1')).toBe('RIFF');
  expect(buf.subarray(8, 12).toString('latin1')).toBe('WEBP');
  const kind = buf.subarray(12, 16).toString('latin1');
  if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
  }
  throw new Error(`unknown WebP chunk ${kind}`);
}

describe('fx atlas manifest', () => {
  it('has unique, well-formed animation names', () => {
    expect(new Set(FX_ANIM_NAMES).size).toBe(FX_ANIM_NAMES.length);
    for (const n of FX_ANIM_NAMES) expect(n).toMatch(/^[a-z0-9_]+$/);
    expect(Object.keys(FX_ANIMS).sort()).toEqual([...FX_ANIM_NAMES].sort());
  });

  it('every manifest animation exists in atlas.json with matching metadata', () => {
    expect(Object.keys(atlas.anims).sort()).toEqual([...FX_ANIM_NAMES].sort());
    expect(atlas.dpr).toBe(FX_BAKE.dpr);
    for (const name of FX_ANIM_NAMES) {
      const m = FX_ANIMS[name];
      const a = atlas.anims[name]!;
      expect(a.atlas, name).toBe(m.atlas);
      expect(a.n, name).toBe(m.n);
      expect(a.frames.length, name).toBe(m.n);
      expect(a.fps, name).toBe(m.fps);
      expect(a.loop, name).toBe(m.loop);
      expect([a.w, a.h, a.k], name).toEqual([m.w, m.h, m.k]);
      expect(a.scale, name).toBeCloseTo(atlas.dpr * m.k, 6);
      a.frames.forEach((key, i) => {
        expect(key).toBe(`${name}/${i}`);
        expect(atlas.frames[key], key).toBeDefined();
        expect(atlas.frames[key]!.a, key).toBe(m.atlas);
      });
    }
  });

  it('frame counts add up (manifest, json, sprite definitions)', () => {
    const total = FX_ANIM_NAMES.reduce((s, n) => s + FX_ANIMS[n].n, 0);
    expect(total).toBe(FX_FRAME_TOTAL);
    expect(Object.keys(atlas.frames).length).toBe(FX_FRAME_TOTAL);
    expect(SPRITES.reduce((s, d) => s + d.n, 0)).toBe(FX_FRAME_TOTAL);
    expect(SPRITES.map((d) => d.name)).toEqual([...FX_ANIM_NAMES]);
    // no orphan frames
    const listed = new Set(FX_ANIM_NAMES.flatMap((n) => atlas.anims[n]!.frames));
    expect(listed.size).toBe(FX_FRAME_TOTAL);
    for (const k of Object.keys(atlas.frames)) expect(listed.has(k), k).toBe(true);
  });

  it('atlas files exist, headers match the json, and stay within the size budget', () => {
    let total = statSync(resolve(PUBLIC, FX_FILES.json)).size;
    for (const id of IDS) {
      const info = atlas.atlases[id];
      const file = resolve(PUBLIC, 'fx', info.file);
      expect(FX_FILES[id]).toBe(`fx/${info.file}`);
      const buf = readFileSync(file);
      const { w, h } = webpSize(buf);
      expect([info.w, info.h], id).toEqual([w, h]);
      expect(w, id).toBeLessThanOrEqual(MAX_SIDE);
      expect(h, id).toBeLessThanOrEqual(MAX_SIDE);
      expect(info.bytes, id).toBe(buf.length);
      total += buf.length;
    }
    expect(total).toBeLessThanOrEqual(BUDGET_BYTES);
  });

  it('frames lie inside their atlas, trim data is consistent, no rects overlap (padding kept)', () => {
    for (const id of IDS) {
      const at = atlas.atlases[id];
      const rects = Object.entries(atlas.frames).filter(([, f]) => f.a === id);
      expect(rects.length, id).toBeGreaterThan(0);
      for (const [key, f] of rects) {
        expect(f.w, key).toBeGreaterThan(0);
        expect(f.h, key).toBeGreaterThan(0);
        expect(f.x, key).toBeGreaterThanOrEqual(0);
        expect(f.y, key).toBeGreaterThanOrEqual(0);
        expect(f.x + f.w, key).toBeLessThanOrEqual(at.w);
        expect(f.y + f.h, key).toBeLessThanOrEqual(at.h);
        // trimmed rect sits inside its source canvas
        expect(f.ox + f.w, key).toBeLessThanOrEqual(f.sw);
        expect(f.oy + f.h, key).toBeLessThanOrEqual(f.sh);
        // source size = ceil(nominal * dpr * k)
        const a = atlas.anims[key.split('/')[0]!]!;
        expect(f.sw, key).toBe(Math.ceil(a.w * a.scale));
        expect(f.sh, key).toBe(Math.ceil(a.h * a.scale));
      }
      const PAD = 2;
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const [ka, a] = rects[i]!;
          const [kb, b] = rects[j]!;
          const apart =
            a.x + a.w + PAD <= b.x || b.x + b.w + PAD <= a.x || a.y + a.h + PAD <= b.y || b.y + b.h + PAD <= a.y;
          expect(apart, `${ka} vs ${kb}`).toBe(true);
        }
      }
    }
  });

  it('frames are stored in the atlas that matches their class', () => {
    for (const d of SPRITES) {
      for (let i = 0; i < d.n; i++) expect(atlas.frames[`${d.name}/${i}`]!.a, d.name).toBe(d.cls);
    }
  });
});

describe('fx sprite generators', () => {
  it('are deterministic and free of text', () => {
    for (const d of SPRITES) {
      for (let i = 0; i < d.n; i++) {
        const a = d.svg(i, d.n);
        expect(d.svg(i, d.n), `${d.name}/${i}`).toBe(a);
        expect(a.startsWith('<svg '), `${d.name}/${i}`).toBe(true);
        expect(a, `${d.name}/${i}`).toContain(`viewBox="0 0 ${d.w} ${d.h}"`);
        expect(a, `${d.name}/${i}`).not.toMatch(/<text|<tspan|font-family|NaN|undefined/);
      }
    }
  });

  it('mask sprites use only white (no coloured paint)', () => {
    for (const d of SPRITES.filter((s) => s.cls === 'mask')) {
      for (let i = 0; i < d.n; i++) {
        const svg = d.svg(i, d.n);
        const colors = svg.match(/(?:fill|stroke|stop-color)="(#[0-9a-fA-F]{3,6})"/g) ?? [];
        for (const c of colors) {
          const hex = c.slice(c.indexOf('#') + 1, -1).toLowerCase();
          const ok = ['fff', 'ffffff', '000', '000000', '5a5a5a'].includes(hex);
          expect(ok, `${d.name}/${i} ${c}`).toBe(true);
        }
      }
    }
  });
});
