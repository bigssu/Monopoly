/**
 * The board: an SVG ring of 7/8/9 spaces per side, the Stage host in the
 * middle and an HTML token layer on top (tokens hop with the Web Animations API).
 */
import { festivalMultiplier, getBoard, hubStep, oneAwayWarnings, type GameState, type Player, type PlayerId, type SpaceDef, type SpacesPerSide } from '@/engine';
import { inkOn, playerColor } from '@/content/palette';
import { getLang, loc, fmtMoney, t } from '@/i18n';
import { sfx } from '@/ui/audio/sfx';
import { haptic } from '@/ui/audio/haptics';
import { anim, animSpeed, D, gridTimeout, isSkipping, noMotion, onFrame } from '@/ui/fx/time';
import { groupColor, h, iconId, setPlayerVars, spaceIcon, svg, svgArt, svgNode } from '@/ui/game/util';
import { atlasSvg } from '@/ui/game/iconAtlas';
import { BLD_OUT_MAX, DEPTH, INNER, VB, buildingGeom, buildingLayout, getBoardGeometry, tokenSpot, type BuildingGeom, type BuildingLevel, type SpaceGeom } from './geometry';
import { EASE } from '@/ui/fx/motion';

const NS = 'http://www.w3.org/2000/svg';

/** Pop-out building icon per level. */
const BUILDING_ICON: Record<BuildingLevel, string> = { 1: 'villa', 2: 'building', 3: 'hotel', 4: 'landmark' };

const CORNER_BG: Record<string, string> = {
  start: '#DDF3E4',
  island: '#D6EEF8',
  festival: '#FBE1EC',
  travel: '#E2E7FD',
};
const SPECIAL_BAR: Record<string, string> = {
  event: '#F2B633',
  tax: '#8A94A6',
  donation: '#F272A8',
};

// ---------------------------------------------------------------------------------------------
// Base-raster mode (docs/PERFORMANCE.md "보드 정적 래스터화"): while the static board image is
// generated, the markup functions below emit self-contained icon art (an SVG image cannot reach
// the page's icon sprite) and hand their text to `baseTexts` instead of emitting <text> (an SVG
// image cannot use the page's web fonts either: the text is drawn with canvas fillText).
// ---------------------------------------------------------------------------------------------

interface BaseText {
  cls: string;
  x: number;
  y: number;
  size: number;
  text: string;
  m: DOMMatrix;
}
let baseTexts: BaseText[] | null = null;
/** Atlas patterns the markup below referenced (Board.render moves them into its <defs>). */
const atlasDefs = new Map<string, string>();
let baseMatrix: DOMMatrix | null = null;

function textEl(cls: string, x: number, y: number, size: number, text: string): string {
  if (baseTexts && baseMatrix) {
    baseTexts.push({ cls, x, y, size, text, m: baseMatrix });
    return '';
  }
  return `<text class="${cls}" x="${x}" y="${y}" font-size="${size.toFixed(1)}" text-anchor="middle">${esc(text)}</text>`;
}

/**
 * Nested <svg> icon at a position (board units). Live board: from the icon bitmap atlas when it
 * has the icon (two elements instead of a `<use>` shadow tree), else the sprite. `tint` = the
 * color `currentColor` resolves to there (buildings: the owner color).
 */
function iconAt(id: string, x: number, y: number, size: number, cls = '', tint?: string): string {
  if (!baseTexts) {
    const bm = atlasSvg(iconId(id), x, y, size, cls, tint);
    if (bm) {
      if (!atlasDefs.has(bm.defId)) atlasDefs.set(bm.defId, bm.def);
      return bm.markup;
    }
  }
  return (baseTexts ? svgArt(id) : svg(id)).replace(
    '<svg ',
    `<svg x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${size}" height="${size}" class="${cls}" `,
  );
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function estWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (/[ᄀ-ᇿ㄰-㆏가-힯]/.test(ch)) w += 1;
    else if (ch === ' ') w += 0.3;
    else if (ch === '.') w += 0.3;
    else if (/[A-Z]/.test(ch)) w += 0.7;
    else w += 0.56;
  }
  return w;
}

/** Preferred line breaks for long Korean names (syllable index). */
const KO_BREAK: Record<string, number> = { 우주정거장: 2, 고속열차역: 2, 부에노스아이레스: 4, 멕시코시티: 3, 케이프타운: 3 };

/** Fit a label into `maxW` (board units): one line, or two lines when it would get tiny. */
export function fitLabel(text: string, maxW: number, maxFont: number): { lines: string[]; size: number } {
  const one = Math.min(maxFont, maxW / estWidth(text));
  if (one >= maxFont * 0.8) return { lines: [text], size: one };
  let a: string;
  let b: string;
  const sp = text.indexOf(' ');
  if (sp > 0) {
    // Split at the space nearest the middle.
    const spaces = [...text].map((c, i) => (c === ' ' ? i : -1)).filter((i) => i > 0);
    const mid = text.length / 2;
    const at = spaces.reduce((best, i) => (Math.abs(i - mid) < Math.abs(best - mid) ? i : best), spaces[0]!);
    a = text.slice(0, at);
    b = text.slice(at + 1);
  } else if (/[가-힯]/.test(text)) {
    // Korean: up to 4 syllables stay on one line; longer names break at a natural point.
    if (text.length <= 4) return { lines: [text], size: one };
    const cut = KO_BREAK[text] ?? Math.ceil(text.length / 2);
    a = text.slice(0, cut);
    b = text.slice(cut);
  } else {
    return { lines: [text], size: Math.max(one, maxFont * 0.6) };
  }
  const two = Math.min(maxFont * 0.88, maxW / Math.max(estWidth(a), estWidth(b)));
  return one >= two * 0.95 ? { lines: [text], size: one } : { lines: [a, b], size: two };
}

function textLines(
  lines: string[],
  size: number,
  cx: number,
  baseY: number,
  cls: string,
  lineGap = 1.02,
): string {
  if (lines.length === 1) return textEl(cls, cx, baseY, size, lines[0]!);
  const y0 = baseY - (size * lineGap) / 2;
  return lines.map((l, i) => textEl(cls, cx, +(y0 + i * size * lineGap).toFixed(1), size, l)).join('');
}

interface SpaceView {
  owner: PlayerId | null;
  level: number;
  /** Festival multiplier on this space (0 = no festival): ×2, or the olympics ×3 / ×5. */
  festival: number;
  /** Hub growth step (1 = none). */
  boost: number;
  pot: number;
  ring: string | null;
  lang: string;
  /** How far the space's pop-out building stands on this card (board units from the inner edge). */
  bldOn: number;
}

function sideSpaceMarkup(sp: SpaceDef, g: SpaceGeom, v: SpaceView, players: readonly Player[]): string {
  const w = g.lw;
  const hgt = g.lh;
  const m = 7;
  const bar = sp.kind === 'city' || sp.kind === 'hub' ? groupColor(sp)! : (SPECIAL_BAR[sp.kind] ?? '#CBD2DE');
  const isProp = sp.kind === 'city' || sp.kind === 'hub';
  const owner = v.owner !== null ? players[v.owner] : undefined;
  const oc = owner ? playerColor(owner.colorId) : null;
  const parts: string[] = [];
  // Ownership: the whole card takes the owner's color (DESIGN.md §3); text switches to an ink that
  // reads on that color (palette `inkOn`), the city art sits on a light plate. The building is not
  // drawn here: it stands on the card's inner edge as its own element (Board.renderBuilding).
  parts.push(
    `<rect class="sp-bg${oc ? ' is-owned' : ''}" x="${m}" y="${m}" width="${w - 2 * m}" height="${hgt - 2 * m}" rx="30" fill="${oc ? oc.hex : '#F7FCFC'}"/>`,
  );
  // A compact category badge makes adjacent destinations read as separate cards (and keeps the
  // color group readable on an owner-filled card: white ring).
  // A standing pop-out building covers the top `bldOn` of the card (geometry.ts buildingLayout):
  // badge and price move down below it, the city art shrinks into what is left above the name.
  const dy = Math.max(0, Math.round(v.bldOn + 22 - 16));
  parts.push(
    `<rect class="sp-group-badge${oc ? ' on-owner' : ''}" x="${m + 16}" y="${m + 16 + dy}" width="74" height="52" rx="26" fill="${bar}"/>`,
  );
  const txt = oc ? ' on-owner' : '';
  if (isProp) {
    const price = fmtMoney(sp.price ?? 0);
    parts.push(textEl(`sp-price${txt}`, w / 2, m + 67 + dy, price.length >= 5 ? 54 : 70, price));
  }
  // Landmark icon (on an owner-filled card: on a light plate so the city art keeps its colors).
  const iconY = (isProp ? 99 : 66) + dy;
  const iconSize = Math.max(80, Math.min(isProp ? 152 : 176, 266 - iconY));
  if (oc) parts.push(`<rect class="sp-plate" x="${(w - iconSize) / 2 - 14}" y="${iconY - 10}" width="${iconSize + 28}" height="${iconSize + 20}" rx="44"/>`);
  parts.push(iconAt(spaceIcon(sp), (w - iconSize) / 2, iconY, iconSize));
  // Name.
  const name = loc(sp.short);
  const fit = fitLabel(name, w - 40, 92);
  parts.push(textLines(fit.lines, fit.size, w / 2, fit.lines.length === 1 ? 388 : 386, `sp-name${txt}`));
  if (v.festival) {
    const fs = dy > 40 ? 96 : 124;
    parts.push(iconAt('festival-marker', w - fs - 14, Math.min(96 + dy, 270 - fs), fs, 'sp-fest'));
    parts.push(xBadge(Math.min(104 + dy, 212), '#E8564F', v.festival));
  }
  if (v.boost > 1) parts.push(xBadge(Math.min(104 + dy, 212), '#2EC4B6', v.boost));
  if (!oc) return parts.join('');
  const ink = inkOn(oc);
  return `<g class="sp-own" style="--own-ink:${ink.ink};--own-halo:${ink.halo}">${parts.join('')}</g>`;
}

/** "×2" pill (festival / hub growth) at local y. */
function xBadge(y: number, fill: string, n: number): string {
  return `<g class="sp-x2"><rect x="14" y="${y}" width="96" height="58" rx="29" fill="${fill}"/><text x="62" y="${y + 43}" font-size="44" text-anchor="middle" fill="#fff">×${n}</text></g>`;
}

function cornerMarkup(sp: SpaceDef, g: SpaceGeom, v: SpaceView): string {
  const s = g.lw;
  const parts: string[] = [];
  parts.push(
    `<circle class="sp-bg sp-corner-disc" cx="${s / 2}" cy="${s / 2}" r="${s / 2 - 15}" fill="${CORNER_BG[sp.kind] ?? '#E9F8F5'}"/>`,
    `<circle class="sp-corner-ring" cx="${s / 2}" cy="${s / 2}" r="${s / 2 - 39}" fill="none"/>`,
  );
  parts.push(`<g transform="rotate(${g.rot} ${s / 2} ${s / 2})">`);
  const outer = baseMatrix;
  if (outer) baseMatrix = outer.translate(s / 2, s / 2).rotate(g.rot).translate(-s / 2, -s / 2);
  const hasPot = sp.kind === 'start' && v.pot > 0;
  const iconSize = hasPot ? 160 : 210;
  parts.push(iconAt(spaceIcon(sp), s / 2 - iconSize / 2, hasPot ? 128 : 72, iconSize));
  const fit = fitLabel(loc(sp.name), 300, 80);
  parts.push(textLines(fit.lines, fit.size, s / 2, 350, 'sp-name sp-corner-name'));
  if (sp.kind === 'start') {
    parts.push(textEl('sp-sub', s / 2, 400, 38, t('g.board.salary')));
    if (hasPot) {
      parts.push(
        `<g class="sp-pot"><rect x="${s / 2 - 124}" y="68" width="248" height="56" rx="28" fill="#1B2430" opacity=".9"/>` +
          iconAt('pot', s / 2 - 115, 71, 50) +
          `<text x="${s / 2 + 38}" y="108" font-size="38" text-anchor="middle" fill="#FFD66B">${esc(fmtMoney(v.pot))}</text></g>`,
      );
    }
  }
  parts.push('</g>');
  baseMatrix = outer;
  return parts.join('');
}

/** Transform of space i's group (board units), as an SVG attribute and as a matrix. */
function spaceTransform(i: number, geom: readonly SpaceGeom[]): string {
  const g = geom[i]!;
  return g.corner ? `translate(${g.x} ${g.y})` : `translate(${g.cx} ${g.cy}) rotate(${g.rot}) translate(${-g.lw / 2} ${-g.lh / 2})`;
}
function spaceMatrix(i: number, geom: readonly SpaceGeom[]): DOMMatrix {
  const g = geom[i]!;
  return g.corner ? new DOMMatrix().translate(g.x, g.y) : new DOMMatrix().translate(g.cx, g.cy).rotate(g.rot).translate(-g.lw / 2, -g.lh / 2);
}

/** The look of a space with nothing on it (what the static base image shows). */
const BARE: Omit<SpaceView, 'lang'> = { owner: null, level: 0, festival: 0, boost: 1, pot: 0, ring: null, bldOn: 0 };
const isBare = (v: SpaceView): boolean => v.owner === null && v.level === 0 && !v.festival && v.boost <= 1 && v.pot === 0;

/** Invisible hit area of a bare space (taps, picking); the art is in the base image. */
function hitMarkup(i: number, geom: readonly SpaceGeom[]): string {
  const g = geom[i]!;
  if (g.corner) {
    // Keep a generous but visually faithful target: the circular art owns the corner now.
    return `<circle cx="${g.lw / 2}" cy="${g.lh / 2}" r="${g.lw / 2 - 15}" fill="none" pointer-events="all"/>`;
  }
  return `<rect x="7" y="7" width="${g.lw - 14}" height="${g.lh - 14}" rx="${g.corner ? 34 : 24}" fill="none" pointer-events="all"/>`;
}

/** Shared shell for the live SVG and the rasterized bare board. */
function boardShellMarkup(): string {
  return `<rect x="0" y="0" width="${VB}" height="${VB}" rx="120" class="board-face"/>` +
    `<rect x="${INNER.x - 10}" y="${INNER.y - 10}" width="${INNER.size + 20}" height="${INNER.size + 20}" rx="68" class="board-inner-rim"/>`;
}

interface BaseStyles {
  face: string;
  rim: string;
  bgStroke: string;
  bgStrokeWidth: string;
  cornerDiscStrokeWidth: string;
  cornerRing: { stroke: string; strokeWidth: string; strokeDasharray: string };
  groupBadge: { stroke: string; strokeWidth: string };
  text: Record<string, { font: string; fill: string; spacingEm: number }>;
}

/** Board styles from the live stylesheet (board.css stays the one source of truth). */
function readBaseStyles(svgEl: SVGSVGElement): BaseStyles {
  const mk = (tag: string, cls: string): SVGElement => {
    const e = document.createElementNS(NS, tag) as SVGElement;
    e.setAttribute('class', cls);
    if (tag === 'text') e.setAttribute('font-size', '100');
    svgEl.appendChild(e);
    return e;
  };
  const probes = {
    face: mk('rect', 'board-face'),
    rim: mk('rect', 'board-inner-rim'),
    bg: mk('rect', 'sp-bg'),
    cornerDisc: mk('circle', 'sp-bg sp-corner-disc'),
    cornerRing: mk('circle', 'sp-corner-ring'),
    groupBadge: mk('rect', 'sp-group-badge'),
  };
  const textCls = ['sp-name', 'sp-name sp-corner-name', 'sp-price', 'sp-sub'];
  const texts = textCls.map((c) => mk('text', c));
  const cs = (e: Element): CSSStyleDeclaration => getComputedStyle(e);
  const bg = cs(probes.bg);
  const out: BaseStyles = {
    face: cs(probes.face).fill,
    rim: cs(probes.rim).fill,
    bgStroke: bg.stroke,
    bgStrokeWidth: bg.strokeWidth,
    cornerDiscStrokeWidth: cs(probes.cornerDisc).strokeWidth,
    cornerRing: {
      stroke: cs(probes.cornerRing).stroke,
      strokeWidth: cs(probes.cornerRing).strokeWidth,
      strokeDasharray: cs(probes.cornerRing).strokeDasharray,
    },
    groupBadge: {
      stroke: cs(probes.groupBadge).stroke,
      strokeWidth: cs(probes.groupBadge).strokeWidth,
    },
    text: {},
  };
  textCls.forEach((c, k) => {
    const st = cs(texts[k]!);
    const sp = parseFloat(st.letterSpacing);
    out.text[c] = {
      font: `${st.fontStyle === 'normal' ? '' : st.fontStyle + ' '}${st.fontWeight} {size}px ${st.fontFamily}`,
      fill: st.fill,
      spacingEm: Number.isFinite(sp) ? sp / 100 : 0,
    };
  });
  for (const e of [...Object.values(probes), ...texts]) e.remove();
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  return img.decode().then(() => img);
}

/**
 * Render the static board (face, rim and every space as if bare: background, color bar, price,
 * icon, name) once into a bitmap `pw` x `pw` device pixels: shapes via an SVG image, text with
 * canvas fillText in the page fonts. Returned as a PNG blob URL for an <img>: a <canvas> in the
 * page would be its own GPU layer (plus overlap layers for everything above it), an <img> is a
 * plain bitmap painted into the board's layer, so raster work under a changed prompt, token or
 * space is one image copy instead of re-drawing ~950 SVG shapes and 40 text runs per tile.
 */
async function rasterizeBase(svgEl: SVGSVGElement, players: readonly Player[], board: readonly SpaceDef[], geom: readonly SpaceGeom[], pw: number): Promise<string> {
  const st = readBaseStyles(svgEl);
  const texts: BaseText[] = [];
  const groups: string[] = [];
  baseTexts = texts;
  try {
    const lang = getLang();
    for (let i = 0; i < board.length; i++) {
      const g = geom[i]!;
      baseMatrix = spaceMatrix(i, geom);
      const v: SpaceView = { ...BARE, lang };
      const inner = g.corner ? cornerMarkup(board[i]!, g, v) : sideSpaceMarkup(board[i]!, g, v, players);
      groups.push(`<g transform="${spaceTransform(i, geom)}">${inner}</g>`);
    }
  } finally {
    baseTexts = null;
    baseMatrix = null;
  }
  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}" width="${pw}" height="${pw}">` +
    `<style>` +
      `.sp-bg{stroke:${st.bgStroke};stroke-width:${st.bgStrokeWidth}}` +
      `.sp-corner-disc{stroke-width:${st.cornerDiscStrokeWidth}}` +
      `.sp-corner-ring{stroke:${st.cornerRing.stroke};stroke-width:${st.cornerRing.strokeWidth};stroke-dasharray:${st.cornerRing.strokeDasharray}}` +
      `.sp-group-badge{stroke:${st.groupBadge.stroke};stroke-width:${st.groupBadge.strokeWidth}}` +
    `</style>` +
    boardShellMarkup().replace('class="board-face"', `fill="${st.face}"`).replace('class="board-inner-rim"', `fill="${st.rim}"`) +
    groups.join('') +
    '</svg>';
  const svgUrl = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  let shapes: HTMLImageElement;
  try {
    shapes = await loadImage(svgUrl);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = pw;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(shapes, 0, 0, pw, pw);
  const k = pw / VB;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  for (const tx of texts) {
    const ts = st.text[tx.cls] ?? st.text['sp-name']!;
    ctx.setTransform(new DOMMatrix().scale(k, k).multiply(tx.m));
    ctx.font = ts.font.replace('{size}', tx.size.toFixed(1));
    ctx.fillStyle = ts.fill;
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${(ts.spacingEm * tx.size).toFixed(2)}px`;
    ctx.fillText(tx.text, tx.x, tx.y);
  }
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error('toBlob failed');
  return URL.createObjectURL(blob);
}

interface TokenEl {
  root: HTMLElement;
  body: HTMLElement;
  pos: number;
  moving: boolean;
  hidden: boolean;
  x: number;
  y: number;
  shared: boolean;
}

export class Board {
  readonly el: HTMLElement;
  readonly stageHost: HTMLElement;
  readonly overlay: HTMLElement;
  /**
   * HTML layer between the board SVG and the tokens for per-space highlights (one-away rings,
   * pick / focus outlines, pick dimming). Their pulses animate opacity on small HTML elements
   * (compositor-only); animating inside the SVG would repaint the whole board every frame.
   */
  private marks: HTMLElement;
  /**
   * Pop-out buildings (one element per built space): above the ring and the marks' layer order
   * below, under the Stage's content and the tokens; positioned once per change, no animation at rest.
   */
  private bldLayer: HTMLElement;
  private bldEls = new Map<number, HTMLElement>();
  private bldSigs = new Map<number, string>();
  private building = new Set<number>();
  private rings = new Map<number, HTMLElement>();
  private pickEls: HTMLElement[] = [];
  private focusEl: HTMLElement | null = null;
  private dimEl: HTMLElement | null = null;
  private svgEl: SVGSVGElement;
  private defsEl!: SVGDefsElement;
  private definedPatterns = new Set<string>();
  private groups: SVGGElement[] = [];
  private sigs: string[] = [];
  private tokens = new Map<PlayerId, TokenEl>();
  private tokenLayer: HTMLElement;
  private px = 800;
  private players: readonly Player[];
  private pickHandler: ((i: number) => void) | null = null;
  private pickSet = new Set<number>();
  /** Static board bitmap under the SVG (null until the first one is ready). */
  private baseImg: HTMLImageElement | null = null;
  private baseUrl = '';
  /** Key (size|dpr|lang) of the base image shown / being made. */
  private baseKey = '';
  private baseGen = 0;
  private baseTimer = 0;
  /** First-base swap in progress: spaces below this index use the base (see setBase). */
  private swapLimit = Infinity;
  private stopSwap: (() => void) | null = null;
  private sized = false;
  private lastVs: GameState | null = null;
  private a11yLang = '';
  private disposed = false;
  private readonly size: SpacesPerSide;
  private readonly board: readonly SpaceDef[];
  private readonly geom: readonly SpaceGeom[];

  /**
   * `uprightTop`: the fixed view (src/ui/orientation.ts) prints the top row upright for the one
   * reader at S (geometry.ts `upright`); the table model prints every side facing outward.
   */
  constructor(players: readonly Player[], private onTap: (index: number) => void, size: SpacesPerSide = 7, private readonly uprightTop = false) {
    this.players = players;
    this.size = size;
    this.board = getBoard(size);
    this.geom = getBoardGeometry(size, uprightTop);
    this.el = h('div', { class: 'board' });
    // How far a pop-out building reaches into the inner area (in --u): the Stage keeps its roll
    // control clear of it (stage.css).
    this.el.style.setProperty('--bld-out', String(+((BLD_OUT_MAX * getBoardGeometry(size)[1]!.lw) / 100).toFixed(3)));
    this.svgEl = document.createElementNS(NS, 'svg');
    this.svgEl.setAttribute('viewBox', `0 0 ${VB} ${VB}`);
    this.svgEl.setAttribute('class', 'board-svg');
    this.svgEl.innerHTML =
      `<defs></defs>` +
      boardShellMarkup();
    this.defsEl = this.svgEl.querySelector('defs')!;
    for (let i = 0; i < this.board.length; i++) {
      const grp = document.createElementNS(NS, 'g');
      grp.setAttribute('class', `sp sp-${this.board[i]!.kind}`);
      grp.setAttribute('data-i', String(i));
      grp.setAttribute('transform', spaceTransform(i, this.geom));
      this.svgEl.appendChild(grp);
      this.groups.push(grp);
      this.sigs.push('');
    }
    this.updateSpaceAccessibility();
    this.svgEl.addEventListener('click', (e) => {
      const g = (e.target as Element).closest?.('g.sp');
      if (!g) return;
      const i = Number(g.getAttribute('data-i'));
      (g as SVGGElement).focus();
      this.activateSpace(i);
    });
    this.svgEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const g = (e.target as Element).closest?.('g.sp');
      if (!g) return;
      e.preventDefault();
      this.activateSpace(Number(g.getAttribute('data-i')));
    });
    this.stageHost = h('div', { class: 'stage-host' });
    this.marks = h('div', { class: 'board-marks' });
    this.bldLayer = h('div', { class: 'board-bldgs', 'aria-hidden': 'true' });
    this.tokenLayer = h('div', { class: 'token-layer' });
    this.overlay = h('div', { class: 'board-overlay' });
    // The Stage's backdrop is the board's (not the Stage's): buildings stick out over it, under the
    // Stage's content (prompts stay readable; the Stage's own layer is the one composited layer).
    const stageBg = h('div', { class: 'stage-bg board-stage-bg' });
    this.el.append(this.svgEl, stageBg, this.bldLayer, this.marks, this.stageHost, this.tokenLayer, this.overlay);
    for (const p of players) {
      const body = h('div', { class: 'token-body' });
      body.append(h('span', { class: 'tok-badge' }, svgNode(p.tokenId)));
      const root = h('div', { class: 'token', 'data-pid': p.id }, h('div', { class: 'token-shadow' }), body);
      setPlayerVars(root, p.colorId);
      this.tokenLayer.append(root);
      this.tokens.set(p.id, { root, body, pos: -1, moving: false, hidden: false, x: 0, y: 0, shared: false });
    }
  }

  setSize(px: number): void {
    this.sized = true;
    if (px !== this.px) {
      this.px = px;
      for (const tk of this.tokens.values()) this.setTokenXY(tk, tk.x, tk.y);
      // Building boxes have a minimum size in px (layoutBuildings).
      if (this.lastVs) this.render(this.lastVs);
    }
    this.ensureBase();
  }

  /** Make the visually-rasterized board ring keyboard and screen-reader accessible. */
  private updateSpaceAccessibility(force = false): void {
    const lang = getLang();
    if (!force && lang === this.a11yLang) return;
    this.a11yLang = lang;
    for (let i = 0; i < this.board.length; i++) {
      const grp = this.groups[i]!;
      grp.setAttribute('tabindex', '0');
      grp.setAttribute('role', 'button');
      const picking = !!this.pickHandler && this.pickSet.has(i);
      if (picking) grp.removeAttribute('aria-haspopup');
      else grp.setAttribute('aria-haspopup', 'dialog');
      grp.setAttribute('aria-label', t(picking ? 'g.board.pick' : 'g.board.info', { name: loc(this.board[i]!.name) }));
    }
  }

  private activateSpace(i: number): void {
    if (this.pickHandler && this.pickSet.has(i)) {
      sfx.play('tap');
      this.pickHandler(i);
      return;
    }
    this.onTap(i);
  }

  dispose(): void {
    this.disposed = true;
    this.stopSwap?.();
    this.stopSwap = null;
    window.clearTimeout(this.baseTimer);
    if (this.baseUrl) URL.revokeObjectURL(this.baseUrl);
    this.baseUrl = '';
  }

  // -------------------------------------------------------------------------
  // Static base image ("rasterized board"): see rasterizeBase. Bare spaces are then only an
  // invisible hit rect in the SVG; spaces with an owner / festival / pot keep their full live
  // SVG (drawn opaque over the base). Re-made on board size, device-pixel-ratio or language change.
  // -------------------------------------------------------------------------

  private baseKeyNow(): { key: string; pw: number; lang: string } {
    const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    // Only the text-bearing board may use 2K. Do not inflate a near-1K request to 2K.
    const pw = Math.min(2048, 2 ** Math.round(Math.log2(Math.max(1, this.px * dpr))));
    const lang = getLang();
    return { key: `${pw}|${lang}`, pw, lang };
  }

  private ensureBase(): void {
    if (!this.sized || this.disposed || typeof document === 'undefined') return;
    const { key, lang } = this.baseKeyNow();
    if (key === this.baseKey) return;
    const stale = !!this.baseImg && !!this.baseKey && !this.baseKey.endsWith(`|${lang}`);
    this.baseKey = key;
    // A base in another language would show stale names: back to the full SVG until the new one lands.
    if (stale) this.setBase(null);
    const gen = ++this.baseGen;
    window.clearTimeout(this.baseTimer);
    // Coalesce a burst of resizes; the first one (game mount) goes right away.
    const delay = this.baseImg ? 150 : 0;
    this.baseTimer = window.setTimeout(() => {
      if (gen !== this.baseGen || this.disposed) return;
      const { pw } = this.baseKeyNow();
      rasterizeBase(this.svgEl, this.players, this.board, this.geom, pw)
        .then(async (url) => {
          if (gen !== this.baseGen || this.disposed) {
            URL.revokeObjectURL(url);
            return;
          }
          const img = await loadImage(url);
          if (gen !== this.baseGen || this.disposed) {
            URL.revokeObjectURL(url);
            return;
          }
          img.className = 'board-base';
          img.alt = '';
          img.draggable = false;
          img.setAttribute('aria-hidden', 'true');
          const old = this.baseUrl;
          this.baseUrl = url;
          this.setBase(img);
          if (old) URL.revokeObjectURL(old);
        })
        .catch((e: unknown) => {
          // Keep the full live SVG (always correct, only slower).
          console.warn('[board] base raster failed', e);
        });
    }, delay);
  }

  private setBase(img: HTMLImageElement | null): void {
    if (img) {
      if (this.baseImg) this.baseImg.replaceWith(img);
      else this.el.insertBefore(img, this.svgEl);
    } else {
      this.baseImg?.remove();
    }
    const had = !!this.baseImg;
    this.baseImg = img;
    this.el.classList.toggle('has-base', !!img);
    if (had !== !!img && this.lastVs) {
      // The first base: swap the live SVG spaces for hit areas a third of the board per clock frame.
      // Swapping all at once was the longest Layout of the game's mount (1,000+ SVG objects, 93-128 ms
      // at 4x CPU, docs/PERFORMANCE.md "라운드 2"); the base image under them shows the same spaces.
      if (img && !had && animSpeed() > 0) {
        const step = Math.ceil(this.board.length / 3);
        this.swapLimit = 0;
        this.stopSwap?.();
        this.stopSwap = onFrame(() => {
          if (this.disposed) return false;
          this.swapLimit += step;
          const done = this.swapLimit >= this.board.length;
          if (done) {
            this.swapLimit = Infinity;
            this.stopSwap = null;
          }
          if (this.lastVs) this.render(this.lastVs);
          return !done;
        });
      } else {
        this.stopSwap?.();
        this.stopSwap = null;
        this.swapLimit = Infinity;
        this.render(this.lastVs);
      }
    }
  }

  /** Board-unit → px scale. */
  private get k(): number {
    return this.px / VB;
  }

  // -------------------------------------------------------------------------
  // Spaces
  // -------------------------------------------------------------------------

  render(vs: GameState): void {
    this.lastVs = vs;
    this.updateSpaceAccessibility();
    const based = !!this.baseImg;
    const rings = new Map<number, string>();
    for (const w of oneAwayWarnings(vs)) {
      if (vs.properties[w.missing]?.owner === w.playerId) continue;
      rings.set(w.missing, playerColor(vs.players[w.playerId]!.colorId).hex);
    }
    const lang = getLang();
    const blds = this.layoutBuildings(vs);
    for (let i = 0; i < this.board.length; i++) {
      const sp = this.board[i]!;
      const pr = vs.properties[i];
      const bg = blds[i] ?? null;
      const v: SpaceView = {
        owner: pr?.owner ?? null,
        level: pr?.level ?? 0,
        festival: vs.festival === i ? festivalMultiplier(vs) : 0,
        boost: hubStep(vs, i),
        pot: i === 0 ? vs.pot : 0,
        ring: rings.get(i) ?? null,
        lang,
        bldOn: bg?.onCard ?? 0,
      };
      const hit = based && i < this.swapLimit && isBare(v);
      const sig = hit ? 'hit' : `${v.owner}|${v.level}|${v.festival}|${v.pot}|${v.lang}|${Math.round(v.bldOn)}`;
      const grp = this.groups[i]!;
      if (sig !== this.sigs[i]) {
        this.sigs[i] = sig;
        const g = this.geom[i]!;
        grp.innerHTML = hit ? hitMarkup(i, this.geom) : g.corner ? cornerMarkup(sp, g, v) : sideSpaceMarkup(sp, g, v, this.players);
        this.flushAtlasDefs();
      }
      if (this.renderBuilding(i, v, bg)) {
        // An fx pop requested in this same frame (the 'swap' cue fires just before the re-render).
        const pop = this.pops.get(i);
        if (pop && performance.now() - pop.at < 120) this.runPop(i, pop.o);
      }
      // One-away pulse ring: a separate HTML mark above the space, recreated only on change.
      const ring = this.rings.get(i);
      if ((ring?.dataset.color ?? null) !== v.ring) {
        ring?.remove();
        this.rings.delete(i);
        if (v.ring) {
          const g = this.geom[i]!;
          const art = g.corner
            ? `<circle cx="${g.lw / 2}" cy="${g.lh / 2}" r="${g.lw / 2 - 16}" stroke="${v.ring}"/>`
            : `<rect x="10" y="10" width="${g.lw - 20}" height="${g.lh - 20}" rx="28" stroke="${v.ring}"/>`;
          const el = this.mark(i, 'bm-ring', art);
          el.dataset.color = v.ring;
          this.rings.set(i, el);
        }
      }
    }
    this.renderTokens(vs);
    this.ensureBase();
  }

  /**
   * The building of space i as its own element on the card's inner edge (geometry.ts
   * `buildingGeom`): the current level's icon (villa / building / hotel / landmark), roof in the
   * owner's color. Recreated only when its owner, level or box change (returns true then).
   */
  private renderBuilding(i: number, v: SpaceView, bg: BuildingGeom | null): boolean {
    const owner = v.owner !== null ? this.players[v.owner] : undefined;
    const level = owner && bg && v.level >= 1 ? (Math.min(4, v.level) as BuildingLevel) : 0;
    const sig = level && bg ? `${owner!.colorId}|${level}|${bg.x.toFixed(1)}|${bg.y.toFixed(1)}|${bg.size.toFixed(1)}` : '';
    if ((this.bldSigs.get(i) ?? '') === sig) return false;
    this.bldEls.get(i)?.remove();
    this.bldEls.delete(i);
    this.bldSigs.delete(i);
    if (!level || !bg) return true;
    const k = 100 / VB;
    const el = h('div', { class: `bb lv${level}${bg.hanging ? ' is-hanging' : ''}`, 'data-i': String(i) });
    el.style.left = `${bg.x * k}%`;
    el.style.top = `${bg.y * k}%`;
    el.style.width = `${bg.size * k}%`;
    el.style.height = `${bg.size * k}%`;
    if (bg.rot) el.style.rotate = `${bg.rot}deg`;
    el.style.color = playerColor(owner!.colorId).hex;
    el.append(svgNode(BUILDING_ICON[level]));
    el.classList.toggle('is-building', this.building.has(i));
    el.classList.toggle('is-dim', this.pickSet.size > 0 && !this.pickSet.has(i));
    this.bldLayer.append(el);
    this.bldEls.set(i, el);
    this.bldSigs.set(i, sig);
    return true;
  }

  /** Smallest building box (board units): about 22 px on screen, so a small board's villa still reads. */
  private get minBuilding(): number {
    return (22 * VB) / Math.max(1, this.px);
  }

  /** Building boxes for a state (`override`: one space's level replaced, e.g. a build in progress). */
  private layoutBuildings(vs: GameState, override?: { i: number; level: number }): (BuildingGeom | null)[] {
    const levels = this.board.map((_, i) => {
      if (override && override.i === i) return override.level;
      const pr = vs.properties[i];
      return pr && pr.owner !== null ? pr.level : 0;
    });
    return buildingLayout(levels, this.size, this.uprightTop, this.minBuilding);
  }

  /**
   * Client rect of space i's building box at `level` among the buildings already standing (the
   * build cut-in's hero lands there).
   */
  buildingRect(i: number, level: number, boardRect?: { left: number; top: number; width: number }): { x: number; y: number; width: number; height: number } | null {
    const lv = Math.max(1, Math.min(4, level));
    const bg = this.lastVs ? this.layoutBuildings(this.lastVs, { i, level: lv })[i] : buildingGeom(i, lv as BuildingLevel, this.size, this.uprightTop, this.minBuilding);
    if (!bg) return null;
    const r = boardRect ?? this.el.getBoundingClientRect();
    const k = r.width / VB;
    return { x: r.left + bg.x * k, y: r.top + bg.y * k, width: bg.size * k, height: bg.size * k };
  }

  /** Put the atlas patterns the last markup referenced into this board's <defs> (once each). */
  private flushAtlasDefs(): void {
    if (!atlasDefs.size) return;
    let add = '';
    for (const [id, def] of atlasDefs) {
      if (this.definedPatterns.has(id)) continue;
      this.definedPatterns.add(id);
      add += def;
    }
    atlasDefs.clear();
    if (add) this.defsEl.insertAdjacentHTML('beforeend', add);
  }

  /** Brief highlight of a space (bought / built / stamped). */
  async pulseSpace(i: number, kind: 'pop' | 'stamp' | 'shake' = 'pop'): Promise<void> {
    const grp = this.groups[i];
    if (!grp || noMotion()) return;
    const g = this.geom[i]!;
    const cls = `fx-${kind}`;
    const ring = h('div', { class: `space-flash ${cls}` });
    const k = 100 / VB;
    ring.style.left = `${g.x * k}%`;
    ring.style.top = `${g.y * k}%`;
    ring.style.width = `${g.w * k}%`;
    ring.style.height = `${g.h * k}%`;
    this.overlay.append(ring);
    const frames: Keyframe[] =
      kind === 'shake'
        ? [
            { transform: 'translateX(0)', opacity: 1 },
            { transform: 'translateX(-6%)', offset: 0.2 },
            { transform: 'translateX(6%)', offset: 0.45 },
            { transform: 'translateX(-3%)', offset: 0.7 },
            { transform: 'translateX(0)', opacity: 0 },
          ]
        : [
            { transform: 'scale(.6)', opacity: 0 },
            { transform: 'scale(1.12)', opacity: 1, offset: 0.45 },
            { transform: 'scale(1)', opacity: 0 },
          ];
    await anim(ring, frames, { duration: kind === 'stamp' ? 700 : 520, easing: EASE.overshoot });
    ring.remove();
  }

  /** Landing ripple at a space centre. */
  ripple(i: number, color: string): void {
    if (noMotion()) return;
    const g = this.geom[i]!;
    const r = h('div', { class: 'land-ripple' });
    r.style.left = `${(g.cx / VB) * 100}%`;
    r.style.top = `${(g.cy / VB) * 100}%`;
    r.style.setProperty('--pc', color);
    this.overlay.append(r);
    void anim(r, [
      { transform: 'translate(-50%,-50%) scale(.2)', opacity: 0.9 },
      { transform: 'translate(-50%,-50%) scale(1.5)', opacity: 0 },
    ], { duration: 650, easing: EASE.settle }).then(() => r.remove());
  }

  /**
   * An HTML element covering space `i` in its local frame (rotated like the SVG group), holding
   * an SVG snippet in local board units. Appended to the marks layer.
   */
  private mark(i: number, cls: string, inner: string): HTMLElement {
    const g = this.geom[i]!;
    const k = 100 / VB;
    const el = h('div', { class: `bmark ${cls}` });
    el.style.left = `${g.cx * k}%`;
    el.style.top = `${g.cy * k}%`;
    el.style.width = `${g.lw * k}%`;
    el.style.height = `${g.lh * k}%`;
    if (!g.corner && g.rot) el.style.transform = `translate(-50%, -50%) rotate(${g.rot}deg)`;
    el.innerHTML = `<svg viewBox="0 0 ${g.lw} ${g.lh}" preserveAspectRatio="none" aria-hidden="true">${inner}</svg>`;
    this.marks.append(el);
    return el;
  }

  /** Outline hugging the outside of a space's background card (`sp-bg`), `w` board units wide. */
  private outline(i: number, cls: string, w: number): HTMLElement {
    const g = this.geom[i]!;
    const m = 7 - w / 2;
    const art = g.corner
      ? `<circle cx="${g.lw / 2}" cy="${g.lh / 2}" r="${g.lw / 2 - m}"/>`
      : `<rect x="${m}" y="${m}" width="${g.lw - 2 * m}" height="${g.lh - 2 * m}" rx="${30 + w / 2}"/>`;
    return this.mark(i, cls, art);
  }

  /** Highlight a set of spaces as tappable choices; `null` clears. */
  setPicking(options: readonly number[] | null, onPick?: (i: number) => void): void {
    this.pickSet = new Set(options ?? []);
    this.pickHandler = options ? (onPick ?? null) : null;
    this.el.classList.toggle('is-picking', !!options);
    this.groups.forEach((g, i) => g.classList.toggle('is-pick', this.pickSet.has(i)));
    for (const [i, el] of this.bldEls) el.classList.toggle('is-dim', !!options && !this.pickSet.has(i));
    this.updateSpaceAccessibility(true);
    for (const el of this.pickEls) el.remove();
    this.pickEls = [];
    if (options) {
      for (const i of this.pickSet) this.pickEls.push(this.outline(i, 'bm-pick', 8));
      // Dim the other spaces with one board-colored veil (same result as group opacity .32,
      // without promoting 30 SVG groups to layers for the fade).
      if (!this.dimEl) {
        const veil: string[] = [];
        for (let i = 0; i < this.board.length; i++) {
          if (this.pickSet.has(i)) continue;
          const g = this.geom[i]!;
          veil.push(g.corner
            ? `<circle transform="${spaceTransform(i, this.geom)}" cx="${g.lw / 2}" cy="${g.lh / 2}" r="${g.lw / 2 - 7}"/>`
            : `<rect transform="${spaceTransform(i, this.geom)}" width="${g.lw}" height="${g.lh}" rx="30"/>`);
        }
        const dim = h('div', { class: 'bm-dim' });
        dim.innerHTML = `<svg viewBox="0 0 ${VB} ${VB}" aria-hidden="true">${veil.join('')}</svg>`;
        this.marks.prepend(dim);
        this.dimEl = dim;
        onFrame(() => {
          dim.classList.add('is-on');
          return false;
        });
      }
    } else if (this.dimEl) {
      const dim = this.dimEl;
      this.dimEl = null;
      dim.classList.remove('is-on');
      if (noMotion()) dim.remove();
      else dim.addEventListener('transitionend', () => dim.remove(), { once: true });
      // Safety net if no transition runs (hidden tab, reduced motion).
      gridTimeout(() => dim.remove(), 600);
    }
  }

  /** Mark one space as "selected" (e.g. the space a prompt is about). */
  setFocus(i: number | null): void {
    this.groups.forEach((g, j) => g.classList.toggle('is-focus', j === i));
    this.focusEl?.remove();
    this.focusEl = i === null ? null : this.outline(i, 'bm-focus', 9);
  }

  // -------------------------------------------------------------------------
  // FX hooks (docs/VFX-WIRING.md §3): rects for the canvas engine, icon pop / dim / zoom punch.
  // All on `anim()` (30 Hz grid, instant when animations are off).
  // -------------------------------------------------------------------------

  /** Client rect of space i (for fx): one board rect read + geometry. */
  spaceRect(i: number, boardRect?: { left: number; top: number; width: number }): { x: number; y: number; width: number; height: number } {
    const r = boardRect ?? this.el.getBoundingClientRect();
    const g = this.geom[i]!;
    const k = r.width / VB;
    return { x: r.left + g.x * k, y: r.top + g.y * k, width: g.w * k, height: g.h * k };
  }

  private pops = new Map<number, { o: { from: number; c1: number; frames: number }; at: number }>();


  /** Tier pop of a space's level icon: scale `from` → 1 along easeOutBack(c1), `frames` 30 Hz frames. */
  popIcon(i: number, o: { from: number; c1: number; frames: number }): void {
    // The swap cue fires right before the sequencer re-renders the space (new icon): remember the
    // pop so render() re-runs it on the new element.
    this.pops.set(i, { o, at: performance.now() });
    this.runPop(i, o);
  }

  /**
   * Scale an SVG element through its `transform` ATTRIBUTE, stepped on the 30 Hz clock. A CSS
   * transform animation on an SVG child makes Chromium composite the board SVG, and the layers
   * painted above it (marks, tokens) then need their own overlap layers: +14 MB of layer memory
   * per effect (docs/VFX.md §14). The attribute path costs one board repaint per step, briefly, so
   * it steps at 15 Hz (a 250 ms pop is 4 steps + the end).
   */
  private svgScale(el: SVGGraphicsElement, base: string, cx: number, cy: number, frames: number, scaleAt: (t: number) => number): void {
    if (noMotion()) return;
    this.svgTweens.get(el)?.();
    const dur = (frames * 1000) / 30;
    let t = 0;
    let last = -1;
    const set = (sc: number): void => {
      const s = Math.abs(sc - 1) < 1e-3 ? '' : ` translate(${cx.toFixed(1)} ${cy.toFixed(1)}) scale(${sc.toFixed(3)}) translate(${(-cx).toFixed(1)} ${(-cy).toFixed(1)})`;
      const v = `${base}${s}`.trim();
      if (v) el.setAttribute('transform', v);
      else el.removeAttribute('transform');
    };
    let n = 0;
    const stop = onFrame((now) => {
      if (last >= 0) t += (now - last) * animSpeed() * (isSkipping() ? 5 : 1);
      last = now;
      const k = Math.min(1, t / dur);
      // 15 Hz steps (plus the exact end): each step repaints the board layer (docs/VFX.md §15).
      if (n++ % 2 === 0 || k >= 1) set(scaleAt(k));
      if (k >= 1 || !el.isConnected) {
        this.svgTweens.delete(el);
        return false;
      }
      return true;
    });
    this.svgTweens.set(el, () => {
      stop();
      set(1);
    });
  }

  private svgTweens = new Map<Element, () => void>();

  /**
   * Pop of the space's pop-out building (scale from its base), stepped on the 30 Hz clock through
   * the static `scale` property at 15 Hz: a repaint of that small box per step, no compositor layer
   * (an animated transform would lift the Stage and tokens above it onto overlap layers).
   */
  private runPop(i: number, o: { from: number; c1: number; frames: number }): void {
    const icon = this.bldEls.get(i)?.firstElementChild as SVGElement | null | undefined;
    if (!icon || noMotion()) return;
    this.svgTweens.get(icon)?.();
    const c1 = o.c1;
    const dur = (Math.max(2, o.frames) * 1000) / 30;
    const scaleAt = (t: number): number => {
      const x = t - 1;
      return o.from + (1 - o.from) * (1 + (c1 + 1) * x ** 3 + c1 * x ** 2);
    };
    const set = (sc: number): void => {
      icon.style.scale = Math.abs(sc - 1) < 1e-3 ? '' : sc.toFixed(3);
    };
    let t = 0;
    let last = -1;
    let n = 0;
    set(o.from);
    const stop = onFrame((now) => {
      if (last >= 0) t += (now - last) * animSpeed() * (isSkipping() ? 5 : 1);
      last = now;
      const k = Math.min(1, t / dur);
      if (n++ % 2 === 0 || k >= 1) set(scaleAt(k));
      if (k >= 1 || !icon.isConnected) {
        this.svgTweens.delete(icon);
        return false;
      }
      return true;
    });
    this.svgTweens.set(icon, () => {
      stop();
      set(1);
    });
  }

  /** Zoom punch of a whole space 1 → k (5 f outQuad) → 1 (7 f inOutQuad), drawn above its neighbours. */
  zoomPunch(i: number, k: number): void {
    const grp = this.groups[i];
    if (!grp || noMotion()) return;
    const g = this.geom[i]!;
    // Paint order = z-order in SVG: move the group last (the order of the groups carries no meaning).
    if (grp.nextSibling) this.svgEl.appendChild(grp);
    this.svgScale(grp, spaceTransform(i, this.geom), g.lw / 2, g.lh / 2, 12, (t) => {
      const f = t * 12;
      if (f <= 5) {
        const x = f / 5;
        return 1 + (k - 1) * (1 - (1 - x) * (1 - x));
      }
      const x = (f - 5) / 7;
      const e = x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
      return k + (1 - k) * e;
    });
  }

  /** "Under construction" dim of a space's level icon (class on the space group: survives re-renders). */
  dimIcon(i: number, on: boolean): void {
    this.groups[i]?.classList.toggle('is-building', on);
    if (on) this.building.add(i);
    else this.building.delete(i);
    this.bldEls.get(i)?.classList.toggle('is-building', on);
  }

  /** Static highlight: an outline mark for `ms` (or until the returned function removes it), no animation. */
  highlight(i: number, color: string, ms = 800): () => void {
    if (!this.geom[i]) return () => {};
    const el = this.outline(i, 'bm-hl', 10);
    el.style.setProperty('--fx-hl', color);
    const stop = gridTimeout(() => el.remove(), ms);
    return () => {
      stop();
      el.remove();
    };
  }

  /** Screen centre (client px) of a space — for fx. */
  spaceClientCenter(i: number): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    const g = this.geom[i]!;
    return { x: r.left + (g.cx / VB) * r.width, y: r.top + (g.cy / VB) * r.height };
  }

  // -------------------------------------------------------------------------
  // Tokens
  // -------------------------------------------------------------------------

  private renderTokens(vs: GameState): void {
    for (const p of vs.players) {
      const tk = this.tokens.get(p.id)!;
      if (!tk.moving) tk.pos = p.position;
      const hide = p.bankrupt;
      if (hide !== tk.hidden) {
        tk.hidden = hide;
        tk.root.classList.toggle('is-out', hide);
      }
    }
    this.layoutTokens(true);
  }

  private setTokenXY(tk: TokenEl, x: number, y: number): void {
    tk.x = x;
    tk.y = y;
    // Positioned with the `translate` property, not left/top: moving a token is then a transform
    // change (no repaint of the board's token layer, docs/PERFORMANCE.md).
    tk.root.style.translate = `${Math.round(x * this.k * 100) / 100}px ${Math.round(y * this.k * 100) / 100}px`;
  }

  /** Put every resting token on its slot (FLIP-animated when it shifts). */
  private layoutTokens(animate: boolean): void {
    const bySpace = new Map<number, PlayerId[]>();
    for (const [pid, tk] of this.tokens) {
      if (tk.moving || tk.hidden || tk.pos < 0) continue;
      const list = bySpace.get(tk.pos) ?? [];
      list.push(pid);
      bySpace.set(tk.pos, list);
    }
    for (const [pos, pids] of bySpace) {
      pids.sort((a, b) => a - b);
      pids.forEach((pid, slot) => {
        const tk = this.tokens.get(pid)!;
        const spot = tokenSpot(pos, slot, pids.length, this.size, this.uprightTop);
        const shared = pids.length > 1;
        if (shared !== tk.shared) {
          tk.shared = shared;
          tk.root.classList.toggle('is-shared', shared);
        }
        if (Math.abs(spot.x - tk.x) < 0.5 && Math.abs(spot.y - tk.y) < 0.5) return;
        const dx = (tk.x - spot.x) * this.k;
        const dy = (tk.y - spot.y) * this.k;
        const first = tk.x === 0 && tk.y === 0;
        this.setTokenXY(tk, spot.x, spot.y);
        if (animate && !first) {
          void anim(tk.root, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0,0)' }], {
            duration: 240,
            easing: EASE.settle,
          });
        }
      });
    }
  }

  /** Walk a token space-by-space along `path` (hop + squash & stretch). */
  async hop(pid: PlayerId, path: readonly number[], backward = false, onLand?: (n: number) => void): Promise<void> {
    const tk = this.tokens.get(pid);
    if (!tk || path.length === 0) return;
    tk.moving = true;
    tk.root.classList.add('is-moving');
    this.layoutTokens(true); // others on the start space re-centre
    // 300 ms/space for short moves; long moves hop a little faster (≥ 200 ms) so they never drag.
    const per = path.length > 6 ? Math.max(200, Math.min(300, 300 * (7 / path.length))) : 300;
    const lift = 0.95 * (this.px / 32);
    // Anticipation: a short crouch before the first hop.
    {
      await anim(tk.body, [{ transform: 'scale(1)' }, { transform: 'scale(1.16, .8)' }], { duration: 140, easing: 'cubic-bezier(.3,0,.7,1)' });
    }
    for (let n = 0; n < path.length; n++) {
      const idx = path[n]!;
      const spot = tokenSpot(idx, 0, 1, this.size, this.uprightTop);
      const dx = (tk.x - spot.x) * this.k;
      const dy = (tk.y - spot.y) * this.k;
      this.setTokenXY(tk, spot.x, spot.y);
      tk.pos = idx;
      sfx.play('hop', { pitch: backward ? 1 - n * 0.03 : 1 + n * 0.045 });
      haptic('tick');
      const d = per;
      await Promise.all([
        anim(tk.root, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0,0)' }], {
          duration: d,
          easing: 'cubic-bezier(.3,.6,.4,1)',
        }),
        anim(
          tk.body,
          [
            { transform: 'translateY(0) scale(1.12, .84)' },
            { transform: `translateY(${-lift}px) scale(.9, 1.12)`, offset: 0.42 },
            { transform: 'translateY(0) scale(1.14, .82)', offset: 0.84 },
            { transform: 'translateY(0) scale(1, 1)' },
          ],
          { duration: d, easing: 'linear' },
        ),
      ]);
      onLand?.(n);
    }
    // Follow-through: a little settle bounce on the final space.
    {
      await anim(
        tk.body,
        [
          { transform: 'scale(1)' },
          { transform: `translateY(${-lift * 0.3}px) scale(.96, 1.06)`, offset: 0.4 },
          { transform: 'translateY(0) scale(1.05, .95)', offset: 0.75 },
          { transform: 'scale(1)' },
        ],
        { duration: 240, easing: EASE.settle },
      );
    }
    tk.moving = false;
    tk.root.classList.remove('is-moving');
    this.layoutTokens(true);
    const p = this.players[pid];
    if (p) this.ripple(tk.pos, playerColor(p.colorId).hex);
  }

  /** Arc jump straight to a space (cards / island). */
  async jump(pid: PlayerId, to: number): Promise<void> {
    const tk = this.tokens.get(pid);
    if (!tk) return;
    tk.moving = true;
    tk.root.classList.add('is-moving');
    this.layoutTokens(true);
    const spot = tokenSpot(to, 0, 1, this.size, this.uprightTop);
    const dx = (tk.x - spot.x) * this.k;
    const dy = (tk.y - spot.y) * this.k;
    this.setTokenXY(tk, spot.x, spot.y);
    tk.pos = to;
    const lift = 4 * (this.px / 32);
    {
      const frames: Keyframe[] = [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0,0)' }];
      await Promise.all([
        anim(tk.root, frames, { duration: 700, easing: 'cubic-bezier(.45,.05,.55,.95)' }),
        anim(
          tk.body,
          [
            { transform: 'translateY(0) scale(1)' },
            { transform: `translateY(${-lift}px) scale(1.35)`, offset: 0.5 },
            { transform: 'translateY(0) scale(1.15, .85)', offset: 0.9 },
            { transform: 'translateY(0) scale(1)' },
          ],
          { duration: 700, easing: EASE.inOut },
        ),
      ]);
    }
    tk.moving = false;
    tk.root.classList.remove('is-moving');
    this.layoutTokens(true);
    const p = this.players[pid];
    if (p) this.ripple(to, playerColor(p.colorId).hex);
  }

  /** Emphasise one player's token (their turn). */
  setActiveToken(pid: PlayerId | null): void {
    for (const [id, tk] of this.tokens) tk.root.classList.toggle('is-active', id === pid);
  }

  /** px duration helper for callers that time things against a hop. */
  static hopMs(steps: number): number {
    return D(Math.max(85, 180 * Math.min(1, 9 / steps)) * steps);
  }
}

export { DEPTH };
