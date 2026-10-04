/**
 * Default settings / player setups.
 */
import { ECONOMY } from './economy';
import type { CpuLevel, PlayerSetup, RuleLevel, Seat, Settings } from './types';
import { BOARD_SIDE_OPTIONS } from '../content/board';

/** Default seats by player count (DESIGN §2.1). */
export function defaultSeats(n: number): Seat[] {
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
    ...overrides,
  };
}

export const RULE_LEVELS: readonly RuleLevel[] = ['easy', 'normal', 'advanced'];

/** Which optional rules a level turns on (the engine checks flags, never level names). */
export interface RuleFlags {
  lateToll: boolean;
  cardChoice: boolean;
  manualCards: boolean;
  olympics: boolean;
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
}

export function ruleFlags(settings: Pick<Settings, 'rules'>): RuleFlags {
  const level = settings.rules ?? 'easy';
  const normal = level !== 'easy';
  const advanced = level === 'advanced';
  return {
    lateToll: normal, cardChoice: normal, manualCards: normal, olympics: normal, targeting: normal, finishRound: normal, seatBonus: normal, hiddenCard: normal,
    hubGrowth: advanced, doubleUp: advanced, diceGauge: advanced,
  };
}

export const ROUND_LIMIT_OPTIONS: readonly (number | null)[] = [10, 15, 20, 30, null];
export const START_CASH_OPTIONS: readonly number[] = [2000, 3000, 5000];
export const PROMPT_TIMER_OPTIONS: readonly (0 | 15 | 30)[] = [0, 15, 30];
export { BOARD_SIDE_OPTIONS };
