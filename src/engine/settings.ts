/**
 * Default settings / player setups.
 */
import { ECONOMY } from './economy';
import type { CpuLevel, PlayerSetup, Seat, Settings } from './types';

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
    ...overrides,
  };
}

export const ROUND_LIMIT_OPTIONS: readonly (number | null)[] = [10, 15, 20, 30, null];
export const START_CASH_OPTIONS: readonly number[] = [2000, 3000, 5000];
export const PROMPT_TIMER_OPTIONS: readonly (0 | 15 | 30)[] = [0, 15, 30];
