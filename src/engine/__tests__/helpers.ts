import type { CardId } from '../../content/cards';
import { createGame, deepClone, reduce } from '../reducer';
import { defaultPlayers, defaultSettings } from '../settings';
import type { Action, GameEvent, GameState, Level, PlayerId, Settings } from '../types';

export function settings(overrides: Partial<Settings> & { n?: number } = {}): Settings {
  const { n = 2, ...rest } = overrides;
  // Rule tests describe the original rules; new rule levels opt in with `rules`.
  return { ...defaultSettings(), players: defaultPlayers(n), rules: 'easy', ...rest };
}

export function game(overrides: Partial<Settings> & { n?: number; seed?: number } = {}): GameState {
  const { seed = 1, ...rest } = overrides;
  return createGame(settings(rest), seed);
}

/** Copy the state and apply direct edits (scenario setup). */
export function edit(state: GameState, fn: (s: GameState) => void): GameState {
  const s = deepClone(state);
  fn(s);
  return s;
}

export function own(s: GameState, idx: number, owner: PlayerId | null, level: Level = 0): void {
  const p = s.properties[idx];
  if (!p) throw new Error(`not a property: ${idx}`);
  p.owner = owner;
  p.level = level;
}

/** A non-double dice pair summing to n (3..11), or a double for 2/12. */
export function diceFor(n: number): [number, number] {
  if (n === 2) return [1, 1];
  if (n === 12) return [6, 6];
  const a = Math.max(1, n - 6);
  const b = n - a;
  if (a === b) return [a - 1, b + 1];
  return [a, b];
}

export function queueDice(s: GameState, ...dice: Array<[number, number]>): void {
  s.testHooks = { ...(s.testHooks ?? {}), diceQueue: [...(s.testHooks?.diceQueue ?? []), ...dice] };
}

export function queueCards(s: GameState, ...cards: CardId[]): void {
  s.testHooks = { ...(s.testHooks ?? {}), cardQueue: [...(s.testHooks?.cardQueue ?? []), ...cards] };
}

export function queuePicks(s: GameState, ...picks: number[]): void {
  s.testHooks = { ...(s.testHooks ?? {}), pickQueue: [...(s.testHooks?.pickQueue ?? []), ...picks] };
}

export interface Step {
  state: GameState;
  events: GameEvent[];
}

export function act(state: GameState, action: Action): Step {
  return reduce(state, action);
}

/** Apply several actions, collecting all events. */
export function run(state: GameState, ...actions: Action[]): Step {
  let s = state;
  const events: GameEvent[] = [];
  for (const a of actions) {
    const r = reduce(s, a);
    s = r.state;
    events.push(...r.events);
  }
  return { state: s, events };
}

export const roll = (playerId: PlayerId): Action => ({ type: 'Roll', playerId });
export const pass = (playerId: PlayerId): Action => ({ type: 'Pass', playerId });
export const buy = (playerId: PlayerId): Action => ({ type: 'Buy', playerId });

/** Put player `pid` so that rolling `n` lands on `target`, and queue that roll. */
export function setupLanding(s: GameState, pid: PlayerId, target: number, n = 5): void {
  s.players[pid]!.position = (target - n + 32) % 32;
  queueDice(s, diceFor(n));
}

export function ofType<T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

export function types(events: GameEvent[]): string[] {
  return events.map((e) => e.type);
}
