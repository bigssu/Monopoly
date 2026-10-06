/**
 * Beats of every money cut-in (scenes.ts BEATS_F, docs/MONEY-EVENTS.md §12), on the manual clock at
 * the default game pace: on screen ≥ 3 s (also as a repeated event at 0.7×), anticipation before the
 * first coin leaves (≥ 0.5 s), a still hold ≥ 1 s between the result and the hand-back, a quick out.
 *
 * EVENT_EXTEND (fx/time.ts, 2026-10-06): every cut-in is on screen motionMs + holdMs longer than
 * before it (BASE below), its still hold holdMs longer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EVENT_EXTEND, flushAll, setAnimSpeed, setManualClock, setPace, setReducedMotion, stepClock } from '../../time';
import { MoneyStage } from '../stage';
import { BEATS_F, CUES, MIN_SCENE_MS, MOTION_STRETCH, SCENES, type MoneyPlay } from '../scenes';
import { f } from '../clock';
import { fakeParent } from './fakeDom';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const P = (seat: 'S' | 'E' | 'N' | 'W', cash: number) => ({ seat, cash, color: '#4A6CF7' });

const SCENARIOS: Array<[string, string, (st: MoneyStage) => MoneyPlay]> = [
  ['purchase', 'purchase', (st) => SCENES.purchase(st, { seat: 'S', cash: 3000, playerColor: '#f00', spaceIndex: 4, price: 160 })],
  ['build L1', 'build', (st) => SCENES.build(st, { seat: 'S', cash: 3000, playerColor: '#f00', spaceIndex: 4, cost: 80, level: 1 })],
  ['build L4', 'landmark', (st) => SCENES.build(st, { seat: 'S', cash: 3000, playerColor: '#f00', spaceIndex: 4, cost: 500, level: 4 })],
  ['free upgrade', 'build', (st) => SCENES.build(st, { seat: 'S', cash: 3000, playerColor: '#f00', spaceIndex: 4, cost: 0, level: 2, free: true })],
  ['toll S', 'toll', (st) => SCENES.toll(st, { payer: P('S', 3000), owner: P('N', 3000), spaceIndex: 4, amount: 60 })],
  ['toll M', 'toll', (st) => SCENES.toll(st, { payer: P('S', 3000), owner: P('N', 3000), spaceIndex: 4, amount: 340 })],
  ['festival toll', 'toll', (st) => SCENES.toll(st, { payer: P('S', 3000), owner: P('N', 3000), spaceIndex: 4, amount: 1360, festival: true })],
  ['waived toll', 'tollWaived', (st) => SCENES.tollWaived(st, { payer: P('S', 3000), owner: P('N', 3000), spaceIndex: 4 })],
  ['takeover', 'takeover', (st) => SCENES.takeover(st, { buyer: P('S', 3000), seller: P('E', 3000), spaceIndex: 4, price: 680 })],
  ['collect', 'collect', (st) => SCENES.collectFromAll(st, { payers: [{ ...P('E', 2000), amount: 100 }, { ...P('N', 2000), amount: 100 }, { ...P('W', 2000), amount: 100 }], receiver: P('S', 3000) })],
  ['pay all', 'payAll', (st) => SCENES.payAll(st, { payer: P('S', 3000), receivers: [{ ...P('E', 2000), amount: 50 }, { ...P('N', 2000), amount: 50 }, { ...P('W', 2000), amount: 50 }] })],
  ['salary', 'salary', (st) => SCENES.receive(st, { seat: 'S', cash: 3000, playerColor: '#f00', amount: 300, kind: 'salary' })],
  ['tax', 'tax', (st) => SCENES.pay(st, { seat: 'S', cash: 3000, playerColor: '#f00', amount: 300, kind: 'tax' })],
  ['bail', 'bail', (st) => SCENES.pay(st, { seat: 'S', cash: 3000, playerColor: '#f00', amount: 100, kind: 'bail' })],
  ['sale (bank → me)', 'transfer', (st) => SCENES.transfer(st, { from: 'bank', to: P('S', 100), amount: 60 })],
  ['sell a building (crying dealer)', 'sell', (st) => SCENES.sell(st, { seat: 'S', cash: 100, playerColor: '#f00', items: [{ spaceIndex: 4, building: 2, amount: 60 }] })],
  ['sell land + a hotel', 'sell', (st) => SCENES.sell(st, { seat: 'N', cash: 40, playerColor: '#f00', items: [{ spaceIndex: 4, building: 3, amount: 150 }, { spaceIndex: 6, building: null, amount: 120 }] })],
  ['leader tax (via centre)', 'transfer', (st) => SCENES.transfer(st, { from: P('E', 3000), to: P('S', 1000), via: 'center', amount: 200 })],
  ['bankruptcy', 'bankruptcy', (st) => SCENES.bankruptcy(st, { debtor: P('S', 120), creditor: P('N', 3000), properties: [1, 2, 4] })],
];

/**
 * Frames on screen before EVENT_EXTEND (main 18aa79c, the shipped timing): [normal, repeated 0.7×].
 * If a scene's own beats change, update its base here.
 */
const BASE: Record<string, [number, number]> = {
  purchase: [134, 96], 'build L1': [124, 95], 'build L4': [129, 95], 'free upgrade': [101, 95],
  'toll S': [146, 107], 'toll M': [146, 107], 'festival toll': [161, 118], 'waived toll': [95, 95],
  takeover: [149, 107], collect: [148, 107], 'pay all': [154, 110], salary: [124, 95], tax: [122, 95],
  bail: [122, 95], 'sale (bank → me)': [116, 95], 'leader tax (via centre)': [137, 100], bankruptcy: [110, 95],
};
/** Frames EVENT_EXTEND adds to a cut-in (motion + hold). */
const EXT_F = (EVENT_EXTEND.motionMs + EVENT_EXTEND.holdMs) / f(1);
/**
 * Tolerance (frames): the stretched beats end on the nearest 30 Hz frame, not on exact multiples of
 * the old ones, so a cut-in of 6–12 chained beats lands within ±2 frames of base + extension; one
 * much longer than MOTION_REF_F (the festival toll) moves up to 3 frames more (scenes.ts trueUp).
 */
const SLACK_F = 3;

async function run(fn: (st: MoneyStage) => MoneyPlay, turboKind: string | null): Promise<{ frames: number; at: Record<string, number> }> {
  const st = new MoneyStage({ parent: fakeParent(), tileRect: () => ({ x: 100, y: 100, w: 60, h: 80 }) });
  if (turboKind) st.turbo(turboKind);
  const play = fn(st);
  const at: Record<string, number> = {};
  let n = 0;
  for (const c of CUES) void play.cue(c).then(() => (at[c] = n));
  let done = false;
  void play.done.then(() => (done = true));
  while (!done && n < 600) {
    stepClock(1);
    n++;
    await tick();
  }
  return { frames: n, at };
}

beforeEach(() => {
  setPace(2);
  setAnimSpeed(1);
  setReducedMotion(false);
  setManualClock(true);
});
afterEach(() => {
  flushAll();
  setManualClock(false);
});

describe('money cut-in beats (≥ 3 s, anticipation, still hold)', () => {
  for (const [name, kind, fn] of SCENARIOS) {
    it(name, async () => {
      const r = await run(fn, null);
      const s = r.frames / 30;
      // On screen ≥ MIN_SCENE_MS (4.1 s), at most 6.5 s.
      expect(s, `${name}: ${s.toFixed(2)} s`).toBeGreaterThanOrEqual(MIN_SCENE_MS / 1000 - 0.05);
      expect(s).toBeLessThanOrEqual(6.5);
      // EVENT_EXTEND: exactly motionMs + holdMs longer than before (± the frame rounding).
      const [base, baseTurbo] = BASE[name]!;
      expect(Math.abs(r.frames - (base + EXT_F)), `${name}: ${r.frames} frames, base ${base} + ${EXT_F}`).toBeLessThanOrEqual(SLACK_F);
      // Intro / anticipation ≥ 0.5 s before anything leaves (a waived toll: before the stamp).
      expect(r.at.depart!).toBeGreaterThanOrEqual(15);
      // Result → hand-back: the still hold = 1 s + holdMs (more only to reach the floor); then the
      // out (0.3 s, stretched: ≤ 0.6 s).
      const still = r.at.settle! - r.at.result!;
      expect(still).toBeGreaterThanOrEqual(BEATS_F.still + EVENT_EXTEND.holdMs / f(1));
      if (base > MIN_SCENE_MS / f(1) - EXT_F + 3) expect(still, `${name}: still`).toBeLessThanOrEqual(BEATS_F.still + EVENT_EXTEND.holdMs / f(1) + 1);
      expect(r.at.done! - r.at.settle!).toBeLessThanOrEqual(2 * BEATS_F.out + 2);
      // A repeated event of the same kind in a turn plays shorter, but never under the floor.
      const t = await run(fn, kind);
      expect(t.frames / 30, `${name} ×0.7: ${(t.frames / 30).toFixed(2)} s`).toBeGreaterThanOrEqual(MIN_SCENE_MS / 1000 - 0.05);
      expect(Math.abs(t.frames - Math.max(baseTurbo + EXT_F, MIN_SCENE_MS / f(1))), `${name} ×0.7: ${t.frames} frames, base ${baseTurbo}`).toBeLessThanOrEqual(SLACK_F + 1);
      expect(t.frames).toBeLessThanOrEqual(r.frames);
    });
  }

  it('the floor is in scene time: f(BEATS_F.still) ≥ 1 s, MIN_SCENE_MS ≥ 3 s', () => {
    expect(f(BEATS_F.still)).toBeGreaterThanOrEqual(1000);
    expect(f(BEATS_F.intro)).toBeGreaterThanOrEqual(500);
    expect(f(BEATS_F.result)).toBeGreaterThanOrEqual(500);
    expect(MIN_SCENE_MS).toBeGreaterThanOrEqual(3000);
  });

  it('EVENT_EXTEND: +0.5 s of motion, +0.5 s of still; the floor grows by both', () => {
    expect(EVENT_EXTEND).toEqual({ motionMs: 500, holdMs: 500 });
    expect(MIN_SCENE_MS).toBe(3100 + 1000);
    // The reference cut-in's motion (MOTION_REF_F) stretches by exactly motionMs.
    expect(MOTION_STRETCH).toBeCloseTo(1.15, 5);
  });

  it('the motion is stretched, not paused: coins leave and land later in proportion', async () => {
    const r = await run(SCENARIOS[0]![2], null);
    // Purchase before EVENT_EXTEND: first coin at frame 25, last landed (arrive) at 70. Both later
    // by the stretch (the intro and the coins run 1.15× slower), not by a fixed delay.
    expect(r.at.depart!).toBeGreaterThanOrEqual(Math.floor(25 * MOTION_STRETCH) - 2);
    expect(r.at.arrive! - r.at.depart!).toBeGreaterThanOrEqual(Math.floor((70 - 25) * MOTION_STRETCH) - 2);
  });

  it('the game pace scales the extension with the cut-in (√(pace / 2))', async () => {
    setPace(1);
    const slow = await run(SCENARIOS[0]![2], null);
    // At pace 1 the whole cut-in, extension included, runs √½ as long.
    expect(Math.abs(slow.frames - (BASE.purchase![0] + EXT_F) * Math.SQRT1_2)).toBeLessThanOrEqual(SLACK_F + 1);
  });
});
