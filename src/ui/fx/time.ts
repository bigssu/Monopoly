/**
 * Animation clock shared by every game-screen animation.
 *
 * - `setAnimSpeed(x)`: global multiplier (1 = normal, 2 = twice as fast, 0 = instant).
 * - `skip()`: accelerates everything currently running or queued in this batch (×5),
 *   without breaking the sequence. `endSkip()` restores normal speed.
 * - `prefers-reduced-motion` → instant.
 *
 * Frame budget (battery saver, docs/PERFORMANCE.md): `setFrameRate(30)` makes the game produce
 * ~30 distinct frames per second instead of 60, roughly halving CPU/GPU work:
 * - JS-driven animation registers with `onFrame(fn)`: ONE requestAnimationFrame loop that only
 *   ticks every 1000/hz ms and stops itself as soon as nothing is registered (zero idle cost).
 * - `anim()` (Web Animations) quantizes the eased curve into a 30 Hz staircase
 *   (`steps()` / `linear()` easing), so the compositor only commits ~30 value changes per second;
 *   `{ smooth: true }` opts out (e.g. the stage rotation).
 * - CSS keyframe animations are quantized the same way when they start
 *   (`installCssAnimationQuantizer()`).
 */
let speed = 1;
let skipping = false;
const SKIP_RATE = 5;

const reducedQuery =
  typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

export function setAnimSpeed(x: number): void {
  speed = Math.max(0, x);
}

export function animSpeed(): number {
  return speed;
}

/** True when animations should be skipped entirely. */
export function instant(): boolean {
  return speed === 0 || !!reducedQuery?.matches;
}

function rate(): number {
  return speed * (skipping ? SKIP_RATE : 1);
}

/** Scaled duration in ms (0 when instant). */
export function D(ms: number): number {
  if (instant()) return 0;
  return ms / rate();
}

interface Sleeper {
  id: ReturnType<typeof setTimeout>;
  end: number;
  resolve: () => void;
  /** Unregisters the grid-frame wait (frame budget), if armed. */
  stopTick: (() => void) | null;
}
const sleepers = new Set<Sleeper>();
const running = new Set<Animation>();

function wake(s: Sleeper): void {
  if (!sleepers.delete(s)) return;
  s.stopTick?.();
  s.stopTick = null;
  s.resolve();
}

/**
 * Arm a sleeper to fire `left` ms from now. With a frame budget the wake-up is moved onto the
 * nearest grid frame (inside the shared clock's rAF), so whatever the awaiting code changes is
 * drawn in a budgeted frame instead of an extra one in between.
 */
function arm(s: Sleeper, left: number): void {
  clearTimeout(s.id);
  s.stopTick?.();
  s.stopTick = null;
  if (fps >= 60 || skipping) {
    s.id = setTimeout(() => wake(s), left);
    return;
  }
  const p = 1000 / fps;
  s.id = setTimeout(() => {
    s.stopTick = onFrame((now) => {
      if (now < s.end - p / 2) return true;
      wake(s);
      return false;
    });
  }, Math.max(0, left - p));
}

/** Awaitable delay that honours speed, skip and the frame budget. */
export function sleep(ms: number): Promise<void> {
  const d = D(ms);
  if (d <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const s: Sleeper = { id: 0 as unknown as ReturnType<typeof setTimeout>, end: performance.now() + d, resolve, stopTick: null };
    sleepers.add(s);
    arm(s, d);
  });
}

/**
 * `setTimeout` whose callback runs in a budgeted grid frame (plain timeout at 60 Hz).
 * Returns a cancel function.
 */
export function gridTimeout(fn: () => void, ms: number): () => void {
  let stop: (() => void) | null = null;
  const id = setTimeout(() => {
    if (fps >= 60) {
      fn();
      return;
    }
    stop = onFrame(() => {
      stop = null;
      fn();
      return false;
    });
  }, ms);
  return () => {
    clearTimeout(id);
    stop?.();
  };
}

export type AnimOptions = KeyframeAnimationOptions & {
  duration: number;
  /** Keep this animation at the display rate even when the frame budget is 30 Hz. */
  smooth?: boolean;
};

/** Animate with the Web Animations API; resolves when finished (or cancelled). */
export function anim(el: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes, opts: AnimOptions): Promise<void> {
  if (instant() || typeof (el as HTMLElement).animate !== 'function') return Promise.resolve();
  const { smooth, ...timing } = opts;
  let duration = opts.duration / speed;
  const easing = String(opts.easing ?? 'linear');
  // Budgeted animations last a whole number of frame periods, so (start aligned) they also end on
  // the grid and the code awaiting them updates the DOM in a budgeted frame.
  if (!smooth && fps < 60) duration = Math.max(2, Math.round(duration / (1000 / fps))) * (1000 / fps);
  const q = smooth ? null : quantizedEasing(easing, duration);
  const a = el.animate(keyframes, { ...timing, duration, easing: q ?? easing });
  if (smooth) smoothSet.add(a);
  else {
    originalEasing.set(a, easing);
    if (q) alignToGrid(a);
  }
  if (skipping) a.playbackRate = SKIP_RATE;
  running.add(a);
  return a.finished.then(
    () => {
      running.delete(a);
    },
    () => {
      running.delete(a);
    },
  );
}

/** Speed up everything in flight (a "skip" tap). */
export function skip(): void {
  if (skipping) return;
  skipping = true;
  for (const a of running) a.playbackRate = SKIP_RATE;
  const now = performance.now();
  for (const s of [...sleepers]) {
    const left = Math.max(0, (s.end - now) / SKIP_RATE);
    s.end = now + left;
    arm(s, left);
  }
}

export function endSkip(): void {
  skipping = false;
}

export function isSkipping(): boolean {
  return skipping;
}

/** Cancel all timers/animations (screen unmount). Pending sleeps resolve immediately. */
export function flushAll(): void {
  for (const s of [...sleepers]) {
    clearTimeout(s.id);
    wake(s);
  }
  sleepers.clear();
  for (const a of [...running]) a.cancel();
  running.clear();
  skipping = false;
}

/** Next animation frame (resolves immediately when instant). */
export function frame(): Promise<void> {
  if (instant()) return Promise.resolve();
  return new Promise((r) => requestAnimationFrame(() => r()));
}

// ---------------------------------------------------------------------------
// Frame budget: one on-demand clock + quantized easing
// ---------------------------------------------------------------------------

export type FrameRate = 30 | 60;
let fps: FrameRate = 30;

/** Target rate of distinct animation frames (30 = battery saver, the default). */
export function setFrameRate(hz: FrameRate): void {
  if (hz === fps) return;
  fps = hz;
  requantizeAll();
}

export function frameRate(): FrameRate {
  return fps;
}

/** A JS-driven animation step; return `false` to unregister. */
export type FrameTick = (now: number) => boolean | void;
const ticks = new Set<FrameTick>();
let clockRaf = 0;
let lastTick = -Infinity;

function clockLoop(now: number): void {
  clockRaf = 0;
  if (!ticks.size) return;
  // Update once per period of the target rate, on the same global grid the quantized Web/CSS
  // animations step on, so every change of a frame lands in the same vsync.
  const slot = Math.floor(now / (1000 / fps));
  if (fps >= 60 || skipping || slot !== lastTick) {
    lastTick = slot;
    for (const fn of [...ticks]) {
      let keep: boolean | void;
      try {
        keep = fn(now);
      } catch (e) {
        keep = false;
        console.error('[clock]', e);
      }
      if (keep === false) ticks.delete(fn);
    }
  }
  if (ticks.size) clockRaf = requestAnimationFrame(clockLoop);
}

/**
 * Register a JS animation step on the shared clock. The single rAF loop runs only while at least
 * one step is registered. Returns an unregister function.
 */
export function onFrame(fn: FrameTick): () => void {
  ticks.add(fn);
  if (!clockRaf && typeof requestAnimationFrame === 'function') clockRaf = requestAnimationFrame(clockLoop);
  return () => {
    ticks.delete(fn);
    if (!ticks.size && clockRaf) {
      cancelAnimationFrame(clockRaf);
      clockRaf = 0;
    }
  };
}

/** Number of registered JS animation steps (tests / perf checks). */
export function activeFrameTicks(): number {
  return ticks.size;
}

const smoothSet = new WeakSet<Animation>();
const originalEasing = new WeakMap<Animation, string>();
const supportsLinearEasing =
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('animation-timing-function', 'linear(0, 1)');

function cubic(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const bez = (t: number, a: number, b: number): number => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
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

function easingFunction(easing: string): ((x: number) => number) | null {
  const e = easing.trim();
  if (e === 'linear') return (x) => x;
  const k = KEYWORDS[e];
  if (k) return cubic(...k);
  const m = /^cubic-bezier\(([^)]+)\)$/.exec(e);
  if (!m) return null;
  const n = m[1]!.split(',').map(Number);
  return n.length === 4 && n.every(Number.isFinite) ? cubic(n[0]!, n[1]!, n[2]!, n[3]!) : null;
}

const r4 = (x: number): string => String(Math.round(x * 1e4) / 1e4);

/**
 * `easing` resampled as a staircase at `hz`: the value is held for one frame period (1000/hz ms of
 * active time) and then jumps, or null when no quantization is needed (60 Hz, shorter than two
 * periods, or an easing we do not understand). Step boundaries fall at multiples of the period
 * from the start of the active interval (see `alignToGrid`).
 */
export function quantizedEasing(easing: string, durationMs: number, hz: number = fps): string | null {
  if (hz >= 60 || !(durationMs > 0)) return null;
  const n = durationMs / (1000 / hz);
  const steps = Math.ceil(n - 1e-6);
  if (steps < 2) return null;
  const e = easing.trim();
  if (e === 'linear' && Math.abs(n - Math.round(n)) < 1e-6) return `steps(${steps}, end)`;
  if (!supportsLinearEasing || steps > 360) return null;
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

/**
 * Shift a quantized animation's start (by less than one period) so its active interval begins on
 * the global frame grid: then all animations — and the `onFrame` clock — change values in the
 * same vsyncs, and the compositor presents ~hz distinct frames instead of interleaving them.
 */
function alignToGrid(a: Animation): void {
  if (fps >= 60 || a.playbackRate !== 1 || typeof document === 'undefined') return;
  const now = document.timeline?.currentTime;
  const t = typeof now === 'number' ? now : null;
  const start = typeof a.startTime === 'number' ? a.startTime : t;
  if (start === null) return;
  const delay = a.effect?.getTiming().delay ?? 0;
  const p = 1000 / fps;
  const aligned = Math.floor((start + delay) / p) * p - delay;
  if (Math.abs(aligned - start) > 0.01) {
    try {
      a.startTime = aligned;
    } catch {
      /* not settable in this state */
    }
  }
}

function quantize(a: Animation): void {
  const effect = a.effect;
  if (!effect || smoothSet.has(a)) return;
  const timing = effect.getTiming();
  if (!originalEasing.has(a)) originalEasing.set(a, String(timing.easing ?? 'linear'));
  const base = originalEasing.get(a)!;
  const dur = typeof timing.duration === 'number' ? timing.duration : 0;
  const next = quantizedEasing(base, dur) ?? base;
  if (next !== timing.easing) effect.updateTiming({ easing: next });
  if (next !== base) alignToGrid(a);
}

function requantizeAll(): void {
  if (typeof document === 'undefined' || typeof document.getAnimations !== 'function') return;
  for (const a of document.getAnimations()) quantize(a);
}

let cssQuantizer = false;
/**
 * Quantize CSS animations and transitions as they start (their per-keyframe timing function is
 * kept; only the iteration clock is stepped at the frame budget, on the global grid). Idempotent.
 */
export function installCssAnimationQuantizer(): void {
  if (cssQuantizer || typeof document === 'undefined' || typeof document.getAnimations !== 'function') return;
  cssQuantizer = true;
  let queued = false;
  const sweep = (): void => {
    if (queued || fps >= 60) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      for (const a of document.getAnimations()) if (!originalEasing.has(a) && !smoothSet.has(a)) quantize(a);
    });
  };
  document.addEventListener('animationstart', sweep, { capture: true, passive: true });
  document.addEventListener('transitionstart', sweep, { capture: true, passive: true });
}
