/**
 * Heuristic CPU player (DESIGN §5).
 *
 * `chooseAction(state, playerId)` is deterministic (no randomness) and always returns a
 * legal action for the current phase. Heuristics (normal level):
 *  - buy if cash after ≥ 1.5 × average toll exposure; always try to complete groups / sides /
 *    the hub set and to block an opponent who is one property away;
 *  - take over when it completes a set of ours or breaks/blocks an opponent's set;
 *  - build when cash ≥ 2 × cost;
 *  - sell cheapest first when in debt;
 *  - pay island bail when cash ≥ 800 (use an escape card first).
 * `easy` is more timid and never plans takeovers or travel destinations.
 */
import {
  citiesInGroup,
  citiesOnSide,
  distance,
  getBoardInfo,
  groupOf,
  isCity,
  isHub,
  priceOf,
  sideOf,
  space,
  START_INDEX,
} from './board';
import { ECONOMY } from './economy';
import { defaultAction, legalActions, saleOptions } from './reducer';
import {
  completedGroups,
  nextBuildCost,
  ownedCities,
  propertyAt,
  takeoverPrice,
  tollAtLevel,
  tollOf,
} from './rules';
import type { Action, GameState, PlayerId } from './types';

/** Average toll a player currently risks when landing on an opponent's property. */
export function tollExposure(state: GameState, pid: PlayerId): number {
  const tolls: number[] = [];
  for (const i of getBoardInfo(state.settings.spacesPerSide ?? 7).propertyIndices) {
    const pr = state.properties[i]!;
    if (pr.owner !== null && pr.owner !== pid) tolls.push(tollOf(state, i));
  }
  if (tolls.length === 0) return 0;
  return tolls.reduce((a, b) => a + b, 0) / tolls.length;
}

function maxExposure(state: GameState, pid: PlayerId): number {
  let m = 0;
  for (const i of getBoardInfo(state.settings.spacesPerSide ?? 7).propertyIndices) {
    const pr = state.properties[i]!;
    if (pr.owner !== null && pr.owner !== pid) m = Math.max(m, tollOf(state, i));
  }
  return m;
}

/** Sets (group / side / hubs) the property belongs to. */
function setsOf(state: GameState, idx: number): number[][] {
  const out: number[][] = [];
  const size = state.settings.spacesPerSide ?? 7;
  if (isHub(idx, size)) out.push([...getBoardInfo(size).hubIndices]);
  const g = groupOf(idx, size);
  if (g) out.push([...citiesInGroup(g, size)]);
  const sd = sideOf(idx, size);
  if (sd && isCity(idx, size)) out.push([...citiesOnSide(sd, size)]);
  return out;
}

/** Would owning `idx` complete a set for `pid`? */
function completesSet(state: GameState, pid: PlayerId, idx: number): boolean {
  return setsOf(state, idx).some((set) => set.every((i) => i === idx || state.properties[i]!.owner === pid));
}

/** Would `pid` owning `idx` win the game outright? */
function winsGame(state: GameState, pid: PlayerId, idx: number): boolean {
  const owns = (i: number) => i === idx || state.properties[i]!.owner === pid;
  const size = state.settings.spacesPerSide ?? 7;
  if (getBoardInfo(size).hubIndices.every(owns)) return true;
  for (const sd of ['A', 'B', 'C', 'D'] as const) if (citiesOnSide(sd, size).every(owns)) return true;
  const groups = new Set(completedGroups(state, pid));
  const g = groupOf(idx, size);
  if (g && citiesInGroup(g, size).every(owns)) groups.add(g);
  return groups.size >= 3;
}

/** How many properties of the set around `idx` does `pid` already own (fraction). */
function setProgress(state: GameState, pid: PlayerId, idx: number): number {
  let best = 0;
  for (const set of setsOf(state, idx)) {
    const owned = set.filter((i) => i !== idx && state.properties[i]!.owner === pid).length;
    best = Math.max(best, owned / (set.length - 1 || 1));
  }
  return best;
}

/** Does taking `idx` away from / denying it to an opponent block a set of theirs? */
function blocksOpponent(state: GameState, pid: PlayerId, idx: number): { blocks: boolean; stopsWin: boolean } {
  let blocks = false;
  let stopsWin = false;
  for (const q of state.players) {
    if (q.id === pid || q.bankrupt) continue;
    // Owner of idx (takeover case) or opponent who wants idx (buy case).
    if (winsGame(state, q.id, idx)) stopsWin = true;
    for (const set of setsOf(state, idx)) {
      const others = set.filter((i) => i !== idx);
      const owned = others.filter((i) => state.properties[i]!.owner === q.id).length;
      if (owned >= Math.max(1, others.length - 1)) blocks = true;
    }
  }
  return { blocks, stopsWin };
}

function reserveFor(state: GameState, pid: PlayerId): number {
  return 1.5 * tollExposure(state, pid);
}

function pickBest<T>(items: T[], score: (t: T) => number): T | undefined {
  let best: T | undefined;
  let bestS = -Infinity;
  for (const it of items) {
    const s = score(it);
    if (s > bestS) {
      bestS = s;
      best = it;
    }
  }
  return best;
}

function toll10Gain(state: GameState, idx: number): number {
  const pr = propertyAt(state, idx);
  if (!isCity(idx, state.settings.spacesPerSide ?? 7) || pr.level >= ECONOMY.maxLevel) return 0;
  return tollAtLevel(state, idx, pr.level + 1, pr.owner ?? 0) - tollAtLevel(state, idx, pr.level, pr.owner ?? 0);
}

function travelScore(state: GameState, pid: PlayerId, target: number): number {
  const p = state.players[pid]!;
  const size = state.settings.spacesPerSide ?? 7;
  const sp = space(target, size);
  const crossesStart = distance(p.position, target, size) + p.position >= getBoardInfo(size).size || target === START_INDEX;
  let score = crossesStart ? 30 : 0;
  switch (sp.kind) {
    case 'start':
      return score + 60 + state.pot / 4;
    case 'city':
    case 'hub': {
      const pr = propertyAt(state, target);
      if (pr.owner === null) {
        const price = priceOf(target, size);
        if (p.cash < price) return -1;
        if (winsGame(state, pid, target)) return 1000;
        score += 100 + price / 10;
        if (completesSet(state, pid, target)) score += 300;
        if (blocksOpponent(state, pid, target).stopsWin) score += 400;
        return score;
      }
      if (pr.owner === pid) {
        const cost = nextBuildCost(state, target);
        if (cost !== null && p.cash >= 2 * cost) return score + 60 + toll10Gain(state, target) / 5;
        return score + 5;
      }
      // Opponent property: only worth it for a winning takeover.
      const cost = tollOf(state, target) + takeoverPrice(state, target);
      const canTake =
        state.settings.takeover &&
        pr.level < ECONOMY.maxLevel &&
        !state.players[pr.owner]!.cards.includes('shield') &&
        p.cash >= cost;
      if (canTake && winsGame(state, pid, target)) return 900;
      return -tollOf(state, target);
    }
    case 'festival':
      return ownedCities(state, pid).length > 0 ? score + 40 : score;
    case 'event':
      return score + 20;
    case 'tax':
      return score - p.cash * ECONOMY.taxRate;
    case 'donation':
      return score - ECONOMY.donation;
    default:
      return score;
  }
}

/** Choose an action for `playerId` in the current phase. Always legal. */
export function chooseAction(state: GameState, playerId: PlayerId): Action {
  const ph = state.phase;
  if (ph.kind === 'gameOver') throw new Error('Game is over');
  if (ph.playerId !== playerId) throw new Error(`Not player ${playerId}'s decision`);
  const p = state.players[playerId]!;
  const easy = p.cpuLevel === 'easy';
  const pass: Action = { type: 'Pass', playerId };
  const legal = legalActions(state);
  const can = (t: Action['type']) => legal.some((a) => a.type === t);

  switch (ph.kind) {
    case 'preRoll': {
      const builds = legal.filter((a): a is Extract<Action, { type: 'Build' }> => a.type === 'Build');
      const good = builds.filter((a) => p.cash >= 2 * (nextBuildCost(state, a.spaceIndex) ?? Infinity));
      const best = pickBest(good, (a) => toll10Gain(state, a.spaceIndex));
      if (best && !easy) return best;
      return { type: 'Roll', playerId };
    }

    case 'island':
      if (can('UseEscapeCard')) return { type: 'UseEscapeCard', playerId };
      if (can('PayBail') && p.cash >= (easy ? 1200 : 800)) return { type: 'PayBail', playerId };
      return { type: 'Roll', playerId };

    case 'travel': {
      if (easy) return pass;
      const best = pickBest(ph.options, (i) => travelScore(state, playerId, i));
      if (best !== undefined && travelScore(state, playerId, best) > 0) {
        return { type: 'ChooseTravel', playerId, spaceIndex: best };
      }
      return pass;
    }

    case 'buy': {
      if (!can('Buy')) return pass;
      const after = p.cash - ph.price;
      if (easy) return after >= 300 ? { type: 'Buy', playerId } : pass;
      if (winsGame(state, playerId, ph.spaceIndex)) return { type: 'Buy', playerId };
      const { stopsWin, blocks } = blocksOpponent(state, playerId, ph.spaceIndex);
      if (stopsWin) return { type: 'Buy', playerId };
      const reserve = reserveFor(state, playerId);
      if (completesSet(state, playerId, ph.spaceIndex) || blocks) {
        return after >= reserve * 0.5 ? { type: 'Buy', playerId } : pass;
      }
      return after >= reserve ? { type: 'Buy', playerId } : pass;
    }

    case 'build': {
      if (!can('Build')) return pass;
      const factor = easy ? 3 : 2;
      return p.cash >= factor * ph.cost ? { type: 'Build', playerId, spaceIndex: ph.spaceIndex } : pass;
    }

    case 'takeover': {
      if (!can('Takeover') || ph.ownerHasShield) return pass;
      const after = p.cash - ph.price;
      if (winsGame(state, playerId, ph.spaceIndex)) return { type: 'Takeover', playerId };
      if (easy) {
        return completesSet(state, playerId, ph.spaceIndex) && after >= 500 ? { type: 'Takeover', playerId } : pass;
      }
      const reserve = Math.max(reserveFor(state, playerId), maxExposure(state, playerId) * 0.5);
      const { blocks, stopsWin } = blocksOpponent(state, playerId, ph.spaceIndex);
      if (stopsWin && after >= 0) return { type: 'Takeover', playerId };
      const mine = completesSet(state, playerId, ph.spaceIndex) || setProgress(state, playerId, ph.spaceIndex) >= 0.5;
      if ((mine || blocks) && after >= reserve) return { type: 'Takeover', playerId };
      return pass;
    }

    case 'festival': {
      const best = pickBest(ph.options, (i) => tollOf(state, i) * 10 + priceOf(i, state.settings.spacesPerSide ?? 7) / 100);
      return best !== undefined ? { type: 'SetFestival', playerId, spaceIndex: best } : pass;
    }

    case 'freeUpgrade': {
      const best = pickBest(ph.options, (i) => toll10Gain(state, i));
      return best !== undefined ? { type: 'FreeUpgrade', playerId, spaceIndex: best } : pass;
    }

    case 'auction': {
      if (!can('Bid')) return pass;
      const price = priceOf(ph.spaceIndex, state.settings.spacesPerSide ?? 7);
      const after = p.cash - ph.minBid;
      const want =
        winsGame(state, playerId, ph.spaceIndex) ||
        completesSet(state, playerId, ph.spaceIndex) ||
        blocksOpponent(state, playerId, ph.spaceIndex).stopsWin;
      const cap = easy ? price * 0.7 : want ? price * 1.3 : price * 0.9;
      return ph.minBid <= cap && after >= reserveFor(state, playerId) ? { type: 'Bid', playerId } : pass;
    }

    case 'debt': {
      const shortfall = ph.amount - p.cash;
      const opts = saleOptions(state, playerId);
      // Penalize breaking our own complete sets.
      const penalty = (a: Action) => {
        if (!('spaceIndex' in a)) return 0;
        const idx = a.spaceIndex;
        const pr = state.properties[idx]!;
        let pen = 0;
        if (a.type === 'SellProperty' && completesSetOwned(state, playerId, idx)) pen += 1000;
        if (a.type === 'SellProperty' && pr.level > 0) pen += 200;
        return pen;
      };
      const covering = opts.filter((o) => o.amount >= shortfall);
      const pool = covering.length > 0 ? covering : opts;
      const best = pickBest(pool, (o) => -(o.amount + penalty(o.action)));
      return best ? best.action : defaultAction(state)!;
    }
  }
}

function completesSetOwned(state: GameState, pid: PlayerId, idx: number): boolean {
  return setsOf(state, idx).some((set) => set.every((i) => state.properties[i]!.owner === pid));
}
