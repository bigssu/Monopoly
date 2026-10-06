/**
 * Particle kinds, spawning, fixed-step integration and per-draw sampling on the SoA pool.
 *
 * Kinds: sprite-anim (animated atlas frames: looping, fixed fps, or `fit` = once over the life),
 * sprite-static (1-frame sprites, e.g. confetti with a cosine flip), additive glow
 * (`blend: 'add'`). Motion is either ballistic (velocity + gravity + per-frame drag) or a quadratic
 * Bézier path with an easing. Time is in 30 fps frames; velocities in px/s; gravity in px/s².
 */
import { FX_ANIM_NAMES, FX_ANIMS, type FxAnimName } from '@/content/fx/manifest';
import { bezier2, Ease, ease, outBack, type EaseId } from './ease';
import { PF, type ParticlePool } from './pool';

const FPS = 30;
export const FRAME_MS = 1000 / FPS;
const DT = 1 / FPS;
const DEG = Math.PI / 180;

export const ANIM_INDEX: Record<FxAnimName, number> = Object.fromEntries(FX_ANIM_NAMES.map((n, i) => [n, i])) as Record<
  FxAnimName,
  number
>;

/** Frame count per animation index. */
const ANIM_N: readonly number[] = FX_ANIM_NAMES.map((n) => FX_ANIMS[n].n);

type Blend = 'normal' | 'add';

/** One particle to spawn (positions in layer px, sizes as multiples of the sprite's nominal size × u/30). */
export interface PSpec {
  anim: FxAnimName;
  x?: number;
  y?: number;
  /** Frames to wait before appearing. */
  delay?: number;
  /** Lifetime in frames (after the delay). */
  life: number;
  // Ballistic motion
  vx?: number;
  vy?: number;
  ax?: number;
  ay?: number;
  /** Velocity multiplier per frame (1 = none). */
  drag?: number;
  // Path motion (overrides x/y/v*)
  path?: { x0: number; y0: number; cx: number; cy: number; x1: number; y1: number; ease?: EaseId; frames?: number };
  /** Rotate along the motion direction (plus `rot`). */
  align?: boolean;
  // Scale curve
  s?: number;
  s1?: number;
  s2?: number;
  /** Fraction of the life where s1 is reached (then → s2). Default 1. */
  sT?: number;
  se1?: EaseId;
  se2?: EaseId;
  /** easeOutBack constant for OutBack scale segments. */
  c1?: number;
  /** Horizontal stretch factor (x only). */
  sxK?: number;
  /** Squash [ageFrame, sx, sy] (2 f hold then popBack to 1). */
  squash?: readonly [number, number, number];
  // Alpha
  a?: number;
  fadeIn?: number;
  fadeOut?: number;
  // Rotation (degrees)
  rot?: number;
  vrot?: number;
  /** Decaying swing [amplitude deg, Hz]. */
  swing?: readonly [number, number];
  /** Confetti flip: scaleX = cos(flip0 + vflip·t), rad/s. */
  vflip?: number;
  flip0?: number;
  // Sprite
  frame?: number;
  fps?: number;
  loop?: boolean;
  /** Play the frames once over the whole life. */
  fit?: boolean;
  anchor?: readonly [number, number];
  tint?: string;
  blend?: Blend;
  /** Draw order 0 (back) … 3 (front). */
  layer?: number;
  /** Hammer swing: [firstContactAge, gapFrames, hits]. */
  hammer?: readonly [number, number, number];
}

/**
 * Write a spec into slot `i`. `unit` = u / 30 (sprite size factor). `rate` < 1 plays the particle
 * slower in proportion (an event's stretched effect): it ages `rate` frames per FX frame, so its
 * life, delay, fades, path, scale curve, spin and sprite frames all take 1/rate as long.
 */
export function writeParticle(pool: ParticlePool, i: number, p: PSpec, unit: number, rate = 1): void {
  const meta = FX_ANIMS[p.anim];
  pool.anim[i] = ANIM_INDEX[p.anim];
  pool.life[i] = Math.max(1, p.life);
  pool.rate[i] = rate;
  pool.age[i] = -(p.delay ?? 0);
  pool.x[i] = p.x ?? 0;
  pool.y[i] = p.y ?? 0;
  pool.vx[i] = p.vx ?? 0;
  pool.vy[i] = p.vy ?? 0;
  pool.ax[i] = p.ax ?? 0;
  pool.ay[i] = p.ay ?? 0;
  pool.drag[i] = p.drag ?? 1;
  let flags = PF.Alive;
  if (p.path) {
    flags |= PF.Path;
    pool.x0[i] = p.path.x0;
    pool.y0[i] = p.path.y0;
    pool.cx[i] = p.path.cx;
    pool.cy[i] = p.path.cy;
    pool.x1[i] = p.path.x1;
    pool.y1[i] = p.path.y1;
    pool.pe[i] = p.path.ease ?? Ease.OutQuad;
    pool.pl[i] = Math.max(1, Math.min(p.path.frames ?? p.life, p.life));
    pool.x[i] = p.path.x0;
    pool.y[i] = p.path.y0;
  }
  if (p.align) flags |= PF.Align;
  if (p.fit) flags |= PF.Fit;
  if (p.loop ?? meta.loop) flags |= PF.Loop;
  if (p.hammer) {
    flags |= PF.Hammer;
    pool.hp0[i] = p.hammer[0];
    pool.hp1[i] = p.hammer[1];
    pool.hp2[i] = p.hammer[2];
  }
  pool.flags[i] = flags;
  const s = (p.s ?? 1) * unit;
  pool.s0[i] = s;
  pool.s1[i] = (p.s1 ?? p.s ?? 1) * unit;
  pool.s2[i] = (p.s2 ?? p.s1 ?? p.s ?? 1) * unit;
  pool.sT[i] = p.sT ?? 1;
  pool.se1[i] = p.se1 ?? Ease.Linear;
  pool.se2[i] = p.se2 ?? Ease.Linear;
  pool.sc1[i] = p.c1 ?? 1.70158;
  pool.sxK[i] = p.sxK ?? 1;
  if (p.squash) {
    pool.sqAt[i] = p.squash[0];
    pool.sqX[i] = p.squash[1];
    pool.sqY[i] = p.squash[2];
  }
  pool.amax[i] = p.a ?? 1;
  pool.fin[i] = p.fadeIn ?? 0;
  pool.fout[i] = p.fadeOut ?? 0;
  pool.rot[i] = p.rot ?? 0;
  pool.vrot[i] = p.vrot ?? 0;
  pool.swA[i] = p.swing?.[0] ?? 0;
  pool.swF[i] = p.swing?.[1] ?? 0;
  pool.vflip[i] = p.vflip ?? 0;
  pool.flip[i] = p.flip0 ?? 0;
  pool.frame0[i] = p.frame ?? 0;
  pool.fps[i] = p.fps ?? meta.fps;
  pool.anchorX[i] = p.anchor?.[0] ?? 0.5;
  pool.anchorY[i] = p.anchor?.[1] ?? 0.5;
  pool.tint[i] = pool.tintId(p.tint);
  pool.blend[i] = p.blend === 'add' ? 1 : 0;
  pool.layer[i] = p.layer ?? 1;
}

/** Advance every live particle by one fixed 30 fps step (× its `rate`); frees the finished ones. */
export function stepParticles(pool: ParticlePool): void {
  const { flags, age, life, rate } = pool;
  for (let i = 0; i < pool.cap; i++) {
    const fl = flags[i]!;
    if (!(fl & PF.Alive)) continue;
    const r = rate[i]!;
    const a = age[i]! + r;
    age[i] = a;
    if (a >= life[i]!) {
      pool.free(i);
      continue;
    }
    if (a <= 0 || fl & PF.Path) continue;
    // Ballistic (semi-implicit Euler); a slowed particle takes a shorter step (drag per step ^ r).
    const dt = r === 1 ? DT : DT * r;
    const d = r === 1 ? pool.drag[i]! : pool.drag[i]! ** r;
    const vx = (pool.vx[i]! + pool.ax[i]! * dt) * d;
    const vy = (pool.vy[i]! + pool.ay[i]! * dt) * d;
    pool.vx[i] = vx;
    pool.vy[i] = vy;
    pool.x[i] = pool.x[i]! + vx * dt;
    pool.y[i] = pool.y[i]! + vy * dt;
  }
}

/** A particle's drawable state (reused scratch object: no allocation per draw). */
export interface Sample {
  x: number;
  y: number;
  /** Radians. */
  rot: number;
  sx: number;
  sy: number;
  alpha: number;
  frame: number;
}

export const newSample = (): Sample => ({ x: 0, y: 0, rot: 0, sx: 1, sy: 1, alpha: 0, frame: 0 });

/** Hammer angle (deg) at `age` frames: lift 3 f, strike 2 f, contact at `first + k·gap`, settle after the last. */
export function hammerAngle(age: number, first: number, gap: number, hits: number): number {
  const LIFT = -35;
  const HIT = 20;
  const lastHit = first + (hits - 1) * gap;
  if (age <= first - 5) return 0;
  if (age < first - 2) return LIFT * ease(Ease.InQuad, (age - (first - 5)) / 3);
  if (age <= first) return LIFT + (HIT - LIFT) * ease(Ease.InQuad, (age - (first - 2)) / 2);
  if (age <= lastHit) {
    const k = (age - first) % gap;
    const up = gap / 2;
    const mid = -20;
    if (k === 0) return HIT;
    if (k <= up) return HIT + (mid - HIT) * ease(Ease.OutQuad, k / up);
    return mid + (HIT - mid) * ease(Ease.InQuad, (k - up) / (gap - up));
  }
  // Rest on the tile, then lift slightly away.
  return HIT - 12 * ease(Ease.OutQuad, Math.min(1, (age - lastHit) / 6));
}

/** Evaluate slot `i` into `out`. Returns false when not visible (delayed or transparent). */
export function sampleParticle(pool: ParticlePool, i: number, out: Sample): boolean {
  const age = pool.age[i]!;
  if (age < 0) return false;
  const life = pool.life[i]!;
  const t = age / life;
  const fl = pool.flags[i]!;
  // Alpha
  let a = pool.amax[i]!;
  const fin = pool.fin[i]!;
  const fout = pool.fout[i]!;
  if (fin > 0 && age < fin) a *= (age + 1) / (fin + 1);
  if (fout > 0 && life - age < fout) a *= Math.max(0, (life - age) / fout);
  if (a <= 0.004) return false;
  out.alpha = a > 1 ? 1 : a;
  // Position
  let dirX = pool.vx[i]!;
  let dirY = pool.vy[i]!;
  if (fl & PF.Path) {
    const pt = Math.min(1, age / pool.pl[i]!);
    const e = ease(pool.pe[i]!, pt);
    out.x = bezier2(pool.x0[i]!, pool.cx[i]!, pool.x1[i]!, e);
    out.y = bezier2(pool.y0[i]!, pool.cy[i]!, pool.y1[i]!, e);
    if (fl & PF.Align) {
      const e2 = Math.min(1, e + 0.02);
      dirX = bezier2(pool.x0[i]!, pool.cx[i]!, pool.x1[i]!, e2) - out.x;
      dirY = bezier2(pool.y0[i]!, pool.cy[i]!, pool.y1[i]!, e2) - out.y;
    }
  } else {
    out.x = pool.x[i]!;
    out.y = pool.y[i]!;
  }
  // Scale
  const sT = pool.sT[i]!;
  let s: number;
  if (t < sT) s = pool.s0[i]! + (pool.s1[i]! - pool.s0[i]!) * ease(pool.se1[i]!, t / sT, pool.sc1[i]!);
  else s = pool.s1[i]! + (pool.s2[i]! - pool.s1[i]!) * ease(pool.se2[i]!, sT >= 1 ? 1 : (t - sT) / (1 - sT), pool.sc1[i]!);
  // OutBack evaluated at t=1 by `ease()` returns exactly 1; overshoot happens inside the segment.
  let sx = s * pool.sxK[i]!;
  let sy = s;
  const sqAt = pool.sqAt[i]!;
  if (sqAt >= 0 && age >= sqAt) {
    const d = age - sqAt;
    if (d < 2) {
      sx *= pool.sqX[i]!;
      sy *= pool.sqY[i]!;
    } else if (d < 7) {
      const k = outBack((d - 2) / 5);
      sx *= pool.sqX[i]! + (1 - pool.sqX[i]!) * k;
      sy *= pool.sqY[i]! + (1 - pool.sqY[i]!) * k;
    }
  }
  const sec = age * DT;
  if (pool.vflip[i] !== 0) sx *= Math.cos(pool.flip[i]! + pool.vflip[i]! * sec);
  out.sx = sx;
  out.sy = sy;
  // Rotation
  let r = pool.rot[i]! + pool.vrot[i]! * sec;
  const swA = pool.swA[i]!;
  if (swA !== 0) r += swA * Math.sin(2 * Math.PI * pool.swF[i]! * sec) * Math.exp(-2.5 * sec);
  if (fl & PF.Hammer) r += hammerAngle(age, pool.hp0[i]!, pool.hp1[i]!, pool.hp2[i]!);
  r *= DEG;
  if (fl & PF.Align && (dirX !== 0 || dirY !== 0)) r += Math.atan2(dirY, dirX);
  out.rot = r;
  // Frame
  const n = ANIM_N[pool.anim[i]!]!;
  let f: number;
  if (fl & PF.Fit) f = Math.min(n - 1, Math.floor(t * n));
  else {
    f = Math.floor(pool.frame0[i]! + sec * pool.fps[i]!);
    f = fl & PF.Loop ? ((f % n) + n) % n : Math.min(n - 1, f);
  }
  out.frame = f;
  return true;
}
