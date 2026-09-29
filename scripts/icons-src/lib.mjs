// Shared helpers for hand-authoring the SVG icon sets.
// The build script (../build-icons.mjs) turns the sources into src/content/icons/*.ts
export const C = {
  ink: '#2B3245', inkSoft: '#4A5470', white: '#FFFFFF', cream: '#FFF4DC', creamD: '#EBD9B4',
  sun: '#FFC94A', sunD: '#E9A92A', orange: '#FF9A4D', orangeD: '#E17A30',
  red: '#EF5B5B', redD: '#C23F47', pink: '#F28AB2', pinkD: '#D2668F',
  sky: '#6EC1E4', skyD: '#3E9CC6', skyL: '#CDEBF8', blue: '#4A6CF7', blueD: '#3450C9',
  green: '#5CC689', greenD: '#349B65', greenL: '#A6E3BF', brown: '#A0715B', brownD: '#7A5343',
  slate: '#7B8AA3', slateD: '#5A6880', slateL: '#CBD3E0', purple: '#8B6BD9', purpleD: '#6949B8',
};
export const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`;
export const svg24 = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
export const shadow = (cx = 32, cy = 57, rx = 20, ry = 3.5) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${C.ink}" opacity=".13"/>`;
const r = (n) => Math.round(n * 100) / 100;
// arch-shaped window/door (flat bottom, round top)
export const arch = (x, y, w, h, fill) => `<path d="M${x} ${r(y + h)}V${r(y + w / 2)}A${r(w / 2)} ${r(w / 2)} 0 0 1 ${r(x + w)} ${r(y + w / 2)}V${r(y + h)}Z" fill="${fill}"/>`;
// n-point star
export const star = (cx, cy, R, fill, n = 5, ratio = 0.5) => {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 ? R * ratio : R;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    pts.push(`${r(cx + rad * Math.cos(a))},${r(cy + rad * Math.sin(a))}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}" stroke="${fill}" stroke-width="2" stroke-linejoin="round"/>`;
};
// 4-point sparkle
export const sparkle = (cx, cy, s, fill) =>
  `<path d="M${cx} ${r(cy - s)}Q${r(cx + s * 0.18)} ${r(cy - s * 0.18)} ${r(cx + s)} ${cy}Q${r(cx + s * 0.18)} ${r(cy + s * 0.18)} ${cx} ${r(cy + s)}Q${r(cx - s * 0.18)} ${r(cy + s * 0.18)} ${r(cx - s)} ${cy}Q${r(cx - s * 0.18)} ${r(cy - s * 0.18)} ${cx} ${r(cy - s)}Z" fill="${fill}"/>`;
export const circ = (cx, cy, rad, fill, extra = '') => `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${fill}"${extra}/>`;
export const rect = (x, y, w, h, rx, fill, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"${extra}/>`;
export const path = (d, fill, extra = '') => `<path d="${d}" fill="${fill}"${extra}/>`;
export const line = (x1, y1, x2, y2, stroke, w = 2.5, extra = '') => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" fill="none"${extra}/>`;
export const each = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');
// stroke-only path (no fill)
export const pathS = (d, stroke, w = 2.4, extra = '') => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
export const heart = (cx, cy, s, fill) => `<path d="M${cx} ${r(cy + s * 0.9)}C${r(cx - s * 1.6)} ${r(cy - s * 0.1)} ${r(cx - s * 0.9)} ${r(cy - s * 1.2)} ${r(cx - s * 0.45)} ${r(cy - s * 1.0)}C${r(cx - s * 0.15)} ${r(cy - s * 0.9)} ${cx} ${r(cy - s * 0.55)} ${cx} ${r(cy - s * 0.45)}C${cx} ${r(cy - s * 0.55)} ${r(cx + s * 0.15)} ${r(cy - s * 0.9)} ${r(cx + s * 0.45)} ${r(cy - s * 1.0)}C${r(cx + s * 0.9)} ${r(cy - s * 1.2)} ${r(cx + s * 1.6)} ${r(cy - s * 0.1)} ${cx} ${r(cy + s * 0.9)}Z" fill="${fill}"/>`;
// radial burst of round-capped strokes with end dots
export const burst = (cx, cy, r1, r2, n, colors, w = 3, rot = 0) => each(n, (i) => {
  const a = rot + (i / n) * Math.PI * 2, c = colors[i % colors.length];
  const x1 = cx + Math.cos(a) * r1, y1 = cy + Math.sin(a) * r1, x2 = cx + Math.cos(a) * r2, y2 = cy + Math.sin(a) * r2;
  return line(r(x1), r(y1), r(x2), r(y2), c, w) + circ(r(cx + Math.cos(a) * (r2 + 3.5)), r(cy + Math.sin(a) * (r2 + 3.5)), w * 0.55, c);
});
