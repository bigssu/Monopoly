/**
 * Flying coins (docs/MONEY-EVENTS.md §3, research 06 §2.2 / §7): a pool of 16 DOM nodes inside the
 * stage's foreground layer, created once and reused. Each flight:
 *
 *   spawn hop (5 frames, gravity-like, up and a little sideways)
 *   → quadratic Bézier to the target (control point 0.15–0.25 × distance off the chord, bent
 *     toward the screen centre), eased in (t^1.6: slow out of the hop, sucked into the target)
 *   → land callback (pile +1, number up, clink, burst).
 *
 * Height is faked with scale (1 + 0.25·sin(pi·s)) — 2D `translate() scale()` only, so coins never get
 * their own compositor layers (translateZ would promote each one). The coin spins by stepping the
 * baked 8-frame strip (`background-position`). ONE ground-shadow ellipse per stream follows the
 * stream's coins on the chord. All motion runs on the scene clock (MoneyClock: pause / skip / speed /
 * manual stepping); with reduced motion the coins stay hidden but land on time (sound + numbers).
 */
import { atlasReady, coinAnim, frameBox } from './atlas';
import { FRAME, type MoneyClock } from './clock';
import type { Metal } from './denom';
import { outQuad } from '../vfx/ease';
import { mulberry32 } from '../vfx/rng';

export interface Pt {
  x: number;
  y: number;
}

/** Pool size: never more coin nodes than this (research 06 §7.1). */
export const POOL_SIZE = 16;
/** Shadow ellipses (one per concurrent stream). */
export const SHADOWS = 4;
/** Default spawn hop / travel (frames). */
const HOP_F = 6;
const TRAVEL_F = 15;
const SPIN_MS = 50;
const SPIN_N = 8;
const NOMINAL = 48;

interface FlightSpec {
  from: Pt;
  /** Target (re-evaluated every frame, so a growing pile's top can move). */
  to: Pt | (() => Pt);
  metal: Metal;
  /** Coin display size (CSS px of the nominal 48-px sprite box). */
  size: number;
  /** Scene time (ms) the coin leaves. */
  at: number;
  /** Stream id (shared shadow). */
  stream?: number;
  /** Arc bend: signed fraction of the distance (default: seeded 0.15–0.25 toward the centre). */
  bend?: number;
  hopF?: number;
  travelF?: number;
  /** Hop direction (unit vector, default: "up" = away from the target's side, randomised). */
  hop?: Pt;
  /** Hop length (px; default 0.5–0.85 × the coin size). */
  hopSize?: number;
  /** Called once when the coin lands (at its scene time, even when hidden). */
  onLand?: () => void;
  /** Drawn in front at landing (the pile keeps it). */
  keep?: boolean;
}

interface Active extends FlightSpec {
  node: HTMLElement | null;
  hopV: Pt;
  bendK: number;
  spin0: number;
  landed: boolean;
  lastFrame: number;
  gx: number;
  gy: number;
  lift: number;
  flying: boolean;
}

export class CoinPool {
  readonly nodes: HTMLElement[] = [];
  readonly shadows: HTMLElement[] = [];
  private free: HTMLElement[] = [];
  private active: Active[] = [];
  private rand = mulberry32(1234).next;
  private stop: (() => void) | null = null;
  /** The clock the frame step is registered on (a new scene clock re-arms). */
  private armedOn: MoneyClock | null = null;
  /** Hide coins (reduced motion): flights still land on time. */
  hidden = false;
  /** Screen centre (for the arc bend side). */
  center: Pt = { x: 0, y: 0 };
  /** Peak simultaneous flights and peak nodes in use (perf checks). */
  peakFlying = 0;
  peakNodes = 0;

  constructor(
    layer: HTMLElement,
    private clock: () => MoneyClock | null,
  ) {
    const doc = layer.ownerDocument;
    for (let i = 0; i < SHADOWS; i++) {
      const s = doc.createElement('i');
      s.className = 'mc-sh';
      layer.append(s);
      this.shadows.push(s);
    }
    for (let i = 0; i < POOL_SIZE; i++) {
      const n = doc.createElement('i');
      n.className = 'mc';
      layer.append(n);
      this.nodes.push(n);
      this.free.push(n);
    }
  }

  /** Coins in flight right now. */
  get flying(): number {
    return this.active.filter((a) => a.flying).length;
  }

  get inUse(): number {
    return POOL_SIZE - this.free.length;
  }

  /** Re-seed (deterministic filmstrips / tests). */
  seed(s: number): void {
    this.rand = mulberry32(s).next;
  }

  /** Schedule a flight. With no scene clock (the scene was cut short) it lands at once. */
  launch(spec: FlightSpec): void {
    if (!this.clock()) {
      queueMicrotask(() => spec.onLand?.());
      return;
    }
    const r = this.rand;
    const to = typeof spec.to === 'function' ? spec.to() : spec.to;
    const dx = to.x - spec.from.x;
    const dy = to.y - spec.from.y;
    const len = Math.hypot(dx, dy) || 1;
    // Bend toward the screen centre (or alternate when the chord passes through it).
    let bendK = spec.bend ?? 0;
    if (spec.bend === undefined) {
      const mx = (spec.from.x + to.x) / 2 - this.center.x;
      const my = (spec.from.y + to.y) / 2 - this.center.y;
      const nx = -dy / len;
      const ny = dx / len;
      const side = mx * nx + my * ny;
      const sign = Math.abs(side) < len * 0.05 ? (r() < 0.5 ? -1 : 1) : side > 0 ? -1 : 1;
      bendK = sign * (0.15 + r() * 0.1);
    }
    // Hop: up and away from the target, ±25° random.
    let hop = spec.hop;
    if (!hop) {
      const a = Math.atan2(-dy, -dx) * 0.35 + -Math.PI / 2 * 0.65 + (r() - 0.5) * 0.9;
      hop = { x: Math.cos(a), y: Math.sin(a) };
    }
    const h = (spec.hopSize ?? spec.size) * (0.5 + r() * 0.35);
    this.active.push({
      ...spec,
      node: null,
      hopV: { x: hop.x * h, y: hop.y * h },
      bendK,
      spin0: Math.floor(r() * SPIN_N),
      landed: false,
      lastFrame: -1,
      gx: spec.from.x,
      gy: spec.from.y,
      lift: 0,
      flying: false,
    });
    this.arm();
  }

  /** Drop every flight (scene cancelled); landing callbacks of pending flights do not fire. */
  clear(): void {
    for (const a of this.active) this.release(a);
    this.active = [];
    for (const s of this.shadows) s.style.opacity = '0';
    this.stop?.();
    this.stop = null;
    this.armedOn = null;
  }

  /** Land everything now (scene clock dropped / headless): callbacks fire in order. */
  flush(): void {
    this.stop?.();
    this.stop = null;
    this.armedOn = null;
    const list = this.active;
    this.active = [];
    for (const a of list) {
      this.release(a);
      if (!a.landed) {
        a.landed = true;
        a.onLand?.();
      }
    }
    for (const s of this.shadows) s.style.opacity = '0';
  }

  private arm(): void {
    const c = this.clock();
    if (!c || (this.stop && this.armedOn === c)) return;
    this.stop?.();
    this.armedOn = c;
    this.stop = c.add((t) => this.tick(t));
  }

  private take(): HTMLElement | null {
    const n = this.free.pop() ?? null;
    if (n) this.peakNodes = Math.max(this.peakNodes, POOL_SIZE - this.free.length);
    return n;
  }

  private release(a: Active): void {
    if (!a.node) return;
    a.node.style.transform = 'translate(-9999px,0)';
    a.node.style.opacity = '0';
    this.free.push(a.node);
    a.node = null;
  }

  /** One frame at scene time `t`. Returns false when nothing is left. */
  tick(t: number): boolean {
    const streams = new Map<number, { x: number; y: number; lift: number; n: number }>();
    let flying = 0;
    const done: Active[] = [];
    for (const a of this.active) {
      if (t < a.at) continue;
      const hopMs = (a.hopF ?? HOP_F) * FRAME;
      const travelMs = (a.travelF ?? TRAVEL_F) * FRAME;
      const e = t - a.at;
      const to = typeof a.to === 'function' ? a.to() : a.to;
      if (e >= hopMs + travelMs - 1e-6) {
        done.push(a);
        continue;
      }
      a.flying = true;
      flying++;
      let x: number;
      let y: number;
      let s: number;
      if (e < hopMs) {
        const u = outQuad(e / hopMs);
        x = a.from.x + a.hopV.x * u;
        y = a.from.y + a.hopV.y * u;
        s = 1 + 0.18 * Math.sin((Math.PI / 2) * u);
        a.gx = a.from.x;
        a.gy = a.from.y;
        a.lift = 0.6 * u;
      } else {
        const u = (e - hopMs) / travelMs;
        // Slow in and slow out along the arc (no linear motion, §12).
        const k = 0.5 - 0.5 * Math.cos(Math.PI * u);
        const p0x = a.from.x + a.hopV.x;
        const p0y = a.from.y + a.hopV.y;
        const dx = to.x - p0x;
        const dy = to.y - p0y;
        const len = Math.hypot(dx, dy) || 1;
        const cx = (p0x + to.x) / 2 + (-dy / len) * a.bendK * len;
        const cy = (p0y + to.y) / 2 + (dx / len) * a.bendK * len;
        const m = 1 - k;
        x = m * m * p0x + 2 * m * k * cx + k * k * to.x;
        y = m * m * p0y + 2 * m * k * cy + k * k * to.y;
        const lift = Math.sin(Math.PI * k);
        s = (1 + 0.25 * lift) * (1 + 0.18 * (1 - k));
        a.gx = a.from.x + (to.x - a.from.x) * k;
        a.gy = a.from.y + (to.y - a.from.y) * k;
        a.lift = lift;
      }
      if (!this.hidden) {
        if (!a.node) a.node = this.take();
        if (a.node) this.draw(a, x, y, s, e);
      }
      const sid = a.stream ?? 0;
      const st = streams.get(sid) ?? { x: 0, y: 0, lift: 0, n: 0 };
      st.x += a.gx;
      st.y += a.gy;
      st.lift += a.lift;
      st.n++;
      streams.set(sid, st);
    }
    this.peakFlying = Math.max(this.peakFlying, flying);
    if (done.length) {
      this.active = this.active.filter((a) => !done.includes(a));
      for (const a of done) {
        a.flying = false;
        this.release(a);
        if (!a.landed) {
          a.landed = true;
          a.onLand?.();
        }
      }
    }
    // Shared ground shadows: one per stream, at its coins' mean chord point.
    let si = 0;
    if (!this.hidden) {
      for (const [, st] of streams) {
        if (si >= this.shadows.length) break;
        const sh = this.shadows[si++]!;
        const lift = st.lift / st.n;
        const w = Math.min(3.2, 1 + st.n * 0.22);
        sh.style.opacity = String(Math.min(0.5, 0.18 + st.n * 0.04) * (1 - 0.4 * lift));
        sh.style.transform = `translate(${(st.x / st.n).toFixed(1)}px,${(st.y / st.n + this.size() * 0.35).toFixed(1)}px) scale(${(w * (1 - 0.25 * lift)).toFixed(3)},${(1 - 0.25 * lift).toFixed(3)})`;
      }
    }
    for (; si < this.shadows.length; si++) if (this.shadows[si]!.style.opacity !== '0') this.shadows[si]!.style.opacity = '0';
    if (!this.active.length) {
      this.stop = null;
      this.armedOn = null;
      return false;
    }
    return true;
  }

  private lastSize = 40;
  private size(): number {
    return this.lastSize;
  }

  private draw(a: Active, x: number, y: number, s: number, e: number): void {
    const n = a.node!;
    const st = n.style;
    const scale = a.size / NOMINAL;
    this.lastSize = a.size;
    const fr = (a.spin0 + Math.floor(e / SPIN_MS)) % SPIN_N;
    if (fr !== a.lastFrame || st.opacity !== '1') {
      if (atlasReady()) {
        const b = frameBox(coinAnim(a.metal), fr, scale);
        if (b && a.lastFrame < 0) {
          st.width = `${b.width}px`;
          st.height = `${b.height}px`;
          st.backgroundImage = b.url;
          st.backgroundSize = b.size;
        }
        if (b) st.backgroundPosition = b.pos;
        n.dataset.m = '';
      } else if (a.lastFrame < 0) {
        st.width = `${a.size}px`;
        st.height = `${a.size}px`;
        st.backgroundImage = '';
        n.dataset.m = a.metal;
      }
      a.lastFrame = fr;
      st.opacity = '1';
    }
    st.transform = `translate(${(x - a.size / 2).toFixed(1)}px,${(y - a.size / 2).toFixed(1)}px) scale(${s.toFixed(3)})`;
  }
}
