/**
 * Board helpers over the content table (`src/content/board.ts`).
 */
import { BOARD, GROUP_IDS, SIDE_IDS, getBoard, type GroupId, type SideId, type SpaceDef, type SpacesPerSide } from '../content/board';

export {
  BOARD,
  BOARD_SIZE,
  GROUP_IDS,
  SIDE_IDS,
  START_INDEX,
  ISLAND_INDEX,
  FESTIVAL_INDEX,
  TRAVEL_INDEX, getBoard,
} from '../content/board';
export type { GroupId, SideId, SpaceDef, SpaceKind, SpacesPerSide } from '../content/board';

export interface BoardInfo {
  board: readonly SpaceDef[]; size: number; spacesPerSide: SpacesPerSide;
  startIndex: number; islandIndex: number; festivalIndex: number; travelIndex: number;
  propertyIndices: readonly number[]; cityIndices: readonly number[]; hubIndices: readonly number[]; eventIndices: readonly number[];
}
const INFOS = new Map<SpacesPerSide, BoardInfo>();
interface Derived { groups: Readonly<Record<GroupId, readonly number[]>>; sides: Readonly<Record<SideId, readonly number[]>>; }
const DERIVED = new Map<SpacesPerSide, Derived>();
export function getBoardInfo(spacesPerSide: SpacesPerSide = 7): BoardInfo {
  let result = INFOS.get(spacesPerSide);
  if (result) return result;
  const board = getBoard(spacesPerSide);
  const corner = (kind: SpaceDef['kind']) => board.find((s) => s.kind === kind)!.index;
  result = { board, size: board.length, spacesPerSide, startIndex: corner('start'), islandIndex: corner('island'), festivalIndex: corner('festival'), travelIndex: corner('travel'),
    propertyIndices: board.filter((s) => s.kind === 'city' || s.kind === 'hub').map((s) => s.index), cityIndices: board.filter((s) => s.kind === 'city').map((s) => s.index), hubIndices: board.filter((s) => s.kind === 'hub').map((s) => s.index), eventIndices: board.filter((s) => s.kind === 'event').map((s) => s.index) };
  INFOS.set(spacesPerSide, result); return result;
}
function derived(spacesPerSide: SpacesPerSide): Derived {
  let result = DERIVED.get(spacesPerSide);
  if (result) return result;
  const board = getBoardInfo(spacesPerSide);
  result = {
    groups: Object.fromEntries(GROUP_IDS.map((group) => [group, board.cityIndices.filter((index) => groupOf(index, spacesPerSide) === group)])) as unknown as Record<GroupId, readonly number[]>,
    sides: Object.fromEntries(SIDE_IDS.map((side) => [side, board.cityIndices.filter((index) => sideOf(index, spacesPerSide) === side)])) as unknown as Record<SideId, readonly number[]>,
  };
  DERIVED.set(spacesPerSide, result); return result;
}

export function space(index: number, spacesPerSide: SpacesPerSide = 7): SpaceDef {
  const s = getBoardInfo(spacesPerSide).board[index];
  if (!s) throw new RangeError(`No space at index ${index}`);
  return s;
}

export function isProperty(index: number, spacesPerSide: SpacesPerSide = 7): boolean {
  const k = space(index, spacesPerSide).kind;
  return k === 'city' || k === 'hub';
}

export function isCity(index: number, spacesPerSide: SpacesPerSide = 7): boolean {
  return space(index, spacesPerSide).kind === 'city';
}

export function isHub(index: number, spacesPerSide: SpacesPerSide = 7): boolean {
  return space(index, spacesPerSide).kind === 'hub';
}

export function priceOf(index: number, spacesPerSide: SpacesPerSide = 7): number {
  const p = space(index, spacesPerSide).price;
  if (p === null) throw new RangeError(`Space ${index} is not purchasable`);
  return p;
}

export function groupOf(index: number, spacesPerSide: SpacesPerSide = 7): GroupId | null {
  return space(index, spacesPerSide).group;
}

export function sideOf(index: number, spacesPerSide: SpacesPerSide = 7): SideId | null {
  return space(index, spacesPerSide).side;
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

export function citiesInGroup(group: GroupId, spacesPerSide: SpacesPerSide = 7): readonly number[] {
  return spacesPerSide === 7 ? GROUP_MEMBERS[group] : derived(spacesPerSide).groups[group];
}

export function citiesOnSide(side: SideId, spacesPerSide: SpacesPerSide = 7): readonly number[] {
  return spacesPerSide === 7 ? SIDE_CITIES[side] : derived(spacesPerSide).sides[side];
}

/** Forward (clockwise) distance from `from` to `to`, in 0..31. */
export function distance(from: number, to: number, spacesPerSide: SpacesPerSide = 7): number {
  const size = getBoardInfo(spacesPerSide).size;
  return (((to - from) % size) + size) % size;
}

/** Wrap an index onto the board. */
export function wrap(index: number, spacesPerSide: SpacesPerSide = 7): number {
  const size = getBoardInfo(spacesPerSide).size;
  return ((index % size) + size) % size;
}

/** Indexes visited when walking `steps` spaces (excludes the start, includes the end). */
export function walkPath(from: number, steps: number, spacesPerSide: SpacesPerSide = 7): number[] {
  const path: number[] = [];
  const dir = steps >= 0 ? 1 : -1;
  for (let i = 1; i <= Math.abs(steps); i++) path.push(wrap(from + dir * i, spacesPerSide));
  return path;
}

/** Nearest hub strictly ahead of `from` (clockwise). */
export function nearestHubAhead(from: number, spacesPerSide: SpacesPerSide = 7): number {
  let best = -1;
  let bestD = Infinity;
  for (const h of getBoardInfo(spacesPerSide).hubIndices) {
    const d = distance(from, h, spacesPerSide) || getBoardInfo(spacesPerSide).size;
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  return best;
}
