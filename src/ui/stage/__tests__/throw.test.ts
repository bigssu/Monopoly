/**
 * The dice throw's maths (src/ui/stage/throw.ts): walls hold, time bounds, faces, direction, the
 * weak toss forward, and how a roll is shown per time policy.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { planThrow, releaseVelocity, rollMode, sampleThrow, THROW, type Box, type Pose, type ThrowPlan, type Vec } from '../throw';
import { D, setAnimSpeed } from '@/ui/fx/time';

/** A seeded generator (the planner's only randomness is the look of the throw). */
function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Two layouts: a 1600×1000 tablet-size stage and a cramped phone one (pair px, die centres). */
const LAYOUTS: { name: string; ds: number; gap: number; box: Box }[] = [
  { name: 'tablet', ds: 98, gap: 39, box: { left: -220, right: 400, top: -170, bottom: 240 } },
  { name: 'phone', ds: 38, gap: 11, box: { left: -90, right: 150, top: -40, bottom: 70 } },
];
const homesOf = (ds: number, gap: number): [Vec, Vec] => [
  { x: ds / 2, y: ds / 2 },
  { x: ds * 1.5 + gap, y: ds / 2 },
];
/** The cube poses Dice uses: FINAL[n] with the resting tilt (-18, +24). */
const FINAL: Record<number, [number, number]> = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 5: [-90, 0], 2: [90, 0] };
const pose = (from: number, to: number): Pose => ({ from: [FINAL[from]![0] - 18, FINAL[from]![1] + 24], to: [FINAL[to]![0] - 18, FINAL[to]![1] + 24] });
const mod = (x: number): number => ((Math.round(x) % 360) + 360) % 360;

const DIRS: Vec[] = [
  { x: 0, y: -1600 },
  { x: 0, y: 1600 },
  { x: 1600, y: 0 },
  { x: -1600, y: 0 },
  { x: 1100, y: -1100 },
  { x: -900, y: 700 },
  { x: 350, y: 0 },
  { x: 4000, y: 2500 },
];

function plans(): { name: string; v: Vec | null; plan: ThrowPlan; box: Box; ds: number; faces: [number, number] }[] {
  const out = [];
  let k = 0;
  for (const L of LAYOUTS) {
    for (const v of [null, ...DIRS]) {
      const faces: [number, number] = [1 + (k % 6), 1 + ((k * 5 + 2) % 6)];
      k++;
      const plan = planThrow({ box: L.box, homes: homesOf(L.ds, L.gap), ds: L.ds, v, poses: [pose(5, faces[0]), pose(2, faces[1])], rand: seeded(k) });
      out.push({ name: `${L.name} ${v ? `${v.x},${v.y}` : 'tap'}`, v, plan, box: L.box, ds: L.ds, faces });
    }
  }
  return out;
}

afterEach(() => setAnimSpeed(1));

describe('planThrow', () => {
  it('keeps every die centre inside the walls, every step', () => {
    for (const { name, plan, box } of plans()) {
      for (const d of plan.dice) {
        for (let i = 0; i < d.xs.length; i++) {
          expect(d.xs[i]!, name).toBeGreaterThanOrEqual(box.left - 1e-6);
          expect(d.xs[i]!, name).toBeLessThanOrEqual(box.right + 1e-6);
          expect(d.ys[i]!, name).toBeGreaterThanOrEqual(box.top - 1e-6);
          expect(d.ys[i]!, name).toBeLessThanOrEqual(box.bottom + 1e-6);
        }
      }
    }
  });

  it('bounces a flick off the walls 2-3 times and settles in 1.2-1.6 s; a toss in about a second', () => {
    for (const { name, plan } of plans()) {
      if (plan.kind === 'flick') {
        expect(plan.total, name).toBeGreaterThanOrEqual(1200);
        expect(plan.total, name).toBeLessThanOrEqual(1600);
        // Mostly 2-3 each; the two dice may knock one more or one less off each other.
        expect(plan.dice.reduce((s, d) => s + d.bounces, 0), name).toBeGreaterThanOrEqual(3);
        expect(plan.dice.map((d) => Math.min(4, Math.max(1, d.bounces))), name).toEqual(plan.dice.map((d) => d.bounces));
      } else {
        expect(plan.total, name).toBeGreaterThanOrEqual(900);
        expect(plan.total, name).toBeLessThanOrEqual(1200);
      }
      expect(plan.hits.length, name).toBeLessThanOrEqual(THROW.maxClacks);
      // Each die has stopped by the end.
      for (const d of plan.dice) expect(d.delay + d.roll, name).toBeLessThanOrEqual(plan.total + 1e-6);
    }
  });

  it('lands each die at home on the face the engine rolled', () => {
    for (const { name, plan, faces } of plans()) {
      for (const i of [0, 1] as const) {
        const s = sampleThrow(plan, i, plan.total);
        const want = [FINAL[faces[i]]![0] - 18, FINAL[faces[i]]![1] + 24];
        expect(mod(s.rx), `${name} die ${i} rx`).toBe(mod(want[0]!));
        expect(mod(s.ry), `${name} die ${i} ry`).toBe(mod(want[1]!));
        expect(s.x, name).toBeCloseTo(plan.dice[i].home.x, 6);
        expect(s.y, name).toBeCloseTo(plan.dice[i].home.y, 6);
        expect(s.ty, name).toBeCloseTo(0, 6);
        expect([s.sx, s.sy], name).toEqual([1, 1]);
      }
    }
  });

  it('flies in the direction of the flick', () => {
    for (const { name, v, plan } of plans()) {
      if (!v || plan.kind !== 'flick') continue;
      // The die that leaves first; its first frames (before any wall or knock) point the flick's way.
      const i = plan.dice[0].delay === 0 ? 0 : 1;
      const d = plan.dice[i];
      const s = sampleThrow(plan, i, 17);
      const dx = s.x - d.home.x;
      const dy = s.y - d.home.y;
      const cos = (dx * v.x + dy * v.y) / (Math.hypot(dx, dy) * Math.hypot(v.x, v.y));
      // Within ~20 degrees: the planner varies the angle a little (and spreads the two dice).
      expect(cos, name).toBeGreaterThan(Math.cos((22 * Math.PI) / 180));
    }
  });

  it('turns a release without a swipe into a weak toss forward that stays inside', () => {
    for (const L of LAYOUTS) {
      for (const v of [null, { x: 0, y: 0 }, { x: 120, y: -90 }]) {
        const homes = homesOf(L.ds, L.gap);
        const plan = planThrow({ box: L.box, homes, ds: L.ds, v, poses: [pose(1, 3), pose(1, 4)], rand: seeded(7) });
        expect(plan.kind).toBe('toss');
        // Forward = toward the board centre = up in the stage's frame.
        expect(plan.dir.y).toBeLessThan(-0.95);
        for (const d of plan.dice) {
          expect(d.bounces).toBeLessThanOrEqual(THROW.tossBounces);
          let far = 0;
          for (let i = 0; i < d.xs.length; i++) {
            expect(d.ys[i]!).toBeLessThanOrEqual(d.home.y + 1e-6);
            expect(d.xs[i]!).toBeGreaterThanOrEqual(L.box.left - 1e-6);
            expect(d.xs[i]!).toBeLessThanOrEqual(L.box.right + 1e-6);
            expect(d.ys[i]!).toBeGreaterThanOrEqual(L.box.top - 1e-6);
            far = Math.max(far, d.home.y - d.ys[i]!);
          }
          // A real toss: it leaves home (at least half a die), but only a short way.
          expect(far).toBeGreaterThan(L.ds * 0.5);
          expect(far).toBeLessThan(L.ds * 2);
        }
        // The lift is smaller than a flick's (a small hop).
        expect(plan.lift).toBeLessThan(0.6);
      }
    }
  });

  it('is deterministic for a given random source (the look only; the engine decides the faces)', () => {
    const L = LAYOUTS[0]!;
    const a = planThrow({ box: L.box, homes: homesOf(L.ds, L.gap), ds: L.ds, v: { x: 900, y: -1300 }, poses: [pose(1, 2), pose(1, 5)], rand: seeded(3) });
    const b = planThrow({ box: L.box, homes: homesOf(L.ds, L.gap), ds: L.ds, v: { x: 900, y: -1300 }, poses: [pose(1, 2), pose(1, 5)], rand: seeded(3) });
    expect(sampleThrow(a, 1, 700)).toEqual(sampleThrow(b, 1, 700));
  });
});

describe('releaseVelocity', () => {
  it('reads the last 80 ms of the stroke in px/s', () => {
    const v = releaseVelocity([
      [0, 0, 0],
      [5, 0, 100],
      [10, 0, 140],
      [40, -20, 180],
    ]);
    // From the sample at 100 ms (inside the window) to 180 ms: 35 px right, 20 up in 80 ms.
    expect(v.x).toBeCloseTo(437.5, 3);
    expect(v.y).toBeCloseTo(-250, 3);
  });

  it('counts a release just after the last move (the up event repeats the position)', () => {
    const v = releaseVelocity([
      [0, 0, 0],
      [0, -30, 20],
      [0, -60, 40],
      [0, -90, 60],
      [0, -90, 110],
    ]);
    expect(v.y).toBeCloseTo(-1500, 3);
  });

  it('is zero for a press without movement, a single sample, or a stroke that rested before the release', () => {
    expect(releaseVelocity([[10, 10, 0]])).toEqual({ x: 0, y: 0 });
    expect(releaseVelocity([
      [10, 10, 0],
      [10, 10, 300],
    ])).toEqual({ x: 0, y: 0 });
    expect(releaseVelocity([
      [0, 0, 0],
      [0, -60, 40],
      [0, -90, 60],
      [0, -90, 400],
    ])).toEqual({ x: 0, y: 0 });
  });
});

describe('rollMode (time policy)', () => {
  it('headless is instant, reduced motion rolls in place, else the dice are thrown', () => {
    expect(rollMode({ headless: true, reduced: false, measured: true })).toBe('instant');
    expect(rollMode({ headless: true, reduced: true, measured: true })).toBe('instant');
    expect(rollMode({ headless: false, reduced: true, measured: true })).toBe('inplace');
    expect(rollMode({ headless: false, reduced: false, measured: false })).toBe('inplace');
    expect(rollMode({ headless: false, reduced: false, measured: true })).toBe('throw');
  });

  it('a throw takes no time at speed 0 and scales with the animation speed', () => {
    const L = LAYOUTS[0]!;
    const plan = planThrow({ box: L.box, homes: homesOf(L.ds, L.gap), ds: L.ds, v: { x: 0, y: -2000 }, poses: [pose(1, 2), pose(1, 5)], rand: seeded(5) });
    setAnimSpeed(0);
    expect(D(plan.total)).toBe(0);
    setAnimSpeed(2);
    expect(D(plan.total)).toBeCloseTo(plan.total / 2, 6);
  });
});
