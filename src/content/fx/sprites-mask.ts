/**
 * Mask-atlas sprites: PURE WHITE + alpha only (shading is done with alpha, never grey), so the runtime can
 * tint (multiply / source-in) and/or draw additively with globalCompositeOperation='lighter'.
 * Two-tone looks come from stacking two ~0.8 alpha layers (union alpha ~0.96 vs 0.8).
 * NO text, digits or currency glyphs.
 */
import {
  clamp, doc, easeIn, easeOut, f, lerp, mulberry32, rad, radial, spark4, starPath, streak, type SpriteDef,
} from './kit';

const W = '#fff';

// ---------------------------------------------------------------- 11. flag_wave

function flagWave(i: number, n: number): string {
  const phase = (2 * Math.PI * i) / n;
  const x0 = 13.5;
  const x1 = 57;
  const step = 3.1;
  const top = 8;
  const bot = 35;
  const off = (x: number): number => Math.sin(phase - (x - x0) * 0.2) * Math.min(1, (x - x0) / 10) * 3.4;
  const slope = (x: number): number => (off(x + 0.5) - off(x - 0.5)) / 1;
  const xs: number[] = [];
  for (let x = x0; x < x1 - 0.1; x += step) xs.push(x);
  xs.push(x1);
  let strips = '';
  for (let k = 0; k < xs.length - 1; k++) {
    const a = xs[k]!;
    const b = xs[k + 1]!;
    // swallowtail: bottom/top edge is cut by a V on the last strip(s)
    const notch = (x: number): number => (x > 47 ? (x - 47) * 0.9 : 0);
    const ya0 = top + off(a);
    const ya1 = bot + off(a) - 0;
    const yb0 = top + off(b) + notch(b) * 0;
    const yb1 = bot + off(b);
    const mid = (a + b) / 2;
    const alpha = slope(mid) > 0 ? 1 : 0.8;
    strips += `<polygon points="${f(a - 0.05)},${f(ya0)} ${f(b + 0.05)},${f(yb0)} ${f(b + 0.05)},${f(yb1)} ${f(a - 0.05)},${f(ya1)}" fill="${W}" opacity="${alpha}"/>`;
  }
  // swallowtail notch cut-out (mask hole) + star emblem hole
  const cx = 33;
  const cy = (top + bot) / 2 + off(cx);
  const tilt = (Math.atan(slope(cx)) * 180) / Math.PI;
  const tailY = (top + bot) / 2 + off(x1);
  const defs =
    `<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="52">` +
    `<rect width="64" height="52" fill="#fff"/>` +
    `<path d="M${x1 + 2} ${f(top + off(x1) - 2)}L${f(x1 - 9)} ${f(tailY)}L${x1 + 2} ${f(bot + off(x1) + 2)}Z" fill="#000"/>` +
    `<path transform="translate(${cx} ${f(cy)}) rotate(${f(tilt)})" d="${starPath(0, 0.4, 7.4, 3.2)}" fill="#5a5a5a" stroke="#5a5a5a" stroke-width="1.2" stroke-linejoin="round"/>` +
    `</mask>`;
  const body =
    `<g mask="url(#m)">${strips}</g>` +
    `<rect x="9.6" y="6" width="4.2" height="45" rx="2.1" fill="${W}"/>` +
    `<circle cx="11.7" cy="5.2" r="3.4" fill="${W}"/>`;
  return doc(64, 52, body, defs);
}

// ---------------------------------------------------------------- 12. sparkle4

const SPARK_SIZE = [0.32, 0.72, 1, 0.88, 0.6, 0.3];

function sparkle4(i: number, n: number): string {
  const s = SPARK_SIZE[i % SPARK_SIZE.length]! ;
  const r = 22 * s;
  const rot = (i / n) * 40;
  const defs = radial('g', [
    [0, W, 0.75],
    [1, W, 0],
  ]);
  const body =
    `<circle cx="24" cy="24" r="${f(r * 0.62)}" fill="url(#g)"/>` +
    `<path d="${spark4(24, 24, r, 0.17, rot)}" fill="${W}"/>` +
    `<path d="${spark4(24, 24, r * 0.5, 0.24, rot + 45)}" fill="${W}" opacity=".8"/>` +
    `<circle cx="${f(24 + r * 0.72)}" cy="${f(24 - r * 0.7)}" r="${f(1.1 + s)}" fill="${W}" opacity="${f(0.9 * (1 - Math.abs(s - 0.9)))}"/>`;
  return doc(48, 48, body, defs);
}

// ---------------------------------------------------------------- 13. glint_sweep

function glintSweep(i: number, n: number): string {
  const t = (i + 0.5) / n;
  const p = lerp(-8, 72, t);
  const op = clamp(Math.sin(Math.PI * t) * 1.5);
  const skew = 0.62;
  const band = (dx: number, w: number, a: number): string => {
    const x = p + dx;
    return `<polygon points="${f(x + 34 * skew)},-2 ${f(x + 34 * skew + w)},-2 ${f(x - 34 * skew + w)},66 ${f(x - 34 * skew)},66" fill="url(#v)" opacity="${f(a)}"/>`;
  };
  const defs =
    `<linearGradient id="v" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".22" stop-color="#fff" stop-opacity="1"/>` +
    `<stop offset=".78" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
  const body = `<g opacity="${f(op)}">${band(0, 10, 1)}${band(15, 3.6, 0.9)}${band(-8, 2.4, 0.8)}</g>`;
  return doc(64, 64, body, defs);
}

// ---------------------------------------------------------------- 14. shine_cross

const SHINE_SIZE = [0.3, 0.68, 1, 0.9, 0.62, 0.3];

function shineCross(i: number, n: number): string {
  const s = SHINE_SIZE[i % SHINE_SIZE.length]!;
  const defs = radial('g', [
    [0, W, 0.9],
    [0.45, W, 0.35],
    [1, W, 0],
  ]);
  const rot = (i / n) * 24;
  // straight-tapered needles (thin, lens-flare cross) + a fat concave diagonal star + bright core
  const needle = (len: number, th: number, r: number): string => {
    const a = rad(r);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const P = (x: number, y: number): string => `${f(48 + x * ca - y * sa)} ${f(48 + x * sa + y * ca)}`;
    return `M${P(-len, 0)}L${P(0, -th)}L${P(len, 0)}L${P(0, th)}Z`;
  };
  const body =
    `<circle cx="48" cy="48" r="${f(26 * s)}" fill="url(#g)"/>` +
    `<path d="${needle(46 * s, 5.2 * s, rot)}${needle(46 * s, 5.2 * s, rot + 90)}" fill="${W}"/>` +
    `<path d="${spark4(48, 48, 22 * s, 0.2, rot + 45)}" fill="${W}" opacity=".9"/>` +
    `<circle cx="48" cy="48" r="${f(6.5 * s)}" fill="${W}"/>` +
    `<circle cx="${f(48 + 30 * s)}" cy="${f(48 - 20 * s)}" r="${f(1.4 + s * 1.2)}" fill="${W}" opacity=".9"/>` +
    `<circle cx="${f(48 - 26 * s)}" cy="${f(48 + 24 * s)}" r="${f(1 + s)}" fill="${W}" opacity=".8"/>`;
  return doc(96, 96, body, defs);
}

// ---------------------------------------------------------------- 15. star_burst

function starBurst(i: number, n: number): string {
  const t = i / (n - 1);
  const e = easeOut(t);
  const c = 64;
  // central star pops in fast, then settles and fades
  const grow = lerp(0.35, 1.08, easeOut(clamp(t * 2.4)));
  const settle = t > 0.35 ? lerp(1, 0.62, easeOut((t - 0.35) / 0.65)) : 1;
  const sr = 34 * grow * settle;
  const starA = t < 0.5 ? 1 : clamp(1 - (t - 0.5) / 0.5);
  let rays = '';
  const rays_n = 10;
  for (let j = 0; j < rays_n; j++) {
    const a = rad(j * (360 / rays_n) + 18);
    const r1 = lerp(22, 46, e) + (j % 2) * 2;
    const len = lerp(4, 12, Math.sin(Math.PI * Math.min(1, t * 1.15))) * (j % 2 ? 0.75 : 1);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    rays += `<path d="${streak(c + ca * (r1 + len), c + sa * (r1 + len), c + ca * r1, c + sa * r1, lerp(4.2, 1.6, t))}"/>`;
  }
  let dots = '';
  for (let j = 0; j < rays_n; j++) {
    const a = rad(j * (360 / rays_n));
    const r = lerp(20, 45, e);
    dots += `<circle cx="${f(c + Math.cos(a) * r)}" cy="${f(c + Math.sin(a) * r)}" r="${f(lerp(3.4, 1.1, t))}"/>`;
  }
  const rayA = clamp(1.25 - t * 1.05);
  const body =
    `<g fill="${W}" opacity="${f(rayA)}">${rays}${dots}</g>` +
    `<path d="${starPath(c, c + 1, sr, sr * 0.47, 5, -90 + t * 24)}" fill="${W}" stroke="${W}" stroke-width="${f(6 * grow)}" stroke-linejoin="round" opacity="${f(starA)}"/>`;
  return doc(128, 128, body);
}

// ---------------------------------------------------------------- 16. ring_shock

function ringShock(i: number, n: number): string {
  const t = i / (n - 1);
  const e = easeOut(t);
  const r = lerp(10, 58, e);
  const sw = lerp(12, 1.8, easeOut(t));
  const a = 1 - easeIn(t) * 0.85;
  const body =
    `<circle cx="64" cy="64" r="${f(r)}" fill="${W}" opacity="${f(0.2 * (1 - t))}"/>` +
    `<circle cx="64" cy="64" r="${f(r)}" fill="none" stroke="${W}" stroke-width="${f(sw)}" opacity="${f(a)}"/>` +
    (t > 0.15
      ? `<circle cx="64" cy="64" r="${f(r * 0.7)}" fill="none" stroke="${W}" stroke-width="${f(sw * 0.4)}" opacity="${f(a * 0.55)}"/>`
      : '');
  return doc(128, 128, body);
}

// ---------------------------------------------------------------- 17. dust_puff

function dustPuff(i: number, n: number): string {
  const t = i / (n - 1);
  const e = easeOut(t);
  const rnd = mulberry32(1701);
  const cx = 48;
  const cy = 70; // ground line
  const m = 7;
  const blobs = Array.from({ length: m }, (_, j) => {
    const fx = (j / (m - 1)) * 2 - 1 + (rnd() - 0.5) * 0.12;
    return { fx, r: (9.5 + rnd() * 3) * (1 - 0.3 * Math.abs(fx)), lift: 0 };
  });
  // billowing top row
  blobs.push({ fx: -0.42, r: 12, lift: 9 }, { fx: 0.04, r: 14.5, lift: 13 }, { fx: 0.46, r: 11.5, lift: 8 });
  const layer = (shrink: number, dx: number, dy: number): string =>
    blobs
      .map((b) => {
        const rr = (b.r * lerp(0.6, 1.12, e) + lerp(0, 1.5, e)) * shrink;
        const x = cx + b.fx * lerp(8, 30, e) + dx;
        const y = cy - (1 - b.fx * b.fx) * lerp(3, 10, e) - b.lift * e - 6 * t + dy;
        return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(rr)}"/>`;
      })
      .join('');
  const a = clamp(1.15 - easeIn(t) * 1.1);
  const specks = [-1, -0.45, 0.5, 1]
    .map((fx, j) => {
      const x = cx + fx * lerp(22, 42, e);
      const y = cy - lerp(4, 22, e) - j * 2;
      return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(lerp(3, 1.2, t))}"/>`;
    })
    .join('');
  const body =
    `<g fill="${W}" opacity="${f(a)}">` +
    `<g opacity=".6">${layer(1, 0, 0)}</g>` +
    `<g opacity=".8">${layer(0.66, -1.4, -2.4)}</g>` +
    `<g opacity=".8">${specks}</g>` +
    `</g>`;
  return doc(96, 96, body);
}

// ---------------------------------------------------------------- 18. smoke

function smoke(i: number, n: number): string {
  const t = i / (n - 1);
  const rnd = mulberry32(4242);
  const defs = radial('g', [
    [0, W, 0.95],
    [0.84, W, 0.88],
    [1, W, 0],
  ]);
  const life = 0.85;
  let puffs = '';
  for (let j = 0; j < 6; j++) {
    const sway = (rnd() - 0.5) * 24;
    const size = 0.85 + rnd() * 0.5;
    const u = (t - (j * 0.1 - 0.3)) / life;
    if (u <= 0 || u >= 1) continue;
    const eu = easeOut(u);
    const x = 48 + sway * eu + Math.sin(u * 4 + j) * 4;
    const y = 84 - 60 * eu;
    const r = (5.5 + 10 * eu) * size;
    const a = clamp(u * 7) * (1 - u) ** 0.7;
    puffs +=
      `<g opacity="${f(clamp(a))}">` +
      `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 1.2)}" fill="url(#g)"/>` +
      `<circle cx="${f(x - r * 0.7)}" cy="${f(y + r * 0.3)}" r="${f(r * 0.85)}" fill="url(#g)"/>` +
      `<circle cx="${f(x + r * 0.75)}" cy="${f(y + r * 0.2)}" r="${f(r * 0.9)}" fill="url(#g)"/>` +
      `</g>`;
  }
  return doc(96, 96, puffs, defs);
}

// ---------------------------------------------------------------- 19. firework

function firework(i: number, n: number): string {
  const t = i / (n - 1);
  const rnd = mulberry32(777);
  const c = 64;
  const sparks = 18;
  let body = '';
  const fade = t < 0.5 ? 1 : clamp(1 - (t - 0.5) / 0.5);
  for (let j = 0; j < sparks; j++) {
    const a = rad((j * 360) / sparks + (rnd() - 0.5) * 8);
    const v = j % 2 === 0 ? 46 : 33;
    const pos = (tt: number): [number, number] => {
      const q = easeOut(tt);
      return [c + Math.cos(a) * v * q, c + Math.sin(a) * v * q + 12 * tt * tt];
    };
    const [hx, hy] = pos(t);
    const [tx, ty] = pos(Math.max(0, t - 0.22));
    if (Math.hypot(hx - tx, hy - ty) > 0.8) {
      body += `<path d="${streak(tx, ty, hx, hy, lerp(4.6, 1.6, t))}" opacity="${f(0.85 * fade)}"/>`;
    }
    body += `<circle cx="${f(hx)}" cy="${f(hy)}" r="${f(lerp(3.3, 1.5, t))}" opacity="${f(fade)}"/>`;
  }
  let extras = '';
  // initial flash
  if (t < 0.3) {
    extras += `<circle cx="${c}" cy="${c}" r="${f(lerp(15, 6, t / 0.3))}" opacity="${f(1 - t / 0.45)}"/>`;
    extras += `<path d="${spark4(c, c, lerp(30, 14, t / 0.3), 0.14, 0)}" opacity=".95"/>`;
    extras += `<path d="${spark4(c, c, lerp(20, 9, t / 0.3), 0.18, 45)}" opacity=".9"/>`;
  }
  // late twinkles where sparks died
  if (t > 0.45) {
    for (let j = 0; j < 7; j++) {
      const a = rad(rnd() * 360);
      const rr = 24 + rnd() * 28;
      const ph = (t * 5 + j * 0.37) % 1;
      const s = Math.sin(Math.PI * ph) * (1 - (t - 0.45) * 1.05);
      if (s > 0.05) extras += `<path d="${spark4(c + Math.cos(a) * rr, c + Math.sin(a) * rr + 14, 6.5 * s + 1, 0.2, 0)}"/>`;
    }
  }
  return doc(128, 128, `<g fill="${W}">${body}${extras}</g>`);
}

// ---------------------------------------------------------------- 20. ray_burst

function rayBurst(): string {
  const c = 128;
  const R = 126;
  let rays = '';
  for (let j = 0; j < 12; j++) {
    const a = rad(j * 30);
    const hw = rad(6.4);
    rays += `<path d="M${c} ${c}L${f(c + Math.cos(a - hw) * R)} ${f(c + Math.sin(a - hw) * R)}L${f(c + Math.cos(a + hw) * R)} ${f(c + Math.sin(a + hw) * R)}Z"/>`;
  }
  const defs =
    `<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="${c}" cy="${c}" r="${R}">` +
    `<stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".3" stop-color="#fff" stop-opacity=".8"/>` +
    `<stop offset=".7" stop-color="#fff" stop-opacity=".3"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`;
  return doc(256, 256, `<g fill="url(#g)">${rays}<circle cx="${c}" cy="${c}" r="26"/></g>`, defs);
}

// ---------------------------------------------------------------- 21. glow

function glow(): string {
  const defs = radial('g', [
    [0, W, 1],
    [0.3, W, 0.62],
    [0.65, W, 0.2],
    [1, W, 0],
  ]);
  return doc(64, 64, `<circle cx="32" cy="32" r="32" fill="url(#g)"/>`, defs);
}

// ---------------------------------------------------------------- 22. speed_lines

function speedLines(i: number, n: number): string {
  const rows = [
    { y: 9, len: 46, sp: 1, base: 30, w: 4.6 },
    { y: 20, len: 30, sp: 2, base: 90, w: 4 },
    { y: 31, len: 56, sp: 1, base: 70, w: 5.6 },
    { y: 42, len: 34, sp: 2, base: 8, w: 4 },
    { y: 54, len: 44, sp: 1, base: 110, w: 4.6 },
  ];
  const step = 128 / n;
  const defs =
    `<linearGradient id="h" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="128" y2="0">` +
    `<stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".16" stop-color="#fff" stop-opacity="1"/>` +
    `<stop offset=".84" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
  let body = '';
  for (const r of rows) {
    const head = (((r.base + step * r.sp * i) % 128) + 128) % 128;
    body += `<path d="${streak(head - r.len, r.y, head, r.y, r.w)}" fill="url(#h)"/>`;
    // wrap copy so the trail stays whole at the seam
    if (head - r.len < 0) body += `<path d="${streak(head - r.len + 128, r.y, head + 128, r.y, r.w)}" fill="url(#h)"/>`;
  }
  return doc(128, 64, body, defs);
}

// ---------------------------------------------------------------- 23. comet

function comet(i: number, n: number): string {
  const phase = (2 * Math.PI * i) / n;
  const hx = 76;
  const cy = 24;
  const step = 4.5;
  const top: string[] = [];
  const bot: string[] = [];
  const build = (wScale: number, lenScale: number): string => {
    top.length = 0;
    bot.length = 0;
    for (let x = hx - 2; x > hx - 70 * lenScale; x -= step) {
      const u = (hx - x) / (70 * lenScale);
      const hw = 9 * wScale * (1 - u) ** 0.85;
      const yc = cy + Math.sin(phase - u * 7) * u * 3.4;
      top.push(`${f(x)} ${f(yc - hw)}`);
      bot.unshift(`${f(x)} ${f(yc + hw)}`);
    }
    return `M${top.join('L')}L${bot.join('L')}Z`;
  };
  const rnd = mulberry32(31 + i * 17);
  let sparks = '';
  for (let j = 0; j < 4; j++) {
    const x = 12 + rnd() * 46;
    const y = cy + (rnd() - 0.5) * 22;
    sparks += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(1 + rnd() * 1.4)}"/>`;
  }
  const body =
    `<g fill="${W}">` +
    `<path d="${build(1, 1)}" opacity=".45"/>` +
    `<path d="${build(0.55, 0.72)}" opacity=".55"/>` +
    `<g opacity=".8">${sparks}</g>` +
    `<circle cx="${hx}" cy="${cy}" r="11.5" opacity=".35"/>` +
    `<circle cx="${hx}" cy="${cy}" r="8.2"/>` +
    `</g>`;
  return doc(96, 48, body);
}

// ---------------------------------------------------------------- 24. stamp_splat

function stampSplat(i: number, n: number): string {
  const t = i / (n - 1);
  const e = easeOut(t);
  const c = 64;
  const r = lerp(22, 47, e);
  const rnd = mulberry32(90210);
  let dots = '';
  for (let j = 0; j < 12; j++) {
    const a = rad(j * 30 + (rnd() - 0.5) * 14);
    const far = 0.85 + rnd() * 0.35;
    const rr = lerp(28, 50, e) * far;
    const size = (j % 3 === 0 ? 4.6 : 3) * lerp(1, 0.4, t);
    dots += `<circle cx="${f(c + Math.cos(a) * rr)}" cy="${f(c + Math.sin(a) * rr)}" r="${f(size)}"/>`;
  }
  const body =
    `<g fill="${W}">` +
    (t < 0.55 ? `<circle cx="${c}" cy="${c}" r="${f(r * 0.88)}" opacity="${f(0.5 * (1 - t / 0.55))}"/>` : '') +
    `<circle cx="${c}" cy="${c}" r="${f(r)}" fill="none" stroke="${W}" stroke-width="${f(lerp(9, 2.2, t))}" opacity="${f(1 - t * 0.7)}"/>` +
    (t > 0.2 ? `<circle cx="${c}" cy="${c}" r="${f(r * 1.16)}" fill="none" stroke="${W}" stroke-width="${f(lerp(3.5, 1.2, t))}" opacity="${f(0.6 * (1 - t))}"/>` : '') +
    `<g opacity="${f(1 - easeIn(t) * 0.85)}">${dots}</g>` +
    `</g>`;
  return doc(128, 128, body);
}

// ---------------------------------------------------------------- 25. hit_lines

function hitLines(i: number, n: number): string {
  const t = i / (n - 1);
  const e = easeOut(t);
  const c = 32;
  let body = '';
  for (let j = 0; j < 8; j++) {
    const a = rad(j * 45 + 22.5);
    const r1 = lerp(8, 19, e) + (j % 2) * 1.5;
    const len = lerp(11, 15, e) * (j % 2 ? 0.7 : 1) * (1 - 0.3 * t);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    body += `<path d="${streak(c + ca * (r1 + len), c + sa * (r1 + len), c + ca * r1, c + sa * r1, lerp(7.5, 3.6, t))}"/>`;
  }
  return doc(64, 64, `<g fill="${W}" opacity="${f(1 - t * 0.6)}">${body}</g>`);
}

// ---------------------------------------------------------------- 26-30. confetti (1 frame each)

/** Two-tone piece: base at 0.8 alpha, highlight layer at 0.8 alpha on top (union ~0.96). */
const tone = (base: string, hi: string): string =>
  `<g fill="${W}"><g opacity=".8">${base}</g><g opacity=".8">${hi}</g></g>`;

const confettiRect = (): string =>
  doc(18, 22, tone(`<rect x="2.5" y="2.5" width="13" height="17" rx="2.6"/>`, `<path d="M5.1 2.5H15.5V9L2.5 19.5V5.1Q2.5 2.5 5.1 2.5Z"/>`));

const confettiStreamer = (): string =>
  doc(
    18,
    38,
    `<g fill="none" stroke="${W}" stroke-linecap="round">` +
      `<path d="M6 4.5C13.5 9.5 4.8 17 12 23S7.8 31 11.5 33.8" stroke-width="5.2" opacity=".8"/>` +
      `<path d="M6 4.5C13.5 9.5 4.8 17 12 23S7.8 31 11.5 33.8" stroke-width="2.2" opacity=".8" transform="translate(-.8 0)"/></g>`,
  );

const confettiDot = (): string =>
  doc(18, 18, tone(`<circle cx="9" cy="9" r="7"/>`, `<circle cx="7.4" cy="7.2" r="3.4"/>`));

const confettiTri = (): string =>
  doc(
    20,
    20,
    `<g fill="${W}" stroke="${W}" stroke-width="2" stroke-linejoin="round">` +
      `<g opacity=".8"><polygon points="10,3.5 17,16 3,16"/></g><g opacity=".8"><polygon points="10,3.5 13.5,9.8 6.5,9.8"/></g></g>`,
  );

const confettiDiamond = (): string =>
  doc(20, 22, tone(`<polygon points="10,2 17.5,11 10,20 2.5,11"/>`, `<polygon points="10,2 17.5,11 10,11"/>`));

// Mask effects are rasterized at 87.5% density; runtime scale metadata keeps their nominal size and anchors unchanged.
const MASK_BAKE_K = 0.875;

export const MASK_SPRITES: SpriteDef[] = ([
  { name: 'flag_wave', cls: 'mask', w: 64, h: 52, n: 6, fps: 10, loop: true, svg: flagWave },
  { name: 'sparkle4', cls: 'mask', w: 48, h: 48, n: 6, fps: 20, loop: false, svg: sparkle4 },
  { name: 'glint_sweep', cls: 'mask', w: 64, h: 64, n: 8, fps: 24, loop: false, edgeOk: true, svg: glintSweep },
  { name: 'shine_cross', cls: 'mask', w: 96, h: 96, n: 6, fps: 15, loop: false, svg: shineCross },
  { name: 'star_burst', cls: 'mask', w: 128, h: 128, n: 8, fps: 24, loop: false, k: 0.75, svg: starBurst },
  { name: 'ring_shock', cls: 'mask', w: 128, h: 128, n: 6, fps: 24, loop: false, k: 0.75, svg: ringShock },
  { name: 'dust_puff', cls: 'mask', w: 96, h: 96, n: 8, fps: 20, loop: false, k: 0.75, svg: dustPuff },
  { name: 'smoke', cls: 'mask', w: 96, h: 96, n: 8, fps: 15, loop: false, k: 0.75, svg: smoke },
  { name: 'firework', cls: 'mask', w: 128, h: 128, n: 12, fps: 20, loop: false, k: 0.75, svg: firework },
  { name: 'ray_burst', cls: 'mask', w: 256, h: 256, n: 1, fps: 1, loop: false, k: 0.5, svg: () => rayBurst() },
  { name: 'glow', cls: 'mask', w: 64, h: 64, n: 1, fps: 1, loop: false, svg: () => glow() },
  { name: 'speed_lines', cls: 'mask', w: 128, h: 64, n: 4, fps: 20, loop: true, edgeOk: true, k: 0.75, svg: speedLines },
  { name: 'comet', cls: 'mask', w: 96, h: 48, n: 8, fps: 20, loop: true, k: 0.75, svg: comet },
  { name: 'stamp_splat', cls: 'mask', w: 128, h: 128, n: 5, fps: 24, loop: false, k: 0.75, svg: stampSplat },
  { name: 'hit_lines', cls: 'mask', w: 64, h: 64, n: 4, fps: 24, loop: false, svg: hitLines },
  { name: 'confetti_rect', cls: 'mask', w: 18, h: 22, n: 1, fps: 1, loop: false, svg: () => confettiRect() },
  { name: 'confetti_streamer', cls: 'mask', w: 18, h: 38, n: 1, fps: 1, loop: false, svg: () => confettiStreamer() },
  { name: 'confetti_dot', cls: 'mask', w: 18, h: 18, n: 1, fps: 1, loop: false, svg: () => confettiDot() },
  { name: 'confetti_tri', cls: 'mask', w: 20, h: 20, n: 1, fps: 1, loop: false, svg: () => confettiTri() },
  { name: 'confetti_diamond', cls: 'mask', w: 20, h: 22, n: 1, fps: 1, loop: false, svg: () => confettiDiamond() },
] satisfies SpriteDef[]).map((sprite) => ({ ...sprite, k: (sprite.k ?? 1) * MASK_BAKE_K }));
