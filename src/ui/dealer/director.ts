/**
 * Dealer director: turns what the table sees into dealer lines (docs/superpowers/specs/
 * 2026-10-04-dealer-voice-design.md). The event sequencer calls `onEvent` as it *plays* each event
 * (so the dealer never spoils a result before its animation), the controller calls `onPrompt` when
 * a decision opens (advice = the CPU policy's choice) and the timer hooks.
 *
 * UI only: reads states, never touches the engine RNG or state. The situation pickers only read the
 * game state; they update the per-game DealerMemo they are given (first landings, streaks, leader).
 */
import {
  chooseAction,
  citiesInGroup,
  getBoardInfo,
  groupOf,
  hubStep,
  ranking,
  ruleFlags,
  type GameEvent,
  type GameState,
  type PlayerId,
} from '@/engine';
import { DEALER_LINES, levelIncludes, SITUATIONS, type DealerLevel, type DealerLine } from './lines';

export type DealerSetting = 'off' | DealerLevel;

/** Per-game memory the pickers need (first landings, leader, warnings). */
export interface DealerMemo {
  greeted: boolean;
  /** Tolls received in a row (reset when that player pays one). */
  tollStreak: Map<PlayerId, number>;
  explained: Set<string>;
  leader: PlayerId | null;
  lowCash: Set<PlayerId>;
}

export const newMemo = (): DealerMemo => ({ greeted: false, tollStreak: new Map(), explained: new Set(), leader: null, lowCash: new Set() });

const LOW_CASH = 300;
const board = (s: GameState) => getBoardInfo(s.settings.spacesPerSide ?? 7).board;

/**
 * Results are spoken on the *reaction* beat — after their animation lands (staging: the action
 * first, then the comment); announcements (turn, round, card, auction, warnings) on the
 * *anticipation* beat, before.
 */
const REACTIONS = new Set<GameEvent['type']>([
  'DiceRolled', 'PassedStart', 'PropertyBought', 'CannotAfford', 'Built', 'TollPaid', 'TakenOver', 'TakeoverBlocked',
  'CardUsed', 'SentToIsland', 'Escaped', 'FestivalSet', 'TravelGranted', 'BuildingSold', 'PropertySold', 'Bankrupt',
  'AuctionEnded', 'MoneyChanged', 'DoubleUpRolled',
]);

/** Situation for an event, called just before its animation (`when: 'before'`) or after it. */
export function situationForEvent(ev: GameEvent, vs: GameState, memo: DealerMemo, when: 'before' | 'after'): string | null {
  if (REACTIONS.has(ev.type) !== (when === 'after') && ev.type !== 'TokenMoved' && ev.type !== 'TurnEnded') return null;
  if (when === 'after' && (ev.type === 'TokenMoved' || ev.type === 'TurnEnded')) {
    if (ev.type === 'TokenMoved') {
      const sp = board(vs)[ev.to]!;
      if (!memo.explained.has(sp.kind)) {
        memo.explained.add(sp.kind);
        return `explain.${sp.kind}`;
      }
      return vs.properties[ev.to]?.owner === ev.playerId ? 'land.own' : null;
    }
    if (ev.type === 'TurnEnded') return afterTurn(vs, memo);
    return null;
  }
  switch (ev.type) {
    case 'RoundStarted': {
      const limit = vs.settings.roundLimit;
      if (limit && ev.round === limit) return 'round.last';
      if (limit && ruleFlags(vs.settings).lateToll && ev.round === limit - 4) return 'late.toll';
      if (limit && ev.round === limit - 2) return 'round.final';
      return ev.round > 1 ? 'round.start' : null;
    }
    case 'TurnStarted': {
      if (!memo.greeted) {
        memo.greeted = true;
        memo.leader = ranking(vs)[0]?.playerId ?? null;
        return 'game.start';
      }
      return `turn.${vs.players[ev.playerId]!.colorId}`;
    }
    case 'DiceRolled':
      if (ev.isDouble && ev.consecutiveDoubles >= 3) return 'doubles.three';
      return ev.isDouble ? 'doubles' : null;
    case 'PassedStart':
      return ev.landed ? 'pass.start.landed' : 'pass.start';
    case 'PropertyBought':
      return completesGroup(vs, ev.playerId, ev.spaceIndex) ? 'monopoly.done' : 'buy.done';
    case 'CannotAfford':
      return 'buy.cant';
    case 'Built':
      return ev.level === 4 ? 'landmark.done' : 'build.done';
    case 'TollPaid': {
      if (ev.waived) return 'toll.waived';
      memo.tollStreak.set(ev.payerId, 0);
      const streak = (memo.tollStreak.get(ev.ownerId) ?? 0) + 1;
      memo.tollStreak.set(ev.ownerId, streak);
      if (streak === 3 || streak === 5) return 'streak.toll';
      const cash = vs.players[ev.payerId]!.cash;
      if (ev.amount >= 1000 || ev.amount >= cash * 0.3) return 'toll.big';
      if (hubStep(vs, ev.spaceIndex) > 1) return 'hub.grow';
      return !vs.players[ev.ownerId]!.isCpu && vs.players[ev.payerId]!.isCpu ? 'toll.receive' : 'toll.small';
    }
    case 'TakenOver':
      return 'takeover.done';
    case 'TakeoverBlocked':
      return 'takeover.blocked';
    case 'CardDrawn':
      return `card.${ev.cardId}`;
    case 'CardUsed':
      return 'card.used';
    case 'SentToIsland':
      return ev.cause === 'doubles' ? null : 'island.enter';
    case 'Escaped':
      return ev.method === 'served' ? null : 'island.escape';
    case 'FestivalSet':
      if (ev.spaceIndex === null) return null;
      return ev.previous === ev.spaceIndex ? 'olympics.up' : 'festival.set';
    case 'CardsOffered':
      return 'card.choice';
    case 'DoubleUpOffered':
      return 'doubleup.offer';
    case 'DoubleUpRolled':
      return ev.win ? 'doubleup.win' : 'doubleup.lose';
    case 'FinalRoundCalled':
      return 'final.round';
    case 'TravelGranted':
      return 'travel.granted';
    case 'DebtStarted':
      return 'debt.start';
    case 'BuildingSold':
    case 'PropertySold':
      return 'sell.done';
    case 'Bankrupt':
      return 'bankrupt';
    case 'AuctionStarted':
      return 'auction.start';
    case 'AuctionEnded':
      return ev.winnerId === null ? null : 'auction.end';
    case 'OneAway':
      return 'one.away';
    case 'MoneyChanged':
      return ev.reason === 'tax' ? 'tax.pay' : ev.reason === 'donation' && ev.delta < 0 ? 'donation.pay' : null;
    case 'GameOver': {
      const v = ev.result.victory;
      return v === 'triple' || v === 'line' || v === 'hubs' || v === 'lastStanding' ? `win.${v}` : 'win.assets';
    }
    default:
      return null;
  }
}

function completesGroup(vs: GameState, pid: PlayerId, index: number): boolean {
  const g = groupOf(index, vs.settings.spacesPerSide ?? 7);
  if (!g) return false;
  return citiesInGroup(g, vs.settings.spacesPerSide ?? 7).every((i) => i === index || vs.properties[i]?.owner === pid);
}

/** After a turn: a new leader, or the player who just moved running low on cash. */
function afterTurn(vs: GameState, memo: DealerMemo): string | null {
  const leader = ranking(vs)[0]?.playerId ?? null;
  const changed = memo.leader !== null && leader !== null && leader !== memo.leader;
  memo.leader = leader;
  if (changed) return 'leader.change';
  const p = vs.players[vs.current];
  if (p && !p.bankrupt && p.cash < LOW_CASH && !memo.lowCash.has(p.id)) {
    memo.lowCash.add(p.id);
    return 'cash.low';
  }
  if (p && p.cash >= LOW_CASH * 2) memo.lowCash.delete(p.id);
  return null;
}

/** Situation when a decision opens: advice for humans (the CPU policy's choice), quips for CPUs. */
export function situationForPrompt(s: GameState): string | null {
  const ph = s.phase;
  if (ph.kind === 'gameOver') return null;
  const p = s.players[ph.playerId]!;
  if (p.isCpu) return ph.kind === 'preRoll' ? null : 'cpu.thinking';
  switch (ph.kind) {
    case 'preRoll':
      return ruleFlags(s.settings).diceGauge ? 'gauge.hint' : 'roll.nudge';
    case 'target':
      return 'target.pick';
    case 'useCard':
      if (ph.card === 'shield') return 'use.shield';
      return chooseAction(s, p.id).type === 'UseCard' ? 'use.pass.yes' : 'use.pass.no';
    case 'buy':
      return chooseAction(s, p.id).type === 'Buy' ? 'buy.advice.yes' : 'buy.advice.no';
    case 'build':
      return chooseAction(s, p.id).type === 'Build' ? 'build.advice.yes' : 'build.advice.no';
    case 'takeover':
      if (ph.ownerHasShield) return 'takeover.shield';
      return chooseAction(s, p.id).type === 'Takeover' ? 'takeover.advice.yes' : 'takeover.advice.no';
    case 'island':
      return 'island.advice';
    case 'festival':
      return 'festival.prompt';
    case 'travel':
      return 'travel.prompt';
    default:
      return null;
  }
}

/** A take of `situation` allowed at `setting`, avoiding the take used last time. */
export function pickLine(situation: string, setting: DealerSetting, last: Map<string, string>, rnd: () => number = Math.random): DealerLine | null {
  if (setting === 'off') return null;
  const s = SITUATIONS[situation];
  if (!s || !levelIncludes(setting, s.level)) return null;
  const takes = DEALER_LINES.filter((l) => l.situation === situation);
  const pool = takes.length > 1 ? takes.filter((l) => l.id !== last.get(situation)) : takes;
  const line = pool[Math.floor(rnd() * pool.length)] ?? null;
  if (line) last.set(situation, line.id);
  return line;
}

export interface Speaker {
  say(line: DealerLine): void;
  dropBelow?(priority: number): void;
  /** A game event or a new decision: a finished line's pose may go back to idle now. */
  relax?(): void;
}

/** Advice starts this long after its prompt appears (staging: card first, then the comment). */
const ADVICE_DELAY_MS = 320;

export class DealerDirector {
  private memo = newMemo();
  private last = new Map<string, string>();

  constructor(
    private readonly dealer: Speaker,
    private readonly setting: () => DealerSetting,
  ) {}

  onEvent(ev: GameEvent, vs: GameState, when: 'before' | 'after'): void {
    this.dealer.relax?.();
    const id = situationForEvent(ev, vs, this.memo, when);
    if (id) this.speak(id);
  }

  onPrompt(s: GameState): void {
    this.dealer.relax?.();
    const id = situationForPrompt(s);
    if (!id) return;
    this.dealer.dropBelow?.(SITUATIONS[id]?.priority ?? 0);
    window.setTimeout(() => this.speak(id), ADVICE_DELAY_MS);
  }

  /** A player asked what the set grid is: explain it (false when the dealer is off). */
  explainSets(): boolean {
    if (this.setting() === 'off') return false;
    this.speak('explain.sets');
    return true;
  }

  onTimerUrgent(): void {
    this.speak('timer.urgent');
  }

  onTimerAuto(): void {
    this.speak('timer.auto');
  }

  /** A resumed game: do not greet again. */
  markResumed(s: GameState): void {
    this.memo.greeted = true;
    this.memo.leader = ranking(s)[0]?.playerId ?? null;
  }

  private speak(situation: string): void {
    const line = pickLine(situation, this.setting(), this.last);
    if (line) this.dealer.say(line);
  }
}
