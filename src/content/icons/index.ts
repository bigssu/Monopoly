import { LANDMARK_ICONS } from './landmarks';
import { TOKEN_ICONS } from './tokens';
import { BUILDING_ICONS } from './buildings';
import { UI_ICONS } from './ui';

export { LANDMARK_ICONS } from './landmarks';
export { TOKEN_ICONS } from './tokens';
export { BUILDING_ICONS } from './buildings';
export { UI_ICONS } from './ui';
export { LOGO_SVG } from './logo';

const ALL: Record<string, string> = { ...LANDMARK_ICONS, ...TOKEN_ICONS, ...BUILDING_ICONS, ...UI_ICONS };

/** All icon ids across every set (landmarks, tokens, buildings, ui). */
export const ICON_IDS: readonly string[] = Object.keys(ALL);

function known(id: string): boolean {
  if (ALL[id] !== undefined) return true;
  const dev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV ?? true;
  if (dev) throw new Error(`Unknown icon id: "${id}"`);
  return false;
}

/**
 * The full, self-contained SVG markup of an icon (for rasterizing into an image / canvas, where a
 * `<use>` reference into the page's sprite would not resolve). Same unknown-id rules as `icon`.
 */
export function iconMarkup(id: string): string {
  return known(id) ? ALL[id]! : '';
}

// ---------------------------------------------------------------------------------------------
// Symbol sprite (docs/PERFORMANCE.md "아이콘 스프라이트")
// ---------------------------------------------------------------------------------------------

/** Element id of the icon symbol for `id` in the page's sprite. */
const iconSymbolId = (id: string): string => `i-${id}`;

const ROOT_RE = /^<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/;
const VIEWBOX_RE = /\sviewBox="([^"]*)"/;

interface Parts {
  viewBox: string;
  /** Presentation attributes of the icon's root `<svg>` (fill/stroke of the UI set). */
  rootAttrs: string;
  inner: string;
}
const partsCache = new Map<string, Parts>();
function parts(id: string): Parts {
  let p = partsCache.get(id);
  if (!p) {
    const m = ROOT_RE.exec(ALL[id]!.trim());
    const attrs = m?.[1] ?? '';
    p = {
      viewBox: VIEWBOX_RE.exec(attrs)?.[1] ?? '0 0 64 64',
      rootAttrs: attrs.replace(/\s(xmlns|viewBox)="[^"]*"/g, '').trim(),
      inner: m?.[2] ?? '',
    };
    partsCache.set(id, p);
  }
  return p;
}

/** Markup of the hidden sprite: one `<symbol id="i-<id>">` per icon. */
function iconSpriteMarkup(): string {
  const symbols = ICON_IDS.map((id) => {
    const p = parts(id);
    const body = p.rootAttrs ? `<g ${p.rootAttrs}>${p.inner}</g>` : p.inner;
    return `<symbol id="${iconSymbolId(id)}" viewBox="${p.viewBox}">${body}</symbol>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" id="lr-icon-sprite" aria-hidden="true" focusable="false" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden;pointer-events:none"><defs>${symbols.join('')}</defs></svg>`;
}

let spriteInstalled = false;
/**
 * Put the icon sprite into the document once (idempotent; called lazily by `icon`). Every icon on
 * screen is then a two-element `<svg><use href="#i-…"/></svg>` instead of a copy of its 5–40
 * shapes: a prompt card with 20 icons builds ~40 DOM nodes instead of ~230.
 */
function installIconSprite(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): void {
  if (spriteInstalled || !doc?.body) return;
  if (!doc.getElementById('lr-icon-sprite')) doc.body.insertAdjacentHTML('afterbegin', iconSpriteMarkup());
  spriteInstalled = true;
}

/**
 * Returns the SVG markup for an icon id, looking across all sets: a small `<svg>` referencing the
 * icon's symbol in the page sprite (`<use href="#i-<id>">`), sized by its viewBox like the full art.
 * Throws on an unknown id in dev; in production returns an empty string so a typo never crashes the game.
 * Token/building icons paint their main body with `currentColor` (set CSS `color` on the icon or an
 * ancestor to tint — `<use>` content inherits it); UI icons are 24x24 monochrome `currentColor`,
 * everything else is 64x64 full color. Use `iconMarkup` for the self-contained art.
 */
export function icon(id: string): string {
  if (!known(id)) return '';
  installIconSprite();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${parts(id).viewBox}"><use href="#${iconSymbolId(id)}"/></svg>`;
}
