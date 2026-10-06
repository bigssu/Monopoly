/**
 * FX sprite kit: types, palette, seeded PRNG and small SVG helpers.
 * All sprite artwork in this folder is original to this project (procedural SVG, no text/digits/currency).
 * Pure functions only - no DOM. Consumed by scripts/fx/bake.mjs (bundled with esbuild).
 */
import { mulberry32Step } from '../../engine/rng';

/** color = fixed-colour atlas; mask = white+alpha atlas (runtime tint, additive 'lighter'). */
export type FxClass = 'color' | 'mask';

export interface SpriteDef {
  /** snake_case animation name (also the frame-name prefix: `name/0`, `name/1`, ...). */
  name: string;
  cls: FxClass;
  /** Nominal CSS px at the reference unit (u = 30 px board cell). */
  w: number;
  h: number;
  /** Frame count. */
  n: number;
  /** Suggested playback rate (the runtime clock is 30 Hz, so <= 30). */
  fps: number;
  loop: boolean;
  /** Extra bake shrink for soft sprites (bake px per nominal px = DPR * k). Default 1. */
  k?: number;
  /** True when content is meant to run to the sprite box edge (sweeps / fading lines); silences the baker's clip warning. */
  edgeOk?: boolean;
  /** Keep the whole nominal box (no alpha trim): every frame is a same-size cell, so a DOM element can step
   *  frames with `background-position` without showing neighbours. */
  fixedBox?: boolean;
  /** Also bake frame 0 as a standalone repeatable image `public/fx/tile-<name>.webp` (`background-repeat`). */
  tile?: boolean;
  /** One SVG document per frame; viewBox must be `0 0 w h`. */
  svg: (i: number, n: number) => string;
}

/** Baked device-pixel ratio (raster px per nominal CSS px, before per-sprite k). */
export const BAKE_DPR = 2;

export const C = {
  gold: '#FFC94A',
  goldD: '#E9A92A',
  goldDD: '#B5841A',
  goldL: '#FFE08A',
  ink: '#2B3245',
  red: '#E8564F',
  redD: '#B33A34',
  redL: '#FF8A80',
  blue: '#4A6CF7',
  blueD: '#2F49B8',
  sky: '#6EC1E4',
  skyD: '#3D97C4',
  green: '#5CC689',
  greenD: '#349B65',
  greenDD: '#25874C',
  pink: '#F272A8',
  pinkD: '#B9457A',
  purple: '#9B6BF2',
  orange: '#F5844A',
  orangeD: '#BF5A25',
  brick: '#D9663F',
  brickD: '#A9482A',
  brickL: '#F08A5D',
  wood: '#B98254',
  woodD: '#8A5A34',
  steel: '#8E9BB5',
  steelD: '#5F6C88',
  steelL: '#C9D2E6',
  white: '#FFFFFF',
} as const;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    const [v, n] = mulberry32Step(a);
    a = n;
    return v;
  };
}

/** Format a number for SVG (2 decimals max, no trailing zeros). */
export function f(x: number): string {
  const r = Math.round(x * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

export const clamp = (x: number, a = 0, b = 1): number => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const easeOut = (t: number): number => 1 - (1 - clamp(t)) ** 3;
export const easeOutQuad = (t: number): number => 1 - (1 - clamp(t)) ** 2;
export const easeIn = (t: number): number => clamp(t) ** 2;
export const easeInOut = (t: number): number => {
  const x = clamp(t);
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
};
export const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Complete SVG document. `defs` goes into <defs>. */
export function doc(w: number, h: number, body: string, defs = ''): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
    (defs ? `<defs>${defs}</defs>` : '') +
    body +
    '</svg>'
  );
}

/** Regular star path with rounded feel handled by the caller's stroke-linejoin. */
export function starPath(cx: number, cy: number, ro: number, ri: number, pts = 5, rot = -90): string {
  const parts: string[] = [];
  for (let i = 0; i < pts * 2; i++) {
    const r = i % 2 === 0 ? ro : ri;
    const a = rad(rot + (i * 180) / pts);
    parts.push(`${f(cx + Math.cos(a) * r)} ${f(cy + Math.sin(a) * r)}`);
  }
  return `M${parts.join('L')}Z`;
}

/**
 * 4-point twinkle star with concave sides. `long` = tip radius, `waist` = 0..1 (0 = needle-thin, 1 = diamond).
 * `stretchX` lengthens the horizontal tips (lens-flare feel).
 */
export function spark4(cx: number, cy: number, long: number, waist = 0.18, rot = 0, stretchX = 1): string {
  const a = rad(rot);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const pt = (x: number, y: number): string => `${f(cx + x * ca - y * sa)} ${f(cy + x * sa + y * ca)}`;
  const lx = long * stretchX;
  const w = long * waist;
  return (
    `M${pt(lx, 0)}Q${pt(w, -w)} ${pt(0, -long)}Q${pt(-w, -w)} ${pt(-lx, 0)}` +
    `Q${pt(-w, w)} ${pt(0, long)}Q${pt(w, w)} ${pt(lx, 0)}Z`
  );
}

/** Tapered streak from (x0,y0) tail to (x1,y1) head; head is `wHead` wide, tail comes to a point. */
export function streak(x0: number, y0: number, x1: number, y1: number, wHead: number): string {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (wHead / 2);
  const ny = (dx / len) * (wHead / 2);
  return (
    `M${f(x0)} ${f(y0)}L${f(x1 + nx)} ${f(y1 + ny)}` +
    `A${f(wHead / 2)} ${f(wHead / 2)} 0 0 1 ${f(x1 - nx)} ${f(y1 - ny)}Z`
  );
}

/** Soft radial gradient definition (white -> transparent by default). */
export function radial(id: string, stops: Array<[number, string, number]>): string {
  return (
    `<radialGradient id="${id}">` +
    stops.map(([o, c, a]) => `<stop offset="${f(o)}" stop-color="${c}" stop-opacity="${f(a)}"/>`).join('') +
    '</radialGradient>'
  );
}

/** Ground contact shadow used by the grounded colour sprites (same tone as board icons). */
export function groundShadow(cx: number, cy: number, rx: number, ry: number): string {
  return `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="${C.ink}" opacity=".13"/>`;
}
