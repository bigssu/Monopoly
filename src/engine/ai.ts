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
 * Rules version 2 (docs/research/08-fun-analysis.md): all or nothing — gamble the tax when behind
 * and able to pay twice, play safe when leading; city swap — the swap that gains the most value
 * (never one that hands the owner a winning set); comeback cards are valued by what they would do
 * now; a win-back (1× value) is taken whenever it leaves a reserve.
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
import { ECONOMY, SKILL_BANDS } from './economy';
import { mulberry32Step } from './rng';
import { counterbuyOptions, defaultAction, legalActions, raidTarget, saleOptions, swapGive } from './reducer';
import {
  completedGroups,
  propertyValue,
  setVictory,
  nextBuildCost,
  ownedCities,
  propertyAt,
  takeoverPrice,
  tollAtLevel,
  tollOf,
  totalAssets,
} from './rules';
import { ruleFlags } from './settings';
import type { Action, CardId, GameState, PlayerId } from './types';

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
      const cost = tollOf(state, target) + takeoverPrice(state, target, ruleFlags(state.settings).chaseTakeover ? pid : undefined);
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

// ---------------------------------------------------------------------------
// Rules version 3: stride choice and the skill throw (docs/research/11-skill-throw.md §1)
// ---------------------------------------------------------------------------

/** Mean throw accuracy by CPU level (what the CPU expects of itself when it picks an aim). */
const CPU_ACCURACY = { easy: 0.25, normal: 0.55 } as const;

/**
 * The CPU's throw accuracy for this roll (0..1), drawn from the seeded state without advancing it
 * (chooseAction stays a pure function of the state): the mean of two uniforms around the level's
 * mean — normal 0.55 (0.1–1), easy 0.25 (0–0.5).
 */
export function cpuAccuracy(state: GameState, pid: PlayerId): number {
  const [u1, next] = mulberry32Step((state.rng ^ (0x5bd1e995 + pid * 0x9e3779b9)) >>> 0);
  const [u2] = mulberry32Step(next);
  const easy = state.players[pid]!.cpuLevel === 'easy';
  const spread = easy ? 0.25 : 0.45;
  const mean = easy ? CPU_ACCURACY.easy : CPU_ACCURACY.normal;
  return Math.min(1, Math.max(0, Math.round((mean + (u1 + u2 - 1) * spread) * 100) / 100));
}

/** Natural probability of each total for one die (index = total). */
const ONE_DIE = [0, 1, 1, 1, 1, 1, 1].map((w) => w / 6);
/** Natural probability of each total for two dice (index = total). */
const TWO_DICE = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1].map((w) => w / 36);

/** Probability of each total for a throw (stride, aim) with assist chance `p` (= SKILL_CAP × accuracy). */
export function throwDistribution(stride: 1 | 2, aim: 'low' | 'high' | undefined, p: number): number[] {
  const nat = stride === 1 ? ONE_DIE : TWO_DICE;
  if (!aim || p <= 0) return nat.slice();
  const [lo, hi] = SKILL_BANDS[stride][aim];
  const inBand = nat.reduce((a, w, t) => a + (t >= lo && t <= hi ? w : 0), 0);
  return nat.map((w, t) => (1 - p) * w + (t >= lo && t <= hi ? (p * w) / inBand : 0));
}

/** What landing on `target` is worth to `pid` (travelScore, with the corners a roll can reach). */
function landScore(state: GameState, pid: PlayerId, target: number): number {
  const size = state.settings.spacesPerSide ?? 7;
  const kind = space(target, size).kind;
  // Losing up to three turns vs a free destination next turn.
  if (kind === 'island') return -120;
  if (kind === 'travel') return 80;
  return travelScore(state, pid, target);
}

/**
 * Version-3 CPU knobs (docs/BALANCE.md "Rules version 3"; the balance scripts sweep them with
 * `npm run skill -- … --ai key=value`). `doublesValue`: what rolling doubles is worth (an extra roll
 * and a bonus card). `investFactor`: start-invest only with this × the cost in hand (normal).
 * `investReserve`: … and keep this × the toll reserve after paying. `chaseTake`: take over a built
 * city for its value alone when the chase multiplier is at most this (0 = only for sets).
 */
export const AI_TUNING = { doublesValue: 60, investFactor: 3, investReserve: 2, chaseTake: 1.9 };

/**
 * Expected score of a throw: Σ P(total) × landing score, + progress (salary per space) and the
 * chance of doubles (two dice only). The express card doubles every total.
 */
function throwScore(state: GameState, pid: PlayerId, stride: 1 | 2, aim: 'low' | 'high' | undefined, acc: number): number {
  const p = state.players[pid]!;
  const size = getBoardInfo(state.settings.spacesPerSide ?? 7).size;
  const dist = throwDistribution(stride, aim, ECONOMY.skillCap * acc);
  const mult = p.expressPending ? 2 : 1;
  const perStep = ECONOMY.salary / size;
  let score = 0;
  dist.forEach((w, total) => {
    if (w <= 0) return;
    const steps = total * mult;
    score += w * (landScore(state, pid, (p.position + steps) % size) + steps * perStep);
  });
  if (stride === 2 && p.consecutiveDoubles < ECONOMY.maxConsecutiveDoubles - 1) score += AI_TUNING.doublesValue / 6;
  return score;
}

/**
 * The CPU's roll (rules version 3): the stride and aim with the best expected score at the level's
 * mean accuracy, thrown with this roll's sampled accuracy. Easy changes from a plain two-dice roll
 * only for a big gain, and aims less often. Before version 3: a plain roll.
 */
export function chooseRoll(state: GameState, pid: PlayerId): Action {
  const flags = ruleFlags(state.settings);
  const plain: Action = { type: 'Roll', playerId: pid };
  if (!flags.strideChoice && !flags.skillThrow) return plain;
  const easy = state.players[pid]!.cpuLevel === 'easy';
  const expected = easy ? CPU_ACCURACY.easy : CPU_ACCURACY.normal;
  const strides: Array<1 | 2> = flags.strideChoice ? [2, 1] : [2];
  const aims: Array<'low' | 'high' | undefined> = flags.skillThrow ? [undefined, 'low', 'high'] : [undefined];
  const base = throwScore(state, pid, 2, undefined, expected);
  let best = { stride: 2 as 1 | 2, aim: undefined as 'low' | 'high' | undefined, score: base };
  for (const stride of strides) {
    for (const aim of aims) {
      const sc = throwScore(state, pid, stride, aim, expected);
      if (sc > best.score + 1e-9) best = { stride, aim, score: sc };
    }
  }
  // Easy: only a clear gain moves it off the plain roll.
  if (easy && best.score - base < 60) best = { stride: 2, aim: undefined, score: base };
  // The accuracy rides along even without an aim, so the table sees how the CPU threw.
  const out: Action = { type: 'Roll', playerId: pid, stride: best.stride, accuracy: cpuAccuracy(state, pid) };
  return best.aim ? { ...out, aim: best.aim } : out;
}

/** Card choice: how much the CPU likes each card (money in > keep-cards > moves > money out). */
const CARD_VALUE: Partial<Record<CardId, number>> = {
  lottery: 9, welfare: 8, 'free-upgrade': 8, 'hub-bonus': 7, birthday: 7, 'bank-dividend': 6, 'to-start': 6,
  shield: 6, 'toll-pass': 6, escape: 5, 'tax-refund': 5, express: 4, 'to-travel': 4, 'to-festival': 4,
  'festival-invite': 4, 'leader-tax': 3, 'random-jump': 2, 'nearest-hub': 1, typhoon: 1, 'back-three': 0,
  charity: -2, fine: -3, repairs: -3, 'to-island': -5,
};

const CARD_MEAN = Object.values(CARD_VALUE).reduce((a, b) => a + b, 0) / Object.values(CARD_VALUE).length;

/** Value of a card for `pid` right now (the comeback cards depend on the table). */
export function cardValue(state: GameState, pid: PlayerId, id: CardId): number {
  if (id === 'raid') {
    const target = raidTarget(state, pid);
    return target === null ? -1 : Math.min(9, 3 + Math.round((state.players[target]!.cash * 0.2) / 100));
  }
  if (id === 'swap') {
    const best = bestSwap(state, pid);
    return best && best.score > 0 ? 8 : -1;
  }
  return CARD_VALUE[id] ?? 0;
}

/** Swap score for taking `took` (and giving our cheapest non-landmark city), or −Infinity if it loses the game. */
function swapScore(state: GameState, pid: PlayerId, took: number): number {
  const gave = swapGive(state, pid);
  if (gave === null) return -Infinity;
  const owner = state.properties[took]!.owner!;
  const after: GameState = { ...state, properties: state.properties.map((pr) => (pr ? { ...pr } : pr)) };
  after.properties[took]!.owner = pid;
  after.properties[gave]!.owner = owner;
  if (setVictory(after, owner)) return -Infinity;
  if (setVictory(after, pid)) return 100_000;
  let score = propertyValue(state, took) - propertyValue(state, gave);
  score += (tollOf(after, took) - tollOf(state, gave)) * 2;
  if (completesSet(state, pid, took)) score += 300;
  if (completedGroups(state, pid).length > completedGroups(after, pid).length) score -= 400;
  if (completedGroups(after, owner).length > completedGroups(state, owner).length) score -= 400;
  return score;
}

function bestSwap(state: GameState, pid: PlayerId, options?: readonly number[]): { idx: number; score: number } | null {
  const size = state.settings.spacesPerSide ?? 7;
  const opts = options ?? getBoardInfo(size).cityIndices.filter((i) => {
    const pr = state.properties[i]!;
    return pr.owner !== null && pr.owner !== pid && pr.level < ECONOMY.maxLevel;
  });
  let best: { idx: number; score: number } | null = null;
  for (const i of opts) {
    const sc = swapScore(state, pid, i);
    if (!best || sc > best.score) best = { idx: i, score: sc };
  }
  return best;
}

/** Two-dice chance of moving exactly `d` spaces in one roll (0 outside 2..12). */
const twoDice = (d: number): number => (d >= 2 && d <= 12 ? (6 - Math.abs(d - 7)) / 36 : 0);

/**
 * Start investment (rules version 3): what raising `idx` a level is worth — the toll gain, weighted
 * by how likely opponents are to land there on their next roll, more for a city in our own notice
 * (it raises the block-buy price) or a complete colour group.
 */
function investScore(state: GameState, pid: PlayerId, idx: number): number {
  const size = state.settings.spacesPerSide ?? 7;
  let reach = 0;
  for (const q of state.players) {
    if (q.id === pid || q.bankrupt) continue;
    reach += twoDice(distance(q.position, idx, size));
  }
  let score = toll10Gain(state, idx) * (1 + 4 * reach);
  const g = groupOf(idx, size);
  if (g && citiesInGroup(g, size).every((i) => state.properties[i]!.owner === pid)) score *= 1.3;
  if (state.pendingWins?.some((w) => w.playerId === pid && w.members.includes(idx))) score += 200;
  return score;
}

/**
 * Block-buy (rules version 3): the cheapest buy that actually breaks an opponent's announced set,
 * if affordable (easy keeps 300 back). Stopping a win is worth nearly any price.
 */
function chooseBlock(state: GameState, pid: PlayerId): Action | null {
  const opts = counterbuyOptions(state, pid);
  if (opts.length === 0) return null;
  const p = state.players[pid]!;
  const breaks = opts.filter((o) => {
    const after: GameState = { ...state, properties: state.properties.map((pr) => (pr ? { ...pr } : pr)) };
    after.properties[o.spaceIndex]!.owner = pid;
    return !setVictory(after, o.ownerId);
  });
  const keep = p.cpuLevel === 'easy' ? 300 : 0;
  const best = pickBest(breaks.filter((o) => p.cash - o.price >= keep), (o) => -o.price + (completesSet(state, pid, o.spaceIndex) ? 300 : 0));
  return best ? { type: 'Counterbuy', playerId: pid, spaceIndex: best.spaceIndex } : null;
}

/** Choose an action for `playerId` in the current phase. Always legal. */
export function chooseAction(state: GameState, playerId: PlayerId): Action {
  const ph = state.phase;
  if (ph.kind === 'gameOver') throw new Error('Game is over');
  if (ph.playerId !== playerId) throw new Error(`Not player ${playerId}'s decision`);
  if (ph.kind === 'preRoll' || ph.kind === 'island' || ph.kind === 'travel') {
    const block = chooseBlock(state, playerId);
    if (block) return block;
  }
  const p = state.players[playerId]!;
  const easy = p.cpuLevel === 'easy';
  const pass: Action = { type: 'Pass', playerId };
  const legal = legalActions(state);
  const can = (t: Action['type']) => legal.some((a) => a.type === t);

  switch (ph.kind) {
    case 'preRoll':
      return chooseRoll(state, playerId);

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
      // Win-back: our old city at 1× value.
      if (ph.winBack && after >= (easy ? 500 : reserveFor(state, playerId) * 0.5)) return { type: 'Takeover', playerId };
      if (easy) {
        return completesSet(state, playerId, ph.spaceIndex) && after >= 500 ? { type: 'Takeover', playerId } : pass;
      }
      const reserve = Math.max(reserveFor(state, playerId), maxExposure(state, playerId) * 0.5);
      const { blocks, stopsWin } = blocksOpponent(state, playerId, ph.spaceIndex);
      if (stopsWin && after >= 0) return { type: 'Takeover', playerId };
      const mine = completesSet(state, playerId, ph.spaceIndex) || setProgress(state, playerId, ph.spaceIndex) >= 0.5;
      if ((mine || blocks) && after >= reserve) return { type: 'Takeover', playerId };
      // Chase takeover (version 3): a trailing buyer's discount makes a built-up city worth taking.
      if (ph.multiplier !== undefined && ph.multiplier <= AI_TUNING.chaseTake && propertyAt(state, ph.spaceIndex).level >= 1 && after >= reserve * 1.5) {
        return { type: 'Takeover', playerId };
      }
      return pass;
    }

    case 'festival': {
      const best = pickBest(ph.options, (i) => tollOf(state, i) * 10 + priceOf(i, state.settings.spacesPerSide ?? 7) / 100);
      return best !== undefined ? { type: 'SetFestival', playerId, spaceIndex: best } : pass;
    }

    case 'invest': {
      // Like building on landing: only with twice (easy: three times) the cost in hand.
      const factor = easy ? AI_TUNING.investFactor + 1 : AI_TUNING.investFactor;
      const keep = AI_TUNING.investReserve * reserveFor(state, playerId);
      const affordable = ph.options.filter((i) => {
        const cost = nextBuildCost(state, i) ?? Infinity;
        return p.cash >= factor * cost && p.cash - cost >= keep;
      });
      const best = pickBest(affordable, (i) => investScore(state, playerId, i));
      return best !== undefined ? { type: 'Invest', playerId, spaceIndex: best } : pass;
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

    case 'doubleUp': {
      // Bet only when the odds favour it (shown 1-2 → higher, 5-6 → lower); bank after one win.
      if (easy || ph.wins > 0 || ph.shown === 3 || ph.shown === 4) return pass;
      return { type: 'DoubleUpGuess', playerId, guess: ph.shown <= 2 ? 'high' : 'low' };
    }

    case 'target': {
      if (ph.card === 'swap') {
        const best = bestSwap(state, playerId, ph.options);
        // Easy: the priciest city, if it is worth more than ours; normal: the best trade.
        if (easy) {
          const gave = swapGive(state, playerId);
          const top = pickBest([...ph.options], (i) => propertyValue(state, i));
          const ok = top !== undefined && gave !== null && propertyValue(state, top) > propertyValue(state, gave) && swapScore(state, playerId, top) > -Infinity;
          return ok ? { type: 'ChooseTarget', playerId, spaceIndex: top } : pass;
        }
        return best && best.score > 0 ? { type: 'ChooseTarget', playerId, spaceIndex: best.idx } : pass;
      }
      // Hit the richest opponent's most valuable city.
      const leader = (i: number) => totalAssets(state, state.properties[i]!.owner!);
      const best = pickBest([...ph.options], (i) => leader(i) * 10 + tollOf(state, i));
      return { type: 'ChooseTarget', playerId, spaceIndex: best ?? ph.options[0]! };
    }

    case 'gamble': {
      // All or nothing: the same expected cost; the trailing player takes the risk, the leader pays.
      if (easy) return ph.tax <= 100 ? { type: 'Gamble', playerId } : pass;
      const spare = p.cash - ph.tax * ECONOMY.gambleLoss;
      const leading = state.players.every((q) => q.id === playerId || q.bankrupt || totalAssets(state, q.id) < totalAssets(state, playerId));
      return !leading && spare >= tollExposure(state, playerId) ? { type: 'Gamble', playerId } : pass;
    }

    case 'cardChoice': {
      // With a face-down second card the CPU does not peek: the known card vs the deck average.
      if (ruleFlags(state.settings).hiddenCard) {
        const known = cardValue(state, playerId, ph.options[0]);
        return { type: 'ChooseCard', playerId, cardId: known >= CARD_MEAN ? ph.options[0] : ph.options[1] };
      }
      const best = pickBest([...ph.options], (id) => cardValue(state, playerId, id));
      return { type: 'ChooseCard', playerId, cardId: best ?? ph.options[0] };
    }

    case 'useCard': {
      if (ph.card === 'shield') return { type: 'UseCard', playerId };
      // Save the Toll Pass for a toll that actually hurts.
      const toll = tollOf(state, ph.spaceIndex) * (ph.multiplier ?? 1);
      return toll >= Math.min(300, p.cash * 0.25) || toll > p.cash ? { type: 'UseCard', playerId } : pass;
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
