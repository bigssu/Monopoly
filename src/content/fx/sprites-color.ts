/**
 * Colour-atlas sprites (fixed colours, flat two-tone style matching src/content/icons/*):
 * a darker copy offset down ~2 units under a lighter top layer, soft white highlights, no outlines.
 * NO text, digits or currency glyphs anywhere - emblems are stars / concentric circles / check marks.
 */
import { C, clamp, doc, f, groundShadow, lerp, rad, starPath, type SpriteDef } from './kit';

// ---------------------------------------------------------------- 1. coin_spin

function coinSpin(i: number, n: number): string {
  const th = (2 * Math.PI * i) / n;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const sx = Math.max(0.05, Math.abs(c));
  const R = 21;
  const half = 2.8; // half thickness
  const nearOff = (c >= 0 ? 1 : -1) * half * s;
  const farOff = -nearOff;
  const e = half * Math.abs(s);
  const front = c >= 0;
  const emblem = front
    ? `<path d="${starPath(0, 0.5, 8.6, 3.7)}" fill="${C.goldD}" stroke="${C.goldD}" stroke-width="2" stroke-linejoin="round"/>`
    : `<circle r="8" fill="none" stroke="${C.goldD}" stroke-width="2.6"/><circle r="2.8" fill="${C.goldD}"/>`;
  const face =
    `<g transform="translate(${f(24 + nearOff)} 23) scale(${f(sx)} 1)">` +
    `<circle r="${R}" fill="${C.gold}"/>` +
    `<circle r="15.2" fill="none" stroke="${C.goldD}" stroke-width="2.6"/>` +
    emblem +
    `<path d="M-15 -9Q-11 -17 -3 -18.5Q-9 -14 -11 -7Z" fill="#fff" opacity=".65"/>` +
    `</g>`;
  const body =
    groundShadow(24, 45.6, 12 * lerp(0.45, 1, sx), 1.6) +
    // dark rim / far face / edge band
    `<g fill="${C.goldD}">` +
    `<ellipse cx="${f(24 + farOff)}" cy="24.6" rx="${f(R * sx)}" ry="${R}"/>` +
    `<rect x="${f(24 - e)}" y="${f(24.6 - R)}" width="${f(e * 2)}" height="${R * 2}"/>` +
    `<ellipse cx="${f(24 + nearOff)}" cy="24.6" rx="${f(R * sx)}" ry="${R}"/>` +
    `</g>` +
    face;
  return doc(48, 48, body);
}

// ---------------------------------------------------------------- 2. bill_flutter

function billFlutter(i: number, n: number): string {
  const phase = (2 * Math.PI * i) / n;
  const A = 2.5;
  const k = 0.17; // spatial frequency
  const strips = 10;
  const x0 = 7;
  const bw = 42;
  const sw = bw / strips;
  const bill = (): string =>
    `<rect x="${x0}" y="6" width="${bw}" height="22" rx="3.2" fill="${C.greenD}"/>` +
    `<rect x="${x0 + 2}" y="8" width="${bw - 4}" height="18" rx="2" fill="${C.green}"/>` +
    `<rect x="${x0 + 4}" y="10" width="${bw - 8}" height="14" rx="1.6" fill="none" stroke="#8FE0AF" stroke-width="1" stroke-dasharray="2.2 1.8"/>` +
    `<circle cx="28" cy="17" r="7" fill="#8FE0AF"/>` +
    `<circle cx="28" cy="17" r="5.2" fill="none" stroke="${C.greenD}" stroke-width="1.5"/>` +
    `<path d="${starPath(28, 17.2, 3.2, 1.4)}" fill="${C.greenD}"/>` +
    `<circle cx="${x0 + 6}" cy="17" r="2" fill="${C.greenD}"/><circle cx="${x0 + bw - 6}" cy="17" r="2" fill="${C.greenD}"/>` +
    `<path d="M${x0 + 3.5} 8.6H${x0 + 15}" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".55"/>`;
  let defs = '';
  let g = '';
  for (let s = 0; s < strips; s++) {
    const xc = x0 + sw * (s + 0.5);
    const dy = A * Math.sin(phase + xc * k);
    const slope = A * k * Math.cos(phase + xc * k);
    const deg = (Math.atan(slope) * 180) / Math.PI;
    defs += `<clipPath id="c${s}"><rect x="${f(x0 + sw * s - 0.02)}" y="-10" width="${f(sw + 0.06)}" height="60"/></clipPath>`;
    const shade =
      slope > 0
        ? `<rect x="${x0}" y="5" width="${bw}" height="24" fill="#fff" opacity="${f(clamp(slope * 0.9, 0, 0.32))}"/>`
        : `<rect x="${x0}" y="5" width="${bw}" height="24" fill="${C.ink}" opacity="${f(clamp(-slope * 0.9, 0, 0.3))}"/>`;
    g +=
      `<g clip-path="url(#c${s})"><g transform="translate(${f(xc)} ${f(dy)}) skewY(${f(deg)}) translate(${f(-xc)} 0)">` +
      bill() +
      shade +
      `</g></g>`;
  }
  const tilt = 5 * Math.sin(phase + 1.3);
  const body = `<g transform="translate(0 0) rotate(${f(tilt)} 28 17)">${g}</g>`;
  return doc(56, 34, body, defs);
}

// ---------------------------------------------------------------- 3. moneybag

function moneybag(): string {
  const sack = (dy: number, fill: string): string =>
    `<path transform="translate(0 ${dy})" d="M23 20Q11 32 9.5 45Q8 58 32 58Q56 58 54.5 45Q53 32 41 20Z" fill="${fill}"/>`;
  const body =
    groundShadow(32, 60.8, 21, 2.4) +
    // frill on top
    `<path d="M22 21L17 8Q25 13 32 9.5Q39 13 47 8L42 21Z" fill="#BE8F4E"/>` +
    `<path d="M22 19.5L18 9.5Q25 14 32 11Q39 14 46 9.5L42 19.5Z" fill="#E2B673"/>` +
    sack(1.8, '#BE8F4E') +
    sack(0, '#E2B673') +
    // emblem coin
    `<circle cx="32" cy="42.6" r="11.5" fill="${C.goldD}"/><circle cx="32" cy="41" r="11.5" fill="${C.gold}"/>` +
    `<circle cx="32" cy="41" r="8.2" fill="none" stroke="${C.goldD}" stroke-width="2"/>` +
    `<path d="${starPath(32, 41.4, 5.4, 2.3)}" fill="${C.goldD}" stroke="${C.goldD}" stroke-width="1" stroke-linejoin="round"/>` +
    // tie ribbon + bow
    `<rect x="21" y="18" width="22" height="6" rx="3" fill="${C.redD}"/><rect x="21" y="17" width="22" height="6" rx="3" fill="${C.red}"/>` +
    `<path d="M32 20Q23 10 19.5 15.5Q19 21 32 20Z" fill="${C.red}"/><path d="M32 20Q41 10 44.5 15.5Q45 21 32 20Z" fill="${C.red}"/>` +
    `<circle cx="32" cy="20" r="3.2" fill="${C.redD}"/>` +
    // highlight
    `<path d="M15 41Q15.5 34 20.5 29.5Q17.5 36 18.5 44Z" fill="#fff" opacity=".55"/>` +
    `<path d="M50 6Q50.8 9.7 54.5 10.5Q50.8 11.3 50 15Q49.2 11.3 45.5 10.5Q49.2 9.7 50 6Z" fill="#fff"/>`;
  return doc(64, 64, body);
}

// ---------------------------------------------------------------- 4. gold_star

function goldStar(): string {
  const body =
    `<path d="${starPath(24, 26.6, 20, 9.6)}" fill="${C.goldD}" stroke="${C.goldD}" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="${starPath(24, 24.4, 20, 9.6)}" fill="${C.gold}" stroke="${C.gold}" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="${starPath(24, 25.4, 11.5, 5.2)}" fill="${C.goldL}"/>` +
    `<path d="M14 15Q17 10 22 8.5Q18 12 17 17Z" fill="#fff" opacity=".7"/>`;
  return doc(48, 48, body);
}

// ---------------------------------------------------------------- 5. heart

function heart(): string {
  const p = 'M24 40C8 29 3 21 3 13.5C3 7.5 8 3.5 13.5 3.5C18 3.5 22 6 24 10C26 6 30 3.5 34.5 3.5C40 3.5 45 7.5 45 13.5C45 21 40 29 24 40Z';
  const body =
    `<path transform="translate(0 2.4)" d="${p}" fill="${C.redD}"/>` +
    `<path d="${p}" fill="${C.red}"/>` +
    `<path d="M9.5 13Q9.5 8.6 13.8 8Q10.5 9.8 11.5 15Z" fill="#fff" opacity=".7"/>` +
    `<circle cx="9.6" cy="18.2" r="1.7" fill="#fff" opacity=".65"/>`;
  return doc(48, 44, body);
}

// ---------------------------------------------------------------- 6. crown

function crown(): string {
  const p = 'M8 43L4.5 14.5L20 26L32 9L44 26L59.5 14.5L56 43Z';
  const body =
    `<path transform="translate(0 2.6)" d="${p}" fill="${C.goldD}" stroke="${C.goldD}" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="${p}" fill="${C.gold}" stroke="${C.gold}" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="M32 17L40.5 28L32 38L23.5 28Z" fill="${C.goldL}"/>` +
    // band
    `<rect x="7" y="35" width="50" height="10" rx="3" fill="${C.goldD}"/>` +
    `<rect x="7" y="33.6" width="50" height="10" rx="3" fill="#F4B93A"/>` +
    // jewels
    `<circle cx="32" cy="38.6" r="4.6" fill="${C.redD}"/><circle cx="32" cy="37.8" r="4.6" fill="${C.red}"/><circle cx="30.6" cy="36.4" r="1.3" fill="#fff" opacity=".8"/>` +
    `<circle cx="17" cy="38.6" r="3.4" fill="${C.blueD}"/><circle cx="17" cy="37.9" r="3.4" fill="${C.blue}"/><circle cx="16" cy="36.8" r="1" fill="#fff" opacity=".8"/>` +
    `<circle cx="47" cy="38.6" r="3.4" fill="${C.greenDD}"/><circle cx="47" cy="37.9" r="3.4" fill="${C.green}"/><circle cx="46" cy="36.8" r="1" fill="#fff" opacity=".8"/>` +
    // tip balls
    `<circle cx="4.8" cy="12.5" r="3.8" fill="${C.goldL}"/><circle cx="32" cy="7" r="4.4" fill="${C.goldL}"/><circle cx="59.2" cy="12.5" r="3.8" fill="${C.goldL}"/>` +
    `<path d="M12 40Q11 30 9.4 20Q13 26 15 34Z" fill="#fff" opacity=".45"/>`;
  return doc(64, 52, body);
}

// ---------------------------------------------------------------- 7. brick_chip (3 silhouettes)

const CHIPS: number[][] = [
  [3, 8, 14, 3, 23, 9, 20, 18, 6, 19],
  [4, 17, 8, 4, 22, 10, 19, 19],
  [2, 10, 10, 3, 24, 6, 23, 16, 12, 19, 6, 15],
];

function brickChip(i: number): string {
  const pts = CHIPS[i % CHIPS.length]!;
  const pairs: string[] = [];
  let cx = 0;
  let cy = 0;
  for (let k = 0; k < pts.length; k += 2) {
    pairs.push(`${pts[k]},${pts[k + 1]}`);
    cx += pts[k]!;
    cy += pts[k + 1]!;
  }
  const m = pts.length / 2;
  cx /= m;
  cy /= m;
  const poly = pairs.join(' ');
  // lighter top facet: first three vertices + centroid
  const facet = `${pts[0]},${pts[1]} ${pts[2]},${pts[3]} ${pts[4]},${pts[5]} ${f(cx)},${f(cy)}`;
  const body =
    `<g transform="translate(13 11) scale(.9) translate(-13 -11)">` +
    `<polygon points="${poly}" transform="translate(0 2)" fill="${C.brickD}" stroke="${C.brickD}" stroke-width="2" stroke-linejoin="round"/>` +
    `<polygon points="${poly}" fill="${C.brick}" stroke="${C.brick}" stroke-width="2" stroke-linejoin="round"/>` +
    `<polygon points="${facet}" fill="${C.brickL}"/>` +
    `<circle cx="${f(cx - 1)}" cy="${f(cy + 3)}" r="1.1" fill="${C.brickD}" opacity=".55"/>` +
    `</g>`;
  return doc(26, 22, body);
}

// ---------------------------------------------------------------- 8. hammer

function hammer(): string {
  const body =
    groundShadow(32, 61, 14, 1.8) +
    `<g transform="rotate(38 32 34)">` +
    // handle
    `<rect x="28" y="24" width="8" height="34" rx="3.4" fill="${C.woodD}"/><rect x="28" y="23" width="6.4" height="34" rx="3.2" fill="${C.wood}"/>` +
    `<rect x="27.4" y="46" width="9.2" height="2.6" fill="${C.woodD}" opacity=".55"/><rect x="27.4" y="51" width="9.2" height="2.6" fill="${C.woodD}" opacity=".55"/>` +
    // head
    `<rect x="14" y="6.5" width="36" height="21" rx="5" fill="${C.steelD}"/>` +
    `<rect x="14" y="5" width="36" height="21" rx="5" fill="${C.steel}"/>` +
    `<rect x="14" y="5" width="8" height="21" rx="4" fill="${C.steelL}" opacity=".55"/>` +
    `<rect x="42" y="5" width="8" height="21" rx="4" fill="${C.steelD}" opacity=".55"/>` +
    `<rect x="24" y="8.5" width="16" height="3.4" rx="1.7" fill="#fff" opacity=".6"/>` +
    `</g>`;
  return doc(64, 64, body);
}

// ---------------------------------------------------------------- 9. sale_tag

function saleTag(): string {
  const tag = 'M5 22L17.5 8.6Q19.3 6.8 21.8 6.8H37Q41.5 6.8 41.5 11.3V32.7Q41.5 37.2 37 37.2H21.8Q19.3 37.2 17.5 35.4Z';
  const hole = 'M14.2 22a2.9 2.9 0 1 0 5.8 0a2.9 2.9 0 1 0-5.8 0Z';
  const body =
    `<g transform="rotate(-9 24 22)">` +
    `<path d="M17 22Q11 10 3.5 11.5" fill="none" stroke="${C.steelD}" stroke-width="2.2" stroke-linecap="round"/>` +
    `<path transform="translate(0 2.4)" d="${tag}${hole}" fill="${C.orangeD}" fill-rule="evenodd"/>` +
    `<path d="${tag}${hole}" fill="${C.orange}" fill-rule="evenodd"/>` +
    `<path d="M22.5 9.5H37.5" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".45"/>` +
    `<circle cx="30.5" cy="22.4" r="8.6" fill="#fff"/>` +
    `<path d="M25.6 22.7L29.2 26.4L35.8 18.4" fill="none" stroke="${C.greenD}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</g>`;
  return doc(48, 44, body);
}

// ---------------------------------------------------------------- 10. siren

function siren(i: number, n: number): string {
  const ang = (i * 180) / n; // 2 beams, 180-degree symmetry -> n frames = one seamless loop
  const cx = 32;
  const cy = 35;
  const R = 29;
  const wedge = (a: number): string => {
    const a0 = rad(a - 21);
    const a1 = rad(a + 21);
    return `M${cx} ${cy}L${f(cx + Math.cos(a0) * R)} ${f(cy + Math.sin(a0) * R)}A${R} ${R} 0 0 1 ${f(cx + Math.cos(a1) * R)} ${f(cy + Math.sin(a1) * R)}Z`;
  };
  const defs =
    `<radialGradient id="bm" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${R}">` +
    `<stop offset=".1" stop-color="#FFF6C2" stop-opacity="1"/><stop offset=".55" stop-color="#FFE27A" stop-opacity=".8"/>` +
    `<stop offset="1" stop-color="#FFD34A" stop-opacity=".05"/></radialGradient>` +
    `<clipPath id="cl"><rect x="0" y="0" width="64" height="52"/></clipPath>`;
  const hx = cx + 6.5 * Math.cos(rad(ang * 2 - 90));
  const body =
    `<g clip-path="url(#cl)"><g fill="url(#bm)"><path d="${wedge(ang - 90)}"/><path d="${wedge(ang + 90)}"/></g></g>` +
    // base
    `<rect x="12" y="52" width="40" height="8" rx="3" fill="${C.ink}" opacity=".9"/>` +
    `<rect x="12" y="50.8" width="40" height="8" rx="3" fill="${C.steelD}"/>` +
    `<rect x="16" y="45.5" width="32" height="7" rx="2.4" fill="${C.steel}"/>` +
    // dome
    `<path transform="translate(0 1.6)" d="M17.5 46V35A14.5 14.5 0 0 1 46.5 35V46Z" fill="${C.redD}"/>` +
    `<path d="M17.5 46V35A14.5 14.5 0 0 1 46.5 35V46Z" fill="${C.red}"/>` +
    `<ellipse cx="${f(hx)}" cy="33" rx="6.2" ry="8.4" fill="${C.redL}" opacity=".85"/>` +
    `<circle cx="${f(hx)}" cy="31" r="3" fill="#fff" opacity=".9"/>` +
    `<path d="M21 40Q20.5 31 26 25.5Q23.5 32 24.5 41Z" fill="#fff" opacity=".4"/>`;
  return doc(64, 64, body, defs);
}

export const COLOR_SPRITES: SpriteDef[] = [
  { name: 'coin_spin', cls: 'color', w: 48, h: 48, n: 10, fps: 20, loop: true, svg: coinSpin },
  { name: 'bill_flutter', cls: 'color', w: 56, h: 34, n: 6, fps: 12, loop: true, svg: billFlutter },
  { name: 'moneybag', cls: 'color', w: 64, h: 64, n: 1, fps: 1, loop: false, svg: () => moneybag() },
  { name: 'gold_star', cls: 'color', w: 48, h: 48, n: 1, fps: 1, loop: false, svg: () => goldStar() },
  { name: 'heart', cls: 'color', w: 48, h: 44, n: 1, fps: 1, loop: false, svg: () => heart() },
  { name: 'crown', cls: 'color', w: 64, h: 52, n: 1, fps: 1, loop: false, svg: () => crown() },
  { name: 'brick_chip', cls: 'color', w: 26, h: 22, n: 3, fps: 1, loop: false, svg: (i) => brickChip(i) },
  { name: 'hammer', cls: 'color', w: 64, h: 64, n: 1, fps: 1, loop: false, svg: () => hammer() },
  { name: 'sale_tag', cls: 'color', w: 48, h: 44, n: 1, fps: 1, loop: false, svg: () => saleTag() },
  { name: 'siren', cls: 'color', w: 64, h: 64, n: 4, fps: 12, loop: true, svg: siren },
];
