/** Hand-written types for the baked FX atlas (public/fx/atlas.json) and the generated manifest. */

export type FxAtlasId = 'color' | 'mask';

/** Per-animation metadata (also in atlas.json `anims`, plus the frame-key list). */
export interface FxAnimMeta {
  atlas: FxAtlasId;
  /** Frame count. */
  n: number;
  fps: number;
  loop: boolean;
  /** Nominal CSS px size at the reference unit (u = 30). */
  w: number;
  h: number;
  /** Extra bake shrink (raster px per nominal px = dpr * k). */
  k: number;
}

/** One packed frame. Draw the (x,y,w,h) rect; the trimmed rect sat at (ox,oy) inside the (sw,sh) source canvas. */
export interface FxFrame {
  a: FxAtlasId;
  x: number;
  y: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
  sw: number;
  sh: number;
}

interface FxAtlasFile {
  file: string;
  w: number;
  h: number;
  bytes: number;
}

interface FxAnimJson extends FxAnimMeta {
  frames: string[];
  /** Raster px per nominal px (dpr * k). Anchor of frame f: dx = (f.ox - f.sw / 2) / scale, dy likewise. */
  scale: number;
}

export interface FxAtlasJson {
  v: 1;
  dpr: number;
  ref: number;
  atlases: Record<FxAtlasId, FxAtlasFile>;
  anims: Record<string, FxAnimJson>;
  frames: Record<string, FxFrame>;
}
