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
 * - `anim()` (Web Animations) samples the eased curve every 1000/hz ms and animates the samples as
 *   `step-end` keyframes (see `quantize.ts`), so the browser/compositor changes the value only
 *   ~30 times per second, on one global time grid shared by every animation and by `onFrame`;
 *   `{ smooth: true }` opts out (e.g. the stage rotation).
 * - CSS animations/transitions from the stylesheets are quantized when they start
 *   (`installCssAnimationQuantizer()`, on animationstart/transitionstart): `steps(n)` effect
 *   timing on the same grid.
 * - `setFrameRate(60)` restores every running animation to its original keyframes/timing.
 */
import { EASE } from './motion';
import { quantizedEasing, stepKeyframes } from './quantize';

let speed = 1;
let skipping = false;
const SKIP_RATE = 5;

/**
 * Dev/test only: a hand-driven clock (`setManualClock(true)` + `stepClock(n)`), so an e2e test
 * can screenshot the real game every N frames (in-game VFX filmstrips). While on, no rAF runs:
 * `onFrame` steps, sleeps, grid timeouts and `anim()` Web Animations (paused, advanced by
 * `currentTime`) all move only on `stepClock`. Stylesheet animations keep real time.
 */
let manual: { now: number } | null = null;
const manualAnims = new Set<Animation>();

/** Clock time (ms): `performance.now()`, or the manual clock's. */
function clockNow(): number {
  return manual ? manual.now : performance.now();
}

const reducedQuery =
  typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

export function setAnimSpeed(x: number): void {
  speed = Math.max(0, x);
}

export function animSpeed(): number {
  return speed;
}

/**
 * Game pace (Settings "게임 속도"): stretches the *holds* — `sleep()`, the reading time between
 * events, toasts, notices and the CPU's think delay — but not motion (`anim`, dice, VFX).
 * 1 = the original pace, 2 = holds twice as long.
 */
let pace = 1;
export function setPace(x: number): void {
  pace = Math.max(0.1, x);
}
export function gamePace(): number {
  return pace;
}

/**
 * Pause after a turn ends, before the next player (Settings "턴 사이 쉬는 시간"), in ms. A fixed
 * rest so players register what just happened (Pixar "timing"); honours speed/skip, not pace.
 */
let turnRestMs = 0;
export function setTurnRest(ms: number): void {
  turnRestMs = Math.max(0, ms);
}
export function turnRest(): Promise<void> {
  return sleep(turnRestMs / pace);
}

let reducedSetting = false;
/** App setting "reduce animations" (prefs). */
export function setReducedMotion(on: boolean): void {
  reducedSetting = on;
}
/**
 * prefers-reduced-motion or the app setting: no canvas FX (static highlight + sound, docs/VFX.md
 * §8.3). Separate from `instant()`, which also covers speed 0 (tests: nothing at all).
 */
export function reducedMotion(): boolean {
  return reducedSetting || !!reducedQuery?.matches;
}

/** True when animations should be skipped entirely. */
export function instant(): boolean {
  return speed === 0 || reducedMotion();
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
  if (manual) {
    s.stopTick = onFrame((now) => {
      if (now < s.end - 0.5) return true;
      wake(s);
      return false;
    });
    return;
  }
  if (fps >= 60 || skipping) {
    s.id = setTimeout(() => wake(s), left);
    return;
  }
  const p = period();
  s.id = setTimeout(() => {
    s.stopTick = onFrame((now) => {
      if (now < s.end - p / 2) return true;
      wake(s);
      return false;
    });
  }, Math.max(0, left - p));
}

/**
 * Choreography wait: lines one animation up with another (a glint at a card's flip apex), so it
 * honours speed/skip but NOT the game pace — pacing beats use `sleep`.
 */
export function wait(ms: number): Promise<void> {
  return sleep(ms / pace);
}

/** Awaitable hold that honours pace, speed, skip and the frame budget. */
export function sleep(ms: number): Promise<void> {
  // Not `D()`: under reduced motion the motion is gone but the beat stays, so a turn still reads.
  const d = speed === 0 ? 0 : (ms * pace) / rate();
  if (d <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const s: Sleeper = { id: 0 as unknown as ReturnType<typeof setTimeout>, end: clockNow() + d, resolve, stopTick: null };
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
  if (manual) {
    const end = manual.now + ms;
    stop = onFrame((now) => {
      if (now < end - 0.5) return true;
      stop = null;
      fn();
      return false;
    });
    return () => stop?.();
  }
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
  // Default: slow-out to rest (motion.ts EASE.settle); pass 'linear' explicitly when wanted.
  const easing = String(opts.easing ?? EASE.settle);
  let duration = opts.duration / speed;
  let a: Animation;
  if (smooth) {
    a = el.animate(keyframes, { ...timing, duration });
    smoothSet.add(a);
  } else {
    // Budgeted animations last a whole number of frame periods, so (start aligned) they also end
    // on the grid and the code awaiting them updates the DOM in a budgeted frame.
    if (fps < 60) duration = Math.max(2, Math.round(duration / period())) * period();
    const stepped = stepKeyframes(keyframes, easing, duration, fps);
    const q = stepped ? null : quantizedEasing(easing, duration, fps, supportsLinearEasing);
    a = el.animate(stepped ?? keyframes, { ...timing, duration, easing: stepped ? 'linear' : (q ?? easing) });
    originals.set(a, { keyframes, easing, duration: opts.duration / speed, waapi: true });
    if ((stepped || q) && !manual) alignToGrid(a);
  }
  if (skipping) a.playbackRate = SKIP_RATE;
  if (manual) {
    a.pause();
    a.currentTime = 0;
    manualAnims.add(a);
  }
  running.add(a);
  return a.finished.then(
    () => {
      running.delete(a);
      manualAnims.delete(a);
    },
    () => {
      running.delete(a);
      manualAnims.delete(a);
    },
  );
}

/** Speed up everything in flight (a "skip" tap). */
export function skip(): void {
  if (skipping) return;
  skipping = true;
  for (const a of running) a.playbackRate = SKIP_RATE;
  const now = clockNow();
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

/** Next budgeted frame (resolves immediately when instant). */
export function frame(): Promise<void> {
  if (instant()) return Promise.resolve();
  return new Promise((r) =>
    onFrame(() => {
      r();
      return false;
    }),
  );
}

// ---------------------------------------------------------------------------
// Frame budget: one on-demand clock + quantized animations on a shared grid
// ---------------------------------------------------------------------------

export type FrameRate = 30 | 60;
let fps: FrameRate = 30;

/** Length of one budgeted frame in ms. */
function period(): number {
  return 1000 / fps;
}

/**
 * The frame grid is `gridOffset + k * period()` on the document timeline (= rAF time). The
 * offset is phase-locked to the display so that grid lines fall halfway between two vsyncs:
 * then every quantized animation (compositor or main thread) and every `onFrame` tick change
 * values in the same vsync, with half a refresh interval of margin against timestamp jitter or
 * rounding. Re-centred from rAF timestamps whenever the display clock drifts.
 */
let gridOffset = 0;
let calibrated = false;

/** Index of the grid slot containing time `t`. */
function slotOf(t: number): number {
  return Math.floor((t - gridOffset) / period());
}

/** Keep `now` (a vsync timestamp) mid-way between grid lines; realign animations if moved. */
function lockPhase(now: number): void {
  const p = period();
  const phase = (((now - gridOffset) % p) + p) % p;
  // Distance to the nearest ideal position (v/2 + j*v inside the slot).
  const j = Math.floor(phase / vsync);
  const err = phase - (j + 0.5) * vsync;
  if (calibrated && Math.abs(err) < vsync * 0.25) return;
  gridOffset = (((gridOffset + err) % p) + p) % p;
  if (calibrated) realignAll();
  calibrated = true;
}

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
let lastSlot = -Infinity;
let lastNow = -Infinity;
/** Display refresh interval, estimated from consecutive rAF timestamps. */
let vsync = 1000 / 60;
/** The loop was idle before this callback (its first frame may fall anywhere in a slot). */
let fresh = true;

let inLoop = false;

function schedule(): void {
  if (manual || clockRaf || inLoop || typeof requestAnimationFrame !== 'function') return;
  clockRaf = requestAnimationFrame(clockLoop);
}

function clockLoop(now: number): void {
  clockRaf = 0;
  if (!ticks.size) {
    fresh = true;
    return;
  }
  const dt = now - lastNow;
  if (!fresh && dt > 3 && dt < vsync * 1.5) vsync += (dt - vsync) * 0.2;
  lastNow = now;
  if (fps < 60) lockPhase(now);
  const p = period();
  const slot = slotOf(now);
  // Compositor-side stepped animations change value at the first vsync after each grid line.
  // Run JS updates in that same vsync: after a fresh start, wait for a slot's first vsync.
  // A frame that is not the first vsync of its slot (the main thread missed that vsync, or the
  // loop just started) waits for the next slot's first vsync: running there would present an
  // extra frame between two grid frames. After a whole missed slot it runs anyway (no stall).
  let due: boolean;
  const firstVsync = now - gridOffset - slot * p < vsync;
  if (fps >= 60 || skipping) due = true;
  else if (slot === lastSlot) due = false;
  else due = firstVsync || (!fresh && slot - lastSlot >= 2);
  fresh = false;
  if (due) {
    lastSlot = slot;
    inLoop = true;
    try {
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
    } finally {
      inLoop = false;
    }
  }
  if (ticks.size) schedule();
  else fresh = true;
}

/**
 * Register a JS animation step on the shared clock (called once per budgeted frame, on the same
 * grid as the quantized animations). The single rAF loop runs only while at least one step is
 * registered. Returns an unregister function.
 */
export function onFrame(fn: FrameTick): () => void {
  ticks.add(fn);
  schedule();
  return () => {
    ticks.delete(fn);
    if (!ticks.size && clockRaf) {
      cancelAnimationFrame(clockRaf);
      clockRaf = 0;
      fresh = true;
    }
  };
}

/** The hand-driven clock is on (dev/test). */
export function isManualClock(): boolean {
  return !!manual;
}

/** Dev/test: switch the hand-driven clock on / off (see `manual`). */
export function setManualClock(on: boolean): void {
  if (on === !!manual) return;
  if (on) {
    manual = { now: performance.now() };
    if (clockRaf) cancelAnimationFrame(clockRaf);
    clockRaf = 0;
    // Pending real-time sleepers move onto the manual clock.
    const t = performance.now();
    for (const s of [...sleepers]) arm(s, Math.max(0, s.end - t));
    return;
  }
  manual = null;
  for (const a of [...manualAnims]) a.play();
  manualAnims.clear();
  for (const s of [...sleepers]) arm(s, 0);
  fresh = true;
  schedule();
}

/** Dev/test: advance the manual clock by `n` frame periods (runs every due step and animation). */
export function stepClock(n = 1): void {
  if (!manual) return;
  const p = period();
  for (let k = 0; k < n; k++) {
    manual.now += p;
    for (const a of [...manualAnims]) {
      const end = a.effect?.getComputedTiming().endTime;
      const next = (Number(a.currentTime) || 0) + p * a.playbackRate;
      if (typeof end === 'number' && next >= end) {
        manualAnims.delete(a);
        a.finish();
      } else a.currentTime = next;
    }
    inLoop = true;
    try {
      for (const fn of [...ticks]) {
        let keep: boolean | void;
        try {
          keep = fn(manual.now);
        } catch (e) {
          keep = false;
          console.error('[clock]', e);
        }
        if (keep === false) ticks.delete(fn);
      }
    } finally {
      inLoop = false;
    }
  }
}

/** Frame-grid parameters (perf diagnostics: scripts/perf.mjs classifies frames as on/off grid). */
export function frameGrid(): { offset: number; period: number; vsync: number } {
  return { offset: gridOffset, period: period(), vsync };
}

/** Number of registered JS animation steps (tests / perf checks). */
export function activeFrameTicks(): number {
  return ticks.size;
}

interface Original {
  keyframes: Keyframe[] | PropertyIndexedKeyframes | null;
  easing: string;
  duration: number;
  waapi: boolean;
}
const smoothSet = new WeakSet<Animation>();
/** Unquantized timing (and keyframes for `anim()`), to switch the frame rate live. */
const originals = new WeakMap<Animation, Original>();
const supportsLinearEasing =
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('animation-timing-function', 'linear(0, 1)');

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
  const p = period();
  const aligned = slotOf(start + delay) * p + gridOffset - delay;
  if (Math.abs(aligned - start) > 0.01) {
    try {
      a.startTime = aligned;
    } catch {
      /* not settable in this state */
    }
  }
}

/** (Re)apply the current frame budget to one running animation. */
function quantize(a: Animation): void {
  const effect = a.effect as KeyframeEffect | null;
  if (!effect || smoothSet.has(a)) return;
  const timing = effect.getTiming();
  let o = originals.get(a);
  if (!o) {
    o = { keyframes: null, easing: String(timing.easing ?? 'linear'), duration: typeof timing.duration === 'number' ? timing.duration : 0, waapi: false };
    originals.set(a, o);
  }
  if (!(o.duration > 0)) return;
  if (fps >= 60) {
    if (o.keyframes && typeof effect.setKeyframes === 'function') effect.setKeyframes(o.keyframes);
    effect.updateTiming({ easing: o.easing, duration: o.duration });
    return;
  }
  const p = period();
  const duration = Math.max(2, Math.round(o.duration / p)) * p;
  const stepped = o.keyframes ? stepKeyframes(o.keyframes, o.easing, duration, fps) : null;
  if (stepped && typeof effect.setKeyframes === 'function') {
    effect.setKeyframes(stepped);
    effect.updateTiming({ easing: 'linear', duration });
  } else {
    // CSS animations keep their per-keyframe timing functions; the effect easing (linear for
    // CSS) becomes steps(n) over a whole number of periods.
    const q = quantizedEasing(o.easing, duration, fps, supportsLinearEasing);
    if (!q) return;
    effect.updateTiming({ easing: q, duration });
  }
  alignToGrid(a);
}

/** Move every quantized animation onto the current grid (after `lockPhase` re-centred it). */
function realignAll(): void {
  if (typeof document === 'undefined' || typeof document.getAnimations !== 'function') return;
  for (const a of document.getAnimations()) if (originals.has(a) && !smoothSet.has(a)) alignToGrid(a);
}

/** Calibrate the grid phase from one real frame (boot); later the clock loop keeps it locked. */
export function calibrateFrameGrid(): void {
  if (typeof requestAnimationFrame !== 'function') return;
  requestAnimationFrame((t0) =>
    requestAnimationFrame((t1) => {
      const dt = t1 - t0;
      if (dt > 3 && dt < 25) vsync = dt;
      lockPhase(t1);
    }),
  );
}

function requantizeAll(): void {
  if (typeof document === 'undefined' || typeof document.getAnimations !== 'function') return;
  for (const a of document.getAnimations()) quantize(a);
}

let cssQuantizer = false;

/** Quantize CSS animations/transitions that are not on the frame budget yet. */
function sweepCss(): void {
  if (!cssQuantizer || fps >= 60) return;
  for (const a of document.getAnimations()) if (!originals.has(a) && !smoothSet.has(a)) quantize(a);
}

/**
 * Quantize CSS animations and transitions as they start (their per-keyframe timing function is
 * kept; only the iteration clock is stepped at the frame budget, on the global grid), on their
 * start events. Their first frame is therefore unquantized; the game keeps stylesheet animations
 * rare during play (entry animations, ambient loops, a few one-shots), so this beats sweeping
 * `document.getAnimations()` after every clock frame (a forced style flush: 8-16 ms per frame at
 * 4x CPU throttle for ~1 new CSS animation per 30 frames, docs/PERFORMANCE.md). Idempotent.
 */
export function installCssAnimationQuantizer(): void {
  if (cssQuantizer || typeof document === 'undefined' || typeof document.getAnimations !== 'function') return;
  cssQuantizer = true;
  let queued = false;
  const onStart = (): void => {
    if (queued || fps >= 60) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      sweepCss();
    });
  };
  document.addEventListener('animationstart', onStart, { capture: true, passive: true });
  document.addEventListener('transitionstart', onStart, { capture: true, passive: true });
}
