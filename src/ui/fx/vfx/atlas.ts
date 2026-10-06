/**
 * Runtime side of the baked FX atlases (public/fx, VFX.md §12): loads atlas.json + the two WebP
 * sheets, draws frames with trim offsets / anchor / baked DPR, and caches tinted copies of mask
 * frames (VFX.md §3.6: offscreen canvas per (frame, colour), `source-in` fill, LRU by bytes).
 *
 * Loading is lazy (first effect or an explicit `preload()`); any failure resolves to `null` so the
 * engine can disable itself without throwing.
 */
import { FX_ANIMS, FX_FILES, fxFrameKey, type FxAnimName } from '@/content/fx/manifest';
import type { FxAtlasId, FxAtlasJson, FxFrame } from '@/content/fx/types';

type Img = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;

export interface DrawOpts {
  /** Display scale: 1 = the sprite's nominal CSS px size. */
  scale?: number;
  /** Extra non-uniform factors (squash / flip). */
  sx?: number;
  sy?: number;
  /** Radians. */
  rotation?: number;
  alpha?: number;
  /** Tint colour for mask sprites (ignored for colour sprites). */
  tint?: string;
  blend?: 'source-over' | 'lighter';
  /** Pivot inside the nominal box (0..1); default centre. */
  anchor?: readonly [number, number];
}

interface FrameInfo {
  f: FxFrame;
  img: Img;
  /** Raster px per nominal px. */
  rs: number;
  /** Nominal box size. */
  bw: number;
  bh: number;
  key: string;
}

/** What the engine needs of the atlas on the main thread when a worker paints (frame boxes only, no images). */
export interface FxAtlasMeta {
  /**
   * The drawn (trimmed) rect of a frame in the sprite's local nominal px relative to the pivot
   * (anchor ax, ay): writes [x0, y0, x1, y1] into `out`; false when the frame does not exist.
   */
  frameBox(animIndex: number, frame: number, ax: number, ay: number, out: Float64Array): boolean;
}

export interface FxAtlas extends FxAtlasMeta {
  readonly json: FxAtlasJson;
  /** Tint cache size in bytes / entries (dev stats). */
  cacheBytes(): number;
  cacheEntries(): number;
  /** Draw `anim` frame at (x, y) (anchor point) in the context's current transform. */
  drawFrame(ctx: CanvasRenderingContext2D, anim: FxAnimName, frame: number, x: number, y: number, o?: DrawOpts): void;
  /**
   * Hot path: draw with an already-composed transform (a, b, c, d, e, f) in backing px, anchor
   * (ax, ay), alpha and tint index. No allocation after the tint cache is warm.
   */
  drawRaw(
    ctx: CanvasRenderingContext2D,
    animIndex: number,
    frame: number,
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
    ax: number,
    ay: number,
    tint: string,
  ): void;
  /** Approximate radius (px at scale 1) of a sprite's nominal box — for dirty rects / bounds. */
  radius(anim: FxAnimName): number;
  /** Pre-build tinted frames (idle warm-up, VFX.md §3.6). */
  warm(anims: readonly FxAnimName[], colors: readonly string[]): void;
}

/** LRU cap of the tint cache (bytes). */
export const TINT_CACHE_BYTES = 8 * 1024 * 1024;

export class TintCache {
  private map = new Map<string, { c: HTMLCanvasElement | OffscreenCanvas; bytes: number }>();
  bytes = 0;
  constructor(
    private make: (w: number, h: number) => HTMLCanvasElement | OffscreenCanvas,
    private cap = TINT_CACHE_BYTES,
  ) {}
  get size(): number {
    return this.map.size;
  }
  get(key: string, w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement | OffscreenCanvas {
    const hit = this.map.get(key);
    if (hit) {
      // Refresh recency.
      this.map.delete(key);
      this.map.set(key, hit);
      return hit.c;
    }
    const c = this.make(w, h);
    const ctx = c.getContext('2d') as CanvasRenderingContext2D | null;
    if (ctx) paint(ctx);
    const bytes = w * h * 4;
    this.map.set(key, { c, bytes });
    this.bytes += bytes;
    while (this.bytes > this.cap && this.map.size > 1) {
      const [k, v] = this.map.entries().next().value as [string, { bytes: number }];
      this.map.delete(k);
      this.bytes -= v.bytes;
    }
    return c;
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export async function loadImage(url: string): Promise<Img> {
  if (typeof fetch === 'function' && typeof createImageBitmap === 'function') {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return createImageBitmap(await res.blob());
  }
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/** Base URL of the app (`./` in builds). */
function base(): string {
  const b = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return b.endsWith('/') ? b : `${b}/`;
}

export function createAtlas(json: FxAtlasJson, images: Record<FxAtlasId, Img>): FxAtlas {
  const names = Object.keys(FX_ANIMS) as FxAnimName[];
  // Frame table per animation index (dense arrays for the hot path).
  const table: FrameInfo[][] = names.map((name) => {
    const meta = json.anims[name]!;
    return meta.frames.map((key) => {
      const f = json.frames[key]!;
      return { f, img: images[f.a], rs: meta.scale, bw: f.sw / meta.scale, bh: f.sh / meta.scale, key };
    });
  });
  const indexOf = new Map(names.map((n, i) => [n, i]));
  const cache = new TintCache(makeCanvas);

  /**
   * Tinted copy of a mask frame. Large frames (> 64 KB at the baked DPR 2: rings, bursts, fireworks,
   * rays — all soft shapes) are cached at half resolution, which still gives ≥ 1 px per nominal px
   * (≈ the displayed density: u/30 × backing scale) and quarters their memory, so the 8 MB LRU holds
   * the typical game palette (4 owners + gold + white) without thrashing.
   */
  const tintK = (fi: FrameInfo): number => (fi.f.w * fi.f.h * 4 > 64 * 1024 ? 0.5 : 1);
  const tinted = (fi: FrameInfo, color: string): CanvasImageSource => {
    const { f } = fi;
    const k = tintK(fi);
    const w = Math.max(1, Math.ceil(f.w * k));
    const h = Math.max(1, Math.ceil(f.h * k));
    return cache.get(`${fi.key}|${color}`, w, h, (c) => {
      c.drawImage(fi.img as CanvasImageSource, f.x, f.y, f.w, f.h, 0, 0, w, h);
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = color;
      c.fillRect(0, 0, w, h);
    }) as CanvasImageSource;
  };

  const drawRaw: FxAtlas['drawRaw'] = (ctx, ai, frame, a, b, c, d, e, f, ax, ay, tint) => {
    const fi = table[ai]?.[frame];
    if (!fi) return;
    const fr = fi.f;
    ctx.setTransform(a, b, c, d, e, f);
    const dx = fr.ox / fi.rs - fi.bw * ax;
    const dy = fr.oy / fi.rs - fi.bh * ay;
    const dw = fr.w / fi.rs;
    const dh = fr.h / fi.rs;
    if (tint && fr.a === 'mask') {
      const k = tintK(fi);
      ctx.drawImage(tinted(fi, tint), 0, 0, Math.max(1, Math.ceil(fr.w * k)), Math.max(1, Math.ceil(fr.h * k)), dx, dy, dw, dh);
    }
    else ctx.drawImage(fi.img as CanvasImageSource, fr.x, fr.y, fr.w, fr.h, dx, dy, dw, dh);
  };

  return {
    json,
    cacheBytes: () => cache.bytes,
    cacheEntries: () => cache.size,
    drawRaw,
    drawFrame(ctx, anim, frame, x, y, o = {}) {
      const ai = indexOf.get(anim)!;
      const n = table[ai]!.length;
      const s = o.scale ?? 1;
      const r = o.rotation ?? 0;
      const cs = Math.cos(r);
      const sn = Math.sin(r);
      const sx = s * (o.sx ?? 1);
      const sy = s * (o.sy ?? 1);
      const m = ctx.getTransform();
      ctx.save();
      ctx.globalAlpha = o.alpha ?? 1;
      ctx.globalCompositeOperation = o.blend ?? 'source-over';
      // Compose with the caller's transform: M · T(x,y) · R · S.
      const a = cs * sx;
      const b = sn * sx;
      const c = -sn * sy;
      const d = cs * sy;
      drawRaw(
        ctx,
        ai,
        ((frame % n) + n) % n,
        m.a * a + m.c * b,
        m.b * a + m.d * b,
        m.a * c + m.c * d,
        m.b * c + m.d * d,
        m.a * x + m.c * y + m.e,
        m.b * x + m.d * y + m.f,
        o.anchor?.[0] ?? 0.5,
        o.anchor?.[1] ?? 0.5,
        o.tint ?? '',
      );
      ctx.restore();
    },
    frameBox(ai, frame, ax, ay, out) {
      const fi = table[ai]?.[frame];
      if (!fi) return false;
      const fr = fi.f;
      const x0 = fr.ox / fi.rs - fi.bw * ax;
      const y0 = fr.oy / fi.rs - fi.bh * ay;
      out[0] = x0;
      out[1] = y0;
      out[2] = x0 + fr.w / fi.rs;
      out[3] = y0 + fr.h / fi.rs;
      return true;
    },
    radius(anim) {
      const m = FX_ANIMS[anim];
      return Math.hypot(m.w, m.h) / 2;
    },
    warm(anims, colors) {
      for (const n of anims) {
        const ai = indexOf.get(n)!;
        for (const fi of table[ai]!) if (fi.f.a === 'mask') for (const c of colors) tinted(fi, c);
      }
    },
  };
}

/** Frame boxes from the atlas JSON alone (worker backend: the main thread never decodes the sheets). */
export function createAtlasMeta(json: FxAtlasJson): FxAtlasMeta {
  const names = Object.keys(FX_ANIMS) as FxAnimName[];
  // Per animation: per frame [x0, y0, w, h, bw, bh] in nominal px (x0/y0 = trim offset).
  const table: Float64Array[][] = names.map((name) => {
    const meta = json.anims[name]!;
    return meta.frames.map((key) => {
      const f = json.frames[key]!;
      const rs = meta.scale;
      return Float64Array.of(f.ox / rs, f.oy / rs, f.w / rs, f.h / rs, f.sw / rs, f.sh / rs);
    });
  });
  return {
    frameBox(ai, frame, ax, ay, out) {
      const b = table[ai]?.[frame];
      if (!b) return false;
      out[0] = b[0]! - b[4]! * ax;
      out[1] = b[1]! - b[5]! * ay;
      out[2] = out[0] + b[2]!;
      out[3] = out[1] + b[3]!;
      return true;
    },
  };
}

/** Absolute URLs of the atlas files (a worker resolves relative URLs against its own script). */
export function atlasUrls(baseUrl = base()): { json: string; color: string; mask: string } {
  const abs = (f: string): string => (typeof location !== 'undefined' ? new URL(baseUrl + f, location.href).href : baseUrl + f);
  return { json: abs(FX_FILES.json), color: abs(FX_FILES.color), mask: abs(FX_FILES.mask) };
}

let loadingJson: Promise<FxAtlasJson | null> | null = null;
/** Load (once) the atlas JSON only. Resolves null on failure. */
export function loadAtlasJson(baseUrl = base()): Promise<FxAtlasJson | null> {
  if (loadingJson) return loadingJson;
  loadingJson = (async () => {
    try {
      if (typeof fetch !== 'function') return null;
      const res = await fetch(baseUrl + FX_FILES.json);
      if (!res.ok) throw new Error(`atlas.json ${res.status}`);
      return (await res.json()) as FxAtlasJson;
    } catch (e) {
      console.warn('[vfx] atlas unavailable, effects disabled:', e);
      return null;
    }
  })();
  return loadingJson;
}

let loading: Promise<FxAtlas | null> | null = null;

/** Load (once) the atlas JSON + sheets. Resolves null on any failure (the engine then disables itself). */
export function loadAtlas(baseUrl = base()): Promise<FxAtlas | null> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const json = await loadAtlasJson(baseUrl);
      if (!json) return null;
      const [color, mask] = await Promise.all([loadImage(baseUrl + FX_FILES.color), loadImage(baseUrl + FX_FILES.mask)]);
      return createAtlas(json, { color, mask });
    } catch (e) {
      console.warn('[vfx] atlas unavailable, effects disabled:', e);
      return null;
    }
  })();
  return loading;
}

export { fxFrameKey };
