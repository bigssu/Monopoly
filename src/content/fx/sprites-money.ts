/**
 * Money-event sprites (docs/MONEY-EVENTS.md §8): silver / bronze spinning coins, the coin-stack
 * slice that tiles a wallet column (`tile`: also baked as a standalone repeatable image), the
 * column's top coin face, a strongbox (closed / open), a bank, a land-plot sign, a dirt plot
 * (construction site) and a gold coin burst.
 *
 * Same flat two-tone style as src/content/icons (a darker copy ~2 units under a lighter top layer,
 * soft white highlights, no outlines). Original art; NO text, digits or currency glyphs.
 *
 * The big "hero" pictures (vault, bank, sign, plot) are also drawn straight from these functions
 * as inline SVG by the money stage (src/ui/fx/money), so they stay sharp at 60 % of the screen.
 */
import { C, doc, f, groundShadow, lerp, rad, spark4, starPath, type SpriteDef } from './kit';
import { COLOR_SPRITES } from './sprites-color';
import { MASK_SPRITES } from './sprites-mask';

export type Metal = 'gold' | 'silver' | 'bronze';

/** Coin palettes: face (top layer), rim (darker copy / edge), deep (shadowed edge), light (highlight). */
const METAL: Record<Metal, { face: string; rim: string; deep: string; light: string }> = {
  gold: { face: C.gold, rim: C.goldD, deep: C.goldDD, light: C.goldL },
  silver: { face: '#DCE3EE', rim: '#A3AFC4', deep: '#738099', light: '#F6F8FC' },
  bronze: { face: '#E69C61', rim: '#BD7442', deep: '#8D5029', light: '#F8C899' },
};

/** Emblem per metal (shape differs too, not only colour): gold star, silver diamond, bronze ring. */
function emblem(m: Metal, ink: string, r = 8.6): string {
  if (m === 'gold') return `<path d="${starPath(0, 0.5, r, r * 0.43)}" fill="${ink}" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>`;
  if (m === 'silver') return `<path d="M0 ${f(-r)}L${f(r * 0.72)} 0L0 ${f(r)}L${f(-r * 0.72)} 0Z" fill="${ink}" stroke="${ink}" stroke-width="1.6" stroke-linejoin="round"/>`;
  return `<circle r="${f(r * 0.62)}" fill="none" stroke="${ink}" stroke-width="2.6"/><circle r="${f(r * 0.2)}" fill="${ink}"/>`;
}

// ---------------------------------------------------------------- spinning coin (any metal)

/** One frame of a coin spinning about its vertical axis (same geometry as the gold `coin_spin`). */
function coinSpinMetal(m: Metal): (i: number, n: number) => string {
  const P = METAL[m];
  return (i, n) => {
    const th = (2 * Math.PI * i) / n;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const sx = Math.max(0.05, Math.abs(c));
    const R = 21;
    const half = 2.8;
    const nearOff = (c >= 0 ? 1 : -1) * half * s;
    const farOff = -nearOff;
    const e = half * Math.abs(s);
    const back = `<circle r="8" fill="none" stroke="${P.rim}" stroke-width="2.6"/><circle r="2.8" fill="${P.rim}"/>`;
    const face =
      `<g transform="translate(${f(24 + nearOff)} 23) scale(${f(sx)} 1)">` +
      `<circle r="${R}" fill="${P.face}"/>` +
      `<circle r="15.2" fill="none" stroke="${P.rim}" stroke-width="2.6"/>` +
      (c >= 0 ? emblem(m, P.rim) : back) +
      `<path d="M-15 -9Q-11 -17 -3 -18.5Q-9 -14 -11 -7Z" fill="#fff" opacity=".65"/>` +
      `</g>`;
    const body =
      groundShadow(24, 45.6, 12 * lerp(0.45, 1, sx), 1.6) +
      `<g fill="${P.rim}">` +
      `<ellipse cx="${f(24 + farOff)}" cy="24.6" rx="${f(R * sx)}" ry="${R}"/>` +
      `<rect x="${f(24 - e)}" y="${f(24.6 - R)}" width="${f(e * 2)}" height="${R * 2}"/>` +
      `<ellipse cx="${f(24 + nearOff)}" cy="24.6" rx="${f(R * sx)}" ry="${R}"/>` +
      `</g>` +
      face;
    return doc(48, 48, body);
  };
}

// ---------------------------------------------------------------- stack slice (tile) + top face

/** Nominal size of one coin in a wallet column: width × thickness. The tile repeats vertically. */
export const SLICE = { w: 40, h: 6 } as const;
/** Top face of the column's top coin (an ellipse seen from slightly above). */
export const COIN_TOP = { w: 40, h: 14 } as const;

/**
 * One coin seen edge-on in a stack: a cylinder-shaded band with a reeded edge, a bright rim line
 * at the top and a dark gap curve at the bottom. Tiles seamlessly in y (repeat-y builds a column).
 */
function coinSlice(m: Metal): string {
  const P = METAL[m];
  const { w, h } = SLICE;
  const defs =
    `<linearGradient id="cy" x1="0" x2="1" y1="0" y2="0">` +
    `<stop offset="0" stop-color="${P.deep}"/><stop offset=".16" stop-color="${P.rim}"/>` +
    `<stop offset=".3" stop-color="${P.face}"/><stop offset=".42" stop-color="${P.light}"/>` +
    `<stop offset=".56" stop-color="${P.face}"/><stop offset=".84" stop-color="${P.rim}"/>` +
    `<stop offset="1" stop-color="${P.deep}"/></linearGradient>`;
  let reeds = '';
  for (let x = 3; x < w - 1; x += 2.6) reeds += `M${f(x)} 2.1V4.1`;
  const body =
    `<rect width="${w}" height="${h}" fill="url(#cy)"/>` +
    `<path d="${reeds}" stroke="${P.deep}" stroke-width=".55" opacity=".35"/>` +
    `<path d="M0 .7Q${w / 2} 2.6 ${w} .7" fill="none" stroke="#fff" stroke-width=".8" opacity=".55"/>` +
    `<path d="M0 4.5Q${w / 2} 7.3 ${w} 4.5V${h}H0Z" fill="${P.deep}"/>`;
  return doc(w, h, body, defs);
}

/** The top coin's face: an ellipse with the metal's emblem, foreshortened. */
function coinTop(m: Metal): string {
  const P = METAL[m];
  const { w, h } = COIN_TOP;
  const body =
    `<ellipse cx="${w / 2}" cy="${f(h / 2 + 0.8)}" rx="${f(w / 2 - 0.2)}" ry="6.3" fill="${P.rim}"/>` +
    `<ellipse cx="${w / 2}" cy="${f(h / 2)}" rx="${f(w / 2 - 0.2)}" ry="6.3" fill="${P.face}"/>` +
    `<ellipse cx="${w / 2}" cy="${f(h / 2)}" rx="14" ry="4.4" fill="none" stroke="${P.rim}" stroke-width="1.6"/>` +
    `<g transform="translate(${w / 2} ${f(h / 2)}) scale(1 .32)">${emblem(m, P.rim, 7.4)}</g>` +
    `<path d="M6 6.2Q10 2.6 18 2.1Q11 3.6 8.4 6.6Z" fill="#fff" opacity=".7"/>`;
  return doc(w, h, body);
}

// ---------------------------------------------------------------- vault (strongbox)

const STEEL = { body: '#4C5A78', bodyD: '#36415A', door: '#7D8BAA', doorD: '#5F6C88', light: '#B5C1DA' };

/** A chunky strongbox: closed (dial + handle) or open (door swung left, gold glowing inside). */
export function vault(open: boolean): string {
  const S = STEEL;
  const defs = open
    ? `<radialGradient id="gl" cx=".5" cy=".62" r=".6"><stop offset="0" stop-color="#FFF3B0" stop-opacity=".95"/>` +
      `<stop offset=".55" stop-color="#FFD45C" stop-opacity=".55"/><stop offset="1" stop-color="#FFC94A" stop-opacity="0"/></radialGradient>`
    : '';
  let body =
    groundShadow(48, 90.5, 36, 3) +
    // feet
    `<rect x="18" y="80" width="12" height="9" rx="3" fill="${S.bodyD}"/><rect x="66" y="80" width="12" height="9" rx="3" fill="${S.bodyD}"/>` +
    // body: dark copy under, top layer
    `<rect x="10" y="14" width="76" height="70" rx="11" fill="${S.bodyD}"/>` +
    `<rect x="10" y="12" width="76" height="69" rx="11" fill="${S.body}"/>` +
    // corner caps (gold trim)
    `<path d="M10 25V23Q10 12 21 12H23Z" fill="${C.goldD}"/><path d="M86 25V23Q86 12 75 12H73Z" fill="${C.goldD}"/>` +
    `<path d="M10 68V70Q10 81 21 81H23Z" fill="${C.goldD}"/><path d="M86 68V70Q86 81 75 81H73Z" fill="${C.goldD}"/>` +
    // top highlight
    `<rect x="18" y="15" width="34" height="3" rx="1.5" fill="#fff" opacity=".22"/>`;
  if (!open) {
    body +=
      // door panel
      `<rect x="19" y="21" width="58" height="53" rx="6" fill="${S.doorD}"/>` +
      `<rect x="19" y="20" width="58" height="52" rx="6" fill="${S.door}"/>` +
      `<rect x="23" y="24" width="50" height="44" rx="4" fill="none" stroke="${S.light}" stroke-width="1.4" opacity=".5"/>` +
      // hinges
      `<rect x="15" y="27" width="6" height="11" rx="2" fill="${C.goldD}"/><rect x="15" y="55" width="6" height="11" rx="2" fill="${C.goldD}"/>` +
      // dial
      `<circle cx="44" cy="47.6" r="14.5" fill="${C.goldD}"/><circle cx="44" cy="46" r="14.5" fill="${C.gold}"/>` +
      `<circle cx="44" cy="46" r="10" fill="none" stroke="${C.goldD}" stroke-width="2"/>` +
      Array.from({ length: 12 }, (_, k) => {
        const a = rad(k * 30);
        return `<path d="M${f(44 + Math.cos(a) * 11.8)} ${f(46 + Math.sin(a) * 11.8)}L${f(44 + Math.cos(a) * 13.4)} ${f(46 + Math.sin(a) * 13.4)}" stroke="${C.goldDD}" stroke-width="1.3" stroke-linecap="round"/>`;
      }).join('') +
      `<circle cx="44" cy="46" r="4.6" fill="${C.goldDD}"/><circle cx="44" cy="46" r="2" fill="${C.goldL}"/>` +
      `<path d="M35 39Q38 34.5 43.5 33.5Q39 36.5 37.5 41Z" fill="#fff" opacity=".6"/>` +
      // handle (three spokes on a hub)
      `<circle cx="67" cy="46" r="3.6" fill="${S.bodyD}"/>` +
      `<path d="M67 46L67 36M67 46L75.7 51M67 46L58.3 51" stroke="${S.bodyD}" stroke-width="3.2" stroke-linecap="round" transform="translate(0 1)"/>` +
      `<path d="M67 46L67 36M67 46L75.7 51M67 46L58.3 51" stroke="${S.light}" stroke-width="3.2" stroke-linecap="round"/>` +
      `<circle cx="67" cy="36" r="2.4" fill="${C.gold}"/><circle cx="75.7" cy="51" r="2.4" fill="${C.gold}"/><circle cx="58.3" cy="51" r="2.4" fill="${C.gold}"/>` +
      // rivets
      [[25, 26], [71, 26], [25, 66], [71, 66]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="${S.light}" opacity=".8"/>`).join('');
  } else {
    body +=
      // dark interior with shelves of gold
      `<rect x="19" y="20" width="58" height="53" rx="6" fill="#1E2436"/>` +
      `<rect x="19" y="20" width="58" height="53" rx="6" fill="url(#gl)"/>` +
      `<rect x="22" y="45" width="52" height="2.6" rx="1.3" fill="${S.bodyD}"/>` +
      // bars on the shelf
      `<path d="M27 45L30 38H40L43 45Z" fill="${C.goldD}"/><path d="M28.5 43.6L31 38.6H39L41.5 43.6Z" fill="${C.gold}"/>` +
      `<path d="M45 45L48 38H58L61 45Z" fill="${C.goldD}"/><path d="M46.5 43.6L49 38.6H57L59.5 43.6Z" fill="${C.gold}"/>` +
      `<path d="M36 38L39 31H49L52 38Z" fill="${C.goldD}"/><path d="M37.5 36.6L40 31.6H48L50.5 36.6Z" fill="${C.goldL}"/>` +
      // coin pile at the bottom
      [[30, 66, 6], [40, 64, 6.5], [51, 65, 6], [61, 66, 5.5], [35, 59, 5.5], [47, 58, 6], [57, 60, 5], [42, 52.5, 5]]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y! + 1.2}" r="${r}" fill="${C.goldD}"/><circle cx="${x}" cy="${y}" r="${r}" fill="${C.gold}"/><circle cx="${x! - r! * 0.3}" cy="${y! - r! * 0.3}" r="${f(r! * 0.3)}" fill="#fff" opacity=".55"/>`)
        .join('') +
      // the door, swung open to the left (seen at an angle)
      `<path d="M19 21L4 15V82L19 74Z" fill="${S.doorD}"/>` +
      `<path d="M18 20L3 14V80L18 72Z" fill="${S.door}"/>` +
      `<ellipse cx="10.5" cy="46" rx="4.4" ry="11.5" fill="${C.goldD}"/><ellipse cx="10" cy="45" rx="4.4" ry="11.5" fill="${C.gold}"/>` +
      `<ellipse cx="10" cy="45" rx="1.6" ry="4" fill="${C.goldDD}"/>` +
      // sparkles
      `<path d="${spark4(70, 26, 6, 0.2)}" fill="#fff"/><path d="${spark4(28, 31, 4, 0.2)}" fill="#fff" opacity=".85"/>`;
  }
  return doc(96, 96, body, defs);
}

// ---------------------------------------------------------------- bank

/** A small classical bank: steps, four columns, a blue pediment with a coin emblem. */
export function bank(): string {
  const cream = '#FFF4DC';
  const creamD = '#E3D3AC';
  const col = (x: number): string =>
    `<rect x="${x}" y="40" width="11" height="32" fill="${creamD}"/><rect x="${x}" y="40" width="7.5" height="32" fill="${cream}"/>` +
    `<rect x="${x - 1.5}" y="38" width="14" height="3.4" rx="1" fill="${creamD}"/>`;
  const body =
    groundShadow(48, 91, 40, 3) +
    // steps
    `<rect x="8" y="80" width="80" height="9" rx="2" fill="${creamD}"/><rect x="8" y="79" width="80" height="7" rx="2" fill="${cream}"/>` +
    `<rect x="13" y="73" width="70" height="8" rx="2" fill="${creamD}"/><rect x="13" y="72" width="70" height="6.5" rx="2" fill="${cream}"/>` +
    // back wall + door
    `<rect x="18" y="40" width="60" height="33" fill="#D9C79C"/>` +
    `<path d="M41 73V58Q41 51.5 48 51.5Q55 51.5 55 58V73Z" fill="#7A5343"/><path d="M48 51.5V73" stroke="#5B3B2F" stroke-width="1.2"/>` +
    col(19) + col(32) + col(55) + col(68) +
    // architrave
    `<rect x="12" y="32" width="72" height="8" rx="1.5" fill="${creamD}"/><rect x="12" y="31" width="72" height="6.5" rx="1.5" fill="${cream}"/>` +
    // pediment
    `<path d="M9 33L48 9L87 33Z" fill="${C.blueD}" stroke="${C.blueD}" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="M9 31L48 7L87 31Z" fill="${C.blue}" stroke="${C.blue}" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="M48 7L87 31H48Z" fill="#1B2140" opacity=".15"/>` +
    `<path d="M14 29.5L48 9.5L42 15Z" fill="#fff" opacity=".28"/>` +
    // coin emblem
    `<circle cx="48" cy="23.2" r="7.2" fill="${C.goldD}"/><circle cx="48" cy="22" r="7.2" fill="${C.gold}"/>` +
    `<path d="${starPath(48, 22.4, 4.2, 1.8)}" fill="${C.goldD}"/>` +
    // flag on top
    `<rect x="47" y="1.6" width="2" height="7" rx="1" fill="${C.steelD}"/><path d="M49 2L56 4.2L49 6.4Z" fill="${C.red}"/>`;
  return doc(96, 96, body);
}

// ---------------------------------------------------------------- land plot sign

/** A wooden "this lot" sign: a post and a cream board with a red map pin. */
export function plotSign(): string {
  const body =
    groundShadow(32, 67.5, 14, 1.8) +
    // grass tufts
    `<path d="M21 67.5Q22 61 24.5 59Q24 63 25.5 67.5ZM40 67.5Q41.5 61.5 44 60Q43 64 44.5 67.5Z" fill="${C.greenD}"/>` +
    // post
    `<rect x="28.5" y="26" width="7" height="41.5" rx="2" fill="${C.woodD}"/><rect x="28.5" y="26" width="4.6" height="41.5" rx="2" fill="${C.wood}"/>` +
    // board
    `<rect x="5" y="9" width="54" height="31" rx="5" fill="${C.woodD}"/>` +
    `<rect x="5" y="7" width="54" height="31" rx="5" fill="${C.wood}"/>` +
    `<rect x="9" y="10.5" width="46" height="24" rx="3" fill="#FFF4DC"/>` +
    `<circle cx="12" cy="10" r="1.4" fill="${C.woodD}"/><circle cx="52" cy="10" r="1.4" fill="${C.woodD}"/>` +
    // map pin
    `<path d="M32 33Q24.5 24.5 24.5 20Q24.5 13 32 13Q39.5 13 39.5 20Q39.5 24.5 32 33Z" fill="${C.redD}" transform="translate(0 1.2)"/>` +
    `<path d="M32 33Q24.5 24.5 24.5 20Q24.5 13 32 13Q39.5 13 39.5 20Q39.5 24.5 32 33Z" fill="${C.red}"/>` +
    `<circle cx="32" cy="19.6" r="3" fill="#fff"/>` +
    `<path d="M14 31.5H22M42 31.5H50" stroke="${C.greenD}" stroke-width="2.2" stroke-linecap="round"/>`;
  return doc(64, 72, body);
}

// ---------------------------------------------------------------- dirt plot (construction site)

/** An isometric lot of fresh dirt: survey stakes with orange tape, pebbles and a traffic cone. */
export function dirtPlot(): string {
  const top = 'M64 12L122 40L64 68L6 40Z';
  const stake = (x: number, y: number): string =>
    `<rect x="${x - 1.3}" y="${y - 13}" width="2.6" height="14" rx="1" fill="${C.woodD}"/>` +
    `<path d="M${x + 1.2} ${y - 12}L${x + 8} ${y - 10.2}L${x + 1.2} ${y - 8.2}Z" fill="${C.orange}"/>`;
  const body =
    `<ellipse cx="64" cy="70" rx="56" ry="4" fill="${C.ink}" opacity=".13"/>` +
    // thickness
    `<path d="M6 40L64 68L122 40V46L64 74L6 46Z" fill="#8A5A34"/>` +
    `<path d="M64 68L122 40V46L64 74Z" fill="#6F4728"/>` +
    // top face
    `<path d="${top}" fill="#C08A57"/>` +
    `<path d="M64 16L114 40L64 64L14 40Z" fill="#CF9A66"/>` +
    // mound
    `<path d="M40 44Q46 30 62 29Q80 28.5 88 42Q78 50 64 50Q48 50 40 44Z" fill="#A87444"/>` +
    `<path d="M44 42Q50 32 62 31.5Q76 31 83 41Q72 46 62 46Q51 46 44 42Z" fill="#B98251"/>` +
    `<path d="M50 37Q55 33 61 33" stroke="#E1B585" stroke-width="2" stroke-linecap="round" fill="none"/>` +
    // pebbles
    [[30, 42], [36, 48], [92, 45], [98, 39], [72, 56], [55, 55]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="2.6" ry="1.6" fill="#8F6440"/><ellipse cx="${x! - 0.5}" cy="${y! - 0.5}" rx="1.6" ry=".9" fill="#E1B585"/>`).join('') +
    // stakes at the corners
    stake(64, 17) + stake(15, 41) + stake(113, 41) +
    // cone (front)
    `<ellipse cx="64" cy="64" rx="8" ry="2.6" fill="#BF5A25"/>` +
    `<path d="M58.5 63L62.5 48H65.5L69.5 63Z" fill="${C.orange}"/>` +
    `<path d="M60.3 56.5H67.7L66.9 53.3H61.1Z" fill="#fff"/>` +
    `<path d="M62.5 48H64L61 62H59Z" fill="#fff" opacity=".35"/>` +
    stake(64, 66);
  return doc(128, 76, body);
}

// ---------------------------------------------------------------- coin burst

/** Gold sparkle burst for a coin landing / a pile merging (expanding four-point glints + flash). */
function coinBurst(i: number, n: number): string {
  const t = i / (n - 1);
  const cx = 32;
  const cy = 32;
  let body = '';
  if (i < 2) {
    // a 2-frame flash (white core in a gold halo), gone before the glints spread
    const r = i === 0 ? 9 : 13;
    body += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.gold}" opacity="${i === 0 ? 0.95 : 0.55}"/>`;
    body += `<circle cx="${cx}" cy="${cy}" r="${f(r * 0.6)}" fill="#fff" opacity="${i === 0 ? 1 : 0.7}"/>`;
  }
  const ring = lerp(9, 27, 1 - (1 - t) ** 2);
  const fade = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
  for (let k = 0; k < 8; k++) {
    const a = rad(k * 45 + 22.5);
    const big = k % 2 === 0;
    const r = (big ? 1 : 0.78) * ring;
    const s = (big ? 6 : 4) * lerp(1, 0.45, t);
    body += `<path d="${spark4(cx + Math.cos(a) * r, cy + Math.sin(a) * r, s, 0.22)}" fill="${big ? C.goldL : '#fff'}" opacity="${f(Math.max(0.05, fade))}"/>`;
  }
  for (let k = 0; k < 6; k++) {
    const a = rad(k * 60);
    const r = ring * 0.62;
    body += `<circle cx="${f(cx + Math.cos(a) * r)}" cy="${f(cy + Math.sin(a) * r)}" r="${f(lerp(2.2, 0.8, t))}" fill="${C.gold}" opacity="${f(Math.max(0.05, fade))}"/>`;
  }
  return doc(64, 64, body);
}

const METALS: Metal[] = ['gold', 'silver', 'bronze'];

/** Spinning-coin frames for the DOM coin pool (8-frame strip, baked 1.2× for 40–90 px coins). */
const COIN_SPIN = { n: 8, k: 1.2 } as const;

/** Sprites borrowed from the shared FX set, re-baked into the money atlas (white ones are tinted by
 *  `mask-image` in the DOM), so the money stage never loads the canvas-VFX atlases. */
const BORROW: Record<string, number> = { hammer: 0.75, siren: 0.6, dust_puff: 0.34, sparkle4: 0.45 };
const borrowed: SpriteDef[] = [...COLOR_SPRITES, ...MASK_SPRITES]
  .filter((d) => d.name in BORROW)
  .map((d) => ({ ...d, cls: 'color', k: BORROW[d.name]! }));

/**
 * The money atlas (scripts/fx/bake-money.mjs → public/fx/money.webp + money.json +
 * src/content/fx/money-manifest.ts): ONE colour sheet, loaded only by the money stage.
 */
export const MONEY_SPRITES: SpriteDef[] = [
  ...METALS.map(
    (m): SpriteDef => ({ name: `coin_spin_${m}`, cls: 'color', w: 48, h: 48, n: COIN_SPIN.n, fps: 20, loop: true, k: COIN_SPIN.k, fixedBox: true, svg: coinSpinMetal(m) }),
  ),
  ...METALS.map((m): SpriteDef => ({ name: `coin_slice_${m}`, cls: 'color', w: SLICE.w, h: SLICE.h, n: 1, fps: 1, loop: false, k: 2, tile: true, edgeOk: true, svg: () => coinSlice(m) })),
  ...METALS.map((m): SpriteDef => ({ name: `coin_top_${m}`, cls: 'color', w: COIN_TOP.w, h: COIN_TOP.h, n: 1, fps: 1, loop: false, k: 2, edgeOk: true, svg: () => coinTop(m) })),
  { name: 'coin_burst', cls: 'color', w: 64, h: 64, n: 6, fps: 20, loop: false, k: 0.5, svg: coinBurst },
  // Heroes: drawn as inline SVG on the stage (sharp at 60 % of the screen); small baked copies for
  // the contact sheet and any bitmap use.
  { name: 'vault', cls: 'color', w: 96, h: 96, n: 2, fps: 1, loop: false, k: 0.3, svg: (i) => vault(i === 1) },
  { name: 'bank', cls: 'color', w: 96, h: 96, n: 1, fps: 1, loop: false, k: 0.3, svg: () => bank() },
  { name: 'plot_sign', cls: 'color', w: 64, h: 72, n: 1, fps: 1, loop: false, k: 0.3, svg: () => plotSign() },
  { name: 'dirt_plot', cls: 'color', w: 128, h: 76, n: 1, fps: 1, loop: false, k: 0.3, svg: () => dirtPlot() },
  ...borrowed,
];
