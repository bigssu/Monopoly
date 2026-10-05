/**
 * Game-screen layout (DESIGN §2.1 / §6).
 *
 * The board is a square centred on the screen and as tall as the viewport allows; the
 * seat panels sit in the two side margins in a pinwheel so the board keeps its full height
 * on 16:10 and 16:9 tablets (a pure top/bottom strip layout shrinks the board by ~20%):
 *
 *   ┌──────┬───────────┬──────┐
 *   │ ≡  N │           │  E   │   N: rotate(180°)   E: rotate(-90°)
 *   │──────│   BOARD   │──────│
 *   │  W   │           │  S   │   W: rotate(90°)    S: rotate(0°)
 *   └──────┴───────────┴──────┘
 *
 * Every panel still sits on its own seat's edge of the table (S at the bottom, N at the top,
 * E on the right, W on the left) and faces it. An absent seat lets its column-mate grow.
 * Fixed view (src/ui/orientation.ts, one human vs CPUs): `upright` keeps every panel at 0° — the
 * same boxes, but E / N / W lay out like S (narrow and tall) so the one reader at S never tilts
 * their head. Seats passed in are drawn seats (already remapped).
 * `--board` is set on <html>; everything else scales with `--u` (= board / 32).
 */
import type { Seat } from '@/engine';
import { SEAT_ANGLE, clamp } from './game/util';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SeatBox extends Rect {
  seat: Seat;
  /** Rotation of the panel content. */
  rot: number;
  /** Panel size before rotation (what its content lays out in). */
  innerW: number;
  innerH: number;
}

export interface GameLayout {
  W: number;
  H: number;
  portrait: boolean;
  pad: number;
  board: Rect;
  u: number;
  menu: Rect;
  seats: Partial<Record<Seat, SeatBox>>;
}

export const MENU_SIZE = 48;

export function computeLayout(W: number, H: number, seats: ReadonlySet<Seat>, upright = false): GameLayout {
  const portrait = H > W;
  const pad = Math.round(clamp(Math.min(W, H) * 0.014, 6, 20));
  const minSide = clamp(W * 0.17, 150, 520);
  const size = Math.max(200, Math.floor(Math.min(H - 2 * pad, W - 2 * minSide - 2 * pad)));
  const board: Rect = { x: Math.round((W - size) / 2), y: Math.round((H - size) / 2), w: size, h: size };
  const colW = Math.max(60, board.x - 2 * pad);
  const leftX = pad;
  const rightX = board.x + board.w + pad;
  const ms = Math.round(clamp(Math.min(W, H) * 0.045, MENU_SIZE, 72));
  const menu: Rect = { x: pad, y: pad, w: ms, h: ms };

  const out: Partial<Record<Seat, SeatBox>> = {};
  const box = (seat: Seat, x: number, y: number, h: number): void => {
    const rot = upright ? 0 : SEAT_ANGLE[seat];
    const side = !upright && (seat === 'E' || seat === 'W');
    out[seat] = {
      seat,
      x,
      y,
      w: colW,
      h,
      rot,
      innerW: side ? h : colW,
      innerH: side ? colW : h,
    };
  };

  // Right column: E on top, S at the bottom.
  {
    const full = H - 2 * pad;
    const half = (H - 3 * pad) / 2;
    const hasE = seats.has('E');
    const hasS = seats.has('S');
    if (hasE && hasS) {
      box('E', rightX, pad, half);
      box('S', rightX, pad * 2 + half, half);
    } else if (hasS) {
      const h = Math.min(full, Math.max(half, H * 0.6));
      box('S', rightX, H - pad - h, h);
    } else if (hasE) {
      box('E', rightX, pad, full);
    }
  }
  // Left column: (menu) N on top, W at the bottom.
  {
    const top = pad + ms + pad;
    const full = H - top - pad;
    const half = (H - top - 2 * pad) / 2;
    const hasN = seats.has('N');
    const hasW = seats.has('W');
    if (hasN && hasW) {
      box('N', leftX, top, half);
      box('W', leftX, top + half + pad, half);
    } else if (hasN) {
      const h = Math.min(full, Math.max(half, H * 0.6));
      box('N', leftX, top, h);
    } else if (hasW) {
      box('W', leftX, top, full);
    }
  }

  return { W, H, portrait, pad, board, u: size / 32, menu, seats: out };
}

/** Position an element absolutely at a rect (px). */
export function placeRect(el: HTMLElement, r: Rect): void {
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
}

/** Size + rotate a seat panel so its content faces the seat. */
export function placeSeat(el: HTMLElement, b: SeatBox): void {
  el.style.left = `${b.x + b.w / 2}px`;
  el.style.top = `${b.y + b.h / 2}px`;
  el.style.width = `${b.innerW}px`;
  el.style.height = `${b.innerH}px`;
  el.style.transform = `translate(-50%, -50%) rotate(${b.rot}deg)`;
}

export function setBoardVar(size: number): void {
  document.documentElement.style.setProperty('--board', `${size}px`);
}

/**
 * Observe the viewport and call `fn` (rAF-throttled) with the current size.
 * Returns a disposer.
 */
export function watchViewport(fn: (W: number, H: number) => void): () => void {
  let raf = 0;
  const run = (): void => {
    raf = 0;
    // visualViewport access can force layout; the game uses innerWidth/Height when available.
    const W = window.innerWidth || Math.round(window.visualViewport?.width ?? 0);
    const H = window.innerHeight || Math.round(window.visualViewport?.height ?? 0);
    fn(W, H);
  };
  const schedule = (): void => {
    if (!raf) raf = requestAnimationFrame(run);
  };
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  run();
  return () => {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
  };
}
