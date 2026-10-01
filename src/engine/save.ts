/**
 * Save / load: versioned JSON.
 */
import type { GameState } from './types';
import { getBoardInfo } from './board';

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

/** Add the original board size to v1 saves that predate the board-size option. */
function migrate(file: SaveFile): SaveFile {
  if (file.state?.settings && file.state.settings.spacesPerSide === undefined) file.state.settings.spacesPerSide = 7;
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
    !st.phase ||
    typeof st.phase !== 'object' ||
    typeof st.rng !== 'number'
  ) {
    throw new SaveError('Save file state is malformed');
  }
  const size = (st.settings?.spacesPerSide ?? 7) as 7 | 8 | 9;
  if (size !== 7 && size !== 8 && size !== 9) throw new SaveError('Save file has an invalid board size');
  const board = getBoardInfo(size);
  if (st.properties.length !== board.size) throw new SaveError('Save properties do not match board size');
  if (!st.properties.every((property, index) => (board.propertyIndices.includes(index) ? property !== null : property === null))) {
    throw new SaveError('Save properties are not placed on property spaces');
  }
  if (!st.players.every((p) => Number.isInteger(p.position) && p.position >= 0 && p.position < board.size)) throw new SaveError('Save player position is invalid');
  if (st.festival !== null && (!Number.isInteger(st.festival) || !board.cityIndices.includes(st.festival as number))) throw new SaveError('Save festival is invalid');
  const phase = st.phase as Record<string, unknown>;
  const indexes: number[] = [];
  if (typeof phase.spaceIndex === 'number') indexes.push(phase.spaceIndex);
  if (Array.isArray(phase.options)) indexes.push(...phase.options.filter((x): x is number => typeof x === 'number'));
  if (phase.kind === 'debt' && phase.then && typeof phase.then === 'object' && typeof (phase.then as { spaceIndex?: unknown }).spaceIndex === 'number') indexes.push((phase.then as { spaceIndex: number }).spaceIndex);
  if (phase.kind === 'debt' && phase.toll && typeof phase.toll === 'object' && typeof (phase.toll as { spaceIndex?: unknown }).spaceIndex === 'number') indexes.push((phase.toll as { spaceIndex: number }).spaceIndex);
  if (!indexes.every((i) => Number.isInteger(i) && i >= 0 && i < board.size)) throw new SaveError('Save phase refers to an invalid space');
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
