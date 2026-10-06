/**
 * Pure rule helpers: tolls, costs, values, set victories (독점), ranking.
 */
import {
  GROUP_IDS,
  SIDE_IDS,
  citiesInGroup,
  citiesOnSide,
  getBoardInfo,
  isCity,
  isHub,
  priceOf,
  space,
  type GroupId,
  type SideId,
} from './board';
import { ECONOMY } from './economy';
import { ruleFlags } from './settings';
import type {
  GameResult,
  GameState,
  NewsId,
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

/** Cost of building `toLevel` (1..4) on a city with the given price. */
export function buildCost(price: number, toLevel: number): number {
  const rate = ECONOMY.buildCostRates[toLevel];
  if (rate === undefined || toLevel < 1) throw new RangeError(`Bad level ${toLevel}`);
  return round10(price * rate);
}

/** Cost of the next level on this city, or null if maxed (half price in a "build boom" news round). */
export function nextBuildCost(state: GameState, index: number): number | null {
  const prop = propertyAt(state, index);
  if (!isCity(index, state.settings.spacesPerSide ?? 7) || prop.level >= ECONOMY.maxLevel) return null;
  const cost = buildCost(priceOf(index, state.settings.spacesPerSide ?? 7), prop.level + 1);
  return newsActive(state, 'buildBoom') ? round10(cost * ECONOMY.newsBuildRate) : cost;
}

/** The news flash headline in force this round (rules version 2), if it is `id`. */
function newsActive(state: GameState, id: NewsId): boolean {
  return state.news?.id === id && state.news.round === state.round && ruleFlags(state.settings).newsFlash;
}

/** Property value = price + Σ build costs of the current levels. */
export function valueOf(index: number, level: number, spacesPerSide: 7 | 8 | 9 = 7): number {
  const price = priceOf(index, spacesPerSide);
  let v = price;
  for (let l = 1; l <= level; l++) v += buildCost(price, l);
  return v;
}

export function propertyValue(state: GameState, index: number): number {
  return valueOf(index, propertyAt(state, index).level, state.settings.spacesPerSide ?? 7);
}

export function ownedProperties(state: GameState, pid: PlayerId): number[] {
  return getBoardInfo(state.settings.spacesPerSide ?? 7).propertyIndices.filter((i) => state.properties[i]?.owner === pid);
}

export function ownedCities(state: GameState, pid: PlayerId): number[] {
  return getBoardInfo(state.settings.spacesPerSide ?? 7).cityIndices.filter((i) => state.properties[i]?.owner === pid);
}

export function hubCount(state: GameState, pid: PlayerId): number {
  return getBoardInfo(state.settings.spacesPerSide ?? 7).hubIndices.filter((i) => state.properties[i]?.owner === pid).length;
}

export function ownsGroup(state: GameState, pid: PlayerId, group: GroupId): boolean {
  return citiesInGroup(group, state.settings.spacesPerSide ?? 7).every((i) => state.properties[i]?.owner === pid);
}

export function completedGroups(state: GameState, pid: PlayerId): GroupId[] {
  return GROUP_IDS.filter((g) => ownsGroup(state, pid, g));
}

function ownsSide(state: GameState, pid: PlayerId, side: SideId): boolean {
  return citiesOnSide(side, state.settings.spacesPerSide ?? 7).every((i) => state.properties[i]?.owner === pid);
}

/** Toll for landing on a city/hub (before card multipliers and passes). */
export function tollOf(state: GameState, index: number): number {
  const prop = propertyAt(state, index);
  if (prop.owner === null) return 0;
  const news = newsActive(state, 'tollFever') ? ECONOMY.newsTollMultiplier : 1;
  if (isHub(index, state.settings.spacesPerSide ?? 7)) {
    return Math.round(ECONOMY.hubTollPerHub * hubCount(state, prop.owner) * hubStep(state, index) * lateTollMultiplier(state)) * news;
  }
  const price = priceOf(index, state.settings.spacesPerSide ?? 7);
  const rate = ECONOMY.tollRates[prop.level] ?? 0;
  let toll = round10(price * rate);
  const group = space(index, state.settings.spacesPerSide ?? 7).group;
  if (prop.level === 0 && group && ownsGroup(state, prop.owner, group)) {
    toll *= ECONOMY.groupLandMultiplier;
  }
  if (state.festival === index) toll *= festivalMultiplier(state);
  return round10(toll * lateTollMultiplier(state)) * news;
}

/** Festival multiplier: ×2, or the grand festival level's multiplier when that rule is on. */
export function festivalMultiplier(state: GameState): number {
  if (!ruleFlags(state.settings).grandFestival) return ECONOMY.festivalMultiplier;
  const level = Math.min(ECONOMY.grandFestivalMultipliers.length, Math.max(1, state.festivalLevel ?? 1));
  return ECONOMY.grandFestivalMultipliers[level - 1]!;
}

/** Late toll (rules ≥ normal, round limit only): ×1.25 … ×2.25 over the last five rounds. */
export function lateTollMultiplier(state: GameState): number {
  const limit = state.settings.roundLimit;
  if (!limit || !ruleFlags(state.settings).lateToll) return 1;
  const left = limit - state.round;
  if (left >= ECONOMY.lateTollRounds) return 1;
  return 1 + ECONOMY.lateTollStep * (ECONOMY.lateTollRounds - Math.max(0, left));
}

/** The final stretch: the late-toll rounds (rules ≥ normal) or, on easy, the last three rounds. */
export function isFinalStretch(state: GameState): boolean {
  const limit = state.settings.roundLimit;
  if (!limit) return false;
  return state.round >= limit - (ruleFlags(state.settings).lateToll ? ECONOMY.lateTollRounds - 1 : 2);
}

/** Hub growth step ×1..×4 (rules = advanced); steps belong to the owner who earned them. */
export function hubStep(state: GameState, index: number): number {
  if (!ruleFlags(state.settings).hubGrowth) return 1;
  const v = state.hubVisits?.[index];
  const owner = state.properties[index]?.owner;
  if (!v || v.owner !== owner) return 1;
  return Math.min(ECONOMY.hubGrowthMax, 1 + v.n);
}

/** Toll this city/hub would charge at a hypothetical level (no festival). For AI estimates. */
export function tollAtLevel(state: GameState, index: number, level: number, owner: PlayerId): number {
  if (isHub(index, state.settings.spacesPerSide ?? 7)) return ECONOMY.hubTollPerHub * Math.max(1, hubCount(state, owner));
  return round10(priceOf(index, state.settings.spacesPerSide ?? 7) * (ECONOMY.tollRates[level] ?? 0));
}

export function canBeTakenOver(state: GameState, index: number): boolean {
  const prop = propertyAt(state, index);
  if (prop.owner === null) return false;
  if (isHub(index, state.settings.spacesPerSide ?? 7)) return true;
  return prop.level < ECONOMY.maxLevel;
}

/**
 * Takeover price: 2 × value; 1.5 × in a "takeover sale" news round; 1 × for a win-back (rules =
 * advanced) — `buyer` lost this city to its owner in a takeover.
 */
export function takeoverPrice(state: GameState, index: number, buyer?: PlayerId): number {
  const value = propertyValue(state, index);
  if (buyer !== undefined && isWinBack(state, index, buyer)) return round10(ECONOMY.winBackMultiplier * value);
  if (newsActive(state, 'takeoverSale')) return round10(ECONOMY.newsTakeoverMultiplier * value);
  return ECONOMY.takeoverMultiplier * value;
}

/** Win-back: `buyer` lost the city at `index` in a takeover and its taker still owns it. */
export function isWinBack(state: GameState, index: number, buyer: PlayerId): boolean {
  if (!ruleFlags(state.settings).winBack) return false;
  const t = state.takenFrom?.[index];
  return !!t && t.from === buyer && t.by === state.properties[index]?.owner;
}

/** Cash from selling the top building level (levels 1–3 only; landmarks sell whole). */
export function sellBuildingValue(state: GameState, index: number): number | null {
  const prop = propertyAt(state, index);
  if (!isCity(index, state.settings.spacesPerSide ?? 7) || prop.level < 1 || prop.level >= ECONOMY.maxLevel) return null;
  return Math.floor(buildCost(priceOf(index, state.settings.spacesPerSide ?? 7), prop.level) * ECONOMY.sellRate);
}

/** Cash from selling the whole property (land + any buildings) to the bank. */
export function sellPropertyValue(state: GameState, index: number): number {
  return Math.floor(propertyValue(state, index) * ECONOMY.sellRate);
}

/** Maximum cash a player can raise by selling everything. */
export function liquidationValue(state: GameState, pid: PlayerId): number {
  return ownedProperties(state, pid).reduce((sum, i) => sum + sellPropertyValue(state, i), 0);
}

function propertyAssets(state: GameState, pid: PlayerId): number {
  return ownedProperties(state, pid).reduce((sum, i) => sum + propertyValue(state, i), 0);
}

/** Total assets = cash + property values. */
export function totalAssets(state: GameState, pid: PlayerId): number {
  const p = state.players[pid];
  if (!p) return 0;
  return p.cash + propertyAssets(state, pid);
}

function solventPlayers(state: GameState): PlayerId[] {
  return state.players.filter((p) => !p.bankrupt).map((p) => p.id);
}

interface SetVictory {
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
  if (getBoardInfo(state.settings.spacesPerSide ?? 7).hubIndices.every((i) => state.properties[i]?.owner === pid)) return { victory: 'hubs' };
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
    for (const g of GROUP_IDS) check(p.id, 'group', g, citiesInGroup(g, state.settings.spacesPerSide ?? 7));
    for (const sd of SIDE_IDS) check(p.id, 'line', sd, citiesOnSide(sd, state.settings.spacesPerSide ?? 7));
    check(p.id, 'hub', 'hubs', getBoardInfo(state.settings.spacesPerSide ?? 7).hubIndices);
  }
  return out;
}

export function oneAwayKey(w: OneAwayWarning): string {
  return `${w.playerId}:${w.kind}:${w.id}:${w.missing}`;
}

