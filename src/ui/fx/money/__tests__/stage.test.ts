import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activeFrameTicks, endSkip, flushAll, setAnimSpeed, setHeld, setManualClock, setPace, setReducedMotion, skip, stepClock } from '../../time';
import { MoneyClock, f } from '../clock';
import { CoinPool, POOL_SIZE, SHADOWS } from '../coins';
import { planDrain, planFlights, pileOf, flightsForAmount } from '../denom';
import { paintFrame, setMoneyAtlas, type MoneyAtlasJson } from '../atlas';
import { THROTTLE } from '@/ui/audio/synth';
import { CoinSound, COIN_SPACING, type SoundOut } from '../sound';
import { MoneyStage } from '../stage';
import { SCENES, CUES, type MoneyCue, type MoneyPlay } from '../scenes';
import { Wallet, type TweenHost } from '../wallet';
import { FakeDoc, fakeParent, type FakeEl } from './fakeDom';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Step the manual clock until `done` (or a frame cap), letting promise chains run between steps. */
async function runUntil(done: () => boolean, max = 400): Promise<number> {
  let n = 0;
  while (!done() && n < max) {
    stepClock(1);
    n++;
    await tick();
  }
  return n;
}

beforeEach(() => {
  // The app's default game pace (prefs: 2) = scene lengths as written.
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

describe('MoneyClock (time policy)', () => {
  it('advances one 30 Hz frame per step and stops itself when idle', async () => {
    const c = new MoneyClock();
    let hit = false;
    void c.until(f(3)).then(() => (hit = true));
    expect(activeFrameTicks()).toBe(1);
    stepClock(2);
    await tick();
    expect(hit).toBe(false);
    stepClock(1);
    await tick();
    expect(hit).toBe(true);
    expect(c.t).toBeCloseTo(f(3), 5);
    expect(activeFrameTicks()).toBe(0);
  });

  it('follows speed and skip (×5), and stands still while paused', async () => {
    const c = new MoneyClock();
    void c.until(f(100));
    stepClock(1);
    expect(c.t).toBeCloseTo(f(1), 5);
    setAnimSpeed(2);
    stepClock(1);
    expect(c.t).toBeCloseTo(f(3), 5);
    setAnimSpeed(1);
    skip();
    stepClock(1);
    expect(c.t).toBeCloseTo(f(8), 5);
    endSkip();
    setHeld(true);
    stepClock(5);
    expect(c.t).toBeCloseTo(f(8), 5);
    setHeld(false);
    await tick();
    stepClock(1);
    expect(c.t).toBeCloseTo(f(9), 5);
    c.dispose();
    expect(activeFrameTicks()).toBe(0);
  });

  it('paused: the frame step unregisters (zero cost) and comes back on resume', async () => {
    const c = new MoneyClock();
    let hit = false;
    void c.until(f(2)).then(() => (hit = true));
    expect(activeFrameTicks()).toBe(1);
    setHeld(true);
    stepClock(1);
    expect(activeFrameTicks()).toBe(0);
    stepClock(10);
    expect(c.t).toBe(0);
    setHeld(false);
    await tick();
    expect(activeFrameTicks()).toBe(1);
    stepClock(2);
    await tick();
    expect(hit).toBe(true);
    expect(activeFrameTicks()).toBe(0);
  });

  it('speed 0 mid-scene: everything waiting resolves on the next step, new waits resolve at once', async () => {
    const c = new MoneyClock();
    let hit = false;
    void c.until(f(500)).then(() => (hit = true));
    stepClock(1);
    setAnimSpeed(0);
    stepClock(1);
    await tick();
    expect(hit).toBe(true);
    let now = false;
    void c.until(c.t + f(100)).then(() => (now = true));
    await tick();
    expect(now).toBe(true);
    c.dispose();
  });

  it('a turbo factor of 0.7 shortens the scene', () => {
    const c = new MoneyClock();
    c.factor = 0.7;
    void c.until(f(100));
    stepClock(7);
    expect(c.t).toBeCloseTo(f(10), 5);
    c.dispose();
  });
});

describe('CoinPool', () => {
  it('never uses more than its 16 nodes, lands every flight once and goes idle', async () => {
    const layer = fakeParent();
    const clock = new MoneyClock();
    const pool = new CoinPool(layer, () => clock);
    expect((layer as unknown as FakeEl).children.length).toBe(POOL_SIZE + SHADOWS);
    let landed = 0;
    for (let i = 0; i < 40; i++) pool.launch({ from: { x: 0, y: 0 }, to: { x: 500, y: 300 }, metal: 'gold', size: 40, at: f(i * 0.5), onLand: () => landed++ });
    await runUntil(() => landed === 40);
    expect(landed).toBe(40);
    expect(pool.peakNodes).toBeLessThanOrEqual(POOL_SIZE);
    expect(pool.inUse).toBe(0);
    expect(pool.flying).toBe(0);
    await runUntil(() => clock.idle, 5);
    expect(clock.idle).toBe(true);
    clock.dispose();
  });

  it('hidden (reduced motion): no node is shown, landings stay on time', async () => {
    const clock = new MoneyClock();
    const pool = new CoinPool(fakeParent(), () => clock);
    pool.hidden = true;
    let at = -1;
    pool.launch({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, metal: 'silver', size: 40, at: 0, hopF: 5, travelF: 12, onLand: () => (at = clock.t) });
    await runUntil(() => at >= 0);
    expect(at).toBeCloseTo(f(17), 0);
    expect(pool.peakNodes).toBe(0);
    clock.dispose();
  });
});

/** Tween host that completes everything at once (pure sequence checks). */
const instantHost: TweenHost = {
  tween: (_ms, fn) => {
    fn(1);
    return Promise.resolve();
  },
  every: (fn) => {
    let t = 0;
    while (fn((t += 1000)));
  },
  now: () => 0,
  reduced: () => false,
};

describe('Wallet', () => {
  const make = (cash: number): Wallet => {
    const w = new Wallet(new FakeDoc() as unknown as Document);
    w.setup({ seat: 'S', color: '#E8564F', cash, anchor: { x: 800, y: 990 }, coin: 60 });
    return w;
  };

  it('drains coin by coin: breaks first, the number steps down per flight, the pile ends canonical', async () => {
    const w = make(3000);
    const flights = planFlights(planDrain(w.pile, 240), 'M');
    const labels: string[] = [];
    let breaks = 0;
    for (const fl of flights) {
      await w.breakBeat(instantHost, fl.breaks, () => breaks++);
      w.depart(fl);
      labels.push(w.el.dataset.v!);
    }
    expect(breaks).toBe(2);
    expect(labels.length).toBe(flights.length);
    expect(labels.at(-1)).toBe('2,760');
    // Monotone steps down.
    const nums = labels.map((s) => Number(s.replace(/,/g, '')));
    for (let i = 1; i < nums.length; i++) expect(nums[i]!).toBeLessThanOrEqual(nums[i - 1]!);
    expect(w.pile).toEqual(pileOf(2760));
  });

  it('fills with a bounce and counts up, then merges 10 → 1', async () => {
    const w = make(5080);
    const flights = flightsForAmount(340, 'M');
    for (const fl of flights) w.land(instantHost, fl);
    expect(w.el.dataset.v).toBe('5,420');
    expect(w.pile.bronze).toBe(12);
    const merges = await w.merge(instantHost);
    expect(merges).toBe(1);
    expect(w.pile).toEqual(pileOf(5420));
    expect(w.value()).toBe(5420);
  });

  it('stage points: a column top rises as coins stack', () => {
    const w = make(1000);
    const before = w.top('gold');
    w.land(instantHost, { metal: 'gold', coins: ['gold', 'gold'], value: 2000, rest: 0, breaks: [] });
    const after = w.top('gold');
    expect(after.y).toBeLessThan(before.y);
  });
});

describe('Wallet invariants (pile value = label = plan)', () => {
  const make = (cash: number): Wallet => {
    const w = new Wallet(new FakeDoc() as unknown as Document);
    w.setup({ seat: 'S', color: '#E8564F', cash, anchor: { x: 800, y: 990 }, coin: 60 });
    return w;
  };
  const label = (w: Wallet): number => Number(w.el.dataset.v!.replace(/,/g, ''));

  it('paying below one bronze moves the invisible rest too (100 − 5 = 95)', async () => {
    const w = make(100);
    const plan = planDrain(w.pile, 5);
    for (const fl of planFlights(plan, 'S')) {
      await w.breakBeat(instantHost, fl.breaks);
      w.depart(fl);
    }
    expect(w.value()).toBe(95);
    expect(label(w)).toBe(95);
    expect(w.pile).toEqual(plan.after);
  });

  it('any drain then fill keeps value(pile) === label === the planned pile', async () => {
    for (const [cash, pay, get] of [[100, 5, 15], [3450, 340, 1365], [1000, 1, 9], [77, 77, 3], [12345, 6789, 4321]] as const) {
      const w = make(cash);
      const plan = planDrain(w.pile, pay);
      for (const fl of planFlights(plan, 'M')) {
        await w.breakBeat(instantHost, fl.breaks);
        w.depart(fl);
        expect(w.value(), `${cash}-${pay}`).toBe(label(w));
      }
      expect(w.pile).toEqual(plan.after);
      for (const fl of flightsForAmount(get, 'L')) w.land(instantHost, fl);
      await w.merge(instantHost);
      expect(w.value()).toBe(cash - pay + get);
      expect(label(w)).toBe(cash - pay + get);
      expect(w.pile).toEqual(pileOf(cash - pay + get));
    }
  });
});

describe('CoinSound', () => {
  const fakeOut = () => {
    const log: Array<{ n: string; p?: number }> = [];
    let now = 0;
    const out: SoundOut & { log: typeof log; adv(ms: number): void } = {
      log,
      play: (n, o) => void log.push({ n, p: o?.pitch }),
      haptic: (k) => void log.push({ n: `h:${k}` }),
      now: () => now,
      adv: (ms) => void (now += ms),
    };
    return out;
  };

  it('spaces clinks ≥ 25 ms and caps the coin bus', () => {
    const o = fakeOut();
    const s = new CoinSound(o);
    expect(s.clink(1)).toBe(true);
    expect(s.clink(1)).toBe(false);
    o.adv(COIN_SPACING);
    expect(s.clink(1)).toBe(true);
    let played = 2;
    for (let i = 0; i < 20; i++) {
      o.adv(COIN_SPACING);
      if (s.clink(1)) played++;
    }
    expect(played).toBeGreaterThan(10);
    expect(o.log.filter((x) => x.n === 'coin-clink').length).toBe(played);
  });

  it('paying falls in pitch and starts with cash-out; receiving climbs and ends on one cha-ching', () => {
    const o = fakeOut();
    const s = new CoinSound(o);
    for (let i = 0; i < 6; i++) {
      s.depart(i, 6);
      o.adv(60);
    }
    expect(o.log[0]!.n).toBe('cash-out');
    const down = o.log.filter((x) => x.n === 'coin-clink').map((x) => x.p!);
    // Falling trend (±1 semitone jitter around 1.0 → 0.8).
    expect(down.at(-1)!).toBeLessThan(down[0]! * 1.06);
    expect(down.at(-1)!).toBeLessThan(0.82 * 1.06);
    o.log.length = 0;
    for (let i = 0; i < 6; i++) {
      s.land(i, 7, i === 5);
      o.adv(60);
    }
    const up = o.log.filter((x) => x.n === 'coin-clink').map((x) => x.p!);
    expect(up.at(-1)!).toBeGreaterThan(up[0]! * 1.2);
    expect(o.log.filter((x) => x.n === 'cash-in')).toHaveLength(1);
    expect(o.log.some((x) => x.n === 'h:light')).toBe(true);
  });

  it('the synth adds no second clink throttle (one gate: the coin scheduler)', () => {
    expect(THROTTLE['coin-clink'] ?? 0).toBe(0);
  });

  it('silent when disabled', () => {
    const o = fakeOut();
    const s = new CoinSound(o);
    s.enabled = false;
    s.depart(0, 3);
    s.land(0, 4, true);
    s.chaChing();
    expect(o.log).toEqual([]);
  });
});

const PARTY = (seat: 'S' | 'E' | 'N' | 'W', cash: number) => ({ seat, cash, color: '#4A6CF7' });

function allScenes(st: MoneyStage): MoneyPlay[] {
  return [
    SCENES.transfer(st, { from: PARTY('S', 3000), to: PARTY('N', 2000), amount: 340, via: 'center' }),
    SCENES.transfer(st, { from: 'bank', to: PARTY('E', 2000), amount: 500 }),
    SCENES.purchase(st, { seat: 'S', cash: 3000, playerColor: '#E8564F', spaceIndex: 7, price: 200 }),
    SCENES.build(st, { seat: 'E', cash: 3000, playerColor: '#E8564F', spaceIndex: 7, cost: 500, level: 4 }),
    SCENES.toll(st, { payer: PARTY('S', 3000), owner: PARTY('N', 1000), spaceIndex: 20, amount: 680, festival: true }),
    SCENES.takeover(st, { buyer: PARTY('W', 3000), seller: PARTY('E', 1000), spaceIndex: 15, price: 640 }),
    SCENES.collectFromAll(st, { payers: [{ ...PARTY('E', 900), amount: 300 }, { ...PARTY('N', 900), amount: 300 }, { ...PARTY('W', 900), amount: 300 }], receiver: PARTY('S', 100) }),
    SCENES.payAll(st, { payer: PARTY('S', 3000), receivers: [{ ...PARTY('E', 10), amount: 50 }, { ...PARTY('N', 10), amount: 50 }] }),
    SCENES.receive(st, { seat: 'N', cash: 10, playerColor: '#3DBB6E', amount: 300, kind: 'salary' }),
    SCENES.pay(st, { seat: 'W', cash: 760, playerColor: '#F2B633', amount: 240, kind: 'tax' }),
    SCENES.bankruptcy(st, { debtor: PARTY('W', 760), creditor: PARTY('S', 100), properties: [1, 2, 4] }),
  ];
}

describe('scenes', () => {
  it('headless (speed 0): every scene resolves at once, every cue fires, nothing goes live', async () => {
    setManualClock(false);
    setAnimSpeed(0);
    const st = new MoneyStage({ parent: fakeParent() });
    const plays = allScenes(st);
    const fired: MoneyCue[] = [];
    for (const p of plays) for (const c of CUES) void p.cue(c).then(() => fired.push(c));
    await Promise.all(plays.map((p) => p.block));
    await Promise.all(plays.map((p) => p.done));
    await tick();
    expect(fired.length).toBe(plays.length * CUES.length);
    expect(st.live).toBe(false);
    expect((st.root as unknown as FakeEl).classList.contains('is-live')).toBe(false);
    expect(st.stats.scenes).toBe(0);
    expect(activeFrameTicks()).toBe(0);
  });

  it('a toll plays its cues in order on the manual clock, moves the money and parks the stage', async () => {
    const st = new MoneyStage({ parent: fakeParent(), tileRect: () => ({ x: 100, y: 100, w: 60, h: 80 }) });
    const order: string[] = [];
    const play = SCENES.toll(st, { payer: PARTY('S', 3450), owner: PARTY('N', 5080), spaceIndex: 20, amount: 340 });
    for (const c of CUES) void play.cue(c).then(() => order.push(c));
    let blocked = -1;
    void play.block.then(() => (blocked = st.clock?.t ?? -1));
    let done = false;
    void play.done.then(() => (done = true));
    const frames = await runUntil(() => done);
    expect(done).toBe(true);
    expect(order).toEqual([...CUES]);
    // Block (settle) near the M-tier length; the whole cut-in under 3.2 s.
    expect(blocked).toBeGreaterThan(f(36));
    expect(frames).toBeLessThan(96);
    expect(st.wallets.S.el.dataset.v).toBe('3,110');
    expect(st.wallets.N.el.dataset.v).toBe('5,420');
    expect(st.wallets.N.pile).toEqual(pileOf(5420));
    expect(st.stats.peakNodes).toBeLessThanOrEqual(POOL_SIZE);
    expect(st.live).toBe(false);
    expect(activeFrameTicks()).toBe(0);
  });

  it('collect-from-all (3 payers, XL) keeps ≤ 12 coins in flight per transfer and ≤ 16 nodes', async () => {
    const st = new MoneyStage({ parent: fakeParent() });
    const play = SCENES.collectFromAll(st, {
      tier: 'XL',
      payers: [{ ...PARTY('E', 2120), amount: 450 }, { ...PARTY('N', 5080), amount: 450 }, { ...PARTY('W', 760), amount: 450 }],
      receiver: PARTY('S', 3450),
    });
    let done = false;
    void play.done.then(() => (done = true));
    let maxFlying = 0;
    for (let i = 0; i < 300 && !done; i++) {
      stepClock(1);
      maxFlying = Math.max(maxFlying, st.coins.flying);
      await tick();
    }
    expect(done).toBe(true);
    expect(maxFlying).toBeLessThanOrEqual(15);
    expect(st.coins.peakNodes).toBeLessThanOrEqual(POOL_SIZE);
    expect(st.wallets.S.el.dataset.v).toBe('4,800');
    expect(st.wallets.W.el.dataset.v).toBe('310');
  });

  it('a kind repeated in the same turn plays at 0.7×', async () => {
    const st = new MoneyStage({ parent: fakeParent() });
    const len = async (): Promise<number> => {
      const p = SCENES.pay(st, { seat: 'S', cash: 3000, playerColor: '#E8564F', amount: 240, kind: 'tax' });
      let done = false;
      void p.done.then(() => (done = true));
      return runUntil(() => done);
    };
    const a = await len();
    const b = await len();
    st.newTurn();
    const c = await len();
    expect(b).toBeLessThan(a * 0.8);
    expect(Math.abs(c - a)).toBeLessThanOrEqual(a * 0.1);
  });

  it('a kept scene hands over to its follow-up (one cut-in) and both finish', async () => {
    const st = new MoneyStage({ parent: fakeParent() });
    const a = SCENES.purchase(st, { seat: 'S', cash: 3450, playerColor: '#E8564F', spaceIndex: 7, price: 200, keep: true });
    const b = SCENES.build(st, { seat: 'S', cash: 3250, playerColor: '#E8564F', spaceIndex: 7, cost: 100, level: 1 });
    let done = 0;
    void a.done.then(() => done++);
    void b.done.then(() => done++);
    await runUntil(() => done === 2, 300);
    expect(done).toBe(2);
    expect(st.wallets.S.el.dataset.v).toBe('3,150');
    expect(st.live).toBe(false);
    expect(activeFrameTicks()).toBe(0);
  });

  it('switching to speed 0 in the middle of a scene finishes it at once', async () => {
    const st = new MoneyStage({ parent: fakeParent() });
    const p = SCENES.toll(st, { payer: PARTY('S', 3450), owner: PARTY('N', 5080), spaceIndex: 20, amount: 340 });
    let done = false;
    void p.done.then(() => (done = true));
    await runUntil(() => false, 12);
    setAnimSpeed(0);
    const n = await runUntil(() => done, 30);
    expect(done).toBe(true);
    expect(n).toBeLessThan(30);
    expect(st.wallets.N.el.dataset.v).toBe('5,420');
  });

  it('reduced motion: one-shot sprites never leak pool nodes', async () => {
    setReducedMotion(true);
    const st = new MoneyStage({ parent: fakeParent() });
    st.open('M', 0.8);
    for (let i = 0; i < 20; i++) {
      void st.fx('coin_burst', { x: 0, y: 0 });
      void st.swing('hammer', { x: 0, y: 0 }, 0);
    }
    expect(st.fxAvailable).toBe(8);
    st.park();
  });

  it('idle stage: parked, a fixed small node count, no frame steps', () => {
    const st = new MoneyStage({ parent: fakeParent() });
    const nodes = (st.root as unknown as FakeEl).all().length;
    expect(nodes).toBeLessThan(90);
    expect((st.root as unknown as FakeEl).classList.contains('is-live')).toBe(false);
    expect(activeFrameTicks()).toBe(0);
  });
});

describe('money atlas in the DOM', () => {
  it('a pooled node switching from a tinted (mask) frame to a plain one drops the mask', () => {
    const j: MoneyAtlasJson = {
      v: 1,
      dpr: 2,
      atlas: { file: 'money.webp', w: 1024, h: 512, bytes: 1 },
      tiles: {},
      anims: {
        dust_puff: { n: 1, frames: ['dust_puff/0'], fps: 20, loop: false, w: 96, h: 96, k: 0.34, scale: 0.68, fixedBox: false },
        coin_burst: { n: 1, frames: ['coin_burst/0'], fps: 20, loop: false, w: 64, h: 64, k: 0.5, scale: 1, fixedBox: false },
      },
      frames: {
        'dust_puff/0': { x: 0, y: 0, w: 40, h: 40, ox: 4, oy: 4, sw: 66, sh: 66 },
        'coin_burst/0': { x: 50, y: 0, w: 30, h: 30, ox: 2, oy: 2, sw: 64, sh: 64 },
      },
    };
    setMoneyAtlas(j);
    const el = new FakeDoc().createElement('i') as unknown as HTMLElement;
    paintFrame(el, 'dust_puff', 0, 1, '#E9D3B0');
    expect(el.style.maskImage).toContain('money.webp');
    expect(el.style.backgroundColor).toBe('#E9D3B0');
    paintFrame(el, 'coin_burst', 0, 1);
    expect(el.style.maskImage).toBe('');
    expect(el.style.webkitMaskImage).toBe('');
    expect(el.style.backgroundColor).toBe('');
    expect(el.style.backgroundImage).toContain('money.webp');
    setMoneyAtlas(null);
  });
});
