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
import { loadAtlas, type FxAtlas } from './atlas';
import { gameClock, type FxClock } from './clock';
import { createCoords, type CoordSource } from './coords';
import { FRAME_MS, newSample, sampleParticle } from './particles';
import { PF } from './pool';
import { Presenter, type PresentStats } from './present';
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
  /** @deprecated (single-canvas budget); the pooled canvases have fixed sizes (present.ts). Ignored. */
  maxBackingPixels?: number;
  /** Most FX canvases shown at once (each one is a GPU layer while shown). Default 3. */
  maxCanvases?: number;
  /** Dev A/B knobs (VFX.md §15): crisp-scale cap, draw every n-th tick. */
  tune?: { sMax?: number; drawEvery?: number };
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

const noopPlay = (name = '', tier: Tier = 0): FxPlay => {
  const p = Promise.resolve();
  return { name, tier, then: p.then.bind(p), cue: () => Promise.resolve(), done: p, block: p, cancel() {} };
};

export function createFx(o: FxOptions): FxHandle {
  const clock = o.clock ?? gameClock;
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
  const loader = o.loadAtlas ?? (() => loadAtlas());
  let atlas: FxAtlas | null = null;
  let atlasState: FxStats['atlas'] = 'idle';
  let atlasP: Promise<FxAtlas | null> | null = null;
  let quality: FxQuality = 'high';

  /** Pooled small canvases (present.ts), created on the first effect (never in reduced motion). */
  let pres: Presenter | null = null;
  /** Layer size (CSS px) read when an effect starts. */
  let layerW = 0;
  let layerH = 0;
  /** Runner frame last drawn: nothing moves during a hit-stop, so nothing is drawn (or uploaded). */
  let drawnFrame = -1;
  let forceDraw = false;
  let sinceDraw = 0;
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
    if (pres) return pres.ok;
    if (typeof document === 'undefined') return false;
    pres = new Presenter({ layer: o.layer, software: o.softwareCanvas ?? true, maxShown: o.maxCanvases ?? 3, retain: !!o.retainBacking });
    return pres.ok;
  }

  /** Idle: stop the frame step, hide the canvases and (unless `retainBacking`) free their backing stores. */
  function teardown(free = !o.retainBacking): void {
    stopTick?.();
    stopTick = null;
    last = -1;
    acc = 0;
    localSkip = false;
    drawnFrame = -1;
    sinceDraw = 0;
    pres?.hideAll(free);
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

  function draw(): void {
    if (!pres || !atlas) return;
    const W = layerW;
    const H = layerH;
    // 1. Sample every visible particle once; cull the ones fully outside the layer.
    let n = 0;
    for (let i = 0; i < cap; i++) {
      if (!(pool.flags[i]! & PF.Alive)) continue;
      if (!sampleParticle(pool, i, sample)) continue;
      // The drawn (trimmed) quad under the particle's transform → its layer-px box (tight: early
      // ring / burst frames and soft glows are much smaller than their nominal box).
      if (!atlas.frameBox(pool.anim[i]!, sample.frame, pool.anchorX[i]!, pool.anchorY[i]!, fbox)) continue;
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
    const C = pres.clusterer;
    C.run(n, BX0, BY0, BX1, BY1, W, H, pres.o.maxShown);
    for (let k = 0; k < C.count; k++) {
      C.x0[k] = Math.max(0, C.x0[k]!);
      C.y0[k] = Math.max(0, C.y0[k]!);
      C.x1[k] = Math.min(W, C.x1[k]!);
      C.y1[k] = Math.min(H, C.y1[k]!);
    }
    pres.assign(sMax());
    pres.begin();
    // 3. Draw order: layer 0..3 × (normal, additive) — a counting sort into 8 buckets.
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
    const tints = pool.tints;
    for (let q = 0; q < n; q++) {
      const p = bucket[q]!;
      const sl = pres.slot(C.label[p]!);
      if (!sl) continue;
      const i = PI[p]!;
      const c = sl.ctx;
      const blend = pool.blend[i]!;
      if (sl.blend !== blend) {
        c.globalCompositeOperation = blend ? 'lighter' : 'source-over';
        sl.blend = blend;
      }
      c.globalAlpha = PAL[p]!;
      const s = sl.s;
      const X = (PX[p]! - sl.x) * s;
      const Y = (PY[p]! - sl.y) * s;
      atlas.drawRaw(c, pool.anim[i]!, PF_[p]!, PA[p]! * s, PB[p]! * s, PC[p]! * s, PD[p]! * s, X, Y, pool.anchorX[i]!, pool.anchorY[i]!, tints[pool.tint[i]!]!);
      pres.mark(sl, BX0[p]!, BY0[p]!, BX1[p]!, BY1[p]!);
    }
    for (const sl of pres.slots) {
      if (sl.blend < 0) continue;
      sl.ctx.globalAlpha = 1;
      sl.ctx.globalCompositeOperation = 'source-over';
    }
  }

  /** Crisp backing scale: 1.5 capped by the DPR (1 on quality 'low'). */
  function sMax(): number {
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    return Math.min(o.tune?.sMax ?? 9, quality === 'low' ? 1 : 1.5, Math.max(dpr, 0.5));
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
    if (frames > 0) {
      runner.advance(frames);
    }
    if (frames > 0) pumpBig(frames);
    if (settleWaiters.length) pumpSettled();
    // Presentation rate: every FX frame (30 Hz) while a timeline still runs its beats or a particle
    // is young (impacts, pops, fast bursts); every 2nd frame (15 Hz) for tails (fading, drifting).
    if (runner.frame !== drawnFrame) sinceDraw++;
    const every = o.tune?.drawEvery ?? (tailOnly() ? 2 : 1);
    if ((runner.frame !== drawnFrame && sinceDraw >= every) || forceDraw) {
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
              const big = pres!.slots.filter((x) => x.shown).sort((a, b) => b.canvas.width * b.canvas.height - a.canvas.width * a.canvas.height)[0];
              const u = pst.union;
              return { hidden: pst.shown === 0, x: u?.x ?? 0, y: u?.y ?? 0, w: u?.width ?? 0, h: u?.height ?? 0, backingW: big?.canvas.width ?? 0, backingH: big?.canvas.height ?? 0, scale: big?.s ?? 0 };
            })()
          : null,
        slots: pst?.slots ?? [],
        upload: { px: pst?.uploadPx ?? 0, frames: pst?.drawn ?? 0, toggles: pst?.toggles ?? 0 },
        ticking: !!stopTick,
        frame: runner.frame,
        tick: { last: tick.last, max: tick.max, avg: tick.n ? tick.sum / tick.n : 0, p95: p95(), n: tick.n, maxAt: tick.maxAt, maxFrames: tick.maxFrames },
        tintCacheBytes: atlas?.cacheBytes() ?? 0,
      };
    },
    resetStats() {
      pool.resetStats();
      pres?.resetStats();
      tick.max = tick.sum = tick.n = 0;
    },
    dispose() {
      handle.stopAll();
      pres?.dispose();
      pres = null;
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
