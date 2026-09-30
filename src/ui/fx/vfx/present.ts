/**
 * Partial presentation for the FX engine (docs/VFX.md §15): instead of ONE canvas sized to the union
 * of every running effect's timeline bounds, the live particles are clustered every drawn frame and
 * each cluster is drawn into its own SMALL pooled canvas, placed with a transform.
 *
 * Why: a software canvas is copied whole to the compositor on every frame it is drawn
 * (`CanvasResourceProviderSharedImage::ProduceCanvasResource`, ≈ 13 µs per 1 000 backing px at 4×
 * CPU throttle), so the per-frame cost of an effect is its canvas's *backing size*, not the particles.
 * Timeline bounds cover a whole trajectory (a toll's coins cross the table); the particles alive in
 * one frame cover a small part of it.
 *
 * Rules (each measured, §15.2):
 * - Fixed size classes (S / M / L backing px). A canvas is never resized while shown; it only moves
 *   and rescales through `transform` (no Layout, no Paint).
 * - Canvases are created once (first effect) and parked with `visibility: hidden` (no GPU layer,
 *   unlike an off-screen transform: a drawn canvas keeps its layer while it is merely moved away).
 *   Showing / hiding one is the only Paint the FX layer causes, so an emptied canvas stays shown
 *   (cleared, not drawn again = no upload) until the engine goes idle or its slot is needed.
 * - At most `maxShown` canvases are shown at once (each shown canvas is one GPU layer; the game
 *   is at 18 of its 20-layer budget at peak): extra clusters are merged.
 * - Clusters keep their canvas across frames (overlap match), so a moving swarm (coins) re-places
 *   its canvas only when it leaves the canvas's rect.
 */
import type { RectLike } from './coords';

export interface SlotClass {
  name: string;
  /** Backing px (= the canvas's CSS box; the transform scales it by 1/s onto the layer). */
  w: number;
  h: number;
}

/**
 * Size classes, smallest area first: areas ×2 per step (40 K … 320 K px) in three aspects (1:1,
 * 3:2, 2:3), plus XL ≈ the old single-canvas 0.5 MP budget for a table-wide finale. Geometric steps
 * keep the unused part of a chosen canvas (uploaded anyway) small.
 */
export const SLOT_CLASSES: readonly SlotClass[] = (() => {
  const out: SlotClass[] = [];
  const r16 = (v: number): number => Math.max(16, Math.round(v / 16) * 16);
  for (const A of [40e3, 80e3, 160e3, 320e3])
    for (const [name, a] of [
      ['sq', 1],
      ['w', 1.5],
      ['t', 1 / 1.5],
    ] as const)
      out.push({ name: `${name}${Math.round(A / 1000)}`, w: r16(Math.sqrt(A * a)), h: r16(Math.sqrt(A / a)) });
  out.push({ name: 'xl', w: 960, h: 600 });
  return out;
})();
/** Pool: one canvas per class, two of the small square ones (several small effects at once). */
export const SLOT_POOL: readonly number[] = [0, 0, ...SLOT_CLASSES.map((_, i) => i).slice(1), 3];

/** Upload budget per drawn frame (backing px over all clusters) that picks the scale of large clusters. */
export const FRAME_BUDGET_PX = 0.3e6;

/** Backing scales a canvas may use (backing px per layer px); quantized so a growing cluster does not rescale every frame. */
const SCALES = [2, 1.5, 1.25, 1, 0.85, 0.72, 0.6, 0.5, 0.42, 0.36, 0.3, 0.25, 0.2, 0.16, 0.12];

/** Largest quantized scale ≤ `fit` (and ≤ `max`). */
export function quantScale(fit: number, max: number): number {
  const lim = Math.min(fit, max);
  for (const s of SCALES) if (s <= lim + 1e-9) return s;
  return SCALES[SCALES.length - 1]!;
}

/**
 * Clusters of particle boxes (pure; unit-tested). Particles whose padded boxes touch a common grid
 * cell join one cluster (union-find over cell owners), overlapping cluster boxes merge, cheap merges
 * (union area ≤ `mergeK` × the sum) happen, then the pair with the least added area merges until at
 * most `max` clusters are left.
 */
export class Clusterer {
  /** Cluster index per particle (valid after `run`). */
  label = new Int32Array(0);
  x0 = new Float64Array(0);
  y0 = new Float64Array(0);
  x1 = new Float64Array(0);
  y1 = new Float64Array(0);
  count = 0;
  private parent = new Int32Array(0);
  private owner = new Int32Array(0);
  private stamp = new Uint32Array(0);
  private gen = 0;
  private gw = 0;
  private gh = 0;
  private root2c = new Int32Array(0);
  private alias = new Int32Array(0);

  constructor(
    readonly cell = 64,
    readonly pad = 10,
    readonly mergeK = 1.3,
  ) {}

  private find(i: number): number {
    const p = this.parent;
    while (p[i] !== i) {
      p[i] = p[p[i]!]!;
      i = p[i]!;
    }
    return i;
  }

  private ensure(n: number, W: number, H: number): void {
    if (this.parent.length < n) {
      const m = Math.max(n, 64);
      this.parent = new Int32Array(m);
      this.label = new Int32Array(m);
      this.root2c = new Int32Array(m);
      this.alias = new Int32Array(m);
      this.x0 = new Float64Array(m);
      this.y0 = new Float64Array(m);
      this.x1 = new Float64Array(m);
      this.y1 = new Float64Array(m);
    }
    const gw = Math.max(1, Math.ceil(W / this.cell) + 2);
    const gh = Math.max(1, Math.ceil(H / this.cell) + 2);
    if (gw !== this.gw || gh !== this.gh) {
      this.gw = gw;
      this.gh = gh;
      this.owner = new Int32Array(gw * gh);
      this.stamp = new Uint32Array(gw * gh);
      this.gen = 0;
    }
  }

  /** Cluster `n` boxes [BX0, BY0, BX1, BY1] inside a W×H layer; returns the cluster count. */
  run(n: number, BX0: ArrayLike<number>, BY0: ArrayLike<number>, BX1: ArrayLike<number>, BY1: ArrayLike<number>, W: number, H: number, max: number): number {
    this.ensure(n, W, H);
    if (++this.gen >= 0xffffffff) {
      this.stamp.fill(0);
      this.gen = 1;
    }
    const { cell, pad, gw, gh, owner, stamp, gen, parent } = this;
    for (let p = 0; p < n; p++) parent[p] = p;
    for (let p = 0; p < n; p++) {
      const cx0 = Math.max(0, Math.min(gw - 1, Math.floor((BX0[p]! - pad) / cell) + 1));
      const cx1 = Math.max(0, Math.min(gw - 1, Math.floor((BX1[p]! + pad) / cell) + 1));
      const cy0 = Math.max(0, Math.min(gh - 1, Math.floor((BY0[p]! - pad) / cell) + 1));
      const cy1 = Math.max(0, Math.min(gh - 1, Math.floor((BY1[p]! + pad) / cell) + 1));
      for (let cy = cy0; cy <= cy1; cy++)
        for (let cx = cx0; cx <= cx1; cx++) {
          const k = cy * gw + cx;
          if (stamp[k] === gen) {
            const a = this.find(p);
            const b = this.find(owner[k]!);
            if (a !== b) parent[a] = b;
          } else {
            stamp[k] = gen;
            owner[k] = p;
          }
        }
    }
    // Boxes per root.
    let c = 0;
    const { root2c, x0, y0, x1, y1, label } = this;
    for (let p = 0; p < n; p++) root2c[p] = -1;
    for (let p = 0; p < n; p++) {
      const rt = this.find(p);
      let k = root2c[rt]!;
      if (k < 0) {
        k = root2c[rt] = c++;
        x0[k] = BX0[p]!;
        y0[k] = BY0[p]!;
        x1[k] = BX1[p]!;
        y1[k] = BY1[p]!;
      } else {
        if (BX0[p]! < x0[k]!) x0[k] = BX0[p]!;
        if (BY0[p]! < y0[k]!) y0[k] = BY0[p]!;
        if (BX1[p]! > x1[k]!) x1[k] = BX1[p]!;
        if (BY1[p]! > y1[k]!) y1[k] = BY1[p]!;
      }
      label[p] = k;
    }
    // Merge: overlapping boxes, cheap unions, then down to `max`.
    const alias = this.alias;
    for (let k = 0; k < c; k++) alias[k] = k;
    const area = (k: number): number => (x1[k]! - x0[k]!) * (y1[k]! - y0[k]!);
    const merge = (a: number, b: number): void => {
      x0[a] = Math.min(x0[a]!, x0[b]!);
      y0[a] = Math.min(y0[a]!, y0[b]!);
      x1[a] = Math.max(x1[a]!, x1[b]!);
      y1[a] = Math.max(y1[a]!, y1[b]!);
      alias[b] = a;
    };
    let live = c;
    let changed = true;
    while (changed && live > 1) {
      changed = false;
      for (let a = 0; a < c && !changed; a++) {
        if (alias[a] !== a) continue;
        for (let b = a + 1; b < c; b++) {
          if (alias[b] !== b) continue;
          const ux = Math.max(x1[a]!, x1[b]!) - Math.min(x0[a]!, x0[b]!);
          const uy = Math.max(y1[a]!, y1[b]!) - Math.min(y0[a]!, y0[b]!);
          const overlap = x0[a]! < x1[b]! && x0[b]! < x1[a]! && y0[a]! < y1[b]! && y0[b]! < y1[a]!;
          if (overlap || ux * uy <= this.mergeK * (area(a) + area(b))) {
            merge(a, b);
            live--;
            changed = true;
            break;
          }
        }
      }
    }
    while (live > max) {
      let best = Infinity;
      let ba = -1;
      let bb = -1;
      for (let a = 0; a < c; a++) {
        if (alias[a] !== a) continue;
        for (let b = a + 1; b < c; b++) {
          if (alias[b] !== b) continue;
          const ux = Math.max(x1[a]!, x1[b]!) - Math.min(x0[a]!, x0[b]!);
          const uy = Math.max(y1[a]!, y1[b]!) - Math.min(y0[a]!, y0[b]!);
          const grow = ux * uy - area(a) - area(b);
          if (grow < best) {
            best = grow;
            ba = a;
            bb = b;
          }
        }
      }
      merge(ba, bb);
      live--;
    }
    // Compact the survivors to 0..live-1 and relabel particles.
    const final = root2c; // reuse as old→new map (only indices < c are read)
    let m = 0;
    for (let k = 0; k < c; k++) {
      let r = k;
      while (alias[r] !== r) r = alias[r]!;
      alias[k] = r;
    }
    for (let k = 0; k < c; k++) {
      if (alias[k] !== k) continue;
      final[k] = m;
      x0[m] = x0[k]!;
      y0[m] = y0[k]!;
      x1[m] = x1[k]!;
      y1[m] = y1[k]!;
      m++;
    }
    for (let p = 0; p < n; p++) label[p] = final[alias[label[p]!]!]!;
    this.count = m;
    return m;
  }
}

interface Slot {
  cls: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  shown: boolean;
  /** Has a backing store of the class size (freed while hidden unless retained). */
  sized: boolean;
  /** Placement on the layer (CSS px) and backing scale. */
  x: number;
  y: number;
  s: number;
  /** Cluster index assigned this frame (-1 = none). */
  cluster: number;
  /** Drawn content box in backing px (to clear next frame). */
  dx0: number;
  dy0: number;
  dx1: number;
  dy1: number;
  dirty: boolean;
  /** Needs a full clear (moved / rescaled / just shown). */
  clearAll: boolean;
  /** Frames shown without a cluster. */
  idle: number;
  blend: number;
}

export interface PresentStats {
  shown: number;
  /** Union of the shown canvases' rects (layer px). */
  union: RectLike | null;
  slots: Array<{ cls: string; x: number; y: number; w: number; h: number; s: number; shown: boolean }>;
  /** Backing px uploaded (canvases drawn) since the last reset, and frames drawn. */
  uploadPx: number;
  drawn: number;
  /** show/hide toggles (each is one Paint). */
  toggles: number;
}

export interface PresenterOptions {
  layer: HTMLElement;
  software: boolean;
  /** Most canvases shown at once (each is a GPU layer). */
  maxShown: number;
  /** Keep hidden canvases' backing stores. */
  retain: boolean;
  classes?: readonly SlotClass[];
  pool?: readonly number[];
}

/** Backing stores above this size are freed when the engine goes idle even with `retain`. */
const RETAIN_MAX_PX = 160e3;
/** Hide a shown canvas that has had no cluster for this many drawn frames (frees its layer). */
const EMPTY_HIDE_FRAMES = 45;

export class Presenter {
  readonly slots: Slot[] = [];
  readonly classes: readonly SlotClass[];
  readonly clusterer = new Clusterer();
  private uploadPx = 0;
  private drawn = 0;
  private toggles = 0;
  /** Cluster → slot for the current frame. */
  slotOf = new Int32Array(8);

  constructor(readonly o: PresenterOptions) {
    this.classes = o.classes ?? SLOT_CLASSES;
    const pool = o.pool ?? SLOT_POOL;
    for (const cls of pool) {
      const c = document.createElement('canvas');
      c.className = 'fx-canvas';
      c.setAttribute('aria-hidden', 'true');
      const k = this.classes[cls]!;
      // CSS box = backing size; the transform maps it onto the layer (translate + scale 1/s).
      c.style.width = `${k.w}px`;
      c.style.height = `${k.h}px`;
      c.style.visibility = 'hidden';
      const ctx = c.getContext('2d', { alpha: true, willReadFrequently: o.software });
      if (!ctx) continue;
      o.layer.append(c);
      this.slots.push({ cls, canvas: c, ctx, shown: false, sized: false, x: 0, y: 0, s: 1, cluster: -1, dx0: 0, dy0: 0, dx1: 0, dy1: 0, dirty: false, clearAll: true, idle: 0, blend: -1 });
    }
  }

  get ok(): boolean {
    return this.slots.length > 0;
  }

  private show(sl: Slot, on: boolean): void {
    if (sl.shown === on) return;
    sl.shown = on;
    this.toggles++;
    if (on) {
      if (!sl.sized) {
        const k = this.classes[sl.cls]!;
        sl.canvas.width = k.w;
        sl.canvas.height = k.h;
        sl.sized = true;
        sl.dirty = false;
      }
      sl.clearAll = true;
      sl.idle = 0;
      sl.canvas.style.visibility = 'visible';
    } else {
      sl.canvas.style.visibility = 'hidden';
      sl.cluster = -1;
    }
  }

  private place(sl: Slot, x: number, y: number, s: number): void {
    if (sl.x === x && sl.y === y && sl.s === s) return;
    sl.x = x;
    sl.y = y;
    sl.s = s;
    sl.canvas.style.transform = `translate(${x}px,${y}px) scale(${1 / s})`;
    sl.clearAll = true;
  }

  /** Rect (layer px) a slot covers. */
  private rect(sl: Slot): { x: number; y: number; w: number; h: number } {
    const k = this.classes[sl.cls]!;
    return { x: sl.x, y: sl.y, w: k.w / sl.s, h: k.h / sl.s };
  }

  /**
   * Assign the clusters of this frame to canvases (placing / rescaling / showing them).
   * `sMax` = the crisp backing scale (min(1.5, DPR)).
   */
  assign(sMax: number, budget = FRAME_BUDGET_PX): void {
    const C = this.clusterer;
    const n = C.count;
    if (this.slotOf.length < n) this.slotOf = new Int32Array(n * 2);
    const slotOf = this.slotOf;
    for (const sl of this.slots) sl.cluster = -1;
    // Common target scale: crisp (sMax) unless the clusters together would upload more than the budget.
    let sum = 0;
    for (let k = 0; k < n; k++) sum += Math.max(1, C.x1[k]! - C.x0[k]!) * Math.max(1, C.y1[k]! - C.y0[k]!);
    const sT = quantScale(Math.sqrt(budget / Math.max(1, sum)), sMax);
    // Largest clusters first (they pick the big canvases).
    const order: number[] = [];
    for (let k = 0; k < n; k++) order.push(k);
    order.sort((a, b) => (C.x1[b]! - C.x0[b]!) * (C.y1[b]! - C.y0[b]!) - (C.x1[a]! - C.x0[a]!) * (C.y1[a]! - C.y0[a]!));
    for (const k of order) {
      slotOf[k] = -1;
      const w = Math.max(1, C.x1[k]! - C.x0[k]!);
      const h = Math.max(1, C.y1[k]! - C.y0[k]!);
      const fit = (c: number): number => quantScale(Math.min(this.classes[c]!.w / w, this.classes[c]!.h / h), sMax);
      // The smallest class (by area) that shows the cluster at the target scale; else the best-fitting one.
      let want = -1;
      let best = -1;
      for (let c = 0; c < this.classes.length; c++) {
        const K = this.classes[c]!;
        if (fit(c) >= sT - 1e-9 && (want < 0 || K.w * K.h < this.classes[want]!.w * this.classes[want]!.h)) want = c;
        if (best < 0 || fit(c) > fit(best)) best = c;
      }
      if (want < 0) want = best;
      const wantArea = this.classes[want]!.w * this.classes[want]!.h;
      // Keep the canvas this cluster used last frame (most overlap) while it still gives ≥ 80 % of the
      // target scale and is not far bigger than needed (switching canvases costs a show = one Paint).
      let pick: Slot | null = null;
      let bestOv = 0;
      for (const sl of this.slots) {
        if (!sl.shown || sl.cluster >= 0 || !sl.dirty) continue;
        const r = this.rect(sl);
        const ov = Math.max(0, Math.min(r.x + r.w, C.x1[k]!) - Math.max(r.x, C.x0[k]!)) * Math.max(0, Math.min(r.y + r.h, C.y1[k]!) - Math.max(r.y, C.y0[k]!));
        const K = this.classes[sl.cls]!;
        if (ov > bestOv && fit(sl.cls) >= sT * 0.8 - 1e-9 && K.w * K.h <= wantArea * 3) {
          bestOv = ov;
          pick = sl;
        }
      }
      // Else a shown, unassigned canvas that fits (no Paint), else show a hidden one.
      if (!pick) pick = this.freeSlot(want, sT, w, h, sMax);
      if (!pick) continue;
      pick.cluster = k;
      pick.idle = 0;
      slotOf[k] = this.slots.indexOf(pick);
      const K = this.classes[pick.cls]!;
      const sFit = fit(pick.cls);
      const r = this.rect(pick);
      const inside = pick.shown && C.x0[k]! >= r.x && C.y0[k]! >= r.y && C.x1[k]! <= r.x + r.w && C.y1[k]! <= r.y + r.h;
      // Keep the placement while the cluster stays inside and the scale is not much below what it could be.
      if (!inside || pick.s < sFit / 1.3 || pick.s > sFit) {
        const s = sFit;
        const cw = K.w / s;
        const ch = K.h / s;
        const cx = (C.x0[k]! + C.x1[k]!) / 2;
        const cy = (C.y0[k]! + C.y1[k]!) / 2;
        this.place(pick, Math.round(cx - cw / 2), Math.round(cy - ch / 2), s);
      }
      this.show(pick, true);
    }
  }

  /**
   * A free canvas for a w×h cluster: a shown, unassigned one that fits at ≥ 80 % of `sT` and is not
   * over 3× the wanted area (no Paint); else a hidden one of the wanted class (or the smallest bigger
   * one); showing it may first hide an idle shown canvas (at most `maxShown` are shown: GPU layers).
   */
  private freeSlot(want: number, sT: number, w: number, h: number, sMax: number): Slot | null {
    const area = (sl: Slot): number => this.classes[sl.cls]!.w * this.classes[sl.cls]!.h;
    const wantArea = this.classes[want]!.w * this.classes[want]!.h;
    const fits = (sl: Slot): boolean => quantScale(Math.min(this.classes[sl.cls]!.w / w, this.classes[sl.cls]!.h / h), sMax) >= sT * 0.8 - 1e-9;
    let best: Slot | null = null;
    for (const sl of this.slots) if (sl.shown && sl.cluster < 0 && fits(sl) && area(sl) <= wantArea * 3 && (!best || area(sl) < area(best))) best = sl;
    if (best) return best;
    for (const sl of this.slots) if (!sl.shown && sl.cls === want) return this.makeRoom(sl);
    for (const sl of this.slots) if (!sl.shown && fits(sl) && (!best || area(sl) < area(best))) best = sl;
    if (best) return this.makeRoom(best);
    // Nothing fits: any free canvas (a softer scale beats not drawing).
    for (const sl of this.slots) if (sl.cluster < 0 && (sl.shown || !best || area(sl) > area(best))) best = sl;
    return best && !best.shown ? this.makeRoom(best) : best;
  }

  /** Before showing `sl`: hide an idle shown canvas when `maxShown` are already shown. */
  private makeRoom(sl: Slot): Slot | null {
    let n = 0;
    for (const x of this.slots) if (x.shown) n++;
    if (n < this.o.maxShown) return sl;
    let drop: Slot | null = null;
    for (const x of this.slots) if (x.shown && x.cluster < 0 && (!drop || x.idle > drop.idle)) drop = x;
    if (!drop) return null;
    this.show(drop, false);
    return sl;
  }

  private clear(sl: Slot): void {
    if (sl.clearAll) {
      sl.ctx.setTransform(1, 0, 0, 1, 0, 0);
      sl.ctx.clearRect(0, 0, sl.canvas.width, sl.canvas.height);
      sl.clearAll = false;
      sl.dirty = false;
      return;
    }
    if (!sl.dirty) return;
    sl.ctx.setTransform(1, 0, 0, 1, 0, 0);
    sl.ctx.clearRect(sl.dx0 - 2, sl.dy0 - 2, sl.dx1 - sl.dx0 + 4, sl.dy1 - sl.dy0 + 4);
    sl.dirty = false;
  }

  /** Start a frame: clear what each shown canvas drew last time (and empty the ones without a cluster). */
  begin(): void {
    for (const sl of this.slots) {
      if (!sl.shown) continue;
      const had = sl.dirty || sl.clearAll;
      this.clear(sl);
      sl.dx0 = sl.dy0 = Infinity;
      sl.dx1 = sl.dy1 = -Infinity;
      sl.blend = -1;
      if (sl.cluster >= 0) {
        this.uploadPx += sl.canvas.width * sl.canvas.height;
        this.drawn++;
      } else {
        // Emptied this frame: one more upload (the clear); then nothing until it is used or hidden.
        if (had) this.uploadPx += sl.canvas.width * sl.canvas.height;
        if (++sl.idle > EMPTY_HIDE_FRAMES) this.show(sl, false);
      }
    }
  }

  /** Slot for a cluster (after `assign`). */
  slot(cluster: number): Slot | null {
    const i = this.slotOf[cluster]!;
    return i >= 0 ? this.slots[i]! : null;
  }

  /** Grow a slot's drawn box by a layer-px box (stored in backing px). */
  mark(sl: Slot, x0: number, y0: number, x1: number, y1: number): void {
    const s = sl.s;
    const a = (x0 - sl.x) * s;
    const b = (y0 - sl.y) * s;
    const c = (x1 - sl.x) * s;
    const d = (y1 - sl.y) * s;
    if (a < sl.dx0) sl.dx0 = a;
    if (b < sl.dy0) sl.dy0 = b;
    if (c > sl.dx1) sl.dx1 = c;
    if (d > sl.dy1) sl.dy1 = d;
    sl.dirty = true;
  }

  /** Idle: hide every canvas and free the backing stores (unless retained; big ones are always freed). */
  hideAll(free: boolean): void {
    for (const sl of this.slots) {
      this.show(sl, false);
      sl.dirty = false;
      sl.clearAll = true;
      const K = this.classes[sl.cls]!;
      if ((free || K.w * K.h > RETAIN_MAX_PX) && sl.sized) {
        sl.canvas.width = 0;
        sl.canvas.height = 0;
        sl.sized = false;
      }
    }
  }

  get anyShown(): boolean {
    return this.slots.some((s) => s.shown);
  }

  stats(): PresentStats {
    let union: RectLike | null = null;
    let shown = 0;
    const slots = this.slots.map((sl) => {
      const r = this.rect(sl);
      if (sl.shown) {
        shown++;
        union = union
          ? { x: Math.min(union.x, r.x), y: Math.min(union.y, r.y), width: Math.max(union.x + union.width, r.x + r.w) - Math.min(union.x, r.x), height: Math.max(union.y + union.height, r.y + r.h) - Math.min(union.y, r.y) }
          : { x: r.x, y: r.y, width: r.w, height: r.h };
      }
      return { cls: this.classes[sl.cls]!.name, x: r.x, y: r.y, w: r.w, h: r.h, s: sl.s, shown: sl.shown };
    });
    return { shown, union, slots, uploadPx: this.uploadPx, drawn: this.drawn, toggles: this.toggles };
  }

  resetStats(): void {
    this.uploadPx = this.drawn = this.toggles = 0;
  }

  dispose(): void {
    for (const sl of this.slots) sl.canvas.remove();
    this.slots.length = 0;
  }
}
