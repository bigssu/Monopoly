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
 * the fun rules below. 3 (2026-10-08, docs/research/10-strategy-depth.md, 11-skill-throw.md):
 * stride choice and the skill throw (the dice gauge retires), start investment, monopoly notice and
 * block-buy, chase takeover, news forecast and vault cap. A game keeps the revision it started
 * with, so a saved game from before (no `rulesVersion`) continues with the rules it was played with.
 */
export const RULES_VERSION = 3;

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
  // --- rules version 3 (docs/research/10-strategy-depth.md, 11-skill-throw.md) ---
  /** Stride choice (보폭 선택): roll one die (1–6, no doubles) or two (2–12). */
  strideChoice: boolean;
  /** Skill throw (손맛 던지기): aim at the low or high band; accuracy × SKILL_CAP is the assist chance. */
  skillThrow: boolean;
}

/**
 * Simulation only (scripts/skill.ts ablations): rule flags forced off for every game in this
 * process. The game itself never touches it, and it is empty unless a script fills it.
 */
export const FLAGS_OFF = new Set<keyof RuleFlags>();

export function ruleFlags(settings: Pick<Settings, 'rules' | 'rulesVersion'>): RuleFlags {
  const level = settings.rules ?? 'easy';
  const normal = level !== 'easy';
  const advanced = level === 'advanced';
  const v2 = (settings.rulesVersion ?? 1) >= 2;
  const v3 = (settings.rulesVersion ?? 1) >= 3;
  const flags: RuleFlags = {
    lateToll: normal, cardChoice: normal, manualCards: normal, grandFestival: normal, targeting: normal, finishRound: normal, seatBonus: normal, hiddenCard: normal,
    hubGrowth: advanced,
    doubleUp: advanced,
    // The skill throw replaces the gauge from version 3 (docs/research/11-skill-throw.md).
    diceGauge: advanced && !v3,
    luckyVault: v2 && normal, newsFlash: v2 && normal, comebackCards: v2 && normal, doublesCard: v2 && normal, allOrNothing: v2 && normal,
    winBack: v2 && advanced,
    // Version 3's strategy package is the 'advanced' level only (the setup screen's 전략 모드; 캐주얼
    // 모드 is 'normal' and plays exactly as version 2).
    strideChoice: v3 && advanced,
    skillThrow: v3 && advanced,
  };
  if (FLAGS_OFF.size > 0) for (const k of FLAGS_OFF) flags[k] = false;
  return flags;
}

export const ROUND_LIMIT_OPTIONS: readonly (number | null)[] = [10, 15, 20, 30, null];
export const START_CASH_OPTIONS: readonly number[] = [2000, 3000, 5000];
export const PROMPT_TIMER_OPTIONS: readonly (0 | 15 | 30)[] = [0, 15, 30];
export { BOARD_SIDE_OPTIONS };
