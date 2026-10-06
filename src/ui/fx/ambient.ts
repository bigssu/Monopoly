/**
 * "Calm" rule for perpetual decorative CSS animations (docs/PERFORMANCE.md, criterion B).
 *
 * Every stylesheet animation declared `infinite` (title floaties / blobs / rays / logo, the turn
 * glow, the roll-button pulse, board pick rings, the rules illustrations, …) is limited, when it
 * starts, to an iteration count that ends ~`CALM_MS` after the last user input. Short loops finish on
 * an iteration boundary (= their resting pose, so nothing jumps); slow drifts (> 4 s per loop:
 * rays, floaties) stop exactly then and hold their pose (`fill: forwards`). The page then goes
 * fully idle: no compositor frames, no main-thread work, no timers. The next
 * pointerdown / keydown extends every such animation again (finished ones resume where they
 * stopped). No timer is involved: the iteration count alone ends them.
 *
 * Functional loops that the code stops itself (the dice shake while the roll button is held) are
 * left alone.
 */

/** How long decorative loops keep running after the last input (or after they start). */
const CALM_MS = 10_000;

/** Infinite animations that are functional (ended by code), not decorative. */
const EXEMPT = new Set(['lr-shake']);

const tracked = new Set<CSSAnimation>();
let lastInput = -Infinity;
let installed = false;

/** Loops longer than this stop mid-iteration (holding their pose) instead of on a boundary. */
const LONG_LOOP_MS = 4000;

/**
 * Iteration count that makes `a` end CALM_MS from now: on an iteration boundary for short loops
 * (their resting pose), or exactly then for slow drifts (rays, floaties), which hold their pose.
 */
function iterationsFor(a: Animation, until: number): { n: number; hold: boolean } | null {
  const effect = a.effect;
  if (!effect) return null;
  const timing = effect.getTiming();
  const ct = effect.getComputedTiming();
  const dur = typeof ct.duration === 'number' ? ct.duration : Number(timing.duration);
  if (!(dur > 0)) return null;
  const local = typeof ct.localTime === 'number' ? ct.localTime : 0;
  const delay = timing.delay ?? 0;
  // Active time we want to reach: now + remaining calm window.
  const want = Math.max(0, local - delay) + Math.max(0, until - performance.now());
  if (dur > LONG_LOOP_MS) return { n: Math.max(0.01, Math.round((want / dur) * 1e4) / 1e4), hold: true };
  let n = Math.max(1, Math.ceil(want / dur - 1e-6));
  // Alternating loops rest at their start pose only after an even number of iterations.
  const dir = timing.direction ?? 'normal';
  if ((dir === 'alternate' || dir === 'alternate-reverse') && n % 2) n += 1;
  return { n, hold: false };
}

function limit(a: CSSAnimation, until: number): void {
  const it = iterationsFor(a, until);
  if (!it) return;
  const effect = a.effect!;
  if (effect.getTiming().iterations === it.n) return;
  const finished = a.playState === 'finished';
  const t = a.currentTime;
  effect.updateTiming(it.hold ? { iterations: it.n, fill: 'forwards' } : { iterations: it.n });
  // A finished animation keeps its start time; re-seek so it resumes where it rested instead of
  // jumping to where it would be had it never stopped.
  if (finished && t !== null) a.currentTime = t;
}

function isAmbient(a: Animation): a is CSSAnimation {
  return (
    typeof CSSAnimation !== 'undefined' &&
    a instanceof CSSAnimation &&
    !EXEMPT.has(a.animationName) &&
    // Infinite in the stylesheet, or already limited by us.
    (a.effect?.getTiming().iterations === Infinity || tracked.has(a))
  );
}

function prune(): void {
  for (const a of tracked) {
    const target = (a.effect as KeyframeEffect | null)?.target;
    if (a.playState === 'idle' || !target?.isConnected) tracked.delete(a);
  }
}

/** Limit newly started infinite CSS animations (called on `animationstart`, batched). */
function sweep(): void {
  if (typeof document.getAnimations !== 'function') return;
  const until = Math.max(lastInput, performance.now()) + CALM_MS;
  for (const a of document.getAnimations()) {
    if (tracked.has(a as CSSAnimation) || !isAmbient(a)) continue;
    tracked.add(a);
    // Started after the last input: gets its own CALM_MS from now.
    limit(a, Math.max(until, performance.now() + CALM_MS));
  }
}

/** User input: keep every decorative loop going for another CALM_MS. */
function wake(): void {
  const now = performance.now();
  // Coalesce bursts (pointerdown + keydown + repeated taps).
  if (now - lastInput < 1000) return;
  lastInput = now;
  prune();
  for (const a of tracked) limit(a, now + CALM_MS);
}

export function installAmbientCalm(): void {
  if (installed || typeof document === 'undefined' || typeof document.getAnimations !== 'function') return;
  installed = true;
  let queued = false;
  document.addEventListener(
    'animationstart',
    () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        prune();
        sweep();
      });
    },
    { capture: true, passive: true },
  );
  window.addEventListener('pointerdown', wake, { capture: true, passive: true });
  window.addEventListener('keydown', wake, { capture: true, passive: true });
}

/** Number of decorative loops still running (tests / perf checks). */
export function runningAmbient(): number {
  prune();
  let n = 0;
  for (const a of tracked) if (a.playState === 'running') n++;
  return n;
}
