/**
 * VFX engine (VFX.md §3, §15): overlay canvases inside `.fx-layer`, driven by the shared 30 Hz clock.
 *
 * Lifecycle (zero idle cost): idle → `play()` → ONE `onFrame` step is registered → every frame the
 * live particles are clustered and each cluster is drawn into a small pooled canvas placed with a
 * transform (present.ts: fixed S/M/L backing sizes, ≤ `maxCanvases` shown, crisp scale ≤ 1.5 × DPR
 * cap) → when nothing is left, a short grace (8 ticks) → canvases hidden (`visibility`), backing
 * stores freed unless retained, and the step unregisters (no rAF, no timers). Nothing is drawn (or
 * uploaded to the compositor) on a tick where FX time did not advance (hit-stop).
 *
 * `play()` returns a thenable that resolves at the effect's *block* frame (the sequencer goes on
 * while the tail plays); `.cue(name)` resolves at a cue frame (e.g. 'swap' to defer a DOM render),
 * `.done` at the last particle. Reduced motion creates no canvas: sound + haptic + a static
 * highlight only. An atlas load failure disables the canvas the same way (never throws).
 */
import type { PlayerId } from '@/engine';
import { PLAYER_COLORS } from '@/content/palette';
import type { HapticKind } from '@/ui/audio/haptics';
import type { SfxName } from '@/ui/audio/sfx';
import { atlasUrls, createAtlasMeta, loadAtlas, loadAtlasJson, type FxAtlas, type FxAtlasMeta } from './atlas';
import { paintFrame, R_A, R_ALPHA, R_ANIM, R_AX, R_AY, R_FRAME, R_SLOT, R_TINT, REC, SlotPainter, SREC, type FromWorker, type ToWorker, type WorkerFrame } from './paint';
import { animSpeed, isManualClock, isSkipping, onFrame, reducedMotion } from '../time';
import { createCoords, type CoordSource } from './coords';
import { FRAME_MS, newSample, sampleParticle } from './particles';
import { PF } from './pool';
import { Presenter, type PresentStats } from './present';
import { buildPreset, type PresetEnv, type PresetName, type PresetParams } from './presets';
import { extendBlock, extendRate, Runner, runReduced, type Effect, type FxDom, type HighlightTarget, type Tier, type Timeline } from './timeline';
import { EVENT_EXTEND, eventStretch } from '../time';
import { ACCENT_Q, ADAPTIVE_DEFAULTS, AdaptiveQuality, BIG_WAIT_FRAMES, bigBusy, type FxMode, type FxInfo, type RunningFx } from './director';

/** The user setting (Settings → 연출 품질 / Effects). 'auto' adapts to the device (VFX.md §15.4). */
export type FxQuality = 'auto' | 'high' | 'low' | 'off';
/**
 * What actually plays: 'high' everything; 'low' half the particles, no soft additive glows, no
 * shake, 1× backing, 15 Hz presentation; 'minimal' / 'off' the reduced-motion path (sound, haptics,
 * a static highlight, state applied at once — no canvas).
 */
export type FxTier = 'high' | 'low' | 'minimal' | 'off';

export interface FxOptions extends CoordSource {
  /** The `.fx-layer` element (the canvas is appended to it). */
  layer: HTMLElement;
  /** Player colour (hex). Default: PLAYER_COLORS by id. */
  getPlayerColor?(id: PlayerId): string;
  sfx?(name: SfxName, o: { pitch?: number; gain?: number }): void;
  haptic?(kind: HapticKind): void;
  /** Screen shake of the table AND the fx layer (VFX.md §3.1). */
  shake?(px: number, ms: number): void;
  dom?: FxDom;
  /** Reduced-motion static highlight (DOM class toggle, no animation). */
  highlight?(target: HighlightTarget, ms: number): void;
  /** Atlas loader (tests / demo can inject); default loads public/fx via BASE_URL. */
  loadAtlas?(): Promise<FxAtlas | null>;
  /** Seed of the effect RNG stream. */
  seed?: number;
  /** Register `window.__fx` (dev only). */
  dev?: boolean;
  /** @deprecated (single-canvas budget); the pooled canvases have fixed sizes (present.ts). Ignored. */
  maxBackingPixels?: number;
  /** Most FX canvases shown at once (each one is a GPU layer while shown). Default 3. */
  maxCanvases?: number;
  /** Canvas pool (size-class indexes, present.ts SLOT_CLASSES); default SLOT_POOL. */
  pool?: readonly number[];
  /** Backing px per frame that sets the scale of large clusters (present.ts FRAME_BUDGET_PX). */
  frameBudget?: number;
  /**
   * Paint the canvases in a worker (OffscreenCanvas, docs/VFX.md §15) when supported: the canvas
   * draw and its copy to the compositor leave the main thread. Default true; never with an injected
   * `loadAtlas` or a manual clock (deterministic screenshots paint on the main thread).
   */
  worker?: boolean;
  /** Initial quality setting (default 'high'; the game passes the user's pref, default 'auto'). */
  quality?: FxQuality;
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
  /**
   * Union of the shown canvases (layer px); `hidden` when none is shown. backingW/H = the largest
   * shown canvas's backing, scale = its backing scale.
   */
  canvas: { hidden: boolean; x: number; y: number; w: number; h: number; backingW: number; backingH: number; scale: number } | null;
  /** The pooled canvases (present.ts). */
  slots: PresentStats['slots'];
  /** Backing px uploaded to the compositor (drawn canvases) and canvas frames drawn since `resetStats()`; show/hide toggles (Paints). */
  upload: { px: number; frames: number; toggles: number };
  ticking: boolean;
  frame: number;
  /** JS time per engine tick (update + draw), ms; p95 over the last 256 ticks. */
  tick: { last: number; max: number; avg: number; p95: number; n: number; maxAt: number; maxFrames: number };
  tintCacheBytes: number;
  /** Quality setting, the tier playing now, and the adaptive controller's transitions (auto). */
  quality: { setting: FxQuality; tier: FxTier; transitions: Array<{ at: number; from: FxTier; to: FxTier; why: string }> };
  /** Paint backend of the current canvases. */
  backend: 'worker' | 'main' | 'none';
}

export interface FxHandle {
  /**
   * `extend`: the effect is an event presentation (fx/time.ts EVENT_EXTEND): its timeline and
   * particles play slower in proportion, lasting `EVENT_EXTEND.motionMs` longer (cues later in
   * proportion; the block, what the sequencer awaits, exactly `motionMs` later).
   * A number: stretch by exactly that factor (an effect timed to a DOM animation stretched by it).
   */
  play<N extends PresetName>(name: N, params: PresetParams<N>, o?: { seed?: number; extend?: boolean | number }): FxPlay;
  /** Run a hand-built timeline. */
  run(tl: Timeline, o?: { seed?: number }): FxPlay;
  /** Skip tap: ×5 for running effects, pending cues fire now. */
  skip(): void;
  /** Drop every effect immediately (screen exit, resize, hidden tab). */
  stopAll(): void;
  /** Quality setting, applied live ('off' stops running effects). */
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

/** Ticks to stay armed after the last particle (then the canvases are parked, present.ts). */
const GRACE_TICKS = 8;
/** A particle younger than this (FX frames) keeps the 30 Hz presentation (VFX.md §15). */
const TAIL_AGE = 8;
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

/** One frame's buffers (paint.ts layout). */
type Bufs = { states: Float32Array; list: Float32Array; boxes: Float32Array };

const noopPlay = (name = '', tier: Tier = 0): FxPlay => {
  const p = Promise.resolve();
  return { name, tier, then: p.then.bind(p), cue: () => Promise.resolve(), done: p, block: p, cancel() {} };
};

export function createFx(o: FxOptions): FxHandle {
  const colorOf = o.getPlayerColor ?? ((id: PlayerId) => PLAYER_COLORS[id % PLAYER_COLORS.length]!.hex);
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
  let quality: FxQuality = o.quality ?? 'high';
  /** Adaptive tier while the setting is 'auto'. */
  const aq = new AdaptiveQuality(ADAPTIVE_DEFAULTS, typeof performance !== 'undefined' ? performance.now() : 0);
  const transitions: FxStats['quality']['transitions'] = [];
  const tierNow = (): FxTier => (quality === 'auto' ? aq.tier : quality);
  /** Software canvases (`willReadFrequently`, docs/PERFORMANCE.md). */
  const software = true;
  /** Full atlas on the main thread (main backend: tests, manual clock, no worker support). */
  let atlas: FxAtlas | null = null;
  let atlasP: Promise<FxAtlas | null> | null = null;
  /** Frame boxes (from the full atlas, or the JSON alone when a worker paints). */
  let meta: FxAtlasMeta | null = null;
  let metaP: Promise<FxAtlasMeta | null> | null = null;
  let atlasState: FxStats['atlas'] = 'idle';
  /** Paint worker (fx.worker.ts). */
  let worker: Worker | null = null;
  let workerState: 'none' | 'loading' | 'ready' | 'failed' = 'none';
  let workerP: Promise<boolean> | null = null;
  let settleWorker: ((ok: boolean) => void) | null = null;
  let disposed = false;
  /** Cancels starts that are waiting for the atlas without making a reusable engine terminal. */
  let startGeneration = 0;
  const freeBuffers: Bufs[] = [];
  let sentTints = 1;

  /**
   * Pooled small canvases (present.ts), created on the first effect (never in reduced motion): one
   * set painted by the worker, one by the main thread (created only if that backend is used).
   */
  let pres: Presenter | null = null;
  let workerPres: Presenter | null = null;
  let mainPres: Presenter | null = null;
  let mainPainters: SlotPainter[] = [];
  /** Layer size (CSS px) read when an effect starts. */
  let layerW = 0;
  let layerH = 0;
  /** Runner frame last drawn: nothing moves during a hit-stop, so nothing is drawn (or uploaded). */
  let drawnFrame = -1;
  let forceDraw = false;
  let sinceDraw = 0;
  /** Records painted by the last draw (0 and no particle: nothing to paint or clear). */
  let lastDrawn = 0;
  /** No timeline has ops left to run and every particle is older than TAIL_AGE frames. */
  function tailOnly(): boolean {
    for (const e of runner.effects) if (e.idx < e.tl.ops.length) return false;
    const { flags, age } = pool;
    for (let i = 0; i < cap; i++) if (flags[i]! & PF.Alive && age[i]! < TAIL_AGE) return false;
    return true;
  }
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

  const tick = { last: 0, max: 0, sum: 0, n: 0, maxAt: 0, maxFrames: 0 };
  const ring = new Float32Array(256);
  const p95 = (): number => {
    const n = Math.min(tick.n, ring.length);
    if (!n) return 0;
    const a = Array.from(ring.subarray(0, n)).sort((x, y) => x - y);
    return a[Math.min(n - 1, Math.floor(n * 0.95))]!;
  };
  const sample = newSample();

  const env = (): PresetEnv => ({ c: createCoords(o), color: colorOf });

  /** Worker backend possible here (default loader, real clock, OffscreenCanvas + transferControlToOffscreen). */
  function workerWanted(): boolean {
    return (
      o.worker !== false &&
      !o.loadAtlas &&
      !isManualClock() &&
      workerState !== 'failed' &&
      typeof Worker !== 'undefined' &&
      typeof OffscreenCanvas !== 'undefined' &&
      typeof HTMLCanvasElement !== 'undefined' &&
      'transferControlToOffscreen' in HTMLCanvasElement.prototype
    );
  }

  function ensureMainAtlas(): Promise<FxAtlas | null> {
    if (disposed) return Promise.resolve(null);
    if (!atlasP) {
      atlasP = (o.loadAtlas ?? (() => loadAtlas()))().then(
        (a) => {
          if (disposed) return null;
          atlas = a;
          if (a) meta = a;
          return a;
        },
        () => null,
      );
    }
    return atlasP;
  }

  function ensureWorker(): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    if (workerP) return workerP;
    workerP = new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        if (settleWorker === finish) settleWorker = null;
        resolve(ok);
      };
      settleWorker = finish;
      let started: Worker;
      try {
        started = new Worker(new URL('./fx.worker.ts', import.meta.url), { type: 'module' });
        worker = started;
      } catch {
        workerState = 'failed';
        finish(false);
        return;
      }
      workerState = 'loading';
      started.onmessage = (e: MessageEvent<FromWorker>) => {
        if (disposed || worker !== started) {
          finish(false);
          return;
        }
        const m = e.data;
        if (m.t === 'buffers') freeBuffers.push(m);
        else if (m.t === 'ready') {
          workerState = 'ready';
          finish(true);
        } else if (m.t === 'failed') {
          console.warn('[vfx] paint worker unavailable, painting on the main thread:', m.error);
          workerState = 'failed';
          finish(false);
        }
      };
      started.onerror = () => {
        if (disposed || worker !== started) {
          finish(false);
          return;
        }
        if (workerState === 'loading') console.warn('[vfx] paint worker failed to start; painting on the main thread');
        workerState = 'failed';
        finish(false);
      };
      started.postMessage({ t: 'init', urls: atlasUrls(), software } satisfies ToWorker);
    });
    return workerP;
  }

  function ensureMeta(): Promise<FxAtlasMeta | null> {
    if (disposed) return Promise.resolve(null);
    if (meta) return Promise.resolve(meta);
    metaP ??= loadAtlasJson().then((j) => (disposed || !j ? null : (meta ??= createAtlasMeta(j))));
    return metaP;
  }

  /**
   * Load what the backend of the next effect needs: worker → atlas JSON here + sheets in the worker;
   * main → the full atlas here. A worker failure falls back to the main thread. Resolves ready.
   */
  async function ensureReady(): Promise<boolean> {
    if (disposed) return false;
    if (atlasState === 'idle') atlasState = 'loading';
    let ok = false;
    if (workerWanted()) {
      const [m, w] = await Promise.all([ensureMeta(), ensureWorker()]);
      ok = !!m && w;
    }
    if (!ok) ok = !!(await ensureMainAtlas());
    if (disposed) return false;
    atlasState = ok ? 'ready' : 'failed';
    return ok;
  }

  /** The presenter (and backend) for the next frames: the worker's while it can paint, else the main thread's. */
  function ensureCanvas(): boolean {
    if (typeof document === 'undefined') return false;
    const useWorker = workerWanted() && workerState === 'ready' && !!meta;
    if (useWorker) {
      if (!workerPres) {
        workerPres = new Presenter({ layer: o.layer, maxShown: o.maxCanvases ?? 3, ...(o.pool ? { pool: o.pool } : {}), ...(o.frameBudget ? { budget: o.frameBudget } : {}) });
        const offs = workerPres.slots.map((sl) => sl.el.transferControlToOffscreen());
        worker!.postMessage({ t: 'canvases', canvases: offs } satisfies ToWorker, offs);
      }
      switchTo(workerPres);
      return true;
    }
    if (!atlas) return false;
    if (!mainPres) {
      mainPres = new Presenter({ layer: o.layer, maxShown: o.maxCanvases ?? 3, ...(o.pool ? { pool: o.pool } : {}), ...(o.frameBudget ? { budget: o.frameBudget } : {}) });
      mainPainters = [];
      for (const sl of mainPres.slots) {
        const ctx = sl.el.getContext('2d', { alpha: true, willReadFrequently: software });
        if (!ctx) return false;
        mainPainters.push(new SlotPainter({ canvas: sl.el, ctx }));
      }
    }
    switchTo(mainPres);
    return true;
  }

  /** Change backend (e.g. the manual clock was switched on mid-session): park the other set. */
  function switchTo(next: Presenter): void {
    if (pres === next) return;
    if (pres) {
      pres.hideAll(true);
      submit(pres, 0);
    }
    pres = next;
  }

  /**
   * Idle: stop the frame step; with `retainBacking` park the canvases (off the layer, no Paint),
   * else hide them and free their backing stores.
   */
  function teardown(free = !o.retainBacking): void {
    stopTick?.();
    stopTick = null;
    last = -1;
    acc = 0;
    localSkip = false;
    drawnFrame = -1;
    sinceDraw = 0;
    lastNow = -1;
    if (pres) {
      if (free) pres.hideAll(true);
      else pres.park();
      submit(pres, 0);
    }
  }

  // Per-frame scratch (sampled particles), sized to the pool: no allocation in the frame loop.
  const cap = pool.cap;
  const PX = new Float64Array(cap);
  const PY = new Float64Array(cap);
  const BX0 = new Float64Array(cap);
  const BY0 = new Float64Array(cap);
  const BX1 = new Float64Array(cap);
  const BY1 = new Float64Array(cap);
  const fbox = new Float64Array(4);
  const PA = new Float64Array(cap);
  const PB = new Float64Array(cap);
  const PC = new Float64Array(cap);
  const PD = new Float64Array(cap);
  const PAL = new Float64Array(cap);
  const PF_ = new Int32Array(cap);
  const PI = new Int32Array(cap);
  const bucket = new Int32Array(cap);
  const bucketStart = new Int32Array(9);
  // Main-backend frame buffers (the worker backend posts pooled, transferred ones).
  const mainList = new Float32Array(cap * REC);
  const mainBoxes = new Float32Array(cap * 4);
  let mainStates = new Float32Array(0);

  /** Frame buffers to fill: the main ones, or a free (returned) worker set. */
  function frameBuffers(p: Presenter): Bufs {
    const need = p.slots.length * SREC;
    if (p === mainPres || !worker) {
      if (mainStates.length !== need) mainStates = new Float32Array(need);
      return { states: mainStates, list: mainList, boxes: mainBoxes };
    }
    const b = freeBuffers.pop();
    if (b && b.states.length === need) return b;
    return { states: new Float32Array(need), list: new Float32Array(cap * REC), boxes: new Float32Array(cap * 4) };
  }
  let cur: Bufs = { states: mainStates, list: mainList, boxes: mainBoxes };

  /** Hand the frame (`n` records in `cur`) to the backend of `p`. */
  function submit(p: Presenter, n: number): void {
    if (n === 0) cur = frameBuffers(p);
    p.writeStates(cur.states);
    if (p === mainPres) {
      if (atlas) paintFrame(atlas, mainPainters, cur.states, cur.list, cur.boxes, n, pool.tints);
      return;
    }
    if (!worker) return;
    const msg: WorkerFrame = { t: 'frame', states: cur.states, list: cur.list, boxes: cur.boxes, n };
    if (pool.tints.length > sentTints) {
      msg.tints = { first: sentTints, add: pool.tints.slice(sentTints) };
      sentTints = pool.tints.length;
    }
    worker.postMessage(msg, [cur.states.buffer, cur.list.buffer, cur.boxes.buffer]);
  }

  function draw(): void {
    if (!pres || !meta) return;
    const P = pres;
    const W = layerW;
    const H = layerH;
    // 1. Sample every visible particle once; cull the ones fully outside the layer.
    let n = 0;
    for (let i = 0; i < cap; i++) {
      if (!(pool.flags[i]! & PF.Alive)) continue;
      if (!sampleParticle(pool, i, sample)) continue;
      // The drawn (trimmed) quad under the particle's transform → its layer-px box (tight: early
      // ring / burst frames and soft glows are much smaller than their nominal box).
      if (!meta.frameBox(pool.anim[i]!, sample.frame, pool.anchorX[i]!, pool.anchorY[i]!, fbox)) continue;
      const cs = Math.cos(sample.rot);
      const sn = Math.sin(sample.rot);
      const a = cs * sample.sx;
      const b = sn * sample.sx;
      const c = -sn * sample.sy;
      const d = cs * sample.sy;
      const x = sample.x;
      const y = sample.y;
      const ux0 = a * fbox[0]!;
      const ux1 = a * fbox[2]!;
      const vx0 = c * fbox[1]!;
      const vx1 = c * fbox[3]!;
      const uy0 = b * fbox[0]!;
      const uy1 = b * fbox[2]!;
      const vy0 = d * fbox[1]!;
      const vy1 = d * fbox[3]!;
      const x0 = x + Math.min(ux0, ux1) + Math.min(vx0, vx1) - 1;
      const x1 = x + Math.max(ux0, ux1) + Math.max(vx0, vx1) + 1;
      const y0 = y + Math.min(uy0, uy1) + Math.min(vy0, vy1) - 1;
      const y1 = y + Math.max(uy0, uy1) + Math.max(vy0, vy1) + 1;
      if (x1 < 0 || y1 < 0 || x0 > W || y0 > H) continue;
      PX[n] = x;
      PY[n] = y;
      BX0[n] = x0;
      BY0[n] = y0;
      BX1[n] = x1;
      BY1[n] = y1;
      PA[n] = a;
      PB[n] = b;
      PC[n] = c;
      PD[n] = d;
      PAL[n] = sample.alpha;
      PF_[n] = sample.frame;
      PI[n] = i;
      n++;
    }
    // 2. Cluster → canvases (clipped to the layer: nothing off-screen gets backing pixels).
    const C = P.clusterer;
    C.run(n, BX0, BY0, BX1, BY1, W, H, P.o.maxShown);
    for (let k = 0; k < C.count; k++) {
      C.x0[k] = Math.max(0, C.x0[k]!);
      C.y0[k] = Math.max(0, C.y0[k]!);
      C.x1[k] = Math.min(W, C.x1[k]!);
      C.y1[k] = Math.min(H, C.y1[k]!);
    }
    P.assign(sMax());
    // 3. Records in draw order: layer 0..3 × (normal, additive) — a counting sort into 8 buckets.
    bucketStart.fill(0);
    for (let p = 0; p < n; p++) {
      const i = PI[p]!;
      bucketStart[pool.layer[i]! * 2 + pool.blend[i]! + 1]!++;
    }
    for (let b = 1; b < 9; b++) bucketStart[b]! += bucketStart[b - 1]!;
    for (let p = 0; p < n; p++) {
      const i = PI[p]!;
      bucket[bucketStart[pool.layer[i]! * 2 + pool.blend[i]!]!++] = p;
    }
    cur = frameBuffers(P);
    const L = cur.list;
    const Bx = cur.boxes;
    let m = 0;
    for (let q = 0; q < n; q++) {
      const p = bucket[q]!;
      const k = P.slotIndex(C.label[p]!);
      if (k < 0) continue;
      const sl = P.slots[k]!;
      const i = PI[p]!;
      const s = sl.s;
      const o = m * REC;
      L[o + R_SLOT] = k;
      L[o + R_ANIM] = pool.anim[i]!;
      L[o + R_FRAME] = PF_[p]!;
      L[o + R_A] = PA[p]! * s;
      L[o + R_A + 1] = PB[p]! * s;
      L[o + R_A + 2] = PC[p]! * s;
      L[o + R_A + 3] = PD[p]! * s;
      L[o + R_A + 4] = (PX[p]! - sl.x) * s;
      L[o + R_A + 5] = (PY[p]! - sl.y) * s;
      L[o + R_AX] = pool.anchorX[i]!;
      L[o + R_AY] = pool.anchorY[i]!;
      L[o + R_ALPHA] = PAL[p]!;
      L[o + R_TINT] = pool.tint[i]! + 65536 * pool.blend[i]!;
      const b = m * 4;
      Bx[b] = (BX0[p]! - sl.x) * s;
      Bx[b + 1] = (BY0[p]! - sl.y) * s;
      Bx[b + 2] = (BX1[p]! - sl.x) * s;
      Bx[b + 3] = (BY1[p]! - sl.y) * s;
      m++;
    }
    submit(P, m);
    lastDrawn = m;
  }

  /** Crisp backing scale: 1.5 capped by the DPR (1 on quality 'low'). */
  function sMax(): number {
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    return Math.min(tierNow() === 'low' ? 1 : 1.5, Math.max(dpr, 0.5));
  }

  // Adaptive quality (setting 'auto', VFX.md §15.4): director.ts AdaptiveQuality.
  let lastNow = -1;
  function noteTransition(from: FxTier, why: string | null): void {
    if (!why || aq.tier === from) return;
    transitions.push({ at: Math.round(performance.now()), from, to: aq.tier, why });
    if (transitions.length > 20) transitions.shift();
    if (o.dev) console.info(`[vfx] quality ${from} → ${aq.tier} (${why})`);
  }

  function step(now: number): boolean {
    const t0 = performance.now();
    const skipping = localSkip || isSkipping();
    if (skipping && !runner.skipping) runner.skip();
    let frames: number;
    if (last < 0) frames = 1;
    else {
      acc += (now - last) * Math.max(0, animSpeed()) * (skipping ? SKIP_RATE : 1);
      frames = Math.floor((acc + FRAME_MS * 0.25) / FRAME_MS);
      acc -= frames * FRAME_MS;
      frames = Math.min(frames, skipping ? 20 : 8);
    }
    last = now;
    if (frames > 0) {
      runner.advance(frames);
    }
    if (frames > 0) pumpBig(frames);
    if (settleWaiters.length) pumpSettled();
    // Presentation rate: every FX frame (30 Hz); on quality 'low', tails (no timeline beats left, no
    // young particle: fading / drifting) every 2nd frame (15 Hz).
    if (runner.frame !== drawnFrame) sinceDraw++;
    const every = tierNow() === 'low' && tailOnly() ? 2 : 1;
    const empty = pool.liveCount === 0 && lastDrawn === 0;
    if ((runner.frame !== drawnFrame && sinceDraw >= every && !empty) || forceDraw) {
      drawnFrame = runner.frame;
      sinceDraw = 0;
      forceDraw = false;
      draw();
    }
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
    // Adaptive quality samples: real-time ticks with effects on screen (not skipping, not hand-stepped).
    if (quality === 'auto' && lastNow >= 0 && !skipping && !isManualClock() && pool.liveCount > 0) {
      const from = aq.tier;
      noteTransition(from, aq.sample(dt, now - lastNow, now));
    }
    lastNow = now;
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

  function arm(): void {
    if (!ensureCanvas()) return;
    const c = createCoords(o);
    layerW = c.width;
    layerH = c.height;
    grace = 0;
    if (!stopTick) {
      last = -1;
      acc = 0;
      stopTick = onFrame(step);
    }
  }

  /** The reduced path plays (no canvas): OS / app reduced motion, setting 'off', or the adaptive 'minimal' tier. */
  function reducedNow(): boolean {
    if (reducedMotion() || quality === 'off') return true;
    if (quality === 'auto' && aq.tier === 'minimal') {
      noteTransition('minimal', aq.onPlay(performance.now()));
      return aq.tier === 'minimal';
    }
    return false;
  }

  const reducedHooks = () => ({
    ...(o.sfx ? { sfx: o.sfx } : {}),
    ...(o.haptic ? { haptic: o.haptic } : {}),
    ...(o.highlight ? { highlight: o.highlight } : {}),
  });

  function start(tl: Timeline, seed?: number, rate = 1, block = tl.block): FxPlay {
    let effect: Effect | null = null;
    let cancelled = false;
    const generation = startGeneration;
    const stopped = (): boolean => cancelled || disposed || generation !== startGeneration;
    const ready: Promise<Effect | null> = (async () => {
      const ok = await ensureReady();
      if (stopped()) return null;
      if (!ok || !ensureCanvas()) {
        runReduced(tl, reducedHooks());
        return null;
      }
      // One big moment at a time (§6.2-4): wait for the previous I3+ effect's timeline.
      if (o.serializeBig && tl.tier >= 3 && stopTick && bigBusy(runningFx())) {
        await new Promise<void>((go) => bigQueue.push({ left: BIG_WAIT_FRAMES, go }));
        if (stopped()) return null;
      }
      const mode = o.policy ? o.policy({ name: tl.name, tier: tl.tier, ...(tl.highlight ? { highlight: tl.highlight } : {}) }, runningFx()) : 'full';
      const accent = mode === 'accent';
      effect = runner.start(tl, {
        u: createCoords(o).u,
        ...(seed !== undefined ? { seed } : {}),
        quality: (tierNow() === 'low' ? 0.5 : 1) * (accent ? ACCENT_Q / 0.5 : 1),
        quiet: accent,
        lite: tierNow() === 'low',
        rate,
        block,
      });
      arm();
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
          forceDraw = true;
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
      if (disposed) return noopPlay(name);
      if (animSpeed() === 0) return noopPlay(name);
      const tl = buildPreset(name, params, env());
      if (reducedNow()) {
        runReduced(tl, reducedHooks());
        return noopPlay(tl.name, tl.tier);
      }
      const ext = opt?.extend;
      if (typeof ext === 'number') return start(tl, opt?.seed, 1 / ext);
      if (!ext) return start(tl, opt?.seed);
      // An event: slower in proportion, and its block holds the sequence motionMs longer.
      const rate = extendRate(tl, eventStretch);
      return start(tl, opt?.seed, rate, extendBlock(tl, rate, (EVENT_EXTEND.motionMs * 30) / 1000));
    },
    run(tl, opt) {
      if (disposed) return noopPlay(tl.name, tl.tier);
      if (animSpeed() === 0) return noopPlay();
      if (reducedNow()) {
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
      startGeneration++;
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
      if (q === quality) return;
      quality = q;
      if (q === 'auto') aq.set('high', performance.now());
      if (q === 'off') handle.stopAll();
    },
    async preload() {
      if (disposed || reducedMotion() || quality === 'off') return false;
      return ensureReady();
    },
    stats() {
      const pst = pres?.stats() ?? null;
      return {
        enabled: atlasState !== 'failed',
        atlas: atlasState,
        live: pool.liveCount,
        peak: pool.peak,
        spawned: pool.spawned,
        dropped: pool.dropped,
        effects: runner.effects.map((e) => e.tl.name),
        canvas: pst
          ? (() => {
              const P = pres!;
              const px = (x: (typeof P.slots)[number]): number => P.classes[x.cls]!.w * P.classes[x.cls]!.h;
              const big = P.slots.filter((x) => x.shown).sort((a, b) => px(b) - px(a))[0];
              const K = big ? P.classes[big.cls]! : null;
              const u = pst.union;
              return { hidden: pst.shown === 0, x: u?.x ?? 0, y: u?.y ?? 0, w: u?.width ?? 0, h: u?.height ?? 0, backingW: K?.w ?? 0, backingH: K?.h ?? 0, scale: big?.s ?? 0 };
            })()
          : null,
        slots: pst?.slots ?? [],
        upload: { px: pst?.uploadPx ?? 0, frames: pst?.drawn ?? 0, toggles: pst?.toggles ?? 0 },
        ticking: !!stopTick,
        frame: runner.frame,
        tick: { last: tick.last, max: tick.max, avg: tick.n ? tick.sum / tick.n : 0, p95: p95(), n: tick.n, maxAt: tick.maxAt, maxFrames: tick.maxFrames },
        tintCacheBytes: atlas?.cacheBytes() ?? 0,
        quality: { setting: quality, tier: reducedMotion() ? 'off' : tierNow(), transitions: transitions.slice() },
        backend: !pres ? 'none' : pres === workerPres ? 'worker' : 'main',
      };
    },
    resetStats() {
      pool.resetStats();
      pres?.resetStats();
      tick.max = tick.sum = tick.n = 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      handle.stopAll();
      workerPres?.dispose();
      mainPres?.dispose();
      workerPres = mainPres = pres = null;
      settleWorker?.(false);
      worker?.terminate();
      worker = null;
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
