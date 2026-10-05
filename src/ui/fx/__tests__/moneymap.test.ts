/**
 * Engine events → money cut-ins (moneymap.ts, docs/MONEY-EVENTS.md §10.4 / §11): every money-moving
 * event lands in exactly one scene, the grouping follows §4.3, and a new MoneyReason without a
 * mapping fails here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  chooseAction,
  createGame,
  deepClone,
  defaultPlayers,
  defaultSettings,
  reduce,
  type GameEvent,
  type GameState,
  type MoneyReason,
  type Settings,
} from '@/engine';
import { applyMoneyState, MONEY_EVENT_TYPES, planMoney, REASON_SCENES, type MoneyGroup, type MoneyScene } from '../moneymap';

function engineReasons(): string[] {
  const src = readFileSync(new URL('../../../engine/types.ts', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('export type MoneyReason ='), src.indexOf(';', src.indexOf('export type MoneyReason =')));
  return [...block.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!);
}

const mc = (playerId: number, delta: number, balance: number, reason: MoneyReason, counterpart: number | 'bank' | 'pot', spaceIndex?: number): GameEvent => ({
  type: 'MoneyChanged', playerId, delta, balance, reason, counterpart, ...(spaceIndex !== undefined ? { spaceIndex } : {}),
});

const kinds = (gs: MoneyGroup[]): string[] => gs.map((g) => g.scene.kind);

describe('moneymap: MoneyReason → scenes', () => {
  it('maps every MoneyReason of the engine (a new reason without a mapping fails here)', () => {
    const reasons = engineReasons();
    expect(reasons.length).toBeGreaterThanOrEqual(13);
    for (const r of reasons) {
      expect(REASON_SCENES[r as MoneyReason], `MoneyReason '${r}' has no money scene`).toBeDefined();
      expect(REASON_SCENES[r as MoneyReason].length).toBeGreaterThan(0);
    }
    expect(Object.keys(REASON_SCENES).sort()).toEqual([...reasons].sort());
  });
});

describe('moneymap: grouping (§4.3)', () => {
  it('purchase: PropertyBought + its payment is one purchase scene', () => {
    const g = planMoney([
      { type: 'PropertyBought', playerId: 0, spaceIndex: 3, price: 120, via: 'buy' },
      mc(0, -120, 2880, 'purchase', 'bank', 3),
      { type: 'PromptOpened', phase: { kind: 'build', playerId: 0, spaceIndex: 3, toLevel: 1, cost: 50 } as never },
    ]);
    expect(kinds(g)).toEqual(['purchase']);
    expect(g[0]!.events).toEqual([0, 1]);
    expect(g[0]!.keep).toBe(false);
  });

  it('auction win: purchase via auction', () => {
    const g = planMoney([
      { type: 'AuctionEnded', spaceIndex: 3, winnerId: 1, price: 90 },
      { type: 'PropertyBought', playerId: 1, spaceIndex: 3, price: 90, via: 'auction' },
      mc(1, -90, 1910, 'auction', 'bank', 3),
    ]);
    expect(g.map((x) => x.scene)).toEqual([{ kind: 'purchase', player: 1, spaceIndex: 3, price: 90, via: 'auction' }]);
  });

  it('build: the cost (emitted first) and Built are one build scene; free upgrade has no coins', () => {
    const g = planMoney([mc(0, -100, 2000, 'build', 'bank', 5), { type: 'Built', playerId: 0, spaceIndex: 5, level: 2, cost: 100, free: false }]);
    expect(g.map((x) => x.scene)).toEqual([{ kind: 'build', player: 0, spaceIndex: 5, level: 2, cost: 100, free: false }]);
    expect(g[0]!.events).toEqual([0, 1]);
    const f = planMoney([{ type: 'Built', playerId: 0, spaceIndex: 5, level: 3, cost: 0, free: true }]);
    expect(f[0]!.scene).toMatchObject({ kind: 'build', free: true, level: 3 });
  });

  it('purchase then build in one batch: one cut-in (keep)', () => {
    const g = planMoney([
      { type: 'PropertyBought', playerId: 0, spaceIndex: 3, price: 120, via: 'buy' },
      mc(0, -120, 2880, 'purchase', 'bank', 3),
      mc(0, -50, 2830, 'build', 'bank', 3),
      { type: 'Built', playerId: 0, spaceIndex: 3, level: 1, cost: 50, free: false },
    ]);
    expect(kinds(g)).toEqual(['purchase', 'build']);
    expect(g.map((x) => x.keep)).toEqual([true, false]);
  });

  it('toll: TollPaid + both sides; festival flag kept; waived → short beat without money', () => {
    const g = planMoney([
      { type: 'TollPaid', payerId: 1, ownerId: 2, spaceIndex: 9, amount: 340, baseToll: 170, festival: true, multiplier: 1, waived: false },
      mc(1, -340, 1660, 'toll', 2, 9),
      mc(2, 340, 2340, 'toll', 1, 9),
    ]);
    expect(g.map((x) => x.scene)).toEqual([{ kind: 'toll', payer: 1, owner: 2, spaceIndex: 9, amount: 340, festival: true, multiplier: 1 }]);
    expect(g[0]!.events).toEqual([0, 1, 2]);
    const w = planMoney([
      { type: 'CardUsed', playerId: 1, card: 'toll-pass' },
      { type: 'TollPaid', payerId: 1, ownerId: 2, spaceIndex: 9, amount: 0, baseToll: 170, festival: false, multiplier: 1, waived: true },
    ]);
    expect(kinds(w)).toEqual(['tollWaived']);
  });

  it('takeover: TakenOver + both payments', () => {
    const g = planMoney([
      { type: 'TakenOver', buyerId: 0, sellerId: 3, spaceIndex: 12, price: 600 },
      mc(0, -600, 1400, 'takeover', 3, 12),
      mc(3, 600, 2600, 'takeover', 0, 12),
    ]);
    expect(g[0]!.scene).toEqual({ kind: 'takeover', buyer: 0, seller: 3, spaceIndex: 12, price: 600 });
    expect(g[0]!.events).toEqual([0, 1, 2]);
  });

  it('salary: PassedStart + MoneyChanged → receive; then a tax on landing chains into one cut-in', () => {
    const g = planMoney([
      { type: 'TokenMoved', playerId: 0, from: 30, to: 2, path: [31, 0, 1, 2], direction: 'forward', mode: 'walk', passedStart: true, cause: 'roll' },
      { type: 'PassedStart', playerId: 0, salary: 300, landed: false },
      mc(0, 300, 3300, 'salary', 'bank', 0),
      mc(0, -330, 2970, 'tax', 'pot', 2),
      { type: 'PotChanged', delta: 330, pot: 330 },
    ]);
    expect(g.map((x) => x.scene)).toEqual([
      { kind: 'receive', player: 0, amount: 300, source: 'salary', cardId: null },
      { kind: 'pay', player: 0, amount: 330, sink: 'tax', cardId: null, spaceIndex: 2 },
    ]);
    expect(g[1]!.events).toEqual([3, 4]);
    expect(g.map((x) => x.keep)).toEqual([true, false]);
  });

  it('pot payout: PotChanged(−) + MoneyChanged(pot) → receive pot; donation and bail → pay', () => {
    expect(planMoney([{ type: 'PotChanged', delta: -400, pot: 0 }, mc(0, 400, 3400, 'pot', 'pot')]).map((x) => x.scene)).toEqual([
      { kind: 'receive', player: 0, amount: 400, source: 'pot', cardId: null },
    ]);
    expect(planMoney([mc(1, -100, 900, 'donation', 'pot', 16), { type: 'PotChanged', delta: 100, pot: 500 }]).map((x) => x.scene.kind)).toEqual(['pay']);
    expect(planMoney([mc(1, -100, 900, 'bail', 'bank', 8)]).map((x) => x.scene)).toEqual([
      { kind: 'pay', player: 1, amount: 100, sink: 'bail', cardId: null, spaceIndex: 8 },
    ]);
  });

  it('a card collecting from everyone is ONE collectFromAll (net per player)', () => {
    const g = planMoney([
      { type: 'CardDrawn', playerId: 0, cardId: 'birthday' as never },
      mc(1, -50, 950, 'card', 0), mc(0, 50, 3050, 'card', 1),
      mc(2, -50, 950, 'card', 0), mc(0, 50, 3100, 'card', 2),
      mc(3, -30, 0, 'card', 0), mc(0, 30, 3130, 'card', 3),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.scene).toEqual({
      kind: 'collectFromAll', receiver: 0, cardId: 'birthday',
      payers: [{ id: 1, amount: 50 }, { id: 2, amount: 50 }, { id: 3, amount: 30 }],
    });
    expect(g[0]!.events).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('pay everyone → payAll; leader tax (one to one) → transfer via the centre; bank card → receive / pay', () => {
    const pa = planMoney([mc(0, -50, 950, 'card', 1), mc(1, 50, 1050, 'card', 0), mc(0, -50, 900, 'card', 2), mc(2, 50, 1050, 'card', 0)]);
    expect(pa[0]!.scene).toMatchObject({ kind: 'payAll', payer: 0, receivers: [{ id: 1, amount: 50 }, { id: 2, amount: 50 }] });
    const lt = planMoney([mc(2, -200, 800, 'card', 1), mc(1, 200, 1200, 'card', 2)]);
    expect(lt[0]!.scene).toMatchObject({ kind: 'transfer', from: 2, to: 1, amount: 200, reason: 'card' });
    expect(planMoney([mc(0, 200, 1200, 'card', 'bank')])[0]!.scene).toMatchObject({ kind: 'receive', source: 'bonus' });
    expect(planMoney([mc(0, -200, 800, 'card', 'bank')])[0]!.scene).toMatchObject({ kind: 'pay', sink: 'fine' });
  });

  it('debt sales → sale scenes (building level sold), then the settled toll chains', () => {
    const g = planMoney([
      { type: 'BuildingSold', playerId: 1, spaceIndex: 5, level: 1, amount: 60 },
      { type: 'Demolished', spaceIndex: 5, ownerId: 1, level: 1, cause: 'sale' },
      mc(1, 60, 260, 'sale', 'bank', 5),
      { type: 'TollPaid', payerId: 1, ownerId: 0, spaceIndex: 9, amount: 250, baseToll: 250, festival: false, multiplier: 1, waived: false },
      mc(1, -250, 10, 'toll', 0, 9),
      mc(0, 250, 3250, 'toll', 1, 9),
      { type: 'DebtSettled', playerId: 1, amount: 250 },
    ]);
    expect(g.map((x) => x.scene)).toEqual([
      { kind: 'sale', player: 1, amount: 60, spaceIndex: 5, building: 2 },
      { kind: 'toll', payer: 1, owner: 0, spaceIndex: 9, amount: 250, festival: false, multiplier: 1 },
    ]);
    expect(g[0]!.events).toEqual([0, 1, 2]);
    expect(g[0]!.keep).toBe(true);
  });

  it('bankruptcy: Bankrupt + remaining cash + every deed is one scene', () => {
    const g = planMoney([
      { type: 'Bankrupt', playerId: 2, creditorId: 0, round: 4 },
      mc(2, -40, 0, 'bankruptcy', 0), mc(0, 40, 3040, 'bankruptcy', 2),
      { type: 'PropertyTransferred', spaceIndex: 4, from: 2, to: 0, level: 1 },
      { type: 'PropertyTransferred', spaceIndex: 6, from: 2, to: 0, level: 0 },
      { type: 'GameOver', result: {} as never },
    ]);
    expect(g.map((x) => x.scene)).toEqual([{ kind: 'bankruptcy', debtor: 2, creditor: 0, properties: [4, 6], receivers: [] }]);
    expect(g[0]!.events).toEqual([0, 1, 2, 3, 4]);
  });

  it('bankruptcy owed to several players (pay-each card): the shares are its receivers', () => {
    const g = planMoney([
      { type: 'Bankrupt', playerId: 0, creditorId: null, round: 4 },
      mc(0, -23, 47, 'bankruptcy', 1), mc(1, 23, 3023, 'bankruptcy', 0),
      mc(0, -23, 24, 'bankruptcy', 2), mc(2, 23, 3023, 'bankruptcy', 0),
      mc(0, -24, 0, 'bankruptcy', 'bank'),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.scene).toMatchObject({ kind: 'bankruptcy', creditor: null, receivers: [{ id: 1, amount: 23 }, { id: 2, amount: 23 }] });
  });

  it('double-up: a won stake is income, a lost one a payment', () => {
    expect(planMoney([mc(0, 300, 3300, 'salary', 'bank', 0)])[0]!.scene).toMatchObject({ kind: 'receive', source: 'doubleUp' });
    expect(planMoney([mc(0, -300, 3000, 'salary', 'bank', 0)])[0]!.scene).toMatchObject({ kind: 'pay', sink: 'doubleUp' });
  });
});

describe('moneymap: seeded games', () => {
  const settingsFor = (n: number, rules: Settings['rules'], auction: boolean): Settings =>
    defaultSettings({ players: defaultPlayers(n, { cpu: true }), rules, auction, roundLimit: 15 });

  it('every money event of real games is in exactly one scene, and the groups reproduce the engine cash', () => {
    const seen = new Map<MoneyScene['kind'], number>();
    const reasons = new Set<MoneyReason>();
    let batches = 0;
    for (const [seed, n, rules, auction] of [
      [1, 4, 'normal', false], [2, 3, 'advanced', true], [3, 2, 'easy', false], [4, 4, 'advanced', false], [5, 4, 'normal', true], [6, 3, 'advanced', true],
    ] as const) {
      let s: GameState = createGame(settingsFor(n, rules, auction), seed * 7919);
      for (let step = 0; step < 900 && s.phase.kind !== 'gameOver'; step++) {
        const prev = s;
        const r = reduce(s, chooseAction(s, s.phase.playerId));
        s = r.state;
        batches++;
        const groups = planMoney(r.events);
        const owner = new Map<number, number>();
        groups.forEach((g, gi) => {
          seen.set(g.scene.kind, (seen.get(g.scene.kind) ?? 0) + 1);
          for (const k of g.events) {
            expect(owner.has(k), `event ${k} in two groups`).toBe(false);
            owner.set(k, gi);
          }
        });
        r.events.forEach((e, k) => {
          if (e.type === 'MoneyChanged') {
            reasons.add(e.reason);
            const g = groups[owner.get(k)!];
            expect(g, `MoneyChanged(${e.reason}) left out of every scene`).toBeDefined();
            expect(REASON_SCENES[e.reason]).toContain(g!.scene.kind);
          } else if (MONEY_EVENT_TYPES.has(e.type) && e.type !== 'PotChanged' && e.type !== 'PropertyTransferred') {
            expect(owner.has(k), `${e.type} left out of every scene`).toBe(true);
          }
        });
        // Applying the grouped events' state = the engine's cash after the batch (wallet labels end right).
        const vs = deepClone(prev);
        for (const g of groups) for (const k of g.events) applyMoneyState(vs, r.events[k]!);
        for (const p of s.players) expect(vs.players[p.id]!.cash).toBe(p.cash);
      }
    }
    expect(batches).toBeGreaterThan(500);
    for (const k of ['purchase', 'build', 'toll', 'receive', 'pay'] as const) expect(seen.get(k) ?? 0, `scene ${k} seen`).toBeGreaterThan(0);
    for (const r of ['salary', 'toll', 'purchase', 'build', 'card'] as const) expect(reasons.has(r)).toBe(true);
  });
});
