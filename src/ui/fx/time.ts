/**
 * Animation clock shared by every game-screen animation.
 *
 * - `setAnimSpeed(x)`: global multiplier (1 = normal, 2 = twice as fast, 0 = instant).
 * - `skip()`: accelerates everything currently running or queued in this batch (×5),
 *   without breaking the sequence. `endSkip()` restores normal speed.
 * - `prefers-reduced-motion` → instant.
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
}
const sleepers = new Set<Sleeper>();
const running = new Set<Animation>();

/** Awaitable delay that honours speed and skip. */
export function sleep(ms: number): Promise<void> {
  const d = D(ms);
  if (d <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const s: Sleeper = {
      id: setTimeout(() => {
        sleepers.delete(s);
        resolve();
      }, d),
      end: performance.now() + d,
      resolve,
    };
    sleepers.add(s);
  });
}

/** Animate with the Web Animations API; resolves when finished (or cancelled). */
export function anim(
  el: Element,
  keyframes: Keyframe[] | PropertyIndexedKeyframes,
  opts: KeyframeAnimationOptions & { duration: number },
): Promise<void> {
  if (instant() || typeof (el as HTMLElement).animate !== 'function') return Promise.resolve();
  const a = el.animate(keyframes, { ...opts, duration: opts.duration / speed });
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
    clearTimeout(s.id);
    const left = Math.max(0, (s.end - now) / SKIP_RATE);
    s.end = now + left;
    s.id = setTimeout(() => {
      sleepers.delete(s);
      s.resolve();
    }, left);
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
    s.resolve();
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
