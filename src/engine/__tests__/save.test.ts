import { describe, expect, it } from 'vitest';
import { chooseAction } from '../ai';
import { reduce } from '../reducer';
import { SAVE_VERSION, SaveError, deserialize, peekSave, serialize } from '../save';
import { game } from './helpers';

describe('save / load', () => {
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
});
