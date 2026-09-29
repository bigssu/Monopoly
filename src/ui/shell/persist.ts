/**
 * Saved game (one slot) — engine `serialize/deserialize`, versioned key, corrupt-save safe.
 * The game screen calls `saveGame(state)` after every reduced action.
 */
import { deserialize, serialize, type GameState } from '@/engine';
import { kvGet, kvRemove, kvSet } from './storage';

export const SAVE_KEY = 'lotandroll:save:v1';
/** Previous good save, used if the latest one is unreadable. */
export const SAVE_BACKUP_KEY = 'lotandroll:save:v1:prev';

export interface SavedGameSummary {
  savedAt: string | null;
  round: number;
  roundLimit: number | null;
  players: { name: string; tokenId: string; colorId: string; isCpu: boolean; bankrupt: boolean }[];
}

let lastWritten: { json: string; turn: number; seed: number } | null = null;

export function saveGame(state: GameState): void {
  if (state.phase.kind === 'gameOver') {
    clearSavedGame();
    return;
  }
  let json: string;
  try {
    json = serialize(state, new Date().toISOString());
  } catch (e) {
    console.warn('[persist] serialize failed', e);
    return;
  }
  if (!lastWritten) {
    const stored = kvGet(SAVE_KEY);
    const st = stored ? peek(stored) : null;
    if (stored && st) lastWritten = { json: stored, turn: st.turn, seed: st.seed };
  }
  // Keep the save from the previous turn as a backup, so a corrupt write never loses the game.
  if (lastWritten && lastWritten.seed !== state.seed) kvRemove(SAVE_BACKUP_KEY);
  else if (lastWritten && lastWritten.turn !== state.turn) kvSet(SAVE_BACKUP_KEY, lastWritten.json, { debounceMs: 400 });
  kvSet(SAVE_KEY, json, { debounceMs: 400 });
  lastWritten = { json, turn: state.turn, seed: state.seed };
}

function peek(json: string): { turn: number; seed: number } | null {
  try {
    const st = deserialize(json);
    return { turn: st.turn, seed: st.seed };
  } catch {
    return null;
  }
}

function tryLoad(key: string): { state: GameState; savedAt: string | null } | null {
  const json = kvGet(key);
  if (!json) return null;
  try {
    const state = deserialize(json);
    if (state.phase.kind === 'gameOver') return null;
    const savedAt = (JSON.parse(json) as { savedAt?: string | null }).savedAt ?? null;
    return { state, savedAt };
  } catch (e) {
    console.warn(`[persist] unreadable save in ${key}`, e);
    return null;
  }
}

function load(): { state: GameState; savedAt: string | null } | null {
  const main = tryLoad(SAVE_KEY);
  if (main) return main;
  const backup = tryLoad(SAVE_BACKUP_KEY);
  if (backup) return backup;
  // Both unusable: drop them so the title screen stops offering "continue".
  if (kvGet(SAVE_KEY) !== null || kvGet(SAVE_BACKUP_KEY) !== null) clearSavedGame();
  return null;
}

export function loadSavedGame(): GameState | null {
  return load()?.state ?? null;
}

export function hasSavedGame(): boolean {
  return load() !== null;
}

export function savedGameSummary(): SavedGameSummary | null {
  const got = load();
  if (!got) return null;
  const { state, savedAt } = got;
  return {
    savedAt,
    round: state.round,
    roundLimit: state.settings.roundLimit,
    players: state.players.map((p) => ({
      name: p.name,
      tokenId: p.tokenId,
      colorId: p.colorId,
      isCpu: p.isCpu,
      bankrupt: p.bankrupt,
    })),
  };
}

export function clearSavedGame(): void {
  lastWritten = null;
  kvRemove(SAVE_KEY);
  kvRemove(SAVE_BACKUP_KEY);
}
