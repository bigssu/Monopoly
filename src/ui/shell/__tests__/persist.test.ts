import { beforeEach, describe, expect, it } from 'vitest';
import { createGame, defaultPlayers, defaultSettings } from '@/engine';

// Minimal localStorage for the node test environment.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}
(globalThis as { localStorage?: unknown }).localStorage = new MemStorage();

const { saveGame, loadSavedGame, hasSavedGame, clearSavedGame, savedGameSummary, SAVE_KEY, SAVE_BACKUP_KEY } = await import('../persist');

const game = (seed = 3) => createGame(defaultSettings({ players: defaultPlayers(3) }), seed);

describe('persist', () => {
  beforeEach(() => clearSavedGame());

  it('round-trips a game', () => {
    expect(hasSavedGame()).toBe(false);
    const g = game();
    saveGame(g);
    expect(hasSavedGame()).toBe(true);
    expect(loadSavedGame()).toEqual(g);
    expect(savedGameSummary()).toMatchObject({ round: 1, roundLimit: 15 });
    expect(savedGameSummary()!.players).toHaveLength(3);
  });

  it('falls back to the previous turn when the latest save is corrupt', () => {
    const g = game();
    saveGame(g);
    const next = { ...g, turn: g.turn + 1 };
    saveGame(next);
    expect(localStorage.getItem(SAVE_BACKUP_KEY)).not.toBeNull();
    localStorage.setItem(SAVE_KEY, '{broken');
    expect(loadSavedGame()?.turn).toBe(g.turn);
  });

  it('drops unreadable saves entirely', () => {
    localStorage.setItem(SAVE_KEY, 'nope');
    expect(hasSavedGame()).toBe(false);
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
  });

  it('clears instead of saving a finished game', () => {
    saveGame(game());
    const done = game();
    done.phase = { kind: 'gameOver', result: { winnerId: 0, victory: 'roundLimit', round: 15, ranking: [] } };
    saveGame(done);
    expect(hasSavedGame()).toBe(false);
  });
});
