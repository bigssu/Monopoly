import { describe, expect, it } from 'vitest';
import { chooseAction } from '../ai';
import { reduce, travelOptions } from '../reducer';
import { SAVE_VERSION, SaveError, deserialize, peekSave, serialize } from '../save';
import { simulateGame } from '../sim';
import { tollOf } from '../rules';
import { game, own, queueDice } from './helpers';

describe('save / load', () => {
  it('rejects unrelated prompts that bypass the current player pending turn state', () => {
    for (const pending of ['island', 'travel']) {
      const state = game();
      state.players[0]!.position = 1;
      if (pending === 'island') state.players[0]!.islandTurns = 3;
      else state.players[0]!.travelPending = true;
      state.phase = { kind: 'buy', playerId: 0, spaceIndex: 1, price: 100 };
      expect(() => deserialize(serialize(state))).toThrow(SaveError);
    }
  });

  it('allows an island-bound player to bid during another player turn', () => {
    let state = game({ n: 3, auction: true });
    state.players[0]!.position = 29;
    state.players[1]!.position = 8;
    state.players[1]!.islandTurns = 3;
    queueDice(state, [1, 3]);
    state = reduce(state, { type: 'Roll', playerId: 0 }).state;
    expect(state.phase.kind).toBe('buy');
    state = reduce(state, { type: 'Pass', playerId: 0 }).state;
    expect(state.phase).toMatchObject({ kind: 'auction', playerId: 1, declinedBy: 0 });
    expect(deserialize(serialize(state))).toEqual(state);
  });

  it('round-trips a mid-game state exactly and play continues identically', () => {
    let s = game({ n: 4, seed: 77 });
    for (let i = 0; i < 60 && s.phase.kind !== 'gameOver'; i++) s = reduce(s, chooseAction(s, s.phase.playerId)).state;
    const json = serialize(s, '2026-09-29T12:00:00Z');
    const loaded = deserialize(json);
    expect(loaded).toEqual(s);
    if (s.phase.kind !== 'gameOver') {
      const a = chooseAction(s, s.phase.playerId);
      expect(reduce(loaded, a)).toEqual(reduce(s, a));
    }
    expect(peekSave(json)).toMatchObject({ savedAt: '2026-09-29T12:00:00Z', round: s.round });
    expect(JSON.parse(json).version).toBe(SAVE_VERSION);
  });

  it('rejects garbage, foreign files and future versions', () => {
    expect(() => deserialize('not json')).toThrow(SaveError);
    expect(() => deserialize('{"format":"other","version":1}')).toThrow(SaveError);
    const future = JSON.parse(serialize(game()));
    future.version = SAVE_VERSION + 1;
    expect(() => deserialize(JSON.stringify(future))).toThrow(SaveError);
    const broken = JSON.parse(serialize(game()));
    broken.state.properties = [];
    expect(() => deserialize(JSON.stringify(broken))).toThrow(SaveError);
    expect(peekSave('nope')).toBeNull();
  });

  it.each([8, 9] as const)('round-trips size %i and rejects mismatched properties', (spacesPerSide) => {
    const s = game({ spacesPerSide });
    expect(deserialize(serialize(s)).settings.spacesPerSide).toBe(spacesPerSide);
    const broken = JSON.parse(serialize(s));
    broken.state.properties.pop();
    expect(() => deserialize(JSON.stringify(broken))).toThrow(SaveError);
  });

  it('loads a legacy v1 save as the original 7-space board', () => {
    const legacy = JSON.parse(serialize(game()));
    delete legacy.state.settings.spacesPerSide;
    expect(deserialize(JSON.stringify(legacy)).settings.spacesPerSide).toBe(7);
  });

  it('rejects malformed player, ownership, and phase data with SaveError', () => {
    const corruptions: Array<(file: any) => void> = [
      (file) => { file.state.players[0] = null; },
      (file) => { file.state.properties[1].owner = 99; },
      (file) => { file.state.phase = { kind: 'freeUpgrade', playerId: 0, options: ['bad'] }; },
      (file) => { file.state.phase = { kind: 'takeover', playerId: 0, spaceIndex: 1, ownerId: 99, price: 10, ownerHasShield: false }; },
      (file) => { file.state.phase = { kind: 'debt', playerId: 0, amount: 10, payments: [{ to: 'bank', amount: 'bad' }], reason: 'card', then: { kind: 'endLanding' } }; },
      (file) => { file.state.phase = { kind: 'auction', playerId: 0, spaceIndex: 1, declinedBy: 0, order: [99], active: [0], highBid: null, highBidderId: null, minBid: 10, increment: 10 }; },
      (file) => { file.state.testHooks = { cardQueue: ['not-a-card'] }; },
      (file) => { file.state.properties[5].level = 1; },
    ];
    for (const corrupt of corruptions) {
      const file = JSON.parse(serialize(game()));
      corrupt(file);
      expect(() => deserialize(JSON.stringify(file))).toThrow(SaveError);
    }
  });

  it.each([7, 8, 9] as const)('round-trips seeded simulated states on the %i-space-side board', (spacesPerSide) => {
    const state = simulateGame(game({ spacesPerSide }).settings, 10_000 + spacesPerSide, { maxSteps: 10_000 }).finalState;
    expect(deserialize(serialize(state))).toEqual(state);
  });

  it('rejects phase cross-references that would corrupt reducer behavior', () => {
    const freeUpgradeHub = game();
    own(freeUpgradeHub, 5, 0);
    freeUpgradeHub.phase = { kind: 'freeUpgrade', playerId: 0, options: [5] };
    expect(() => deserialize(serialize(freeUpgradeHub))).toThrow(SaveError);

    const forgedTakeover = game();
    own(forgedTakeover, 1, 1);
    forgedTakeover.players[0]!.position = 1;
    forgedTakeover.phase = { kind: 'takeover', playerId: 0, spaceIndex: 1, ownerId: 0, price: 0, ownerHasShield: false };
    expect(() => deserialize(serialize(forgedTakeover))).toThrow(SaveError);

    const forgedAuction = game({ n: 3, auction: true });
    forgedAuction.players[0]!.position = 1;
    forgedAuction.players[1]!.cash = 100;
    forgedAuction.phase = { kind: 'auction', playerId: 2, spaceIndex: 1, declinedBy: 0, order: [1, 2], active: [1, 2], highBid: 500, highBidderId: 1, minBid: 510, increment: 10 };
    expect(() => deserialize(serialize(forgedAuction))).toThrow(SaveError);

    const forgedToll = game();
    own(forgedToll, 1, 1);
    forgedToll.players[0]!.cash = 0;
    const baseToll = tollOf(forgedToll, 1);
    forgedToll.phase = { kind: 'debt', playerId: 0, amount: baseToll * 3, payments: [{ to: 1, amount: baseToll * 3 }], reason: 'toll', then: { kind: 'takeoverCheck', spaceIndex: 1 }, toll: { spaceIndex: 1, ownerId: 1, baseToll, festival: false, multiplier: 3 } };
    expect(() => deserialize(serialize(forgedToll))).toThrow(SaveError);

    const remoteToll = game();
    own(remoteToll, 1, 1);
    remoteToll.players[0]!.cash = 0;
    const remoteBaseToll = tollOf(remoteToll, 1);
    remoteToll.phase = { kind: 'debt', playerId: 0, amount: remoteBaseToll, payments: [{ to: 1, amount: remoteBaseToll }], reason: 'toll', then: { kind: 'takeoverCheck', spaceIndex: 1 }, toll: { spaceIndex: 1, ownerId: 1, baseToll: remoteBaseToll, festival: false, multiplier: 1 } };
    expect(() => deserialize(serialize(remoteToll))).toThrow(SaveError);

    const bypassedIsland = game();
    bypassedIsland.players[0]!.islandTurns = 1;
    expect(() => deserialize(serialize(bypassedIsland))).toThrow(SaveError);

    const remoteIsland = game();
    remoteIsland.players[0]!.islandTurns = 3;
    remoteIsland.phase = { kind: 'island', playerId: 0, turnsLeft: 3, bail: 200, canPayBail: true, hasEscapeCard: false };
    expect(() => deserialize(serialize(remoteIsland))).toThrow(SaveError);

    const remoteTravel = game();
    remoteTravel.players[0]!.travelPending = true;
    remoteTravel.phase = { kind: 'travel', playerId: 0, options: travelOptions(0) };
    expect(() => deserialize(serialize(remoteTravel))).toThrow(SaveError);

    const unpayableDebt = game();
    unpayableDebt.players[0]!.cash = 0;
    unpayableDebt.phase = { kind: 'debt', playerId: 0, amount: 1, payments: [{ to: 'bank', amount: 1 }], reason: 'card', then: { kind: 'endLanding' } };
    expect(() => deserialize(serialize(unpayableDebt))).toThrow(SaveError);

    const emptyFreeUpgrade = game();
    emptyFreeUpgrade.phase = { kind: 'freeUpgrade', playerId: 0, options: [] };
    expect(() => deserialize(serialize(emptyFreeUpgrade))).toThrow(SaveError);
  });

  it('round-trips all sampled legal reducer phase snapshots', () => {
    for (const spacesPerSide of [7, 8, 9] as const) {
      for (let seed = 1; seed <= 24; seed++) {
        let state = game({ n: 4, spacesPerSide, auction: seed % 2 === 0, buildAnywhere: seed % 3 === 0, endOnFirstBankruptcy: seed % 5 !== 0, seed });
        for (let step = 0; step < 250 && state.phase.kind !== 'gameOver'; step++) {
          expect(deserialize(serialize(state))).toEqual(state);
          state = reduce(state, chooseAction(state, state.phase.playerId)).state;
        }
        expect(deserialize(serialize(state))).toEqual(state);
      }
    }
  });
});
