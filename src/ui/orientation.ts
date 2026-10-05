/**
 * View orientation policy (DESIGN §2.1 "Fixed view"): the ONE place that decides which way the
 * game screen faces. Engine seats, turn order and saves are never touched; this only maps them
 * to what is drawn.
 *
 *   mode 'table'  2+ humans, or no human at all (all-CPU demo): the table-top model. Panels face
 *                 their seats, the Stage turns toward whoever acts, the result card faces the
 *                 winner. Seats are drawn where they were chosen (identity map).
 *   mode 'fixed'  exactly one human and at least one CPU: effectively solo play on one screen.
 *                 The human is drawn at the bottom (S) and everything faces S: the Stage never
 *                 turns, every panel is upright, money cut-ins / toasts / the result card face S.
 *                 Other players still SIT at their (visual) edges — the CPU hand reaches in from
 *                 there and coins fly to and from there — but nothing is turned toward them.
 *
 * Seat remap (fixed mode): the table is turned in quarter steps until the human's seat is at the
 * bottom, so everyone keeps their place relative to the human (turn order S → E → N → W around
 * the table is preserved). With k = the human's index in S, E, N, W:
 *
 *     view(seat) = CYCLE[(index(seat) − k) mod 4]
 *
 *   human at S: identity          human at E: E→S, N→E, W→N, S→W
 *   human at N: N→S, W→E, S→N, E→W   human at W: W→S, S→E, E→N, N→W
 */
import type { Player, Seat } from '@/engine';

export type ViewMode = 'fixed' | 'table';

/** Seats in turn order around the table (S bottom, E right, N top, W left). */
export const SEAT_CYCLE: readonly Seat[] = ['S', 'E', 'N', 'W'];

type Who = Pick<Player, 'isCpu' | 'seat'>;

/** 'fixed' when exactly one player is human and at least one is a CPU; else 'table'. */
export function viewMode(players: ReadonlyArray<Pick<Player, 'isCpu'>>): ViewMode {
  let humans = 0;
  for (const p of players) if (!p.isCpu) humans++;
  return humans === 1 && players.length - humans >= 1 ? 'fixed' : 'table';
}

/** Turn a seat `k` quarter steps back around the table (k = index of the seat that goes to S). */
export function shiftSeat(seat: Seat, k: number): Seat {
  return SEAT_CYCLE[(((SEAT_CYCLE.indexOf(seat) - k) % 4) + 4) % 4]!;
}

/** Engine seat → drawn seat, for every seat (identity unless fixed mode with the human off S). */
export function seatRemap(players: readonly Who[]): Record<Seat, Seat> {
  const human = viewMode(players) === 'fixed' ? players.find((p) => !p.isCpu) : undefined;
  const k = human ? SEAT_CYCLE.indexOf(human.seat) : 0;
  return { S: shiftSeat('S', k), E: shiftSeat('E', k), N: shiftSeat('N', k), W: shiftSeat('W', k) };
}

export interface Orientation {
  readonly mode: ViewMode;
  /** Shorthand for `mode === 'fixed'`. */
  readonly fixed: boolean;
  /** Where an engine seat is drawn (panel, wallet, CPU-hand edge, coin endpoints). */
  seat(engineSeat: Seat): Seat;
  /** Which seat content for this engine seat faces (Stage, prompts, plaques, labels): S when fixed. */
  face(engineSeat: Seat): Seat;
  /** Seats a table-wide notice is copied to (one copy per seat; fixed: S only). */
  readers(engineSeats: readonly Seat[]): Seat[];
}

/** The orientation of a game with these players. */
export function orientationFor(players: readonly Who[]): Orientation {
  const mode = viewMode(players);
  const map = seatRemap(players);
  const fixed = mode === 'fixed';
  return {
    mode,
    fixed,
    seat: (s) => map[s],
    face: (s) => (fixed ? 'S' : map[s]),
    readers: (seats) => (fixed ? ['S'] : seats.map((s) => map[s])),
  };
}

/** The table-top model with seats drawn where they sit (demos, tests). */
export const TABLE_VIEW: Orientation = orientationFor([]);
