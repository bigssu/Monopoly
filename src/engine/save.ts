/**
 * Save / load: versioned JSON.
 */
import { CARDS, KEEPABLE_CARD_IDS } from '../content/cards';
import { GROUP_IDS, SIDE_IDS } from '../content/board';
import type { GameState } from './types';
import { getBoardInfo, priceOf } from './board';
import { ECONOMY } from './economy';
import { festivalOptions, travelOptions } from './reducer';
import { canBeTakenOver, liquidationValue, nextBuildCost, ownedCities, round10, takeoverPrice, tollOf } from './rules';
import { ruleFlags } from './settings';

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
  // Saves from before rule levels played the original rules.
  if (file.state?.settings && file.state.settings.rules === undefined) file.state.settings.rules = 'easy';
  return file;
}

function validateSettings(value: unknown): value is JsonObject & { spacesPerSide: 7 | 8 | 9 } {
  if (!object(value) || !Array.isArray(value.players) || !integer(value.startCash, 1) ||
    !(value.roundLimit === null || integer(value.roundLimit, 1)) || !boolean(value.takeover) || !boolean(value.auction) ||
    !boolean(value.endOnFirstBankruptcy) || !boolean(value.buildAnywhere) || ![0, 15, 30].includes(value.promptTimer as number) ||
    ![7, 8, 9].includes(value.spacesPerSide as number) || !['easy', 'normal', 'advanced'].includes(value.rules as string) ||
    value.players.length < 2 || value.players.length > 4) return false;
  const seats = new Set<string>();
  return value.players.every((player) => {
    if (!object(player) || typeof player.name !== 'string' || typeof player.tokenId !== 'string' || typeof player.colorId !== 'string' ||
      !SEATS.has(player.seat as string) || seats.has(player.seat as string) || !boolean(player.isCpu) || !CPU_LEVELS.has(player.cpuLevel as string)) return false;
    seats.add(player.seat as string);
    return true;
  });
}

function validatePlayers(value: unknown, boardSize: number): value is JsonObject[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) return false;
  const seats = new Set<string>();
  return value.every((player, index) => {
    if (!object(player) || player.id !== index || typeof player.name !== 'string' || typeof player.tokenId !== 'string' ||
      typeof player.colorId !== 'string' || !SEATS.has(player.seat as string) || seats.has(player.seat as string) ||
      !boolean(player.isCpu) || !CPU_LEVELS.has(player.cpuLevel as string) || !integer(player.cash, 0) ||
      !spaceIndex(player.position, boardSize) || !integer(player.islandTurns, 0) || !boolean(player.bankrupt) ||
      !Array.isArray(player.cards) || !player.cards.every((card) => KEEPABLE_CARD_IDS.includes(card as never)) ||
      !boolean(player.travelPending) || !boolean(player.expressPending) || !integer(player.consecutiveDoubles, 0)) return false;
    seats.add(player.seat as string);
    return true;
  });
}

function validateProperties(value: unknown, propertyIndices: readonly number[], cityIndices: readonly number[], playerCount: number): boolean {
  if (!Array.isArray(value)) return false;
  const propertyIndexSet = new Set(propertyIndices);
  const cityIndexSet = new Set(cityIndices);
  return value.every((property, index) => {
    if (!propertyIndexSet.has(index)) return property === null;
    return object(property) && [0, 1, 2, 3, 4].includes(property.level as number) &&
      (property.owner === null || playerId(property.owner, playerCount)) && (property.owner !== null || property.level === 0) &&
      (cityIndexSet.has(index) || property.level === 0);
  });
}

function validateContinuation(value: unknown, propertyIndices: readonly number[], boardSize: number): boolean {
  return object(value) && (value.kind === 'endLanding' ||
    (value.kind === 'takeoverCheck' && spaceIndex(value.spaceIndex, boardSize) && propertyIndices.includes(value.spaceIndex)));
}

function validateToll(value: unknown, propertyIndices: readonly number[], boardSize: number, playerCount: number): boolean {
  return object(value) && spaceIndex(value.spaceIndex, boardSize) && propertyIndices.includes(value.spaceIndex) && playerId(value.ownerId, playerCount) &&
    integer(value.baseToll, 0) && boolean(value.festival) && (value.multiplier === 1 || value.multiplier === 2);
}

function validateResult(value: unknown, playerCount: number): boolean {
  if (!object(value) || !playerId(value.winnerId, playerCount) || typeof value.victory !== 'string' || !VICTORIES.has(value.victory) || !integer(value.round, 1) ||
    !Array.isArray(value.ranking) || value.ranking.length !== playerCount) return false;
  if (value.groups !== undefined && (!Array.isArray(value.groups) || !value.groups.every((group) => GROUP_IDS.includes(group as never)))) return false;
  if (value.side !== undefined && !SIDE_IDS.includes(value.side as never)) return false;
  const seen = new Set<number>();
  return value.ranking.every((entry, index) => {
    if (!object(entry) || !playerId(entry.playerId, playerCount) || seen.has(entry.playerId) || entry.rank !== index + 1 ||
      !integer(entry.cash, 0) || !integer(entry.propertyValue, 0) || !integer(entry.totalAssets, 0) ||
      !integer(entry.cities, 0) || !integer(entry.hubs, 0) || !boolean(entry.bankrupt)) return false;
    seen.add(entry.playerId);
    return true;
  });
}

function validatePhase(value: unknown, boardSize: number, propertyIndices: readonly number[], cityIndices: readonly number[], playerCount: number): boolean {
  if (!object(value) || typeof value.kind !== 'string') return false;
  const propertyIndex = (index: unknown) => spaceIndex(index, boardSize) && propertyIndices.includes(index);
  const prompt = () => playerId(value.playerId, playerCount);
  switch (value.kind) {
    case 'preRoll': return prompt() && boolean(value.rollAgain);
    case 'island': return prompt() && integer(value.turnsLeft, 1) && integer(value.bail, 0) && boolean(value.canPayBail) && boolean(value.hasEscapeCard);
    case 'travel': return prompt() && options(value.options, boardSize);
    case 'festival': return prompt() && options(value.options, boardSize) && value.options.every((index) => cityIndices.includes(index));
    case 'freeUpgrade': return prompt() && options(value.options, boardSize) && value.options.every(propertyIndex);
    case 'buy': return prompt() && propertyIndex(value.spaceIndex) && integer(value.price, 0);
    case 'build': return prompt() && propertyIndex(value.spaceIndex) && [1, 2, 3, 4].includes(value.toLevel as number) && integer(value.cost, 0);
    case 'takeover': return prompt() && propertyIndex(value.spaceIndex) && playerId(value.ownerId, playerCount) && integer(value.price, 0) && boolean(value.ownerHasShield);
    case 'auction':
      return prompt() && propertyIndex(value.spaceIndex) && playerId(value.declinedBy, playerCount) && Array.isArray(value.order) &&
        value.order.every((id) => playerId(id, playerCount)) && Array.isArray(value.active) && value.active.every((id) => playerId(id, playerCount)) &&
        (value.highBid === null || integer(value.highBid, 0)) && (value.highBidderId === null || playerId(value.highBidderId, playerCount)) &&
        integer(value.minBid, 0) && integer(value.increment, 1);
    case 'doubleUp':
      return prompt() && integer(value.stake, 1) && integer(value.wins, 0) && value.wins < ECONOMY.doubleUpMaxWins && integer(value.shown, 1) && value.shown <= 6;
    case 'target':
      return prompt() && value.card === 'typhoon' && options(value.options, boardSize) && value.options.length > 0 && value.options.every((index) => cityIndices.includes(index));
    case 'cardChoice':
      return prompt() && Array.isArray(value.options) && value.options.length === 2 && value.options[0] !== value.options[1] &&
        value.options.every((id) => CARDS.some((c) => c.id === id));
    case 'useCard':
      return prompt() && propertyIndex(value.spaceIndex) && (value.card === 'toll-pass' ? integer(value.multiplier, 1) :
        value.card === 'shield' && playerId(value.buyerId, playerCount) && integer(value.price, 0));
    case 'debt':
      return prompt() && integer(value.amount, 0) && Array.isArray(value.payments) && value.payments.every((payment) =>
        object(payment) && (payment.to === 'bank' || payment.to === 'pot' || playerId(payment.to, playerCount)) && integer(payment.amount, 0)) &&
        typeof value.reason === 'string' && MONEY_REASONS.has(value.reason) && validateContinuation(value.then, propertyIndices, boardSize) &&
        (value.toll === undefined || validateToll(value.toll, propertyIndices, boardSize, playerCount));
    case 'gameOver': return validateResult(value.result, playerCount);
    default: return false;
  }
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Validate phase values against the loaded state before the reducer can consume them. */
/** The state a pending toll was priced in: hub growth counts the visit right after pricing it. */
function pricedState(state: GameState, idx: number): GameState {
  const v = state.hubVisits?.[idx];
  if (!v) return state;
  const hubVisits = { ...state.hubVisits };
  if (v.n > 1) hubVisits[idx] = { ...v, n: v.n - 1 };
  else delete hubVisits[idx];
  return { ...state, hubVisits };
}

function validatePhaseContext(value: unknown, state: GameState): boolean {
  const phase = value as GameState['phase'];
  if (phase.kind === 'gameOver') return state.extraRoll === false;
  // Auction bidders may be waiting on the island/travel themselves; turn-entry obligations
  // belong to the current turn owner, not necessarily the player acting in this phase.
  const turnOwner = state.players[state.current]!;
  if (turnOwner.islandTurns > 0 ? phase.kind !== 'island' : turnOwner.travelPending && phase.kind !== 'travel') return false;
  const player = state.players[phase.playerId]!;
  const currentPrompt = phase.playerId === state.current && !player.bankrupt;
  const size = state.settings.spacesPerSide ?? 7;
  const property = (index: number) => state.properties[index]!;
  switch (phase.kind) {
    case 'preRoll':
      return currentPrompt && player.islandTurns === 0 && !player.travelPending && phase.rollAgain === state.extraRoll;
    case 'island':
      return currentPrompt && player.position === getBoardInfo(size).islandIndex && player.islandTurns === phase.turnsLeft &&
        phase.turnsLeft <= ECONOMY.islandTurns && phase.bail === ECONOMY.bail &&
        phase.canPayBail === (player.cash >= ECONOMY.bail) && phase.hasEscapeCard === player.cards.includes('escape');
    case 'travel':
      return currentPrompt && player.position === getBoardInfo(size).travelIndex && player.travelPending &&
        sameNumbers(phase.options, travelOptions(player.position, size));
    case 'buy':
      return currentPrompt && player.position === phase.spaceIndex && property(phase.spaceIndex).owner === null &&
        phase.price === priceOf(phase.spaceIndex, size) && player.cash >= phase.price;
    case 'build': {
      const cost = nextBuildCost(state, phase.spaceIndex);
      return currentPrompt && player.position === phase.spaceIndex && property(phase.spaceIndex).owner === phase.playerId &&
        cost !== null && phase.cost === cost && phase.toLevel === property(phase.spaceIndex).level + 1 && player.cash >= cost;
    }
    case 'takeover': {
      const owner = state.players[phase.ownerId]!;
      return currentPrompt && player.position === phase.spaceIndex && state.settings.takeover &&
        property(phase.spaceIndex).owner === phase.ownerId && phase.ownerId !== phase.playerId && canBeTakenOver(state, phase.spaceIndex) &&
        phase.price === takeoverPrice(state, phase.spaceIndex) && player.cash >= phase.price && phase.ownerHasShield === owner.cards.includes('shield');
    }
    case 'festival':
      return currentPrompt && player.position === getBoardInfo(size).festivalIndex &&
        phase.options.length > 0 && sameNumbers(phase.options, festivalOptions(state, phase.playerId));
    case 'doubleUp':
      return currentPrompt && ruleFlags(state.settings).doubleUp && player.position === getBoardInfo(size).startIndex &&
        phase.stake === ECONOMY.salary * 2 ** phase.wins;
    case 'target':
      // Every option is an opponent's city that a typhoon can still lower.
      return currentPrompt && ruleFlags(state.settings).targeting && phase.options.every((index) => {
        const pr = property(index);
        return pr.owner !== null && pr.owner !== phase.playerId && pr.level >= 1 && pr.level < ECONOMY.maxLevel;
      });
    case 'cardChoice':
      return currentPrompt && ruleFlags(state.settings).cardChoice && getBoardInfo(size).eventIndices.includes(player.position);
    case 'useCard': {
      if (!ruleFlags(state.settings).manualCards) return false;
      if (phase.card === 'toll-pass') {
        const owner = property(phase.spaceIndex).owner;
        return currentPrompt && player.position === phase.spaceIndex && player.cards.includes('toll-pass') && owner !== null && owner !== phase.playerId;
      }
      // Shield: the owner decides while the turn owner (the buyer) stands on the space.
      return phase.buyerId === state.current && property(phase.spaceIndex).owner === phase.playerId && player.cards.includes('shield') &&
        state.players[phase.buyerId]!.position === phase.spaceIndex && phase.price === takeoverPrice(state, phase.spaceIndex);
    }
    case 'freeUpgrade':
      return currentPrompt && phase.options.length > 0 &&
        sameNumbers(phase.options, ownedCities(state, phase.playerId).filter((index) => property(index).level < ECONOMY.maxLevel));
    case 'auction': {
      const expectedOrder: number[] = [];
      for (let offset = 1; offset < state.players.length; offset++) {
        const id = (phase.declinedBy + offset) % state.players.length;
        if (!state.players[id]!.bankrupt) expectedOrder.push(id);
      }
      const initialBid = round10(priceOf(phase.spaceIndex, size) * ECONOMY.auctionStartRate);
      return state.current === phase.declinedBy && !state.players[phase.declinedBy]!.bankrupt &&
        state.players[phase.declinedBy]!.position === phase.spaceIndex && property(phase.spaceIndex).owner === null &&
        state.settings.auction && sameNumbers(phase.order, expectedOrder) && phase.active.length > 0 && new Set(phase.active).size === phase.active.length &&
        phase.active.every((id) => phase.order.includes(id) && (id === phase.highBidderId || state.players[id]!.cash >= phase.minBid)) && phase.active.includes(phase.playerId) &&
        phase.increment === Math.max(10, round10(priceOf(phase.spaceIndex, size) * ECONOMY.auctionIncrementRate)) &&
        ((phase.highBid === null && phase.highBidderId === null && phase.minBid === initialBid) ||
          (phase.highBid !== null && phase.highBidderId !== null && phase.highBid >= initialBid &&
            (phase.highBid - initialBid) % phase.increment === 0 && phase.active.includes(phase.highBidderId) &&
            state.players[phase.highBidderId]!.cash >= phase.highBid && phase.minBid === phase.highBid + phase.increment));
    }
    case 'debt': {
      const total = phase.payments.reduce((sum, payment) => sum + payment.amount, 0);
      if (!currentPrompt || phase.amount !== total || player.cash >= phase.amount || player.cash + liquidationValue(state, phase.playerId) < phase.amount) return false;
      if (phase.reason !== 'toll') return phase.toll === undefined && phase.then.kind === 'endLanding';
      if (!phase.toll || phase.then.kind !== 'takeoverCheck' || phase.then.spaceIndex !== phase.toll.spaceIndex) return false;
      const tollProperty = property(phase.toll.spaceIndex);
      return player.position === phase.toll.spaceIndex && tollProperty.owner === phase.toll.ownerId && phase.toll.baseToll === tollOf(pricedState(state, phase.toll.spaceIndex), phase.toll.spaceIndex) &&
        phase.toll.festival === (state.festival === phase.toll.spaceIndex) && phase.payments.length === 1 &&
        phase.payments[0]!.to === phase.toll.ownerId && phase.payments[0]!.amount === phase.toll.baseToll * phase.toll.multiplier;
    }
  }
}

function validateTestHooks(value: unknown): boolean {
  if (value === undefined) return true;
  return object(value) && (value.diceQueue === undefined || (Array.isArray(value.diceQueue) && value.diceQueue.every((dice) =>
    Array.isArray(dice) && dice.length === 2 && dice.every((die) => integer(die, 1) && die <= 6)))) &&
    (value.cardQueue === undefined || (Array.isArray(value.cardQueue) && value.cardQueue.every((card) => CARDS.some((definition) => definition.id === card)))) &&
    (value.pickQueue === undefined || (Array.isArray(value.pickQueue) && value.pickQueue.every((pick) => integer(pick, 0))));
}

type JsonObject = Record<string, unknown>;

const MONEY_REASONS = new Set(['salary', 'pot', 'toll', 'purchase', 'build', 'takeover', 'tax', 'donation', 'bail', 'card', 'sale', 'auction', 'bankruptcy']);
const VICTORIES = new Set(['lastStanding', 'bankruptcy', 'triple', 'line', 'hubs', 'roundLimit']);
const SEATS = new Set(['S', 'E', 'N', 'W']);
const CPU_LEVELS = new Set(['easy', 'normal']);

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function integer(value: unknown, minimum = Number.MIN_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function boolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function playerId(value: unknown, count: number): value is number {
  return integer(value, 0) && value < count;
}

/** Optional rule-level state (olympics level, hub growth steps). */
function validateRuleState(state: JsonObject, boardSize: number): boolean {
  if (state.endsAfterRound !== undefined && !boolean(state.endsAfterRound)) return false;
  if (state.festivalLevel !== undefined && !(integer(state.festivalLevel, 1) && state.festivalLevel <= ECONOMY.olympicsMultipliers.length)) return false;
  // Result-screen statistics: plain non-negative counters / asset rows.
  if (state.stats !== undefined && !(Array.isArray(state.stats) && state.stats.every((p) => object(p) && Object.values(p).every((v) => integer(v, 0))))) return false;
  if (state.history !== undefined && !(Array.isArray(state.history) && state.history.every((row) => Array.isArray(row) && row.every((v) => integer(v, 0))))) return false;
  if (state.hubVisits === undefined) return true;
  if (!object(state.hubVisits)) return false;
  return Object.entries(state.hubVisits).every(([k, v]) => spaceIndex(Number(k), boardSize) && object(v) && integer(v.n, 1) && integer(v.owner, 0));
}

function spaceIndex(value: unknown, boardSize: number): value is number {
  return integer(value, 0) && value < boardSize;
}

function options(value: unknown, boardSize: number): value is number[] {
  return Array.isArray(value) && value.every((index) => spaceIndex(index, boardSize));
}

function fail(message: string): never {
  throw new SaveError(message);
}

export function deserialize(json: string): GameState {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new SaveError('Save data is not valid JSON');
  }
  if (!object(raw)) fail('Save data is not an object');
  const file = raw as Partial<SaveFile>;
  if (file.format !== SAVE_FORMAT) fail('Not a Money Poly save file');
  if (file.version !== SAVE_VERSION) {
    if (typeof file.version === 'number' && file.version > SAVE_VERSION) fail(`Save version ${file.version} is newer than supported (${SAVE_VERSION})`);
    fail('Save file has an unsupported version');
  }
  if (!(file.savedAt === null || typeof file.savedAt === 'string')) fail('Save file has an invalid saved time');
  const migrated = migrate(file as SaveFile);
  const state = migrated.state;
  if (!object(state) || state.schema !== 1 || !validateSettings(state.settings)) fail('Save file settings are malformed');
  const board = getBoardInfo(state.settings.spacesPerSide);
  if (!validatePlayers(state.players, board.size) || !Array.isArray(state.properties) || state.properties.length !== board.size ||
    !validateProperties(state.properties, board.propertyIndices, board.cityIndices, state.players.length)) fail('Save file players or properties are malformed');
  if (!integer(state.seed) || !integer(state.rng, 0) || !integer(state.pot, 0) || !integer(state.round, 1) || !integer(state.turn, 1) ||
    !playerId(state.current, state.players.length) || !(state.festival === null || (spaceIndex(state.festival, board.size) && board.cityIndices.includes(state.festival))) ||
    !(state.lastDice === null || (Array.isArray(state.lastDice) && state.lastDice.length === 2 && state.lastDice.every((die) => integer(die, 1) && die <= 6))) ||
    !boolean(state.extraRoll) || !boolean(state.remoteBuildUsed) || !Array.isArray(state.bankruptOrder) ||
    !state.bankruptOrder.every((id) => playerId(id, state.players.length)) || new Set(state.bankruptOrder).size !== state.bankruptOrder.length ||
    !validateTestHooks(state.testHooks) || !validateRuleState(state, board.size) || !validatePhase(state.phase, board.size, board.propertyIndices, board.cityIndices, state.players.length) ||
    !validatePhaseContext(state.phase, state as GameState)) fail('Save file state is malformed');
  return state as GameState;
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
