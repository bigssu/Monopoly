import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FX_FILES } from '../manifest';
import { MONEY_ANIMS, MONEY_ANIM_NAMES, MONEY_FILES, MONEY_FRAME_TOTAL, MONEY_TILES } from '../money-manifest';
import { MONEY_SPRITES } from '../sprites-money';
import type { MoneyAtlasJson } from '@/ui/fx/money/atlas';

const PUBLIC = resolve(__dirname, '../../../../public');
const json = JSON.parse(readFileSync(resolve(PUBLIC, MONEY_FILES.json), 'utf8')) as MoneyAtlasJson;

function webpSize(buf: Buffer): { w: number; h: number } {
  expect(buf.subarray(8, 12).toString('latin1')).toBe('WEBP');
  const kind = buf.subarray(12, 16).toString('latin1');
  if (kind === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
  if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  const b = buf.readUInt32LE(21);
  return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
}

describe('money atlas (separate from the canvas-VFX atlases)', () => {
  it('manifest, json and sprite definitions agree', () => {
    expect(MONEY_SPRITES.map((s) => s.name)).toEqual([...MONEY_ANIM_NAMES]);
    expect(Object.keys(json.anims)).toEqual([...MONEY_ANIM_NAMES]);
    expect(Object.keys(json.frames).length).toBe(MONEY_FRAME_TOTAL);
    for (const d of MONEY_SPRITES) {
      const a = json.anims[d.name]!;
      expect([a.n, a.w, a.h, a.k], d.name).toEqual([d.n, d.w, d.h, d.k ?? 1]);
      expect(MONEY_ANIMS[d.name as keyof typeof MONEY_ANIMS].fixedBox).toBe(!!d.fixedBox);
    }
  });

  it('one POT sheet ≤ 1024×512, frames inside it and apart, fixed-box cells untrimmed', () => {
    const buf = readFileSync(resolve(PUBLIC, 'fx', json.atlas.file));
    expect(webpSize(buf)).toEqual({ w: json.atlas.w, h: json.atlas.h });
    expect(json.atlas.bytes).toBe(buf.length);
    expect(json.atlas.w).toBeLessThanOrEqual(1024);
    expect(json.atlas.h).toBeLessThanOrEqual(512);
    const rects = Object.entries(json.frames);
    for (const [k, f] of rects) {
      expect(f.x + f.w, k).toBeLessThanOrEqual(json.atlas.w);
      expect(f.y + f.h, k).toBeLessThanOrEqual(json.atlas.h);
      const a = json.anims[k.split('/')[0]!]!;
      if (a.fixedBox) expect([f.ox, f.oy, f.w, f.h], k).toEqual([0, 0, f.sw, f.sh]);
    }
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]![1];
        const b = rects[j]![1];
        expect(a.x + a.w + 2 <= b.x || b.x + b.w + 2 <= a.x || a.y + a.h + 2 <= b.y || b.y + b.h + 2 <= a.y, `${rects[i]![0]} vs ${rects[j]![0]}`).toBe(true);
      }
  });

  it('wallet tiles exist at their full baked box', () => {
    const marked = MONEY_SPRITES.filter((d) => d.tile).map((d) => d.name).sort();
    expect(Object.keys(json.tiles).sort()).toEqual(marked);
    for (const n of marked) {
      const t = json.tiles[n]!;
      const buf = readFileSync(resolve(PUBLIC, 'fx', t.file));
      expect(webpSize(buf), n).toEqual({ w: t.w, h: t.h });
      expect(MONEY_TILES[n]!.file).toBe(`fx/${t.file}`);
    }
  });

  it('all FX bitmaps (VFX atlases + money atlas + tiles) stay within 500 KB', () => {
    const main = JSON.parse(readFileSync(resolve(PUBLIC, FX_FILES.json), 'utf8')) as { atlases: Record<string, { bytes: number }> };
    let total = statSync(resolve(PUBLIC, FX_FILES.json)).size + Object.values(main.atlases).reduce((s, a) => s + a.bytes, 0);
    total += statSync(resolve(PUBLIC, MONEY_FILES.json)).size + json.atlas.bytes + Object.values(json.tiles).reduce((s, t) => s + t.bytes, 0);
    expect(total).toBeLessThanOrEqual(500 * 1024);
  });

  it('generators are deterministic and free of text', () => {
    for (const d of MONEY_SPRITES)
      for (let i = 0; i < d.n; i++) {
        const svg = d.svg(i, d.n);
        expect(d.svg(i, d.n)).toBe(svg);
        expect(svg).toContain(`viewBox="0 0 ${d.w} ${d.h}"`);
        expect(svg).not.toMatch(/<text|<tspan|font-family|NaN|undefined/);
      }
  });
});
