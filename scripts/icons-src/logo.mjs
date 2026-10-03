// Original title emblem: two dice on a plot-of-land tile with a curved "roll" swoosh. Shapes only, no text.
import { C, svg, path, circ, rect, sparkle, each } from './lib.mjs';
const f = (n) => Math.round(n * 100) / 100;
// isometric die. faces: top, left, right colors. pips: [top,left,right] arrays of [a,b] in [-1,1]
const die = (cx, cy, s, col, pipCol, pips) => {
  const k = 0.866 * s, h = 0.5 * s;
  const V = { t: [cx, cy - s], rt: [cx + k, cy - h], rb: [cx + k, cy + h], b: [cx, cy + s], lb: [cx - k, cy + h], lt: [cx - k, cy - h], c: [cx, cy] };
  const P = (...ks) => ks.map((q) => V[q].map(f).join(' ')).join('L');
  const face = (d, fill) => `<path d="M${d}Z" fill="${fill}" stroke="${fill}" stroke-width="2.5" stroke-linejoin="round"/>`;
  const pg = (m, list) => `<g transform="matrix(${m.map(f).join(' ')})">` + list.map(([a, b]) => `<circle cx="${a}" cy="${b}" r="0.24" fill="${pipCol}"/>`).join('') + '</g>';
  return face(P('lt', 'c', 'b', 'lb'), col[1]) + face(P('rt', 'rb', 'b', 'c'), col[2]) + face(P('t', 'rt', 'c', 'lt'), col[0]) +
    pg([k / 2, h / 2, -k / 2, h / 2, cx, cy - h], pips[0]) +
    pg([k / 2, h / 2, 0, s / 2, cx - k / 2, cy + s / 4], pips[1]) +
    pg([k / 2, -h / 2, 0, s / 2, cx + k / 2, cy + s / 4], pips[2]);
};
const P5 = [[-0.55, -0.55], [0.55, -0.55], [0, 0], [-0.55, 0.55], [0.55, 0.55]];
const P2 = [[-0.5, -0.5], [0.5, 0.5]];
const P3 = [[-0.55, -0.55], [0, 0], [0.55, 0.55]];
const P4 = [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]];
const P6 = [[-0.5, -0.6], [0.5, -0.6], [-0.5, 0], [0.5, 0], [-0.5, 0.6], [0.5, 0.6]];
const P1 = [[0, 0]];

export default svg(
  // land plot tile (thickness then top)
  '<path d="M4 43V48L32 60L60 48V43L32 55Z" fill="#7A5343" stroke="#7A5343" stroke-width="2.5" stroke-linejoin="round"/>' +
  '<path d="M4 43L32 55V60L4 48Z" fill="#7A5343"/><path d="M60 43L32 55V60L60 48Z" fill="#A0715B"/>' +
  '<path d="M32 31L60 43L32 55L4 43Z" fill="#349B65" stroke="#349B65" stroke-width="3" stroke-linejoin="round"/>' +
  '<path d="M32 33L57 43.500L32 54L7 43.500Z" fill="#5CC689"/>' +
  '<path d="M19.5 38L45 49M44.5 38L19 49" stroke="#8ED7AB" stroke-width="2" stroke-linecap="round" stroke-dasharray="1 5" fill="none"/>' +
  // small boundary flag
  rect(8.5, 33, 2, 12, 1, C.brownD) + path('M10.5 33L18 35.500L10.5 38Z', C.red) +
  // dice
  die(23, 34, 12, ['#FF8585', '#EF5B5B', '#C23F47'], C.white, [P5, P2, P3]) +
  die(44, 41, 9.5, ['#FFFFFF', '#E8EDF5', '#B7C3D6'], C.ink, [P1.map(([a, b]) => [a, b]), P4, P6]) +
  // swoosh
  '<path d="M3 34Q5 9 34 8Q50 7.5 58 17Q47 12.5 34 14Q11 16 3 34Z" fill="#FFC94A"/>' +
  '<path d="M3 34Q5 14 30 10Q13 16 3 34Z" fill="#E9A92A"/>' +
  sparkle(55, 8, 4.5, C.sun) + circ(60, 26, 1.8, C.pink) + circ(6, 12, 2, C.sky)
);
