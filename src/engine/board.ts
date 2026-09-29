/**
 * Board helpers over the content table (`src/content/board.ts`).
 */
import {
  BOARD,
  BOARD_SIZE,
  GROUP_IDS,
  SIDE_IDS,
  type GroupId,
  type SideId,
  type SpaceDef,
} from '../content/board';

export {
  BOARD,
  BOARD_SIZE,
  GROUP_IDS,
  SIDE_IDS,
  START_INDEX,
  ISLAND_INDEX,
  FESTIVAL_INDEX,
  TRAVEL_INDEX,
} from '../content/board';
export type { GroupId, SideId, SpaceDef, SpaceKind } from '../content/board';

export function space(index: number): SpaceDef {
  const s = BOARD[index];
  if (!s) throw new RangeError(`No space at index ${index}`);
  return s;
}

export function isProperty(index: number): boolean {
  const k = space(index).kind;
  return k === 'city' || k === 'hub';
}

export function isCity(index: number): boolean {
  return space(index).kind === 'city';
}

export function isHub(index: number): boolean {
  return space(index).kind === 'hub';
}

export function priceOf(index: number): number {
  const p = space(index).price;
  if (p === null) throw new RangeError(`Space ${index} is not purchasable`);
  return p;
}

export function groupOf(index: number): GroupId | null {
  return space(index).group;
}

export function sideOf(index: number): SideId | null {
  return space(index).side;
}

export const PROPERTY_INDICES: readonly number[] = BOARD.filter(
  (s) => s.kind === 'city' || s.kind === 'hub',
).map((s) => s.index);

export const CITY_INDICES: readonly number[] = BOARD.filter((s) => s.kind === 'city').map(
  (s) => s.index,
);

export const HUB_INDICES: readonly number[] = BOARD.filter((s) => s.kind === 'hub').map(
  (s) => s.index,
);

export const EVENT_INDICES: readonly number[] = BOARD.filter((s) => s.kind === 'event').map(
  (s) => s.index,
);

const GROUP_MEMBERS: Readonly<Record<GroupId, readonly number[]>> = Object.fromEntries(
  GROUP_IDS.map((g) => [g, CITY_INDICES.filter((i) => groupOf(i) === g)]),
) as unknown as Record<GroupId, readonly number[]>;

/** Cities on each side (라인 독점 counts cities only). */
const SIDE_CITIES: Readonly<Record<SideId, readonly number[]>> = Object.fromEntries(
  SIDE_IDS.map((sd) => [sd, CITY_INDICES.filter((i) => sideOf(i) === sd)]),
) as unknown as Record<SideId, readonly number[]>;

export function citiesInGroup(group: GroupId): readonly number[] {
  return GROUP_MEMBERS[group];
}

export function citiesOnSide(side: SideId): readonly number[] {
  return SIDE_CITIES[side];
}

/** Forward (clockwise) distance from `from` to `to`, in 0..31. */
export function distance(from: number, to: number): number {
  return (((to - from) % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
}

/** Wrap an index onto the board. */
export function wrap(index: number): number {
  return ((index % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
}

/** Indexes visited when walking `steps` spaces (excludes the start, includes the end). */
export function walkPath(from: number, steps: number): number[] {
  const path: number[] = [];
  const dir = steps >= 0 ? 1 : -1;
  for (let i = 1; i <= Math.abs(steps); i++) path.push(wrap(from + dir * i));
  return path;
}

/** Nearest hub strictly ahead of `from` (clockwise). */
export function nearestHubAhead(from: number): number {
  let best = -1;
  let bestD = Infinity;
  for (const h of HUB_INDICES) {
    const d = distance(from, h) || BOARD_SIZE;
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  return best;
}
