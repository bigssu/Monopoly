import { C, svg, pathS, shadow, star, sparkle, circ, rect, path, line, each, heart } from './lib.mjs';

const CUR = 'currentColor';
const T = {};
// currentColor body + overlays that keep working for any player color
const body = (d, extra = '') => `<path d="${d}" fill="${CUR}"${extra}/>`;
const shade = (d, o = 0.22) => `<path d="${d}" fill="#1B2140" opacity="${o}"/>`;
const hi = (d, o = 0.32) => `<path d="${d}" fill="#fff" opacity="${o}"/>`;
const ell = (cx, cy, rx, ry, fill, extra = '') => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"${extra}/>`;
const eye = (cx, cy, r = 3.4) => circ(cx, cy, r, C.white) + circ(cx + r * 0.15, cy + r * 0.15, r * 0.55, C.ink);
const gr = shadow(32, 59.5, 20, 2.6);

// ---- car ----
T.car = svg(
  gr +
  body('M5 42Q5 33 13 32L19 22Q21 18 26 18H40Q44 18 47 22L52 32Q59 33 59 42V47Q59 49 57 49H7Q5 49 5 47Z') +
  shade('M5 42H59V47Q59 49 57 49H7Q5 49 5 47Z') +
  hi('M13 32L19 22Q21 18 26 18H31Q22 20 20 32Z', 0.3) +
  path('M23 22Q24 21 26 21H31V31H19Z', '#DFF3FB') + path('M35 21H40Q42 21 43 23L47 31H35Z', '#DFF3FB') +
  path('M23 22Q24 21 26 21H27L21 31H19Z', C.white, ' opacity=".7"') +
  rect(5, 40, 54, 3, 0, C.white, ' opacity=".55"') +
  circ(55.5, 38, 2.6, C.sun) + circ(9, 40, 2.2, C.red) +
  circ(17, 48, 7.5, C.ink) + circ(17, 48, 3.2, C.slateL) + circ(47, 48, 7.5, C.ink) + circ(47, 48, 3.2, C.slateL)
);

// ---- rocket ----
T.rocket = svg(
  '<g transform="rotate(38 32 32)">' +
  '<path d="M26 47Q32 68 38 47Z" fill="#FF9A4D"/><path d="M28.5 47Q32 60 35.5 47Z" fill="#FFC94A"/>' +
  body('M20 36L8 48V53L21 46Z') + body('M44 36L56 48V53L43 46Z') + shade('M20 36L8 48V53L21 46Z', 0.25) + shade('M44 36L56 48V53L43 46Z', 0.25) +
  body('M32 2Q49 14 46 38L45 47H19L18 38Q15 14 32 2Z') +
  shade('M32 2Q49 14 46 38L45 47H32Z', 0.2) +
  hi('M32 2Q22 8 21 20Q22 12 32 6Z', 0.5) +
  rect(19, 40, 26, 5, 0, C.white, ' opacity=".9"') +
  circ(32, 24, 8, C.white) + circ(32, 24, 5.6, C.skyD) + circ(30.4, 22.2, 1.9, C.skyL) +
  rect(24, 46, 16, 4, 2, C.ink) +
  '</g>'
);

// ---- cat ----
T.cat = svg(
  gr +
  pathS('M46 52Q62 52 58 34Q56 28 51 30', CUR, 6) + pathS('M46 52Q62 52 58 34Q56 28 51 30', '#1B2140', 6, ' opacity=".2"') +
  ell(32, 47, 15, 12.5, CUR) + shade('M32 34.5A15 12.5 0 0 1 32 59.5H32Q47 59.5 47 47Q47 36 32 34.5Z', 0.2) +
  ell(32, 51, 8, 8, C.white, ' opacity=".9"') +
  rect(19, 53, 8, 6.5, 3.2, CUR) + rect(37, 53, 8, 6.5, 3.2, CUR) +
  // ears
  body('M15 22L13 5Q13 3 15 4L27 12Z', ' stroke="currentColor" stroke-width="3" stroke-linejoin="round"') +
  body('M49 22L51 5Q51 3 49 4L37 12Z', ' stroke="currentColor" stroke-width="3" stroke-linejoin="round"') +
  path('M16.5 18L15.5 8L23 13Z', C.pink) + path('M47.5 18L48.5 8L41 13Z', C.pink) +
  // head
  ell(32, 27, 19, 15.5, CUR) + shade('M32 42.5Q51 42.5 51 27Q51 24 50 21Q45 36 32 36Z', 0.2) +
  hi('M14 24Q16 14 26 12Q18 14 16 26Z', 0.45) +
  eye(24.5, 26, 3.8) + eye(39.5, 26, 3.8) +
  path('M29.5 31.500H34.500L32 34.500Z', C.pink, ' stroke="#F28AB2" stroke-width="2" stroke-linejoin="round"') +
  pathS('M32 34.500Q29.5 38 26.5 36.500M32 34.500Q34.5 38 37.5 36.5', C.ink, 2) +
  circ(19, 33, 2.6, C.pink, ' opacity=".55"') + circ(45, 33, 2.6, C.pink, ' opacity=".55"') +
  line(8, 29, 15, 31, C.ink, 2, ' opacity=".35"') + line(56, 29, 49, 31, C.ink, 2, ' opacity=".35"')
);

// ---- robot ----
T.robot = svg(
  gr +
  line(32, 12, 32, 5, C.ink, 3) + circ(32, 5, 3.6, C.sun) + circ(31, 4, 1.3, C.white) +
  // arms
  rect(5, 44, 10, 6, 3, C.slateL) + rect(49, 44, 10, 6, 3, C.slateL) +
  // torso
  rect(19, 46, 26, 13, 5, CUR) + shade('M19 54H45V54Q45 59 40 59H24Q19 59 19 54Z', 0.22) +
  circ(32, 52, 3, C.sun) +
  // ears
  rect(6, 24, 7, 12, 3.5, C.slateD) + rect(51, 24, 7, 12, 3.5, C.slateD) +
  // head
  rect(11, 12, 42, 34, 10, CUR) + shade('M11 38Q11 46 21 46H43Q53 46 53 38Z', 0.2) +
  hi('M13 24Q13 14 22 13Q16 15 15 26Z', 0.4) +
  rect(16, 19, 32, 17, 7, C.ink) +
  rect(20, 23, 8, 9, 4, '#7CF0C0') + rect(36, 23, 8, 9, 4, '#7CF0C0') +
  circ(22.5, 25, 1.6, C.white) + circ(38.5, 25, 1.6, C.white) +
  rect(24, 39, 16, 3.6, 1.8, C.white, ' opacity=".85"')
);

// ---- crown ----
T.crown = svg(
  gr +
  '<path d="M9 46L7 19L21 30L32 11L43 30L57 19L55 46Z" fill="currentColor" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/>' +
  shade('M32 11L43 30L57 19L55 46H36Z', 0.18) +
  rect(7, 44, 50, 12, 5, CUR) + shade('M7 51H57V51Q57 56 52 56H12Q7 56 7 51Z', 0.25) +
  rect(7, 44, 50, 3, 0, C.white, ' opacity=".4"') +
  circ(32, 8, 4.6, C.sun) + circ(7, 17, 4, C.sky) + circ(57, 17, 4, C.sky) +
  circ(30.5, 6.5, 1.5, C.white) +
  circ(19, 50, 3, C.white) + circ(32, 50, 3.6, C.red) + circ(45, 50, 3, C.white)
);

// ---- star ----
const sp = (() => { const pts = []; for (let i = 0; i < 10; i++) { const R = i % 2 ? 12 : 27, a = -Math.PI / 2 + i * Math.PI / 5; pts.push(`${(32 + R * Math.cos(a)).toFixed(2)},${(33 + R * Math.sin(a)).toFixed(2)}`); } return pts.join(' '); })();
T.star = svg(
  gr +
  `<polygon points="${sp}" fill="currentColor" stroke="currentColor" stroke-width="7" stroke-linejoin="round"/>` +
  `<polygon points="${sp}" fill="#fff" opacity="0" />` +
  shade('M32 6L38 24L58 24L43 36L50 55L32 44Z', 0.16) +
  hi('M32 6L26 24L8 25L14 30L28 27Z', 0.3) +
  eye(25, 32, 3.4) + eye(39, 32, 3.4) +
  circ(20.5, 38, 2.4, C.pink, ' opacity=".6"') + circ(43.5, 38, 2.4, C.pink, ' opacity=".6"') +
  pathS('M27.5 39Q32 44.5 36.5 39', C.ink, 2.4) +
  sparkle(55, 10, 4.5, C.sun)
);

// ---- ufo ----
T.ufo = svg(
  '<path d="M24 42L14 62H50L40 42Z" fill="#FFC94A" opacity=".45"/>' +
  // alien in dome
  '<path d="M18 34Q18 10 32 10Q46 10 46 34Z" fill="#DFF3FB"/>' +
  '<path d="M18 34Q18 10 32 10Q46 10 46 34Z" fill="#6EC1E4" opacity=".28"/>' +
  path('M23 30Q23 17 32 17Q41 17 41 30Q41 33 38 33H26Q23 33 23 30Z', C.green) +
  ell(28, 25, 2.3, 3, C.ink, ' transform="rotate(20 28 25)"') + ell(36, 25, 2.3, 3, C.ink, ' transform="rotate(-20 36 25)"') +
  line(29, 17, 27, 12, C.greenD, 2) + circ(27, 11.5, 2, C.sun) + line(35, 17, 37, 12, C.greenD, 2) + circ(37, 11.5, 2, C.sun) +
  hi('M22 27Q22 16 30 12Q25 16 25 27Z', 0.6) +
  // saucer
  ell(32, 38, 29, 10.5, CUR) + shade('M3.5 40Q10 48.5 32 48.500Q54 48.5 60.5 40Q54 41 32 41Q10 41 3.5 40Z', 0.28) +
  hi('M6 35Q16 28 32 28Q26 30 14 36Z', 0.4) +
  circ(12, 39, 2.6, C.sun) + circ(22, 42, 2.6, C.white) + circ(32, 43, 2.6, C.sun) + circ(42, 42, 2.6, C.white) + circ(52, 39, 2.6, C.sun)
);

// ---- dino ----
T.dino = svg(
  gr +
  // tail
  body('M18 40Q6 40 2 54Q12 52 22 50Z') +
  // back plates
  path('M17 33L15 24L24 29Z', C.sun) + path('M25 27L25 17L33 25Z', C.sun) + path('M35 24L38 14L44 23Z', C.sun) +
  // legs
  rect(20, 48, 10, 11, 5, CUR) + rect(36, 48, 10, 11, 5, CUR) + shade('M20 55H30V54Q30 59 25 59Q20 59 20 54Z', 0.25) + shade('M36 55H46V54Q46 59 41 59Q36 59 36 54Z', 0.25) +
  // body
  ell(30, 40, 20, 14, CUR) + shade('M30 54Q50 54 50 40Q50 38 49 36Q44 46 30 46Z', 0.2) +
  ell(33, 47, 12, 6, C.white, ' opacity=".55"') +
  // head / neck
  body('M36 32Q40 12 52 10Q62 10 62 22Q62 30 54 32Q46 36 36 32Z') +
  body('M40 34Q40 20 50 14L52 28Z') +
  shade('M62 22Q62 30 54 32Q46 36 36 32Q44 33 52 28Q60 26 62 22Z', 0.2) +
  eye(52, 18, 3.6) + circ(59.5, 20, 1.2, C.ink) +
  pathS('M50 28Q56 30 60 26', C.ink, 2) +
  path('M53 28.500L54.5 31L56 28.800Z', C.white) +
  // arm
  ell(42, 40, 3.2, 2.2, CUR, ' transform="rotate(30 42 40)"') + hi('M22 32Q26 27 32 28Q26 29 24 35Z', 0.35)
);

// ---- whale ----
T.whale = svg(
  // spout
  pathS('M22 16Q22 8 15 6M22 16Q22 8 29 6', C.sky, 3) + circ(14, 5, 2.2, C.sky) + circ(30, 5, 2.2, C.sky) + circ(22, 4, 1.8, C.skyL) +
  // tail
  body('M46 40Q58 40 58 26Q64 30 62 38Q60 46 50 48Z') + shade('M46 44Q56 44 58 32Q62 40 52 47Z', 0.2) +
  // body
  body('M4 40Q4 18 26 18Q46 18 52 34Q54 44 48 50Q40 57 26 57Q4 57 4 40Z') +
  shade('M4 42Q10 55 26 56Q40 56 48 50Q54 44 52 34Q50 46 34 48Q14 50 4 42Z', 0.2) +
  // belly
  path('M6 44Q16 54 34 52Q44 50 49 44Q46 54 34 56Q14 58 6 44Z', C.white, ' opacity=".92"') +
  path('M12 47H40M15 50H34', 'none', ' stroke="#CBD3E0" stroke-width="2" stroke-linecap="round"') +
  hi('M9 34Q12 24 22 22Q15 25 13 36Z', 0.4) +
  eye(17, 36, 3.6) + circ(11, 43, 2.6, C.pink, ' opacity=".6"') +
  pathS('M16 46Q21 49 26 46', C.ink, 2.2) +
  ''
);

// ---- boot ----
T.boot = svg(
  gr +
  body('M16 6H38V32Q38 36 44 38L55 42Q62 44 62 50V55H14V10Q14 6 16 6Z') +
  shade('M14 44H62V55H14Z', 0.2) + shade('M38 6V32Q38 36 44 38L55 42Q62 44 62 50H50Q50 44 42 42Q38 40 38 32Z', 0.15) +
  hi('M17 9H24V38H17Z', 0.28) +
  // cuff
  rect(12, 4, 28, 10, 4.5, C.white) + rect(12, 10, 28, 4, 2, C.slateL) +
  // laces
  line(26, 20, 34, 20, C.white, 3) + line(26, 27, 34, 27, C.white, 3) + line(28, 34, 36, 35, C.white, 3) +
  // toe cap
  path('M50 42L55 42Q62 44 62 50V54H52Q54 48 50 42Z', C.white, ' opacity=".3"') +
  // sole
  rect(11, 52, 53, 8, 4, C.ink) + rect(11, 52, 53, 3, 1.5, C.inkSoft) +
  rect(11, 50, 12, 4, 0, C.ink, ' opacity="0"')
);

// ---- camera ----
T.camera = svg(
  gr +
  rect(38, 8, 14, 8, 3, C.slateD) + rect(40, 5, 10, 5, 2.5, C.red) +
  rect(12, 10, 12, 10, 3, CUR) + shade('M12 16H24V17Q24 20 21 20H15Q12 20 12 17Z', 0.25) +
  rect(5, 15, 54, 38, 9, CUR) + shade('M5 44H59V44Q59 53 50 53H14Q5 53 5 44Z', 0.22) +
  hi('M8 27Q8 18 16 17Q11 20 11 29Z', 0.4) +
  rect(5, 24, 54, 6, 0, C.white, ' opacity=".9"') +
  circ(32, 38, 15, C.ink) + circ(32, 38, 15, 'none', ` stroke="${C.slateL}" stroke-width="2.5"`) +
  circ(32, 38, 10.5, C.skyD) + circ(32, 38, 6.5, C.blueD) + circ(28.5, 34.5, 3, C.white, ' opacity=".9"') + circ(35.5, 41.5, 1.4, C.skyL) +
  circ(50, 21, 2.4, C.sun) + rect(9, 19, 9, 3.4, 1.7, C.white, ' opacity="0"')
);

// ---- teapot ----
T.teapot = svg(
  gr +
  pathS('M25 14Q20 9 25 4M33 15Q28 10 33 5', C.slateL, 2.4) +
  // handle
  pathS('M48 28Q63 28 59 42Q57 48 47 47', CUR, 6) + pathS('M48 28Q63 28 59 42Q57 48 47 47', '#1B2140', 6, ' opacity=".18"') +
  // spout
  body('M17 38Q4 38 3 20Q3 17 6 19Q11 27 19 30Z') + shade('M14 37Q6 35 5 26Q9 30 19 34Z', 0.2) +
  // body
  ell(32, 40, 20, 17, CUR) + shade('M32 57Q52 57 52 40Q52 36 51 33Q46 48 32 48Q22 48 15 44Q18 57 32 57Z', 0.22) +
  hi('M14 38Q14 26 24 24Q18 28 17 40Z', 0.4) +
  // lid
  path('M20 26Q20 17 32 17Q44 17 44 26Z', CUR) + shade('M32 17Q44 17 44 26H32Z', 0.2) +
  rect(17, 24, 30, 5, 2.5, C.white) + rect(17, 27, 30, 2, 1, C.slateL) +
  circ(32, 14.5, 3.6, C.sun) + circ(31, 13.5, 1.2, C.white) +
  // decoration
  circ(32, 41, 5, C.white) + circ(32, 41, 2, C.sun) +
  circ(22, 44, 2.2, C.white, ' opacity=".9"') + circ(42, 44, 2.2, C.white, ' opacity=".9"') +
  rect(20, 54, 24, 5, 2.5, C.ink) + rect(20, 54, 24, 2, 1, C.inkSoft)
);

export default T;
