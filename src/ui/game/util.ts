/**
 * Small helpers shared by the game-screen modules (icons, DOM, seats, money).
 */
import { icon, ICON_IDS } from '@/content/icons';
import { playerColor, type PlayerColor } from '@/content/palette';
import { getCard, type CardId } from '@/content/cards';
import { GROUP_COLORS, HUB_COLOR } from '@/content/board';
import { fmtMoney, t } from '@/i18n';
import type { Player, Seat, SpaceDef } from '@/engine';

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

/** Engine / content icon ids that the icon set names differently. */
const ICON_ALIASES: Record<string, string> = {
  // Card art hints (`card-*`) → existing icons.
  'card-move': 'corner-tour',
  'card-island': 'corner-island',
  'card-coin': 'coin',
  'card-pay': 'pot',
  'card-gift': 'space-event',
  'card-escape': 'cards-escape',
  'card-ticket': 'cards-freepass',
  'card-shield': 'cards-shield',
  'card-heart': 'space-donation',
  'card-express': 'hub-rail',
  'card-scale': 'space-tax',
  'card-build': 'building',
  'card-storm': 'villa',
  'card-festival': 'festival-marker',
};

/** Per-card overrides where the generic hint is too vague. */
const CARD_ICON: Partial<Record<CardId, string>> = {
  'to-start': 'corner-start',
  'to-travel': 'corner-tour',
  'to-festival': 'corner-festival',
  'nearest-hub': 'hub-airport',
  'random-jump': 'space-event',
  'back-three': 'corner-tour',
  'hub-bonus': 'hub-space',
  lottery: 'coin',
};

const KNOWN = new Set(ICON_IDS);

export function iconId(id: string): string {
  const a = ICON_ALIASES[id] ?? id;
  return KNOWN.has(a) ? a : 'space-event';
}

/** SVG markup for an icon id (aliases resolved, never throws). */
export function svg(id: string): string {
  return icon(iconId(id));
}

export function cardIcon(id: CardId): string {
  return CARD_ICON[id] ?? iconId(getCard(id).iconId);
}

export function spaceIcon(sp: SpaceDef): string {
  return iconId(sp.iconId);
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

type Attrs = Record<string, string | number | boolean | null | undefined> & {
  class?: string;
  html?: string;
  text?: string;
  style?: string;
};

/** Tiny element factory: h('div', { class: 'x', text: 'hi' }, child…). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'html') el.innerHTML = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** Parsed icon markup, cloned per use: parsing SVG markup for every icon of every prompt card was
 *  a visible part of building a card on a slow CPU (docs/PERFORMANCE.md). */
const iconTemplates = new Map<string, HTMLTemplateElement>();
export function svgNode(id: string): DocumentFragment {
  let tpl = iconTemplates.get(id);
  if (!tpl) {
    tpl = document.createElement('template');
    tpl.innerHTML = svg(id);
    iconTemplates.set(id, tpl);
  }
  return tpl.content.cloneNode(true) as DocumentFragment;
}

export function iconEl(id: string, cls = 'ico'): HTMLSpanElement {
  const el = h('span', { class: cls, 'aria-hidden': 'true' });
  el.append(svgNode(id));
  return el;
}

/** A circular token badge tinted with the player color. */
export function tokenBadge(p: Pick<Player, 'tokenId' | 'colorId'>, cls = 'tok-badge'): HTMLSpanElement {
  const c = playerColor(p.colorId);
  const el = h('span', { class: cls, 'aria-hidden': 'true' });
  el.append(svgNode(p.tokenId));
  el.style.setProperty('--pc', c.hex);
  el.style.setProperty('--pc-dark', c.dark);
  el.style.setProperty('--pc-tint', c.tint);
  return el;
}

export function setPlayerVars(el: HTMLElement, colorId: string): PlayerColor {
  const c = playerColor(colorId);
  el.style.setProperty('--pc', c.hex);
  el.style.setProperty('--pc-dark', c.dark);
  el.style.setProperty('--pc-tint', c.tint);
  return c;
}

// ---------------------------------------------------------------------------
// Seats / board
// ---------------------------------------------------------------------------

/** Rotation that makes content face a seat (DESIGN §2.1). */
export const SEAT_ANGLE: Record<Seat, number> = { S: 0, E: -90, N: 180, W: 90 };

export function groupColor(sp: SpaceDef): string | null {
  if (sp.kind === 'hub') return HUB_COLOR;
  return sp.group ? GROUP_COLORS[sp.group] : null;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export function money(n: number): string {
  return t('g.money', { n: fmtMoney(n) });
}

export function signedMoney(n: number): string {
  return (n > 0 ? '+' : n < 0 ? '−' : '') + t('g.money', { n: fmtMoney(Math.abs(n)) });
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export const isDevHook = (): boolean =>
  !!import.meta.env?.DEV || new URLSearchParams(location.search).get('dev') === '1';
