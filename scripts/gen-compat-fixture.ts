/**
 * One-off (kept for the record): version-1/2 save fixtures and their golden continuation (actions
 * + an event digest), recorded with the code from BEFORE rules version 3, for
 * src/engine/__tests__/compat-v3.test.ts.
 *   npx tsx scripts/gen-compat-fixture.ts > src/engine/__tests__/fixtures/rules-v1-v2-2026-10-08.json
 * Do not re-run it to "fix" a failing compat test: the point is that old saves keep their rules.
 */
import { createHash } from 'node:crypto';
import { chooseAction } from '../src/engine/ai';
import { createGame, reduce } from '../src/engine/reducer';
import { serialize } from '../src/engine/save';
import { defaultPlayers, defaultSettings } from '../src/engine/settings';
import type { Action, GameEvent, RuleLevel, Settings } from '../src/engine/types';

interface Case { name: string; n: number; rules: RuleLevel; rv: number; seed: number; at: number }
const cases: Case[] = [
  { name: 'v1-normal-2p', n: 2, rules: 'normal', rv: 1, seed: 11, at: 40 },
  { name: 'v1-easy-4p', n: 4, rules: 'easy', rv: 1, seed: 12, at: 50 },
  { name: 'v2-normal-2p', n: 2, rules: 'normal', rv: 2, seed: 13, at: 80 },
  { name: 'v2-normal-2p-b', n: 2, rules: 'normal', rv: 2, seed: 21, at: 30 },
  { name: 'v2-normal-4p', n: 4, rules: 'normal', rv: 2, seed: 14, at: 60 },
  { name: 'v2-advanced-3p', n: 3, rules: 'advanced', rv: 2, seed: 16, at: 40 },
];
const out: Record<string, unknown> = {};
for (const c of cases) {
  const players = defaultPlayers(c.n, { cpu: true });
  const st: Settings = { ...defaultSettings(), players, roundLimit: 30, rules: c.rules, rulesVersion: c.rv };
  let s = createGame(st, c.seed);
  for (let i = 0; i < c.at && s.phase.kind !== 'gameOver'; i++) s = reduce(s, chooseAction(s, s.phase.playerId)).state;
  const save = serialize(s, '2026-10-08T00:00:00.000Z');
  const actions: Action[] = [];
  const events: GameEvent[] = [];
  let k = 0;
  while (s.phase.kind !== 'gameOver' && k++ < 20000) {
    const a = chooseAction(s, s.phase.playerId);
    actions.push(a);
    const r = reduce(s, a);
    events.push(...r.events);
    s = r.state;
  }
  if (s.phase.kind !== 'gameOver') throw new Error(c.name);
  const res = s.phase.result;
  out[c.name] = {
    save,
    actions,
    digest: createHash('sha256').update(JSON.stringify(events)).digest('hex'),
    events: events.length,
    result: { winnerId: res.winnerId, victory: res.victory, round: res.round, cash: s.players.map((p) => p.cash), rng: s.rng },
  };
}
console.log(JSON.stringify(out));
