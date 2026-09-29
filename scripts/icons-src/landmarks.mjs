import { C, svg, pathS, shadow, arch, star, sparkle, circ, rect, path, line, each, heart, burst } from './lib.mjs';

const L = {};

// ---------- Manila: jeepney ----------
L['city-manila'] = svg(
  shadow(32, 57, 27, 3) +
  // body
  rect(4, 24, 56, 24, 7, C.redD) + rect(4, 24, 56, 21, 7, C.red) +
  // cabin roof
  rect(8, 12, 36, 18, 6, C.sunD) + rect(8, 12, 36, 16, 6, C.sun) +
  // roof rack
  rect(12, 8, 28, 4, 2, C.brownD) +
  // windows
  rect(12, 17, 8, 8, 2.5, C.skyL) + rect(23, 17, 8, 8, 2.5, C.skyL) + rect(34, 17, 8, 8, 2.5, C.skyL) +
  // hood windshield
  rect(47, 27, 9, 8, 2.5, C.skyL) +
  // stripe
  rect(4, 36, 56, 4, 0, C.sun) +
  // bumper + light
  rect(54, 42, 8, 5, 2.5, C.slateL) + circ(57, 39, 2.2, C.white) +
  // wheels
  circ(17, 48, 7, C.ink) + circ(17, 48, 3, C.slateL) + circ(47, 48, 7, C.ink) + circ(47, 48, 3, C.slateL) +
  // little pennants
  path('M38 8V3l6 2.5z', C.green)
);

// ---------- Hanoi: red lantern ----------
L['city-hanoi'] = svg(
  shadow(32, 60, 14, 2.2) +
  line(32, 2, 32, 10, C.brownD, 3) +
  rect(23, 9, 18, 6, 3, C.sunD) + rect(23, 9, 18, 4.5, 3, C.sun) +
  '<ellipse cx="32" cy="31" rx="19" ry="17" fill="#C23F47"/>' +
  '<ellipse cx="31" cy="30" rx="18" ry="16.5" fill="#EF5B5B"/>' +
  // ribs
  '<path d="M32 14.5V47.5M24 15.5C19 24 19 37 24 46.5M40 15.5C45 24 45 37 40 46.5" stroke="#C23F47" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
  // highlight
  '<path d="M18.5 26C19.5 21.5 22 18.5 25 17" stroke="#FF9A9A" stroke-width="3" fill="none" stroke-linecap="round"/>' +
  rect(24, 46, 16, 6, 3, C.sunD) + rect(24, 46, 16, 4.5, 3, C.sun) +
  // tassel
  line(32, 52, 32, 57, C.sunD, 3) + path('M28.5 57h7l1.5 5h-10z', C.sun) +
  // gold blossom on lantern
  sparkle(32, 31, 6, C.sun)
);

// ---------- Cairo: pyramids + sun ----------
L['city-cairo'] = svg(
  circ(47, 17, 9, C.orange) + circ(47, 17, 9, C.sun, ' transform="translate(-1.5 -1.5)"') +
  rect(2, 48, 60, 11, 5.5, '#F0C56E') +
  path('M4 51L27 15L50 51Z', '#F5D98B') + path('M27 15L50 51H27Z', '#E1AC4A') +
  path('M36 51L47 32L61 51Z', '#F5D98B') + path('M47 32L61 51H47Z', '#E1AC4A') +
  // brick lines
  line(19, 38, 33, 38, '#E1AC4A', 2) + line(14, 45, 40, 45, '#E1AC4A', 2) + line(23, 30, 30, 30, '#E1AC4A', 2) +
  rect(2, 53, 60, 6, 3, '#E8B455')
);

// ---------- Nairobi: acacia + giraffe ----------
L['city-nairobi'] = svg(
  circ(29, 8, 5, C.sun) +
  shadow(32, 59, 28, 2.6) +
  // acacia
  path('M13 57C15 46 14 38 17 27H21C20 38 22 47 24 57Z', C.brownD) +
  '<ellipse cx="19" cy="24" rx="19" ry="8" fill="#349B65"/>' +
  '<ellipse cx="18" cy="21.5" rx="18" ry="7" fill="#5CC689"/>' +
  '<ellipse cx="9" cy="19" rx="6" ry="3" fill="#A6E3BF" opacity=".7"/>' +
  // giraffe legs
  line(44, 46, 44, 58, '#E99A2E', 3.6) + line(49, 46, 49, 58, '#E99A2E', 3.6) +
  line(56, 46, 56, 58, '#E99A2E', 3.6) + line(60, 46, 60, 58, '#E99A2E', 3.6) +
  // body
  '<ellipse cx="52" cy="42" rx="11" ry="8" fill="#F6B73C"/>' +
  // neck
  line(47, 38, 40, 24, '#F6B73C', 7) +
  // head
  '<ellipse cx="37.5" cy="22" rx="6" ry="3.6" fill="#F6B73C" transform="rotate(-24 37.5 22)"/>' +
  circ(33.6, 23.6, 1.6, C.ink) +
  line(41, 19, 41, 15.5, C.brownD, 2.2) + circ(41, 14.6, 1.7, C.brownD) +
  line(44, 20.5, 45, 17.5, C.brownD, 2.2) + circ(45.2, 16.8, 1.7, C.brownD) +
  // spots
  circ(50, 40, 2.6, '#B8742A') + circ(56, 44, 2.2, '#B8742A') + circ(46, 44.5, 1.8, '#B8742A') + circ(44, 31, 1.8, '#B8742A') + circ(47.2, 35, 1.7, '#B8742A') +
  line(62, 39, 63, 46, C.brownD, 2.2)
);

// ---------- Cape Town: table mountain ----------
L['city-capetown'] = svg(
  circ(12, 15, 6, C.sun) +
  path('M2 50L15 26Q17 22 21 22H45Q49 22 51 26L62 50Z', '#4E8F7B') +
  path('M45 22Q49 22 51 26L62 50H40Z', '#3B7563') +
  path('M15 26Q17 22 21 22H45Q49 22 51 26L52 28Q47 31 42 28Q37 31 32 28Q27 31 22 28Q18 31 14 28Z', C.white) +
  path('M14 28Q18 31 22 28Q27 31 32 28Q37 31 42 28Q47 31 52 28L53 31H13Z', '#E3F1F5') +
  path('M0 48H64V60Q64 62 62 62H2Q0 62 0 60Z', C.skyD) +
  path('M0 48H64V52H0Z', C.sky) +
  pathS('M6 56Q9 54 12 56M26 58Q29 56 32 58M46 56Q49 54 52 56', '#fff', 2.2, ' opacity=".85"')
);

// ---------- Lima: llama ----------
L['city-lima'] = svg(
  shadow(30, 59, 20, 2.6) +
  // legs
  rect(15, 44, 5, 14, 2.5, '#D9BE93') + rect(23, 44, 5, 14, 2.5, '#D9BE93') + rect(32, 44, 5, 14, 2.5, '#D9BE93') + rect(39, 44, 5, 14, 2.5, '#D9BE93') +
  rect(15, 55, 5, 3.5, 1.7, C.brownD) + rect(23, 55, 5, 3.5, 1.7, C.brownD) + rect(32, 55, 5, 3.5, 1.7, C.brownD) + rect(39, 55, 5, 3.5, 1.7, C.brownD) +
  // fluffy body
  '<ellipse cx="29" cy="37" rx="18" ry="11" fill="#E3CCA2"/>' +
  '<ellipse cx="29" cy="35" rx="18" ry="10.5" fill="#FBEFD8"/>' +
  circ(12.5, 33, 5, '#FBEFD8') + circ(17, 28.5, 4.5, '#FBEFD8') +
  // neck
  rect(37, 12, 10, 28, 5, '#FBEFD8') +
  // head
  '<ellipse cx="45" cy="12" rx="8" ry="6" fill="#FBEFD8"/>' +
  '<ellipse cx="52" cy="15" rx="4.5" ry="3.6" fill="#EBD9B4"/>' +
  circ(55, 14, 1.4, C.brownD) +
  circ(46, 10.5, 1.7, C.ink) +
  // ears
  '<ellipse cx="41" cy="4.5" rx="2.2" ry="5" fill="#FBEFD8" transform="rotate(-12 41 4.5)"/>' +
  '<ellipse cx="47" cy="4" rx="2.2" ry="5" fill="#FBEFD8" transform="rotate(12 47 4)"/>' +
  '<ellipse cx="41" cy="5" rx="1" ry="3" fill="#F28AB2" transform="rotate(-12 41 5)"/>' +
  '<ellipse cx="47" cy="4.5" rx="1" ry="3" fill="#F28AB2" transform="rotate(12 47 4.5)"/>' +
  // blanket
  rect(20, 27, 20, 14, 4, C.redD) + rect(20, 27, 20, 12, 4, C.red) +
  rect(20, 31, 20, 3, 0, C.sun) + rect(20, 35.5, 20, 2.2, 0, C.green) +
  path('M20 41l2-3 2 3 2-3 2 3 2-3 2 3 2-3 2 3 2-3 2 3z', C.sun)
);

// ---------- Mexico City: step pyramid ----------
L['city-mexicocity'] = svg(
  shadow(32, 59, 28, 2.6) +
  rect(4, 46, 56, 12, 3, '#C47A3F') + rect(4, 46, 56, 10, 3, '#E59A5B') +
  rect(10, 36, 44, 11, 3, '#C47A3F') + rect(10, 36, 44, 9, 3, '#E59A5B') +
  rect(16, 26, 32, 11, 3, '#C47A3F') + rect(16, 26, 32, 9, 3, '#E59A5B') +
  rect(22, 16, 20, 11, 3, '#C47A3F') + rect(22, 16, 20, 9, 3, '#E59A5B') +
  // temple on top
  rect(26, 6, 12, 11, 2.5, '#5CC689') + rect(26, 6, 12, 9.5, 2.5, '#A6E3BF') + rect(24, 4, 16, 4, 2, C.green) +
  arch(30, 9, 4, 7, C.ink) +
  // stairs
  path('M27 16H37L40 58H24Z', '#F6D9A8') +
  each(6, (i) => `<path d="M${25.4 - i * 0.05} ${24 + i * 6.6}H${38.6 + i * 0.05}" stroke="#E0B97A" stroke-width="2"/>`)
);

// ---------- Buenos Aires: obelisk ----------
L['city-buenosaires'] = svg(
  circ(32, 32, 27, C.skyL) +
  path('M8 46Q32 40 56 46Q54 58 32 58Q10 58 8 46Z', C.green) +
  path('M8 46Q32 40 56 46Q54 50 46 53Q32 46 18 53Q10 50 8 46Z', C.greenL) +
  rect(23, 50, 18, 6, 2.5, C.slateD) + rect(24, 48, 16, 4, 1.5, C.slate) +
  path('M27 20H37L39.5 49H24.5Z', '#F3F6FA') + path('M32 20H37L39.5 49H32Z', '#C9D3E3') +
  path('M27 20L32 5L37 20Z', '#F3F6FA') + path('M32 5L37 20H32Z', '#C9D3E3') +
  arch(30.4, 10.5, 3.2, 5, C.slateD) +
  sparkle(50, 15, 4, C.white) + sparkle(13, 22, 3, C.white)
);

// ---------- Istanbul: domes + minarets ----------
L['city-istanbul'] = svg(
  shadow(32, 59, 28, 2.6) +
  // minarets
  rect(4, 22, 7, 36, 2.5, '#E3D3AC') + rect(4, 22, 3.5, 36, 1.7, '#FFF4DC') +
  path('M3 22L7.5 8L12 22Z', C.skyD) + rect(2, 27, 11, 3.5, 1.7, C.sunD) +
  rect(53, 22, 7, 36, 2.5, '#E3D3AC') + rect(53, 22, 3.5, 36, 1.7, '#FFF4DC') +
  path('M52 22L56.5 8L61 22Z', C.skyD) + rect(51, 27, 11, 3.5, 1.7, C.sunD) +
  // hall
  rect(12, 38, 40, 20, 3, '#E3D3AC') + rect(12, 38, 40, 18, 3, '#FFF4DC') +
  // side domes
  path('M12 40A8 8 0 0 1 28 40Z', C.blueD) + path('M36 40A8 8 0 0 1 52 40Z', C.blueD) +
  // big dome
  path('M18 40A14 14 0 0 1 46 40Z', C.blue) + path('M32 26A14 14 0 0 1 46 40H32Z', C.blueD) +
  // spire & crescent
  line(32, 26, 32, 18, C.sunD, 2.4) +
  '<path d="M36 12.2A5 5 0 1 1 32 7.6A3.9 3.9 0 1 0 36 12.2Z" fill="#FFC94A"/>' +
  // arches
  arch(17, 46, 6, 12, C.blueD) + arch(29, 46, 6, 12, C.blueD) + arch(41, 46, 6, 12, C.blueD)
);

// ---------- Athens: columned temple ----------
L['city-athens'] = svg(
  shadow(32, 61, 29, 2) +
  path('M4 26L32 8L60 26Z', '#F5EFE2') + path('M32 8L60 26H32Z', '#D9CDB4') +
  path('M13 24L32 12.5L51 24Z', C.sky) + path('M32 12.5L51 24H32Z', C.skyD) +
  circ(32, 20.5, 2.4, C.sun) +
  rect(6, 25, 52, 6, 2, '#F5EFE2') + rect(6, 28.5, 52, 2.5, 1.2, '#D9CDB4') +
  each(4, (i) => {
    const x = 10 + i * 13.4;
    return rect(x, 31, 7, 20, 2, '#F5EFE2') + rect(x + 3.5, 31, 3.5, 20, 1.5, '#D9CDB4') + `<path d="M${x + 2.4} 33V49" stroke="#D9CDB4" stroke-width="2"/>`;
  }) +
  rect(6, 50, 52, 4.5, 1.8, '#F5EFE2') + rect(3, 54, 58, 5, 2, '#EBD9B4') + rect(3, 57, 58, 2, 1, '#D9CDB4')
);


// ---------- Madrid: windmill ----------
L['city-madrid'] = svg(
  path('M0 52Q16 44 32 50Q48 44 64 52V60Q64 62 62 62H2Q0 62 0 60Z', C.green) +
  path('M0 52Q16 44 32 50Q48 44 64 52V54Q48 47 32 53Q16 47 0 54Z', C.greenL) +
  // tower
  path('M21 56L25 31H39L43 56Z', '#EFE2C6') + path('M32 31H39L43 56H32Z', '#D5C39C') +
  arch(28.5, 44, 7, 12, C.brownD) +
  // blades (behind cap)
  '<g transform="rotate(28 32 26)">' +
  each(4, (i) => `<g transform="rotate(${i * 90} 32 26)">` + rect(32.5, 3, 8, 22, 1.5, C.cream) + rect(31, 3, 2.6, 23, 1.3, C.brownD) + line(34, 9, 40, 9, C.creamD, 2) + line(34, 15, 40, 15, C.creamD, 2) + '</g>') +
  '</g>' +
  // cap
  path('M22 32Q22 20 32 18Q42 20 42 32Z', C.red) + path('M32 18Q42 20 42 32H32Z', C.redD) +
  circ(32, 26, 3.6, C.sun) + circ(32, 26, 1.4, C.sunD)
);

// ---------- Berlin: columned gate ----------
L['city-berlin'] = svg(
  shadow(32, 60, 29, 2) +
  // quadriga
  rect(24, 10, 16, 5, 2, C.sunD) + rect(24, 10, 16, 3.5, 2, C.sun) +
  circ(27, 6, 3, C.sun) + circ(32, 5, 3, C.sun) + circ(37, 6, 3, C.sun) + path('M30 3L32 -1L34 3Z', C.sun, ' transform="translate(0 2)"') +
  // attic + beam
  rect(10, 15, 44, 8, 2, '#D9BF8B') + rect(10, 15, 44, 6.5, 2, '#EAD6A8') +
  rect(6, 22, 52, 7, 2, '#D9BF8B') + rect(6, 22, 52, 5.5, 2, '#EAD6A8') +
  // passage
  rect(9, 29, 46, 22, 0, '#6B5A3E') +
  each(6, (i) => { const x = 7 + i * 9.4; return rect(x, 29, 5.2, 22, 1.4, '#EAD6A8') + rect(x + 2.7, 29, 2.5, 22, 1.2, '#D9BF8B'); }) +
  rect(4, 50, 56, 5, 2, '#EAD6A8') + rect(2, 54, 60, 5, 2, '#D9BF8B')
);

// ---------- Rome: colosseum ----------
const row = (y, h, n, x0, pitch, w, fill) => each(n, (i) => arch(x0 + i * pitch, y, w, h, fill));
L['city-rome'] = svg(
  shadow(32, 59, 30, 2.6) +
  '<path d="M2 26Q2 12 32 12Q62 12 62 26V50Q62 58 32 58Q2 58 2 50Z" fill="#C98F5E"/>' +
  '<path d="M2 26Q2 12 32 12Q62 12 62 26V48Q62 55 32 55Q2 55 2 48Z" fill="#EBB98A"/>' +
  // top band: small windows
  each(9, (i) => rect(8 + i * 5.9, 19, 3.2, 5, 1, '#C98F5E')) +
  pathS('M3 27Q32 32 61 27M3 38Q32 43 61 38', '#C98F5E', 2.4) +
  row(29, 8, 8, 6.4, 6.9, 4.4, '#7A4A2E') +
  row(41, 11, 8, 6.4, 6.9, 4.4, '#7A4A2E') +
  ''
);

// ---------- London: clock tower ----------
L['city-london'] = svg(
  shadow(32, 60, 16, 2.2) +
  path('M23 58V33H41V58Z', '#D9B87A') + path('M32 33H41V58H32Z', '#BE9A5B') +
  arch(28, 44, 8, 14, '#7A5343') + arch(24.5, 36, 3, 5, '#7A5343') + arch(36.5, 36, 3, 5, '#7A5343') +
  rect(19, 14, 26, 21, 3, '#BE9A5B') + rect(19, 14, 26, 19, 3, '#E5C68C') +
  circ(32, 24, 8, C.white) + circ(32, 24, 8, 'none', ` stroke="${C.sunD}" stroke-width="2.2"`) +
  line(32, 24, 32, 19, C.ink, 2) + line(32, 24, 36, 26, C.ink, 2) +
  // roof + spire
  path('M17 15L32 -1L47 15Z', C.slateD) + path('M32 -1L47 15H32Z', '#48566E') +
  rect(30, 0, 4, 5, 2, C.sun) +
  // corner pinnacles
  path('M18 35l2-5 2 5z', '#BE9A5B') + path('M42 35l2-5 2 5z', '#BE9A5B') +
  rect(15, 33, 34, 3.5, 1.5, '#BE9A5B')
);

// ---------- Dubai: needle spire ----------
L['city-dubai'] = svg(
  circ(32, 34, 24, '#FFD9A0') +
  path('M0 52Q16 46 34 51Q50 46 64 52V60Q64 62 62 62H2Q0 62 0 60Z', '#F0C56E') +
  path('M0 52Q16 46 34 51Q50 46 64 52V54Q50 49 34 53Q16 49 0 54Z', '#F8DC98') +
  // side towers
  path('M17 58L20 40L25 32V58Z', C.sky) + path('M47 58L44 42L39 34V58Z', C.sky) +
  // needle
  path('M26 58L29 30L31 14L32 2L33 14L35 30L38 58Z', C.skyD) +
  path('M32 2L33 14L35 30L38 58H32Z', C.blueD) +
  line(28.8, 33, 35.2, 33, C.skyL, 2) + line(28, 41, 36, 41, C.skyL, 2) + line(27.2, 49, 36.8, 49, C.skyL, 2) + line(30.6, 20, 33.4, 20, C.skyL, 2) +
  rect(24, 55, 16, 4, 2, C.slate)
);

// ---------- Singapore: lion-head fountain (original) ----------
L['city-singapore'] = svg(
  // basin
  '<ellipse cx="34" cy="55" rx="28" ry="6.5" fill="#3E9CC6"/>' +
  '<ellipse cx="34" cy="54" rx="28" ry="6" fill="#6EC1E4"/>' +
  '<ellipse cx="34" cy="55" rx="20" ry="3.4" fill="#CDEBF8" opacity=".55"/>' +
  // pedestal (scaled tail)
  path('M20 56Q19 44 24 38H38Q43 44 42 56Z', '#3FA88F') + path('M31 38H38Q43 44 42 56H31Z', '#2E8A75') +
  each(3, (i) => `<path d="M${22.6 + i * 6} 44q3 3 6 0M${22 + i * 6} 50q3 3 6 0" fill="none" stroke="#8BDCC5" stroke-width="2" stroke-linecap="round"/>`) +
  // mane
  each(10, (i) => { const a = (i / 10) * Math.PI * 2; return circ((28 + Math.cos(a) * 11.5).toFixed(2), (22 + Math.sin(a) * 11.5).toFixed(2), 5.2, '#F08A2C'); }) +
  circ(28, 22, 11.5, '#F6B73C') +
  // ears
  circ(19, 13, 3.2, '#F6B73C') + circ(37, 13, 3.2, '#F6B73C') + circ(19, 13, 1.5, C.pink) + circ(37, 13, 1.5, C.pink) +
  // face
  circ(28, 24, 8.5, '#FFE2A0') +
  circ(24.6, 21.6, 1.7, C.ink) + circ(31.4, 21.6, 1.7, C.ink) +
  path('M25.8 25.2Q28 23.6 30.2 25.2Q28 27.4 25.8 25.2Z', C.brownD) +
  path('M24 28Q28 32.5 32 28Q28 35 24 28Z', C.redD) +
  // water arc
  '<path d="M31 31Q46 26 50 46" fill="none" stroke="#6EC1E4" stroke-width="3.4" stroke-linecap="round"/>' +
  '<path d="M31 31Q46 26 50 46" fill="none" stroke="#CDEBF8" stroke-width="2" stroke-linecap="round"/>' +
  circ(53, 40, 1.7, '#6EC1E4') + circ(47, 20, 1.5, '#6EC1E4') + circ(56, 47, 1.4, '#6EC1E4')
);

// ---------- Tokyo: torii + tower ----------
const tw = (y) => 1.2 + (y - 2) * 0.16;
const bandP = (y1, y2, fill) => `<polygon points="${(32 - tw(y1)).toFixed(2)},${y1} ${(32 + tw(y1)).toFixed(2)},${y1} ${(32 + tw(y2)).toFixed(2)},${y2} ${(32 - tw(y2)).toFixed(2)},${y2}" fill="${fill}"/>`;
L['city-tokyo'] = svg(
  circ(32, 32, 27, '#FFE7E0') +
  // tower behind
  bandP(2, 54, C.white) + bandP(2, 54, '#FF6B4A') +
  bandP(16, 22, C.white) + bandP(34, 40, C.white) +
  rect(24, 24, 16, 4, 2, '#FF6B4A') +
  line(32, 1, 32, 8, '#FF6B4A', 2) +
  // torii posts
  rect(12, 24, 6.5, 33, 1.5, C.redD) + rect(12, 24, 3.6, 33, 1.5, C.red) +
  rect(45.5, 24, 6.5, 33, 1.5, C.redD) + rect(45.5, 24, 3.6, 33, 1.5, C.red) +
  rect(9, 33, 46, 5, 1.5, C.red) + rect(9, 36, 46, 2, 1, C.redD) +
  // kasagi
  '<path d="M2 20Q32 27 62 20L59 27Q32 33 5 27Z" fill="#C23F47"/>' +
  '<path d="M2 20Q32 27 62 20L61 23Q32 30 3 23Z" fill="#2B3245"/>' +
  '<path d="M3 22.5Q32 29.5 61 22.5" fill="none" stroke="#3B4560" stroke-width="2"/>' +
  rect(29, 27, 6, 6, 1.5, C.redD)
);

// ---------- New York: torch statue silhouette ----------
L['city-newyork'] = svg(
  circ(32, 30, 27, '#D6F1EA') +
  // pedestal
  path('M18 62L21 50H43L46 62Z', '#D8D2C4') + path('M32 50H43L46 62H32Z', '#B9B2A0') +
  rect(19, 47, 26, 5, 1.8, '#EAE5D8') +
  // robe
  path('M22 50L25 30Q26 24 32 24Q38 24 39 30L42 50Z', '#4FB59B') + path('M32 24Q38 24 39 30L42 50H32Z', '#379079') +
  each(3, (i) => line(27 + i * 4.5, 34, 26 + i * 5.5, 49, '#379079', 2)) +
  // raised arm & torch
  line(37, 31, 46, 14, '#4FB59B', 6) +
  rect(43, 8, 7, 4, 1.5, C.sunD) +
  path('M46.5 -1Q52 4 50.5 8H42.5Q41.5 4 46.5 -1Z', C.orange, ' transform="translate(0 2)"') +
  path('M46.5 3Q49.6 6 48.6 8.6H44.6Q43.8 6 46.5 3Z', C.sun, ' transform="translate(0 1.6)"') +
  // tablet arm
  rect(20, 32, 8, 11, 1.8, '#379079') + rect(20.6, 32, 6, 10, 1.6, '#4FB59B') +
  // head + crown
  circ(32, 20, 5.2, '#4FB59B') +
  each(5, (i) => { const a = -Math.PI * 0.86 + i * (Math.PI * 0.72 / 4); const x1 = 32 + Math.cos(a) * 5, y1 = 20 + Math.sin(a) * 5, x2 = 32 + Math.cos(a) * 10, y2 = 20 + Math.sin(a) * 10; return line(x1.toFixed(1), y1.toFixed(1), x2.toFixed(1), y2.toFixed(1), '#379079', 2.4); })
);

// ---------- Seoul: hanok gate ----------
L['city-seoul'] = svg(
  shadow(32, 61, 28, 2) +
  // base
  rect(6, 52, 52, 6, 2, '#B9B2A0') + rect(10, 48, 44, 5, 2, '#D8D2C4') +
  // pillars + door
  rect(13, 34, 6, 15, 1.5, C.redD) + rect(45, 34, 6, 15, 1.5, C.redD) +
  rect(19, 35, 26, 14, 0, '#7A5343') +
  arch(22, 37, 9.5, 12, '#A0715B') + arch(32.5, 37, 9.5, 12, '#A0715B') +
  line(26.8, 41, 26.8, 49, '#7A5343', 2) + line(37.2, 41, 37.2, 49, '#7A5343', 2) +
  circ(30.6, 45, 1.2, C.sun) + circ(33.4, 45, 1.2, C.sun) +
  // dancheong band
  rect(9, 29, 46, 6, 1.5, C.greenD) + rect(9, 29, 46, 2.6, 1.5, C.green) +
  each(6, (i) => rect(12 + i * 7.4, 31.6, 4.4, 2.2, 1, i % 2 ? C.sun : C.red)) +
  // roof (upturned eaves)
  '<path d="M1 27Q9 30 13 22Q32 17 51 22Q55 30 63 27Q60 33 52 33H12Q4 33 1 27Z" fill="#3B4560"/>' +
  '<path d="M1 26Q9 29 13 21Q32 16 51 21Q55 29 63 26Q61 29 58 30Q52 28 48 24Q32 20 16 24Q12 28 6 30Q3 29 1 26Z" fill="#5A6880"/>' +
  // upper roof
  '<path d="M15 21Q32 14 49 21L47 15Q32 8 17 15Z" fill="#3B4560"/>' +
  '<path d="M17 15Q32 8 47 15L46 12Q32 5 18 12Z" fill="#5A6880"/>' +
  rect(14, 21, 36, 3, 1.4, C.redD) +
  rect(28, 4, 8, 4, 2, C.sun)
);


// ================= HUBS =================
L['hub-port'] = svg(
  // sea
  path('M0 50H64V60Q64 62 62 62H2Q0 62 0 60Z', C.skyD) +
  // smoke
  circ(30, 5, 3, C.slateL) + circ(24, 8, 2.2, C.slateL) +
  // funnel
  rect(28, 9, 9, 13, 2.5, C.redD) + rect(28, 9, 9, 11, 2.5, C.red) + rect(28, 12, 9, 3, 0, C.sun) +
  // decks
  rect(18, 20, 30, 10, 3.5, '#DCE3EE') + rect(18, 20, 30, 8.5, 3.5, C.white) +
  rect(10, 29, 46, 10, 3.5, '#DCE3EE') + rect(10, 29, 46, 8.5, 3.5, C.white) +
  each(8, (i) => circ(15 + i * 5.2, 33.5, 1.6, C.sky)) + each(5, (i) => circ(24 + i * 5, 25, 1.4, C.sky)) +
  // hull
  path('M2 38H62L56 52Q55 54 52 54H12Q9 54 8 52Z', '#2E3F8F') +
  path('M2 38H62L60.6 41H3.4Z', C.red) +
  path('M7 46H57L56 52Q55 54 52 54H12Q9 54 8 52Z', C.blueD) +
  // waves
  pathS('M4 57Q10 54 16 57T28 57T40 57T52 57T62 57', C.white, 2.4, ' opacity=".9"')
);

L['hub-airport'] = svg(
  circ(32, 32, 28, C.skyL) +
  circ(50, 47, 6, C.white) + circ(43, 51, 5, C.white) + circ(56, 52, 4.5, C.white) + rect(38, 50, 22, 6, 3, C.white) +
  circ(13, 14, 4, C.white) + circ(19, 12, 3.2, C.white) + rect(9, 14, 15, 4, 2, C.white) +
  '<g transform="translate(32 32) scale(0.82) rotate(45) translate(-32 -32)">' +
  // wings
  path('M28 22L3 40Q1 42 1 44V47L28 39Z', C.blue) + path('M36 22L61 40Q63 42 63 44V47L36 39Z', C.blueD) +
  // tail planes
  path('M28 47L15 55Q14 56 14 58V60L28 55Z', C.blue) + path('M36 47L49 55Q50 56 50 58V60L36 55Z', C.blueD) +
  // engines
  rect(11, 37, 5, 9, 2.5, C.slate) + rect(48, 37, 5, 9, 2.5, C.slateD) +
  // fuselage
  '<path d="M32 2Q39 4 39 16V46L40 55Q32 61 24 55L25 46V16Q25 4 32 2Z" fill="#C4CEDE"/>' +
  '<path d="M32 2Q37.5 4 37.5 16V46L38 54Q32 59 26 54L26.5 46V16Q26.5 4 32 2Z" fill="#FFFFFF"/>' +
  path('M27 13Q27 8 32 7Q37 8 37 13Q32 15 27 13Z', C.skyD) +
  each(4, (i) => rect(29.5, 22 + i * 5.5, 5, 3, 1.5, C.sky)) +
  '</g>'
);

L['hub-rail'] = svg(
  circ(32, 30, 28, C.skyL) +
  rect(2, 52, 60, 5, 2.5, C.slate) + rect(6, 56, 6, 4, 1, C.slateD) + rect(28, 56, 6, 4, 1, C.slateD) + rect(50, 56, 6, 4, 1, C.slateD) +
  '<path d="M3 48V27Q3 19 11 19H37Q47 19 57 37Q61 43 57 48Z" fill="#8FA0BC"/>' +
  '<path d="M3 46V27Q3 18 11 18H37Q47 18 57 36Q61 42 57 46Z" fill="#F4F7FB"/>' +
  path('M3 39H60Q61 41.5 60 43H3Z', C.blue) + path('M3 43H59.5Q58.6 45 57.5 46H3Z', C.red) +
  rect(7, 23, 6, 8, 2.5, C.ink) + rect(15, 23, 6, 8, 2.5, C.ink) + rect(23, 23, 6, 8, 2.5, C.ink) +
  path('M32 22Q40 22 46 31H32Z', C.ink) +
  circ(56, 43, 1.8, C.sun) +
  circ(14, 51, 3.6, C.ink) + circ(32, 51, 3.6, C.ink) + circ(48, 51, 3.6, C.ink)
);

L['hub-space'] = svg(
  circ(32, 32, 28, '#2B3245') +
  circ(32, 32, 28, 'none', ` stroke="#4A5470" stroke-width="2"`) +
  sparkle(10, 14, 3.5, C.sun) + sparkle(54, 12, 3, C.white) + circ(52, 52, 1.6, C.white) + circ(12, 50, 1.4, C.white) + circ(46, 6, 1.2, C.white) +
  // planet
  circ(48, 50, 9, C.green) + path('M42 46Q47 44 49 49Q47 52 43 51Z', C.greenD) +
  // panels
  rect(2, 22, 20, 8, 2, C.blueD) + rect(2, 22, 20, 6.5, 2, C.blue) + rect(2, 34, 20, 8, 2, C.blueD) + rect(2, 34, 20, 6.5, 2, C.blue) +
  rect(42, 22, 20, 8, 2, C.blueD) + rect(42, 22, 20, 6.5, 2, C.blue) + rect(42, 34, 20, 8, 2, C.blueD) + rect(42, 34, 20, 6.5, 2, C.blue) +
  line(9, 22.5, 9, 28.5, C.skyL, 2) + line(15, 22.5, 15, 28.5, C.skyL, 2) + line(9, 34.5, 9, 40.5, C.skyL, 2) + line(15, 34.5, 15, 40.5, C.skyL, 2) +
  line(49, 22.5, 49, 28.5, C.skyL, 2) + line(55, 22.5, 55, 28.5, C.skyL, 2) + line(49, 34.5, 49, 40.5, C.skyL, 2) + line(55, 34.5, 55, 40.5, C.skyL, 2) +
  rect(20, 30, 24, 4, 2, C.slate) +
  // core module
  rect(24, 18, 16, 28, 6, '#C4CEDE') + rect(24, 18, 16, 26, 6, C.white) +
  rect(24, 26, 16, 4, 0, C.red) +
  circ(32, 37, 4, C.sky) + circ(32, 37, 4, 'none', ` stroke="${C.blueD}" stroke-width="2"`) +
  line(32, 18, 32, 10, C.slateL, 2.4) + circ(32, 9, 2.4, C.red)
);

// ================= CORNERS =================
L['corner-start'] = svg(
  shadow(28, 59, 18, 2.4) +
  // flag
  '<path d="M18 9Q27 4 35 9T52 9V33Q44 38 36 33T18 33Z" fill="#349B65"/>' +
  '<path d="M18 8Q27 3 35 8T52 8V31Q44 36 36 31T18 31Z" fill="#5CC689"/>' +
  // go arrow
  path('M25 17H37V13L47 20L37 27V23H25Z', C.white) +
  // pole
  rect(13, 5, 5, 53, 2.5, C.brownD) + rect(13, 5, 3, 53, 1.5, C.brown) + circ(15.5, 5, 3.6, C.sun) +
  ''
);

L['corner-island'] = svg(
  path('M0 48H64V60Q64 62 62 62H2Q0 62 0 60Z', C.skyD) + path('M0 48H64V52H0Z', C.sky) +
  circ(12, 12, 6.5, C.sun) +
  // island
  '<path d="M8 50Q10 38 32 38Q54 38 56 50Q56 56 32 56Q8 56 8 50Z" fill="#E3B562"/>' +
  '<path d="M8 50Q10 38 32 38Q54 38 56 50Q50 46 32 46Q14 46 8 50Z" fill="#F6D98E"/>' +
  // trunk
  '<path d="M31 44Q30 30 38 18" fill="none" stroke="#7A5343" stroke-width="5" stroke-linecap="round"/>' +
  '<path d="M31 44Q30 30 38 18" fill="none" stroke="#A0715B" stroke-width="2.4" stroke-linecap="round"/>' +
  // fronds
  '<path d="M38 18Q26 8 14 16Q28 12 38 18Z" fill="#349B65" stroke="#349B65" stroke-width="2" stroke-linejoin="round"/>' +
  '<path d="M38 18Q34 4 22 2Q32 8 38 18Z" fill="#5CC689" stroke="#5CC689" stroke-width="2" stroke-linejoin="round"/>' +
  '<path d="M38 18Q44 4 56 6Q44 8 38 18Z" fill="#5CC689" stroke="#5CC689" stroke-width="2" stroke-linejoin="round"/>' +
  '<path d="M38 18Q52 12 60 24Q50 18 38 18Z" fill="#349B65" stroke="#349B65" stroke-width="2" stroke-linejoin="round"/>' +
  '<path d="M38 18Q44 26 38 34Q40 24 38 18Z" fill="#349B65" stroke="#349B65" stroke-width="2" stroke-linejoin="round"/>' +
  circ(36, 20, 2.6, C.brownD) + circ(40.5, 21, 2.6, C.brownD) +
  pathS('M4 58Q10 55 16 58T28 58M40 58Q46 55 52 58T62 58', C.white, 2.4, ' opacity=".85"')
);

L['corner-festival'] = svg(
  // confetti
  rect(6, 44, 6, 3, 1, C.pink, ' transform="rotate(-30 9 45)"') + rect(50, 46, 6, 3, 1, C.sky, ' transform="rotate(25 53 47)"') +
  rect(30, 52, 5, 3, 1, C.sun, ' transform="rotate(50 32 53)"') + rect(56, 30, 5, 3, 1, C.green, ' transform="rotate(-40 58 31)"') +
  rect(4, 26, 5, 3, 1, C.green, ' transform="rotate(35 6 27)"') + circ(18, 55, 2.2, C.red) + circ(46, 56, 2, C.pink) + circ(60, 52, 1.8, C.sun) +
  burst(22, 24, 5, 13, 8, [C.red, C.sun], 3.4, 0.2) + circ(22, 24, 3.6, C.white) +
  burst(45, 18, 3, 8, 8, [C.sky, C.pink], 3, 0.5) + circ(45, 18, 2.6, C.white) +
  // party popper
  path('M34 60L40 40L50 50Z', C.orange) + path('M40 40L50 50L47 52Z', C.orangeD) +
  line(39, 46, 37, 52, C.sun, 2.4) + line(43, 50, 40, 55, C.sun, 2.4) +
  pathS('M43 42Q47 38 44 34', C.pink, 2.4) + pathS('M48 46Q54 44 55 39', C.sun, 2.4)
);

L['corner-tour'] = svg(
  shadow(32, 60, 20, 2.2) +
  // stand
  path('M20 60Q32 52 44 60Z', C.slateD) + rect(29, 52, 6, 6, 2, C.slateD) +
  // globe
  circ(32, 31, 22, C.skyD) + circ(31, 30, 21.5, C.sky) +
  path('M17 20Q24 12 33 15Q30 20 25 22Q26 28 20 30Q15 26 17 20Z', C.green) +
  path('M36 30Q44 26 49 32Q48 40 42 46Q38 42 39 37Q35 34 36 30Z', C.green) +
  path('M20 40Q26 38 28 44Q25 49 21 46Z', C.green) +
  pathS('M32 9.5V52.5M32 31H54', C.skyL, 2, ' opacity=".55"') +
  '<ellipse cx="32" cy="31" rx="9" ry="21.5" fill="none" stroke="#CDEBF8" stroke-width="2" opacity=".55"/>' +
  // route
  '<path d="M9 44Q10 8 46 8" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 6.2"/>' +
  // small plane
  '<g transform="translate(46 8) rotate(20)">' +
  path('M-8 0Q-8 -3 -3 -3H6Q10 -3 10 0Q10 3 6 3H-3Q-8 3 -8 0Z', C.white) +
  path('M-1 -2L-5 -9H-2L4 -2Z', C.red) + path('M-1 2L-5 9H-2L4 2Z', C.red) + path('M-8 0L-10 -4H-8L-5 -1Z', C.red) +
  '</g>' +
  // ticket
  '<g transform="rotate(-12 50 50)">' +
  path('M40 44H60V48Q57.5 50 60 52V56H40V52Q42.5 50 40 48Z', C.sun) + path('M40 54H60V56H40Z', C.sunD) +
  line(52, 45, 52, 55, C.sunD, 2, ' stroke-dasharray="2 2.4"') + circ(46, 50, 2, C.red) +
  '</g>'
);

// ================= SPECIAL SPACES =================
L['space-event'] = svg(
  shadow(32, 60, 20, 2.4) +
  // box
  rect(11, 30, 42, 28, 5, C.redD) + rect(11, 30, 42, 25, 5, C.red) +
  rect(8, 22, 48, 12, 4.5, C.redD) + rect(8, 22, 48, 10, 4.5, '#FF7B7B') +
  // ribbon
  rect(28, 22, 8, 36, 0, C.sunD) + rect(28, 22, 8, 33, 0, C.sun) + rect(28, 22, 8, 10, 0, C.sun) +
  // bow
  '<path d="M32 22Q18 20 17 11Q22 5 30 14Z" fill="#FFC94A" stroke="#FFC94A" stroke-width="2" stroke-linejoin="round"/>' +
  '<path d="M32 22Q46 20 47 11Q42 5 34 14Z" fill="#E9A92A" stroke="#E9A92A" stroke-width="2" stroke-linejoin="round"/>' +
  circ(32, 18, 3.6, C.sun) +
  // star
  star(50, 9, 6.5, C.sun, 5, 0.5) + sparkle(12, 10, 4, C.sky) + sparkle(56, 26, 2.8, C.pink)
);

L['space-tax'] = svg(
  shadow(32, 60, 24, 2.2) +
  // document
  rect(8, 9, 36, 46, 4, '#B7C3D6') + rect(8, 8, 36, 44, 4, '#FBFCFE') +
  rect(14, 15, 24, 3.6, 1.8, C.slateL) + rect(14, 22, 24, 3.6, 1.8, C.slateL) + rect(14, 29, 16, 3.6, 1.8, C.slateL) + rect(14, 36, 24, 3.6, 1.8, C.slateL) +
  // stamped mark
  '<g transform="rotate(-14 38 44)">' +
  circ(38, 44, 10, 'none', ` stroke="${C.red}" stroke-width="3" opacity=".9"`) + path('M32 44L36.5 48.5L44.5 39.5', 'none', ` stroke="${C.red}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" opacity=".9"`) +
  '</g>' +
  // stamp
  rect(38, 2, 14, 9, 4.5, C.blueD) + rect(38, 2, 14, 7.5, 4.5, C.blue) +
  rect(41, 9, 8, 14, 2.5, C.brownD) + rect(41, 9, 5, 14, 2.5, C.brown) +
  rect(34, 22, 22, 6, 3, C.ink) + rect(34, 22, 22, 4, 3, C.inkSoft) +
  rect(36, 27, 18, 4, 2, C.red)
);

L['space-donation'] = svg(
  shadow(32, 61, 21, 2.4) +
  // box
  rect(10, 30, 44, 30, 6, C.blueD) + rect(10, 30, 44, 27, 6, C.blue) +
  rect(7, 26, 50, 10, 4, C.blueD) + rect(7, 26, 50, 8, 4, '#6C88FF') +
  rect(22, 29, 20, 3.6, 1.8, C.ink) +
  // band
  rect(10, 44, 44, 5, 0, C.sun) +
  // heart dropping in
  heart(32, 12, 9, C.red) + '<path d="M22.5 8Q24 5 27 5" fill="none" stroke="#FF9A9A" stroke-width="2" stroke-linecap="round"/>' +
  sparkle(50, 14, 3.4, C.sun) + sparkle(13, 16, 2.8, C.pink) +
  // small heart on box
  heart(32, 52, 3.6, C.white)
);

export default L;
