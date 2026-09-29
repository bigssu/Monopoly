/**
 * Board geometry in SVG units: the board is 3200×3200 (100 units = 1 `--u`).
 * Index 0 (Start) is the bottom-right corner; spaces run clockwise on screen:
 * bottom row right→left, left column bottom→top, top row left→right, right column top→bottom.
 */
export const VB = 3200;
/** Ring depth = corner size. */
export const DEPTH = 460;
/** Width of a side space. */
export const SIDE_W = (VB - 2 * DEPTH) / 7;
/** Inner (stage) square. */
export const INNER = { x: DEPTH, y: DEPTH, size: VB - 2 * DEPTH };

export type Edge = 'S' | 'W' | 'N' | 'E';

export interface SpaceGeom {
  index: number;
  corner: boolean;
  /** Board edge this space sits on (corners: the edge that precedes it clockwise). */
  edge: Edge;
  /** Screen rect in board units. */
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  /** Rotation of the local frame (local frame: width × DEPTH, outer edge at the bottom). */
  rot: number;
  /** Local frame size. */
  lw: number;
  lh: number;
}

const EDGE_ROT: Record<Edge, number> = { S: 0, W: 90, N: 180, E: -90 };
/** Corners face diagonally outward. */
const CORNER_ROT: Record<number, number> = { 0: -45, 8: 45, 16: 135, 24: -135 };

function build(): SpaceGeom[] {
  const out: SpaceGeom[] = [];
  for (let i = 0; i < 32; i++) {
    let x = 0;
    let y = 0;
    let w = SIDE_W;
    let h = DEPTH;
    let edge: Edge = 'S';
    const corner = i % 8 === 0;
    if (i === 0) {
      x = VB - DEPTH;
      y = VB - DEPTH;
      w = h = DEPTH;
      edge = 'S';
    } else if (i < 8) {
      x = VB - DEPTH - i * SIDE_W;
      y = VB - DEPTH;
      edge = 'S';
    } else if (i === 8) {
      x = 0;
      y = VB - DEPTH;
      w = h = DEPTH;
      edge = 'W';
    } else if (i < 16) {
      x = 0;
      y = VB - DEPTH - (i - 8) * SIDE_W;
      w = DEPTH;
      h = SIDE_W;
      edge = 'W';
    } else if (i === 16) {
      x = 0;
      y = 0;
      w = h = DEPTH;
      edge = 'N';
    } else if (i < 24) {
      x = DEPTH + (i - 17) * SIDE_W;
      y = 0;
      edge = 'N';
    } else if (i === 24) {
      x = VB - DEPTH;
      y = 0;
      w = h = DEPTH;
      edge = 'E';
    } else {
      x = VB - DEPTH;
      y = DEPTH + (i - 25) * SIDE_W;
      w = DEPTH;
      h = SIDE_W;
      edge = 'E';
    }
    out.push({
      index: i,
      corner,
      edge,
      x,
      y,
      w,
      h,
      cx: x + w / 2,
      cy: y + h / 2,
      rot: corner ? CORNER_ROT[i]! : EDGE_ROT[edge],
      lw: corner ? DEPTH : SIDE_W,
      lh: DEPTH,
    });
  }
  return out;
}

export const GEOM: readonly SpaceGeom[] = build();

/** Rotate a local-frame offset (relative to the space centre) into board units. */
export function localToBoard(g: SpaceGeom, lx: number, ly: number): { x: number; y: number } {
  // Corners keep token offsets axis-aligned.
  const r = ((g.corner ? 0 : g.rot) * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: g.cx + lx * c - ly * s, y: g.cy + lx * s + ly * c };
}

/** Where a token stands on a space (board units), for `n` tokens sharing it. */
export function tokenSpot(index: number, slot: number, n: number): { x: number; y: number } {
  const g = GEOM[index]!;
  const a = g.corner ? 95 : 80;
  const baseY = g.corner ? 30 : -18;
  const offsets: Array<[number, number]> =
    n <= 1
      ? [[0, baseY]]
      : n === 2
        ? [
            [-a, baseY],
            [a, baseY],
          ]
        : n === 3
          ? [
              [-a, baseY - 50],
              [a, baseY - 50],
              [0, baseY + 80],
            ]
          : [
              [-a, baseY - 60],
              [a, baseY - 60],
              [-a, baseY + 90],
              [a, baseY + 90],
            ];
  const [lx, ly] = offsets[Math.min(slot, offsets.length - 1)]!;
  return localToBoard(g, lx, ly);
}
