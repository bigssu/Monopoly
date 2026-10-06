/**
 * What a seat panel lists under its header: the spaces that player owns, nothing else
 * (DESIGN §6 "Player panel"). Pure: state in, chips out.
 *
 * Order: colour groups in board order (each group's cities in board order), hubs last, so the
 * cities of one colour sit side by side even where a hub interrupts them on the board.
 */
import { GROUP_IDS, citiesInGroup, getBoardInfo, type GameState, type GroupId, type Level, type PlayerId, type SpacesPerSide } from '@/engine';

export interface OwnedChip {
  index: number;
  kind: 'city' | 'hub';
  /** Colour group, or 'hubs'. */
  group: GroupId | 'hubs';
  level: Level;
  /** The player owns every member of this chip's group (every hub, for a hub). */
  complete: boolean;
  /** The festival marker is on this city. */
  festival: boolean;
}

export function ownedChips(state: GameState, pid: PlayerId): OwnedChip[] {
  const size = (state.settings.spacesPerSide ?? 7) as SpacesPerSide;
  const sets: Array<[GroupId | 'hubs', readonly number[]]> = [...GROUP_IDS.map((g): [GroupId, readonly number[]] => [g, citiesInGroup(g, size)]), ['hubs', getBoardInfo(size).hubIndices]];
  const out: OwnedChip[] = [];
  for (const [group, members] of sets) {
    const mine = members.filter((i) => state.properties[i]?.owner === pid);
    const complete = mine.length > 0 && mine.length === members.length;
    for (const i of mine) {
      out.push({ index: i, kind: group === 'hubs' ? 'hub' : 'city', group, level: state.properties[i]!.level, complete, festival: state.festival === i });
    }
  }
  return out;
}

/**
 * Chip size (px) for `n` chips wrapping in rows of an `inner`-wide area at most `avail` tall:
 * the largest size from `max` down to `min` whose rows fit (else `min`). Gap = 16 % of the size (room for the gold rims).
 */
export function chipSize(n: number, inner: number, avail: number, max: number, min: number): { size: number; gap: number; perRow: number; rows: number } {
  const fit = (s: number) => {
    const gap = Math.max(3, Math.round(s * 0.16));
    const perRow = Math.max(1, Math.floor((inner + gap) / (s + gap)));
    const rows = Math.ceil(n / perRow);
    return { size: s, gap, perRow, rows, h: rows * (s + gap) - gap };
  };
  const hi = Math.max(min, Math.floor(max));
  for (let s = hi; s > min; s--) {
    const f = fit(s);
    if (f.h <= avail) return { size: f.size, gap: f.gap, perRow: f.perRow, rows: f.rows };
  }
  const f = fit(min);
  return { size: f.size, gap: f.gap, perRow: f.perRow, rows: f.rows };
}
