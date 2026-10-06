/**
 * The money atlas (public/fx/money.webp + money.json, scripts/fx/bake-money.mjs), used from the DOM
 * (no canvas): an element shows one frame by `background-image` / `-size` / `-position`, or — with
 * a tint — as a `mask-image` filled with the colour (the white dust / sparkle sprites; the mask uses
 * the frame's alpha). Fixed-box sprites (the spinning coins) keep the whole cell, so stepping frames
 * only changes `background-position`. It is separate from the canvas-VFX atlases: only the money
 * stage loads it.
 *
 * Wallet columns use the standalone repeatable tiles (`MONEY_TILES`, `background-repeat: repeat-y`).
 * `loadMoneyAtlas()` fetches money.json once; until it resolves, elements fall back to plain CSS
 * (coloured discs), so nothing waits on the network.
 */
import { MONEY_ANIMS, MONEY_FILES, MONEY_TILES, type MoneyAnimName } from '@/content/fx/money-manifest';
import type { Metal } from './denom';

interface MoneyFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
  sw: number;
  sh: number;
}

export interface MoneyAtlasJson {
  v: 1;
  dpr: number;
  atlas: { file: string; w: number; h: number; bytes: number };
  tiles: Record<string, { file: string; w: number; h: number; bytes: number }>;
  anims: Record<string, { n: number; frames: string[]; fps: number; loop: boolean; w: number; h: number; k: number; scale: number; fixedBox: boolean }>;
  frames: Record<string, MoneyFrame>;
}

let json: MoneyAtlasJson | null = null;
let loading: Promise<boolean> | null = null;

/** Fetch money.json (once). Resolves false when it is not reachable (tests, offline dev). */
export function loadMoneyAtlas(): Promise<boolean> {
  if (json) return Promise.resolve(true);
  if (!loading) {
    loading =
      typeof fetch !== 'function'
        ? Promise.resolve(false)
        : Promise.resolve()
            .then(() => fetch(MONEY_FILES.json))
            .then((r) => (r.ok ? (r.json() as Promise<MoneyAtlasJson>) : null))
            .then((j) => {
              json = j;
              return !!j;
            })
            .catch(() => false);
  }
  return loading;
}

export function atlasReady(): boolean {
  return !!json;
}

/** Test hook: inject an atlas (or clear it). */
export function setMoneyAtlas(j: MoneyAtlasJson | null): void {
  json = j;
  loading = j ? Promise.resolve(true) : null;
}

interface FrameBox {
  /** Element box relative to the sprite's nominal box top-left (CSS px at `scale`). */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Background (or mask) position / size strings. */
  pos: string;
  size: string;
  url: string;
}

const boxCache = new Map<string, FrameBox>();
const URL_ = `url("${MONEY_FILES.atlas}")`;

/** Where to draw frame `i` of `anim` at display scale `scale` (1 = nominal px). */
export function frameBox(anim: MoneyAnimName, i: number, scale: number): FrameBox | null {
  if (!json) return null;
  const key = `${anim}/${i}|${scale.toFixed(3)}`;
  let b = boxCache.get(key);
  if (b) return b;
  const fr = json.frames[`${anim}/${i}`];
  const a = json.anims[anim];
  if (!fr || !a) return null;
  const k = scale / a.scale;
  b = {
    left: fr.ox * k,
    top: fr.oy * k,
    width: fr.w * k,
    height: fr.h * k,
    pos: `${(-fr.x * k).toFixed(2)}px ${(-fr.y * k).toFixed(2)}px`,
    size: `${(json.atlas.w * k).toFixed(2)}px ${(json.atlas.h * k).toFixed(2)}px`,
    url: URL_,
  };
  if (boxCache.size > 600) boxCache.clear();
  boxCache.set(key, b);
  return b;
}

/**
 * Show frame `i` on `el`, sized to the frame's trimmed rect inside a nominal box whose top-left is
 * the element's offset-parent origin. `tint` fills the frame's silhouette with a colour (mask).
 * Every paint resets the other mode's properties (pooled nodes switch between both).
 */
export function paintFrame(el: HTMLElement, anim: MoneyAnimName, i: number, scale: number, tint?: string): boolean {
  const b = frameBox(anim, i, scale);
  if (!b) return false;
  const s = el.style;
  s.left = `${b.left}px`;
  s.top = `${b.top}px`;
  s.width = `${b.width}px`;
  s.height = `${b.height}px`;
  if (tint) {
    s.backgroundImage = 'none';
    s.backgroundColor = tint;
    s.webkitMaskImage = b.url;
    s.maskImage = b.url;
    s.webkitMaskSize = b.size;
    s.maskSize = b.size;
    s.webkitMaskPosition = b.pos;
    s.maskPosition = b.pos;
  } else {
    s.backgroundColor = '';
    s.webkitMaskImage = '';
    s.maskImage = '';
    s.webkitMaskSize = '';
    s.maskSize = '';
    s.webkitMaskPosition = '';
    s.maskPosition = '';
    s.backgroundImage = b.url;
    s.backgroundSize = b.size;
    s.backgroundPosition = b.pos;
  }
  return true;
}

/** Nominal size of an animation (CSS px at scale 1). */
export function animSize(anim: MoneyAnimName): { w: number; h: number; n: number } {
  const a = MONEY_ANIMS[anim];
  return { w: a.w, h: a.h, n: a.n };
}

/** URL of a wallet column's repeatable coin slice. */
export function sliceUrl(metal: Metal): string {
  return `url("${MONEY_TILES[`coin_slice_${metal}`]?.file ?? ''}")`;
}

export const coinAnim = (m: Metal): MoneyAnimName => `coin_spin_${m}`;
export const topAnim = (m: Metal): MoneyAnimName => `coin_top_${m}`;
