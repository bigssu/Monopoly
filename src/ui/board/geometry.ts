/**
 * Board geometry in SVG units: the board is 3200×3200 (100 units = 1 `--u`).
 * Index 0 (Start) is the bottom-right corner; spaces run clockwise on screen:
 * bottom row right→left, left column bottom→top, top row left→right, right column top→bottom.
 */
import type { SpacesPerSide } from '@/engine';

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

function build(size: SpacesPerSide): SpaceGeom[] {
  const out: SpaceGeom[] = [];
  const sideW = (VB - 2 * DEPTH) / size;
  const corners = [0, size + 1, 2 * (size + 1), 3 * (size + 1)];
  for (let i = 0; i < 4 * (size + 1); i++) {
    let x = 0;
    let y = 0;
    let w = sideW;
    let h = DEPTH;
    let edge: Edge = 'S';
    const corner = i % (size + 1) === 0;
    if (i === 0) {
      x = VB - DEPTH;
      y = VB - DEPTH;
      w = h = DEPTH;
      edge = 'S';
    } else if (i < corners[1]!) {
      x = VB - DEPTH - i * sideW;
      y = VB - DEPTH;
      edge = 'S';
    } else if (i === corners[1]!) {
      x = 0;
      y = VB - DEPTH;
      w = h = DEPTH;
      edge = 'W';
    } else if (i < corners[2]!) {
      x = 0;
      y = VB - DEPTH - (i - corners[1]!) * sideW;
      w = DEPTH;
      h = sideW;
      edge = 'W';
    } else if (i === corners[2]!) {
      x = 0;
      y = 0;
      w = h = DEPTH;
      edge = 'N';
    } else if (i < corners[3]!) {
      x = DEPTH + (i - corners[2]! - 1) * sideW;
      y = 0;
      edge = 'N';
    } else if (i === corners[3]!) {
      x = VB - DEPTH;
      y = 0;
      w = h = DEPTH;
      edge = 'E';
    } else {
      x = VB - DEPTH;
      y = DEPTH + (i - corners[3]! - 1) * sideW;
      w = DEPTH;
      h = sideW;
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
      rot: corner ? CORNER_ROT[(i * 8) / (size + 1)]! : EDGE_ROT[edge],
      lw: corner ? DEPTH : sideW,
      lh: DEPTH,
    });
  }
  return out;
}

/**
 * Fixed view (src/ui/orientation.ts: one human, drawn at S): the top row would print upside-down
 * for that reader, so it is turned to read upright from S (rot 0), and the two top corners lean
 * like the bottom ones (±45°). The side columns keep reading along their edge (sideways, never
 * upside-down). Same rects, so hit areas, tokens and effects stay where they were.
 */
function upright(g: SpaceGeom): SpaceGeom {
  if (g.corner) return Math.abs(g.rot) === 135 ? { ...g, rot: Math.sign(g.rot) * 45 } : g;
  return g.edge === 'N' ? { ...g, rot: 0 } : g;
}

const profiles = new Map<string, readonly SpaceGeom[]>();
export function getBoardGeometry(size: SpacesPerSide = 7, uprightTop = false): readonly SpaceGeom[] {
  const key = `${size}${uprightTop ? 'u' : ''}`;
  let geom = profiles.get(key);
  if (!geom) {
    geom = uprightTop ? build(size).map(upright) : build(size);
    profiles.set(key, geom);
  }
  return geom;
}

/** Backward-compatible 7-per-side geometry aliases. */
export const GEOM: readonly SpaceGeom[] = getBoardGeometry();

/** Rotate a local-frame offset (relative to the space centre) into board units. */
export function localToBoard(g: SpaceGeom, lx: number, ly: number): { x: number; y: number } {
  // Corners keep token offsets axis-aligned.
  const r = ((g.corner ? 0 : g.rot) * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: g.cx + lx * c - ly * s, y: g.cy + lx * s + ly * c };
}

/** Where a token stands on a space (board units), for `n` tokens sharing it. */
export function tokenSpot(index: number, slot: number, n: number, size: SpacesPerSide = 7, uprightTop = false): { x: number; y: number } {
  const g = getBoardGeometry(size, uprightTop)[index]!;
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
