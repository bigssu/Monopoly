/**
 * The Setup screen's editable draft and its conversion to engine `Settings`.
 * Pure (no DOM) so it is unit-tested; the draft is persisted in prefs (`lastSetup`).
 */
import {
  defaultSettings,
  PROMPT_TIMER_OPTIONS,
  ROUND_LIMIT_OPTIONS,
  START_CASH_OPTIONS,
  type PlayerSetup,
  type Seat,
  type Settings,
} from '@/engine';
import { PLAYER_COLORS, TOKEN_IDS } from '@/content/palette';

/** Seat order used for turn order and for the players array. */
export const SEAT_ORDER: readonly Seat[] = ['S', 'E', 'N', 'W'];

export type Controller = 'human' | 'easy' | 'normal';

export interface SeatDraft {
  on: boolean;
  /** `null` = automatic "플레이어 n" (numbered among the active seats). */
  name: string | null;
  tokenId: string;
  colorId: string;
  controller: Controller;
}

export interface SetupDraft {
  seats: Record<Seat, SeatDraft>;
  roundLimit: number | null;
  startCash: number;
  takeover: boolean;
  auction: boolean;
  endOnFirstBankruptcy: boolean;
  promptTimer: 0 | 15 | 30;
}

export const NAME_MAX = 10;

const SEAT_DEFAULTS: Record<Seat, { tokenId: string; colorId: string }> = {
  S: { tokenId: 'car', colorId: 'red' },
  E: { tokenId: 'rocket', colorId: 'blue' },
  N: { tokenId: 'cat', colorId: 'green' },
  W: { tokenId: 'robot', colorId: 'yellow' },
};

export function defaultDraft(): SetupDraft {
  const base = defaultSettings();
  const seat = (s: Seat, on: boolean): SeatDraft => ({ on, name: null, ...SEAT_DEFAULTS[s], controller: 'human' });
  return {
    seats: { S: seat('S', true), E: seat('E', false), N: seat('N', true), W: seat('W', false) },
    roundLimit: base.roundLimit,
    startCash: base.startCash,
    takeover: base.takeover,
    auction: base.auction,
    endOnFirstBankruptcy: base.endOnFirstBankruptcy,
    promptTimer: base.promptTimer,
  };
}

export function activeSeats(d: SetupDraft): Seat[] {
  return SEAT_ORDER.filter((s) => d.seats[s].on);
}

/** 1-based number of a seat among the active seats (for the automatic name). */
export function seatNumber(d: SetupDraft, seat: Seat): number {
  return Math.max(1, activeSeats(d).indexOf(seat) + 1);
}

export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

/**
 * Coerce anything (e.g. an old/corrupt stored draft) into a valid draft.
 * Guarantees: S is on, ≥ 2 seats on, unique colors and tokens among active seats.
 */
export function normalizeDraft(raw: unknown): SetupDraft {
  const def = defaultDraft();
  if (!raw || typeof raw !== 'object') return def;
  const r = raw as Partial<SetupDraft>;
  const out: SetupDraft = {
    seats: { ...def.seats },
    roundLimit: ROUND_LIMIT_OPTIONS.includes(r.roundLimit as number | null) ? (r.roundLimit as number | null) : def.roundLimit,
    startCash: START_CASH_OPTIONS.includes(r.startCash as number) ? (r.startCash as number) : def.startCash,
    takeover: typeof r.takeover === 'boolean' ? r.takeover : def.takeover,
    auction: typeof r.auction === 'boolean' ? r.auction : def.auction,
    endOnFirstBankruptcy: typeof r.endOnFirstBankruptcy === 'boolean' ? r.endOnFirstBankruptcy : def.endOnFirstBankruptcy,
    promptTimer: PROMPT_TIMER_OPTIONS.includes(r.promptTimer as 0 | 15 | 30) ? (r.promptTimer as 0 | 15 | 30) : def.promptTimer,
  };
  const seats = (r.seats ?? {}) as Partial<Record<Seat, Partial<SeatDraft>>>;
  for (const s of SEAT_ORDER) {
    const v = seats[s] ?? {};
    const d = def.seats[s];
    out.seats[s] = {
      on: s === 'S' ? true : typeof v.on === 'boolean' ? v.on : d.on,
      name: typeof v.name === 'string' && cleanName(v.name) ? cleanName(v.name) : null,
      tokenId: TOKEN_IDS.includes(v.tokenId as string) ? (v.tokenId as string) : d.tokenId,
      colorId: PLAYER_COLORS.some((c) => c.id === v.colorId) ? (v.colorId as string) : d.colorId,
      controller: v.controller === 'easy' || v.controller === 'normal' || v.controller === 'human' ? v.controller : 'human',
    };
  }
  if (activeSeats(out).length < 2) out.seats.N.on = true;
  dedupe(out);
  return out;
}

/** Give later active seats a free color/token when they collide with an earlier one. */
export function dedupe(d: SetupDraft): void {
  const usedC = new Set<string>();
  const usedT = new Set<string>();
  for (const s of activeSeats(d)) {
    const seat = d.seats[s];
    if (usedC.has(seat.colorId)) seat.colorId = PLAYER_COLORS.find((c) => !usedC.has(c.id))!.id;
    if (usedT.has(seat.tokenId)) seat.tokenId = TOKEN_IDS.find((id) => !usedT.has(id))!;
    usedC.add(seat.colorId);
    usedT.add(seat.tokenId);
  }
}

/** Turn a seat on (giving it a free color/token) or off. S cannot be turned off. */
export function toggleSeat(d: SetupDraft, seat: Seat): void {
  if (seat === 'S') return;
  const s = d.seats[seat];
  if (s.on) {
    if (activeSeats(d).length <= 2) return;
    s.on = false;
    return;
  }
  const others = activeSeats(d).map((x) => d.seats[x]);
  if (others.some((o) => o.colorId === s.colorId)) {
    s.colorId = PLAYER_COLORS.find((c) => !others.some((o) => o.colorId === c.id))!.id;
  }
  if (others.some((o) => o.tokenId === s.tokenId)) {
    s.tokenId = TOKEN_IDS.find((id) => !others.some((o) => o.tokenId === id))!;
  }
  s.on = true;
}

/** Pick a color/token for a seat; if another active seat has it, the two swap. */
export function pick(d: SetupDraft, seat: Seat, field: 'colorId' | 'tokenId', value: string): void {
  const me = d.seats[seat];
  if (me[field] === value) return;
  const holder = activeSeats(d).find((s) => s !== seat && d.seats[s][field] === value);
  if (holder) d.seats[holder][field] = me[field];
  me[field] = value;
}

/** i18n key of the first problem, or null when the draft can start a game. */
export function validateDraft(d: SetupDraft): string | null {
  const act = activeSeats(d);
  if (act.length < 2) return 'setup.needTwo';
  if (new Set(act.map((s) => d.seats[s].colorId)).size !== act.length) return 'setup.dupColor';
  return null;
}

/**
 * Engine settings for a draft. Players are listed in seat order S, E, N, W; the list is
 * rotated by a random offset so the starting seat is random (DESIGN §4.1) while the
 * turn order around the table is kept.
 */
export function buildSettings(
  d: SetupDraft,
  autoName: (n: number) => string,
  random: () => number = Math.random,
): { settings: Settings; seed: number } {
  const act = activeSeats(d);
  const players: PlayerSetup[] = act.map((seat, i) => {
    const s = d.seats[seat];
    return {
      name: s.name ?? autoName(i + 1),
      tokenId: s.tokenId,
      colorId: s.colorId,
      seat,
      isCpu: s.controller !== 'human',
      cpuLevel: s.controller === 'easy' ? 'easy' : 'normal',
    };
  });
  const start = Math.floor(random() * players.length) % players.length;
  const rotated = [...players.slice(start), ...players.slice(0, start)];
  const settings = defaultSettings({
    players: rotated,
    roundLimit: d.roundLimit,
    startCash: d.startCash,
    takeover: d.takeover,
    auction: d.auction,
    endOnFirstBankruptcy: d.endOnFirstBankruptcy,
    promptTimer: d.promptTimer,
  });
  const seed = Math.floor(random() * 0x1_0000_0000) >>> 0;
  return { settings, seed };
}
