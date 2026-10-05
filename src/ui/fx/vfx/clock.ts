/**
 * Clock adapter for the VFX engine. The engine only needs: a frame callback on the shared 30 Hz
 * grid (`onFrame`, returning false unregisters), the global speed multiplier, the skip state,
 * "instant" (speed 0 → no effects at all) and reduced motion (static highlight + sound only).
 *
 * `gameClock` binds it to `ui/fx/time.ts` (`reducedMotion()` = prefers-reduced-motion or the
 * in-app setting, docs/VFX-WIRING.md §2). `ManualClock` drives the engine
 * deterministically (tests, demo filmstrips).
 */
import { animSpeed, isManualClock, isSkipping, onFrame, reducedMotion } from '../time';

export type FrameFn = (now: number) => boolean | void;

export interface FxClock {
  onFrame(fn: FrameFn): () => void;
  /** Global animation speed (1 = normal). */
  speed(): number;
  /** A skip tap is accelerating the current batch (×5). */
  skipping(): boolean;
  /** Speed 0 (tests): play nothing. */
  instant(): boolean;
  /** Reduced motion (the app setting, fx/time.ts): no canvas; sound + static highlight. */
  reducedMotion(): boolean;
  /** Frames are stepped by hand (tests / filmstrips): paint synchronously on the main thread. */
  manual?(): boolean;
}

/** The game's shared 30 Hz clock (ui/fx/time.ts). */
export const gameClock: FxClock = {
  onFrame,
  speed: animSpeed,
  skipping: isSkipping,
  instant: () => animSpeed() === 0,
  reducedMotion,
  manual: isManualClock,
};

/** A clock advanced by hand: each `step()` is one 30 Hz tick (33.33 ms). */
export class ManualClock implements FxClock {
  now = 0;
  private fns = new Set<FrameFn>();
  spd = 1;
  skip = false;
  reduced = false;
  constructor(readonly period = 1000 / 30) {}
  onFrame(fn: FrameFn): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  speed(): number {
    return this.spd;
  }
  skipping(): boolean {
    return this.skip;
  }
  instant(): boolean {
    return this.spd === 0;
  }
  reducedMotion(): boolean {
    return this.reduced;
  }
  manual(): boolean {
    return true;
  }
  /** Registered frame callbacks (0 = idle). */
  get active(): number {
    return this.fns.size;
  }
  /** Run `n` ticks. */
  step(n = 1): void {
    for (let i = 0; i < n; i++) {
      this.now += this.period;
      for (const fn of [...this.fns]) if (fn(this.now) === false) this.fns.delete(fn);
    }
  }
}
