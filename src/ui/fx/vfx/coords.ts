/**
 * Coordinates for the FX canvas (VFX.md §3.4). Everything the engine draws is in *layer px*: CSS px
 * relative to the `.fx-layer` box. The game supplies client rects through injected callbacks
 * (Board / PlayerPanel helpers, see docs/VFX-WIRING.md); this module converts them, derives the board
 * unit `u` (= board px / 32, the layout's --u) and handles seat rotation for the multi-seat table.
 */
import type { PlayerId, Seat } from '@/engine';

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Pt {
  x: number;
  y: number;
}

/** Rotation that makes content upright for a seat (same values as `SEAT_ANGLE` in ui/game/util.ts). */
export const SEAT_ANGLE: Record<Seat, number> = { S: 0, E: -90, N: 180, W: 90 };
/** "Up" for a seat = from its panel towards the board centre. */
export const SEAT_DIR: Record<Seat, readonly [number, number]> = { S: [0, -1], N: [0, 1], E: [-1, 0], W: [1, 0] };

/** Rotate (x, y) by `deg` (clockwise on screen, y down — CSS rotate()). */
export function rotateVec(x: number, y: number, deg: number): Pt {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  // Snap tiny values so seat rotations of multiples of 90° are exact.
  const snap = (v: number): number => (Math.abs(v) < 1e-9 ? 0 : v);
  return { x: snap(x * c - y * s), y: snap(x * s + y * c) };
}

/** A seat-local offset (x right, y down as seen by that seat's player) → screen offset. */
export function seatLocal(seat: Seat, x: number, y: number): Pt {
  return rotateVec(x, y, SEAT_ANGLE[seat]);
}

export interface CoordSource {
  /** Client rect of the `.fx-layer` element. */
  getLayerRect(): RectLike;
  /** Client rect of the board (square). */
  getBoardRect(): RectLike;
  /** Client rect of board space `i`. */
  getSpaceRect(i: number): RectLike;
  /** Client rect of a player's panel (null when unknown / gone). */
  getPanelRect(id: PlayerId): RectLike | null;
  /** Seat of a player. */
  getSeat(id: PlayerId): Seat;
  /** Client rect of the stage (board centre square); defaults to the inner board square. */
  getStageRect?(): RectLike;
}

export interface SpaceAnchor extends Pt {
  /** Half of the smaller side of the space (px). */
  r: number;
  w: number;
  h: number;
}

export interface PanelAnchor extends Pt {
  /** Centre of the panel. */
  cx: number;
  cy: number;
  seat: Seat;
  /** Unit vector from the panel towards the board centre. */
  dir: readonly [number, number];
  angle: number;
  w: number;
  h: number;
}

export interface Coords {
  /** Board unit (px): board width / 32. */
  readonly u: number;
  /** Layer size. */
  readonly width: number;
  readonly height: number;
  space(i: number): SpaceAnchor;
  /** Panel anchor: the point on the panel's board-facing edge (R3: effects emit toward the board). */
  panel(id: PlayerId): PanelAnchor;
  seat(id: PlayerId): Seat;
  /** Board centre. */
  center(): Pt;
  /** Stage (inner square) rect in layer px. */
  stage(): RectLike;
  /** Client point → layer px. */
  fromClient(x: number, y: number): Pt;
}

/**
 * Snapshot coordinates (rects are read once per `play()`; the engine never reads layout per frame).
 * Anchors that were read are cached for the lifetime of this object.
 */
export function createCoords(src: CoordSource): Coords {
  const L = src.getLayerRect();
  const B = src.getBoardRect();
  const u = B.width / 32 || 30;
  const spaces = new Map<number, SpaceAnchor>();
  const panels = new Map<PlayerId, PanelAnchor>();
  const fromClient = (x: number, y: number): Pt => ({ x: x - L.x, y: y - L.y });
  const center = (): Pt => fromClient(B.x + B.width / 2, B.y + B.height / 2);
  return {
    u,
    width: L.width,
    height: L.height,
    fromClient,
    center,
    seat: (id) => src.getSeat(id),
    space(i) {
      let a = spaces.get(i);
      if (!a) {
        const r = src.getSpaceRect(i);
        const p = fromClient(r.x + r.width / 2, r.y + r.height / 2);
        a = { x: p.x, y: p.y, w: r.width, h: r.height, r: Math.min(r.width, r.height) / 2 };
        spaces.set(i, a);
      }
      return a;
    },
    panel(id) {
      let a = panels.get(id);
      if (!a) {
        const seat = src.getSeat(id);
        const dir = SEAT_DIR[seat];
        const r = src.getPanelRect(id);
        const c = center();
        let cx: number;
        let cy: number;
        let w: number;
        let h: number;
        if (r) {
          const p = fromClient(r.x + r.width / 2, r.y + r.height / 2);
          cx = p.x;
          cy = p.y;
          w = r.width;
          h = r.height;
        } else {
          // No panel: the board edge on that seat's side.
          cx = c.x - dir[0] * B.width * 0.55;
          cy = c.y - dir[1] * B.height * 0.55;
          w = h = u * 6;
        }
        // Board-facing edge, pulled in by 20 % of the depth so sprites start over the panel.
        const depth = dir[0] !== 0 ? w : h;
        const k = depth * 0.3;
        a = { x: cx + dir[0] * k, y: cy + dir[1] * k, cx, cy, seat, dir, angle: SEAT_ANGLE[seat], w, h };
        panels.set(id, a);
      }
      return a;
    },
    stage() {
      if (src.getStageRect) {
        const r = src.getStageRect();
        const p = fromClient(r.x, r.y);
        return { x: p.x, y: p.y, width: r.width, height: r.height };
      }
      // Inner square: the ring depth is 460 / 3200 of the board.
      const d = (B.width * 460) / 3200;
      const p = fromClient(B.x + d, B.y + d);
      return { x: p.x, y: p.y, width: B.width - 2 * d, height: B.height - 2 * d };
    },
  };
}
