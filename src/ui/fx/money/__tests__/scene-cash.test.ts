/**
 * Wallet labels = engine cash (review round 1): run every money scene of seeded CPU games through the real stage on the
 * manual clock and compare each visible wallet label at 'settle' with the engine cash after the group.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chooseAction, createGame, deepClone, defaultPlayers, defaultSettings, festivalMultiplier, getBoardInfo, reduce, type GameState, type PlayerId, type Settings } from '@/engine';
import { endSkip, flushAll, setAnimSpeed, setHeld, setManualClock, setPace, setReducedMotion, skip, stepClock } from '../../time';
import { applyMoneyState, planMoney, type MoneyScene } from '../../moneymap';
import { MoneyStage } from '../stage';
import * as M from '../scenes';
import { fakeParent } from './fakeDom';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
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
});

const COLORS = ['#E8564F', '#4A6CF7', '#3DBB6E', '#F2B633'];

function start(st: MoneyStage, vs: GameState, sc: MoneyScene, keep: boolean): M.MoneyPlay {
  const party = (pid: PlayerId): M.Party => ({ seat: vs.players[pid]!.seat, cash: vs.players[pid]!.cash, color: COLORS[pid]! });
  const me = (pid: PlayerId) => ({ seat: vs.players[pid]!.seat, cash: vs.players[pid]!.cash, playerColor: COLORS[pid]! });
  switch (sc.kind) {
    case 'purchase':
      return M.purchase(st, { ...me(sc.player), spaceIndex: sc.spaceIndex, price: sc.price, auction: sc.via === 'auction', keep });
    case 'build':
      return M.build(st, { ...me(sc.player), spaceIndex: sc.spaceIndex, cost: sc.cost, level: Math.max(1, Math.min(4, sc.level)) as 1 | 2 | 3 | 4, free: sc.free, keep });
    case 'toll':
      return M.toll(st, { payer: party(sc.payer), owner: party(sc.owner), spaceIndex: sc.spaceIndex, amount: sc.amount, festival: sc.festival, stamp: `×${(sc.festival ? festivalMultiplier(vs) : 1) * sc.multiplier}`, keep });
    case 'tollWaived':
      return M.tollWaived(st, { payer: party(sc.payer), owner: party(sc.owner), spaceIndex: sc.spaceIndex, keep });
    case 'takeover':
      return M.takeover(st, { buyer: party(sc.buyer), seller: party(sc.seller), spaceIndex: sc.spaceIndex, price: sc.price, keep });
    case 'collectFromAll':
      return M.collectFromAll(st, { receiver: party(sc.receiver), payers: sc.payers.map((p) => ({ ...party(p.id), amount: p.amount })), keep });
    case 'payAll':
      return M.payAll(st, { payer: party(sc.payer), receivers: sc.receivers.map((p) => ({ ...party(p.id), amount: p.amount })), keep });
    case 'transfer':
      return M.transfer(st, { from: party(sc.from), to: party(sc.to), via: 'center', amount: sc.amount, keep });
    case 'receive':
      return M.receive(st, { ...me(sc.player), amount: sc.amount, kind: sc.source === 'pot' ? 'pot' : sc.source === 'salary' ? 'salary' : 'bonus', keep });
    case 'pay':
      return M.pay(st, { ...me(sc.player), amount: sc.amount, kind: sc.sink === 'doubleUp' ? 'fine' : sc.sink, keep });
    case 'sale':
      return M.transfer(st, { from: 'bank', to: party(sc.player), amount: sc.amount, keep });
    case 'bankruptcy':
      return M.bankruptcy(st, { debtor: party(sc.debtor), creditor: sc.creditor === null ? null : party(sc.creditor), properties: sc.properties, receivers: sc.receivers.map((r) => ({ ...party(r.id), amount: r.amount })), keep });
  }
}

describe('wallet labels = engine cash at settle, every scene of seeded games', () => {
  const settingsFor = (n: number, rules: Settings['rules'], auction: boolean): Settings =>
    defaultSettings({ players: defaultPlayers(n, { cpu: true }), rules, auction, roundLimit: 12 });
  for (const [seed, n, rules, auction] of [
    [1, 4, 'normal', false], [2, 3, 'advanced', true], [4, 4, 'advanced', false], [5, 4, 'normal', true],
  ] as const) {
    it(`seed ${seed}, ${n} players, ${rules}, auction ${auction}`, async () => {
      const mism: string[] = [];
      const seen = new Map<string, number>();
      let s: GameState = createGame(settingsFor(n, rules, auction), seed * 7919);
      const st = new MoneyStage({ parent: fakeParent(), tileRect: () => ({ x: 100, y: 100, w: 60, h: 80 }), space: (i) => ({ icon: 'space-event', name: String(getBoardInfo(7).board[i]?.short ?? i) }) });
      for (let stepN = 0; stepN < 700 && s.phase.kind !== 'gameOver'; stepN++) {
        const prev = s;
        const r = reduce(s, chooseAction(s, s.phase.playerId));
        s = r.state;
        const groups = planMoney(r.events);
        if (!groups.length) continue;
        const starts = new Map(groups.map((g) => [g.start, g]));
        const grouped = new Set(groups.flatMap((g) => g.events));
        const vs = deepClone(prev);
        st.newTurn();
        for (let i = 0; i < r.events.length; i++) {
          const g = starts.get(i);
          if (g) {
            seen.set(g.scene.kind, (seen.get(g.scene.kind) ?? 0) + 1);
            const play = start(st, vs, g.scene, g.keep);
            let blocked = false;
            void play.block.then(() => (blocked = true));
            skip();
            for (let k = 0; k < 600 && !blocked; k++) {
              stepClock(1);
              await tick();
            }
            if (!blocked) {
              mism.push(`step ${stepN} ${g.scene.kind}: never settled`);
              break;
            }
            for (const k of g.events) applyMoneyState(vs, r.events[k]!);
            for (const seat of ['S', 'E', 'N', 'W'] as const) {
              const w = st.wallets[seat];
              if (!w.visible) continue;
              const p = vs.players.find((q) => q.seat === seat)!;
              const label = Number((w.el.dataset.v ?? '').replace(/\D/g, ''));
              if (label !== p.cash) mism.push(`step ${stepN} ${g.scene.kind}${g.keep ? '(keep)' : ''} seat ${seat}: wallet ${label} vs engine ${p.cash} [${g.events.map((k) => r.events[k]!.type).join(',')}]`);
              if (w.value() !== p.cash) mism.push(`step ${stepN} ${g.scene.kind} seat ${seat}: pile ${w.value()} vs engine ${p.cash}`);
            }
            continue;
          }
          if (grouped.has(i)) continue;
          applyMoneyState(vs, r.events[i]!);
        }
        // Let the last scene go down before the next batch.
        if (st.kept) void st.releaseKept();
        for (let k = 0; k < 200 && st.live; k++) {
          stepClock(1);
          await tick();
        }
        endSkip();
      }
      if (process.env.MONEY_VERBOSE) console.log(`[wallets] seed ${seed}:`, JSON.stringify(Object.fromEntries(seen)), `mismatches ${mism.length}`);
      expect(mism.slice(0, 20)).toEqual([]);
    }, 600_000);
  }
});

async function playBatch(st: MoneyStage, prev: GameState, events: readonly import('@/engine').GameEvent[], mism: string[], tag: string): Promise<string[]> {
  const groups = planMoney(events);
  const starts = new Map(groups.map((g) => [g.start, g]));
  const grouped = new Set(groups.flatMap((g) => g.events));
  const vs = deepClone(prev);
  const kinds: string[] = [];
  for (let i = 0; i < events.length; i++) {
    const g = starts.get(i);
    if (g) {
      const k0 = kinds.length;
      kinds.push(g.scene.kind + (g.keep ? '+keep' : ''));
      const play = start(st, vs, g.scene, g.keep);
      let blocked = false;
      void play.block.then(() => (blocked = true));
      for (let k = 0; k < 800 && !blocked; k++) {
        stepClock(1);
        await tick();
      }
      if (!blocked) mism.push(`${tag} ${g.scene.kind}: never settled`);
      for (const k of g.events) applyMoneyState(vs, events[k]!);
      for (const seat of ['S', 'E', 'N', 'W'] as const) {
        const w = st.wallets[seat];
        if (!w.visible) continue;
        const p = vs.players.find((q) => q.seat === seat)!;
        const label = Number((w.el.dataset.v ?? '').replace(/\D/g, ''));
        if (label !== p.cash) mism.push(`${tag} ${g.scene.kind} seat ${seat}: wallet ${label} vs engine ${p.cash}`);
      }
      kinds[k0] += `[${(['S', 'E', 'N', 'W'] as const).filter((q) => st.wallets[q].visible).join('')}]`;
      continue;
    }
    if (!grouped.has(i)) applyMoneyState(vs, events[i]!);
  }
  if (st.kept) void st.releaseKept();
  for (let k = 0; k < 300 && st.live; k++) {
    stepClock(1);
    await tick();
  }
  return kinds;
}

function crafted(n: number, patch: (s: GameState, me: number) => void): GameState {
  const s = createGame(defaultSettings({ players: defaultPlayers(n, { cpu: true }), rules: 'easy' }), 7);
  const me = s.players.findIndex((p) => p.seat === 'S');
  s.current = me;
  s.phase = { kind: 'preRoll', playerId: me, rollAgain: false } as GameState['phase'];
  s.players[me]!.position = 0;
  patch(s, me);
  return s;
}

describe('wallet labels = engine cash: crafted card / debt / bankruptcy batches', () => {
  const cases: Array<[string, number, (s: GameState, me: number) => void]> = [
    ['birthday, one payer short, one broke', 4, (s, me) => {
      s.testHooks = { diceQueue: [[1, 2]], cardQueue: ['birthday'] };
      s.players[(me + 1) % 4]!.cash = 30;
      s.players[(me + 2) % 4]!.cash = 0;
    }],
    ['charity (payAll)', 4, (s) => { s.testHooks = { diceQueue: [[1, 2]], cardQueue: ['charity'] }; }],
    ['charity, 2 players (transfer)', 2, (s) => { s.testHooks = { diceQueue: [[1, 2]], cardQueue: ['charity'] }; }],
    ['charity, payer bankrupt (no creditor, split to payees)', 4, (s, me) => {
      s.testHooks = { diceQueue: [[1, 2]], cardQueue: ['charity'] };
      s.players[me]!.cash = 70;
      s.settings.endOnFirstBankruptcy = false;
    }],
    ['charity, payer must sell (debt) then pays', 4, (s, me) => {
      s.testHooks = { diceQueue: [[1, 2]], cardQueue: ['charity'] };
      s.players[me]!.cash = 70;
      s.properties[1] = { owner: me, level: 2 } as never;
      s.properties[2] = { owner: me, level: 0 } as never;
    }],
    ['toll bankrupt to creditor', 4, (s, me) => {
      s.testHooks = { diceQueue: [[2, 2]] };
      s.players[me]!.cash = 5;
      s.properties[4] = { owner: (me + 1) % 4, level: 3 } as never;
      s.settings.endOnFirstBankruptcy = false;
    }],
  ];
  for (const [name, n, patch] of cases) {
    it(name, async () => {
      const mism: string[] = [];
      const st = new MoneyStage({ parent: fakeParent(), tileRect: () => ({ x: 100, y: 100, w: 60, h: 80 }) });
      let s = crafted(n, patch);
      const all: string[] = [];
      for (let k = 0; k < 8 && s.phase.kind !== 'gameOver'; k++) {
        const ph = s.phase as { playerId: number; kind: string };
        if (k > 0 && ph.kind === 'preRoll') break;
        const a = chooseAction(s, ph.playerId);
        const r = reduce(s, a);
        all.push(`${a.type}: ${r.events.map((e) => e.type === 'MoneyChanged' ? `MC(${e.reason} p${e.playerId} ${e.delta})` : e.type).join(' ')}`);
        all.push('  scenes: ' + (await playBatch(st, s, r.events, mism, name)).join(', '));
        s = r.state;
      }
      if (process.env.MONEY_VERBOSE) console.log(`[crafted] ${name}\n` + all.join('\n'));
      expect(mism).toEqual([]);
      // A bankruptcy owed to several players shows their wallets receiving the shares.
      if (name.includes('payer bankrupt')) expect(all.find((l) => l.startsWith('  scenes') && l.includes('bankruptcy'))).toContain('bankruptcy[SENW]');
    }, 120_000);
  }
});
