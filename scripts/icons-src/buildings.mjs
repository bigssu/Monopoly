import { C, svg, arch, pathS, shadow, star, sparkle, circ, rect, path, line, each, heart, burst } from './lib.mjs';

const CUR = 'currentColor';
const B = {};
const shade = (d, o = 0.22) => `<path d="${d}" fill="#1B2140" opacity="${o}"/>`;
const hi = (d, o = 0.32) => `<path d="${d}" fill="#fff" opacity="${o}"/>`;
const win = (x, y, w = 7, h = 8) => rect(x, y, w, h, 2, C.sky) + rect(x, y, w, 2.5, 1.2, C.skyL);

// ---- villa: small house ----
B.villa = svg(
  shadow(32, 59, 22, 2.6) +
  rect(15, 30, 34, 27, 4, '#E3D3AC') + rect(15, 30, 34, 25, 4, C.cream) +
  // roof
  '<path d="M6 34L32 9L58 34Z" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>' +
  shade('M32 9L58 34H32Z', 0.2) + hi('M32 9L8 33L14 33L32 15Z', 0.3) +
  rect(42, 12, 7, 12, 2, C.slate) + rect(41, 10, 9, 4, 2, C.slateD) +
  // door + window
  rect(27, 40, 10, 17, 4, C.brownD) + rect(27, 40, 8, 17, 4, C.brown) + circ(34, 49, 1.2, C.sun) +
  win(18, 40, 7, 8) + win(39, 40, 7, 8) +
  // bush
  circ(14, 56, 4.5, C.green) + circ(50, 56, 4.5, C.green)
);

// ---- building: 3-story block ----
B.building = svg(
  shadow(32, 60, 24, 2.6) +
  rect(10, 14, 44, 45, 4, '#B7C3D6') + rect(10, 14, 44, 43, 4, '#E6ECF5') +
  rect(6, 8, 52, 10, 4, CUR) + shade('M6 15H58V15Q58 18 54 18H10Q6 18 6 15Z', 0.25) + hi('M8 11H50V12H8Z', 0.35) +
  // floors of windows
  each(3, (r) => each(3, (c) => win(15 + c * 13, 22 + r * 11.5, 8, 7))) +
  // entrance
  rect(24, 46, 16, 13, 3, C.brownD) + rect(24, 46, 16, 11, 3, C.slate) + rect(31, 46, 2, 13, 0, C.slateL) +
  rect(20, 43, 24, 5, 2.5, CUR) + shade('M20 46H44V46Q44 48 42 48H22Q20 48 20 46Z', 0.25)
);

// ---- hotel: tall tower with sign ----
B.hotel = svg(
  shadow(32, 60, 22, 2.6) +
  // tower
  rect(14, 12, 36, 47, 4, '#B7C3D6') + rect(14, 12, 36, 45, 4, '#F4F7FB') +
  rect(10, 8, 44, 8, 4, CUR) + shade('M10 13H54V13Q54 16 50 16H14Q10 16 10 13Z', 0.25) +
  // sign
  rect(20, 1, 24, 10, 5, CUR) + rect(20, 1, 24, 10, 5, '#fff', ' opacity=".2"') + star(32, 6, 3.6, C.white, 5, 0.5) +
  // windows: 4 rows x 3
  each(4, (r) => each(3, (c) => win(18 + c * 10.5, 19 + r * 9, 7, 6))) +
  // entrance + awning
  rect(25, 47, 14, 12, 3, C.brownD) + rect(25, 47, 14, 10, 3, C.slate) +
  path('M20 46H44L42 52H22Z', CUR) + shade('M20 49H44L42 52H22Z', 0.25) +
  circ(12, 56, 3.6, C.green) + circ(52, 56, 3.6, C.green)
);

// ---- landmark: golden monument ----
B.landmark = svg(
  shadow(32, 60, 22, 2.6) +
  // stepped base
  rect(10, 52, 44, 7, 3, C.sunD) + rect(10, 52, 44, 5, 3, C.sun) +
  rect(16, 46, 32, 8, 3, C.sunD) + rect(16, 46, 32, 6, 3, '#FFDA74') +
  rect(19, 49, 26, 3, 0, CUR) +
  // tower
  path('M23 46L27 20H37L41 46Z', C.sunD) + path('M23 46L27 20H32V46Z', '#FFDA74') + path('M32 20H37L41 46H32Z', C.sunD) +
  arch(29.5, 30, 5, 10, '#7A5343') +
  // cap
  path('M25 22L32 9L39 22Z', C.sun) + path('M32 9L39 22H32Z', C.sunD) +
  rect(23, 20, 18, 4, 2, CUR) +
  // star sparkle
  sparkle(32, 4, 6.5, '#FF9A4D') + circ(32, 4, 2, C.white) + sparkle(12, 26, 4, C.sun) + sparkle(53, 30, 3.2, C.sun) + sparkle(50, 12, 3, '#FF9A4D')
);

// ---- festival marker: flag + fireworks ----
B['festival-marker'] = svg(
  burst(38, 17, 4, 11, 8, [C.red, C.sun, C.sky, C.pink], 3.4, 0.2) + circ(38, 17, 3, C.white) +
  shadow(24, 59, 14, 2.2) +
  rect(12, 30, 4.4, 28, 2.2, C.brownD) + rect(12, 30, 2.6, 28, 1.3, C.brown) +
  '<path d="M16 32Q26 27 32 32T46 32V46Q38 51 32 46T16 46Z" fill="currentColor"/>' +
  shade('M16 42Q26 37 32 42T46 42V46Q38 51 32 46T16 46Z', 0.22) +
  star(31, 39, 4, C.white, 5, 0.5) +
  circ(14.2, 30, 3.4, C.sun) +
  circ(52, 44, 2.2, C.pink) + circ(56, 54, 2, C.sky) + circ(48, 55, 1.8, C.sun)
);

// ---- pot: money pot ----
B.pot = svg(
  shadow(32, 60, 22, 2.6) +
  // coin pile
  circ(20, 25, 7, C.sunD) + circ(20, 24, 6.3, C.sun) + circ(32, 20, 8, C.sunD) + circ(32, 19, 7.3, C.sun) + circ(44, 25, 7, C.sunD) + circ(44, 24, 6.3, C.sun) +
  circ(32, 19, 4.2, 'none', ` stroke="${C.sunD}" stroke-width="2"`) + circ(20, 24, 3.4, 'none', ` stroke="${C.sunD}" stroke-width="2"`) + circ(44, 24, 3.4, 'none', ` stroke="${C.sunD}" stroke-width="2"`) +
  // cauldron
  '<path d="M10 30Q9 58 32 58Q55 58 54 30Z" fill="#3B4560"/>' +
  '<path d="M10 30Q9 56 32 56Q55 56 54 30Z" fill="#4A5470"/>' +
  path('M11 42Q12 54 32 55Q48 55 52 46Q40 51 11 42Z', C.ink, ' opacity=".25"') +
  hi('M13 33Q14 46 21 51Q16 44 16 33Z', 0.25) +
  rect(6, 26, 52, 8, 4, CUR) + shade('M6 31H58V31Q58 34 54 34H10Q6 34 6 31Z', 0.25) +
  // band + gem
  rect(10, 44, 44, 4, 0, CUR, ' opacity=".9"') + heart(32, 48, 4, C.white) +
  sparkle(56, 12, 4, C.sun) + sparkle(9, 12, 3, C.white)
);

// ---- coin ----
B.coin = svg(
  shadow(32, 60, 20, 2.4) +
  circ(32, 32, 27, C.sunD) + circ(32, 30, 27, C.sun) +
  circ(32, 30, 20, 'none', ` stroke="${C.sunD}" stroke-width="3"`) +
  star(32, 30, 10, C.sunD, 5, 0.5) +
  '<path d="M12 22Q16 10 28 8Q19 12 16 24Z" fill="#fff" opacity=".6"/>' +
  sparkle(52, 10, 4, C.white)
);

// ---- dice faces ----
const PIPS = { 1: [[32, 32]], 2: [[20, 20], [44, 44]], 3: [[20, 20], [32, 32], [44, 44]], 4: [[20, 20], [44, 20], [20, 44], [44, 44]], 5: [[20, 20], [44, 20], [32, 32], [20, 44], [44, 44]], 6: [[20, 18], [44, 18], [20, 32], [44, 32], [20, 46], [44, 46]] };
for (let n = 1; n <= 6; n++) {
  B[`dice-face-${n}`] = svg(
    rect(4, 8, 56, 54, 13, '#B7C3D6') + rect(4, 4, 56, 54, 13, C.white, ' stroke="#B7C3D6" stroke-width="2.5"') +
    PIPS[n].map(([x, y]) => circ(x, y, n === 1 ? 7.5 : 5.2, n === 1 ? C.red : C.ink)).join('')
  );
}

// ---- cards ----
B['cards-escape'] = svg(
  shadow(32, 60, 20, 2.2) +
  rect(9, 6, 46, 52, 8, C.blueD) + rect(9, 4, 46, 52, 8, CUR) +
  rect(14, 9, 36, 42, 5, '#fff', ' opacity=".18"') +
  // key
  circ(32, 20, 8.5, C.sunD) + circ(32, 19, 8.5, C.sun) + circ(32, 19, 3.6, CUR) +
  rect(29.5, 26, 5, 22, 2, C.sun) + rect(29.5, 26, 2.6, 22, 1.3, '#FFDA74') +
  rect(34.5, 37, 7, 4, 2, C.sun) + rect(34.5, 44, 5, 4, 2, C.sun) +
  sparkle(46, 14, 3.2, C.white) + sparkle(18, 44, 2.8, C.white)
);

B['cards-freepass'] = svg(
  shadow(32, 60, 24, 2.2) +
  '<g transform="rotate(-8 32 32)">' +
  '<path d="M6 16Q6 12 10 12H54Q58 12 58 16V26A6 6 0 0 0 58 38V48Q58 52 54 52H10Q6 52 6 48V38A6 6 0 0 0 6 26Z" fill="#E9A92A"/>' +
  '<path d="M6 14Q6 10 10 10H54Q58 10 58 14V24A6 6 0 0 0 58 36V46Q58 50 54 50H10Q6 50 6 46V36A6 6 0 0 0 6 24Z" fill="#FFC94A"/>' +
  line(19, 16, 19, 44, C.sunD, 2, ' stroke-dasharray="3 3.5"') +
  circ(41, 30, 13, C.greenD) + circ(41, 29, 13, C.green) +
  pathS('M34.5 29.500L39.5 34.500L48 24', C.white, 4) +
  circ(12.5, 30, 2.6, CUR) +
  '</g>' +
  sparkle(54, 8, 4, C.sun) + sparkle(8, 56, 3, C.sky)
);

B['cards-shield'] = svg(
  shadow(32, 61, 22, 2.2) +
  // wings
  path('M20 22Q6 14 2 6Q4 24 16 32Q8 32 4 30Q8 44 22 44Z', '#9ED3EE') + path('M44 22Q58 14 62 6Q60 24 48 32Q56 32 60 30Q56 44 42 44Z', C.sky) +
  // shield
  '<path d="M32 4L52 11V30Q52 48 32 60Q12 48 12 30V11Z" fill="#1B2140" opacity=".25" transform="translate(0 2)"/>' +
  '<path d="M32 4L52 11V30Q52 48 32 60Q12 48 12 30V11Z" fill="#DCE3EE"/>' +
  '<path d="M32 9L47 14V30Q47 43 32 53Q17 43 17 30V14Z" fill="currentColor"/>' +
  shade('M32 9L47 14V30Q47 43 32 53Z', 0.2) + hi('M32 9L17 14V26Q23 20 32 17Z', 0.28) +
  star(32, 30, 8, C.white, 5, 0.5)
);

export default B;
