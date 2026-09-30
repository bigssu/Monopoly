/**
 * VFX engine (VFX.md §3): one overlay canvas inside `.fx-layer`, driven by the shared 30 Hz clock.
 *
 * Lifecycle (zero idle cost): idle → `play()` → the canvas is shown and sized to the union of the
 * running effects' regions (≤ 0.9 MP backing, scale 0.75–1.5 capped by DPR) and ONE `onFrame` step
 * is registered → effects run → when nothing is left, a short grace (8 ticks) → canvas hidden,
 * backing store freed (width = height = 0) and the step unregisters (no rAF, no timers).
 *
 * `play()` returns a thenable that resolves at the effect's *block* frame (the sequencer goes on
 * while the tail plays); `.cue(name)` resolves at a cue frame (e.g. 'swap' to defer a DOM render),
 * `.done` at the last particle. Reduced motion creates no canvas: sound + haptic + a static
 * highlight only. An atlas load failure disables the canvas the same way (never throws).
 */
import type { PlayerId } from '@/engine';
import { PLAYER_COLORS } from '@/content/palette';
import { FX_ANIM_NAMES, FX_ANIMS } from '@/content/fx/manifest';
import type { HapticKind } from '@/ui/audio/haptics';
import type { SfxName } from '@/ui/audio/sfx';
import { loadAtlas, type FxAtlas } from './atlas';
import { gameClock, type FxClock } from './clock';
import { createCoords, type CoordSource, type RectLike } from './coords';
import { FRAME_MS, newSample, sampleParticle } from './particles';
import { PF } from './pool';
import { buildPreset, type PresetEnv, type PresetName, type PresetParams } from './presets';
import { Runner, runReduced, type Effect, type FxDom, type HighlightTarget, type Tier, type Timeline } from './timeline';
import { ACCENT_Q, BIG_WAIT_FRAMES, bigBusy, type FxMode, type FxInfo, type RunningFx } from './director';

export type FxQuality = 'high' | 'low' | 'off';

export interface FxOptions extends CoordSource {
  /** The `.fx-layer` element (the canvas is appended to it). */
  layer: HTMLElement;
  /** Player colour (hex). Default: PLAYER_COLORS by id. */
  getPlayerColor?(id: PlayerId): string;
  clock?: FxClock;
  sfx?(name: SfxName, o: { pitch?: number; gain?: number }): void;
  haptic?(kind: HapticKind): void;
  /** Screen shake of the table AND the fx layer (VFX.md §3.1). */
  shake?(px: number, ms: number): void;
  dom?: FxDom;
  /** Reduced-motion static highlight (DOM class toggle, no animation). */
  highlight?(target: HighlightTarget, ms: number): void;
  /** Atlas loader (tests / demo can inject); default loads public/fx via BASE_URL. */
  loadAtlas?(): Promise<FxAtlas | null>;
  /** Software canvas (`willReadFrequently`), default true (docs/PERFORMANCE.md). */
  softwareCanvas?: boolean;
  /** Seed of the effect RNG stream. */
  seed?: number;
  /** Register `window.__fx` (dev only). */
  dev?: boolean;
  /** Backing-store budget in pixels (default 0.9 MP). */
  maxBackingPixels?: number;
  /**
   * Keep the (hidden) canvas backing store between effects and reuse it when the next region fits:
   * saves the first-draw allocation (≈ 2.5 ms, 10 ms at 4× for 0.9 MP) at the cost of ≤ 3.6 MB CPU
   * memory while idle. Still no frame callback, no timer and no layer (display: none) when idle.
   * Default false (VFX.md §3.2: free the backing store). `stopAll()` / `dispose()` always free it.
   */
  retainBacking?: boolean;
  /**
   * Escalation policy (docs/VFX.md §6.2, `director.ts`): decides whether a new effect plays at full
   * strength or as an accent (particles ×0.4, no shake / hit-stop / flash). Default: always full.
   */
  policy?(next: FxInfo, running: readonly RunningFx[]): FxMode;
  /** Only one I3+ effect at a time: a big effect waits (≤ BIG_WAIT_FRAMES) for the previous one's timeline. */
  serializeBig?: boolean;
}

export interface FxPlay extends PromiseLike<void> {
  /** Preset / timeline name ('' when nothing plays). */
  readonly name: string;
  readonly tier: Tier;
  /** Resolves at the named cue frame (immediately if the timeline has no such cue, or in reduced motion). */
  cue(name: string): Promise<void>;
  /** Resolves when the effect's last particle is gone. */
  readonly done: Promise<void>;
  /** Resolves at the block frame (same as awaiting the handle). */
  readonly block: Promise<void>;
  cancel(): void;
}

export interface FxStats {
  enabled: boolean;
  atlas: 'idle' | 'loading' | 'ready' | 'failed';
  live: number;
  peak: number;
  spawned: number;
  dropped: number;
  effects: string[];
  canvas: { hidden: boolean; x: number; y: number; w: number; h: number; backingW: number; backingH: number; scale: number } | null;
  ticking: boolean;
  frame: number;
  /** JS time per engine tick (update + draw), ms; p95 over the last 256 ticks. */
  tick: { last: number; max: number; avg: number; p95: number; n: number; maxAt: number; maxFrames: number };
  tintCacheBytes: number;
}

export interface FxHandle {
  play<N extends PresetName>(name: N, params: PresetParams<N>, o?: { seed?: number }): FxPlay;
  /** Run a hand-built timeline. */
  run(tl: Timeline, o?: { seed?: number }): FxPlay;
  /** Skip tap: ×5 for running effects, pending cues fire now. */
  skip(): void;
  /** Drop every effect immediately (screen exit, resize, hidden tab). */
  stopAll(): void;
  setQuality(q: FxQuality): void;
  /** Start loading the atlas (idle time after the game mounts). */
  preload(): Promise<boolean>;
  stats(): FxStats;
  /** Reset peak / spawn / tick counters (perf windows). */
  resetStats(): void;
  /** Remove the canvas and listeners. */
  dispose(): void;
  /** Effects running now (name, tier, frame, still running its timeline) — for the director / tests. */
  running(): RunningFx[];
  /**
   * Resolves once no effect of tier ≥ `minTier` is still running its timeline (particles may fade
   * on). The sequencer waits on it before turning the stage to the next player, so a big moment's
   * stamp and close-up card are not carried away mid-way. Immediate when nothing big runs.
   */
  settled(minTier?: Tier): Promise<void>;
}

const GRACE_TICKS = 8;
/**
 * FX time rate while skipping. The DOM side of a skip is ×5 (time.ts); effects run ×10 so even the
 * 3.7 s finale is gone ≤ 500 ms after a tap (gate F10) — a skipped effect only needs to get out of the way.
 */
const SKIP_RATE = 10;
const DEFAULT_MAX_BACKING = 0.9e6;

/** Backing scale for a region (VFX.md §3.3): clamp(sqrt(budget/area), 0.75, min(1.5, dpr)), hard-capped by the budget. */
export function backingScale(w: number, h: number, dpr: number, budget = DEFAULT_MAX_BACKING, cap = 1.5): number {
  const area = Math.max(1, w * h);
  const fit = Math.sqrt(budget / area);
  const hi = Math.min(cap, Math.max(dpr, 0.5));
  let s = Math.min(hi, Math.max(0.75, fit));
  if (s * s * area > budget) s = fit;
  return s;
}

function union(a: RectLike | null, b: RectLike): RectLike {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

const noopPlay = (name = '', tier: Tier = 0): FxPlay => {
  const p = Promise.resolve();
  return { name, tier, then: p.then.bind(p), cue: () => Promise.resolve(), done: p, block: p, cancel() {} };
};

export function createFx(o: FxOptions): FxHandle {
  const clock = o.clock ?? gameClock;
  const colorOf = o.getPlayerColor ?? ((id: PlayerId) => PLAYER_COLORS[id % PLAYER_COLORS.length]!.hex);
  const maxBacking = o.maxBackingPixels ?? DEFAULT_MAX_BACKING;
  const runner = new Runner(
    {
      ...(o.sfx ? { sfx: o.sfx } : {}),
      ...(o.haptic ? { haptic: o.haptic } : {}),
      ...(o.shake ? { shake: o.shake } : {}),
      ...(o.dom ? { dom: o.dom } : {}),
    },
    undefined,
    o.seed ?? 0x5eed,
  );
  const pool = runner.pool;
  const loader = o.loadAtlas ?? (() => loadAtlas());
  let atlas: FxAtlas | null = null;
  let atlasState: FxStats['atlas'] = 'idle';
  let atlasP: Promise<FxAtlas | null> | null = null;
  let quality: FxQuality = 'high';

  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let region: RectLike | null = null;
  let scale = 1;
  let stopTick: (() => void) | null = null;
  let last = -1;
  let acc = 0;
  let grace = 0;
  let localSkip = false;

  /** Big effects waiting for the previous big one (serializeBig). */
  const bigQueue: Array<{ left: number; go: () => void }> = [];
  const runningFx = (): RunningFx[] =>
    runner.effects
      .filter((e) => !e.finished)
      .map((e) => ({ name: e.tl.name, tier: e.tl.tier, f: e.f, active: e.idx < e.tl.ops.length, ...(e.tl.highlight ? { highlight: e.tl.highlight } : {}) }));
  const settleWaiters: Array<{ tier: Tier; go: () => void }> = [];
  const busyAt = (tier: Tier): boolean => runningFx().some((r) => r.active && r.tier >= tier);
  function pumpSettled(): void {
    for (let i = settleWaiters.length - 1; i >= 0; i--) {
      const w = settleWaiters[i]!;
      if (!busyAt(w.tier)) {
        settleWaiters.splice(i, 1);
        w.go();
      }
    }
  }
  function pumpBig(frames: number): void {
    if (!bigQueue.length) return;
    const busy = bigBusy(runningFx());
    for (const w of bigQueue) w.left -= frames;
    // Release the oldest waiter once the big one ended its timeline (or waited long enough).
    while (bigQueue.length && (!busy || bigQueue[0]!.left <= 0)) {
      bigQueue.shift()!.go();
      if (!busy) break;
    }
  }

  let dirty = { x0: 0, y0: 0, x1: 0, y1: 0, any: false };
  let fullClear = true;
  /** The hidden canvas still holds its backing store (retainBacking). */
  let retained = false;
  const tick = { last: 0, max: 0, sum: 0, n: 0, maxAt: 0, maxFrames: 0 };
  const ring = new Float32Array(256);
  const p95 = (): number => {
    const n = Math.min(tick.n, ring.length);
    if (!n) return 0;
    const a = Array.from(ring.subarray(0, n)).sort((x, y) => x - y);
    return a[Math.min(n - 1, Math.floor(n * 0.95))]!;
  };
  const sample = newSample();
  const radius = FX_ANIM_NAMES.map((n) => Math.hypot(FX_ANIMS[n].w, FX_ANIMS[n].h) / 2);

  const env = (): PresetEnv => ({ c: createCoords(o), color: colorOf });

  function ensureAtlas(): Promise<FxAtlas | null> {
    if (!atlasP) {
      atlasState = 'loading';
      atlasP = loader().then(
        (a) => {
          atlas = a;
          atlasState = a ? 'ready' : 'failed';
          return a;
        },
        () => {
          atlasState = 'failed';
          return null;
        },
      );
    }
    return atlasP;
  }

  function ensureCanvas(): boolean {
    if (canvas && ctx) return true;
    if (typeof document === 'undefined') return false;
    canvas = document.createElement('canvas');
    canvas.className = 'fx-canvas';
    canvas.hidden = true;
    canvas.setAttribute('aria-hidden', 'true');
    ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: o.softwareCanvas ?? true });
    if (!ctx) {
      canvas = null;
      return false;
    }
    o.layer.append(canvas);
    return true;
  }

  /** Grow the canvas region to include `r` (clamped to the layer). */
  /** Grow the canvas region to include `r` (clamped to the layer). */
  function growRegion(r: RectLike, layerW: number, layerH: number): void {
    const pad = 8;
    const x0 = Math.max(0, Math.floor(r.x - pad));
    const y0 = Math.max(0, Math.floor(r.y - pad));
    const x1 = Math.min(layerW, Math.ceil(r.x + r.width + pad));
    const y1 = Math.min(layerH, Math.ceil(r.y + r.height + pad));
    if (x1 <= x0 || y1 <= y0) return;
    const want = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    const c = canvas!;
    // A retained (hidden, still allocated) backing store is reused when the new region fits in it.
    if (retained && region) {
      retained = false;
      const fits = want.x >= region.x && want.y >= region.y && want.x + want.width <= region.x + region.width && want.y + want.height <= region.y + region.height;
      // …and not much larger than needed (a full-screen store would draw a tile effect at a lower backing scale).
      if (fits && want.width * want.height >= region.width * region.height * 0.25) {
        c.hidden = false;
        return;
      }
      region = null;
    }
    const next = union(region, want);
    if (region && next.x === region.x && next.y === region.y && next.width === region.width && next.height === region.height && !c.hidden) return;
    region = next;
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    scale = backingScale(region.width, region.height, dpr, maxBacking, quality === 'low' ? 1 : 1.5);
    c.width = Math.max(1, Math.round(region.width * scale));
    c.height = Math.max(1, Math.round(region.height * scale));
    c.style.width = `${region.width}px`;
    c.style.height = `${region.height}px`;
    c.style.transform = `translate(${region.x}px, ${region.y}px)`;
    c.hidden = false;
    // Setting width/height already cleared the bitmap (and the old dirty box is in old coordinates):
    // no clear needed. The first draw into the fresh backing store pays its allocation
    // (≈ 10 ms at 4× for 0.9 MP; see docs/VFX.md §13 and the `retainBacking` option).
    fullClear = false;
    dirty.any = false;
  }

  /** Idle: stop the frame step, hide the canvas and (unless `retainBacking`) free its backing store. */
  function teardown(free = !o.retainBacking): void {
    stopTick?.();
    stopTick = null;
    last = -1;
    acc = 0;
    localSkip = false;
    if (canvas) canvas.hidden = true;
    if (free || !region) {
      region = null;
      retained = false;
      dirty.any = false;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    } else retained = true;
  }

  function draw(): void {
    if (!ctx || !canvas || !region || !atlas) return;
    const c = ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (fullClear) {
      c.clearRect(0, 0, canvas.width, canvas.height);
      fullClear = false;
    } else if (dirty.any) {
      c.clearRect(dirty.x0 - 2, dirty.y0 - 2, dirty.x1 - dirty.x0 + 4, dirty.y1 - dirty.y0 + 4);
    }
    dirty = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, any: false };
    const s = scale;
    const ox = region.x;
    const oy = region.y;
    const tints = pool.tints;
    let blendNow = -1;
    for (let layer = 0; layer < 4; layer++) {
      for (let blend = 0; blend < 2; blend++) {
        for (let i = 0; i < pool.cap; i++) {
          if (!(pool.flags[i]! & PF.Alive) || pool.layer[i] !== layer || pool.blend[i] !== blend) continue;
          if (!sampleParticle(pool, i, sample)) continue;
          if (blendNow !== blend) {
            c.globalCompositeOperation = blend ? 'lighter' : 'source-over';
            blendNow = blend;
          }
          c.globalAlpha = sample.alpha;
          const cs = Math.cos(sample.rot);
          const sn = Math.sin(sample.rot);
          const X = (sample.x - ox) * s;
          const Y = (sample.y - oy) * s;
          const sx = sample.sx * s;
          const sy = sample.sy * s;
          const ai = pool.anim[i]!;
          atlas.drawRaw(c, ai, sample.frame, cs * sx, sn * sx, -sn * sy, cs * sy, X, Y, pool.anchorX[i]!, pool.anchorY[i]!, tints[pool.tint[i]!]!);
          // Dirty box (anchor-offset safe: radius × 2 around the pivot).
          const r = radius[ai]! * Math.max(Math.abs(sx), Math.abs(sy)) * 2;
          if (X - r < dirty.x0) dirty.x0 = X - r;
          if (Y - r < dirty.y0) dirty.y0 = Y - r;
          if (X + r > dirty.x1) dirty.x1 = X + r;
          if (Y + r > dirty.y1) dirty.y1 = Y + r;
          dirty.any = true;
        }
      }
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  function step(now: number): boolean {
    const t0 = performance.now();
    const skipping = localSkip || clock.skipping();
    if (skipping && !runner.skipping) runner.skip();
    let frames: number;
    if (last < 0) frames = 1;
    else {
      acc += (now - last) * Math.max(0, clock.speed()) * (skipping ? SKIP_RATE : 1);
      frames = Math.floor((acc + FRAME_MS * 0.25) / FRAME_MS);
      acc -= frames * FRAME_MS;
      frames = Math.min(frames, skipping ? 20 : 8);
    }
    last = now;
    if (frames > 0) runner.advance(frames);
    if (frames > 0) pumpBig(frames);
    if (settleWaiters.length) pumpSettled();
    if (frames > 0 || fullClear) draw();
    const dt = performance.now() - t0;
    tick.last = dt;
    if (dt > tick.max) {
      tick.max = dt;
      tick.maxAt = runner.frame;
      tick.maxFrames = frames;
    }
    tick.sum += dt;
    ring[tick.n % ring.length] = dt;
    tick.n++;
    if (runner.idle && !bigQueue.length) {
      // After a skip there is nothing to wait for: short grace.
      if (++grace > (skipping ? 2 : GRACE_TICKS)) {
        localSkip = false;
        stopTick = null;
        teardown();
        return false;
      }
    } else grace = 0;
    return true;
  }

  function arm(tl: Timeline): void {
    if (!ensureCanvas()) return;
    const c = createCoords(o);
    growRegion(tl.bounds, c.width, c.height);
    grace = 0;
    if (!stopTick) {
      last = -1;
      acc = 0;
      stopTick = clock.onFrame(step);
    }
  }

  const reducedHooks = () => ({
    ...(o.sfx ? { sfx: o.sfx } : {}),
    ...(o.haptic ? { haptic: o.haptic } : {}),
    ...(o.highlight ? { highlight: o.highlight } : {}),
  });

  function start(tl: Timeline, seed?: number): FxPlay {
    let effect: Effect | null = null;
    let cancelled = false;
    const ready: Promise<Effect | null> = (async () => {
      if (!atlas) await ensureAtlas();
      if (cancelled) return null;
      if (!atlas || !ensureCanvas()) {
        runReduced(tl, reducedHooks());
        return null;
      }
      // One big moment at a time (§6.2-4): wait for the previous I3+ effect's timeline.
      if (o.serializeBig && tl.tier >= 3 && stopTick && bigBusy(runningFx())) {
        await new Promise<void>((go) => bigQueue.push({ left: BIG_WAIT_FRAMES, go }));
        if (cancelled) return null;
      }
      const mode = o.policy ? o.policy({ name: tl.name, tier: tl.tier, ...(tl.highlight ? { highlight: tl.highlight } : {}) }, runningFx()) : 'full';
      const accent = mode === 'accent';
      effect = runner.start(tl, {
        u: createCoords(o).u,
        ...(seed !== undefined ? { seed } : {}),
        quality: (quality === 'low' ? 0.5 : 1) * (accent ? ACCENT_Q / 0.5 : 1),
        quiet: accent,
      });
      arm(tl);
      return effect;
    })();
    const blockP = ready.then((e) => (e ? e.block : undefined));
    const doneP = ready.then((e) => (e ? e.done : undefined));
    return {
      name: tl.name,
      tier: tl.tier,
      then: (a, b) => blockP.then(a, b),
      block: blockP,
      done: doneP,
      cue: (name) => ready.then((e) => (e ? e.cue(name) : undefined)),
      cancel() {
        cancelled = true;
        if (effect) {
          pool.clear(effect.id);
          const i = runner.effects.indexOf(effect);
          if (i >= 0) runner.effects.splice(i, 1);
          effect.settle();
        }
      },
    };
  }

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') handle.stopAll();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  const handle: FxHandle = {
    play(name, params, opt) {
      if (clock.instant()) return noopPlay(name);
      const tl = buildPreset(name, params, env());
      if (clock.reducedMotion() || quality === 'off') {
        runReduced(tl, reducedHooks());
        return noopPlay(tl.name, tl.tier);
      }
      return start(tl, opt?.seed);
    },
    run(tl, opt) {
      if (clock.instant()) return noopPlay();
      if (clock.reducedMotion() || quality === 'off') {
        runReduced(tl, reducedHooks());
        return noopPlay(tl.name, tl.tier);
      }
      return start(tl, opt?.seed);
    },
    skip() {
      localSkip = true;
      runner.skip();
    },
    stopAll() {
      runner.stopAll();
      for (const w of bigQueue.splice(0)) w.go();
      for (const w of settleWaiters.splice(0)) w.go();
      teardown(true);
    },
    running: runningFx,
    settled(minTier = 3) {
      if (!stopTick || !busyAt(minTier)) return Promise.resolve();
      return new Promise<void>((go) => settleWaiters.push({ tier: minTier, go }));
    },
    setQuality(q) {
      quality = q;
      if (q === 'off') handle.stopAll();
    },
    async preload() {
      return !!(await ensureAtlas());
    },
    stats() {
      return {
        enabled: atlasState !== 'failed',
        atlas: atlasState,
        live: pool.liveCount,
        peak: pool.peak,
        spawned: pool.spawned,
        dropped: pool.dropped,
        effects: runner.effects.map((e) => e.tl.name),
        canvas: canvas
          ? { hidden: canvas.hidden === true, x: region?.x ?? 0, y: region?.y ?? 0, w: region?.width ?? 0, h: region?.height ?? 0, backingW: canvas.width, backingH: canvas.height, scale }
          : null,
        ticking: !!stopTick,
        frame: runner.frame,
        tick: { last: tick.last, max: tick.max, avg: tick.n ? tick.sum / tick.n : 0, p95: p95(), n: tick.n, maxAt: tick.maxAt, maxFrames: tick.maxFrames },
        tintCacheBytes: atlas?.cacheBytes() ?? 0,
      };
    },
    resetStats() {
      pool.resetStats();
      tick.max = tick.sum = tick.n = 0;
    },
    dispose() {
      handle.stopAll();
      canvas?.remove();
      canvas = null;
      ctx = null;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    },
  };

  if (o.dev && typeof window !== 'undefined') {
    (window as unknown as { __fx?: unknown }).__fx = {
      stats: () => handle.stats(),
      play: handle.play,
      skip: handle.skip,
      stopAll: handle.stopAll,
      resetStats: () => handle.resetStats(),
    };
  }
  return handle;
}
