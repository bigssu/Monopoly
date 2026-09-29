/**
 * Pure rule helpers: tolls, costs, values, set victories (독점), ranking.
 */
import {
  CITY_INDICES,
  GROUP_IDS,
  HUB_INDICES,
  PROPERTY_INDICES,
  SIDE_IDS,
  citiesInGroup,
  citiesOnSide,
  isCity,
  isHub,
  priceOf,
  space,
  type GroupId,
  type SideId,
} from './board';
import { ECONOMY } from './economy';
import type {
  GameResult,
  GameState,
  Level,
  PlayerId,
  PropertyState,
  RankingEntry,
  VictoryKind,
} from './types';

/** Round to the nearest 10 (half up). */
export function round10(x: number): number {
  return Math.round(x / 10 + 1e-9) * 10;
}

export function propertyAt(state: GameState, index: number): PropertyState {
  const p = state.properties[index];
  if (!p) throw new RangeError(`Space ${index} is not a property`);
  return p;
}

export function ownerOf(state: GameState, index: number): PlayerId | null {
  return state.properties[index]?.owner ?? null;
}

/** Cost of building `toLevel` (1..4) on a city with the given price. */
export function buildCost(price: number, toLevel: number): number {
  const rate = ECONOMY.buildCostRates[toLevel];
  if (rate === undefined || toLevel < 1) throw new RangeError(`Bad level ${toLevel}`);
  return round10(price * rate);
}

/** Cost of the next level on this city, or null if maxed. */
export function nextBuildCost(state: GameState, index: number): number | null {
  const prop = propertyAt(state, index);
  if (!isCity(index) || prop.level >= ECONOMY.maxLevel) return null;
  return buildCost(priceOf(index), prop.level + 1);
}

/** Property value = price + Σ build costs of the current levels. */
export function valueOf(index: number, level: number): number {
  const price = priceOf(index);
  let v = price;
  for (let l = 1; l <= level; l++) v += buildCost(price, l);
  return v;
}

export function propertyValue(state: GameState, index: number): number {
  return valueOf(index, propertyAt(state, index).level);
}

export function ownedProperties(state: GameState, pid: PlayerId): number[] {
  return PROPERTY_INDICES.filter((i) => state.properties[i]?.owner === pid);
}

export function ownedCities(state: GameState, pid: PlayerId): number[] {
  return CITY_INDICES.filter((i) => state.properties[i]?.owner === pid);
}

export function hubCount(state: GameState, pid: PlayerId): number {
  return HUB_INDICES.filter((i) => state.properties[i]?.owner === pid).length;
}

export function ownsGroup(state: GameState, pid: PlayerId, group: GroupId): boolean {
  return citiesInGroup(group).every((i) => state.properties[i]?.owner === pid);
}

export function completedGroups(state: GameState, pid: PlayerId): GroupId[] {
  return GROUP_IDS.filter((g) => ownsGroup(state, pid, g));
}

export function ownsSide(state: GameState, pid: PlayerId, side: SideId): boolean {
  return citiesOnSide(side).every((i) => state.properties[i]?.owner === pid);
}

/** Toll for landing on a city/hub (before card multipliers and passes). */
export function tollOf(state: GameState, index: number): number {
  const prop = propertyAt(state, index);
  if (prop.owner === null) return 0;
  if (isHub(index)) return ECONOMY.hubTollPerHub * hubCount(state, prop.owner);
  const price = priceOf(index);
  const rate = ECONOMY.tollRates[prop.level] ?? 0;
  let toll = round10(price * rate);
  const group = space(index).group;
  if (prop.level === 0 && group && ownsGroup(state, prop.owner, group)) {
    toll *= ECONOMY.groupLandMultiplier;
  }
  if (state.festival === index) toll *= ECONOMY.festivalMultiplier;
  return toll;
}

/** Toll this city/hub would charge at a hypothetical level (no festival). For AI estimates. */
export function tollAtLevel(state: GameState, index: number, level: number, owner: PlayerId): number {
  if (isHub(index)) return ECONOMY.hubTollPerHub * Math.max(1, hubCount(state, owner));
  return round10(priceOf(index) * (ECONOMY.tollRates[level] ?? 0));
}

export function canBeTakenOver(state: GameState, index: number): boolean {
  const prop = propertyAt(state, index);
  if (prop.owner === null) return false;
  if (isHub(index)) return true;
  return prop.level < ECONOMY.maxLevel;
}

export function takeoverPrice(state: GameState, index: number): number {
  return ECONOMY.takeoverMultiplier * propertyValue(state, index);
}

/** Cash from selling the top building level (levels 1–3 only; landmarks sell whole). */
export function sellBuildingValue(state: GameState, index: number): number | null {
  const prop = propertyAt(state, index);
  if (!isCity(index) || prop.level < 1 || prop.level >= ECONOMY.maxLevel) return null;
  return Math.floor(buildCost(priceOf(index), prop.level) * ECONOMY.sellRate);
}

/** Cash from selling the whole property (land + any buildings) to the bank. */
export function sellPropertyValue(state: GameState, index: number): number {
  return Math.floor(propertyValue(state, index) * ECONOMY.sellRate);
}

/** Maximum cash a player can raise by selling everything. */
export function liquidationValue(state: GameState, pid: PlayerId): number {
  return ownedProperties(state, pid).reduce((sum, i) => sum + sellPropertyValue(state, i), 0);
}

export function propertyAssets(state: GameState, pid: PlayerId): number {
  return ownedProperties(state, pid).reduce((sum, i) => sum + propertyValue(state, i), 0);
}

/** Total assets = cash + property values. */
export function totalAssets(state: GameState, pid: PlayerId): number {
  const p = state.players[pid];
  if (!p) return 0;
  return p.cash + propertyAssets(state, pid);
}

/** Sum of building levels (landmark = 4). */
export function buildingLevels(state: GameState, pid: PlayerId): number {
  return ownedCities(state, pid).reduce((s, i) => s + propertyAt(state, i).level, 0);
}

export function solventPlayers(state: GameState): PlayerId[] {
  return state.players.filter((p) => !p.bankrupt).map((p) => p.id);
}

export interface SetVictory {
  victory: Exclude<VictoryKind, 'lastStanding' | 'bankruptcy' | 'roundLimit'>;
  groups?: GroupId[];
  side?: SideId;
}

/** 독점 victory for this player, if any (triple > line > hubs). */
export function setVictory(state: GameState, pid: PlayerId): SetVictory | null {
  const groups = completedGroups(state, pid);
  if (groups.length >= 3) return { victory: 'triple', groups };
  for (const side of SIDE_IDS) {
    if (ownsSide(state, pid, side)) return { victory: 'line', side };
  }
  if (HUB_INDICES.every((i) => state.properties[i]?.owner === pid)) return { victory: 'hubs' };
  return null;
}

/** Ranking: solvent by assets (tie → cash → cities → earlier seat), then bankrupt (latest first). */
export function ranking(state: GameState): RankingEntry[] {
  const entries = state.players.map((p) => {
    const propertyValue = propertyAssets(state, p.id);
    return {
      playerId: p.id,
      rank: 0,
      cash: p.cash,
      propertyValue,
      totalAssets: p.cash + propertyValue,
      cities: ownedCities(state, p.id).length,
      hubs: hubCount(state, p.id),
      bankrupt: p.bankrupt,
    } satisfies RankingEntry;
  });
  const solvent = entries
    .filter((e) => !e.bankrupt)
    .sort(
      (a, b) =>
        b.totalAssets - a.totalAssets ||
        b.cash - a.cash ||
        b.cities - a.cities ||
        a.playerId - b.playerId,
    );
  const bankrupt = [...state.bankruptOrder]
    .reverse()
    .map((id) => entries.find((e) => e.playerId === id))
    .filter((e): e is RankingEntry => !!e);
  const all = [...solvent, ...bankrupt];
  all.forEach((e, i) => (e.rank = i + 1));
  return all;
}

/** Evaluate the non-round-limit victory conditions. `preferred` is checked first. */
export function findVictory(
  state: GameState,
  preferred: PlayerId = state.current,
): Omit<GameResult, 'ranking' | 'round'> | null {
  const solvent = solventPlayers(state);
  if (solvent.length === 1) return { winnerId: solvent[0]!, victory: 'lastStanding' };
  if (solvent.length === 0) {
    // Cannot normally happen; the last to go bankrupt wins by default.
    return { winnerId: state.bankruptOrder[state.bankruptOrder.length - 1] ?? 0, victory: 'lastStanding' };
  }
  const order = [preferred, ...solvent.filter((p) => p !== preferred)].filter((p) =>
    solvent.includes(p),
  );
  for (const pid of order) {
    const w = setVictory(state, pid);
    if (w) return { winnerId: pid, ...w };
  }
  return null;
}

export interface OneAwayWarning {
  playerId: PlayerId;
  kind: 'group' | 'line' | 'hub';
  id: GroupId | SideId | 'hubs';
  missing: number;
}

/** Every "exactly one property short" situation for solvent players. */
export function oneAwayWarnings(state: GameState): OneAwayWarning[] {
  const out: OneAwayWarning[] = [];
  const check = (
    pid: PlayerId,
    kind: OneAwayWarning['kind'],
    id: OneAwayWarning['id'],
    members: readonly number[],
  ) => {
    const missing = members.filter((i) => state.properties[i]?.owner !== pid);
    if (missing.length === 1) out.push({ playerId: pid, kind, id, missing: missing[0]! });
  };
  for (const p of state.players) {
    if (p.bankrupt) continue;
    for (const g of GROUP_IDS) check(p.id, 'group', g, citiesInGroup(g));
    for (const sd of SIDE_IDS) check(p.id, 'line', sd, citiesOnSide(sd));
    check(p.id, 'hub', 'hubs', HUB_INDICES);
  }
  return out;
}

export function oneAwayKey(w: OneAwayWarning): string {
  return `${w.playerId}:${w.kind}:${w.id}:${w.missing}`;
}

export function levelOf(state: GameState, index: number): Level {
  return propertyAt(state, index).level;
}
