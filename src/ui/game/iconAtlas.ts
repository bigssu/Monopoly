/**
 * Icon bitmap atlas ("texture atlas", docs/PERFORMANCE.md "아이콘 아틀라스").
 *
 * The icon sprite (`<svg><use href="#i-…">`) keeps the light DOM small, but Blink still clones
 * every referenced symbol into a `<use>` shadow tree: a buy card with ~10 icons still styled,
 * laid out and painted ~290 SVG shapes in the frame it appeared (4x CPU throttle trace). This
 * module draws the icons the game creates per action (city/hub art, tinted tokens and buildings)
 * once into ONE PNG, cell by cell, at device resolution; an icon is then a single element
 * showing its cell (`<i class="ic-bm">` with a background position, or an SVG `<image>` clipped
 * to the cell on the board). Until the atlas is ready (and for icons not in it) callers fall
 * back to the sprite.
 */
import { iconMarkup, ICON_IDS } from '@/content/icons';

export interface AtlasEntry {
  id: string;
  /** CSS color for `currentColor` (tokens, buildings); ignored for full-color icons. */
  tint?: string;
}

/** Icons whose art uses `currentColor` (the tint matters for them). */
const TINTED = new Set(ICON_IDS.filter((id) => iconMarkup(id).includes('currentColor')));

/** Transparent gutter around each cell (px): keeps filtering from bleeding neighbours in. */
const GUTTER = 2;

interface Atlas {
  url: string;
  cell: number;
  cols: number;
  rows: number;
  index: Map<string, number>;
}
let atlas: Atlas | null = null;
let building: Promise<void> | null = null;

const keyOf = (id: string, tint?: string): string => (TINTED.has(id) ? `${id}|${(tint ?? '').toLowerCase()}` : id);

/** Whether a (possibly tinted) icon can be drawn from the atlas right now. */
function cellOf(id: string, tint?: string): number | null {
  if (!atlas) return null;
  if (TINTED.has(id) && !tint) return null;
  return atlas.index.get(keyOf(id, tint)) ?? null;
}

/** An element showing the icon's atlas cell (fills its parent like the icon <svg> did), or null. */
export function atlasNode(id: string, tint?: string): HTMLElement | null {
  const n = cellOf(id, tint);
  if (n === null || !atlas) return null;
  const { cols, rows, cell } = atlas;
  const inner = cell - 2 * GUTTER;
  const col = n % cols;
  const row = Math.floor(n / cols);
  const el = document.createElement('i');
  el.className = 'ic-bm';
  // Show the cell's interior [GUTTER, cell - GUTTER] scaled to the element box: the atlas is
  // (cols * cell / inner) element-widths wide; percentage positions are relative to (atlas - box).
  // Inline (not a shared rule) so an element keeps its atlas when a bigger one replaces it.
  const px = cols * cell - inner;
  const py = rows * cell - inner;
  el.style.cssText =
    `background-image:url("${atlas.url}");` +
    `background-size:${((cols * cell) / inner) * 100}% ${((rows * cell) / inner) * 100}%;` +
    `background-position:${(((col * cell + GUTTER) / px) * 100).toFixed(4)}% ${(((row * cell + GUTTER) / py) * 100).toFixed(4)}%`;
  return el;
}

/**
 * SVG markup showing the icon's atlas cell at (x, y, size) in the parent SVG's user units, or null.
 * `color` = the tint (tinted icons only).
 */
export function atlasSvg(id: string, x: number, y: number, size: number, cls: string, tint?: string): string | null {
  const n = cellOf(id, tint);
  if (n === null || !atlas) return null;
  const { cols, rows, cell, url } = atlas;
  const col = n % cols;
  const row = Math.floor(n / cols);
  const vb = `${col * cell + GUTTER} ${row * cell + GUTTER} ${cell - 2 * GUTTER} ${cell - 2 * GUTTER}`;
  return (
    `<svg x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${size}" height="${size}" class="${cls}" viewBox="${vb}">` +
    `<image href="${url}" width="${cols * cell}" height="${rows * cell}"/></svg>`
  );
}

function artFor(e: AtlasEntry, x: number, y: number, size: number): string {
  let art = iconMarkup(e.id).trim();
  art = art.replace(/^<svg\b/, `<svg x="${x}" y="${y}" width="${size}" height="${size}"${TINTED.has(e.id) && e.tint ? ` color="${e.tint}"` : ''}`);
  return art;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  return img.decode().then(() => img);
}

/**
 * Make sure the atlas holds `entries` with cells of at least `cellPx` device pixels (rebuilds when
 * something is missing or cells are too small; the old atlas stays in use until the new one is
 * decoded). Resolves when done; never rejects (on failure icons keep using the sprite).
 */
export function prepareIconAtlas(entries: readonly AtlasEntry[], cellPx: number): Promise<void> {
  const want = new Map<string, AtlasEntry>();
  const cell = Math.max(32, Math.min(256, Math.ceil(cellPx)));
  if (atlas) {
    for (const [k] of atlas.index) {
      const [id, tint] = k.split('|');
      want.set(k, { id: id!, tint: tint || undefined });
    }
  }
  let missing = !atlas || atlas.cell < cell;
  for (const e of entries) {
    if (!ICON_IDS.includes(e.id)) continue;
    if (TINTED.has(e.id) && !e.tint) continue;
    const k = keyOf(e.id, e.tint);
    if (!want.has(k)) {
      want.set(k, { id: e.id, tint: TINTED.has(e.id) ? e.tint!.toLowerCase() : undefined });
      missing = true;
    }
  }
  if (!missing || typeof document === 'undefined') return building ?? Promise.resolve();
  const size = Math.max(cell, atlas?.cell ?? 0);
  const prev = building ?? Promise.resolve();
  building = prev
    .then(() => build([...want.entries()], size))
    .catch((e: unknown) => console.warn('[icons] atlas failed', e));
  return building;
}

async function build(list: Array<[string, AtlasEntry]>, cell: number): Promise<void> {
  const cols = Math.max(2, Math.ceil(Math.sqrt(list.length)));
  const rows = Math.max(2, Math.ceil(list.length / cols));
  const inner = cell - 2 * GUTTER;
  const parts = list.map(([, e], n) => artFor(e, (n % cols) * cell + GUTTER, Math.floor(n / cols) * cell + GUTTER, inner));
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${rows * cell}">${parts.join('')}</svg>`;
  const svgUrl = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  let img: HTMLImageElement;
  try {
    img = await loadImage(svgUrl);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
  const canvas = document.createElement('canvas');
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error('toBlob failed');
  const url = URL.createObjectURL(blob);
  // Decoded before anything shows it (no half-drawn icons).
  await loadImage(url);
  // The previous atlas URL stays alive: elements made from it still show it.
  atlas = { url, cell, cols, rows, index: new Map(list.map(([k], n) => [k, n])) };
}

/** Test/diagnostics: the current atlas geometry (null until built). */
export function iconAtlasInfo(): { cell: number; cols: number; rows: number; icons: number } | null {
  return atlas ? { cell: atlas.cell, cols: atlas.cols, rows: atlas.rows, icons: atlas.index.size } : null;
}
