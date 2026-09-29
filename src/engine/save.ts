/**
 * Save / load: versioned JSON.
 */
import type { GameState } from './types';

export const SAVE_FORMAT = 'lot-and-roll-save';
export const SAVE_VERSION = 1;

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  version: number;
  /** ISO timestamp supplied by the caller (the engine never reads the clock). */
  savedAt: string | null;
  state: GameState;
}

export class SaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveError';
  }
}

export function serialize(state: GameState, savedAt: string | null = null): string {
  const file: SaveFile = { format: SAVE_FORMAT, version: SAVE_VERSION, savedAt, state };
  return JSON.stringify(file);
}

/** Upgrade older save files here (none yet). */
function migrate(file: SaveFile): SaveFile {
  return file;
}

export function deserialize(json: string): GameState {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new SaveError('Save data is not valid JSON');
  }
  if (!raw || typeof raw !== 'object') throw new SaveError('Save data is not an object');
  const file = raw as Partial<SaveFile>;
  if (file.format !== SAVE_FORMAT) throw new SaveError('Not a Lot & Roll save file');
  if (typeof file.version !== 'number') throw new SaveError('Save file has no version');
  if (file.version > SAVE_VERSION) throw new SaveError(`Save version ${file.version} is newer than supported (${SAVE_VERSION})`);
  const migrated = migrate(file as SaveFile);
  const st = migrated.state as Partial<GameState> | undefined;
  if (
    !st ||
    st.schema !== 1 ||
    !Array.isArray(st.players) ||
    !Array.isArray(st.properties) ||
    st.properties.length !== 32 ||
    !st.phase ||
    typeof st.phase !== 'object' ||
    typeof st.rng !== 'number'
  ) {
    throw new SaveError('Save file state is malformed');
  }
  return migrated.state;
}

/** Read `savedAt` without fully loading (for the title screen's "continue"). */
export function peekSave(json: string): { savedAt: string | null; round: number; players: string[] } | null {
  try {
    const st = deserialize(json);
    const file = JSON.parse(json) as SaveFile;
    return { savedAt: file.savedAt, round: st.round, players: st.players.map((p) => p.name) };
  } catch {
    return null;
  }
}
