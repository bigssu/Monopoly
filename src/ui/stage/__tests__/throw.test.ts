/**
 * The dice throw's maths (src/ui/stage/throw.ts): walls hold, time bounds, faces, direction, the
 * weak toss forward, the flick's strength (faster release → faster, farther, longer), the screen's
 * edges as walls for every seat, the CPU's per-turn flick, and how a roll is shown per time policy.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  cpuFlick,
  flickAim,
  flickLaunch,
  frameFromOne,
  launchOf,
  frameFrom,
  fromScreen,
  planThrow,
  releaseVelocity,
  rollMode,
  samplePair,
  sampleThrow,
  screenToStage,
  screenWalls,
  THROW,
  throwTravel,
  toScreen,
  type Box,
  type Frame,
  type Pose,
  type ThrowPlan,
  type Vec,
} from '../throw';
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
      const plan = planThrow({ box: L.box, homes: homesOf(L.ds, L.gap), ds: L.ds, aim: flickAim(v), poses: [pose(5, faces[0]), pose(2, faces[1])], rand: seeded(k) });
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

  it('lasts as long as its strength: a flick 1.1-1.96 s by release speed, a toss about a second', () => {
    for (const { name, v, plan } of plans()) {
      if (plan.kind === 'flick') {
        const L = flickLaunch(Math.hypot(v!.x, v!.y));
        // The leading die rolls `L.roll`, the other leaves 60 ms later and rolls 3 % shorter.
        expect(plan.total, name).toBeGreaterThanOrEqual(L.roll - 1e-6);
        expect(plan.total, name).toBeLessThanOrEqual(L.roll + THROW.delay + 1e-6);
        expect(plan.total, name).toBeGreaterThanOrEqual(1100);
        expect(plan.total, name).toBeLessThanOrEqual(1960);
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
        expect(s.x, name).toBeCloseTo(plan.dice[i]!.home.x, 6);
        expect(s.y, name).toBeCloseTo(plan.dice[i]!.home.y, 6);
        expect(s.ty, name).toBeCloseTo(0, 6);
        expect([s.sx, s.sy], name).toEqual([1, 1]);
      }
    }
  });

  it('flies in the direction of the flick', () => {
    for (const { name, v, plan } of plans()) {
      if (!v || plan.kind !== 'flick') continue;
      // The die that leaves first; its first frames (before any wall or knock) point the flick's way.
      const i = plan.dice[0]!.delay === 0 ? 0 : 1;
      const d = plan.dice[i]!;
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
        const plan = planThrow({ box: L.box, homes, ds: L.ds, aim: flickAim(v), poses: [pose(1, 3), pose(1, 4)], rand: seeded(7) });
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
    const a = planThrow({ box: L.box, homes: homesOf(L.ds, L.gap), ds: L.ds, aim: flickAim({ x: 900, y: -1300 }), poses: [pose(1, 2), pose(1, 5)], rand: seeded(3) });
    const b = planThrow({ box: L.box, homes: homesOf(L.ds, L.gap), ds: L.ds, aim: flickAim({ x: 900, y: -1300 }), poses: [pose(1, 2), pose(1, 5)], rand: seeded(3) });
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
    const plan = planThrow({ box: L.box, homes: homesOf(L.ds, L.gap), ds: L.ds, aim: flickAim({ x: 0, y: -2000 }), poses: [pose(1, 2), pose(1, 5)], rand: seeded(5) });
    setAnimSpeed(0);
    expect(D(plan.total)).toBe(0);
    setAnimSpeed(2);
    expect(D(plan.total)).toBeCloseTo(plan.total / 2, 6);
  });
});

// --- The flick's strength and the screen's edges ---------------------------------------------------

/** The 1600×1000 game screen: die 100.2 px, gap 39.5, the dice area shrunk to 0.92 under the roll card. */
const SCREEN = { w: 1600, h: 1000, ds: 100.2, gap: 39.5, scale: 0.92, margin: 12 };
const VIEWBOX: Box = { left: SCREEN.margin, top: SCREEN.margin, right: SCREEN.w - SCREEN.margin, bottom: SCREEN.h - SCREEN.margin };
/** The Stage's turn per seat (SEAT_ANGLE). */
const SEATS: Record<string, number> = { S: 0, E: -90, N: 180, W: 90 };
const turn = (v: Vec, deg: number): Vec => {
  const a = (deg * Math.PI) / 180;
  return { x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) };
};

/**
 * The frame Dice measures for a seat: the Stage (centred on the screen) turned by `angle`, the
 * pair 80 px below its centre in the Stage's frame, the two dice measured on the screen.
 */
function seatFrame(angle: number): Frame {
  const homes = homesOf(SCREEN.ds, SCREEN.gap);
  const half = ((SCREEN.ds + SCREEN.gap) / 2) * SCREEN.scale;
  const pc = turn({ x: 0, y: 80 }, angle);
  const along = turn({ x: half, y: 0 }, angle);
  const c: [Vec, Vec] = [
    { x: SCREEN.w / 2 + pc.x - along.x, y: SCREEN.h / 2 + pc.y - along.y },
    { x: SCREEN.w / 2 + pc.x + along.x, y: SCREEN.h / 2 + pc.y + along.y },
  ];
  return frameFrom(homes, c);
}

/** A throw on the game screen for a seat, with the release velocity given on the SCREEN. */
function screenThrow(angle: number, v: Vec | null, seed = 11, faces: [number, number] = [3, 4]): { f: Frame; plan: ThrowPlan; box: Box } {
  const f = seatFrame(angle);
  const box = screenWalls(f, VIEWBOX, SCREEN.ds);
  const tossBox = { left: -220, right: 400, top: -170, bottom: 240 };
  const plan = planThrow({ box, tossBox, homes: homesOf(SCREEN.ds, SCREEN.gap), ds: SCREEN.ds, aim: flickAim(v ? screenToStage(v, angle) : null), poses: [pose(5, faces[0]), pose(2, faces[1])], rand: seeded(seed) });
  return { f, plan, box };
}

/** Every drawn frame (30 Hz) of both dice on the screen: centre (with the hop's lift) and half size. */
function onScreen(f: Frame, plan: ThrowPlan): { x: number; y: number; r: number }[] {
  const out: { x: number; y: number; r: number }[] = [];
  for (let t = 0; t <= plan.total + 1e-6; t += 1000 / 30) {
    for (const s of samplePair(plan, t)) {
      const c = toScreen(f, { x: s.x, y: s.y + s.ty * plan.ds });
      out.push({ ...c, r: (plan.ds / 2) * Math.max(s.sx, s.sy) * f.s });
    }
  }
  return out;
}

const SCREEN_DIRS: Vec[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0.6, y: -0.8 },
  { x: -0.8, y: 0.6 },
];

describe('flick strength (owner: the faster the push, the faster and farther)', () => {
  it('maps the release speed monotonically to the launch, clamped at both ends', () => {
    let prev = flickLaunch(THROW.flickMin);
    expect(prev.strength).toBe(0);
    expect(prev.speed).toBe(THROW.launch[0]);
    expect(prev.roll).toBe(THROW.flickRoll[0]);
    for (let v = THROW.flickMin + 100; v <= THROW.flickMax; v += 100) {
      const L = flickLaunch(v);
      expect(L.speed).toBeGreaterThan(prev.speed);
      expect(L.roll).toBeGreaterThan(prev.roll);
      prev = L;
    }
    expect(flickLaunch(THROW.flickMax)).toEqual({ strength: 1, speed: THROW.launch[1], roll: THROW.flickRoll[1] });
    expect(flickLaunch(THROW.flickMax * 3)).toEqual(flickLaunch(THROW.flickMax));
  });

  it('a faster release launches faster, runs a longer path and lasts longer, for every seat and direction', () => {
    const ladder = [400, 1000, 1700, 2400, 3000];
    for (const [seat, angle] of Object.entries(SEATS)) {
      for (const d of SCREEN_DIRS) {
        const plans = ladder.map((v) => screenThrow(angle, { x: d.x * v, y: d.y * v }).plan);
        const name = `${seat} ${d.x},${d.y}`;
        for (let k = 1; k < plans.length; k++) {
          expect(plans[k]!.speed, `${name}: launch speed ${ladder[k]}`).toBeGreaterThan(plans[k - 1]!.speed);
          expect(plans[k]!.total, `${name}: duration ${ladder[k]}`).toBeGreaterThan(plans[k - 1]!.total);
          expect(plans[k]!.path, `${name}: path ${ladder[k]}`).toBeGreaterThan(plans[k - 1]!.path);
        }
        // Farther from home: the fastest flick gets well beyond the slowest one (the screen's short
        // side caps how far: from the middle of a 1000 px side about 4 dice).
        expect(throwTravel(plans[plans.length - 1]!), `${name}: travel`).toBeGreaterThan(throwTravel(plans[0]!) + SCREEN.ds * 0.8);
        // More wall hits (or as many) at the top of the range.
        const hits = (p: ThrowPlan): number => p.dice.reduce((s, x) => s + x.bounces, 0);
        expect(hits(plans[plans.length - 1]!), `${name}: bounces`).toBeGreaterThanOrEqual(hits(plans[0]!));
      }
    }
  });

  it('is clamped at the maximum: a release beyond flickMax throws exactly like flickMax', () => {
    const a = screenThrow(0, { x: THROW.flickMax, y: 0 }).plan;
    const b = screenThrow(0, { x: THROW.flickMax * 4, y: 0 }).plan;
    expect(b.speed).toBeCloseTo(a.speed, 9);
    expect(b.total).toBeCloseTo(a.total, 9);
    expect(sampleThrow(b, 0, 600)).toEqual(sampleThrow(a, 0, 600));
    // The hard maximum: about a die per 30 Hz frame.
    expect(a.speed / SCREEN.ds).toBeCloseTo(THROW.launch[1], 6);
  });

  it('durations: a tap ~1.06 s, a medium flick ~1.4 s, the strongest ~1.9 s (speed 1)', () => {
    expect(screenThrow(0, null).plan.total).toBeCloseTo(THROW.tossRoll + THROW.delay, 6);
    const medium = screenThrow(0, { x: 0, y: -1200 }).plan.total;
    expect(medium).toBeGreaterThan(1300);
    expect(medium).toBeLessThan(1500);
    const max = screenThrow(0, { x: 0, y: -3000 }).plan.total;
    expect(max).toBeGreaterThan(1850);
    expect(max).toBeLessThanOrEqual(1960);
  });
});

describe('screen walls (owner: bounce off the screen\'s edges)', () => {
  it('keeps every die on the screen, inside the margin, every frame, for every seat', () => {
    for (const [seat, angle] of Object.entries(SEATS)) {
      for (const d of SCREEN_DIRS) {
        for (const v of [600, 1800, 3000]) {
          const { f, plan } = screenThrow(angle, { x: d.x * v, y: d.y * v }, v);
          for (const p of onScreen(f, plan)) {
            const name = `${seat} ${d.x},${d.y} @${v}`;
            expect(p.x - p.r, name).toBeGreaterThanOrEqual(VIEWBOX.left - 0.5);
            expect(p.x + p.r, name).toBeLessThanOrEqual(VIEWBOX.right + 0.5);
            expect(p.y - p.r, name).toBeGreaterThanOrEqual(VIEWBOX.top - 0.5);
            expect(p.y + p.r, name).toBeLessThanOrEqual(VIEWBOX.bottom + 0.5);
          }
        }
      }
    }
  });

  it('a fast flick toward a screen edge reaches within 10 % of it; a slow one stays short', () => {
    for (const [seat, angle] of Object.entries(SEATS)) {
      for (const d of SCREEN_DIRS.slice(0, 4)) {
        const name = `${seat} toward ${d.x},${d.y}`;
        const fast = screenThrow(angle, { x: d.x * 3000, y: d.y * 3000 });
        const pts = onScreen(fast.f, fast.plan);
        // The die's edge nearest that screen edge, as a fraction of the screen.
        const reach =
          d.x > 0 ? Math.max(...pts.map((p) => p.x + p.r)) / SCREEN.w
          : d.x < 0 ? 1 - Math.min(...pts.map((p) => p.x - p.r)) / SCREEN.w
          : d.y > 0 ? Math.max(...pts.map((p) => p.y + p.r)) / SCREEN.h
          : 1 - Math.min(...pts.map((p) => p.y - p.r)) / SCREEN.h;
        expect(reach, name).toBeGreaterThan(0.9);
        expect(fast.plan.hits.length, `${name}: clacks`).toBeGreaterThanOrEqual(1);
        expect(fast.plan.hits.length, `${name}: clacks`).toBeLessThanOrEqual(THROW.maxClacks);
        const slow = screenThrow(angle, { x: d.x * 400, y: d.y * 400 });
        expect(throwTravel(slow.plan) / SCREEN.ds, `${name}: slow travel (dice)`).toBeLessThan(3.5);
        expect(slow.plan.dice.every((x) => x.bounces === 0), `${name}: slow, no wall`).toBe(true);
      }
    }
  });

  it('lands each die at home on the engine\'s faces after a screen-wide flick', () => {
    let k = 0;
    for (const angle of Object.values(SEATS)) {
      for (const d of SCREEN_DIRS) {
        const faces: [number, number] = [1 + (k % 6), 1 + ((k * 5 + 1) % 6)];
        k++;
        const { plan } = screenThrow(angle, { x: d.x * 2800, y: d.y * 2800 }, k, faces);
        for (const i of [0, 1] as const) {
          const s = sampleThrow(plan, i, plan.total);
          expect(mod(s.rx)).toBe(mod(FINAL[faces[i]]![0] - 18));
          expect(mod(s.ry)).toBe(mod(FINAL[faces[i]]![1] + 24));
          expect(s.x).toBeCloseTo(plan.dice[i]!.home.x, 6);
          expect(s.y).toBeCloseTo(plan.dice[i]!.home.y, 6);
        }
      }
    }
  });

  it('maps a screen-space flick to the right stage-space direction for every seat (and the fixed view)', () => {
    for (const [seat, angle] of Object.entries(SEATS)) {
      for (const d of SCREEN_DIRS) {
        // The stage-frame direction, drawn turned by the Stage, points the finger's way.
        const local = screenToStage(d, angle);
        const back = turn(local, angle);
        expect(back.x, seat).toBeCloseTo(d.x, 9);
        expect(back.y, seat).toBeCloseTo(d.y, 9);
        // And the dice go that way on the screen: their first frames move along the flick.
        const { f, plan } = screenThrow(angle, { x: d.x * 2000, y: d.y * 2000 });
        const i = plan.dice[0]!.delay === 0 ? 0 : 1;
        const a = toScreen(f, plan.dice[i]!.home);
        const s = sampleThrow(plan, i, 60);
        const b = toScreen(f, { x: s.x, y: s.y });
        const cos = ((b.x - a.x) * d.x + (b.y - a.y) * d.y) / Math.hypot(b.x - a.x, b.y - a.y);
        expect(cos, `${seat} ${d.x},${d.y}`).toBeGreaterThan(Math.cos((22 * Math.PI) / 180));
      }
    }
    // "Forward" for each seat is toward the board centre: N sits at the top, so its forward is down the screen.
    expect(screenToStage({ x: 0, y: 1 }, SEATS.N!).y).toBeCloseTo(-1, 9);
    expect(screenToStage({ x: -1, y: 0 }, SEATS.E!).y).toBeCloseTo(-1, 9);
    expect(screenToStage({ x: 1, y: 0 }, SEATS.W!).y).toBeCloseTo(-1, 9);
  });

  it('measures the frame from the two dice (turn, scale, offset) and round-trips', () => {
    for (const angle of Object.values(SEATS)) {
      const f = seatFrame(angle);
      expect(f.s).toBeCloseTo(SCREEN.scale, 9);
      expect(((f.a - angle) % 360 + 360) % 360).toBeCloseTo(0, 9);
      for (const p of [{ x: 0, y: 0 }, { x: 123, y: -45 }]) {
        const q = fromScreen(f, toScreen(f, p));
        expect(q.x).toBeCloseTo(p.x, 6);
        expect(q.y).toBeCloseTo(p.y, 6);
      }
      // The walls hold the homes, and every wall maps onto the screen inside the margin.
      const w = screenWalls(f, VIEWBOX, SCREEN.ds);
      for (const c of [{ x: w.left, y: w.top }, { x: w.right, y: w.bottom }]) {
        const s = toScreen(f, c);
        expect(s.x).toBeGreaterThan(VIEWBOX.left);
        expect(s.x).toBeLessThan(VIEWBOX.right);
        expect(s.y).toBeGreaterThan(VIEWBOX.top);
        expect(s.y).toBeLessThan(VIEWBOX.bottom);
      }
    }
  });
});

describe('tap toss (unchanged by the screen walls)', () => {
  it('a release without a swipe stays in the dice area: the same throw as before, ~1.06 s', () => {
    const L = LAYOUTS[0]!;
    const homes = homesOf(L.ds, L.gap);
    const poses: [Pose, Pose] = [pose(1, 3), pose(2, 6)];
    const screen = screenWalls(seatFrame(0), VIEWBOX, L.ds);
    for (const v of [null, { x: 100, y: -120 }]) {
      const a = planThrow({ box: L.box, homes, ds: L.ds, aim: flickAim(v), poses, rand: seeded(9) });
      const b = planThrow({ box: screen, tossBox: L.box, homes, ds: L.ds, aim: flickAim(v), poses, rand: seeded(9) });
      expect(b.kind).toBe('toss');
      expect(b.total).toBeCloseTo(THROW.tossRoll + THROW.delay, 6);
      expect(b.box).toEqual(a.box);
      for (let t = 0; t <= a.total; t += 50) expect(samplePair(b, t)).toEqual(samplePair(a, t));
    }
  });
});

describe('cpuFlick (CPU throws: medium strength, fixed per turn)', () => {
  it('is the same for the same turn, varies across turns, stays in the medium range', () => {
    expect(cpuFlick(42, 7)).toEqual(cpuFlick(42, 7));
    expect(cpuFlick(42, 7, 3)).not.toEqual(cpuFlick(42, 7));
    const speeds = new Set<number>();
    for (let turnNo = 0; turnNo < 40; turnNo++) {
      const c = cpuFlick(42, turnNo);
      expect(c.speed).toBeGreaterThanOrEqual(THROW.cpuFlick[0]);
      expect(c.speed).toBeLessThanOrEqual(THROW.cpuFlick[1]);
      expect(Math.abs(c.angle)).toBeLessThanOrEqual(12);
      speeds.add(Math.round(c.speed));
      // Never the maximum.
      expect(flickLaunch(c.speed).strength).toBeLessThan(0.75);
      expect(flickLaunch(c.speed).strength).toBeGreaterThan(0.2);
    }
    expect(speeds.size).toBeGreaterThan(30);
  });

  it('some CPU throws reach the screen\'s edges, some stay short (forward from every seat)', () => {
    for (const angle of Object.values(SEATS)) {
      let edge = 0;
      let short = 0;
      for (let turnNo = 0; turnNo < 24; turnNo++) {
        const c = cpuFlick(5, turnNo);
        const a = (c.angle * Math.PI) / 180;
        // The hand's stroke: "up" from the seat (stage frame), drawn turned by the Stage.
        const v = turn({ x: Math.sin(a) * c.speed, y: -Math.cos(a) * c.speed }, angle);
        const { plan } = screenThrow(angle, v, turnNo);
        if (plan.dice.some((d) => d.bounces > 0)) edge++;
        else short++;
      }
      expect(edge).toBeGreaterThan(0);
      expect(short + edge).toBe(24);
    }
  });
});

describe('strength = the aim arrow\'s length (strategy mode) and one-die throws', () => {
  it('launchOf is monotonic in the strength and clamped at both ends', () => {
    let prev = launchOf(0);
    expect(prev).toEqual({ strength: 0, speed: THROW.launch[0], roll: THROW.flickRoll[0] });
    for (let s = 0.05; s <= 1.0001; s += 0.05) {
      const L = launchOf(s);
      expect(L.speed).toBeGreaterThan(prev.speed);
      expect(L.roll).toBeGreaterThan(prev.roll);
      prev = L;
    }
    expect(launchOf(3)).toEqual(launchOf(1));
    expect(launchOf(-1)).toEqual(launchOf(0));
    expect(launchOf(Number.NaN)).toEqual(launchOf(0));
    // A casual flick is the same mapping through its release speed.
    expect(flickLaunch(THROW.flickMax)).toEqual(launchOf(1));
  });

  it('a stronger aim flies faster, farther and longer', () => {
    const L = LAYOUTS[0]!;
    const big = { left: -700, right: 900, top: -500, bottom: 500 };
    const weak = planThrow({ box: big, tossBox: L.box, homes: homesOf(L.ds, L.gap), ds: L.ds, aim: { x: 0, y: -1, strength: 0.1 }, poses: [pose(1, 2), pose(1, 5)], rand: seeded(4) });
    const strong = planThrow({ box: big, tossBox: L.box, homes: homesOf(L.ds, L.gap), ds: L.ds, aim: { x: 0, y: -1, strength: 0.9 }, poses: [pose(1, 2), pose(1, 5)], rand: seeded(4) });
    expect(strong.speed).toBeGreaterThan(weak.speed * 2);
    expect(strong.path).toBeGreaterThan(weak.path * 1.5);
    expect(strong.total).toBeGreaterThan(weak.total + 400);
  });

  it('throws ONE die (stride 1): one track, lands home on the engine\'s face, flick and toss', () => {
    for (const L of LAYOUTS) {
      const home = [{ x: L.ds / 2, y: L.ds / 2 }];
      for (const aim of [null, { x: 1, y: -1, strength: 0.6 }, { x: -1, y: 0.2, strength: 1 }]) {
        for (const face of [1, 2, 3, 4, 5, 6]) {
          const plan = planThrow({ box: L.box, homes: home, ds: L.ds, aim, poses: [pose(3, face)], rand: seeded(face) });
          expect(plan.dice).toHaveLength(1);
          expect(plan.kind).toBe(aim ? 'flick' : 'toss');
          for (let t = 0; t <= plan.total; t += 40) {
            const all = samplePair(plan, t);
            expect(all).toHaveLength(1);
            expect(all[0]!.x).toBeGreaterThanOrEqual(plan.box.left - 1e-6);
            expect(all[0]!.x).toBeLessThanOrEqual(plan.box.right + 1e-6);
          }
          const s = sampleThrow(plan, 0, plan.total);
          expect(mod(s.rx)).toBe(mod(FINAL[face]![0] - 18));
          expect(mod(s.ry)).toBe(mod(FINAL[face]![1] + 24));
          expect(s.x).toBeCloseTo(home[0]!.x, 6);
          expect(s.y).toBeCloseTo(home[0]!.y, 6);
        }
      }
    }
  });

  it('frameFromOne: one die\'s frame from its centre, the Stage\'s turn and the scale, round-trips', () => {
    for (const angle of [0, 90, 180, -90, 270, 450]) {
      const f = frameFromOne({ x: 50, y: 50 }, { x: 800, y: 500 }, angle, 0.92);
      const c = toScreen(f, { x: 50, y: 50 });
      expect(c.x).toBeCloseTo(800, 9);
      expect(c.y).toBeCloseTo(500, 9);
      const back = fromScreen(f, toScreen(f, { x: 130, y: -40 }));
      expect(back.x).toBeCloseTo(130, 9);
      expect(back.y).toBeCloseTo(-40, 9);
      expect(Math.abs(f.a)).toBeLessThanOrEqual(180);
    }
  });
});
