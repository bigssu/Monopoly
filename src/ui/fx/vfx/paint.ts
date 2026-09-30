/**
 * Pixel side of the FX presentation (docs/VFX.md §15), shared by both backends:
 * - main backend: the engine paints its pooled canvases directly (tests, manual clock, fallback);
 * - worker backend (`fx.worker.ts`): the canvases are `transferControlToOffscreen()`-ed and a
 *   dedicated worker paints them, so the canvas draw and its copy to the compositor never run on
 *   the main thread (a main-thread software canvas costs its whole backing store per frame there).
 *
 * The engine (main thread) decides everything — clusters, which canvas, placement, backing scale,
 * draw order — and hands over one flat frame: per canvas [backing w, h, x, y, s, flags] and per
 * particle one record of `REC` floats (already in that canvas's backing px). The painter only
 * clears what it drew last time and replays the records: no layout, no DOM, no allocation.
 */
import type { FxAtlas } from './atlas';

/** Floats per particle record. */
export const REC = 13;
/** Record fields. */
export const R_SLOT = 0;
export const R_ANIM = 1;
export const R_FRAME = 2;
/** a, b, c, d, e, f: the draw transform in backing px. */
export const R_A = 3;
export const R_AX = 9;
export const R_AY = 10;
export const R_ALPHA = 11;
/** tint index + 65536 × blend. */
export const R_TINT = 12;

/** Floats per canvas state. */
export const SREC = 6;
/** Canvas state: backing w, h (0 = free it), placement x, y, s, flags (the drawn box is tracked by the painter). */
export const S_W = 0;
export const S_H = 1;
export const S_X = 2;
export const S_Y = 3;
export const S_S = 4;
export const S_FLAGS = 5;
/** Flag: shown (painted this frame). */
export const SF_SHOWN = 1;
/** Flag: clear everything before drawing (just shown: the parked content is stale). */
export const SF_CLEAR = 2;

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface PaintTarget {
  readonly canvas: { width: number; height: number };
  readonly ctx: Ctx2D;
}

/** Per-canvas painter state (what it drew last frame, where). */
export class SlotPainter {
  x = NaN;
  y = NaN;
  s = NaN;
  dx0 = 0;
  dy0 = 0;
  dx1 = 0;
  dy1 = 0;
  dirty = false;
  blend = -1;
  constructor(readonly t: PaintTarget) {}

  /** Size / clear for this frame. Returns true when the canvas takes part in the frame (shown). */
  begin(st: ArrayLike<number>, o: number): boolean {
    const { canvas, ctx } = this.t;
    const W = st[o + S_W]!;
    const H = st[o + S_H]!;
    const flags = st[o + S_FLAGS]!;
    if (canvas.width !== W || canvas.height !== H) {
      // Resizing clears the bitmap (and frees it at 0 × 0).
      canvas.width = W;
      canvas.height = H;
      this.dirty = false;
      this.x = NaN;
    }
    if (!(flags & SF_SHOWN)) return false;
    const x = st[o + S_X]!;
    const y = st[o + S_Y]!;
    const s = st[o + S_S]!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (flags & SF_CLEAR || x !== this.x || y !== this.y || s !== this.s) {
      ctx.clearRect(0, 0, W, H);
      this.x = x;
      this.y = y;
      this.s = s;
    } else if (this.dirty) ctx.clearRect(this.dx0 - 2, this.dy0 - 2, this.dx1 - this.dx0 + 4, this.dy1 - this.dy0 + 4);
    this.dirty = false;
    this.dx0 = this.dy0 = Infinity;
    this.dx1 = this.dy1 = -Infinity;
    this.blend = -1;
    return true;
  }

  end(): void {
    if (this.blend < 0) return;
    this.t.ctx.globalAlpha = 1;
    this.t.ctx.globalCompositeOperation = 'source-over';
  }
}

/**
 * Paint one frame: `states` (SREC floats per painter), `list` (`n` records), `tints` (index → CSS
 * colour; '' = none). `boxes` (4 floats per record: the particle's box in backing px) grows the
 * dirty rect that the next frame clears.
 */
export function paintFrame(
  atlas: FxAtlas,
  painters: readonly SlotPainter[],
  states: ArrayLike<number>,
  list: ArrayLike<number>,
  boxes: ArrayLike<number>,
  n: number,
  tints: readonly string[],
): void {
  const on: boolean[] = [];
  for (let k = 0; k < painters.length; k++) on.push(painters[k]!.begin(states, k * SREC));
  for (let r = 0; r < n; r++) {
    const o = r * REC;
    const k = list[o + R_SLOT]!;
    const p = painters[k];
    if (!p || !on[k]) continue;
    const ctx = p.t.ctx as CanvasRenderingContext2D;
    const tb = list[o + R_TINT]!;
    const blend = tb >= 65536 ? 1 : 0;
    if (p.blend !== blend) {
      ctx.globalCompositeOperation = blend ? 'lighter' : 'source-over';
      p.blend = blend;
    }
    ctx.globalAlpha = list[o + R_ALPHA]!;
    atlas.drawRaw(
      ctx,
      list[o + R_ANIM]!,
      list[o + R_FRAME]!,
      list[o + R_A]!,
      list[o + R_A + 1]!,
      list[o + R_A + 2]!,
      list[o + R_A + 3]!,
      list[o + R_A + 4]!,
      list[o + R_A + 5]!,
      list[o + R_AX]!,
      list[o + R_AY]!,
      tints[tb & 0xffff] ?? '',
    );
    const b = r * 4;
    if (boxes[b]! < p.dx0) p.dx0 = boxes[b]!;
    if (boxes[b + 1]! < p.dy0) p.dy0 = boxes[b + 1]!;
    if (boxes[b + 2]! > p.dx1) p.dx1 = boxes[b + 2]!;
    if (boxes[b + 3]! > p.dy1) p.dy1 = boxes[b + 3]!;
    p.dirty = true;
  }
  for (const p of painters) p.end();
}

// ------------------------------------------------------------------------------ worker protocol

export interface WorkerInit {
  t: 'init';
  urls: { json: string; color: string; mask: string };
  software: boolean;
}
export interface WorkerCanvases {
  t: 'canvases';
  canvases: OffscreenCanvas[];
}
export interface WorkerFrame {
  t: 'frame';
  states: Float32Array;
  list: Float32Array;
  boxes: Float32Array;
  n: number;
  /** Tint table entries added since the last frame (index = first). */
  tints?: { first: number; add: string[] };
}
export type ToWorker = WorkerInit | WorkerCanvases | WorkerFrame;

export type FromWorker =
  | { t: 'ready' }
  | { t: 'failed'; error: string }
  /** The frame buffers handed back for reuse (no allocation per frame). */
  | { t: 'buffers'; states: Float32Array; list: Float32Array; boxes: Float32Array };
