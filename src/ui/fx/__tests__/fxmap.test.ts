/**
 * Event → VFX preset mapping (docs/VFX.md §7, §8.4): every engine event type has a mapping, the
 * mapping picks the documented presets, and every produced call builds a valid timeline.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGame, defaultPlayers, defaultSettings, type GameEvent, type GameEventType, type GameState } from '@/engine';
import { EVENT_FX, groupFx, planFx, TRANSFER_FX_MAX, type FxCtx } from '../fxmap';
import { buildPreset, type PresetName } from '../vfx/presets';
import { TIER_CAP } from '../vfx/timeline';
import { fakeEnv } from '../vfx/__tests__/helpers';

/** One sample per engine event type — a new GameEvent type without a sample fails `npm run typecheck`. */
const SAMPLES: { [K in GameEventType]: Extract<GameEvent, { type: K }> } = {
  RoundStarted: { type: 'RoundStarted', round: 13 },
  TurnStarted: { type: 'TurnStarted', playerId: 1, round: 2, turn: 5 },
  TurnEnded: { type: 'TurnEnded', playerId: 1 },
  DiceRolled: { type: 'DiceRolled', playerId: 0, dice: [3, 3], total: 6, isDouble: true, consecutiveDoubles: 1, express: false, steps: 6, context: 'normal' },
  TokenMoved: { type: 'TokenMoved', playerId: 0, from: 0, to: 3, path: [1, 2, 3], direction: 'forward', mode: 'walk', passedStart: false, cause: 'roll' },
  PassedStart: { type: 'PassedStart', playerId: 2, salary: 300, landed: false },
  MoneyChanged: { type: 'MoneyChanged', playerId: 0, delta: 200, balance: 3200, reason: 'card', counterpart: 'bank' },
  PotChanged: { type: 'PotChanged', delta: 100, pot: 300 },
  PropertyBought: { type: 'PropertyBought', playerId: 0, spaceIndex: 31, price: 1000, via: 'buy' },
  CannotAfford: { type: 'CannotAfford', playerId: 3, spaceIndex: 30, price: 800 },
  Built: { type: 'Built', playerId: 0, spaceIndex: 6, level: 2, cost: 100, free: false },
  Demolished: { type: 'Demolished', spaceIndex: 9, ownerId: 1, level: 1, cause: 'typhoon' },
  TollPaid: { type: 'TollPaid', payerId: 0, ownerId: 1, spaceIndex: 20, amount: 600, baseToll: 600, festival: false, multiplier: 1, waived: false },
  TakenOver: { type: 'TakenOver', buyerId: 2, sellerId: 1, spaceIndex: 22, price: 900 },
  TakeoverBlocked: { type: 'TakeoverBlocked', buyerId: 2, ownerId: 1, spaceIndex: 22 },
  CardDrawn: { type: 'CardDrawn', playerId: 0, cardId: 'lottery' },
  CardKept: { type: 'CardKept', playerId: 0, card: 'shield' },
  CardUsed: { type: 'CardUsed', playerId: 0, card: 'escape' },
  ExpressGranted: { type: 'ExpressGranted', playerId: 0 },
  CardNoEffect: { type: 'CardNoEffect', playerId: 0, cardId: 'leader-tax' },
  SentToIsland: { type: 'SentToIsland', playerId: 0, cause: 'space' },
  IslandStay: { type: 'IslandStay', playerId: 0, turnsLeft: 2 },
  Escaped: { type: 'Escaped', playerId: 0, method: 'doubles' },
  FestivalSet: { type: 'FestivalSet', playerId: 1, spaceIndex: 20, previous: 12 },
  TravelGranted: { type: 'TravelGranted', playerId: 0 },
  TravelDeclined: { type: 'TravelDeclined', playerId: 0 },
  DebtStarted: { type: 'DebtStarted', playerId: 0, amount: 900, shortfall: 200, reason: 'toll' },
  DebtSettled: { type: 'DebtSettled', playerId: 0, amount: 900 },
  BuildingSold: { type: 'BuildingSold', playerId: 0, spaceIndex: 6, level: 1, amount: 50 },
  PropertySold: { type: 'PropertySold', playerId: 0, spaceIndex: 6, amount: 90 },
  PropertyTransferred: { type: 'PropertyTransferred', spaceIndex: 6, from: 0, to: 1, level: 2 },
  Bankrupt: { type: 'Bankrupt', playerId: 3, creditorId: 1, round: 7 },
  AuctionStarted: { type: 'AuctionStarted', spaceIndex: 14, declinedBy: 0, minBid: 160, bidders: [1, 2] },
  AuctionBid: { type: 'AuctionBid', playerId: 1, spaceIndex: 14, amount: 200 },
  AuctionDropped: { type: 'AuctionDropped', playerId: 2, spaceIndex: 14, reason: 'pass' },
  AuctionEnded: { type: 'AuctionEnded', spaceIndex: 14, winnerId: 1, price: 200 },
  OneAway: { type: 'OneAway', playerId: 1, kind: 'group', id: 'red', missing: 22 },
  PromptOpened: { type: 'PromptOpened', phase: { kind: 'preRoll', playerId: 0, rollAgain: false } },
  GameOver: { type: 'GameOver', result: { winnerId: 0, victory: 'hubs', round: 9, ranking: [] } },
};

/** What each event plays (docs/VFX-WIRING.md §8 table). */
const EXPECTED: Record<GameEventType, PresetName[]> = {
  RoundStarted: ['ringPulse'],
  TurnStarted: ['ringPulse'],
  TurnEnded: [],
  DiceRolled: ['diceLand', 'doublesFlash'],
  TokenMoved: ['hopDust'],
  PassedStart: ['passStart'],
  MoneyChanged: ['billRain'],
  PotChanged: ['ringPulse'],
  PropertyBought: ['plotClaim'],
  CannotAfford: ['puff'],
  Built: ['buildSeq'],
  Demolished: ['puff'],
  TollPaid: ['tollPay'],
  TakenOver: ['takeoverStamp'],
  TakeoverBlocked: ['ringPulse'],
  CardDrawn: ['cardReveal'],
  CardKept: ['ringPulse'],
  CardUsed: ['puff'],
  ExpressGranted: ['ringPulse'],
  CardNoEffect: ['puff'],
  SentToIsland: ['islandSiren'],
  IslandStay: ['ringPulse'],
  Escaped: ['ringPulse'],
  FestivalSet: ['festivalBurst'],
  TravelGranted: ['ringPulse'],
  TravelDeclined: [],
  DebtStarted: ['ringPulse'],
  DebtSettled: ['ringPulse'],
  BuildingSold: ['coinIn'],
  PropertySold: ['coinIn', 'puff'],
  PropertyTransferred: ['ringPulse'],
  Bankrupt: ['bankruptcy'],
  AuctionStarted: ['ringPulse'],
  AuctionBid: ['ringPulse'],
  AuctionDropped: [],
  AuctionEnded: [],
  OneAway: ['oneAway'],
  PromptOpened: [],
  GameOver: ['victory'],
};

function state(): GameState {
  return createGame(defaultSettings({ players: defaultPlayers(4, { cpu: false }), roundLimit: 15 }), 7);
}

const ctx = (vs = state(), o: Partial<FxCtx> = {}): FxCtx => ({ vs, cardAt: () => ({ x: 800, y: 500 }), dice: () => [{ x: 760, y: 500 }, { x: 840, y: 500 }], ...o });

/** Event type names in the engine's GameEvent union (source of truth, read at runtime). */
function engineEventTypes(): string[] {
  const src = readFileSync(new URL('../../../engine/types.ts', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('export type GameEvent ='), src.indexOf('export type GameEventType'));
  return [...block.matchAll(/type: '([A-Za-z]+)'/g)].map((m) => m[1]!);
}

describe('fxmap: GameEvent → preset (VFX.md §7)', () => {
  it('maps every GameEvent type of the engine (a new event without a mapping fails here)', () => {
    const types = engineEventTypes();
    expect(types.length).toBeGreaterThan(30);
    expect([...types].sort()).toEqual(Object.keys(EVENT_FX).sort());
    expect(Object.keys(SAMPLES).sort()).toEqual([...types].sort());
  });

  const env = fakeEnv();
  for (const [type, ev] of Object.entries(SAMPLES) as [GameEventType, GameEvent][]) {
    it(`${type} → ${EXPECTED[type].join(' + ') || '(nothing)'}`, () => {
      const steps = planFx(ev, ctx());
      expect(steps.map((s) => s.preset)).toEqual(EXPECTED[type]);
      for (const s of steps) {
        const tl = buildPreset(s.preset, s.params as never, env);
        expect(tl.ops.length).toBeGreaterThan(0);
        expect(TIER_CAP[tl.tier]).toBeGreaterThan(0);
        // A deferred state change needs the cue in the timeline.
        if (s.applyAt) expect(tl.ops.some((o) => o.a.k === 'cue' && o.a.name === s.applyAt)).toBe(true);
      }
    });
  }

  it('state changes wait for the dust curtain / frame cue: Built → swap, PropertyBought / TakenOver → frame', () => {
    expect(planFx(SAMPLES.Built, ctx())[0]).toMatchObject({ preset: 'buildSeq', applyAt: 'swap', wait: 'block' });
    expect(planFx({ ...SAMPLES.Built, level: 4 }, ctx())[0]).toMatchObject({ preset: 'landmarkReveal', applyAt: 'swap' });
    expect(planFx({ ...SAMPLES.Built, level: 3, free: true }, ctx())[0]).toMatchObject({ preset: 'buildSeq', params: { free: true, from: { x: 800, y: 500 } } });
    expect(planFx(SAMPLES.PropertyBought, ctx())[0]).toMatchObject({ applyAt: 'frame', params: { price: 1000, hub: false } });
    expect(planFx(SAMPLES.TakenOver, ctx())[0]).toMatchObject({ applyAt: 'frame', params: { buyer: 2, seller: 1 } });
  });

  it('variants: triple doubles block with sirens, jump → comet, money reasons, festival removal, transfers cap', () => {
    expect(planFx({ ...SAMPLES.DiceRolled, consecutiveDoubles: 3 }, ctx())[1]).toMatchObject({ params: { triple: true }, wait: 'block' });
    expect(planFx({ ...SAMPLES.DiceRolled, isDouble: false, consecutiveDoubles: 0 }, ctx()).map((s) => s.preset)).toEqual(['diceLand']);
    expect(planFx({ ...SAMPLES.TokenMoved, mode: 'jump', path: [8], to: 8 }, ctx()).map((s) => s.preset)).toEqual(['cometJump']);
    const walk = planFx({ ...SAMPLES.TokenMoved, path: [1, 2, 3, 4, 5, 6, 7], to: 7 }, ctx());
    expect(walk).toHaveLength(1);
    expect(walk[0]).toMatchObject({ preset: 'hopDust', hop: 6, params: { space: 7, long: true } });
    expect(planFx({ ...SAMPLES.MoneyChanged, delta: -150, reason: 'tax', spaceIndex: 23 }, ctx())[0]).toMatchObject({ preset: 'coinIn', params: { to: { space: 23 } } });
    expect(planFx({ ...SAMPLES.MoneyChanged, delta: -100, reason: 'bail' }, ctx())[0]).toMatchObject({ preset: 'coinIn', params: { to: { space: 8 } } });
    for (const reason of ['salary', 'toll', 'purchase', 'build', 'takeover', 'bankruptcy', 'auction'] as const)
      expect(planFx({ ...SAMPLES.MoneyChanged, reason }, ctx())).toEqual([]);
    expect(planFx({ ...SAMPLES.FestivalSet, spaceIndex: null }, ctx()).map((s) => s.preset)).toEqual(['puff']);
    expect(planFx({ ...SAMPLES.RoundStarted, round: 5 }, ctx())).toEqual([]);
    expect(planFx(SAMPLES.PropertyTransferred, ctx(undefined, { transfers: TRANSFER_FX_MAX }))).toEqual([]);
    expect(planFx({ ...SAMPLES.SentToIsland, cause: 'doubles' }, ctx())[0]).toMatchObject({ params: { cause: 'space' } });
  });

  it('toll: tiers from amount and the payer cash left; the float comes from MoneyChanged (label null)', () => {
    const s = planFx(SAMPLES.TollPaid, ctx())[0]!;
    expect(s).toMatchObject({ preset: 'tollPay', wait: 'block', params: { amount: 600, label: null, payerCashAfter: 3000 - 600 } });
  });

  it('game over: victory kind with the right spaces / colours', () => {
    const hubs = planFx(SAMPLES.GameOver, ctx())[0]!;
    expect(hubs.params).toMatchObject({ kind: 'hubs', spaces: [5, 13, 21, 29] });
    const triple = planFx({ type: 'GameOver', result: { winnerId: 1, victory: 'triple', groups: ['brown', 'red', 'blue'], round: 9, ranking: [] } }, ctx())[0]!;
    expect(triple.params).toMatchObject({ kind: 'triple', colors: ['#A0715B', '#E8564F', '#4A6CF7'] });
    expect((triple.params as { spaces: number[] }).spaces).toHaveLength(3);
    const line = planFx({ type: 'GameOver', result: { winnerId: 1, victory: 'line', side: 'D', round: 9, ranking: [] } }, ctx())[0]!;
    expect((line.params as { spaces: number[] }).spaces).toEqual([25, 26, 28, 30, 31]);
  });

  it('derived GroupCompleted: groupChain only when the whole colour group is owned', () => {
    const vs = state();
    vs.properties[1]!.owner = 2;
    expect(groupFx(vs, 2, 1)).toEqual([]);
    vs.properties[2]!.owner = 2;
    expect(groupFx(vs, 2, 2)).toMatchObject([{ preset: 'groupChain', params: { spaces: [1, 2], player: 2, color: '#A0715B' }, wait: 'block' }]);
    expect(groupFx(vs, 2, 5)).toEqual([]);
  });
});
