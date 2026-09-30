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
import { S_FLAGS, S_H, S_S, S_W, S_X, S_Y, SF_CLEAR, SF_SHOWN, SREC } from './paint';

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

export interface Slot {
  cls: number;
  /** The canvas element (its pixels belong to the backend: a main-thread context or a worker). */
  el: HTMLCanvasElement;
  shown: boolean;
  /** Has a backing store of the class size (freed while hidden unless retained). */
  sized: boolean;
  /** Placement on the layer (CSS px) and backing scale. */
  x: number;
  y: number;
  s: number;
  /** Cluster index assigned this frame (-1 = none). */
  cluster: number;
  /** Had a cluster last frame (its content is on screen). */
  used: boolean;
  /** Clear everything before the next paint (just shown: parked content is stale). */
  clearAll: boolean;
  /** Frames shown without a cluster. */
  idle: number;
}

export interface PresentStats {
  shown: number;
  /** Union of the shown canvases' rects (layer px). */
  union: RectLike | null;
  slots: Array<{ cls: string; x: number; y: number; w: number; h: number; s: number; shown: boolean }>;
  /** Backing px uploaded (canvases painted) since the last reset, and canvas frames painted. */
  uploadPx: number;
  drawn: number;
  /** show/hide toggles (each is one Paint). */
  toggles: number;
}

export interface PresenterOptions {
  layer: HTMLElement;
  /** Most canvases shown at once (each is a GPU layer). */
  maxShown: number;
  classes?: readonly SlotClass[];
  pool?: readonly number[];
}

/** Backing stores above this size are freed when the engine goes idle even with `retain`. */
const RETAIN_MAX_PX = 160e3;
/** Hide a shown canvas that has had no cluster for this many drawn frames (frees its layer). */
const EMPTY_HIDE_FRAMES = 45;

/**
 * The pooled canvases' DOM side: assignment of clusters to canvases, placement (transform),
 * parking (visibility). Pixels are painted by the backend from `writeStates()` + the engine's list.
 */
export class Presenter {
  readonly slots: Slot[] = [];
  readonly classes: readonly SlotClass[];
  readonly clusterer = new Clusterer();
  private uploadPx = 0;
  private drawn = 0;
  private toggles = 0;
  /** Cluster → slot index for the current frame. */
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
      c.width = 0;
      c.height = 0;
      o.layer.append(c);
      this.slots.push({ cls, el: c, shown: false, sized: false, x: 0, y: 0, s: 1, cluster: -1, used: false, clearAll: true, idle: 0 });
    }
  }

  private show(sl: Slot, on: boolean): void {
    if (sl.shown === on) return;
    sl.shown = on;
    this.toggles++;
    if (on) {
      sl.sized = true;
      sl.clearAll = true;
      sl.idle = 0;
      sl.el.style.visibility = 'visible';
    } else {
      sl.el.style.visibility = 'hidden';
      sl.cluster = -1;
      sl.used = false;
    }
  }

  private place(sl: Slot, x: number, y: number, s: number): void {
    if (sl.x === x && sl.y === y && sl.s === s) return;
    sl.x = x;
    sl.y = y;
    sl.s = s;
    sl.el.style.transform = `translate(${x}px,${y}px) scale(${1 / s})`;
  }

  /** Rect (layer px) a slot covers. */
  private rect(sl: Slot): { x: number; y: number; w: number; h: number } {
    const k = this.classes[sl.cls]!;
    return { x: sl.x, y: sl.y, w: k.w / sl.s, h: k.h / sl.s };
  }

  /**
   * Assign the clusters of this frame to canvases (placing / rescaling / showing them).
   * `sMax` = the crisp backing scale (min(1.5, DPR)); `budget` = backing px per frame that sets the
   * scale of large clusters.
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
        if (!sl.shown || sl.cluster >= 0 || !sl.used) continue;
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
    // Bookkeeping: uploads (a painted canvas is copied whole), emptied canvases, idle ones parked.
    for (const sl of this.slots) {
      if (!sl.shown) continue;
      const px = this.classes[sl.cls]!.w * this.classes[sl.cls]!.h;
      if (sl.cluster >= 0) {
        this.uploadPx += px;
        this.drawn++;
      } else {
        if (sl.used) this.uploadPx += px; // one more paint: the clear
        if (++sl.idle > EMPTY_HIDE_FRAMES) this.show(sl, false);
      }
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

  /** Slot index for a cluster (after `assign`), -1 when none. */
  slotIndex(cluster: number): number {
    return this.slotOf[cluster]!;
  }

  /**
   * Per-canvas state for the painter (paint.ts SREC floats each): backing size (0 × 0 = freed),
   * placement, flags. Consumes the one-shot clear flags.
   */
  writeStates(out: Float32Array): void {
    for (let k = 0; k < this.slots.length; k++) {
      const sl = this.slots[k]!;
      const K = this.classes[sl.cls]!;
      const o = k * SREC;
      out[o + S_W] = sl.sized ? K.w : 0;
      out[o + S_H] = sl.sized ? K.h : 0;
      out[o + S_X] = sl.x;
      out[o + S_Y] = sl.y;
      out[o + S_S] = sl.s;
      out[o + S_FLAGS] = (sl.shown ? SF_SHOWN : 0) | (sl.clearAll ? SF_CLEAR : 0);
      if (sl.shown) {
        sl.clearAll = false;
        sl.used = sl.cluster >= 0;
      }
    }
  }

  /** Idle: hide every canvas; free the backing stores (unless retained — big ones are always freed). Call `writeStates` after. */
  hideAll(free: boolean): void {
    for (const sl of this.slots) {
      this.show(sl, false);
      sl.clearAll = true;
      const K = this.classes[sl.cls]!;
      if (free || K.w * K.h > RETAIN_MAX_PX) sl.sized = false;
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
    for (const sl of this.slots) sl.el.remove();
    this.slots.length = 0;
  }
}
