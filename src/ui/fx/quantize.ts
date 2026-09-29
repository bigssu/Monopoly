/**
 * Frame-budget quantization helpers (pure functions, no DOM): see `time.ts` and
 * docs/PERFORMANCE.md.
 *
 * `stepKeyframes()` turns a Web Animations keyframe list + effect easing into a staircase of
 * keyframes sampled at `hz` (each keyframe `easing: 'step-end'`, effect easing `linear`): the
 * browser (and the compositor) then change the value only `hz` times per second, whatever the
 * display rate. Values are interpolated here in JS for the value shapes the game uses (numbers,
 * lengths, percentages, angles, transform lists, hex/rgb colors). Anything else returns `null`
 * and the caller falls back to a quantized effect easing (`quantizedEasing`).
 */

export type Ease = (x: number) => number;

/** CSS cubic-bezier() with the spec's linear extrapolation outside [0, 1]. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const bez = (t: number, a: number, b: number): number => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  const startSlope = x1 > 0 ? y1 / x1 : y1 === 0 && x2 > 0 ? y2 / x2 : 0;
  const endSlope = x2 < 1 ? (y2 - 1) / (x2 - 1) : y2 === 1 && x1 < 1 ? (y1 - 1) / (x1 - 1) : 0;
  return (x) => {
    if (x <= 0) return x === 0 ? 0 : startSlope * x;
    if (x >= 1) return x === 1 ? 1 : 1 + endSlope * (x - 1);
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 32; i++) {
      const m = (lo + hi) / 2;
      if (bez(m, x1, x2) < x) lo = m;
      else hi = m;
    }
    return bez((lo + hi) / 2, y1, y2);
  };
}

const KEYWORDS: Record<string, [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

/** Parse a CSS easing we can evaluate in JS (linear, keywords, cubic-bezier); otherwise null. */
export function easingFunction(easing: string | undefined): Ease | null {
  const e = (easing ?? 'linear').trim();
  if (e === 'linear' || e === '') return (x) => x;
  const k = KEYWORDS[e];
  if (k) return cubicBezier(...k);
  const m = /^cubic-bezier\(([^)]+)\)$/.exec(e);
  if (!m) return null;
  const n = m[1]!.split(',').map(Number);
  return n.length === 4 && n.every(Number.isFinite) ? cubicBezier(n[0]!, n[1]!, n[2]!, n[3]!) : null;
}

const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;

/**
 * `easing` resampled as a staircase at `hz` (effect-level easing), or null when no
 * quantization is needed/possible. `linear` over a whole number of periods becomes
 * `steps(n, end)` (works everywhere); other easings need CSS `linear()` (Chromium 113+).
 */
export function quantizedEasing(easing: string, durationMs: number, hz: number, linearSupported: boolean): string | null {
  if (hz >= 60 || !(durationMs > 0)) return null;
  const n = durationMs / (1000 / hz);
  const steps = Math.ceil(n - 1e-6);
  if (steps < 2) return null;
  const e = easing.trim();
  if (e === 'linear' && Math.abs(n - Math.round(n)) < 1e-6) return `steps(${steps}, end)`;
  if (!linearSupported || steps > 360) return null;
  const f = easingFunction(e);
  if (!f) return null;
  const pts: string[] = [];
  for (let k = 0; k < steps; k++) {
    const x0 = k / n;
    const x1 = Math.min(1, (k + 1) / n);
    const y = r4(f(x0));
    pts.push(`${y} ${r4(x0 * 100)}%`, `${y} ${r4(x1 * 100)}%`);
  }
  pts.push('1 100%');
  return `linear(${pts.join(', ')})`;
}

// ---------------------------------------------------------------------------------------------
// Value interpolation
// ---------------------------------------------------------------------------------------------

type Num = { v: number; u: string };
type Fn = { name: string; args: Num[] };

const NUM = /^\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)\s*$/i;

function parseNum(s: string): Num | null {
  const m = NUM.exec(s);
  return m ? { v: Number(m[1]), u: m[2]!.toLowerCase() } : null;
}

/** `translate(10px, 5%) rotate(3deg)` → functions; `none` → []; null when unparseable. */
function parseTransform(s: string): Fn[] | null {
  const t = s.trim();
  if (t === 'none') return [];
  const out: Fn[] = [];
  const re = /([a-zA-Z0-9]+)\(([^)]*)\)/g;
  let rest = t;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const name = m[1]!;
    if (/^(matrix|matrix3d|rotate3d|perspective)$/i.test(name)) return null;
    const args = m[2]!.split(/\s*,\s*|\s+/).filter(Boolean).map(parseNum);
    if (args.some((a) => !a)) return null;
    out.push({ name, args: args as Num[] });
    rest = rest.replace(m[0], '');
  }
  return rest.trim() ? null : out;
}

function identityFn(f: Fn): Fn {
  const one = /^scale/i.test(f.name);
  return { name: f.name, args: f.args.map((a) => ({ v: one ? 1 : 0, u: one ? '' : a.u })) };
}

/** Expand single-argument `scale(a)` / `translate(a)` so they match their two-argument forms. */
function expand(f: Fn, argc: number): Fn {
  if (f.args.length === argc) return f;
  if (f.args.length === 1 && argc === 2) {
    if (f.name === 'scale') return { name: f.name, args: [f.args[0]!, f.args[0]!] };
    if (f.name === 'translate') return { name: f.name, args: [f.args[0]!, { v: 0, u: f.args[0]!.u }] };
  }
  return f;
}

function lerpNum(a: Num, b: Num, t: number): Num | null {
  let ua = a.u;
  let ub = b.u;
  if (ua !== ub) {
    // A unitless zero takes the other side's unit (`translate(0,0)` ↔ `translate(4px,2px)`).
    if (a.v === 0 && ua === '') ua = ub;
    else if (b.v === 0 && ub === '') ub = ua;
    if (ua !== ub) return null;
  }
  return { v: a.v + (b.v - a.v) * t, u: ua };
}

const fmt = (n: Num): string => `${r4(n.v)}${n.u}`;

type Interp = (t: number) => string | number;

function transformInterp(a: string, b: string): Interp | null {
  let fa = parseTransform(a);
  let fb = parseTransform(b);
  if (!fa || !fb) return null;
  // Pad the shorter list with identity functions when the common prefix matches (CSS rules).
  const n = Math.max(fa.length, fb.length);
  for (let i = 0; i < n; i++) {
    const x: Fn | undefined = fa[i];
    const y: Fn | undefined = fb[i];
    if (x && y) {
      if (x.name !== y.name) return null;
      continue;
    }
    if (x) fb = [...fb, identityFn(x)];
    else if (y) fa = [...fa, identityFn(y)];
  }
  const pairs: [Fn, Fn][] = [];
  for (let i = 0; i < n; i++) {
    const argc = Math.max(fa[i]!.args.length, fb[i]!.args.length);
    const x = expand(fa[i]!, argc);
    const y = expand(fb[i]!, argc);
    if (x.args.length !== y.args.length) return null;
    pairs.push([x, y]);
  }
  // Validate units once.
  for (const [x, y] of pairs) for (let k = 0; k < x.args.length; k++) if (!lerpNum(x.args[k]!, y.args[k]!, 0)) return null;
  if (!pairs.length) return () => 'none';
  return (t) => pairs.map(([x, y]) => `${x.name}(${x.args.map((arg, k) => fmt(lerpNum(arg, y.args[k]!, t)!)).join(', ')})`).join(' ');
}

function parseColor(s: string): [number, number, number, number] | null {
  const t = s.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(t);
  if (m) {
    let h = m[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number): number => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = /^rgba?\(([^)]+)\)$/.exec(t);
  if (m) {
    const p = m[1]!.split(/\s*[,/]\s*|\s+/).filter(Boolean).map(Number);
    if ((p.length === 3 || p.length === 4) && p.every(Number.isFinite)) return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
  }
  return null;
}

function colorInterp(a: string, b: string): Interp | null {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return null;
  return (t) => {
    // Premultiplied sRGB, as CSS interpolates legacy colors.
    const al = x[3] + (y[3] - x[3]) * t;
    if (al <= 0) return 'rgba(0, 0, 0, 0)';
    const c = (i: number): number => Math.round(Math.min(255, Math.max(0, (x[i]! * x[3] + (y[i]! * y[3] - x[i]! * x[3]) * t) / al)));
    return `rgba(${c(0)}, ${c(1)}, ${c(2)}, ${r4(Math.min(1, Math.max(0, al)))})`;
  };
}

/** An interpolator between two keyframe values of `prop`, or null if we cannot interpolate. */
export function interpolator(prop: string, a: unknown, b: unknown): Interp | null {
  if (typeof a === 'number' && typeof b === 'number') return (t) => r4(a + (b - a) * t);
  const sa = String(a).trim();
  const sb = String(b).trim();
  if (sa === sb) return () => sa;
  if (prop === 'transform') return transformInterp(sa, sb);
  if (/color$/i.test(prop) || prop === 'fill' || prop === 'stroke') {
    const c = colorInterp(sa, sb);
    if (c) return c;
  }
  // Space-separated lists of numbers/lengths (opacity, `scale: '0.6'`, `translate: '0 4px'`, …).
  const pa = sa.split(/\s+/).map(parseNum);
  const pb = sb.split(/\s+/).map(parseNum);
  if (pa.length !== pb.length || pa.some((x) => !x) || pb.some((x) => !x)) return null;
  for (let i = 0; i < pa.length; i++) if (!lerpNum(pa[i]!, pb[i]!, 0)) return null;
  return (t) => pa.map((x, i) => fmt(lerpNum(x!, pb[i]!, t)!)).join(' ');
}

// ---------------------------------------------------------------------------------------------
// Keyframe staircase
// ---------------------------------------------------------------------------------------------

const META = new Set(['offset', 'easing', 'composite', 'computedOffset']);

interface Segment {
  from: number;
  to: number;
  ease: Ease;
  props: Map<string, Interp>;
}

/**
 * Sample `keyframes` (with effect `easing`) every 1000/hz ms over `durationMs` and return
 * step-end keyframes that reproduce the eased curve as a staircase, or null when the keyframes
 * use something we cannot evaluate (non-array form, implicit start/end values, unknown easing
 * or value syntax, non-replace composite). `durationMs` should be a whole number of periods.
 */
export function stepKeyframes(keyframes: Keyframe[] | PropertyIndexedKeyframes, easing: string, durationMs: number, hz: number): Keyframe[] | null {
  if (hz >= 60 || !Array.isArray(keyframes) || keyframes.length < 2) return null;
  const n = Math.round(durationMs / (1000 / hz));
  if (n < 2 || n > 600) return null;
  const effectEase = easingFunction(easing);
  if (!effectEase) return null;
  // Computed offsets (first 0, last 1, missing ones spaced evenly between known ones).
  const offs: (number | null)[] = keyframes.map((k) => (typeof k.offset === 'number' ? k.offset : null));
  if (offs[0] === null) offs[0] = 0;
  if (offs[offs.length - 1] === null) offs[offs.length - 1] = 1;
  for (let i = 1; i < offs.length; i++) {
    if (offs[i] !== null) continue;
    let j = i;
    while (offs[j] === null) j++;
    const a = offs[i - 1]!;
    const b = offs[j]!;
    for (let k = i; k < j; k++) offs[k] = a + ((b - a) * (k - i + 1)) / (j - i + 1);
  }
  const props = new Set<string>();
  for (const k of keyframes) {
    if (k.composite && k.composite !== 'replace' && k.composite !== 'auto') return null;
    for (const p of Object.keys(k)) if (!META.has(p)) props.add(p);
  }
  if (!props.size) return null;
  // Per property: the keyframes that specify it; it must be set at offsets 0 and 1 (no
  // implicit underlying value, which only the browser knows).
  const segsByProp = new Map<string, Segment[]>();
  for (const p of props) {
    const idx = keyframes.map((k, i) => (p in k && (k as Record<string, unknown>)[p] !== undefined ? i : -1)).filter((i) => i >= 0);
    if (!idx.length || offs[idx[0]!] !== 0 || offs[idx[idx.length - 1]!] !== 1) return null;
    const segs: Segment[] = [];
    for (let s = 0; s + 1 < idx.length; s++) {
      const a = keyframes[idx[s]!]!;
      const b = keyframes[idx[s + 1]!]!;
      const ease = easingFunction(typeof a.easing === 'string' ? a.easing : 'linear');
      const f = interpolator(p, (a as Record<string, unknown>)[p], (b as Record<string, unknown>)[p]);
      if (!ease || !f) return null;
      segs.push({ from: offs[idx[s]!]!, to: offs[idx[s + 1]!]!, ease, props: new Map([[p, f]]) });
    }
    if (!segs.length) return null;
    segsByProp.set(p, segs);
  }
  const valueAt = (p: string, progress: number): string | number => {
    const segs = segsByProp.get(p)!;
    // Overshoot (progress < 0 or > 1) extrapolates the first / last segment, as CSS does.
    let seg = segs[0]!;
    for (const s of segs) {
      if (progress >= s.from) seg = s;
      if (progress < s.to) break;
    }
    const span = seg.to - seg.from;
    const local = span > 0 ? (progress - seg.from) / span : 1;
    return seg.props.get(p)!(seg.ease(local));
  };
  const out: Keyframe[] = [];
  for (let k = 0; k <= n; k++) {
    const x = k / n;
    const progress = k === n ? 1 : effectEase(x);
    const kf: Keyframe = { offset: r4(x) };
    if (k < n) kf.easing = 'step-end';
    for (const p of props) (kf as Record<string, unknown>)[p] = valueAt(p, progress);
    out.push(kf);
  }
  out[out.length - 1]!.offset = 1;
  return out;
}
