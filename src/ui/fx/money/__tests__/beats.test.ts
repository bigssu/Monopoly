/**
 * Beats of every money cut-in (scenes.ts BEATS_F, docs/MONEY-EVENTS.md §12), on the manual clock at
 * the default game pace: on screen ≥ 3 s (also as a repeated event at 0.7×), anticipation before the
 * first coin leaves (≥ 0.5 s), a still hold ≥ 1 s between the result and the hand-back, a quick out.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushAll, setAnimSpeed, setManualClock, setPace, setReducedMotion, stepClock } from '../../time';
import { MoneyStage } from '../stage';
import { BEATS_F, CUES, MIN_SCENE_MS, SCENES, type MoneyPlay } from '../scenes';
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
  ['leader tax (via centre)', 'transfer', (st) => SCENES.transfer(st, { from: P('E', 3000), to: P('S', 1000), via: 'center', amount: 200 })],
  ['bankruptcy', 'bankruptcy', (st) => SCENES.bankruptcy(st, { debtor: P('S', 120), creditor: P('N', 3000), properties: [1, 2, 4] })],
];

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
      // On screen ≥ 3 s, at most 5.5 s.
      expect(s, `${name}: ${s.toFixed(2)} s`).toBeGreaterThanOrEqual(MIN_SCENE_MS / 1000 - 0.05);
      expect(s).toBeLessThanOrEqual(5.5);
      // Intro / anticipation ≥ 0.5 s before anything leaves (a waived toll: before the stamp).
      expect(r.at.depart!).toBeGreaterThanOrEqual(15);
      // Result → hand-back: the still hold ≥ 1 s; then a quick out (≤ 0.35 s).
      expect(r.at.settle! - r.at.result!).toBeGreaterThanOrEqual(BEATS_F.still);
      expect(r.at.done! - r.at.settle!).toBeLessThanOrEqual(11);
      // A repeated event of the same kind in a turn plays shorter, but never under the floor.
      const t = await run(fn, kind);
      // (The requirement is 3.0 s; MIN_SCENE_MS = 3.1 s leaves a margin.)
      expect(t.frames / 30, `${name} ×0.7: ${(t.frames / 30).toFixed(2)} s`).toBeGreaterThanOrEqual(3.0);
      expect(t.frames).toBeLessThanOrEqual(r.frames);
    });
  }

  it('the floor is in scene time: f(BEATS_F.still) ≥ 1 s, MIN_SCENE_MS ≥ 3 s', () => {
    expect(f(BEATS_F.still)).toBeGreaterThanOrEqual(1000);
    expect(f(BEATS_F.intro)).toBeGreaterThanOrEqual(500);
    expect(f(BEATS_F.result)).toBeGreaterThanOrEqual(500);
    expect(MIN_SCENE_MS).toBeGreaterThanOrEqual(3000);
  });
});
