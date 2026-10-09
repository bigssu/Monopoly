/**
 * Save compatibility across rules version 3: version-1 and version-2 saves recorded with the code
 * from before version 3 keep their rules exactly — the recorded continuation replays to the same
 * events, and the CPU still picks the same moves in those games. The fixture
 * (fixtures/rules-v1-v2-2026-10-08.json) was recorded once at commit c1f1440, by a one-off script
 * that git history keeps; never re-record it to "fix" a failing test.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chooseAction } from '../ai';
import { reduce } from '../reducer';
import { deserialize, serialize } from '../save';
import type { Action, GameEvent } from '../types';

interface Fixture {
  save: string;
  actions: Action[];
  digest: string;
  events: number;
  result: { winnerId: number; victory: string; round: number; cash: number[]; rng: number };
}

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/rules-v1-v2-2026-10-08.json', import.meta.url), 'utf8')) as Record<string, Fixture>;

describe('version 1 / 2 saves under rules version 3', () => {
  it.each(Object.keys(fixtures))('%s replays to the recorded events and result', (name) => {
    const f = fixtures[name]!;
    let s = deserialize(f.save);
    expect(s.settings.rulesVersion ?? 1).toBeLessThan(3);
    const events: GameEvent[] = [];
    for (const a of f.actions) {
      const r = reduce(s, a);
      events.push(...r.events);
      s = r.state;
    }
    expect(events).toHaveLength(f.events);
    expect(createHash('sha256').update(JSON.stringify(events)).digest('hex')).toBe(f.digest);
    expect(s.phase.kind).toBe('gameOver');
    if (s.phase.kind !== 'gameOver') return;
    expect({ winnerId: s.phase.result.winnerId, victory: s.phase.result.victory, round: s.phase.result.round, cash: s.players.map((p) => p.cash), rng: s.rng }).toEqual(f.result);
  });

  it.each(Object.keys(fixtures))('%s: the CPU still plays the recorded moves', (name) => {
    const f = fixtures[name]!;
    let s = deserialize(f.save);
    for (const a of f.actions) {
      expect(chooseAction(s, s.phase.kind === 'gameOver' ? 0 : s.phase.playerId)).toEqual(a);
      s = reduce(s, a).state;
    }
  });

  it('a version-3 game saves and loads with its version', () => {
    const f = fixtures['v2-normal-2p']!;
    const s = deserialize(f.save);
    const v3 = { ...s, settings: { ...s.settings, rulesVersion: 3 } };
    expect(deserialize(serialize(v3)).settings.rulesVersion).toBe(3);
  });
});
