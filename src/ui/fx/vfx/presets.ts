/**
 * Effect presets (VFX.md §7.5 dictionary, frame-exact beats from §7.2b), built as timelines of
 * 30 fps FX frames. Only manifest animation names are used (`FxAnimName`); colours come from the
 * acting player's palette (owner = "whose", gold = money/reward, grey = loss). No text is ever
 * drawn on the canvas — number pops go through the injected `dom.floatText`.
 *
 * Each builder reads anchor positions once (coords snapshot) and returns a `Timeline`; spawn
 * counts stay within the tier caps (I0 ≤ 8, I1 ≤ 40, I2 ≤ 100, I3 ≤ 200, I4 ≤ 300), which
 * `__tests__/presets.test.ts` checks and the runner enforces.
 */
import type { PlayerId, Seat } from '@/engine';
import type { FxAnimName } from '@/content/fx/manifest';
import type { Coords, Pt } from './coords';
import { seatLocal, SEAT_ANGLE } from './coords';
import { c1ForOvershoot, Ease, PIP_C1, POP_C1, TIER_POP } from './ease';
import type { PSpec } from './particles';
import { PRIORITY } from './pool';
import {
  block,
  Bounds,
  burst,
  cue,
  dom,
  flash,
  haptic,
  hitStop,
  semi,
  sfx,
  shake,
  spawn,
  t,
  timeline,
  type Action,
  type HighlightTarget,
  type Op,
  type Tier,
  type Timeline,
} from './timeline';

// Palette ---------------------------------------------------------------------------------------
export const GOLD = '#F2B633';
export const GOLD_HI = '#FFD45C';
export const WHITE = '#FFFFFF';
/** "White" sparkles on the cream board: a warm near-white that still reads on #EEE3CD. */
const SPARK_WHITE = '#FFF4C8';
export const GREEN = '#7BE0A4';
const GIFT = '#9BE7B4';
export const SKY = '#6EC6F0';
const RED = '#E8564F';
const GREY = '#8E97A6';
const DUST = '#E8DCC6';
const SMOKE = '#DDE2EA';
const CONFETTI = ['#E8564F', '#4A6CF7', '#3DBB6E', '#F2B633', '#9B6BF2', '#F5844A', '#2EC4B6', '#F272A8'] as const;
const CONFETTI_SHAPES: readonly FxAnimName[] = ['confetti_rect', 'confetti_streamer', 'confetti_dot', 'confetti_tri', 'confetti_diamond'];

export interface PresetEnv {
  c: Coords;
  /** Player colour (hex). */
  color(id: PlayerId): string;
}

/** Anchor in board terms. */
export type Anchor = { space: number } | { panel: PlayerId } | { stage: true } | { x: number; y: number };

// Builder -------------------------------------------------------------------------------------

class B {
  readonly ops: Op[] = [];
  readonly bb = new Bounds();
  readonly u: number;
  constructor(readonly env: PresetEnv) {
    this.u = env.c.u;
  }
  at(f: number, ...a: Action[]): this {
    for (const x of a) this.ops.push(t(f, x));
    return this;
  }
  /** Reserve canvas area around p (radius in u). */
  area(p: Pt, ru = 2): this {
    this.bb.add(p.x, p.y, ru * this.u);
    return this;
  }
  pt(a: Anchor): Pt {
    const c = this.env.c;
    if ('space' in a) return c.space(a.space);
    if ('panel' in a) return c.panel(a.panel);
    if ('stage' in a) return c.center();
    return a;
  }
  build(name: string, tier: Tier, priority: number, highlight?: HighlightTarget): Timeline {
    return timeline(name, tier, priority, this.ops, this.bb.rect(), highlight);
  }
}

const add = (p: Pt, x: number, y: number): Pt => ({ x: p.x + x, y: p.y + y });
/** Point offset in a seat's local frame (units of u). */
const local = (b: B, p: Pt, seat: Seat, x: number, y: number): Pt => {
  const v = seatLocal(seat, x * b.u, y * b.u);
  return add(p, v.x, v.y);
};
const ringPoint = (e: { rng: { next(): number } }, r: number, k: number, n: number): Pt => {
  const a = ((k + e.rng.next() * 0.8) / n) * Math.PI * 2;
  const rr = r * (0.55 + 0.45 * e.rng.next());
  return { x: Math.cos(a) * rr, y: Math.sin(a) * rr };
};

// Sub-builders (all frames relative to the timeline) -------------------------------------------

/** `sparkle4` field: n sparkles within radius r (u) of p, staggered. */
function sparkles(
  b: B,
  p: Pt,
  n: number,
  f: number,
  o: { r?: number; color?: string | readonly string[]; stagger?: number; s?: number; life?: number; add?: boolean } = {},
): void {
  const r = (o.r ?? 0.6) * b.u;
  const stagger = o.stagger ?? 1;
  b.area(p, (o.r ?? 0.6) + 1);
  b.at(
    f,
    burst(n, (k, nn, e) => {
      const q = ringPoint(e, r, k, nn);
      const col = o.color ?? GOLD;
      return {
        anim: 'sparkle4',
        x: p.x + q.x,
        y: p.y + q.y,
        delay: Math.round(k * stagger),
        life: o.life ?? 9,
        fit: true,
        s: (o.s ?? 0.55) * (0.8 + 0.4 * e.rng.next()),
        rot: e.rng.jitter(20),
        tint: typeof col === 'string' ? col : col[k % col.length]!,
        blend: o.add ? 'add' : 'normal',
        layer: 3,
      };
    }),
  );
}

function ring(b: B, p: Pt, f: number, color: string, s = 1, life = 9, add = false): void {
  b.area(p, 2.2 * s);
  // Frames 1..5 over the life (frame 0 is a filled dot that reads as a blob at large scales).
  b.at(f, spawn((e) => void e.emit({ anim: 'ring_shock', x: p.x, y: p.y, life, frame: 1, fps: (5 * 30) / life, s, tint: color, blend: add ? 'add' : 'normal', layer: 2 })));
}

function starBurst(b: B, p: Pt, f: number, color: string, s = 1): void {
  b.area(p, 2.2 * s);
  b.at(f, spawn((e) => void e.emit({ anim: 'star_burst', x: p.x, y: p.y, life: 11, fit: true, s, tint: color, layer: 2 })));
}

function glow(b: B, p: Pt, f: number, color: string, o: { s?: number; a?: number; life?: number; fadeIn?: number; fadeOut?: number; add?: boolean } = {}): void {
  b.area(p, 1.2 * (o.s ?? 1.5));
  b.at(
    f,
    spawn(
      (e) =>
        void e.emit({
          anim: 'glow',
          x: p.x,
          y: p.y,
          life: o.life ?? 20,
          s: o.s ?? 1.5,
          a: o.a ?? 0.5,
          fadeIn: o.fadeIn ?? 4,
          fadeOut: o.fadeOut ?? 8,
          tint: color,
          blend: o.add === false ? 'normal' : 'add',
          layer: 0,
        }),
    ),
  );
}

function dust(b: B, p: Pt, f: number, s = 1, color = DUST, n = 1, ringR = 0, stagger = 0): void {
  b.area(p, 1.8 * s + ringR);
  b.at(
    f,
    burst(n, (k, nn, e) => {
      const q = n > 1 ? { x: Math.cos((k / nn) * Math.PI * 2 + 0.4) * ringR * b.u, y: Math.sin((k / nn) * Math.PI * 2 + 0.4) * ringR * b.u } : { x: 0, y: 0 };
      return {
        anim: 'dust_puff',
        x: p.x + q.x,
        y: p.y + q.y + 0.15 * b.u,
        delay: Math.floor(k * stagger),
        life: 12,
        fit: true,
        s: s * (0.9 + 0.2 * e.rng.next()),
        rot: e.rng.jitter(10),
        tint: color,
        layer: 2,
      };
    }),
  );
}

function smoke(b: B, p: Pt, f: number, n = 1, gap = 3, color = SMOKE, seat: Seat = 'S'): void {
  const up = seatLocal(seat, 0, -1);
  b.area(p, 2.5);
  b.at(
    f,
    burst(n, (k, _n, e) => ({
      anim: 'smoke',
      x: p.x + e.rng.jitter(0.25 * b.u) + up.x * 0.3 * b.u,
      y: p.y + e.rng.jitter(0.25 * b.u) + up.y * 0.3 * b.u,
      vx: up.x * 0.9 * b.u + e.rng.jitter(0.2 * b.u),
      vy: up.y * 0.9 * b.u + e.rng.jitter(0.2 * b.u),
      delay: k * gap,
      life: 16,
      fit: true,
      s: 0.45,
      s1: 0.75,
      a: 0.8,
      fadeOut: 5,
      tint: color,
      layer: 1,
    })),
  );
}

/** Hammer (rotated to the actor's seat) with `hits` contacts at f + first + k·gap. */
function hammer(b: B, p: Pt, seat: Seat, f: number, first: number, gap: number, hits: number, s = 0.8): void {
  // Pivot at the handle end; the head strikes the tile centre at +20°.
  const unit = (b.u / 30) * s;
  // Head centre ≈ (0.66, 0.30) of the 64 px box, pivot (0.22, 0.86): offset at 0° = (28, −36)·unit;
  // at +20°: (39.6, −24.2)·unit. Pivot = target − that, in the seat's frame.
  const hit = { x: 39.6 * unit, y: -24.2 * unit };
  const target = local(b, p, seat, 0, -0.25);
  const v = seatLocal(seat, -hit.x, -hit.y);
  const pivot = add(target, v.x, v.y);
  b.area(pivot, 2.6);
  const life = first + (hits - 1) * gap + 9;
  b.at(
    f,
    spawn(
      (e) =>
        void e.emit({
          anim: 'hammer',
          x: pivot.x,
          y: pivot.y,
          life,
          s,
          rot: SEAT_ANGLE[seat],
          hammer: [first, gap, hits],
          anchor: [0.22, 0.86],
          fadeIn: 2,
          fadeOut: 5,
          layer: 3,
        }),
    ),
  );
}

/** Contact: hit lines + 3 brick chips + dust. */
function hitBurst(b: B, p: Pt, f: number, dustS: number, lines = 1): void {
  b.area(p, 2.4);
  const u = b.u;
  b.at(
    f,
    burst(lines, (k, _n, e) => ({ anim: 'hit_lines', x: p.x, y: p.y - 0.2 * u, life: 6, fit: true, s: 0.9 + 0.25 * k, rot: e.rng.jitter(40) + k * 45, tint: WHITE, layer: 3 })),
    burst(3, (k, _n, e) => {
      const a = -Math.PI / 2 + (k - 1) * 0.9 + e.rng.jitter(0.3);
      const sp = e.rng.range(6, 9) * u;
      return {
        anim: 'brick_chip',
        frame: k % 3,
        x: p.x,
        y: p.y - 0.2 * u,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        ay: 26 * u,
        life: 12,
        s: 0.7,
        vrot: e.rng.jitter(540),
        fadeOut: 3,
        layer: 3,
      };
    }),
  );
  dust(b, p, f, dustS * 0.8);
}

/**
 * Flight-time multiplier for coins that cross the table (toll, takeover price, Start salary,
 * payments): slow enough to follow with the eye. Purchase/build coins keep their 10 f because the
 * owner colour lands on a fixed cue right as they arrive.
 */
const COIN_FLIGHT = 2;

/** Coins on an arc (quadratic Bézier bulging toward the board centre). */
function coinArc(
  b: B,
  from: Pt,
  to: Pt,
  n: number,
  f: number,
  o: { frames?: number; stagger?: number; s?: number; comet?: boolean; side?: 1 | -1 } = {},
): { first: number; last: number } {
  const frames = o.frames ?? 10;
  const stagger = o.stagger ?? 1;
  const s = o.s ?? 0.62;
  const c = b.env.c.center();
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy) || 1;
  let px = -dy / d;
  let py = dx / d;
  if ((c.x - mx) * px + (c.y - my) * py < 0) {
    px = -px;
    py = -py;
  }
  if (o.side === -1) {
    px = -px;
    py = -py;
  }
  const lift = Math.max(0.28 * d, 1.5 * b.u);
  b.area(from, 1.2).area(to, 1.2).area({ x: mx + px * lift * 0.6, y: my + py * lift * 0.6 }, 1.5);
  const make = (k: number, e: { rng: { jitter(a: number): number; next(): number } }, comet: boolean): PSpec => {
    const j = 0.35 * b.u;
    const ctrlK = 0.8 + 0.4 * e.rng.next();
    const path = {
      x0: from.x + e.rng.jitter(j),
      y0: from.y + e.rng.jitter(j),
      cx: mx + px * lift * ctrlK + e.rng.jitter(j),
      cy: my + py * lift * ctrlK + e.rng.jitter(j),
      x1: to.x + e.rng.jitter(j * 0.6),
      y1: to.y + e.rng.jitter(j * 0.6),
      ease: Ease.InOutQuad,
      frames,
    };
    if (comet)
      return { anim: 'comet', path, align: true, rot: 180, delay: k * stagger, life: frames, s: s * 0.8, tint: GOLD_HI, blend: 'add', fadeOut: 3, layer: 1 };
    return {
      anim: 'coin_spin',
      path,
      frame: k * 3,
      delay: Math.round(k * stagger),
      life: frames + 1,
      s: s * 0.7,
      s1: s * 1.2,
      s2: s * 0.85,
      sT: 0.5,
      se1: Ease.OutQuad,
      se2: Ease.InQuad,
      fadeIn: 1,
      fadeOut: 2,
      layer: 2,
    };
  };
  b.at(f, burst(n, (k, _n, e) => make(k, e, false)));
  if (o.comet) b.at(f, burst(Math.min(6, n), (k, _n, e) => make(k, e, true)));
  return { first: f + frames, last: f + Math.round((n - 1) * stagger) + frames };
}

/** Arrival sparkles at `p` for coins arriving at frames first..first+(n−1)·stagger. */
function arrivals(b: B, p: Pt, n: number, fFirst: number, stagger: number, color = GOLD): void {
  b.area(p, 1.2);
  b.at(
    fFirst,
    burst(n, (k, _n, e) => ({
      anim: 'sparkle4',
      x: p.x + e.rng.jitter(0.5 * b.u),
      y: p.y + e.rng.jitter(0.5 * b.u),
      delay: Math.round(k * stagger),
      life: 8,
      fit: true,
      s: 0.5,
      tint: color,
      layer: 3,
    })),
  );
}

/** Tier pips: ★×level popping above the tile (popBack c1 2.17), tap pitch ladder. */
function pips(b: B, p: Pt, seat: Seat, level: number, f: number, gap = 2): void {
  const ladder = [0, 4, 7];
  for (let k = 0; k < level; k++) {
    const q = local(b, p, seat, (k - (level - 1) / 2) * 0.5, -1.05);
    b.area(q, 1);
    b.at(
      f + k * gap,
      spawn(
        (e) =>
          void e.emit({
            anim: 'gold_star',
            x: q.x,
            y: q.y,
            life: 16,
            s: 0.05,
            s1: 0.45,
            sT: 6 / 16,
            se1: Ease.OutBack,
            c1: PIP_C1,
            fadeOut: 5,
            rot: SEAT_ANGLE[seat],
            layer: 3,
          }),
      ),
      sfx('tap', { gain: 0.5, pitch: semi(ladder[k] ?? 0) }),
    );
  }
}

function flag(b: B, p: Pt, f: number, color: string, life: number, seat: Seat = 'S'): void {
  const q = local(b, p, seat, 0.55, -0.7);
  b.area(q, 1.5);
  b.at(
    f,
    spawn(
      (e) =>
        void e.emit({
          anim: 'flag_wave',
          x: q.x,
          y: q.y,
          life,
          s: 0.1,
          s1: 0.6,
          sT: 5 / life,
          se1: Ease.OutBack,
          c1: 2.17,
          fadeOut: 5,
          tint: color,
          rot: SEAT_ANGLE[seat],
          anchor: [0.2, 0.9],
          layer: 2,
        }),
    ),
  );
}

/** Confetti burst from p toward angle `dir` (deg, screen), ±spread, gravity along (gx, gy) (u/s²). */
function confetti(
  b: B,
  p: Pt,
  n: number,
  f: number,
  o: { dir: number; spread?: number; speed?: [number, number]; g?: [number, number]; colors: readonly string[]; weights?: readonly number[]; life?: [number, number]; stagger?: number; r?: number; drag?: number },
): void {
  const u = b.u;
  const spread = o.spread ?? 50;
  const [s0, s1] = o.speed ?? [9, 14];
  const [gx, gy] = o.g ?? [0, 22];
  const [l0, l1] = o.life ?? [24, 28];
  // Bounds: travel of the fastest particle under per-frame drag (Σ v·dt·0.9^k ≈ v·dt / 0.1) + gravity drift.
  const drag = o.drag ?? 0.9;
  const reach = s1 / 30 / (1 - drag) + (Math.hypot(gx, gy) / 30 / 30 / (1 - drag)) * 6 + 1;
  b.area(p, reach);
  b.at(
    f,
    burst(n, (k, _n, e) => {
      const a = ((o.dir + e.rng.jitter(spread)) * Math.PI) / 180;
      const sp = e.rng.range(s0, s1) * u;
      let col = o.colors[0]!;
      if (o.weights) {
        let r = e.rng.next();
        for (let i = 0; i < o.colors.length; i++) {
          r -= o.weights[i] ?? 0;
          if (r <= 0) {
            col = o.colors[i]!;
            break;
          }
        }
      } else col = o.colors[k % o.colors.length]!;
      const r0 = (o.r ?? 0.3) * u;
      return {
        anim: CONFETTI_SHAPES[k % CONFETTI_SHAPES.length]!,
        x: p.x + e.rng.jitter(r0),
        y: p.y + e.rng.jitter(r0),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        ax: gx * u,
        ay: gy * u,
        drag,
        delay: o.stagger ? Math.floor(k * o.stagger) : 0,
        life: Math.round(e.rng.range(l0, l1)),
        s: e.rng.range(0.6, 0.9),
        rot: e.rng.range(0, 360),
        vrot: e.rng.jitter(360),
        vflip: e.rng.range(8, 16),
        flip0: e.rng.range(0, 6.28),
        fadeOut: 6,
        tint: col,
        layer: 3,
      };
    }),
  );
}

function firework(b: B, p: Pt, f: number, color: string, s = 1, tails = 4): void {
  const u = b.u;
  b.area(p, 2.6 * s);
  b.at(
    f,
    spawn((e) => void e.emit({ anim: 'firework', x: p.x, y: p.y, life: 14, fit: true, s, tint: color, layer: 3 })),
    burst(tails, (k, nn, e) => {
      const a = (k / nn) * Math.PI * 2 + e.rng.jitter(0.4);
      return {
        anim: 'sparkle4',
        x: p.x + Math.cos(a) * 1.1 * u * s,
        y: p.y + Math.sin(a) * 1.1 * u * s,
        vy: 1.2 * u,
        ay: 3 * u,
        delay: 6,
        life: 12,
        fit: true,
        s: 0.4,
        tint: color,
        layer: 3,
      };
    }),
  );
}

function rays(b: B, p: Pt, f: number, color: string, life: number, o: { s0?: number; s1?: number; a?: number; spin?: number } = {}): void {
  b.area(p, 4 * (o.s1 ?? 1.5));
  b.at(
    f,
    spawn(
      (e) =>
        void e.emit({
          anim: 'ray_burst',
          x: p.x,
          y: p.y,
          life,
          s: o.s0 ?? 0.8,
          s1: o.s1 ?? 1.5,
          se1: Ease.OutQuad,
          a: o.a ?? 0.7,
          fadeIn: 4,
          fadeOut: Math.min(12, life / 2),
          rot: e.rng.range(0, 30),
          vrot: o.spin ?? 62,
          tint: color,
          blend: 'add',
          layer: 0,
        }),
    ),
  );
}

function comet(b: B, from: Pt, to: Pt, f: number, frames: number, color: string, s = 0.8, lift = 0.25): void {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  const cy = my - lift * d;
  b.area(from, 1.5).area(to, 1.5).area({ x: mx, y: cy }, 1.5);
  b.at(
    f,
    spawn(
      (e) =>
        void e.emit({
          anim: 'comet',
          path: { x0: from.x, y0: from.y, cx: mx, cy, x1: to.x, y1: to.y, ease: Ease.OutCubic, frames },
          align: true,
          life: frames + 2,
          s,
          fadeOut: 3,
          tint: color,
          blend: 'add',
          layer: 3,
        }),
    ),
  );
}

function siren(b: B, p: Pt, seat: Seat, f: number, life: number, s = 0.85): void {
  b.area(p, 1.6);
  b.at(f, spawn((e) => void e.emit({ anim: 'siren', x: p.x, y: p.y, life, s: 0.2, s1: s, sT: 4 / life, se1: Ease.OutBack, fps: 10, loop: true, rot: SEAT_ANGLE[seat], fadeOut: 4, layer: 3 })));
}

/** `gold_star` ×n flying from the tile to a panel (arc 18 f, stagger 2 f) + arrivals. */
function starToPanel(b: B, from: Pt, player: PlayerId, n: number, f: number): number {
  const to = b.env.c.panel(player);
  const frames = 18;
  const c = b.env.c.center();
  b.area(from, 1).area(to, 1.2);
  b.at(
    f,
    burst(n, (k, _n, e) => ({
      anim: 'gold_star',
      path: {
        x0: from.x + e.rng.jitter(0.3 * b.u),
        y0: from.y + e.rng.jitter(0.3 * b.u),
        cx: (from.x + to.x) / 2 + (c.x - (from.x + to.x) / 2) * 0.5 + e.rng.jitter(b.u),
        cy: (from.y + to.y) / 2 + (c.y - (from.y + to.y) / 2) * 0.5 + e.rng.jitter(b.u),
        x1: to.x,
        y1: to.y,
        ease: Ease.InOutQuad,
        frames,
      },
      delay: k * 2,
      life: frames + 1,
      s: 0.55,
      s1: 0.4,
      vrot: 240,
      fadeOut: 2,
      layer: 3,
    })),
  );
  arrivals(b, to, n, f + frames, 2, GOLD);
  for (let k = 0; k < n; k++) b.at(f + frames + k * 2, sfx('cash-in', { pitch: semi(k), gain: 0.6 }));
  b.at(f + frames, dom((d) => d.panelBump?.(player)));
  return f + frames + (n - 1) * 2;
}

// Presets -------------------------------------------------------------------------------------

interface PlotClaimParams {
  space: number;
  player: PlayerId;
  price: number;
  hub?: boolean;
  via?: 'buy' | 'auction';
}

/** L0 purchase (§7.2b.1): coins in, owner glow, tag drop + squash, ring, glint, price-tier sparkles. cue `frame` f10. */
export function plotClaim(p: PlotClaimParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const c = env.c;
  const tile = c.space(p.space);
  const owner = env.color(p.player);
  const seat = c.seat(p.player);
  const tier = p.price >= 800 || p.hub ? 3 : p.price >= 500 ? 2 : p.price >= 200 ? 1 : 0;
  const big = tier >= 2;
  const coins = [5, 8, 10, 12][tier]!;
  coinArc(b, c.panel(p.player), tile, coins, 0, { frames: 10 });
  b.at(0, sfx('cash-out', { gain: 0.7 }), haptic('tick'));
  glow(b, tile, 0, owner, { s: 1.6, a: 0.55, fadeIn: 6, life: 24, fadeOut: 8 });
  if (big) glow(b, tile, 10, GOLD, { s: 1.2, a: 0.45, fadeIn: 2, life: 12, fadeOut: 8 });
  // Tag drop (fall 4 f) → squash at landing (age 4) → swing.
  const top = local(b, tile, seat, 0, -1.8);
  const rest = local(b, tile, seat, 0, -0.15);
  b.area(top, 1.2);
  b.at(
    6,
    spawn(
      (e) =>
        void e.emit({
          anim: 'sale_tag',
          path: { x0: top.x, y0: top.y, cx: (top.x + rest.x) / 2, cy: (top.y + rest.y) / 2, x1: rest.x, y1: rest.y, ease: Ease.InQuad, frames: 4 },
          life: 18,
          s: 0.85,
          squash: [4, 1.25, 0.82],
          swing: [12, 1.6],
          rot: SEAT_ANGLE[seat],
          fadeIn: 3,
          fadeOut: 6,
          layer: 3,
        }),
    ),
  );
  b.at(10, cue('frame'), sfx('buy', big ? { pitch: semi(2) } : {}), haptic('success'), block());
  if (big) b.at(10, shake(tier >= 3 ? 4 : 3, tier >= 3 ? 240 : 200));
  if (p.via === 'auction') b.at(10, spawn((e) => void e.emit({ anim: 'hit_lines', x: rest.x, y: rest.y, life: 6, fit: true, s: 1.1, tint: WHITE, layer: 3 })));
  ring(b, tile, 10, owner, 1);
  if (big) ring(b, tile, 13, GOLD, 1.3);
  dust(b, tile, 10, 0.6, DUST, 2, 0.5);
  b.at(11, spawn((e) => void e.emit({ anim: 'glint_sweep', x: tile.x, y: tile.y, life: 9, fit: true, s: 0.9, a: 0.85, tint: GOLD_HI, blend: 'add', layer: 3 })));
  if (big) b.at(15, spawn((e) => void e.emit({ anim: 'glint_sweep', x: tile.x + 0.2 * b.u, y: tile.y, life: 9, fit: true, s: 0.9, a: 0.85, tint: GOLD_HI, blend: 'add', layer: 3 })));
  sparkles(b, tile, 3, 11, { r: 0.6, color: SPARK_WHITE });
  const gold = [0, 7, 11, 17][tier]!;
  if (gold) sparkles(b, tile, gold, 12, { r: 0.9, color: GOLD, stagger: 6 / gold });
  if (big) starBurst(b, tile, 14, GOLD, 0.7);
  if (tier >= 3) {
    b.at(14, spawn((e) => void e.emit({ anim: 'shine_cross', x: tile.x, y: tile.y, life: 10, fit: true, s: 0.8, tint: GOLD_HI, blend: 'add', layer: 3 })));
    const star = local(b, tile, seat, 0, -1.1);
    b.at(14, spawn((e) => void e.emit({ anim: 'gold_star', x: star.x, y: star.y, life: 14, s: 0.05, s1: 0.5, sT: 0.4, se1: Ease.OutBack, c1: PIP_C1, fadeOut: 5, layer: 3 })));
  }
  if (p.hub) {
    const a = local(b, tile, seat, -2.5, 0);
    const z = local(b, tile, seat, 2.5, 0);
    comet(b, a, z, 12, 10, GOLD_HI, 0.7, 0.05);
  }
  b.area(tile, 2.5);
  return b.build('plotClaim', big ? 2 : 1, PRIORITY.buy, { space: p.space });
}

interface CoinInParams {
  from: Anchor;
  to: Anchor;
  n?: number;
}

/** Delivery coins (the `coinArc` variant for payments): 10 f × COIN_FLIGHT, stagger 1 f, one `cash-out`. */
export function coinIn(p: CoinInParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const n = Math.min(12, p.n ?? 5);
  const to = b.pt(p.to);
  const r = coinArc(b, b.pt(p.from), to, n, 0, { frames: 10 * COIN_FLIGHT });
  b.at(0, sfx('cash-out', { gain: 0.7 }));
  dust(b, to, r.last, 0.5, DUST);
  return b.build('coinIn', 1, PRIORITY.misc, 'space' in p.to ? { space: p.to.space } : undefined);
}

interface BuildParams {
  space: number;
  player: PlayerId;
  level: 1 | 2 | 3 | 4;
  /** Free upgrade card (§7.2b.6): no coins / hammer, a gift comet instead. */
  free?: boolean;
  /** Where the gift comet starts (stage card), client px → default stage centre. */
  from?: Pt;
}

/** Hammer + hit schedule per level (§7.2b.2–4). */
const HITS: Record<1 | 2 | 3, { first: number; gap: number; swap: number; block: number }> = {
  1: { first: 5, gap: 4, swap: 6, block: 10 },
  2: { first: 4, gap: 4, swap: 9, block: 10 },
  3: { first: 4, gap: 4, swap: 13, block: 16 },
};

/** Tier layers after the swap (cumulative white → gold → owner), pips, chimney. `s` = swap frame. */
function tierReveal(b: B, tile: Pt, seat: Seat, owner: string, level: 1 | 2 | 3, s: number, space: number, freeShift = false): void {
  const pop = TIER_POP[level];
  b.at(s, cue('swap'), dom((d) => d.pop?.(space, { from: level === 1 ? 0.6 : 0.55, c1: pop.c1, frames: pop.frames })), dom((d) => d.dim?.(space, false)));
  if (level === 1) {
    ring(b, tile, s, owner, 0.8);
    sparkles(b, tile, 4, s + 1, { r: 0.6, color: SPARK_WHITE });
    pips(b, tile, seat, 1, s + 4);
    smoke(b, tile, s + 4, 1, 3, SMOKE, seat);
    return;
  }
  if (level === 2) {
    ring(b, tile, s, owner, 1);
    sparkles(b, tile, 4, s + 1, { r: 0.6, color: SPARK_WHITE });
    sparkles(b, tile, 6, s + 2, { r: 0.9, color: GOLD });
    b.at(s + 3, spawn((e) => void e.emit({ anim: 'glint_sweep', x: tile.x, y: tile.y, life: 9, fit: true, s: 0.9, a: 0.85, tint: GOLD_HI, blend: 'add', layer: 3 })));
    pips(b, tile, seat, 2, s + 4);
    smoke(b, tile, s + 7, 2, 3, SMOKE, seat);
    return;
  }
  // Level 3: squash + zoom punch + owner & gold rings + flash + three layers.
  const impact = s + 1;
  b.at(impact, dom((d) => d.zoomPunch?.(space, pop.zoom)), sfx('buy', { pitch: 1.5, gain: 0.7 }), haptic('success'));
  ring(b, tile, impact, owner, 1.2);
  ring(b, tile, impact + 3, GOLD, 1.5);
  starBurst(b, tile, impact, GOLD, 0.6);
  glow(b, tile, impact, GOLD_HI, { s: 1.4, a: 0.5, fadeIn: 1, life: 10, fadeOut: 8 });
  b.at(impact, flash(tile.x, tile.y, 2.4 * b.u, 0.15, 1));
  for (const df of [1, 6])
    b.at(impact + df, spawn((e) => void e.emit({ anim: 'glint_sweep', x: tile.x + e.rng.jitter(0.2 * b.u), y: tile.y, life: 9, fit: true, s: 0.9, a: 0.85, tint: GOLD_HI, blend: 'add', layer: 3 })));
  sparkles(b, tile, 4, impact, { r: 0.6, color: SPARK_WHITE });
  sparkles(b, tile, 6, impact + 1, { r: 0.9, color: GOLD });
  b.at(impact + 2, spawn((e) => void e.emit({ anim: 'shine_cross', x: tile.x, y: tile.y - 0.4 * b.u, life: 10, fit: true, s: 0.7, tint: GOLD_HI, blend: 'add', layer: 3 })));
  sparkles(b, tile, 6, impact + 3, { r: 1.2, color: owner });
  pips(b, tile, seat, 3, impact + 3);
  smoke(b, tile, impact + 8, 3, 3, SMOKE, seat);
  flag(b, tile, impact + 8, owner, 14, seat);
  void freeShift;
}

/** Build L1–L3 (§7.2b.2–4); L4 delegates to `landmarkReveal`; `free` → `freeUpgrade`. cue `swap`. */
export function buildSeq(p: BuildParams, env: PresetEnv): Timeline {
  if (p.free) return freeUpgrade(p, env);
  if (p.level === 4) return landmarkReveal({ space: p.space, player: p.player }, env);
  const b = new B(env);
  const c = env.c;
  const lv = p.level;
  const tile = c.space(p.space);
  const owner = env.color(p.player);
  const seat = c.seat(p.player);
  const h = HITS[lv];
  const coins = lv + 2;
  coinArc(b, c.panel(p.player), tile, coins, 0, { frames: 10 });
  b.at(0, sfx('cash-out', { gain: lv === 3 ? 0.7 : 0.6 }));
  glow(b, tile, 0, owner, { s: 1.5, a: 0.4 + lv * 0.05, fadeIn: 4, life: h.swap + 14, fadeOut: 8 });
  b.at(1, dom((d) => d.dim?.(p.space, true)));
  hammer(b, tile, seat, 0, h.first, h.gap, lv);
  const dustS = [0.9, 1.1, 1.2];
  const shakes = [1, 1.5, 3];
  for (let k = 0; k < lv; k++) {
    const f = h.first + k * h.gap;
    const last = k === lv - 1;
    hitBurst(b, tile, f, dustS[k]!);
    // `rm`: the last hit's sound also plays on the reduced path (effects off / reduced motion).
    b.at(f, sfx('build', { pitch: semi([0, lv === 2 ? 1 : 2, 4][k]!), gain: last ? 1 : 0.7 + 0.15 * k, rm: last }), haptic(last ? (lv === 3 ? 'medium' : 'light') : 'tick'));
    if (lv > 1) b.at(f, shake(last ? (lv === 3 ? 3 : 2) : shakes[k]!, last ? (lv === 3 ? 200 : 160) : 100));
    if (last) b.at(f, hitStop(1));
  }
  // Dust curtain over the swap.
  if (lv === 2) dust(b, tile, h.swap, 1.2);
  if (lv === 3) dust(b, tile, 12, 1.3, DUST, 3, 0.5, 1);
  tierReveal(b, tile, seat, owner, lv, h.swap, p.space);
  b.at(h.block, block());
  b.area(tile, 2.5);
  return b.build(`buildSeq${lv}`, lv === 3 ? 2 : 1, PRIORITY.build, { space: p.space });
}

interface LandmarkParams {
  space: number;
  player: PlayerId;
  /** Free upgrade to a landmark: the coins + hammer are replaced by a gift comet (§7.2b.6 k=4). */
  free?: boolean;
  from?: Pt;
  /** Also completes a colour group (composite `landmark+monopoly`, §7.2b.9 end). */
  group?: { spaces: readonly number[]; color: string };
}

/** L4 landmark completion (§7.2b.5): 58 f + 3 f hit-stop, block f24, cues `swap` f17 / `stamp` f22. */
export function landmarkReveal(p: LandmarkParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const c = env.c;
  const u = b.u;
  const tile = c.space(p.space);
  const owner = env.color(p.player);
  const seat = c.seat(p.player);
  const combo = !!p.group;
  // Anticipation
  b.at(0, dom((d) => d.spotlight?.(true)), dom((d) => d.closeUp?.(p.space, p.player, 4, 'in')));
  b.at(0, sfx('landmark', { gain: 0.35, pitch: 0.75 }), haptic('tick'));
  glow(b, tile, 0, owner, { s: 2.1, a: 0.7, fadeIn: 8, life: 44, fadeOut: 10 });
  // Converging sparkles (r 1.6u → 0.2u, inQuad 8 f).
  b.area(tile, 2);
  b.at(
    0,
    burst(6, (k, nn, e) => {
      const a = (k / nn) * Math.PI * 2 + e.rng.jitter(0.3);
      return {
        anim: 'sparkle4',
        path: { x0: tile.x + Math.cos(a) * 1.6 * u, y0: tile.y + Math.sin(a) * 1.6 * u, cx: tile.x + Math.cos(a + 0.6) * u, cy: tile.y + Math.sin(a + 0.6) * u, x1: tile.x + Math.cos(a) * 0.2 * u, y1: tile.y + Math.sin(a) * 0.2 * u, ease: Ease.InQuad, frames: 8 },
        delay: k,
        life: 9,
        fit: true,
        s: 0.6,
        tint: SPARK_WHITE,
        layer: 3,
      };
    }),
  );
  if (p.free) {
    const from = p.from ? c.fromClient(p.from.x, p.from.y) : c.center();
    comet(b, from, tile, 4, 10, GIFT, 0.9, 0.2);
    b.at(4, sfx('card', { gain: 0.8 }));
    b.at(14, sfx('build', { pitch: semi(3), gain: 0.8 }), haptic('light'));
    ring(b, tile, 14, GREEN, 1);
    b.at(14, spawn((e) => void e.emit({ anim: 'hit_lines', x: tile.x, y: tile.y, life: 6, fit: true, s: 1, tint: WHITE, layer: 3 })));
    b.area(tile, 2);
    b.at(15, burst(2, (k) => ({ anim: 'heart', x: tile.x + (k ? 0.5 : -0.5) * u, y: tile.y, vy: -1.4 * u, delay: k * 2, life: 16, s: 0.45, fadeOut: 8, layer: 3 })));
  } else {
    coinArc(b, c.panel(p.player), tile, 8, 0, { frames: 10 });
    b.at(0, sfx('cash-out', { gain: 0.8 }));
    b.at(3, dom((d) => d.dim?.(p.space, true)));
    // Hammer: contacts at f4, f9, f14 (lift from f0).
    hammer(b, tile, seat, 0, 4, 5, 3);
    const pitches = [0, 2, 4];
    [4, 9, 14].forEach((f, k) => {
      hitBurst(b, tile, f, [1, 1.1, 1.2][k]!, k === 2 ? 2 : 1);
      b.at(f, shake([1, 1.5, 2][k]!, 100), sfx('build', { pitch: semi(pitches[k]!), gain: [0.7, 0.85, 1][k]! }), haptic(k === 2 ? 'light' : 'tick'));
    });
  }
  // Crown drop f13 → f19, trail sparkles.
  const top = local(b, tile, seat, 0, -1.8);
  const rest = local(b, tile, seat, 0, -0.55);
  b.area(top, 1.4);
  b.at(
    13,
    spawn(
      (e) =>
        void e.emit({
          anim: 'crown',
          path: { x0: top.x, y0: top.y, cx: (top.x + rest.x) / 2, cy: (top.y + rest.y) / 2, x1: rest.x, y1: rest.y, ease: Ease.InQuad, frames: 6 },
          life: 23,
          s: 0.8,
          squash: [6, 1.3, 0.75],
          rot: SEAT_ANGLE[seat],
          fadeIn: 2,
          fadeOut: 6,
          layer: 3,
        }),
    ),
    burst(4, (k) => {
      const q = k / 4;
      return { anim: 'sparkle4', x: top.x + (rest.x - top.x) * q * q, y: top.y + (rest.y - top.y) * q * q, delay: k + 1, life: 8, fit: true, s: 0.4, tint: GOLD, layer: 3 };
    }),
  );
  // Dust curtain f15–17 → swap f17.
  dust(b, tile, 15, 1.3, DUST, 6, 0.5, 0.5);
  b.at(17, cue('swap'), dom((d) => d.dim?.(p.space, false)), dom((d) => d.closeUp?.(p.space, p.player, 4, 'pop')));
  // Impact f19.
  const I = 19;
  b.at(I, dom((d) => d.pop?.(p.space, { from: 0.5, c1: POP_C1[15], frames: 10 })), dom((d) => d.zoomPunch?.(p.space, 1.25)));
  b.at(I, hitStop(3), shake(8, 360), sfx('landmark', { gain: 1 }), sfx('build', { pitch: 0.75, gain: 1 }), haptic('heavy', true));
  ring(b, tile, I, owner, 1.2);
  ring(b, tile, I + 3, GOLD, 1.6);
  starBurst(b, tile, I, GOLD, 1.2);
  glow(b, tile, I, GOLD_HI, { s: 2, a: 0.6, fadeIn: 1, life: 14, fadeOut: 10 });
  glow(b, rest, I, WHITE, { s: 0.9, a: 0.7, fadeIn: 1, life: 8, fadeOut: 6 });
  b.at(I, flash(tile.x, tile.y, 4 * u, 0.25, 2));
  // Reward layers
  rays(b, tile, I + 1, combo ? p.group!.color : GOLD_HI, 24, { s0: 0.8, s1: combo ? 1.95 : 1.5, a: 0.7, spin: 62 });
  for (const f of [I + 1, I + 7]) b.at(f, spawn((e) => void e.emit({ anim: 'glint_sweep', x: tile.x + e.rng.jitter(0.2 * u), y: tile.y, life: 9, fit: true, s: 1, a: 0.9, tint: GOLD_HI, blend: 'add', layer: 3 })));
  b.at(I + 2, spawn((e) => void e.emit({ anim: 'shine_cross', x: rest.x, y: rest.y - 0.2 * u, life: 10, fit: true, s: 0.8, tint: GOLD_HI, blend: 'add', layer: 3 })));
  sparkles(b, tile, 10, I + 1, { r: 1.6, color: [owner, GOLD, SPARK_WHITE], stagger: 1 });
  b.at(22, sfx('festival', { gain: 0.45, pitch: 1.5 }), cue('stamp'), haptic('success'));
  const fw = combo ? 4 : 3;
  firework(b, local(b, tile, seat, -1.1, -0.8), 22, owner);
  firework(b, local(b, tile, seat, 1.1, -0.8), 25, GOLD);
  firework(b, local(b, tile, seat, 0, -1.5), 28, SPARK_WHITE);
  if (fw === 4) firework(b, local(b, tile, seat, 0, 1.2), 30, p.group!.color);
  const upDir = SEAT_ANGLE[seat] - 90;
  const nConf = combo ? 16 : 20;
  for (const f of [22, 25, 28])
    confetti(b, tile, nConf, f, {
      dir: upDir,
      spread: 55,
      speed: [10, 16],
      colors: [owner, GOLD, SPARK_WHITE],
      weights: [0.4, 0.4, 0.2],
      g: [seatLocal(seat, 0, 22).x, seatLocal(seat, 0, 22).y],
      r: 0.6,
    });
  b.at(24, block());
  // Decorative coin shower (not income).
  const nShower = combo ? 12 : 20;
  b.at(
    24,
    burst(nShower, (k, _n, e) => {
      const a = ((upDir + e.rng.jitter(60)) * Math.PI) / 180;
      const sp = e.rng.range(9, 13) * u;
      const g = seatLocal(seat, 0, 26);
      return { anim: 'coin_spin', frame: k, x: rest.x, y: rest.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ax: g.x * u, ay: g.y * u, delay: Math.floor(k * 0.3), life: 20, s: 0.5, fadeOut: 5, layer: 2 };
    }),
  );
  starToPanel(b, tile, p.player, 5, 26);
  if (combo) {
    p.group!.spaces.forEach((sp, k) => {
      if (sp === p.space) return;
      const q = c.space(sp);
      b.at(20 + 2 * k, spawn((e) => void e.emit({ anim: 'glint_sweep', x: q.x, y: q.y, life: 9, fit: true, s: 0.9, tint: p.group!.color, blend: 'add', layer: 3 })));
      ring(b, q, 20 + 2 * k, owner, 0.9);
    });
    b.at(30, cue('badge'));
  }
  // Settle
  smoke(b, rest, 34, 3, 3, SMOKE, seat);
  flag(b, tile, 34, owner, 18, seat);
  b.at(36, cue('settle'));
  b.at(44, dom((d) => d.closeUp?.(p.space, p.player, 4, 'out')), dom((d) => d.spotlight?.(false)));
  b.at(58, cue('end'));
  b.area(tile, 3.2);
  return b.build(combo ? 'landmark+monopoly' : 'landmarkReveal', 3, PRIORITY.landmark, { space: p.space });
}

/** Free upgrade card (§7.2b.6): gift comet from the stage card, impact f7, swap f8, green layer + hearts. */
export function freeUpgrade(p: BuildParams, env: PresetEnv): Timeline {
  if (p.level === 4) return landmarkReveal({ space: p.space, player: p.player, free: true, ...(p.from ? { from: p.from } : {}) }, env);
  const b = new B(env);
  const c = env.c;
  const u = b.u;
  const tile = c.space(p.space);
  const owner = env.color(p.player);
  const seat = c.seat(p.player);
  const from = p.from ? c.fromClient(p.from.x, p.from.y) : c.center();
  const lv = p.level;
  comet(b, from, tile, 0, 7, GIFT, 0.9, 0.2);
  glow(b, tile, 0, GREEN, { s: 1.5, a: 0.5, fadeIn: 6, life: 22 });
  b.at(0, sfx('card', { gain: 0.8 }), haptic('tick'));
  ring(b, tile, 7, GREEN, 1);
  b.at(7, spawn((e) => void e.emit({ anim: 'hit_lines', x: tile.x, y: tile.y, life: 6, fit: true, s: 1, tint: WHITE, layer: 3 })));
  dust(b, tile, 7, 1.1, DUST, 2, 0.4);
  b.at(7, hitStop(1), sfx('build', { pitch: semi(3), gain: 0.8 }), sfx('festival', { gain: 0.35, pitch: 1.5 }), haptic('light'));
  sparkles(b, tile, 6, 9, { r: 0.8, color: GREEN });
  b.area(tile, 2);
  b.at(10, burst(2, (k) => ({ anim: 'heart', x: tile.x + (k ? 0.45 : -0.45) * u, y: tile.y - 0.1 * u, vy: -1.35 * u, delay: k * 2, life: 16, s: 0.1, s1: 0.45, sT: 0.3, se1: Ease.OutBack, fadeOut: 8, layer: 3 })));
  tierReveal(b, tile, seat, owner, lv, 8, p.space, true);
  b.at(lv === 3 ? 14 : 10, block());
  b.area(tile, 2.5);
  return b.build(`freeUpgrade${lv}`, lv === 3 ? 2 : 1, PRIORITY.build, { space: p.space });
}

interface FrameSwapParams {
  space: number;
  from: PlayerId;
  to: PlayerId;
}

function frameSwapOps(b: B, p: FrameSwapParams, f: number): void {
  const tile = b.env.c.space(p.space);
  const seller = b.env.color(p.from);
  const u = b.u;
  b.area(tile, 3);
  b.at(
    f,
    burst(8, (k, nn, e) => {
      const a = (k / nn) * Math.PI * 2 + e.rng.jitter(0.3);
      const sp = e.rng.range(6, 10) * u;
      return { anim: 'confetti_rect', x: tile.x + Math.cos(a) * 0.9 * u, y: tile.y + Math.sin(a) * 0.9 * u, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ay: 14 * u, drag: 0.92, life: 14, s: 1.1, rot: e.rng.range(0, 360), vrot: e.rng.jitter(720), vflip: 12, fadeOut: 4, tint: seller, layer: 3 };
    }),
  );
  smoke(b, tile, f, 1, 0, SMOKE);
  dust(b, tile, f, 0.9, DUST, 2, 0.6);
  b.at(f + 3, cue('frame'), dom((d) => d.pop?.(p.space, { from: 0.9, c1: POP_C1[10], frames: 8 })));
}

/** Ownership frame swap: seller-colour frame shards + cue `frame` (f3) + icon popBack. */
export function frameSwap(p: FrameSwapParams, env: PresetEnv): Timeline {
  const b = new B(env);
  frameSwapOps(b, p, 0);
  b.at(3, block());
  return b.build('frameSwap', 1, PRIORITY.takeover, { space: p.space });
}

interface TakeoverParams {
  space: number;
  buyer: PlayerId;
  seller: PlayerId;
}

/** Takeover (§7.2b.8): sirens → stamp impact f15 (hit-stop 3) → frame swap f18 → 2× price coins buyer → seller. */
export function takeoverStamp(p: TakeoverParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const c = env.c;
  const u = b.u;
  const tile = c.space(p.space);
  const buyer = env.color(p.buyer);
  const seller = env.color(p.seller);
  const seat = c.seat(p.buyer);
  glow(b, tile, 0, seller, { s: 1.7, a: 0.6, fadeIn: 5, life: 22, fadeOut: 6 });
  siren(b, local(b, tile, seat, -1.05, -0.9), seat, 0, 16);
  siren(b, local(b, tile, seat, 1.05, -0.9), seat, 0, 16);
  b.at(0, sfx('warning'), haptic('warning'));
  ring(b, c.panel(p.seller), 2, RED, 0.8);
  // Impact
  const I = 15;
  b.area(tile, 2.5);
  b.at(I, spawn((e) => void e.emit({ anim: 'stamp_splat', x: tile.x, y: tile.y, life: 25, fps: 24, s: 1.2, tint: buyer, fadeOut: 6, layer: 2 })));
  b.at(
    I,
    burst(8, (k, nn) => {
      const a = (k / nn) * 360;
      const v = { x: Math.cos((a * Math.PI) / 180) * 1.25 * u, y: Math.sin((a * Math.PI) / 180) * 1.25 * u };
      return { anim: 'hit_lines', x: tile.x + v.x, y: tile.y + v.y, life: 6, fit: true, s: 0.6, rot: a + 90, tint: k % 2 ? WHITE : buyer, layer: 3 };
    }),
  );
  ring(b, tile, I, buyer, 1.2);
  ring(b, tile, I + 3, WHITE, 1.6, 9, true);
  b.at(I, flash(tile.x, tile.y, 3.5 * u, 0.25, 2), dom((d) => d.zoomPunch?.(p.space, 1.15)), hitStop(3), shake(8, 360), sfx('takeover'), haptic('heavy', true));
  frameSwapOps(b, { space: p.space, from: p.seller, to: p.buyer }, I);
  b.at(I + 1, cue('stamp'));
  glow(b, tile, I + 3, buyer, { s: 1.6, a: 0.55, fadeIn: 3, life: 20 });
  // Price coins buyer → seller.
  const pay = coinArc(b, c.panel(p.buyer), c.panel(p.seller), 12, 21, { frames: 20 * COIN_FLIGHT, stagger: 1 });
  b.at(21, block(), sfx('cash-out', { gain: 0.7 }));
  b.at(pay.first, sfx('cash-in'), dom((d) => d.panelBump?.(p.seller)));
  sparkles(b, c.panel(p.buyer), 8, 33, { r: 1.1, color: [buyer, GOLD] });
  dust(b, c.panel(p.seller), pay.first, 0.8, GREY, 2, 0.8);
  b.at(pay.first, haptic('light'));
  return b.build('takeoverStamp', 3, PRIORITY.takeover, { space: p.space });
}

interface GroupParams {
  spaces: readonly number[];
  player: PlayerId;
  /** Group colour (hex). */
  color: string;
}

function groupFinaleOps(b: B, p: GroupParams, Tc: number): void {
  const c = b.env.c;
  const pts = p.spaces.map((s) => c.space(s));
  const cx = pts.reduce((a, q) => a + q.x, 0) / pts.length;
  const cy = pts.reduce((a, q) => a + q.y, 0) / pts.length;
  const mid = { x: cx, y: cy };
  const owner = b.env.color(p.player);
  for (const q of pts) starBurst(b, q, Tc, GOLD, 0.8);
  rays(b, mid, Tc, p.color, 18, { s0: 0.7, s1: 1.1, a: 0.6 });
  ring(b, mid, Tc, GOLD, 1.5);
  b.at(Tc, flash(cx, cy, 3 * b.u, 0.2, 1), hitStop(2), shake(6, 300), sfx('landmark', { pitch: semi(3) }), haptic('success', true));
  pts.forEach((q, k) =>
    confetti(b, q, Math.floor(40 / pts.length) + (k < 40 % pts.length ? 1 : 0), Tc + 1 + (k % 5), {
      dir: (Math.atan2(q.y - cy, q.x - cx) * 180) / Math.PI,
      spread: 50,
      speed: [7, 11],
      g: [0, 16],
      colors: [p.color, owner, GOLD],
      weights: [0.5, 0.3, 0.2],
      life: [22, 26],
    }),
  );
  b.at(Tc + 2, cue('badge'), sfx('buy', { pitch: semi(7), gain: 0.6 }));
  for (const q of pts) sparkles(b, q, 3, Tc + 2, { r: 1, color: GOLD, stagger: 2 });
  b.at(Tc + 6, cue('stamp'));
  b.at(Tc + 12, block());
}

/** Group chain (§7.2b.9): lights the group, then tile-by-tile glint + ring + sparkles + comet links, then the finale. */
export function groupChain(p: GroupParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const c = env.c;
  const owner = env.color(p.player);
  const n = p.spaces.length;
  const step = n <= 3 ? 3 : 2;
  const T = 4 + step * (n - 1);
  const pts = p.spaces.map((s) => c.space(s));
  for (const q of pts) glow(b, q, 0, p.color, { s: 1.5, a: 0.5, fadeIn: 4, life: T + 26, fadeOut: 10 });
  b.at(0, sfx('warning', { gain: 0.4, pitch: semi(3) }));
  const ladder = [0, 4, 7, 10];
  pts.forEach((q, i) => {
    const f = 4 + step * i;
    b.at(f, spawn((e) => void e.emit({ anim: 'glint_sweep', x: q.x, y: q.y, life: 10, fit: true, s: 0.95, tint: p.color, blend: 'add', layer: 3 })));
    ring(b, q, f, owner, 0.9);
    sparkles(b, q, 4, f, { r: 0.7, color: SPARK_WHITE });
    b.at(f, dom((d) => d.zoomPunch?.(p.spaces[i]!, 1.08)), sfx('tap', { pitch: semi(ladder[i] ?? 10) }), haptic('tick'));
    if (i > 0) comet(b, pts[i - 1]!, q, f - step, step * 2, p.color, 0.7, 0.15);
  });
  groupFinaleOps(b, p, T + 2);
  return b.build('groupChain', 3, PRIORITY.monopoly, { spaces: p.spaces });
}

/** Group finale alone (burst on every tile + rays at the centroid + confetti 40 + `badge` cue). */
export function groupFinale(p: GroupParams, env: PresetEnv): Timeline {
  const b = new B(env);
  groupFinaleOps(b, p, 0);
  return b.build('groupFinale', 3, PRIORITY.monopoly, { spaces: p.spaces });
}

interface TollParams {
  payer: PlayerId;
  receiver: PlayerId;
  amount: number;
  /** Payer's cash after paying (≥ 2500 or < 10 % left → I3). */
  payerCashAfter?: number;
  festival?: boolean;
  multiplier?: number;
  waived?: boolean;
  /** The toll space (festival flag / waived glow). */
  space?: number;
  /** Receiver's number pop (DOM float) at the first coin landing; null = none. Default `+amount`. */
  label?: string | null;
}

/** Toll (§7.3): payer panel ring + coins → receiver panel (R6), landing sparkles, number pop, tiered extras. cue `arrive`. */
export function tollPay(p: TollParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const c = env.c;
  const from = c.panel(p.payer);
  const to = c.panel(p.receiver);
  const payerCol = env.color(p.payer);
  if (p.waived) {
    const dest = p.space !== undefined ? c.space(p.space) : c.center();
    sparkles(b, from, 8, 0, { r: 0.9, color: SKY });
    b.area(from, 1.5).area(dest, 1.5);
    b.at(
      2,
      spawn(
        (e) =>
          void e.emit({ anim: 'glow', path: { x0: from.x, y0: from.y, cx: (from.x + dest.x) / 2, cy: (from.y + dest.y) / 2, x1: dest.x, y1: dest.y, ease: Ease.OutCubic, frames: 12 }, life: 16, s: 1.2, a: 0.8, fadeOut: 5, tint: SKY, blend: 'add', layer: 1 }),
      ),
    );
    ring(b, dest, 14, SKY, 0.9);
    b.at(0, sfx('escape'), haptic('light'), block());
    return b.build('tollPay', 1, PRIORITY.toll, { panel: p.payer });
  }
  let tier = p.amount >= 2500 ? 3 : p.amount >= 1000 ? 2 : p.amount >= 300 ? 1 : 0;
  if (p.payerCashAfter !== undefined && p.payerCashAfter < p.amount * 0.1 && tier < 3) tier = 3;
  if (p.festival || (p.multiplier ?? 1) > 1) tier = Math.min(3, tier + 1);
  const coins = [6, 10, 14, 14][tier]!;
  const start = 4;
  const frames = 16 * COIN_FLIGHT;
  ring(b, from, 0, payerCol, 0.9);
  b.at(0, sfx('toll'), haptic(tier >= 2 ? 'heavy' : 'medium'));
  const arc = coinArc(b, from, to, coins, start, { frames, stagger: 1, s: p.festival ? 0.8 : tier >= 3 ? 0.75 : 0.62, comet: (p.multiplier ?? 1) > 1 });
  // Camera on big tolls: punch in on the space; the biggest also dim the table around it.
  if (tier >= 2 && p.space !== undefined) b.at(0, dom((d) => d.zoomPunch?.(p.space!, tier >= 3 ? 1.22 : 1.12)));
  if (tier >= 3) b.at(0, dom((d) => d.spotlight?.(true))).at(arc.last + 6, dom((d) => d.spotlight?.(false)));
  arrivals(b, to, coins, arc.first, 1, GOLD);
  const pitch = semi([0, 2, 4, 6][tier]!);
  b.at(arc.first, cue('arrive'), sfx('cash-in', { pitch }), dom((d) => d.panelBump?.(p.receiver)));
  const label = p.label === undefined ? `+${p.amount}` : p.label;
  if (label) b.at(arc.first, dom((d) => d.floatText?.(p.receiver, label)));
  if (tier >= 1) {
    ring(b, to, arc.last, env.color(p.receiver), 1);
    b.at(arc.first, shake(tier >= 3 ? 8 : tier === 2 ? 4 : 3, tier >= 3 ? 360 : tier === 2 ? 240 : 200));
  }
  if (tier >= 2) {
    smoke(b, from, 2, 1, 0, GREY, c.seat(p.payer));
    starBurst(b, to, arc.first, GOLD, 0.6);
  }
  if (tier >= 3) {
    const wave = coinArc(b, from, to, 14, start + 9, { frames, stagger: 1, s: 0.75, side: -1 });
    arrivals(b, to, 6, wave.first, 2, GOLD);
    smoke(b, from, 5, 1, 0, GREY, c.seat(p.payer));
    b.at(arc.first, hitStop(2));
    rays(b, to, arc.first, GOLD_HI, 12, { s0: 0.5, s1: 0.9, a: 0.6 });
    b.at(wave.first, sfx('cash-in', { pitch: semi(8) }));
  }
  if (p.festival && p.space !== undefined) {
    const tile = c.space(p.space);
    starBurst(b, tile, 0, GOLD, 0.8);
    flag(b, tile, 0, GOLD, 16);
    sparkles(b, tile, 8, 1, { r: 0.9, color: GOLD });
    b.at(0, sfx('festival', { gain: 0.5 }));
  }
  b.at([10, 15, 18, 19][tier]!, block());
  return b.build('tollPay', tier >= 3 ? 3 : tier >= 1 ? 2 : 1, PRIORITY.toll, { panel: p.payer });
}

interface PassStartParams {
  player: PlayerId;
  /** Landed exactly on Start (pot / double salary): I3. */
  landed?: boolean;
}

/** Passing Start (§7.1): impact at Start, moneybag pop, coin shower that swoops into the player's panel. */
export function passStart(p: PassStartParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const c = env.c;
  const u = b.u;
  const tile = c.space(0);
  const panel = c.panel(p.player);
  const seat = c.seat(p.player);
  starBurst(b, tile, 0, GOLD, 1);
  ring(b, tile, 0, env.color(p.player), 1.1);
  b.at(0, sfx('pass-start'), haptic('success'));
  const bag = local(b, tile, seat, 0, -0.3);
  b.area(bag, 1.5);
  b.at(2, spawn((e) => void e.emit({ anim: 'moneybag', x: bag.x, y: bag.y, life: 18, s: 0.3, s1: 0.85, sT: 0.25, se1: Ease.OutBack, c1: 2.17, squash: [5, 1.3, 0.75], fadeOut: 6, layer: 3 })));
  const n = p.landed ? 24 : 16;
  const frames = 22 * COIN_FLIGHT;
  const center = c.center();
  b.area(tile, 3).area(panel, 1.5);
  b.at(
    4,
    burst(n, (k, _n, e) => {
      // Burst up/out from Start, then swoop to the panel along the same quadratic curve.
      const a = e.rng.range(0, Math.PI * 2);
      const r = e.rng.range(1.5, 2.6) * u;
      const ctrl = { x: tile.x + (center.x - tile.x) * 0.15 + Math.cos(a) * r, y: tile.y + (center.y - tile.y) * 0.15 + Math.sin(a) * r - 1.2 * u };
      b.bb.add(ctrl.x, ctrl.y, u);
      return {
        anim: 'coin_spin',
        frame: k * 3,
        path: { x0: tile.x, y0: tile.y, cx: ctrl.x, cy: ctrl.y, x1: panel.x + e.rng.jitter(0.5 * u), y1: panel.y + e.rng.jitter(0.5 * u), ease: Ease.InOutQuad, frames },
        delay: Math.floor(k * 0.75),
        life: frames + 1,
        s: 0.3,
        s1: 0.62,
        sT: 0.3,
        se1: Ease.OutBack,
        s2: 0.5,
        fadeOut: 2,
        layer: 2,
      };
    }),
  );
  const firstArr = 4 + frames;
  arrivals(b, panel, 8, firstArr, 1.5, GOLD);
  b.at(firstArr, sfx('cash-in'), dom((d) => d.panelBump?.(p.player)));
  b.at(firstArr + 6, sfx('cash-in', { pitch: semi(2) }));
  if (p.landed) {
    rays(b, tile, 2, GOLD_HI, 18, { s0: 0.6, s1: 1.2, a: 0.6 });
    b.at(
      3,
      burst(6, (k, _n, e) => ({ anim: 'bill_flutter', frame: k, x: tile.x + e.rng.jitter(1.6 * u), y: tile.y - e.rng.range(1.5, 2.4) * u, vy: 2 * u, vx: e.rng.jitter(u), ay: 3 * u, life: 26, s: 0.7, swing: [18, 1.2], fadeIn: 3, fadeOut: 6, layer: 3 })),
    );
    b.at(2, hitStop(2), shake(4, 240));
    b.at(firstArr + 12, sfx('cash-in', { pitch: semi(4) }));
  }
  b.at(12, block());
  return b.build('passStart', p.landed ? 3 : 2, PRIORITY.start, { space: 0 });
}

export type CardTone = 'good' | 'bad' | 'move' | 'keep';
const TONE: Record<CardTone, string> = { good: GOLD, bad: '#C96A6A', move: SKY, keep: '#B08AF5' };

interface CardRevealParams {
  tone: CardTone;
  /** Card centre (client px); default stage centre. */
  at?: Pt;
  /** Card half-size in u (for the edge glints). */
  r?: number;
}

/** Card flip (§7.4): tone glow behind the card, sparkle glints around its edge at the flip apex (≈ f6). */
export function cardReveal(p: CardRevealParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const c = env.c;
  const u = b.u;
  const at = p.at ? c.fromClient(p.at.x, p.at.y) : c.center();
  const col = TONE[p.tone];
  const r = (p.r ?? 2.6) * u;
  glow(b, at, 0, col, { s: 3.2, a: 0.55, fadeIn: 3, life: 16, fadeOut: 8 });
  b.area(at, (p.r ?? 2.6) + 1.2);
  // No sfx: Stage.showCard() already plays 'card'.
  b.at(
    6,
    burst(6, (k, nn, e) => {
      const a = (k / nn) * Math.PI * 2 + e.rng.jitter(0.3);
      return { anim: 'sparkle4', x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r * 1.2, delay: k, life: 9, fit: true, s: 0.6, tint: col === GOLD ? GOLD_HI : col, blend: 'add', layer: 3 };
    }),
    spawn((e) => void e.emit({ anim: 'glint_sweep', x: at.x, y: at.y, life: 9, fit: true, s: 1.4, a: 0.8, tint: WHITE, blend: 'add', layer: 3 })),
  );
  return b.build('cardReveal', 1, PRIORITY.card, { stage: true });
}

interface IslandParams {
  space: number;
  player: PlayerId;
  cause?: 'space' | 'doubles' | 'card';
}

/** Sent to the island: (3rd double → siren sweep at the stage edges first) then a sky splash. */
export function islandSiren(p: IslandParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const c = env.c;
  const u = b.u;
  const tile = c.space(p.space);
  let s0 = 0;
  if (p.cause === 'doubles') {
    const st = c.stage();
    const mid = c.center();
    const edges: Array<[Pt, Seat]> = [
      [{ x: mid.x, y: st.y + 0.8 * u }, 'N'],
      [{ x: mid.x, y: st.y + st.height - 0.8 * u }, 'S'],
      [{ x: st.x + 0.8 * u, y: mid.y }, 'W'],
      [{ x: st.x + st.width - 0.8 * u, y: mid.y }, 'E'],
    ];
    for (const [q, seat] of edges) siren(b, q, seat, 0, 15, 0.6);
    ring(b, mid, 0, RED, 1.2);
    ring(b, mid, 7, RED, 1.2);
    b.at(0, sfx('warning'), haptic('warning'), shake(4, 240));
    s0 = 15;
  }
  ring(b, tile, s0, SKY, 1);
  ring(b, tile, s0 + 4, SKY, 1.2);
  ring(b, tile, s0 + 8, SKY, 1.4);
  b.area(tile, 3);
  b.at(
    s0,
    burst(12, (k, nn, e) => {
      const a = -Math.PI / 2 + ((k / (nn - 1)) - 0.5) * 2.2 + e.rng.jitter(0.15);
      const sp = e.rng.range(5, 8) * u;
      return { anim: 'confetti_dot', x: tile.x, y: tile.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ay: 22 * u, life: 16, s: e.rng.range(0.5, 0.9), fadeOut: 4, tint: SKY, layer: 3 };
    }),
  );
  dust(b, tile, s0, 1, '#CFEFFF');
  b.at(s0, sfx('island'), haptic('warning'), shake(3, 200));
  b.at(s0 + 8, block());
  return b.build('islandSiren', 2, PRIORITY.island, { space: p.space });
}

interface FestivalParams {
  space: number;
  player: PlayerId;
  previous?: number | null;
}

/** Festival set: comet from the previous festival tile, then flags pop + star bursts + confetti 30. */
export function festivalBurst(p: FestivalParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const c = env.c;
  const tile = c.space(p.space);
  const owner = env.color(p.player);
  const seat = c.seat(p.player);
  let d = 0;
  if (p.previous !== undefined && p.previous !== null && p.previous !== p.space) {
    comet(b, c.space(p.previous), tile, 0, 12, GOLD_HI, 0.9, 0.2);
    d = 12;
  }
  for (let k = 0; k < 3; k++) {
    const q = local(b, tile, seat, (k - 1) * 0.6 - 0.5, (k === 1 ? -0.25 : 0) + 0.1);
    b.area(q, 1.5);
    b.at(d + k, spawn((e) => void e.emit({ anim: 'flag_wave', x: q.x, y: q.y, frame: k * 2, life: 30, s: 0.1, s1: 0.55, sT: 0.2, se1: Ease.OutBack, c1: 2.17, fadeOut: 8, tint: k === 1 ? owner : GOLD, rot: SEAT_ANGLE[seat], anchor: [0.2, 0.9], layer: 2 })));
  }
  starBurst(b, tile, d, GOLD, 1);
  starBurst(b, tile, d + 4, GOLD, 1.3);
  glow(b, tile, d, GOLD_HI, { s: 1.8, a: 0.6, life: 20 });
  confetti(b, tile, 30, d + 1, { dir: SEAT_ANGLE[seat] - 90, spread: 70, speed: [7, 12], colors: [GOLD, SPARK_WHITE, owner], g: [seatLocal(seat, 0, 20).x, seatLocal(seat, 0, 20).y] });
  sparkles(b, tile, 12, d + 2, { r: 1.2, color: [GOLD, owner] });
  b.at(d, sfx('festival'), haptic('success'), shake(3, 200));
  b.at(d + 10, block());
  return b.build('festivalBurst', 2, PRIORITY.festival, { space: p.space });
}

interface BankruptParams {
  player: PlayerId;
}

/** Bankruptcy (negative I3): siren at the panel → crack impact (hit-stop 3) with smoke, bricks and spilling coins. */
export function bankruptcy(p: BankruptParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const c = env.c;
  const u = b.u;
  const pa = c.panel(p.player);
  const seat = pa.seat;
  const at = { x: pa.cx, y: pa.cy };
  siren(b, local(b, at, seat, -1.4, -0.4), seat, 0, 14, 0.65);
  siren(b, local(b, at, seat, 1.4, -0.4), seat, 0, 14, 0.65);
  ring(b, at, 0, RED, 1.2);
  b.at(0, sfx('bankrupt'));
  const I = 12;
  b.area(at, 5);
  b.at(I, hitStop(3), shake(6, 320), haptic('heavy', true));
  b.at(I, spawn((e) => void e.emit({ anim: 'stamp_splat', x: at.x, y: at.y, life: 20, fps: 24, s: 1.1, tint: '#5B6272', fadeOut: 6, layer: 2 })));
  smoke(b, at, I, 3, 2, GREY, seat);
  const down = seatLocal(seat, 0, 1);
  const up = seatLocal(seat, 0, -1);
  b.at(
    I,
    burst(10, (k, _n, e) => {
      const a = Math.atan2(up.y, up.x) + e.rng.jitter(1.3);
      const sp = e.rng.range(5, 9) * u;
      return { anim: 'brick_chip', frame: k % 3, x: at.x + e.rng.jitter(u), y: at.y + e.rng.jitter(0.5 * u), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ax: down.x * 30 * u, ay: down.y * 30 * u, life: 20, s: 0.8, vrot: e.rng.jitter(600), fadeOut: 5, layer: 3 };
    }),
    burst(12, (k, _n, e) => {
      const a = Math.atan2(up.y, up.x) + e.rng.jitter(1.1);
      const sp = e.rng.range(4, 8) * u;
      return { anim: 'coin_spin', frame: k * 2, x: at.x + e.rng.jitter(u), y: at.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ax: down.x * 28 * u, ay: down.y * 28 * u, delay: Math.floor(k / 3), life: 22, s: 0.5, fadeOut: 6, tint: GREY, layer: 3 };
    }),
  );
  dust(b, at, I + 15, 1, '#B9C0CC', 4, 1, 1);
  b.at(I + 12, block());
  return b.build('bankruptcy', 3, PRIORITY.bankrupt, { panel: p.player });
}

export type VictoryKind = 'triple' | 'line' | 'hubs' | 'bankruptcy' | 'lastStanding' | 'roundLimit';

interface VictoryParams {
  winner: PlayerId;
  kind: VictoryKind;
  /** triple: one space per completed group (3); line: the side's spaces; hubs: the 4 hubs. */
  spaces?: readonly number[];
  /** Colours per `spaces` entry (triple: group colours). */
  colors?: readonly string[];
}

/** Game over (I4): crown on the winner's panel, rays 2.4 s, cannon confetti 100 toward the winner, kind extras. */
export function victory(p: VictoryParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const c = env.c;
  const u = b.u;
  const pa = c.panel(p.winner);
  const seat = pa.seat;
  const col = env.color(p.winner);
  const at = { x: pa.x, y: pa.y };
  const mid = c.center();
  // Crown drop onto the panel's board edge.
  const top = local(b, at, seat, 0, -2.2);
  b.area(top, 1.5).area(at, 2);
  b.at(
    0,
    spawn(
      (e) =>
        void e.emit({
          anim: 'crown',
          path: { x0: top.x, y0: top.y, cx: (top.x + at.x) / 2, cy: (top.y + at.y) / 2, x1: at.x, y1: at.y, ease: Ease.InQuad, frames: 6 },
          life: 80,
          s: 1.1,
          squash: [6, 1.3, 0.75],
          rot: SEAT_ANGLE[seat],
          fadeIn: 2,
          fadeOut: 12,
          layer: 3,
        }),
    ),
  );
  rays(b, at, 2, col, 72, { s0: 0.8, s1: 1.6, a: 0.75, spin: 40 });
  for (const f of [8, 20]) b.at(f, spawn((e) => void e.emit({ anim: 'glint_sweep', x: at.x, y: at.y, life: 9, fit: true, s: 1.2, tint: GOLD_HI, blend: 'add', layer: 3 })));
  b.at(0, sfx('win'), haptic('success', true));
  // No screen shake here (§6.1 lists 12 px): the finale's canvas covers the table, and a shaking
  // board on top would be one more large GPU layer at the peak (PERFORMANCE.md layer budget, gate F3).
  // (A winner-panel bump here promoted a full-screen squashing layer as well: hit-stop only.)
  b.at(6, hitStop(3));
  // Cannons at both ends of the winner's panel, shooting toward the board centre; gravity toward the winner.
  const half = (seat === 'S' || seat === 'N' ? pa.w : pa.h) * 0.45;
  const g = seatLocal(seat, 0, 20);
  for (const side of [-1, 1]) {
    const q = local(b, at, seat, (side * half) / u, 0);
    const dir = (Math.atan2(mid.y - q.y, mid.x - q.x) * 180) / Math.PI - side * 12;
    for (const f of [6, 16]) confetti(b, q, 25, f, { dir, spread: 20, speed: [22, 34], g: [g.x * 0.7, g.y * 0.7], drag: 0.95, colors: CONFETTI, life: [54, 72], stagger: 0.25 });
  }
  b.area(mid, 6);
  const spaces = p.spaces ?? [];
  const cols = p.colors ?? [];
  switch (p.kind) {
    case 'triple':
      spaces.slice(0, 3).forEach((s, k) => {
        const q = c.space(s);
        firework(b, local(b, q, seat, -0.6, -0.6), 12 + k * 9, cols[k] ?? GOLD);
        firework(b, local(b, q, seat, 0.6, -0.9), 16 + k * 9, cols[k] ?? GOLD);
      });
      break;
    case 'line':
      spaces.slice(0, 7).forEach((s, k) => {
        const q = c.space(s);
        b.at(10 + k * 2, spawn((e) => void e.emit({ anim: 'glint_sweep', x: q.x, y: q.y, life: 10, fit: true, s: 1, tint: GOLD_HI, blend: 'add', layer: 3 })));
        sparkles(b, q, 2, 12 + k * 2, { r: 0.7, color: [col, GOLD] });
      });
      if (spaces.length) {
        const q = c.space(spaces[Math.floor(Math.min(7, spaces.length) / 2)]!);
        for (let k = 0; k < 3; k++) firework(b, local(b, q, seat, (k - 1) * 1.2, -1), 26 + k * 5, k === 1 ? GOLD : col);
      }
      break;
    case 'hubs':
      spaces.slice(0, 4).forEach((s, k) => comet(b, c.space(s), mid, 10 + k * 2, 15, GOLD_HI, 1.4, 0.1));
      firework(b, mid, 28, GOLD, 2.2, 6);
      firework(b, local(b, mid, seat, 0, -2), 34, col, 1.8, 6);
      b.at(30, spawn((e) => void e.emit({ anim: 'shine_cross', x: mid.x, y: mid.y, life: 12, fit: true, s: 1.4, tint: GOLD_HI, blend: 'add', layer: 3 })));
      break;
    case 'bankruptcy':
    case 'lastStanding':
      b.at(
        12,
        burst(24, (k, _n, e) => {
          const q = local(b, mid, seat, e.rng.jitter(8), -e.rng.range(6, 9));
          return { anim: 'coin_spin', frame: k, x: q.x, y: q.y, vx: g.x * 0.3 * u, vy: g.y * 0.3 * u, ax: g.x * u, ay: g.y * u, delay: Math.floor(k * 0.8), life: 34, s: 0.6, fadeOut: 6, layer: 2 };
        }),
      );
      break;
    case 'roundLimit':
      firework(b, local(b, mid, seat, -1.5, 0), 14, col, 1.2);
      firework(b, local(b, mid, seat, 1.5, -1), 22, GOLD, 1.2);
      break;
  }
  b.at(45, block());
  b.at(110, cue('end'));
  const tl = b.build('victory', 4, PRIORITY.victory, { panel: p.winner });
  // Canvas region: the board + the winner's panel (the confetti stays over the board); a full-screen
  // canvas would be the largest GPU layer of the finale (layer-memory budget, gate F3).
  const halfB = 16 * u + 2 * u;
  const keep = { x0: Math.min(mid.x - halfB, pa.cx - pa.w / 2), y0: Math.min(mid.y - halfB, pa.cy - pa.h / 2), x1: Math.max(mid.x + halfB, pa.cx + pa.w / 2), y1: Math.max(mid.y + halfB, pa.cy + pa.h / 2) };
  const r = tl.bounds;
  const x0 = Math.max(r.x, keep.x0);
  const y0 = Math.max(r.y, keep.y0);
  tl.bounds = { x: x0, y: y0, width: Math.max(1, Math.min(r.x + r.width, keep.x1) - x0), height: Math.max(1, Math.min(r.y + r.height, keep.y1) - y0) };
  return tl;
}

interface OneAwayParams {
  space: number;
  player: PlayerId;
}

/** One away from a set: owner rings ×2 (500 ms apart) + 3 sparkle blinks on the missing tile. */
export function oneAway(p: OneAwayParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const tile = env.c.space(p.space);
  const col = env.color(p.player);
  ring(b, tile, 0, col, 1);
  ring(b, tile, 15, col, 1);
  for (const f of [0, 8, 16]) sparkles(b, tile, 3, f, { r: 0.8, color: [col, GOLD], stagger: 0.5 });
  b.at(0, sfx('warning'), haptic('warning'));
  b.at(15, block());
  return b.build('oneAway', 1, PRIORITY.misc, { space: p.space });
}

interface DoublesParams {
  /** Third double in a row: red siren sweep (goes to the island). */
  triple?: boolean;
  at?: Pt;
}

/** Doubles: gold ring + 10 staggered sparkles + star burst at the stage centre (3rd double: sirens). */
export function doublesFlash(p: DoublesParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const c = env.c;
  const at = p.at ? c.fromClient(p.at.x, p.at.y) : c.center();
  if (p.triple) {
    const st = c.stage();
    const u = b.u;
    siren(b, { x: at.x, y: st.y + 0.8 * u }, 'N', 0, 15, 0.6);
    siren(b, { x: at.x, y: st.y + st.height - 0.8 * u }, 'S', 0, 15, 0.6);
    siren(b, { x: st.x + 0.8 * u, y: at.y }, 'W', 0, 15, 0.6);
    siren(b, { x: st.x + st.width - 0.8 * u, y: at.y }, 'E', 0, 15, 0.6);
    ring(b, at, 0, RED, 1.3);
    ring(b, at, 8, RED, 1.3);
    b.at(0, sfx('warning'), haptic('warning'), shake(4, 240), block());
    return b.build('doublesFlash', 2, PRIORITY.misc, { stage: true });
  }
  ring(b, at, 0, GOLD, 1.3);
  starBurst(b, at, 0, GOLD, 1.1);
  sparkles(b, at, 10, 0, { r: 1.7, color: [GOLD, SPARK_WHITE], stagger: 0.75 });
  // No sfx: Dice.ts already plays 'doubles' on the landing frame.
  b.at(0, haptic('light'));
  return b.build('doublesFlash', 2, PRIORITY.misc, { stage: true });
}

interface DiceLandParams {
  /** Die centres (client px); default two points around the stage centre. */
  points?: readonly Pt[];
}

/** Dice landing impact: a small dust puff under each die (no sound — the dice already play one). */
export function diceLand(p: DiceLandParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const c = env.c;
  const mid = c.center();
  const pts = p.points?.map((q) => c.fromClient(q.x, q.y)) ?? [
    { x: mid.x - 0.9 * b.u, y: mid.y },
    { x: mid.x + 0.9 * b.u, y: mid.y },
  ];
  for (const q of pts.slice(0, 2)) dust(b, add(q, 0, 0.5 * b.u), 0, 0.55, '#DCD3C2', 3, 0.5);
  return b.build('diceLand', 0, PRIORITY.misc);
}

interface HopParams {
  space: number;
  /** Long move (≥ 6 steps): speed lines behind the token. */
  long?: boolean;
  /** Direction of travel (deg, screen) for the speed lines. */
  dir?: number;
}

/** Token hop landing dust (I0). */
export function hopDust(p: HopParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const tile = env.c.space(p.space);
  dust(b, add(tile, 0, 0.25 * b.u), 0, 0.5, '#D9D0BF', 2, 0.35);
  if (p.long) b.at(0, spawn((e) => void e.emit({ anim: 'speed_lines', x: tile.x, y: tile.y, life: 6, s: 0.6, rot: (p.dir ?? 0) + 180, a: 0.7, tint: WHITE, fadeOut: 3, layer: 1 })));
  b.area(tile, 1.5);
  return b.build('hopDust', 0, PRIORITY.misc);
}

interface TapParams {
  /** Client px. */
  x: number;
  y: number;
  player?: PlayerId;
}

/** Prompt confirm tap: 4 sparkles + a small ring (≤ 100 ms latency, I0). */
export function tap(p: TapParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const at = env.c.fromClient(p.x, p.y);
  const col = p.player !== undefined ? env.color(p.player) : GOLD;
  ring(b, at, 0, col, 0.4, 7);
  sparkles(b, at, 4, 0, { r: 0.7, color: [col, GOLD], stagger: 0.5, s: 0.45, life: 7 });
  return b.build('tap', 0, PRIORITY.misc);
}

interface PulseParams {
  at: Anchor;
  /** Ring / sparkle colour (default gold); `player` sets the owner colour. */
  color?: string;
  player?: PlayerId;
  /** Sparkles around the ring (0–12). */
  sparkles?: number;
  /** Second ring 6 f later. */
  double?: boolean;
  scale?: number;
}

/**
 * Generic accent (I0/I1): a ring (+ optional second ring) and a few sparkles at a space / panel /
 * stage — TurnStarted halo, RoundStarted, IslandStay ripple, TakeoverBlocked (sky), DebtSettled
 * (green), PropertyTransferred (receiver colour), AuctionStarted, CardKept, Travel/Escape accents.
 */
export function ringPulse(p: PulseParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const at = b.pt(p.at);
  const col = p.color ?? (p.player !== undefined ? env.color(p.player) : GOLD);
  const s = p.scale ?? 1;
  ring(b, at, 0, col, s);
  if (p.double) ring(b, at, 6, col, s * 1.2);
  const n = Math.min(12, p.sparkles ?? 4);
  if (n) sparkles(b, at, n, 1, { r: 0.8 * s, color: [col, GOLD], stagger: 0.75 });
  const total = 1 + (p.double ? 1 : 0) + n;
  return b.build('ringPulse', total <= 8 ? 0 : 1, PRIORITY.misc, 'space' in p.at ? { space: p.at.space } : 'panel' in p.at ? { panel: p.at.panel } : undefined);
}

interface PuffParams {
  at: Anchor;
  /** Dust colour (default grey: loss / no effect). */
  color?: string;
  /** Rising smoke puffs (0–3). */
  smoke?: number;
  /** Brick chips (demolition, 0–10). */
  bricks?: number;
  scale?: number;
}

/** Generic puff (I0/I1): dust (+ smoke, + brick chips) — CannotAfford, Demolished, CardUsed/NoEffect, festival removed. */
export function puff(p: PuffParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const at = b.pt(p.at);
  const u = b.u;
  const s = p.scale ?? 1;
  dust(b, at, 0, 0.8 * s, p.color ?? '#B9C0CC', 2, 0.4);
  if (p.smoke) smoke(b, at, 1, Math.min(3, p.smoke), 3, SMOKE);
  const nb = Math.min(10, p.bricks ?? 0);
  if (nb)
    b.at(
      0,
      burst(nb, (k, _n, e) => {
        const a = e.rng.range(0, Math.PI * 2);
        const sp = e.rng.range(5, 9) * u;
        return { anim: 'brick_chip', frame: k % 3, x: at.x, y: at.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3 * u, ay: 24 * u, life: 16, s: 0.7, vrot: e.rng.jitter(540), fadeOut: 4, layer: 3 };
      }),
    );
  b.area(at, 3);
  const total = 2 + (p.smoke ?? 0) + nb;
  return b.build('puff', total <= 8 ? 0 : 1, PRIORITY.misc, 'space' in p.at ? { space: p.at.space } : undefined);
}

interface CometJumpParams {
  from: number;
  to: number;
  player: PlayerId;
}

/** Token jump (island / card move / travel): a comet from space to space, landing ring + dust (I1). */
export function cometJump(p: CometJumpParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const a = env.c.space(p.from);
  const z = env.c.space(p.to);
  const col = env.color(p.player);
  comet(b, a, z, 0, 13, col, 1, 0.3);
  ring(b, z, 13, col, 1);
  dust(b, z, 13, 0.8, DUST, 2, 0.4);
  sparkles(b, z, 6, 13, { r: 0.8, color: [col, GOLD] });
  b.at(13, block());
  return b.build('cometJump', 1, PRIORITY.misc, { space: p.to });
}

interface BillRainParams {
  player: PlayerId;
  /** Number of bills (≤ 10). */
  n?: number;
}

/** Money won from a card / pot: bills flutter down in front of the player's panel + sparkles (I1). */
export function billRain(p: BillRainParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const u = b.u;
  const pa = env.c.panel(p.player);
  const seat = pa.seat;
  const n = Math.min(10, p.n ?? 6);
  const g = seatLocal(seat, 0, 1);
  b.area(pa, 3).area(local(b, pa, seat, 0, -2.4), 2);
  b.at(
    0,
    burst(n, (k, _n, e) => {
      const q = local(b, pa, seat, e.rng.jitter(2.2), -e.rng.range(1.6, 2.6));
      return { anim: 'bill_flutter', frame: k, x: q.x, y: q.y, vx: g.x * 1.5 * u, vy: g.y * 1.5 * u, ax: g.x * 3 * u, ay: g.y * 3 * u, delay: k, life: 22, s: 0.6, rot: SEAT_ANGLE[seat], swing: [16, 1.3], fadeIn: 3, fadeOut: 5, layer: 3 };
    }),
  );
  sparkles(b, pa, 4, 8, { r: 1.2, color: GOLD });
  b.at(0, sfx('cash-in'), haptic('light'));
  b.at(8, dom((d) => d.panelBump?.(p.player)));
  return b.build('billRain', 1, PRIORITY.misc, { panel: p.player });
}

interface ConfettiRainParams {
  /** Pieces (≤ 90). */
  n?: number;
}

/**
 * Screen-wide celebration (Result screen, replaces the old `particles.confetti`): two cannons at
 * the bottom corners of the layer shoot confetti up and inward in two waves; gravity pulls it down (I2).
 */
export function confettiRain(p: ConfettiRainParams, env: PresetEnv): Timeline {
  const b = new B(env);
  const c = env.c;
  const W = c.width;
  const H = c.height;
  const n = Math.min(90, p.n ?? 60);
  const per = Math.max(1, Math.floor(n / 4));
  for (const side of [-1, 1]) {
    const q = { x: side < 0 ? W * 0.06 : W * 0.94, y: H * 0.98 };
    const dir = side < 0 ? -62 : -118;
    for (const f of [0, 9]) confetti(b, q, per, f, { dir, spread: 16, speed: [26, 38], g: [0, 16], drag: 0.95, colors: CONFETTI, life: [50, 66], stagger: 0.3 });
  }
  b.at(0, block());
  b.bb.add(0, 0).add(W, H);
  return b.build('confettiRain', 2, PRIORITY.victory, { stage: true });
}

/** Preset registry (name → builder). */
export const PRESETS = {
  plotClaim,
  coinIn,
  buildSeq,
  landmarkReveal,
  freeUpgrade,
  frameSwap,
  takeoverStamp,
  groupChain,
  groupFinale,
  tollPay,
  passStart,
  cardReveal,
  islandSiren,
  festivalBurst,
  bankruptcy,
  victory,
  oneAway,
  doublesFlash,
  diceLand,
  hopDust,
  tap,
  ringPulse,
  puff,
  cometJump,
  billRain,
  confettiRain,
} as const;

export type PresetName = keyof typeof PRESETS;
export type PresetParams<N extends PresetName> = Parameters<(typeof PRESETS)[N]>[0];

/** Build a preset timeline by name. */
export function buildPreset<N extends PresetName>(name: N, params: PresetParams<N>, env: PresetEnv): Timeline {
  return (PRESETS[name] as (p: PresetParams<N>, e: PresetEnv) => Timeline)(params, env);
}

export { c1ForOvershoot };
