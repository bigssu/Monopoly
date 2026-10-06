/**
 * The dice throw (docs/DESIGN.md "Dice throw"): a library-free kinematic model, pure (no DOM).
 *
 * Each die is a point with a 2D position and velocity in the stage's own frame (px, y down; the
 * acting seat is at the bottom, so "forward" = toward the board centre = -y). No gravity: the
 * throw is seen from above, so the motion is planar friction — the speed follows (1 - u)², which
 * stops each die exactly at the end of its roll — plus reflection off the four walls of `box`
 * (the dice area, as the range of die CENTRES) with restitution 0.55 on the normal component, and
 * a one-line circle separation between the two dice (pushed apart, part of the normal velocity
 * swapped). The spin is the rolling of the cube (angle = distance / radius), so it is
 * proportional to the launch speed and decays with the friction. The end pose is planned: the
 * spin is scaled (or, for a die that barely rolls on one axis, blended) so each die comes to rest
 * on the face the engine rolled. The planner picks, near the flick's speed and angle, the throw
 * that comes to rest closest to the die's place in the pair, and the second half of each roll
 * steers the rest of the way home (`homeFrom`), so the landed dice are the crisp DOM ones under
 * the total badge.
 *
 * The throw's direction and strength never influence the result: the engine's seeded RNG has
 * already decided the faces (`reduce`), the throw only arrives on them.
 *
 * A flick (release speed ≥ 300 px/s) throws in its direction with a strength clamped so each die
 * hits the walls 2–3 times and the whole throw settles in 1.2–1.6 s. A press-and-release without a
 * swipe (or the keyboard) is a weak toss forward on the same code path: a short hop, at most one
 * soft wall touch, ~1.1 s. Reduced motion keeps the in-place roll (`rollMode`).
 */
import { cubicBezier } from '@/ui/fx/quantize';

export interface Vec {
  x: number;
  y: number;
}

/** Allowed range of die centres (stage px). */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Cube rotation [rx, ry] (deg) at the start and the final pose (mod 360) to arrive on. */
export interface Pose {
  from: [number, number];
  to: [number, number];
}

export const THROW = {
  /** Release speed (px/s, over the last `windowMs`) that counts as a flick. */
  flickMin: 300,
  windowMs: 80,
  /** Flick speed that maps to the strongest throw (px/s). */
  flickMax: 2600,
  restitution: 0.55,
  /** Kept tangential velocity at a wall hit. */
  tangential: 0.86,
  /** Roll length (ms at speed 1) of a flick, weakest → strongest. */
  flickRoll: [1150, 1420] as const,
  /** Weak toss: roll length (ms) and travel (die sizes). */
  tossRoll: 1000,
  tossTravel: 1.5,
  /** Wall hits per die: a flick 2–3, a toss at most 1. */
  bounces: [2, 3] as const,
  tossBounces: 1,
  /** From this fraction of its roll on, a die steers home (its rest point blends into its place);
   * a toss later, so its short hop forward reads before it rolls back into place. */
  homeFrom: 0.5,
  tossHomeFrom: 0.62,
  /** The second die leaves this much later (ms). */
  delay: 60,
  /** A flick's whole throw, start → both dice home (ms at speed 1). */
  total: [1200, 1540] as const,
  /** Wall "clacks" per throw (sound). */
  maxClacks: 3,
  /** Rolling: cube turn per distance, as a fraction of a true roll (distance / radius). */
  rolling: 0.8,
  /** Fastest launch, in die sizes per second (about one die per 30 Hz frame). */
  maxSpeed: 32,
  /** How far (die sizes) a lifted die may rise above the top wall's centre line. */
  liftOver: 0.15,
  /** Simulation step (ms). */
  stepMs: 1000 / 120,
} as const;

/** The landing bounce: [offset, translateY (die sizes), sx, sy] (the tumble's, shared). */
export const BOUNCE: [number, number, number, number][] = [
  [0, -1.1, 1.15, 1.15],
  [0.55, 0.08, 1.04, 0.94],
  [0.72, -0.14, 1, 1],
  [1, 0, 1, 1],
];
const BOUNCE_EASE = cubicBezier(0.3, 0.6, 0.4, 1);
/** [translateY (die sizes), sx, sy] of the landing bounce at t in [0, 1]. */
export function bounceAt(t: number): [number, number, number] {
  const p = BOUNCE_EASE(Math.min(1, Math.max(0, t)));
  let i = 0;
  while (i < BOUNCE.length - 2 && p > BOUNCE[i + 1]![0]) i++;
  const a = BOUNCE[i]!;
  const b = BOUNCE[i + 1]!;
  const u = (p - a[0]) / (b[0] - a[0]);
  return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
}

/** How a roll is shown: headless → instantly, reduced motion → the in-place roll, else thrown. */
export function rollMode(o: { headless: boolean; reduced: boolean; measured: boolean }): 'instant' | 'inplace' | 'throw' {
  if (o.headless) return 'instant';
  if (o.reduced || !o.measured) return 'inplace';
  return 'throw';
}

/**
 * Release velocity (px/s) of a stroke, from pointer samples [x, y, t ms] ending with the release:
 * the motion over the last `windowMs` before the finger last moved, if it let go within
 * `holdMs` of that (a flick lets go while moving; a stroke that stops and rests is no flick).
 */
export function releaseVelocity(samples: ReadonlyArray<readonly [number, number, number]>, windowMs: number = THROW.windowMs, holdMs = 100): Vec {
  const up = samples[samples.length - 1];
  if (!up) return { x: 0, y: 0 };
  // The last sample that moved.
  let k = samples.length - 1;
  while (k > 0 && samples[k]![0] === samples[k - 1]![0] && samples[k]![1] === samples[k - 1]![1]) k--;
  const last = samples[k]!;
  if (k === 0 || up[2] - last[2] > holdMs) return { x: 0, y: 0 };
  let first = last;
  for (let i = k; i >= 0; i--) {
    const s = samples[i]!;
    if (last[2] - s[2] > windowMs) break;
    first = s;
  }
  const dt = last[2] - first[2];
  // A sample pair closer than 8 ms is noise, not a swipe.
  if (dt < 8) return { x: 0, y: 0 };
  return { x: ((last[0] - first[0]) / dt) * 1000, y: ((last[1] - first[1]) / dt) * 1000 };
}

/** One axis of a die's spin: angle(t) = from + R(t)·scale + fix·smooth(u). */
interface AxisSpin {
  from: number;
  scale: number;
  fix: number;
}

export interface DieTrack {
  home: Vec;
  /** Where the free roll would have stopped (the tail steers from there to `home`). */
  rest: Vec;
  /** ms after the throw starts that this die leaves, and how long it rolls. */
  delay: number;
  roll: number;
  /** Per simulation step: centre, accumulated rolling angle about x / y (deg). */
  xs: Float64Array;
  ys: Float64Array;
  ax: Float64Array;
  ay: Float64Array;
  bounces: number;
  spin: [AxisSpin, AxisSpin];
}

export interface Hit {
  /** ms after the throw starts. */
  t: number;
  die: 0 | 1;
  /** 0..1 (impact speed). */
  strength: number;
}

export interface ThrowPlan {
  kind: 'flick' | 'toss';
  /** ms at speed 1, start → both dice home. */
  total: number;
  /** The walls (die centres) and the die size. */
  box: Box;
  ds: number;
  dice: [DieTrack, DieTrack];
  /** Wall clacks to play (≤ THROW.maxClacks). */
  hits: Hit[];
  /** Launch direction (unit) and speed (px/s) of the first die. */
  dir: Vec;
  speed: number;
  /** Scale of the landing bounce's lift. */
  lift: number;
}

export interface DieState {
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** Landing bounce: lift (die sizes, up < 0) and squash. */
  ty: number;
  sx: number;
  sy: number;
}

const DEG = 180 / Math.PI;
const smooth = (u: number): number => {
  const v = Math.min(1, Math.max(0, u));
  return v * v * (3 - 2 * v);
};
const rot = (v: Vec, deg: number): Vec => {
  const c = Math.cos(deg / DEG);
  const s = Math.sin(deg / DEG);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
};
const len = (v: Vec): number => Math.hypot(v.x, v.y);

interface Launch {
  w: Vec;
  delay: number;
  roll: number;
}

interface Sim {
  tracks: { xs: number[]; ys: number[]; bounces: number; rest: Vec }[];
  hits: { t: number; die: 0 | 1; speed: number }[];
}

/** Speed profile: 1 at launch, 0 (at rest) at the end of the roll. */
const profile = (u: number): number => (u >= 1 ? 0 : (1 - Math.max(0, u)) ** 2);

function simulate(box: Box, homes: Vec[], ds: number, launches: Launch[]): Sim {
  const dt = THROW.stepMs;
  const nd = homes.length;
  let end = 0;
  for (const l of launches) end = Math.max(end, l.delay + l.roll);
  const n = Math.ceil(end / dt) + 1;
  const px = homes.map((h) => h.x);
  const py = homes.map((h) => h.y);
  const wx = launches.map((l) => l.w.x);
  const wy = launches.map((l) => l.w.y);
  const f = [0, 0];
  const tracks = homes.map(() => ({ xs: new Array<number>(n), ys: new Array<number>(n), bounces: 0, rest: { x: 0, y: 0 } }));
  const hits: Sim['hits'] = [];
  const minD = ds * 1.04;
  const e = THROW.restitution;
  const keep = THROW.tangential;
  for (let k = 0; k < n; k++) {
    const t = k * dt;
    for (let i = 0; i < nd; i++) {
      const l = launches[i]!;
      const tm = t + dt / 2 - l.delay;
      const fi = (f[i] = tm >= 0 ? profile(tm / l.roll) : 0);
      if (k === 0 || fi <= 0) continue;
      let x = px[i]! + (wx[i]! * fi * dt) / 1000;
      let y = py[i]! + (wy[i]! * fi * dt) / 1000;
      // Walls: reflect the normal component (restitution), keep most of the tangential one.
      if ((x < box.left && wx[i]! < 0) || (x > box.right && wx[i]! > 0)) {
        tracks[i]!.bounces++;
        hits.push({ t, die: i as 0 | 1, speed: Math.abs(wx[i]!) * fi });
        wx[i] = -wx[i]! * e;
        wy[i] = wy[i]! * keep;
      }
      if ((y < box.top && wy[i]! < 0) || (y > box.bottom && wy[i]! > 0)) {
        tracks[i]!.bounces++;
        hits.push({ t, die: i as 0 | 1, speed: Math.abs(wy[i]!) * fi });
        wy[i] = -wy[i]! * e;
        wx[i] = wx[i]! * keep;
      }
      px[i] = Math.min(box.right, Math.max(box.left, x));
      py[i] = Math.min(box.bottom, Math.max(box.top, y));
    }
    // The two dice never overlap: push apart, and swap part of the approaching normal velocity.
    if (nd === 2) {
      const dx = px[1]! - px[0]!;
      const dy = py[1]! - py[0]!;
      const d = Math.hypot(dx, dy);
      if (d < minD) {
        const nx = d > 1e-6 ? dx / d : 1;
        const ny = d > 1e-6 ? dy / d : 0;
        const push = (minD - d) / 2;
        px[0] = Math.min(box.right, Math.max(box.left, px[0]! - nx * push));
        py[0] = Math.min(box.bottom, Math.max(box.top, py[0]! - ny * push));
        px[1] = Math.min(box.right, Math.max(box.left, px[1]! + nx * push));
        py[1] = Math.min(box.bottom, Math.max(box.top, py[1]! + ny * push));
        const f0 = f[0]!;
        const f1 = f[1]!;
        if (f0 > 0.02 && f1 > 0.02) {
          const vn = (wx[1]! * f1 - wx[0]! * f0) * nx + (wy[1]! * f1 - wy[0]! * f0) * ny;
          if (vn < 0) {
            const j = -0.75 * vn;
            wx[0] = wx[0]! - (j * nx) / f0;
            wy[0] = wy[0]! - (j * ny) / f0;
            wx[1] = wx[1]! + (j * nx) / f1;
            wy[1] = wy[1]! + (j * ny) / f1;
          }
        }
      }
    }
    for (let i = 0; i < nd; i++) {
      tracks[i]!.xs[k] = px[i]!;
      tracks[i]!.ys[k] = py[i]!;
    }
  }
  for (let i = 0; i < nd; i++) tracks[i]!.rest = { x: px[i]!, y: py[i]! };
  return { tracks, hits };
}

/** Spin for one axis: arrive on `to` (mod 360) from `from` after rolling R degrees. */
function axisSpin(from: number, to: number, R: number): AxisSpin {
  const base = (((to - from) % 360) + 360) % 360;
  let best: number | null = null;
  if (Math.abs(R) >= 60) {
    for (let k = -8; k <= 8; k++) {
      const d = base + 360 * k;
      if (Math.sign(d) !== Math.sign(R) || Math.abs(d) < 60) continue;
      if (best === null || Math.abs(d - R) < Math.abs(best - R)) best = d;
    }
    if (best !== null) return { from, scale: best / R, fix: 0 };
  }
  for (let k = -8; k <= 8; k++) {
    const d = base + 360 * k;
    if (best === null || Math.abs(d - R) < Math.abs(best - R)) best = d;
  }
  return { from, scale: 1, fix: best! - R };
}

/** Rolling angles along a path: turning about x from vertical motion, about y from horizontal. */
function rolling(xs: number[], ys: number[], ds: number): [Float64Array, Float64Array] {
  const ax = new Float64Array(xs.length);
  const ay = new Float64Array(xs.length);
  const k = (THROW.rolling * DEG) / (ds / 2);
  for (let i = 1; i < xs.length; i++) {
    ax[i] = ax[i - 1]! - (ys[i]! - ys[i - 1]!) * k;
    ay[i] = ay[i - 1]! + (xs[i]! - xs[i - 1]!) * k;
  }
  return [ax, ay];
}

/** Grow `box` to hold the homes (a cramped layout never puts a die outside its own walls). */
function fitBox(box: Box, homes: [Vec, Vec]): Box {
  const b = { ...box };
  for (const h of homes) {
    b.left = Math.min(b.left, h.x);
    b.right = Math.max(b.right, h.x);
    b.top = Math.min(b.top, h.y);
    b.bottom = Math.max(b.bottom, h.y);
  }
  return b;
}

/**
 * Plan a throw: `v` = release velocity (px/s, stage frame) or null; `homes` = the dice's places in
 * the pair; `poses` = start and final cube rotations. Deterministic for a given `rand`.
 */
export function planThrow(o: { box: Box; homes: [Vec, Vec]; ds: number; v: Vec | null; poses: [Pose, Pose]; rand?: () => number }): ThrowPlan {
  const rand = o.rand ?? Math.random;
  const ds = o.ds;
  const box = fitBox(o.box, o.homes);
  const speedIn = o.v ? len(o.v) : 0;
  const flick = speedIn >= THROW.flickMin;
  // Small per-throw variety (look only): the two dice leave a little apart, one a bit slower.
  const jitter = (rand() - 0.5) * 4;
  const spread: [number, number] = [-2.5 + jitter, 2.5 + jitter];
  const slow = 0.92 + rand() * 0.04;
  let best: { sim: Sim; launches: [Launch, Launch]; cost: number } | null = null;
  let dir: Vec;
  if (flick) {
    dir = { x: o.v!.x / speedIn, y: o.v!.y / speedIn };
    const strength = Math.min(1, Math.max(0, (speedIn - THROW.flickMin) / (THROW.flickMax - THROW.flickMin)));
    const roll = THROW.flickRoll[0] + (THROW.flickRoll[1] - THROW.flickRoll[0]) * strength;
    const spanW = box.right - box.left;
    const spanH = box.bottom - box.top;
    // Path for 2-3 wall hits: about 1.25-2.25 crossings of the box along the direction.
    const across = Math.max(ds, Math.abs(dir.x) * spanW + Math.abs(dir.y) * spanH);
    const path = across * (1.25 + 1.0 * strength);
    // Distance travelled = w · roll / 3 (speed profile), before the wall losses.
    const w0 = Math.min((3 * path) / (roll / 1000), THROW.maxSpeed * ds);
    const scale = (d: Vec, k: number): Vec => ({ x: d.x * k, y: d.y * k });
    const homeMiss = (t: Sim['tracks'][number], h: Vec): number => len({ x: t.rest.x - h.x, y: t.rest.y - h.y }) / ds;
    const outside = (b: number): number => Math.max(0, THROW.bounces[0] - b, b - THROW.bounces[1]);
    // Each die on its own first (cheap): the speeds and angles near the flick that bounce 2-3
    // times and come to rest nearest home (the shortest slide back), the second die close to the
    // first; then the best few pairs together (they may collide).
    // The die ahead in the flick's direction leaves first (the other would run into it).
    const trail = (o.homes[1].x - o.homes[0].x) * dir.x + (o.homes[1].y - o.homes[0].y) * dir.y >= 0 ? 0 : 1;
    const launch = (i: number, m: number, off: number): Launch => ({ w: scale(rot(dir, off), w0 * m), delay: i === trail ? THROW.delay : 0, roll: i === trail ? roll * 0.97 : roll });
    const solo = (i: number, want: { m: number; off: number }, offs: readonly number[]): { m: number; off: number; cost: number }[] => {
      const out: { m: number; off: number; cost: number }[] = [];
      for (const m of [1, 0.88, 1.14, 0.76, 1.3, 1.5, 1.75, 2.1, 0.64]) {
        for (const d of offs) {
          const off = want.off + d;
          const mm = want.m * m;
          // Never faster than about a die per 30 Hz frame: it would read as a jump, not a throw.
          if (w0 * mm > THROW.maxSpeed * ds * 1.0001) continue;
          const tr = simulate(box, [o.homes[i]!], ds, [launch(i, mm, off)]).tracks[0]!;
          out.push({ m: mm, off, cost: outside(tr.bounces) * 10 + homeMiss(tr, o.homes[i]!) + 1.5 * Math.abs(Math.log(m)) + 0.04 * Math.abs(d) });
        }
      }
      return out.sort((x, y) => x.cost - y.cost).slice(0, 4);
    };
    // The leading die within 10 degrees of the flick; the trailing one near its spread from the
    // leader, a little wider if that keeps the two from knocking each other out of the throw.
    const lead = 1 - trail;
    const leads = solo(lead, { m: 1, off: spread[lead]! }, [0, 5, -5, 10, -10]);
    const trails = solo(trail, { m: leads[0]!.m * slow, off: leads[0]!.off + spread[trail]! - spread[lead]! }, [0, 3, -3, 7, -7, 12, -12]);
    for (const a of leads.slice(0, 3)) {
      for (const b of trails) {
        const launches = [] as unknown as [Launch, Launch];
        launches[lead] = launch(lead, a.m, a.off);
        launches[trail] = launch(trail, b.m, b.off);
        const sim = simulate(box, o.homes, ds, launches);
        const cost = sim.tracks.reduce((c, t, i) => c + outside(t.bounces) * 10 + homeMiss(t, o.homes[i]!), 0) + a.cost + b.cost - (a.cost + b.cost) * 0.5;
        if (!best || cost < best.cost) best = { sim, launches, cost };
      }
    }
  } else {
    // Weak toss: forward (toward the board centre), a short hop, at most one soft wall touch.
    dir = rot({ x: 0, y: -1 }, (rand() - 0.5) * 8);
    let w0 = (3 * THROW.tossTravel * ds) / (THROW.tossRoll / 1000);
    for (let k = 0; k < 8; k++) {
      const launches = [0, 1].map((i) => ({
        w: ((d) => ({ x: d.x * w0 * (i ? slow : 1), y: d.y * w0 * (i ? slow : 1) }))(rot(dir, (i ? 7 : -7) + jitter)),
        delay: i ? THROW.delay : 0,
        roll: THROW.tossRoll,
      })) as [Launch, Launch];
      const sim = simulate(box, o.homes, ds, launches);
      best = { sim, launches, cost: 0 };
      if (sim.tracks.every((t) => t.bounces <= THROW.tossBounces)) break;
      w0 *= 0.7;
    }
  }
  const { sim, launches } = best!;
  const dice = [0, 1].map((i) => {
    const tr = sim.tracks[i]!;
    const [ax, ay] = rolling(tr.xs, tr.ys, ds);
    const pose = o.poses[i]!;
    const R = [ax[ax.length - 1]!, ay[ay.length - 1]!];
    return {
      home: o.homes[i]!,
      rest: tr.rest,
      delay: launches[i]!.delay,
      roll: launches[i]!.roll,
      xs: Float64Array.from(tr.xs),
      ys: Float64Array.from(tr.ys),
      ax,
      ay,
      bounces: tr.bounces,
      spin: [axisSpin(pose.from[0], pose.to[0], R[0]!), axisSpin(pose.from[1], pose.to[1], R[1]!)],
    } satisfies DieTrack;
  }) as [DieTrack, DieTrack];
  let total = Math.max(...dice.map((d) => d.delay + d.roll));
  // A flick settles inside its window (a short one holds still at home until it opens).
  if (flick) total = Math.min(THROW.total[1], Math.max(THROW.total[0], total));
  // Clacks: the first wall hits that are heard, spaced out, at most three.
  const hits: Hit[] = [];
  for (const h of [...sim.hits].sort((a, b) => a.t - b.t)) {
    if (hits.length >= THROW.maxClacks) break;
    if (h.speed < 40 || (hits.length && h.t - hits[hits.length - 1]!.t < 60)) continue;
    hits.push({ t: h.t, die: h.die, strength: Math.min(1, Math.max(0.15, h.speed / 1600)) });
  }
  const w = launches[0].w;
  return { kind: flick ? 'flick' : 'toss', total, box, ds, dice, hits, dir, speed: len(w), lift: flick ? 0.6 : 0.45 };
}

/** One die's state `t` ms into the throw, before the pair's separation (`samplePair`). */
function sampleDie(plan: ThrowPlan, i: 0 | 1, t: number): DieState {
  const d = plan.dice[i];
  const u = Math.min(1, Math.max(0, (t - d.delay) / d.roll));
  const n = d.xs.length;
  const fk = Math.min(n - 1, Math.max(0, t / THROW.stepMs));
  const k0 = Math.floor(fk);
  const k1 = Math.min(n - 1, k0 + 1);
  const a = fk - k0;
  const lerp = (arr: Float64Array): number => arr[k0]! + (arr[k1]! - arr[k0]!) * a;
  const [sx0, sy0] = d.spin;
  const R = u >= 1 ? [d.ax[n - 1]!, d.ay[n - 1]!] : [lerp(d.ax), lerp(d.ay)];
  const s = smooth(u);
  // The tail of the roll steers home: the rest point's offset is blended in while the die is
  // still rolling (slow by then), so it comes to rest in its place in the pair.
  const from = plan.kind === 'toss' ? THROW.tossHomeFrom : THROW.homeFrom;
  const g = smooth((u - from) / (1 - from));
  const b = plan.box;
  const x = u >= 1 ? d.home.x : Math.min(b.right, Math.max(b.left, lerp(d.xs) + (d.home.x - d.rest.x) * g));
  const y = u >= 1 ? d.home.y : Math.min(b.bottom, Math.max(b.top, lerp(d.ys) + (d.home.y - d.rest.y) * g));
  const [ty, sx, sy] = bounceAt(u);
  // Near the far (top) wall the hop is lower: the lifted die never rises over the wall's edge
  // (the banner and round line sit above it).
  const lift = Math.max(ty * plan.lift, (b.top - y) / plan.ds - THROW.liftOver);
  return { x, y, rx: sx0.from + R[0]! * sx0.scale + sx0.fix * s, ry: sy0.from + R[1]! * sy0.scale + sy0.fix * s, ty: lift, sx, sy };
}

/** Both dice `t` ms into the throw; while steering home they are kept from overlapping. */
export function samplePair(plan: ThrowPlan, t: number): [DieState, DieState] {
  const p: [DieState, DieState] = [sampleDie(plan, 0, t), sampleDie(plan, 1, t)];
  const minD = plan.ds * 1.02;
  const dx = p[1].x - p[0].x;
  const dy = p[1].y - p[0].y;
  const d = Math.hypot(dx, dy);
  if (t < plan.total && d < minD) {
    const nx = d > 1e-6 ? dx / d : 1;
    const ny = d > 1e-6 ? dy / d : 0;
    const push = (minD - d) / 2;
    const b = plan.box;
    p[0].x = Math.min(b.right, Math.max(b.left, p[0].x - nx * push));
    p[0].y = Math.min(b.bottom, Math.max(b.top, p[0].y - ny * push));
    p[1].x = Math.min(b.right, Math.max(b.left, p[1].x + nx * push));
    p[1].y = Math.min(b.bottom, Math.max(b.top, p[1].y + ny * push));
  }
  return p;
}

/** One die's state `t` ms into the throw. */
export function sampleThrow(plan: ThrowPlan, i: 0 | 1, t: number): DieState {
  return samplePair(plan, t)[i];
}

/** Bounding box of every die centre over the throw (stage px). */
export function throwBounds(plan: ThrowPlan): Box {
  const b = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  const add = (x: number, y: number): void => {
    b.left = Math.min(b.left, x);
    b.right = Math.max(b.right, x);
    b.top = Math.min(b.top, y);
    b.bottom = Math.max(b.bottom, y);
  };
  for (const d of plan.dice) {
    for (let k = 0; k < d.xs.length; k++) add(d.xs[k]!, d.ys[k]!);
    add(d.home.x, d.home.y);
  }
  // The steering home moves inside the walls too (clamped): count the walls' side it may reach.
  for (let t = 0; t <= plan.total; t += 1000 / 30) for (const s of samplePair(plan, t)) add(s.x, s.y);
  return b;
}
