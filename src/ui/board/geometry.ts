/**
 * Board geometry in SVG units: the board is 3200×3200 (100 units = 1 `--u`).
 * Index 0 (Start) is the bottom-right corner; spaces run clockwise on screen:
 * bottom row right→left, left column bottom→top, top row left→right, right column top→bottom.
 */
import type { SpacesPerSide } from '@/engine';
import { SEAT_ANGLE } from '@/ui/orientation';

export const VB = 3200;
/** Ring depth = corner size. */
export const DEPTH = 460;
/** Width of a side space. */
/** Inner (stage) square. */
export const INNER = { x: DEPTH, y: DEPTH, size: VB - 2 * DEPTH };

type Edge = 'S' | 'W' | 'N' | 'E';

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
      rot: corner ? CORNER_ROT[(i * 8) / (size + 1)]! : SEAT_ANGLE[edge],
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
function localToBoard(g: SpaceGeom, lx: number, ly: number): { x: number; y: number } {
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

// ---------------------------------------------------------------------------------------------
// Pop-out buildings (docs/DESIGN.md §3 "Ownership and buildings"): a built space shows its building
// as its own element standing on the card's INNER edge (the edge facing the Stage) and sticking
// out into the board's inner area, like a house set on the edge of a property card.
// ---------------------------------------------------------------------------------------------

export type BuildingLevel = 1 | 2 | 3 | 4;

/** Building box size per level, as a share of the side space's width (its short side). */
export const BLD_SCALE: Readonly<Record<BuildingLevel, number>> = { 1: 0.55, 2: 0.65, 3: 0.75, 4: 0.95 };
/** Share of a standing building's box that sits on its own card (the rest sticks out). */
export const BLD_ON_CARD = 0.3;
/**
 * The furthest any building reaches into the inner area, as a share of the space width (a standing
 * landmark). Hanging buildings are capped to it; the Stage keeps its controls clear of it
 * (`--bld-out`, stage.css).
 */
export const BLD_OUT_MAX = (1 - BLD_ON_CARD) * BLD_SCALE[4];

export interface BuildingGeom {
  /** Square box in board units (the box is square, so its extent ignores `rot`). */
  x: number;
  y: number;
  size: number;
  cx: number;
  cy: number;
  /** Rotation (deg) that makes the building upright for its reader: the space's text rotation. */
  rot: number;
  /** Roof toward the board centre (base on the card), or hanging under the fixed view's top row. */
  hanging: boolean;
  /** How far the box reaches onto its own card from the inner edge (board units, 0 when hanging). */
  onCard: number;
}

const INWARD: Record<Edge, [number, number]> = { S: [0, -1], N: [0, 1], W: [1, 0], E: [-1, 0] };

/** Does a building on space g hang (upright for its reader, but the inner edge is below it)? */
function hangs(g: SpaceGeom): boolean {
  const r = (g.rot * Math.PI) / 180;
  const [nx, ny] = INWARD[g.edge];
  // The building's "up" after rotation r is (sin r, −cos r); standing = up points inward.
  return Math.sin(r) * nx - Math.cos(r) * ny < 0;
}

/**
 * Where every built space's building stands (board units; null = no building), from each space's
 * level (0 = none; corners never build). `minSize` (board units) keeps small boards' villas from
 * shrinking past a readable size.
 *
 * Next to an inner corner the two adjacent spaces' buildings would meet. When both are built, the
 * one that sticks out further (the fixed view's top row; ties: the space after the corner) slides
 * away from the corner along its edge until it clears the other's reach, and both shrink by the
 * same factor if that is what it takes to keep the sliding one on its own space.
 */
export function buildingLayout(levels: readonly number[], size: SpacesPerSide = 7, uprightTop = false, minSize = 0): (BuildingGeom | null)[] {
  const geom = getBoardGeometry(size, uprightTop);
  const n = geom.length;
  const W = geom[1]!.lw;
  const sizes = geom.map((g, i) => {
    const lv = Math.min(4, levels[i] ?? 0);
    if (g.corner || lv < 1) return 0;
    const s = Math.max(minSize, BLD_SCALE[lv as BuildingLevel] * W);
    return hangs(g) ? Math.min(s, BLD_OUT_MAX * W) : s;
  });
  const out = (i: number): number => (hangs(geom[i]!) ? 1 : 1 - BLD_ON_CARD);
  const shift = new Array<number>(n).fill(0);
  for (let c = 0; c < n; c += size + 1) {
    const before = (c - 1 + n) % n;
    const after = (c + 1) % n;
    if (!sizes[before] || !sizes[after]) continue;
    const [a, b] = out(before) > out(after) ? [before, after] : [after, before];
    const f = Math.min(1, W / (out(b) * sizes[b]! + sizes[a]!));
    sizes[a]! *= f;
    sizes[b]! *= f;
    const reach = out(b) * sizes[b]!;
    const slide = Math.max(0, reach - (W - sizes[a]!) / 2);
    // Away from the corner: forward (index order) after it, backward before it.
    shift[a] = a === after ? slide : -slide;
  }
  return geom.map((g, i) => {
    const s = sizes[i]!;
    if (!s) return null;
    const hanging = hangs(g);
    const on = hanging ? 0 : BLD_ON_CARD;
    const [nx, ny] = INWARD[g.edge];
    // Midpoint of the inner edge, and the along-edge axis pointing in index order.
    const ex = g.edge === 'W' ? g.x + g.w : g.edge === 'E' ? g.x : g.cx;
    const ey = g.edge === 'S' ? g.y : g.edge === 'N' ? g.y + g.h : g.cy;
    const ax = g.edge === 'S' ? -1 : g.edge === 'N' ? 1 : 0;
    const ay = g.edge === 'W' ? -1 : g.edge === 'E' ? 1 : 0;
    const off = s * (0.5 - on);
    const cx = ex + ax * shift[i]! + nx * off;
    const cy = ey + ay * shift[i]! + ny * off;
    return { x: cx - s / 2, y: cy - s / 2, size: s, cx, cy, rot: g.rot, hanging, onCard: on * s };
  });
}

/** One space's building at `level` with no neighbours built (e.g. where a build cut-in lands). */
export function buildingGeom(index: number, level: BuildingLevel, size: SpacesPerSide = 7, uprightTop = false, minSize = 0): BuildingGeom | null {
  const levels: number[] = [];
  levels[index] = level;
  return buildingLayout(levels, size, uprightTop, minSize)[index] ?? null;
}

// ---------------------------------------------------------------------------------------------
// The card face under a standing building (Board.sideSpaceMarkup). Local card frame: lw × DEPTH,
// y = 0 at the inner edge (the edge the building stands on), y = DEPTH at the outer edge. A
// standing building covers y = 0 to onCard; the group pill, the price and the city art move down
// below it, measured from the same `onCard` buildingLayout gives the building (one source).
// ---------------------------------------------------------------------------------------------

/** Card inset of the face's background (local units). */
export const CARD_INSET = 7;
/** Price font size: up to 4 characters, and 5 or more. */
const PRICE_SIZE = { short: 70, long: 54 } as const;
/**
 * The number font's line box (Noto Sans KR, `--font-num`: hhea ascent 1160 / descent 288 per 1000
 * em). The price's rendered box is this tall, not just its digits, so the clearance uses it.
 */
const NUM_ASCENT = 1.16;
const NUM_DESCENT = 0.288;
/** Gap between a building's on-card part and the content moved below it (local units). */
export const BLD_CLEAR = 6;
/** Content offset of a card with no building standing on it (the bare look, base raster). */
const REST_DY = 6;
/** The city art never reaches past this (the name sits below it). */
const ART_BOTTOM = 278;

export interface CardRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CardFace {
  /** How far the content moved down from its rest place. */
  dy: number;
  /** Group pill. */
  pill: CardRect;
  /** Price text: baseline, font size and its line box (null on a space without a price). */
  price: { baseline: number; size: number; box: CardRect } | null;
  /** City art (square); on an owned card its light plate reaches 10 above and below it. */
  art: CardRect;
}

/**
 * Layout of a side card's face (local units) for a building standing `onCard` deep on it (0 = none).
 * `priceChars`: the price string's length (0 = no price: not a city / hub).
 */
export function cardFace(lw: number, onCard: number, priceChars: number): CardFace {
  const m = CARD_INSET;
  const isProp = priceChars > 0;
  const priceSize = priceChars >= 5 ? PRICE_SIZE.long : PRICE_SIZE.short;
  // Tops at dy = 0 of what must clear the building: pill, price line box (tallest size), art plate.
  const pillTop = m + 16;
  const priceBase = m + 67;
  const priceTop = priceBase - NUM_ASCENT * PRICE_SIZE.short;
  const artTop = (isProp ? 99 : 66) - 10;
  const top = Math.min(pillTop, isProp ? priceTop : pillTop, artTop);
  const dy = onCard > 0 ? Math.max(REST_DY, Math.ceil(onCard + BLD_CLEAR - top)) : REST_DY;
  const iconY = (isProp ? 99 : 66) + dy;
  const room = 266 - iconY;
  const iconSize = Math.max(Math.min(80, ART_BOTTOM - iconY), Math.min(isProp ? 152 : 176, room));
  const baseline = priceBase + dy;
  return {
    dy,
    pill: { x: m + 16, y: pillTop + dy, w: 74, h: 52 },
    price: isProp
      ? { baseline, size: priceSize, box: { x: m, y: baseline - NUM_ASCENT * priceSize, w: lw - 2 * m, h: (NUM_ASCENT + NUM_DESCENT) * priceSize } }
      : null,
    art: { x: (lw - iconSize) / 2, y: iconY, w: iconSize, h: iconSize },
  };
}
