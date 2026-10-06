/**
 * Default settings / player setups.
 */
import { ECONOMY } from './economy';
import type { CpuLevel, PlayerSetup, RuleLevel, Seat, Settings } from './types';
import { BOARD_SIDE_OPTIONS } from '../content/board';

/** Default seats by player count (DESIGN §2.1). */
function defaultSeats(n: number): Seat[] {
  switch (n) {
    case 2:
      return ['S', 'N'];
    case 3:
      return ['S', 'E', 'W'];
    default:
      return ['S', 'E', 'N', 'W'].slice(0, n) as Seat[];
  }
}

const TOKENS = ['car', 'rocket', 'cat', 'robot'];
const COLORS = ['red', 'blue', 'green', 'yellow'];

export function defaultPlayers(n: number, opts: { cpu?: boolean; cpuLevel?: CpuLevel } = {}): PlayerSetup[] {
  const seats = defaultSeats(n);
  return seats.map((seat, i) => ({
    name: opts.cpu ? `CPU ${i + 1}` : `플레이어 ${i + 1}`,
    tokenId: TOKENS[i % TOKENS.length]!,
    colorId: COLORS[i % COLORS.length]!,
    seat,
    isCpu: opts.cpu ?? false,
    cpuLevel: opts.cpuLevel ?? 'normal',
  }));
}

export function defaultSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    players: defaultPlayers(4),
    startCash: ECONOMY.startCash,
    roundLimit: ECONOMY.defaultRoundLimit,
    takeover: true,
    auction: false,
    endOnFirstBankruptcy: true,
    buildAnywhere: false,
    promptTimer: 15,
    spacesPerSide: 7,
    rules: 'normal',
    rulesVersion: RULES_VERSION,
    ...overrides,
  };
}

export const RULE_LEVELS: readonly RuleLevel[] = ['easy', 'normal', 'advanced'];

/**
 * Current rule revision (Settings.rulesVersion). 2 (2026-10-06, docs/research/08-fun-analysis.md):
 * the fun rules below. A game keeps the revision it started with, so a saved game from before
 * (no `rulesVersion`) continues with the rules it was played with.
 */
export const RULES_VERSION = 2;

/** Which optional rules a level turns on (the engine checks flags, never level names). */
export interface RuleFlags {
  lateToll: boolean;
  cardChoice: boolean;
  manualCards: boolean;
  /** Grand festival (대축제): holding the festival again in the same city raises it ×2 → ×3 → ×5. */
  grandFestival: boolean;
  hubGrowth: boolean;
  doubleUp: boolean;
  diceGauge: boolean;
  /** Attack cards (typhoon) target a city the player chooses. */
  targeting: boolean;
  /** A first bankruptcy ends the game when the round completes, not at once. */
  finishRound: boolean;
  /** Later seats start with a little more cash (turn-order advantage). */
  seatBonus: boolean;
  /** One of the two offered event cards is face down. */
  hiddenCard: boolean;
  // --- rules version 2 (docs/research/08-fun-analysis.md) ---
  /** Lucky vault: bail and card fines go into the pot, and the bank adds to it every round. */
  luckyVault: boolean;
  /** News flash: every few rounds a headline changes the board for that round. */
  newsFlash: boolean;
  /** Comeback cards: the city swap / leader raid cards, and the last player is offered one. */
  comebackCards: boolean;
  /** Doubles bonus card: rolling doubles draws an event card before the extra roll. */
  doublesCard: boolean;
  /** All or nothing at the tax office: pay, or roll (4–6 free, 1–3 twice). */
  allOrNothing: boolean;
  /** Win-back: a city lost in a takeover can be taken back for 1× its value. */
  winBack: boolean;
}

export function ruleFlags(settings: Pick<Settings, 'rules' | 'rulesVersion'>): RuleFlags {
  const level = settings.rules ?? 'easy';
  const normal = level !== 'easy';
  const advanced = level === 'advanced';
  const v2 = (settings.rulesVersion ?? 1) >= 2;
  return {
    lateToll: normal, cardChoice: normal, manualCards: normal, grandFestival: normal, targeting: normal, finishRound: normal, seatBonus: normal, hiddenCard: normal,
    hubGrowth: advanced, doubleUp: advanced, diceGauge: advanced,
    luckyVault: v2 && normal, newsFlash: v2 && normal, comebackCards: v2 && normal, doublesCard: v2 && normal, allOrNothing: v2 && normal,
    winBack: v2 && advanced,
  };
}

export const ROUND_LIMIT_OPTIONS: readonly (number | null)[] = [10, 15, 20, 30, null];
export const START_CASH_OPTIONS: readonly number[] = [2000, 3000, 5000];
export const PROMPT_TIMER_OPTIONS: readonly (0 | 15 | 30)[] = [0, 15, 30];
export { BOARD_SIDE_OPTIONS };
