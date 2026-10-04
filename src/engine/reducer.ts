/**
 * The game reducer: `reduce(state, action) => { state, events }`.
 *
 * Pure: the input state is never mutated (we work on a deep copy), all randomness comes
 * from the seeded generator stored in `state.rng`. Illegal actions throw
 * `IllegalActionError` and leave the input untouched.
 */
import { CARDS, getCard, type CardId, type KeepableCardId } from '../content/cards';
import {
  getBoardInfo,
  distance,
  isCity,
  isHub,
  isProperty,
  nearestHubAhead,
  priceOf,
  space,
  walkPath,
} from './board';
import { ECONOMY } from './economy';
import { ruleFlags } from './settings';
import { createRng, rollDice, seedToState, type Rng } from './rng';
import {
  canBeTakenOver,
  findVictory,
  hubCount,
  liquidationValue,
  nextBuildCost,
  oneAwayKey,
  oneAwayWarnings,
  ownedCities,
  ownedProperties,
  propertyAt,
  ranking,
  round10,
  sellBuildingValue,
  sellPropertyValue,
  takeoverPrice,
  tollOf,
  totalAssets,
  type OneAwayWarning,
} from './rules';
import type {
  PlayerStats,
  Action,
  Continuation,
  GameEvent,
  GameResult,
  GameState,
  Level,
  MoneyReason,
  Payee,
  Payment,
  Phase,
  PhaseKind,
  Player,
  PlayerId,
  PromptPhase,
  ReduceResult,
  Settings,
  TollInfo,
} from './types';

// ---------------------------------------------------------------------------
// Errors & context
// ---------------------------------------------------------------------------

export class IllegalActionError extends Error {
  readonly action: Action;
  readonly phaseKind: PhaseKind;
  constructor(message: string, action: Action, phaseKind: PhaseKind) {
    super(message);
    this.name = 'IllegalActionError';
    this.action = action;
    this.phaseKind = phaseKind;
  }
}

/** Internal: thrown to unwind the flow once the game has ended. */
class GameEndedSignal {}

interface Ctx {
  s: GameState;
  ev: GameEvent[];
  rng: Rng;
}

export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => deepClone(v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>)) {
    out[k] = deepClone((value as Record<string, unknown>)[k]);
  }
  return out as T;
}

function emit(ctx: Ctx, e: GameEvent): void {
  ctx.ev.push(e);
  track(ctx.s, e);
}

export const emptyStats = (): PlayerStats => ({ tollPaid: 0, tollEarned: 0, biggestToll: 0, takeovers: 0, bought: 0, built: 0, islandVisits: 0, doubles: 0, cards: 0 });

/** Game statistics for the result screen (UI only reads them; no rule depends on them). */
function track(s: GameState, e: GameEvent): void {
  const st = (s.stats ??= s.players.map(emptyStats));
  const of = (pid: PlayerId) => st[pid] ?? (st[pid] = emptyStats());
  switch (e.type) {
    case 'TollPaid':
      if (e.waived) return;
      of(e.payerId).tollPaid += e.amount;
      of(e.ownerId).tollEarned += e.amount;
      of(e.ownerId).biggestToll = Math.max(of(e.ownerId).biggestToll, e.amount);
      return;
    case 'TakenOver':
      of(e.buyerId).takeovers++;
      return;
    case 'PropertyBought':
      of(e.playerId).bought++;
      return;
    case 'Built':
      of(e.playerId).built++;
      return;
    case 'SentToIsland':
      of(e.playerId).islandVisits++;
      return;
    case 'DiceRolled':
      if (e.isDouble) of(e.playerId).doubles++;
      return;
    case 'CardDrawn':
      of(e.playerId).cards++;
      return;
    case 'RoundStarted':
      (s.history ??= []).push(s.players.map((p) => (p.bankrupt ? 0 : totalAssets(s, p.id))));
      return;
  }
}

function player(ctx: Ctx, pid: PlayerId): Player {
  const p = ctx.s.players[pid];
  if (!p) throw new Error(`No player ${pid}`);
  return p;
}

function setPhase(ctx: Ctx, phase: PromptPhase): void {
  ctx.s.phase = phase;
  emit(ctx, { type: 'PromptOpened', phase: deepClone(phase) });
}

// ---------------------------------------------------------------------------
// Game creation
// ---------------------------------------------------------------------------

export function validateSettings(settings: Settings): void {
  const n = settings.players.length;
  if (n < 2 || n > 4) throw new RangeError(`Need 2–4 players, got ${n}`);
  const seats = new Set(settings.players.map((p) => p.seat));
  if (seats.size !== n) throw new RangeError('Each player needs a distinct seat');
  if (!Number.isInteger(settings.startCash) || settings.startCash <= 0) {
    throw new RangeError('startCash must be a positive integer');
  }
  if (settings.roundLimit !== null && (!Number.isInteger(settings.roundLimit) || settings.roundLimit < 1)) {
    throw new RangeError('roundLimit must be a positive integer or null');
  }
  if (settings.spacesPerSide !== undefined && !([7, 8, 9] as const).includes(settings.spacesPerSide)) throw new RangeError('spacesPerSide must be 7, 8, or 9');
}

export function createGame(settings: Settings, seed: number): GameState {
  validateSettings(settings);
  const spacesPerSide = settings.spacesPerSide ?? 7;
  const board = getBoardInfo(spacesPerSide);
  const players: Player[] = settings.players.map((ps, i) => ({
    id: i,
    name: ps.name,
    tokenId: ps.tokenId,
    colorId: ps.colorId,
    seat: ps.seat,
    isCpu: ps.isCpu,
    cpuLevel: ps.cpuLevel,
    cash: settings.startCash,
    position: board.startIndex,
    islandTurns: 0,
    bankrupt: false,
    cards: [],
    travelPending: false,
    expressPending: false,
    consecutiveDoubles: 0,
  }));
  return {
    schema: 1,
    settings: deepClone(settings),
    seed,
    rng: seedToState(seed),
    players,
    properties: board.board.map((sp) => (isProperty(sp.index, spacesPerSide) ? { owner: null, level: 0 as Level } : null)),
    festival: null,
    pot: 0,
    round: 1,
    turn: 1,
    current: 0,
    phase: { kind: 'preRoll', playerId: 0, rollAgain: false },
    lastDice: null,
    extraRoll: false,
    remoteBuildUsed: false,
    bankruptOrder: [],
    stats: players.map(emptyStats),
    // Round 1 starts here (no RoundStarted from the reducer): everyone starts with the start cash.
    history: [players.map(() => settings.startCash)],
  };
}

/** Events describing the initial state (for a UI that wants to animate the first turn). */
export function initialEvents(state: GameState): GameEvent[] {
  const ev: GameEvent[] = [
    { type: 'RoundStarted', round: state.round },
    { type: 'TurnStarted', playerId: state.current, round: state.round, turn: state.turn },
  ];
  if (state.phase.kind !== 'gameOver') ev.push({ type: 'PromptOpened', phase: deepClone(state.phase) });
  return ev;
}

// ---------------------------------------------------------------------------
// Randomness (with test hooks)
// ---------------------------------------------------------------------------

function nextDice(ctx: Ctx, gauge?: number): [number, number] {
  const q = ctx.s.testHooks?.diceQueue;
  if (q && q.length > 0) return q.shift()!;
  const first = rollDice(ctx.rng);
  if (gauge === undefined || !ruleFlags(ctx.s.settings).diceGauge) return first;
  return gaugeRoll(ctx.rng, gauge, first);
}

/**
 * Dice gauge (B7): with chance `diceGaugeBias × pull` (pull = distance of the release from the
 * middle, 0..1) roll again and keep the roll nearer the low (g < .5) or high (g > .5) end.
 */
export function gaugeRoll(rng: Rng, gauge: number, first: [number, number]): [number, number] {
  const g = Math.min(1, Math.max(0, gauge));
  const pull = Math.abs(g - 0.5) * 2;
  if (rng.next() >= ECONOMY.diceGaugeBias * pull) return first;
  const second = rollDice(rng);
  const sum = (d: [number, number]) => d[0] + d[1];
  const better = g > 0.5 ? sum(second) > sum(first) : sum(second) < sum(first);
  return better ? second : first;
}

function pick<T>(ctx: Ctx, list: readonly T[]): T {
  const q = ctx.s.testHooks?.pickQueue;
  const i = q && q.length > 0 ? q.shift()! % list.length : ctx.rng.int(list.length);
  return list[i]!;
}

function nextCardId(ctx: Ctx): CardId {
  const q = ctx.s.testHooks?.cardQueue;
  if (q && q.length > 0) return q.shift()!;
  return CARDS[ctx.rng.int(CARDS.length)]!.id;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

function addCash(
  ctx: Ctx,
  pid: PlayerId,
  delta: number,
  reason: MoneyReason,
  counterpart: Payee,
  spaceIndex?: number,
): void {
  if (delta === 0) return;
  const p = player(ctx, pid);
  p.cash += delta;
  if (p.cash < 0) throw new Error(`Invariant violated: player ${pid} cash ${p.cash}`);
  const e: GameEvent = { type: 'MoneyChanged', playerId: pid, delta, balance: p.cash, reason, counterpart };
  if (spaceIndex !== undefined) e.spaceIndex = spaceIndex;
  emit(ctx, e);
}

function changePot(ctx: Ctx, delta: number): void {
  if (delta === 0) return;
  ctx.s.pot += delta;
  emit(ctx, { type: 'PotChanged', delta, pot: ctx.s.pot });
}

/** Move money from a player to a payee (player / bank / pot). Caller guarantees solvency. */
function pay(ctx: Ctx, from: PlayerId, to: Payee, amount: number, reason: MoneyReason, spaceIndex?: number): void {
  if (amount <= 0) return;
  addCash(ctx, from, -amount, reason, to, spaceIndex);
  if (typeof to === 'number') addCash(ctx, to, amount, reason, from, spaceIndex);
  else if (to === 'pot') changePot(ctx, amount);
}

function receiveFromBank(ctx: Ctx, pid: PlayerId, amount: number, reason: MoneyReason, spaceIndex?: number): void {
  addCash(ctx, pid, amount, reason, 'bank', spaceIndex);
}

function receivePot(ctx: Ctx, pid: PlayerId): number {
  const amt = ctx.s.pot;
  if (amt <= 0) return 0;
  changePot(ctx, -amt);
  addCash(ctx, pid, amt, 'pot', 'pot');
  return amt;
}

function settle(ctx: Ctx, pid: PlayerId, payments: Payment[], reason: MoneyReason, toll?: TollInfo): void {
  if (toll) {
    const amount = payments.reduce((s, p) => s + p.amount, 0);
    emit(ctx, {
      type: 'TollPaid',
      payerId: pid,
      ownerId: toll.ownerId,
      spaceIndex: toll.spaceIndex,
      amount,
      baseToll: toll.baseToll,
      festival: toll.festival,
      multiplier: toll.multiplier,
      waived: false,
    });
  }
  for (const pm of payments) pay(ctx, pid, pm.to, pm.amount, reason, toll?.spaceIndex);
}

/**
 * Charge the current player. Pays immediately when possible, otherwise opens the `debt`
 * phase (sell to raise cash) or, if even selling everything is not enough, bankrupts them.
 */
function charge(
  ctx: Ctx,
  pid: PlayerId,
  payments: Payment[],
  reason: MoneyReason,
  then: Continuation,
  toll?: TollInfo,
): void {
  const p = player(ctx, pid);
  const total = payments.reduce((s, pm) => s + pm.amount, 0);
  if (total <= 0) return runContinuation(ctx, then);
  if (p.cash >= total) {
    settle(ctx, pid, payments, reason, toll);
    return runContinuation(ctx, then);
  }
  if (p.cash + liquidationValue(ctx.s, pid) >= total) {
    emit(ctx, { type: 'DebtStarted', playerId: pid, amount: total, shortfall: total - p.cash, reason });
    const phase: PromptPhase = { kind: 'debt', playerId: pid, amount: total, payments, reason, then };
    if (toll) phase.toll = toll;
    return setPhase(ctx, phase);
  }
  goBankrupt(ctx, pid, payments);
  return endLanding(ctx);
}

function runContinuation(ctx: Ctx, then: Continuation): void {
  switch (then.kind) {
    case 'takeoverCheck':
      return takeoverCheck(ctx, ctx.s.current, then.spaceIndex);
    case 'endLanding':
      return endLanding(ctx);
  }
}

function goBankrupt(ctx: Ctx, pid: PlayerId, payments: Payment[]): void {
  const s = ctx.s;
  const p = player(ctx, pid);
  const playerPayees = [...new Set(payments.map((pm) => pm.to).filter((t): t is number => typeof t === 'number'))];
  const creditor =
    playerPayees.length === 1 && payments.every((pm) => pm.to === playerPayees[0]) ? playerPayees[0]! : null;

  p.bankrupt = true;
  s.bankruptOrder.push(pid);
  emit(ctx, { type: 'Bankrupt', playerId: pid, creditorId: creditor, round: s.round });

  // Remaining cash.
  if (p.cash > 0) {
    if (creditor !== null) {
      pay(ctx, pid, creditor, p.cash, 'bankruptcy');
    } else if (playerPayees.length > 1) {
      const share = Math.floor(p.cash / playerPayees.length);
      for (const q of playerPayees) pay(ctx, pid, q, share, 'bankruptcy');
      if (p.cash > 0) addCash(ctx, pid, -p.cash, 'bankruptcy', 'bank');
    } else {
      addCash(ctx, pid, -p.cash, 'bankruptcy', 'bank');
    }
  }

  // Properties.
  for (const idx of ownedProperties(s, pid)) {
    const prop = propertyAt(s, idx);
    if (creditor !== null) {
      prop.owner = creditor;
      emit(ctx, { type: 'PropertyTransferred', spaceIndex: idx, from: pid, to: creditor, level: prop.level });
    } else {
      prop.owner = null;
      prop.level = 0;
      if (s.festival === idx) {
        s.festival = null;
        emit(ctx, { type: 'FestivalSet', playerId: pid, spaceIndex: null, previous: idx });
      }
      emit(ctx, { type: 'PropertyTransferred', spaceIndex: idx, from: pid, to: null, level: 0 });
    }
  }

  p.cards = [];
  p.islandTurns = 0;
  p.travelPending = false;
  p.expressPending = false;
  p.consecutiveDoubles = 0;
  checkVictory(ctx);
  if (s.settings.endOnFirstBankruptcy) {
    const r = ranking(s);
    finish(ctx, { winnerId: r[0]!.playerId, victory: 'bankruptcy' });
  }
}

// ---------------------------------------------------------------------------
// Victory
// ---------------------------------------------------------------------------

function finish(ctx: Ctx, partial: Omit<GameResult, 'ranking' | 'round'>): never {
  const result: GameResult = { ...partial, round: ctx.s.round, ranking: ranking(ctx.s) };
  // For non-asset victories the winner is ranked first regardless of assets.
  if (result.ranking[0]?.playerId !== result.winnerId) {
    const w = result.ranking.find((r) => r.playerId === result.winnerId)!;
    result.ranking = [w, ...result.ranking.filter((r) => r !== w)];
    result.ranking.forEach((r, i) => (r.rank = i + 1));
  }
  ctx.s.phase = { kind: 'gameOver', result };
  ctx.s.extraRoll = false;
  emit(ctx, { type: 'GameOver', result: deepClone(result) });
  throw new GameEndedSignal();
}

function checkVictory(ctx: Ctx): void {
  if (ctx.s.phase.kind === 'gameOver') throw new GameEndedSignal();
  const v = findVictory(ctx.s, ctx.s.current);
  if (v) finish(ctx, v);
}

function finishOnRoundLimit(ctx: Ctx): never {
  const r = ranking(ctx.s);
  return finish(ctx, { winnerId: r[0]!.playerId, victory: 'roundLimit' });
}

// ---------------------------------------------------------------------------
// Turn flow
// ---------------------------------------------------------------------------

function islandPhase(ctx: Ctx, pid: PlayerId): PromptPhase {
  const p = player(ctx, pid);
  return {
    kind: 'island',
    playerId: pid,
    turnsLeft: p.islandTurns,
    bail: ECONOMY.bail,
    canPayBail: p.cash >= ECONOMY.bail,
    hasEscapeCard: p.cards.includes('escape'),
  };
}

export function travelOptions(position: number, spacesPerSide: 7 | 8 | 9 = 7): number[] {
  const board = getBoardInfo(spacesPerSide);
  return board.board.map((sp) => sp.index).filter((i) => i !== board.islandIndex && i !== position);
}

function startTurn(ctx: Ctx, pid: PlayerId): void {
  const s = ctx.s;
  const p = player(ctx, pid);
  s.current = pid;
  s.turn += 1;
  s.extraRoll = false;
  s.remoteBuildUsed = false;
  p.consecutiveDoubles = 0;
  emit(ctx, { type: 'TurnStarted', playerId: pid, round: s.round, turn: s.turn });
  if (p.islandTurns > 0) return setPhase(ctx, islandPhase(ctx, pid));
  if (p.travelPending) return setPhase(ctx, { kind: 'travel', playerId: pid, options: travelOptions(p.position, s.settings.spacesPerSide ?? 7) });
  return setPhase(ctx, { kind: 'preRoll', playerId: pid, rollAgain: false });
}

function endTurn(ctx: Ctx): void {
  const s = ctx.s;
  const cur = s.current;
  emit(ctx, { type: 'TurnEnded', playerId: cur });
  checkVictory(ctx);
  const n = s.players.length;
  let next = cur;
  for (let k = 0; k < n; k++) {
    next = (next + 1) % n;
    if (!player(ctx, next).bankrupt) break;
  }
  if (next <= cur) {
    if (s.settings.roundLimit !== null && s.round >= s.settings.roundLimit) finishOnRoundLimit(ctx);
    s.round += 1;
    emit(ctx, { type: 'RoundStarted', round: s.round });
  }
  startTurn(ctx, next);
}

/** Resolution of the current landing is complete: roll again on doubles, else end turn. */
function endLanding(ctx: Ctx): void {
  const s = ctx.s;
  const p = player(ctx, s.current);
  if (!p.bankrupt && s.extraRoll && p.islandTurns === 0 && !p.travelPending) {
    return setPhase(ctx, { kind: 'preRoll', playerId: p.id, rollAgain: true });
  }
  return endTurn(ctx);
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/** Walk forward; pays salary when crossing/landing on Start. Returns whether salary was paid. */
function walk(ctx: Ctx, pid: PlayerId, steps: number, cause: 'roll' | 'card' | 'travel' | 'island'): boolean {
  const p = player(ctx, pid);
  const from = p.position;
  if (steps <= 0) return false;
  const board = getBoardInfo(ctx.s.settings.spacesPerSide ?? 7);
  const path = walkPath(from, steps, board.spacesPerSide);
  const to = path[path.length - 1]!;
  const crosses = path.includes(board.startIndex);
  p.position = to;
  emit(ctx, {
    type: 'TokenMoved',
    playerId: pid,
    from,
    to,
    path,
    direction: 'forward',
    mode: 'walk',
    passedStart: crosses,
    cause,
  });
  if (crosses) {
    emit(ctx, { type: 'PassedStart', playerId: pid, salary: ECONOMY.salary, landed: to === board.startIndex });
    receiveFromBank(ctx, pid, ECONOMY.salary, 'salary', board.startIndex);
  }
  return crosses;
}

function walkBack(ctx: Ctx, pid: PlayerId, steps: number): void {
  const p = player(ctx, pid);
  const from = p.position;
  const path = walkPath(from, -steps, ctx.s.settings.spacesPerSide ?? 7);
  const to = path[path.length - 1]!;
  p.position = to;
  emit(ctx, {
    type: 'TokenMoved',
    playerId: pid,
    from,
    to,
    path,
    direction: 'backward',
    mode: 'walk',
    passedStart: false,
    cause: 'card',
  });
}

function sendToIsland(ctx: Ctx, pid: PlayerId, cause: 'space' | 'doubles' | 'card'): void {
  const p = player(ctx, pid);
  const from = p.position;
  const island = getBoardInfo(ctx.s.settings.spacesPerSide ?? 7).islandIndex;
  if (from !== island) {
    p.position = island;
    emit(ctx, {
      type: 'TokenMoved',
      playerId: pid,
      from,
      to: island,
      path: [island],
      direction: 'forward',
      mode: 'jump',
      passedStart: false,
      cause: cause === 'card' ? 'card' : 'roll',
    });
  }
  p.islandTurns = ECONOMY.islandTurns;
  p.consecutiveDoubles = 0;
  ctx.s.extraRoll = false;
  emit(ctx, { type: 'SentToIsland', playerId: pid, cause });
}

interface LandOpts {
  tollMultiplier?: number;
  /** Salary was already paid by the move (forward walk ending on Start). */
  salaryPaid?: boolean;
}

function land(ctx: Ctx, pid: PlayerId, opts: LandOpts = {}): void {
  const s = ctx.s;
  const p = player(ctx, pid);
  const idx = p.position;
  const board = getBoardInfo(s.settings.spacesPerSide ?? 7);
  const sp = space(idx, board.spacesPerSide);
  switch (sp.kind) {
    case 'start':
      if (!opts.salaryPaid) {
        emit(ctx, { type: 'PassedStart', playerId: pid, salary: ECONOMY.salary, landed: true });
        receiveFromBank(ctx, pid, ECONOMY.salary, 'salary', board.startIndex);
      }
      receivePot(ctx, pid);
      if (ruleFlags(s.settings).doubleUp) {
        emit(ctx, { type: 'DoubleUpOffered', playerId: pid, stake: ECONOMY.salary });
        return setPhase(ctx, { kind: 'doubleUp', playerId: pid, stake: ECONOMY.salary, wins: 0 });
      }
      return endLanding(ctx);
    case 'city':
    case 'hub':
      return landOnProperty(ctx, pid, idx, opts.tollMultiplier ?? 1);
    case 'event':
      return ruleFlags(s.settings).cardChoice ? offerCards(ctx, pid) : drawCard(ctx, pid);
    case 'island':
      sendToIsland(ctx, pid, 'space');
      return endTurn(ctx);
    case 'donation': {
      const amt = Math.min(ECONOMY.donation, p.cash);
      pay(ctx, pid, 'pot', amt, 'donation', idx);
      return endLanding(ctx);
    }
    case 'tax': {
      const amt = Math.min(p.cash, round10(p.cash * ECONOMY.taxRate));
      pay(ctx, pid, 'pot', amt, 'tax', idx);
      return endLanding(ctx);
    }
    case 'festival':
      return offerFestival(ctx, pid);
    case 'travel':
      p.travelPending = true;
      s.extraRoll = false;
      emit(ctx, { type: 'TravelGranted', playerId: pid });
      return endLanding(ctx);
  }
}

function landOnProperty(ctx: Ctx, pid: PlayerId, idx: number, mult: number): void {
  const prop = propertyAt(ctx.s, idx);
  if (prop.owner === null) return offerBuy(ctx, pid, idx);
  if (prop.owner === pid) return offerBuild(ctx, pid, idx);
  return payToll(ctx, pid, idx, mult);
}

function offerBuy(ctx: Ctx, pid: PlayerId, idx: number): void {
  const price = priceOf(idx, ctx.s.settings.spacesPerSide ?? 7);
  if (player(ctx, pid).cash >= price) {
    return setPhase(ctx, { kind: 'buy', playerId: pid, spaceIndex: idx, price });
  }
  emit(ctx, { type: 'CannotAfford', playerId: pid, spaceIndex: idx, price });
  if (ctx.s.settings.auction) return startAuction(ctx, pid, idx);
  return endLanding(ctx);
}

function offerBuild(ctx: Ctx, pid: PlayerId, idx: number): void {
  if (!isCity(idx, ctx.s.settings.spacesPerSide ?? 7)) return endLanding(ctx);
  const cost = nextBuildCost(ctx.s, idx);
  if (cost === null || player(ctx, pid).cash < cost) return endLanding(ctx);
  const toLevel = (propertyAt(ctx.s, idx).level + 1) as Level;
  return setPhase(ctx, { kind: 'build', playerId: pid, spaceIndex: idx, toLevel, cost });
}

function payToll(ctx: Ctx, pid: PlayerId, idx: number, mult: number): void {
  const s = ctx.s;
  const p = player(ctx, pid);
  const passAt = p.cards.indexOf('toll-pass');
  if (passAt >= 0 && ruleFlags(s.settings).manualCards) {
    return setPhase(ctx, { kind: 'useCard', playerId: pid, card: 'toll-pass', spaceIndex: idx, multiplier: mult });
  }
  return settleToll(ctx, pid, idx, mult, passAt >= 0);
}

/** Pay the toll at `idx`, or waive it with the payer's Toll Pass (`usePass`). */
function settleToll(ctx: Ctx, pid: PlayerId, idx: number, mult: number, usePass: boolean): void {
  const s = ctx.s;
  const p = player(ctx, pid);
  const ownerId = propertyAt(s, idx).owner!;
  const baseToll = tollOf(s, idx);
  const amount = baseToll * mult;
  const info: TollInfo = { spaceIndex: idx, ownerId, baseToll, festival: s.festival === idx, multiplier: mult };
  // Hub growth: this visit raises the hub's next toll (the current one is already priced).
  if (ruleFlags(s.settings).hubGrowth && isHub(idx, s.settings.spacesPerSide ?? 7)) {
    const v = s.hubVisits?.[idx];
    s.hubVisits = { ...s.hubVisits, [idx]: { owner: ownerId, n: v && v.owner === ownerId ? v.n + 1 : 1 } };
  }
  if (usePass) {
    p.cards.splice(p.cards.indexOf('toll-pass'), 1);
    emit(ctx, { type: 'CardUsed', playerId: pid, card: 'toll-pass' });
    emit(ctx, {
      type: 'TollPaid',
      payerId: pid,
      ownerId,
      spaceIndex: idx,
      amount: 0,
      baseToll,
      festival: info.festival,
      multiplier: mult,
      waived: true,
    });
    return takeoverCheck(ctx, pid, idx);
  }
  return charge(ctx, pid, [{ to: ownerId, amount }], 'toll', { kind: 'takeoverCheck', spaceIndex: idx }, info);
}

function takeoverCheck(ctx: Ctx, pid: PlayerId, idx: number): void {
  const s = ctx.s;
  const p = player(ctx, pid);
  const prop = propertyAt(s, idx);
  if (
    !s.settings.takeover ||
    p.bankrupt ||
    prop.owner === null ||
    prop.owner === pid ||
    !canBeTakenOver(s, idx)
  ) {
    return endLanding(ctx);
  }
  const price = takeoverPrice(s, idx);
  if (p.cash < price) return endLanding(ctx);
  const owner = player(ctx, prop.owner);
  return setPhase(ctx, {
    kind: 'takeover',
    playerId: pid,
    spaceIndex: idx,
    ownerId: owner.id,
    price,
    ownerHasShield: owner.cards.includes('shield'),
  });
}

/** Cities `pid` may hold the festival in: own cities, the current one only to raise its olympics level. */
export function festivalOptions(s: GameState, pid: PlayerId): number[] {
  const olympics = ruleFlags(s.settings).olympics && (s.festivalLevel ?? 1) < ECONOMY.olympicsMultipliers.length;
  return ownedCities(s, pid).filter((i) => i !== s.festival || olympics);
}

function blockTakeover(ctx: Ctx, buyerId: PlayerId, ownerId: PlayerId, idx: number): void {
  const owner = player(ctx, ownerId);
  owner.cards.splice(owner.cards.indexOf('shield'), 1);
  emit(ctx, { type: 'CardUsed', playerId: ownerId, card: 'shield' });
  emit(ctx, { type: 'TakeoverBlocked', buyerId, ownerId, spaceIndex: idx });
  return endLanding(ctx);
}

function completeTakeover(ctx: Ctx, buyerId: PlayerId, ownerId: PlayerId, idx: number, price: number): void {
  emit(ctx, { type: 'TakenOver', buyerId, sellerId: ownerId, spaceIndex: idx, price });
  pay(ctx, buyerId, ownerId, price, 'takeover', idx);
  propertyAt(ctx.s, idx).owner = buyerId;
  checkVictory(ctx);
  if (ECONOMY.buildAfterTakeover) return offerBuild(ctx, buyerId, idx);
  return endLanding(ctx);
}

function offerFestival(ctx: Ctx, pid: PlayerId): void {
  const options = festivalOptions(ctx.s, pid);
  if (options.length === 0) return endLanding(ctx);
  return setPhase(ctx, { kind: 'festival', playerId: pid, options });
}

function setFestival(ctx: Ctx, pid: PlayerId, idx: number): void {
  const previous = ctx.s.festival;
  // Olympics: holding it again on the same city raises the level (×2 → ×3 → ×5); moving resets.
  if (ruleFlags(ctx.s.settings).olympics) {
    ctx.s.festivalLevel = previous === idx ? Math.min(ECONOMY.olympicsMultipliers.length, (ctx.s.festivalLevel ?? 1) + 1) : 1;
  }
  ctx.s.festival = idx;
  emit(ctx, { type: 'FestivalSet', playerId: pid, spaceIndex: idx, previous });
}

// ---------------------------------------------------------------------------
// Auction
// ---------------------------------------------------------------------------

type AuctionPhase = Extract<Phase, { kind: 'auction' }>;

function startAuction(ctx: Ctx, declinedBy: PlayerId, idx: number): void {
  const s = ctx.s;
  const price = priceOf(idx, s.settings.spacesPerSide ?? 7);
  const minBid = round10(price * ECONOMY.auctionStartRate);
  const increment = Math.max(10, round10(price * ECONOMY.auctionIncrementRate));
  const n = s.players.length;
  const order: PlayerId[] = [];
  for (let k = 1; k < n; k++) {
    const q = (declinedBy + k) % n;
    if (!player(ctx, q).bankrupt) order.push(q);
  }
  const active: PlayerId[] = [];
  for (const q of order) {
    if (player(ctx, q).cash >= minBid) active.push(q);
  }
  if (active.length === 0) {
    emit(ctx, { type: 'AuctionEnded', spaceIndex: idx, winnerId: null, price: 0 });
    return endLanding(ctx);
  }
  emit(ctx, { type: 'AuctionStarted', spaceIndex: idx, declinedBy, minBid, bidders: [...active] });
  return setPhase(ctx, {
    kind: 'auction',
    playerId: active[0]!,
    spaceIndex: idx,
    declinedBy,
    order,
    active,
    highBid: null,
    highBidderId: null,
    minBid,
    increment,
  });
}

function advanceAuction(ctx: Ctx, ph: AuctionPhase, lastActor: PlayerId): void {
  const s = ctx.s;
  const active: PlayerId[] = [];
  for (const q of ph.active) {
    if (q === ph.highBidderId || player(ctx, q).cash >= ph.minBid) active.push(q);
    else emit(ctx, { type: 'AuctionDropped', playerId: q, spaceIndex: ph.spaceIndex, reason: 'cannotAfford' });
  }
  const contenders = active.filter((q) => q !== ph.highBidderId);
  if (contenders.length === 0) {
    if (ph.highBidderId !== null && ph.highBid !== null) {
      const w = ph.highBidderId;
      emit(ctx, { type: 'AuctionEnded', spaceIndex: ph.spaceIndex, winnerId: w, price: ph.highBid });
      emit(ctx, { type: 'PropertyBought', playerId: w, spaceIndex: ph.spaceIndex, price: ph.highBid, via: 'auction' });
      pay(ctx, w, 'bank', ph.highBid, 'auction', ph.spaceIndex);
      propertyAt(s, ph.spaceIndex).owner = w;
      checkVictory(ctx);
    } else {
      emit(ctx, { type: 'AuctionEnded', spaceIndex: ph.spaceIndex, winnerId: null, price: 0 });
    }
    return endLanding(ctx);
  }
  const n = ph.order.length;
  const start = ph.order.indexOf(lastActor);
  let next = contenders[0]!;
  for (let k = 1; k <= n; k++) {
    const q = ph.order[(start + k + n) % n]!;
    if (contenders.includes(q)) {
      next = q;
      break;
    }
  }
  return setPhase(ctx, { ...ph, active, playerId: next });
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/** Card content uses the legacy 32-space indexes; corners move with the side stride. */
function canonicalTarget(index: number, spacesPerSide: 7 | 8 | 9): number {
  return Math.floor(index / 8) * (spacesPerSide + 1) + (index % 8);
}

function noEffect(ctx: Ctx, pid: PlayerId, cardId: CardId): void {
  emit(ctx, { type: 'CardNoEffect', playerId: pid, cardId });
  return endLanding(ctx);
}

/** Card choice: draw two different cards and let the player pick one. */
function offerCards(ctx: Ctx, pid: PlayerId): void {
  const a = nextCardId(ctx);
  let b = nextCardId(ctx);
  for (let k = 0; b === a && k < 8; k++) b = nextCardId(ctx);
  if (b === a) b = CARDS[(CARDS.findIndex((c) => c.id === a) + 1) % CARDS.length]!.id;
  const options: [CardId, CardId] = [a, b];
  emit(ctx, { type: 'CardsOffered', playerId: pid, options });
  return setPhase(ctx, { kind: 'cardChoice', playerId: pid, options });
}

function drawCard(ctx: Ctx, pid: PlayerId, chosen?: CardId): void {
  const s = ctx.s;
  const p = player(ctx, pid);
  const cardId = chosen ?? nextCardId(ctx);
  emit(ctx, { type: 'CardDrawn', playerId: pid, cardId });
  const eff = getCard(cardId).effect;
  switch (eff.kind) {
    case 'moveTo': {
      const paid = walk(ctx, pid, distance(p.position, canonicalTarget(eff.target, s.settings.spacesPerSide ?? 7), s.settings.spacesPerSide ?? 7), 'card');
      return land(ctx, pid, { salaryPaid: paid });
    }
    case 'goToIsland':
      sendToIsland(ctx, pid, 'card');
      return endTurn(ctx);
    case 'money':
      if (eff.amount >= 0) {
        receiveFromBank(ctx, pid, eff.amount, 'card');
        return endLanding(ctx);
      }
      return charge(ctx, pid, [{ to: 'bank', amount: -eff.amount }], 'card', { kind: 'endLanding' });
    case 'perBuildingLevel': {
      const levels = ownedCities(s, pid).reduce((sum, i) => sum + propertyAt(s, i).level, 0);
      if (levels === 0) return noEffect(ctx, pid, cardId);
      return charge(ctx, pid, [{ to: 'bank', amount: levels * eff.amount }], 'card', { kind: 'endLanding' });
    }
    case 'collectFromEach': {
      let any = false;
      for (const q of s.players) {
        if (q.id === pid || q.bankrupt) continue;
        const amt = Math.min(eff.amount, q.cash);
        if (amt > 0) {
          pay(ctx, q.id, pid, amt, 'card');
          any = true;
        }
      }
      if (!any) return noEffect(ctx, pid, cardId);
      return endLanding(ctx);
    }
    case 'payEach': {
      const payments: Payment[] = s.players
        .filter((q) => q.id !== pid && !q.bankrupt)
        .map((q) => ({ to: q.id, amount: eff.amount }));
      if (payments.length === 0) return noEffect(ctx, pid, cardId);
      return charge(ctx, pid, payments, 'card', { kind: 'endLanding' });
    }
    case 'moveBack':
      walkBack(ctx, pid, eff.steps);
      return land(ctx, pid, { salaryPaid: false });
    case 'nearestHub': {
      const target = nearestHubAhead(p.position, s.settings.spacesPerSide ?? 7);
      const paid = walk(ctx, pid, distance(p.position, target, s.settings.spacesPerSide ?? 7), 'card');
      return land(ctx, pid, { salaryPaid: paid, tollMultiplier: eff.tollMultiplier });
    }
    case 'keep':
      p.cards.push(eff.card);
      emit(ctx, { type: 'CardKept', playerId: pid, card: eff.card });
      return endLanding(ctx);
    case 'receivePot':
      if (receivePot(ctx, pid) === 0) return noEffect(ctx, pid, cardId);
      return endLanding(ctx);
    case 'express':
      p.expressPending = true;
      emit(ctx, { type: 'ExpressGranted', playerId: pid });
      return endLanding(ctx);
    case 'randomCity': {
      const target = pick(ctx, getBoardInfo(s.settings.spacesPerSide ?? 7).cityIndices);
      const steps = distance(p.position, target, s.settings.spacesPerSide ?? 7);
      const paid = walk(ctx, pid, steps, 'card');
      return land(ctx, pid, { salaryPaid: paid });
    }
    case 'freeUpgrade': {
      const options = ownedCities(s, pid).filter((i) => propertyAt(s, i).level < ECONOMY.maxLevel);
      if (options.length === 0) return noEffect(ctx, pid, cardId);
      return setPhase(ctx, { kind: 'freeUpgrade', playerId: pid, options });
    }
    case 'typhoon': {
      const candidates = getBoardInfo(s.settings.spacesPerSide ?? 7).cityIndices.filter((i) => {
        const pr = propertyAt(s, i);
        return pr.owner !== null && pr.owner !== pid && pr.level >= 1 && pr.level < ECONOMY.maxLevel;
      });
      if (candidates.length === 0) return noEffect(ctx, pid, cardId);
      const idx = pick(ctx, candidates);
      const pr = propertyAt(s, idx);
      pr.level = (pr.level - 1) as Level;
      emit(ctx, { type: 'Demolished', spaceIndex: idx, ownerId: pr.owner!, level: pr.level, cause: 'typhoon' });
      return endLanding(ctx);
    }
    case 'festivalInvite': {
      const options = ownedCities(s, pid).filter((i) => i !== s.festival);
      if (options.length === 0) return noEffect(ctx, pid, cardId);
      setFestival(ctx, pid, pick(ctx, options));
      return endLanding(ctx);
    }
    case 'perHub': {
      const n = hubCount(s, pid);
      if (n === 0) return noEffect(ctx, pid, cardId);
      receiveFromBank(ctx, pid, n * eff.amount, 'card');
      return endLanding(ctx);
    }
    case 'leaderTax': {
      const solvent = s.players.filter((q) => !q.bankrupt);
      const assets = solvent.map((q) => ({ id: q.id, a: totalAssets(s, q.id) }));
      const max = Math.max(...assets.map((x) => x.a));
      const min = Math.min(...assets.map((x) => x.a));
      const richest = assets.filter((x) => x.a === max);
      const poorest = assets.filter((x) => x.a === min);
      if (max === min || richest.length !== 1 || poorest.length !== 1) return noEffect(ctx, pid, cardId);
      const from = player(ctx, richest[0]!.id);
      const amt = Math.min(eff.amount, from.cash);
      if (amt <= 0) return noEffect(ctx, pid, cardId);
      pay(ctx, from.id, poorest[0]!.id, amt, 'card');
      return endLanding(ctx);
    }
  }
}

// ---------------------------------------------------------------------------
// Legal actions
// ---------------------------------------------------------------------------

function remoteBuildOptions(state: GameState, pid: PlayerId): number[] {
  if (!state.settings.buildAnywhere || state.remoteBuildUsed) return [];
  const p = state.players[pid]!;
  return ownedCities(state, pid).filter((i) => {
    const c = nextBuildCost(state, i);
    return c !== null && p.cash >= c;
  });
}

/** Sale options while in debt (or any time for analysis): [action, cash raised]. */
export function saleOptions(state: GameState, pid: PlayerId): Array<{ action: Action; amount: number }> {
  const out: Array<{ action: Action; amount: number }> = [];
  for (const idx of ownedProperties(state, pid)) {
    const b = sellBuildingValue(state, idx);
    if (b !== null) out.push({ action: { type: 'SellBuilding', playerId: pid, spaceIndex: idx }, amount: b });
    out.push({ action: { type: 'SellProperty', playerId: pid, spaceIndex: idx }, amount: sellPropertyValue(state, idx) });
  }
  return out;
}

/** Every legal action in the current phase (empty only when the game is over). */
export function legalActions(state: GameState): Action[] {
  const ph = state.phase;
  if (ph.kind === 'gameOver') return [];
  const pid = ph.playerId;
  const p = state.players[pid]!;
  const pass: Action = { type: 'Pass', playerId: pid };
  switch (ph.kind) {
    case 'preRoll':
      return [
        { type: 'Roll', playerId: pid },
        ...remoteBuildOptions(state, pid).map((i): Action => ({ type: 'Build', playerId: pid, spaceIndex: i })),
      ];
    case 'island': {
      const out: Action[] = [{ type: 'Roll', playerId: pid }];
      if (p.cash >= ECONOMY.bail) out.push({ type: 'PayBail', playerId: pid });
      if (p.cards.includes('escape')) out.push({ type: 'UseEscapeCard', playerId: pid });
      return out;
    }
    case 'travel':
      return [...ph.options.map((i): Action => ({ type: 'ChooseTravel', playerId: pid, spaceIndex: i })), pass];
    case 'buy':
      return p.cash >= ph.price ? [{ type: 'Buy', playerId: pid }, pass] : [pass];
    case 'build':
      return p.cash >= ph.cost ? [{ type: 'Build', playerId: pid, spaceIndex: ph.spaceIndex }, pass] : [pass];
    case 'takeover':
      return p.cash >= ph.price ? [{ type: 'Takeover', playerId: pid }, pass] : [pass];
    case 'festival':
      return [...ph.options.map((i): Action => ({ type: 'SetFestival', playerId: pid, spaceIndex: i })), pass];
    case 'freeUpgrade':
      return [...ph.options.map((i): Action => ({ type: 'FreeUpgrade', playerId: pid, spaceIndex: i })), pass];
    case 'auction':
      return p.cash >= ph.minBid ? [{ type: 'Bid', playerId: pid }, pass] : [pass];
    case 'debt':
      return saleOptions(state, pid).map((o) => o.action);
    case 'cardChoice':
      return ph.options.map((cardId): Action => ({ type: 'ChooseCard', playerId: pid, cardId }));
    case 'doubleUp':
      return [{ type: 'DoubleUpGuess', playerId: pid, parity: 'odd' }, { type: 'DoubleUpGuess', playerId: pid, parity: 'even' }, pass];
    case 'useCard':
      return [{ type: 'UseCard', playerId: pid }, pass];
  }
}

/**
 * The safe default for the current prompt (used by the UI's soft timer):
 * Pass on every decline-able prompt, Roll when a roll is expected, and the cheapest
 * sale in the debt phase.
 */
export function defaultAction(state: GameState): Action | null {
  const ph = state.phase;
  if (ph.kind === 'gameOver') return null;
  const pid = ph.playerId;
  switch (ph.kind) {
    case 'preRoll':
    case 'island':
      return { type: 'Roll', playerId: pid };
    case 'debt': {
      const opts = saleOptions(state, pid);
      const shortfall = ph.amount - state.players[pid]!.cash;
      const covering = opts.filter((o) => o.amount >= shortfall).sort((a, b) => a.amount - b.amount);
      if (covering[0]) return covering[0].action;
      opts.sort((a, b) => a.amount - b.amount);
      return opts[0]!.action;
    }
    case 'cardChoice':
      return { type: 'ChooseCard', playerId: pid, cardId: ph.options[0] };
    case 'useCard':
      // Safe: keep the Toll Pass for a bigger toll; never lose land by letting a shield sleep.
      return ph.card === 'shield' ? { type: 'UseCard', playerId: pid } : { type: 'Pass', playerId: pid };
    default:
      return { type: 'Pass', playerId: pid };
  }
}

export function isLegal(state: GameState, action: Action): boolean {
  return legalActions(state).some((a) => sameAction(a, action));
}

export function sameAction(a: Action, b: Action): boolean {
  if (a.type !== b.type || a.playerId !== b.playerId) return false;
  const ai = 'spaceIndex' in a ? a.spaceIndex : undefined;
  const bi = 'spaceIndex' in b ? b.spaceIndex : undefined;
  const ac = 'cardId' in a ? a.cardId : undefined;
  const bc = 'cardId' in b ? b.cardId : undefined;
  const ap = 'parity' in a ? a.parity : undefined;
  const bp = 'parity' in b ? b.parity : undefined;
  return ai === bi && ac === bc && ap === bp;
}

// ---------------------------------------------------------------------------
// Reduce
// ---------------------------------------------------------------------------

export function reduce(state: GameState, action: Action): ReduceResult {
  const ph = state.phase;
  if (ph.kind === 'gameOver') throw new IllegalActionError('The game is over', action, ph.kind);
  if (action.playerId !== ph.playerId) {
    throw new IllegalActionError(
      `Player ${action.playerId} cannot act in phase ${ph.kind} (waiting for player ${ph.playerId})`,
      action,
      ph.kind,
    );
  }
  if (!isLegal(state, action)) {
    throw new IllegalActionError(`Illegal action ${action.type} in phase ${ph.kind}`, action, ph.kind);
  }
  const s = deepClone(state);
  const ctx: Ctx = { s, ev: [], rng: createRng(s.rng) };
  const before = oneAwayWarnings(state);
  try {
    dispatch(ctx, action);
    checkVictory(ctx);
  } catch (e) {
    if (!(e instanceof GameEndedSignal)) throw e;
  }
  s.rng = ctx.rng.state;
  if (s.phase.kind !== 'gameOver') emitOneAway(ctx, before);
  return { state: s, events: ctx.ev };
}

function emitOneAway(ctx: Ctx, before: OneAwayWarning[]): void {
  const seen = new Set(before.map(oneAwayKey));
  for (const w of oneAwayWarnings(ctx.s)) {
    if (!seen.has(oneAwayKey(w))) emit(ctx, { type: 'OneAway', ...w });
  }
}

function dispatch(ctx: Ctx, action: Action): void {
  const s = ctx.s;
  const ph = s.phase as PromptPhase;
  const pid = action.playerId;
  const p = player(ctx, pid);

  switch (ph.kind) {
    case 'preRoll':
      if (action.type === 'Build') {
        const cost = nextBuildCost(s, action.spaceIndex)!;
        const prop = propertyAt(s, action.spaceIndex);
        pay(ctx, pid, 'bank', cost, 'build', action.spaceIndex);
        prop.level = (prop.level + 1) as Level;
        s.remoteBuildUsed = true;
        emit(ctx, { type: 'Built', playerId: pid, spaceIndex: action.spaceIndex, level: prop.level, cost, free: false });
        return setPhase(ctx, { kind: 'preRoll', playerId: pid, rollAgain: ph.rollAgain });
      }
      return doRoll(ctx, pid, action.type === 'Roll' ? action.gauge : undefined);

    case 'island':
      switch (action.type) {
        case 'Roll':
          return doIslandRoll(ctx, pid);
        case 'PayBail':
          pay(ctx, pid, 'bank', ECONOMY.bail, 'bail', getBoardInfo(s.settings.spacesPerSide ?? 7).islandIndex);
          p.islandTurns = 0;
          emit(ctx, { type: 'Escaped', playerId: pid, method: 'bail' });
          return setPhase(ctx, { kind: 'preRoll', playerId: pid, rollAgain: false });
        case 'UseEscapeCard':
          p.cards.splice(p.cards.indexOf('escape'), 1);
          emit(ctx, { type: 'CardUsed', playerId: pid, card: 'escape' as KeepableCardId });
          p.islandTurns = 0;
          emit(ctx, { type: 'Escaped', playerId: pid, method: 'card' });
          return setPhase(ctx, { kind: 'preRoll', playerId: pid, rollAgain: false });
      }
      break;

    case 'travel':
      p.travelPending = false;
      if (action.type === 'ChooseTravel') {
        s.extraRoll = false;
        const paid = walk(ctx, pid, distance(p.position, action.spaceIndex, s.settings.spacesPerSide ?? 7), 'travel');
        return land(ctx, pid, { salaryPaid: paid });
      }
      emit(ctx, { type: 'TravelDeclined', playerId: pid });
      return setPhase(ctx, { kind: 'preRoll', playerId: pid, rollAgain: false });

    case 'buy':
      if (action.type === 'Buy') {
        emit(ctx, { type: 'PropertyBought', playerId: pid, spaceIndex: ph.spaceIndex, price: ph.price, via: 'buy' });
        pay(ctx, pid, 'bank', ph.price, 'purchase', ph.spaceIndex);
        propertyAt(s, ph.spaceIndex).owner = pid;
        checkVictory(ctx);
        if (ECONOMY.buildOnPurchase) return offerBuild(ctx, pid, ph.spaceIndex);
        return endLanding(ctx);
      }
      if (s.settings.auction) return startAuction(ctx, pid, ph.spaceIndex);
      return endLanding(ctx);

    case 'build':
      if (action.type === 'Build') {
        const prop = propertyAt(s, ph.spaceIndex);
        pay(ctx, pid, 'bank', ph.cost, 'build', ph.spaceIndex);
        prop.level = ph.toLevel;
        emit(ctx, { type: 'Built', playerId: pid, spaceIndex: ph.spaceIndex, level: prop.level, cost: ph.cost, free: false });
      }
      return endLanding(ctx);

    case 'takeover':
      if (action.type === 'Takeover') {
        const owner = player(ctx, ph.ownerId);
        if (owner.cards.includes('shield')) {
          if (ruleFlags(s.settings).manualCards) {
            return setPhase(ctx, { kind: 'useCard', playerId: owner.id, card: 'shield', spaceIndex: ph.spaceIndex, buyerId: pid, price: ph.price });
          }
          return blockTakeover(ctx, pid, owner.id, ph.spaceIndex);
        }
        return completeTakeover(ctx, pid, owner.id, ph.spaceIndex, ph.price);
      }
      return endLanding(ctx);

    case 'cardChoice':
      if (action.type === 'ChooseCard') return drawCard(ctx, pid, action.cardId);
      return endLanding(ctx);

    case 'doubleUp': {
      if (action.type !== 'DoubleUpGuess') return endLanding(ctx);
      // Odd/even of one seeded die: right doubles what is on the line, wrong loses it.
      const die = ctx.rng.int(6) + 1;
      const win = (die % 2 === 1 ? 'odd' : 'even') === action.parity;
      emit(ctx, { type: 'DoubleUpRolled', playerId: pid, die, parity: action.parity, win, stake: ph.stake });
      const start = getBoardInfo(s.settings.spacesPerSide ?? 7).startIndex;
      if (!win) {
        pay(ctx, pid, 'bank', Math.min(ph.stake, p.cash), 'salary', start);
        return endLanding(ctx);
      }
      receiveFromBank(ctx, pid, ph.stake, 'salary', start);
      const wins = ph.wins + 1;
      if (wins >= ECONOMY.doubleUpMaxWins) return endLanding(ctx);
      return setPhase(ctx, { kind: 'doubleUp', playerId: pid, stake: ph.stake * 2, wins });
    }

    case 'useCard':
      if (ph.card === 'toll-pass') return settleToll(ctx, pid, ph.spaceIndex, ph.multiplier ?? 1, action.type === 'UseCard');
      if (action.type === 'UseCard') return blockTakeover(ctx, ph.buyerId!, pid, ph.spaceIndex);
      return completeTakeover(ctx, ph.buyerId!, pid, ph.spaceIndex, ph.price!);

    case 'festival':
      if (action.type === 'SetFestival') setFestival(ctx, pid, action.spaceIndex);
      return endLanding(ctx);

    case 'freeUpgrade':
      if (action.type === 'FreeUpgrade') {
        const prop = propertyAt(s, action.spaceIndex);
        prop.level = (prop.level + 1) as Level;
        emit(ctx, { type: 'Built', playerId: pid, spaceIndex: action.spaceIndex, level: prop.level, cost: 0, free: true });
      }
      return endLanding(ctx);

    case 'auction':
      if (action.type === 'Bid') {
        emit(ctx, { type: 'AuctionBid', playerId: pid, spaceIndex: ph.spaceIndex, amount: ph.minBid });
        return advanceAuction(
          ctx,
          { ...ph, highBid: ph.minBid, highBidderId: pid, minBid: ph.minBid + ph.increment },
          pid,
        );
      }
      emit(ctx, { type: 'AuctionDropped', playerId: pid, spaceIndex: ph.spaceIndex, reason: 'pass' });
      return advanceAuction(ctx, { ...ph, active: ph.active.filter((q) => q !== pid) }, pid);

    case 'debt': {
      if (action.type === 'SellBuilding') {
        const amount = sellBuildingValue(s, action.spaceIndex)!;
        const prop = propertyAt(s, action.spaceIndex);
        prop.level = (prop.level - 1) as Level;
        emit(ctx, { type: 'BuildingSold', playerId: pid, spaceIndex: action.spaceIndex, level: prop.level, amount });
        emit(ctx, { type: 'Demolished', spaceIndex: action.spaceIndex, ownerId: pid, level: prop.level, cause: 'sale' });
        receiveFromBank(ctx, pid, amount, 'sale', action.spaceIndex);
      } else if (action.type === 'SellProperty') {
        const amount = sellPropertyValue(s, action.spaceIndex);
        const prop = propertyAt(s, action.spaceIndex);
        prop.owner = null;
        prop.level = 0;
        if (s.festival === action.spaceIndex) {
          s.festival = null;
          emit(ctx, { type: 'FestivalSet', playerId: pid, spaceIndex: null, previous: action.spaceIndex });
        }
        emit(ctx, { type: 'PropertySold', playerId: pid, spaceIndex: action.spaceIndex, amount });
        receiveFromBank(ctx, pid, amount, 'sale', action.spaceIndex);
      }
      if (p.cash >= ph.amount) {
        settle(ctx, pid, ph.payments, ph.reason, ph.toll);
        emit(ctx, { type: 'DebtSettled', playerId: pid, amount: ph.amount });
        return runContinuation(ctx, ph.then);
      }
      return; // still in debt; phase unchanged
    }
  }
  throw new IllegalActionError(`Unhandled action ${action.type} in phase ${ph.kind}`, action, ph.kind);
}

function doRoll(ctx: Ctx, pid: PlayerId, gauge?: number): void {
  const s = ctx.s;
  const p = player(ctx, pid);
  const dice = nextDice(ctx, gauge);
  s.lastDice = dice;
  const total = dice[0] + dice[1];
  const isDouble = dice[0] === dice[1];
  p.consecutiveDoubles = isDouble ? p.consecutiveDoubles + 1 : 0;
  if (isDouble && p.consecutiveDoubles >= ECONOMY.maxConsecutiveDoubles) {
    emit(ctx, {
      type: 'DiceRolled',
      playerId: pid,
      dice,
      total,
      isDouble,
      consecutiveDoubles: p.consecutiveDoubles,
      express: false,
      steps: 0,
      context: 'normal',
    });
    sendToIsland(ctx, pid, 'doubles');
    return endTurn(ctx);
  }
  const express = p.expressPending;
  p.expressPending = false;
  const steps = total * (express ? 2 : 1);
  s.extraRoll = isDouble;
  emit(ctx, {
    type: 'DiceRolled',
    playerId: pid,
    dice,
    total,
    isDouble,
    consecutiveDoubles: p.consecutiveDoubles,
    express,
    steps,
    context: 'normal',
  });
  const paid = walk(ctx, pid, steps, 'roll');
  return land(ctx, pid, { salaryPaid: paid });
}

function doIslandRoll(ctx: Ctx, pid: PlayerId): void {
  const s = ctx.s;
  const p = player(ctx, pid);
  const dice = nextDice(ctx);
  s.lastDice = dice;
  const total = dice[0] + dice[1];
  const isDouble = dice[0] === dice[1];
  s.extraRoll = false;
  p.consecutiveDoubles = 0;
  if (isDouble) {
    const express = p.expressPending;
    p.expressPending = false;
    const steps = total * (express ? 2 : 1);
    emit(ctx, {
      type: 'DiceRolled',
      playerId: pid,
      dice,
      total,
      isDouble,
      consecutiveDoubles: 0,
      express,
      steps,
      context: 'island',
    });
    p.islandTurns = 0;
    emit(ctx, { type: 'Escaped', playerId: pid, method: 'doubles' });
    const paid = walk(ctx, pid, steps, 'island');
    return land(ctx, pid, { salaryPaid: paid });
  }
  emit(ctx, {
    type: 'DiceRolled',
    playerId: pid,
    dice,
    total,
    isDouble,
    consecutiveDoubles: 0,
    express: false,
    steps: 0,
    context: 'island',
  });
  p.islandTurns -= 1;
  emit(ctx, { type: 'IslandStay', playerId: pid, turnsLeft: p.islandTurns });
  if (p.islandTurns === 0) emit(ctx, { type: 'Escaped', playerId: pid, method: 'served' });
  return endTurn(ctx);
}
