import { describe, expect, it } from 'vitest';
import { chooseAction } from '../ai';
import { createGame, defaultAction, isLegal, legalActions, reduce } from '../reducer';
import { defaultPlayers, defaultSettings } from '../settings';
import { assertInvariants, simulateGame } from '../sim';
import type { Settings } from '../types';

const cpu = (n: number, extra: Partial<Settings> = {}): Settings => ({
  ...defaultSettings(),
  players: defaultPlayers(n, { cpu: true }),
  ...extra,
});

describe('determinism', () => {
  it('same seed ⇒ identical event log and final state', () => {
    const a = simulateGame(cpu(4), 1234, { recordEvents: true });
    const b = simulateGame(cpu(4), 1234, { recordEvents: true });
    expect(a.events!.length).toBeGreaterThan(50);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.finalState).toEqual(b.finalState);
  });

  it('different seeds ⇒ different games', () => {
    const a = simulateGame(cpu(4), 1, { recordEvents: true });
    const b = simulateGame(cpu(4), 2, { recordEvents: true });
    expect(JSON.stringify(a.events)).not.toBe(JSON.stringify(b.events));
  });
});

describe('legal actions', () => {
  it('are never empty in a non-terminal state; default and CPU actions are always legal', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const settings = cpu(2 + (seed % 3), { auction: seed % 2 === 0, buildAnywhere: seed % 5 === 0, endOnFirstBankruptcy: seed % 3 !== 0 });
      let s = createGame(settings, seed);
      let steps = 0;
      while (s.phase.kind !== 'gameOver' && steps++ < 5000) {
        const legal = legalActions(s);
        expect(legal.length).toBeGreaterThan(0);
        const def = defaultAction(s)!;
        expect(isLegal(s, def)).toBe(true);
        // alternate CPU choice and the timer default to cover both paths
        const a = steps % 4 === 0 ? def : chooseAction(s, s.phase.playerId);
        expect(isLegal(s, a)).toBe(true);
        s = reduce(s, a).state;
      }
      expect(s.phase.kind).toBe('gameOver');
      expect(legalActions(s)).toEqual([]);
    }
  });

  it.each([8, 9] as const)('CPU actions remain legal and finish on the %i-space-side board', (spacesPerSide) => {
    const result = simulateGame(cpu(3, { spacesPerSide, roundLimit: 10 }), 4321 + spacesPerSide, { maxSteps: 10_000 });
    expect(result.timedOut).toBe(false);
    expect(result.finalState.properties).toHaveLength(4 * (spacesPerSide + 1));
    expect(result.victory).not.toBeNull();
  });

  it('keeps interleaved board-size games independent', () => {
    const eight = createGame(cpu(2, { spacesPerSide: 8, roundLimit: 10 }), 8);
    const nine = createGame(cpu(2, { spacesPerSide: 9, roundLimit: 10 }), 9);
    const nextEight = reduce(eight, chooseAction(eight, 0)).state;
    expect(eight.properties).toHaveLength(36);
    expect(nine.properties).toHaveLength(40);
    expect(nextEight.players.every((player) => player.position >= 0 && player.position < 36)).toBe(true);
    expect(nine.players.every((player) => player.position >= 0 && player.position < 40)).toBe(true);
  });
});

describe('fuzz: 200 seeded CPU games', () => {
  it('all terminate without errors or negative cash', () => {
    const variants: Settings[] = [
      cpu(4),
      cpu(3, { auction: true }),
      cpu(2, { roundLimit: 30 }),
      cpu(4, { endOnFirstBankruptcy: false, roundLimit: null }),
      cpu(4, { startCash: 2000, takeover: false }),
    ];
    for (let seed = 1; seed <= 200; seed++) {
      const settings = variants[seed % variants.length]!;
      if (seed % 7 === 0) settings.players.forEach((p) => (p.cpuLevel = 'easy'));
      const r = simulateGame(settings, seed, { maxSteps: 50_000, checkInvariants: true });
      expect(r.timedOut, `seed ${seed} timed out`).toBe(false);
      expect(r.victory).not.toBeNull();
      expect(r.finalCash.every((c) => c >= 0)).toBe(true);
      assertInvariants(r.finalState);
      if (settings.roundLimit !== null) expect(r.rounds).toBeLessThanOrEqual(settings.roundLimit);
      settings.players.forEach((p) => (p.cpuLevel = 'normal'));
    }
  });

  it('elimination games with no round limit end with a single winner', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const r = simulateGame(cpu(4, { endOnFirstBankruptcy: false, roundLimit: null }), seed);
      expect(['lastStanding', 'triple', 'line', 'hubs']).toContain(r.victory);
    }
  });
});
