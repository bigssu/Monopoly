/**
 * A cut-in cut short (docs/MONEY-EVENTS.md §11.2, review round 1): a resize / rotation
 * (GameView.stopFx → MoneyStage.abort) or leaving the screen (destroy) in the middle of a scene must
 * still resolve its 'settle' and done, let the next queued scene play, leave no clock callback, and
 * not lose pooled nodes. Before the fix the scene clock dropped its steps unrun: pending tweens and
 * coins launched afterwards never resolved and the game waited forever.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activeFrameTicks, endSkip, flushAll, setAnimSpeed, setHeld, setManualClock, setPace, setReducedMotion, stepClock } from '../../time';
import { MoneyStage } from '../stage';
import { SCENES, type MoneyPlay } from '../scenes';
import { POOL_SIZE } from '../coins';
import { fakeParent } from './fakeDom';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
async function run(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    stepClock(1);
    await tick();
  }
}
const PARTY = (seat: 'S' | 'E' | 'N' | 'W', cash: number) => ({ seat, cash, color: '#4A6CF7' });

beforeEach(() => {
  setPace(2);
  setAnimSpeed(1);
  setReducedMotion(false);
  setManualClock(true);
});
afterEach(() => {
  endSkip();
  setHeld(false);
  flushAll();
  setManualClock(false);
  setAnimSpeed(1);
});

function track(p: MoneyPlay) {
  const s = { block: false, done: false };
  void p.block.then(() => (s.block = true));
  void p.done.then(() => (s.done = true));
  return s;
}

type Make = (st: MoneyStage) => MoneyPlay;
const SCENE_CASES: Array<[string, Make]> = [
  ['toll', (st) => SCENES.toll(st, { payer: PARTY('S', 3450), owner: PARTY('N', 5080), spaceIndex: 20, amount: 340 })],
  ['purchase', (st) => SCENES.purchase(st, { seat: 'S', cash: 3000, playerColor: '#E8564F', spaceIndex: 7, price: 200 })],
  ['takeover', (st) => SCENES.takeover(st, { buyer: PARTY('W', 3000), seller: PARTY('E', 1000), spaceIndex: 15, price: 640 })],
  ['collectFromAll', (st) => SCENES.collectFromAll(st, { payers: [{ ...PARTY('E', 900), amount: 300 }, { ...PARTY('N', 900), amount: 300 }], receiver: PARTY('S', 100) })],
  ['landmark', (st) => SCENES.build(st, { seat: 'E', cash: 3000, playerColor: '#E8564F', spaceIndex: 7, cost: 500, level: 4 })],
];

describe('a cut-in cut short (resize → abort, screen exit → destroy)', () => {
  for (const [name, make] of SCENE_CASES) {
    for (const at of [3, 12, 25, 40, 60, 90]) {
      it(`${name} aborted at frame ${at}: settle + done resolve, the next scene plays, nothing ticks`, async () => {
        const st = new MoneyStage({ parent: fakeParent(), tileRect: () => ({ x: 100, y: 100, w: 60, h: 80 }) });
        const a = track(make(st));
        await run(at);
        st.abort();
        await run(5);
        expect(a, 'cut-short scene released').toEqual({ block: true, done: true });
        expect(st.live).toBe(false);
        expect(st.fxAvailable).toBe(8);
        expect(st.coins.inUse).toBe(0);
        const b = track(SCENES.pay(st, { seat: 'S', cash: 3000, playerColor: '#E8564F', amount: 240, kind: 'tax' }));
        await run(400);
        expect(b, 'the next scene plays to its end').toEqual({ block: true, done: true });
        expect(st.sound.enabled, 'sound back on for the next scene').toBe(true);
        expect(st.wallets.S.el.dataset.v).toBe('2,760');
        expect(st.coins.peakNodes).toBeLessThanOrEqual(POOL_SIZE);
        expect(activeFrameTicks()).toBe(0);
      });
    }
  }

  it('the rest of a cut-short scene is silent', async () => {
    const st = new MoneyStage({ parent: fakeParent() });
    const played: string[] = [];
    const s = st.sound as unknown as { out: { play: (n: string) => void; haptic: () => void; now: () => number } };
    s.out = { play: (n) => played.push(n), haptic: () => undefined, now: () => performance.now() };
    const a = track(SCENES.purchase(st, { seat: 'S', cash: 3000, playerColor: '#E8564F', spaceIndex: 7, price: 200 }));
    await run(5);
    const before = played.length;
    st.abort();
    await run(5);
    expect(a.block).toBe(true);
    expect(played.length).toBe(before);
  });

  it('destroy mid-scene (save & quit): the awaiting sequencer is released and nothing ticks', async () => {
    const st = new MoneyStage({ parent: fakeParent() });
    const a = track(SCENES.collectFromAll(st, { payers: [{ ...PARTY('E', 900), amount: 300 }, { ...PARTY('N', 900), amount: 300 }], receiver: PARTY('S', 100) }));
    await run(30);
    st.destroy();
    await run(3);
    expect(a).toEqual({ block: true, done: true });
    expect(activeFrameTicks()).toBe(0);
  });

  it('an abort while kept up for a follow-up clears the kept flag', async () => {
    const st = new MoneyStage({ parent: fakeParent() });
    const a = track(SCENES.purchase(st, { seat: 'S', cash: 3450, playerColor: '#E8564F', spaceIndex: 7, price: 200, keep: true }));
    await run(400);
    expect(a.block).toBe(true);
    expect(st.kept).toBe(true);
    st.abort();
    expect(st.kept).toBe(false);
    expect(st.live).toBe(false);
  });
});
