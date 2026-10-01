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
const MAX_TEXTURE = 1024;
const MIN_TEXTURE = 512;

interface Atlas {
  /** Increments per build (pattern ids of different atlases never collide). */
  serial: number;
  url: string;
  cell: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
  index: Map<string, number>;
}
let atlas: Atlas | null = null;
let serial = 0;
let building: Promise<void> | null = null;
const requested = new Map<string, AtlasEntry>();
let requestedCell = 0;
let generation = 0;
const liveUrls = new Set<string>();
const retiredUrls = new Set<string>();
let retireObserver: MutationObserver | null = null;

const keyOf = (id: string, tint?: string): string => (TINTED.has(id) ? `${id}|${(tint ?? '').toLowerCase()}` : id);

function atlasLayout(count: number, requestedCell: number): { cell: number; cols: number; rows: number; width: number; height: number } {
  const cols = Math.max(2, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(2, Math.ceil(count / cols));
  const cell = Math.min(requestedCell, Math.floor(MAX_TEXTURE / Math.max(cols, rows)));
  const texture = (n: number): number => Math.max(MIN_TEXTURE, 2 ** Math.ceil(Math.log2(n)));
  return { cell, cols, rows, width: texture(cols * cell), height: texture(rows * cell) };
}

function wantedAtlas(): { entries: Map<string, AtlasEntry>; layout: ReturnType<typeof atlasLayout> } {
  const entries = new Map<string, AtlasEntry>();
  if (atlas) {
    for (const [k] of atlas.index) {
      const [id, tint] = k.split('|');
      entries.set(k, { id: id!, tint: tint || undefined });
    }
  }
  for (const [k, e] of requested) entries.set(k, e);
  return { entries, layout: atlasLayout(entries.size, requestedCell) };
}

function revokeRetired(): void {
  for (const url of retiredUrls) URL.revokeObjectURL(url);
  retiredUrls.clear();
  retireObserver?.disconnect();
  retireObserver = null;
}

function releaseAfterOldDom(): void {
  queueMicrotask(() => {
    if (!retiredUrls.size) return;
    if (typeof document === 'undefined' || !document.body || !document.querySelector?.('.screen-ghost') || typeof MutationObserver === 'undefined') {
      revokeRetired();
      return;
    }
    retireObserver?.disconnect();
    retireObserver = new MutationObserver(() => {
      if (!document.querySelector('.screen-ghost')) revokeRetired();
    });
    retireObserver.observe(document.body, { childList: true, subtree: true });
    if (!document.querySelector('.screen-ghost')) revokeRetired();
  });
}

/** Release this game's atlas after the router removes any cross-fade clone of its DOM. */
export function disposeIconAtlas(): void {
  generation++;
  building = null;
  requested.clear();
  requestedCell = 0;
  if (atlas) liveUrls.add(atlas.url);
  atlas = null;
  for (const url of liveUrls) retiredUrls.add(url);
  liveUrls.clear();
  releaseAfterOldDom();
}

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
  const { cols, cell, width, height } = atlas;
  const inner = cell - 2 * GUTTER;
  const col = n % cols;
  const row = Math.floor(n / cols);
  const el = document.createElement('i');
  el.className = 'ic-bm';
  // Show the cell's interior [GUTTER, cell - GUTTER] scaled to the element box: the atlas is
  // (cols * cell / inner) element-widths wide; percentage positions are relative to (atlas - box).
  // Inline (not a shared rule) so an element keeps its atlas when a bigger one replaces it.
  const px = width - inner;
  const py = height - inner;
  el.style.cssText =
    `background-image:url("${atlas.url}");` +
    `background-size:${(width / inner) * 100}% ${(height / inner) * 100}%;` +
    `background-position:${(((col * cell + GUTTER) / px) * 100).toFixed(4)}% ${(((row * cell + GUTTER) / py) * 100).toFixed(4)}%`;
  return el;
}

/**
 * SVG markup showing the icon's atlas cell at (x, y, size) in the parent SVG's user units, or null:
 * a `<rect>` filled with a pattern that maps the cell onto it (`def`, to put once into the SVG's
 * `<defs>` under `defId`). A rect keeps the icon's bounding box exact; a nested `<svg viewBox>`
 * around the whole atlas image would clip it visually but its box would span the whole atlas.
 * `tint` = the color `currentColor` resolves to there (tinted icons only).
 */
export function atlasSvg(id: string, x: number, y: number, size: number, cls: string, tint?: string): { markup: string; defId: string; def: string } | null {
  const n = cellOf(id, tint);
  if (n === null || !atlas) return null;
  const { cols, cell, width, height, url, serial } = atlas;
  const col = n % cols;
  const row = Math.floor(n / cols);
  const defId = `lr-ap${serial}-${n}`;
  const vb = `${col * cell + GUTTER} ${row * cell + GUTTER} ${cell - 2 * GUTTER} ${cell - 2 * GUTTER}`;
  return {
    defId,
    def: `<pattern id="${defId}" patternUnits="objectBoundingBox" width="1" height="1" viewBox="${vb}"><image href="${url}" width="${width}" height="${height}"/></pattern>`,
    markup: `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${size}" height="${size}" class="${cls}" fill="url(#${defId})"/>`,
  };
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
  const cell = Math.max(32, Math.min(256, Math.ceil(cellPx)));
  for (const e of entries) {
    if (!ICON_IDS.includes(e.id)) continue;
    if (TINTED.has(e.id) && !e.tint) continue;
    const k = keyOf(e.id, e.tint);
    if (!requested.has(k)) {
      requested.set(k, { id: e.id, tint: TINTED.has(e.id) ? e.tint!.toLowerCase() : undefined });
    }
  }
  requestedCell = Math.max(requestedCell, cell);
  const want = wantedAtlas();
  const missing = !atlas || atlas.cell < want.layout.cell || atlas.width !== want.layout.width || atlas.height !== want.layout.height || [...want.entries.keys()].some((k) => !atlas!.index.has(k));
  if (!missing || typeof document === 'undefined') return building ?? Promise.resolve();
  const prev = building ?? Promise.resolve();
  const buildGeneration = generation;
  building = prev
    .then(() => {
      if (buildGeneration !== generation) return;
      const want = wantedAtlas();
      if (atlas && atlas.cell >= want.layout.cell && atlas.width === want.layout.width && atlas.height === want.layout.height && [...want.entries.keys()].every((k) => atlas!.index.has(k))) return;
      return build([...want.entries], want.layout, buildGeneration);
    })
    .catch((e: unknown) => console.warn('[icons] atlas failed', e));
  return building;
}

async function build(list: Array<[string, AtlasEntry]>, { cell, cols, rows, width, height }: ReturnType<typeof atlasLayout>, buildGeneration: number): Promise<void> {
  const inner = cell - 2 * GUTTER;
  const parts = list.map(([, e], n) => artFor(e, (n % cols) * cell + GUTTER, Math.floor(n / cols) * cell + GUTTER, inner));
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join('')}</svg>`;
  const svgUrl = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  let img: HTMLImageElement;
  try {
    img = await loadImage(svgUrl);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
  if (buildGeneration !== generation) return;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error('toBlob failed');
  if (buildGeneration !== generation) return;
  const url = URL.createObjectURL(blob);
  try {
    // Decoded before anything shows it (no half-drawn icons).
    await loadImage(url);
    if (buildGeneration !== generation) {
      URL.revokeObjectURL(url);
      return;
    }
    // The previous atlas URL stays alive: elements made from it still show it.
    liveUrls.add(url);
    atlas = { serial: ++serial, url, cell, cols, rows, width, height, index: new Map(list.map(([k], n) => [k, n])) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/** Test/diagnostics: the current atlas geometry (null until built). */
export function iconAtlasInfo(): { cell: number; cols: number; rows: number; width: number; height: number; icons: number } | null {
  return atlas ? { cell: atlas.cell, cols: atlas.cols, rows: atlas.rows, width: atlas.width, height: atlas.height, icons: atlas.index.size } : null;
}
