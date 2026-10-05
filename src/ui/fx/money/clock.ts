/**
 * Scene clock for money events: scene time in ms (at normal speed) advanced on the shared 30 Hz
 * frame clock (`onFrame`, fx/time.ts) and nothing else, so it follows THE TIME POLICY exactly:
 *
 * - speed (`setAnimSpeed`) and a skip tap (×5) scale how fast scene time runs;
 * - paused (`setHeld`) → scene time stands still;
 * - the manual clock (`setManualClock` / `stepClock`) steps it one 33 ms frame per step;
 * - the game pace (Settings "게임 속도", 1–3, default 2) stretches a scene mildly: × sqrt(pace / 2);
 * - `factor` < 1 shortens one scene (a repeated event type in the same turn plays at 0.7×).
 *
 * The clock registers ONE frame step while something waits on it and unregisters itself when idle
 * (zero idle cost). Headless (speed 0) scenes never start a clock: they resolve at once.
 */
import { animSpeed, gamePace, isHeld, isManualClock, isSkipping, onFrame, whenRunning } from '../time';

/** One 30 fps frame (ms): research / spec beats are written in frames. */
export const FRAME = 1000 / 30;
/** `f(n)` = n frames in ms. */
export const f = (n: number): number => n * FRAME;

/** A per-frame step: `t` = scene time (ms). Return false to stop. */
export type SceneTick = (t: number) => boolean | void;

const SKIP_RATE = 5;
/** Scene time a disposed clock's steps finish at (far past any scene). */
const END_OF_TIME = Number.MAX_SAFE_INTEGER / 4;
/** Float slack (ms): n frames of 33.33… ms must reach f(n). */
const EPS = 1e-6;

/** Dev/perf: cost of the scene clock's frame steps (scripts/fx/money-perf.mjs via the demo). */
export const clockPerf = { on: false, n: 0, total: 0, max: 0, samples: [] as number[] };
export function resetClockPerf(on: boolean): void {
  clockPerf.on = on;
  clockPerf.n = clockPerf.total = clockPerf.max = 0;
  clockPerf.samples = [];
}

export class MoneyClock {
  /** Scene time (ms at normal speed). */
  t = 0;
  /** Duration multiplier of this scene (0.7 = turbo). */
  factor = 1;
  /** Frame health (render.ts MoneyHealth): JS ms of each step and real ms since the previous one. */
  monitor: ((stepMs: number, gapMs: number) => void) | null = null;
  private last = NaN;
  private stopTick: (() => void) | null = null;
  private ticks = new Set<SceneTick>();
  private waits: Array<{ at: number; resolve: () => void }> = [];
  private disposed = false;
  private resumeArmed = false;

  /** Scene-time units per real ms right now (0 while paused). */
  rate(): number {
    if (isHeld()) return 0;
    const pace = Math.sqrt(Math.max(0.5, gamePace()) / 2);
    return (animSpeed() * (isSkipping() ? SKIP_RATE : 1)) / (pace * this.factor);
  }

  /** Resolves when scene time reaches `ms` (at once when it already has). */
  until(ms: number): Promise<void> {
    // Headless (speed 0, set even mid-scene by tests): no time passes — resolve now.
    if (this.disposed || this.t >= ms - EPS || animSpeed() === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.waits.push({ at: ms, resolve });
      this.arm();
    });
  }

  /** Resolves `ms` of scene time from now. */
  after(ms: number): Promise<void> {
    return this.until(this.t + ms);
  }

  /** Run `fn` every frame (after time advanced) until it returns false or `dispose`. */
  add(fn: SceneTick): () => void {
    if (this.disposed) return () => undefined;
    this.ticks.add(fn);
    this.arm();
    return () => {
      this.ticks.delete(fn);
    };
  }

  /** Stop: every step runs once at the end of time, pending waits resolve, the frame step unregisters. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Finish what was ticking (a scene cut short by a resize, a quit or a follow-up scene): every
    // step runs once at the end of time, so tweens reach u = 1 and resolve, coins land, counts end.
    // Dropping them instead left their promises pending and the scene (and the game) hung.
    const ticks = [...this.ticks];
    this.ticks.clear();
    for (const fn of ticks) {
      try {
        fn(END_OF_TIME);
      } catch (e) {
        console.error('[money]', e);
      }
    }
    this.ticks.clear();
    const w = this.waits;
    this.waits = [];
    w.forEach((x) => x.resolve());
    this.stopTick?.();
    this.stopTick = null;
  }

  get idle(): boolean {
    return !this.stopTick;
  }

  private arm(): void {
    if (this.stopTick || this.disposed || isHeld()) {
      if (isHeld() && !this.disposed && !this.stopTick && !this.resumeArmed) {
        this.resumeArmed = true;
        void whenRunning().then(() => {
          this.resumeArmed = false;
          if (!this.disposed && (this.ticks.size || this.waits.length)) this.arm();
        });
      }
      return;
    }
    this.last = NaN;
    this.stopTick = onFrame((now) => this.step(now));
  }

  private step(now: number): boolean {
    if (this.monitor && !isManualClock()) {
      // The first step after (re)arming has no previous frame: no gap sample (pause / resume).
      const prev = this.last;
      const t0 = performance.now();
      const keep = clockPerf.on ? this.stepPerf(now) : this.stepInner(now);
      if (!Number.isNaN(prev)) this.monitor(performance.now() - t0, now - prev);
      return keep;
    }
    return clockPerf.on ? this.stepPerf(now) : this.stepInner(now);
  }

  private stepPerf(now: number): boolean {
    const t0 = performance.now();
    const keep = this.stepInner(now);
    const ms = performance.now() - t0;
    clockPerf.n++;
    clockPerf.total += ms;
    clockPerf.max = Math.max(clockPerf.max, ms);
    if (clockPerf.samples.length < 2000) clockPerf.samples.push(ms);
    return keep;
  }

  private stepInner(now: number): boolean {
    // Paused: unregister (zero cost while held) and re-arm on resume.
    if (isHeld()) {
      this.stopTick = null;
      this.arm();
      return false;
    }
    // The first step after arming advances one frame (the step itself is on the frame grid).
    const dt = Number.isNaN(this.last) ? FRAME : Math.min(100, Math.max(0, now - this.last));
    this.last = now;
    // Headless mid-scene: jump to the end of everything that is waiting.
    if (animSpeed() === 0) this.t += 1e7;
    else this.t += dt * this.rate();
    for (const fn of [...this.ticks]) {
      let keep: boolean | void;
      try {
        keep = fn(this.t);
      } catch (e) {
        keep = false;
        console.error('[money]', e);
      }
      if (keep === false) this.ticks.delete(fn);
    }
    if (this.waits.length) {
      const due = this.waits.filter((w) => w.at <= this.t + EPS);
      if (due.length) {
        this.waits = this.waits.filter((w) => w.at > this.t + EPS);
        due.forEach((w) => w.resolve());
      }
    }
    if (!this.ticks.size && !this.waits.length) {
      this.stopTick = null;
      return false;
    }
    return true;
  }
}
