/**
 * Timeline DSL + runner (VFX.md §3.8, §7.2b.0). A preset is a list of `t(frame, action)` ops at
 * 30 fps FX frames; the runner executes them on the engine clock (never `setTimeout`):
 *
 * - `spawn` / `burst`: particles through the budgeter (per-effect tier cap + pool budget).
 * - `hitStop(n)`: freezes FX time for n frames (timelines and particles), wall clock goes on.
 * - `shake`, `flash`, `sfx`, `haptic`, `dom`: side effects through injected hooks.
 * - `cue(name)`: a signal callers await (e.g. defer the DOM render to the 'swap' frame).
 * - `block`: the frame at which `play()` resolves (the sequencer continues; the tail keeps playing).
 *
 * Skip: the engine advances 5 FX frames per tick, pending cues fire immediately, hit-stops are
 * dropped; timelines started while skipping spawn half the particles and no shake/hit-stop.
 * The runner is DOM-free (unit-tested in node); `engine.ts` binds it to the clock and a canvas.
 */
import type { HapticKind } from '@/ui/audio/haptics';
import type { SfxName } from '@/ui/audio/sfx';
import type { PlayerId } from '@/engine';
import { ParticlePool, POOL_CAP } from './pool';
import { stepParticles, writeParticle, type PSpec } from './particles';
import { mixSeed, mulberry32, type Rng } from './rng';
import type { RectLike } from './coords';

/** Intensity tiers (VFX.md §6.1) and their spawn caps. */
export type Tier = 0 | 1 | 2 | 3 | 4;
export const TIER_CAP: Record<Tier, number> = { 0: 8, 1: 40, 2: 100, 3: 200, 4: 300 };

/** DOM-side hooks a timeline may call (implemented by the game view; all optional). */
export interface FxDom {
  /** Tier pop of a space's icon: scale `from` → 1 with easeOutBack(c1) over `frames`. */
  pop?(space: number, o: { from: number; c1: number; frames: number }): void;
  /** Space zoom punch 1 → k (5 f outQuad) → 1 (7 f inOutQuad). */
  zoomPunch?(space: number, k: number): void;
  /** "Under construction" dim of the space icon (on) / restore (off). */
  dim?(space: number, on: boolean): void;
  /** Close-up card (VFX.md §7.2b.10): 'in' at f0, 'pop' at swap, 'out' at the end. */
  closeUp?(space: number, player: PlayerId, level: number, phase: 'in' | 'pop' | 'out'): void;
  /** Spotlight dim of the table (alpha 0.25 in 6 f / out 8 f). */
  spotlight?(on: boolean): void;
  /** Number pop / caption next to a player's panel (floats are DOM text; the canvas never draws text). */
  floatText?(player: PlayerId, text: string): void;
  /** Panel bump (receiver of money / stars). */
  panelBump?(player: PlayerId): void;
}

/** What the reduced-motion path highlights (static colour frame for ~800 ms). */
export type HighlightTarget = { space: number } | { panel: PlayerId } | { spaces: readonly number[] } | { stage: true };

export interface EmitCtx {
  readonly rng: Rng;
  /** Board unit in px. */
  readonly u: number;
  /** Count multiplier (quality × skip). */
  readonly q: number;
  /** Spawn one particle; false when refused by the budget/cap. */
  emit(p: PSpec): boolean;
  /** Request `n` particles at once (count scaled by q, then budgeted) and spawn them via `make(k, n)`. */
  burst(n: number, make: Maker): number;
}

/** Builds the k-th of n particles (the emit context gives the effect's seeded RNG). */
export type Maker = (k: number, n: number, e: EmitCtx) => PSpec;

export type Action =
  | { k: 'spawn'; fn: (e: EmitCtx) => void }
  | { k: 'shake'; px: number; ms: number }
  | { k: 'flash'; alpha: number; frames: number; x: number; y: number; r: number; color?: string }
  | { k: 'hitStop'; frames: number }
  | { k: 'sfx'; name: SfxName; pitch?: number; gain?: number; rm?: boolean }
  | { k: 'haptic'; kind: HapticKind; rm?: boolean }
  | { k: 'cue'; name: string }
  | { k: 'dom'; fn: (dom: FxDom) => void }
  | { k: 'block' };

export interface Op {
  f: number;
  a: Action;
}

/** `t(frame, action)`: one timeline op. */
export const t = (f: number, a: Action): Op => ({ f: Math.max(0, Math.round(f)), a });

// Action constructors ------------------------------------------------------------------------
export const spawn = (fn: (e: EmitCtx) => void): Action => ({ k: 'spawn', fn });
export const burst = (n: number, make: Maker): Action => ({ k: 'spawn', fn: (e) => void e.burst(n, make) });
export const shake = (px: number, ms: number): Action => ({ k: 'shake', px, ms });
export const flash = (x: number, y: number, r: number, alpha: number, frames: number, color?: string): Action => ({
  k: 'flash',
  x,
  y,
  r,
  alpha,
  frames,
  ...(color ? { color } : {}),
});
export const hitStop = (frames: number): Action => ({ k: 'hitStop', frames });
export const sfx = (name: SfxName, o: { pitch?: number; gain?: number; rm?: boolean } = {}): Action => ({ k: 'sfx', name, ...o });
export const haptic = (kind: HapticKind, rm = false): Action => ({ k: 'haptic', kind, rm });
export const cue = (name: string): Action => ({ k: 'cue', name });
export const dom = (fn: (d: FxDom) => void): Action => ({ k: 'dom', fn });
export const block = (): Action => ({ k: 'block' });

/** Semitones → playback pitch. */
export const semi = (k: number): number => 2 ** (k / 12);

export interface Timeline {
  name: string;
  tier: Tier;
  priority: number;
  /** Ops sorted by frame (stable). */
  ops: Op[];
  /** Frame at which play() resolves. */
  block: number;
  /** Last frame with an op (the effect also waits for its particles). */
  end: number;
  /** Canvas region needed (layer px). */
  bounds: RectLike;
  highlight?: HighlightTarget;
}

/** Build a timeline: sorts ops, derives block (first `block` op, else 0) and end. */
export function timeline(
  name: string,
  tier: Tier,
  priority: number,
  ops: Op[],
  bounds: RectLike,
  highlight?: HighlightTarget,
): Timeline {
  const sorted = ops.map((o, i) => ({ o, i })).sort((a, b) => a.o.f - b.o.f || a.i - b.i).map((x) => x.o);
  const b = sorted.find((o) => o.a.k === 'block');
  const end = sorted.length ? sorted[sorted.length - 1]!.f : 0;
  const tl: Timeline = { name, tier, priority, ops: sorted, block: b ? b.f : 0, end, bounds };
  if (highlight) tl.highlight = highlight;
  return tl;
}

/** Axis-aligned bounds accumulator. */
export class Bounds {
  private x0 = Infinity;
  private y0 = Infinity;
  private x1 = -Infinity;
  private y1 = -Infinity;
  add(x: number, y: number, r = 0): this {
    this.x0 = Math.min(this.x0, x - r);
    this.y0 = Math.min(this.y0, y - r);
    this.x1 = Math.max(this.x1, x + r);
    this.y1 = Math.max(this.y1, y + r);
    return this;
  }
  rect(): RectLike {
    if (this.x0 > this.x1) return { x: 0, y: 0, width: 0, height: 0 };
    return { x: this.x0, y: this.y0, width: this.x1 - this.x0, height: this.y1 - this.y0 };
  }
}

export interface RunnerHooks {
  sfx?(name: SfxName, o: { pitch?: number; gain?: number }): void;
  haptic?(kind: HapticKind): void;
  shake?(px: number, ms: number): void;
  dom?: FxDom;
}

export interface EffectStats {
  /** Particles requested by the timeline (before quality/budget/cap). */
  requested: number;
  /** Particles actually spawned. */
  spawned: number;
  /** Flash frames drawn. */
  flashFrames: number;
}

interface CueWait {
  name: string;
  resolve: () => void;
}

export class Effect {
  /** Next FX frame to run (fractional when the effect is stretched, `rate` < 1). */
  f = 0;
  idx = 0;
  blocked = true;
  finished = false;
  readonly stats: EffectStats = { requested: 0, spawned: 0, flashFrames: 0 };
  readonly fired = new Set<string>();
  readonly waits: CueWait[] = [];
  readonly cap: number;
  readonly emit: EmitCtx;
  readonly block: Promise<void>;
  readonly done: Promise<void>;
  resolveBlock!: () => void;
  resolveDone!: () => void;

  constructor(
    readonly id: number,
    readonly tl: Timeline,
    readonly runner: Runner,
    rng: Rng,
    readonly u: number,
    q: number,
    /** Started while skipping: no shake / hit-stop. */
    readonly quiet: boolean,
    /** Quality 'low': no `glow` sprites (the big soft additive ones), no shake. */
    readonly lite = false,
    /** Timeline frames per FX frame: < 1 = stretched in proportion (EVENT_EXTEND, `extendRate`). */
    readonly rate = 1,
    /** Timeline frame at which `block` resolves (default: the timeline's block frame). */
    readonly blockAt = tl.block,
  ) {
    this.cap = TIER_CAP[tl.tier];
    this.block = new Promise((r) => (this.resolveBlock = r));
    this.done = new Promise((r) => (this.resolveDone = r));
    const pool = runner.pool;
    const unit = u / 30;
    const one = (p: PSpec): boolean => {
      if (this.stats.spawned >= this.cap) return false;
      if (lite && p.anim === 'glow') return false;
      const i = pool.alloc(tl.priority, id);
      if (i < 0) return false;
      writeParticle(pool, i, p, unit, rate);
      this.stats.spawned++;
      return true;
    };
    this.emit = {
      rng,
      u,
      q,
      emit: (p) => {
        this.stats.requested++;
        return pool.request(1, tl.priority) ? one(p) : false;
      },
      burst: (n, make) => {
        if (n <= 0) return 0;
        this.stats.requested += n;
        const want = Math.max(1, Math.round(n * q));
        const room = Math.max(0, this.cap - this.stats.spawned);
        const got = Math.min(pool.request(Math.min(want, room), tl.priority), room);
        let made = 0;
        for (let k = 0; k < got; k++) {
          // Evenly subsample the requested set when trimmed.
          const idx = got === n ? k : Math.floor((k * n) / got);
          if (one(make(idx, n, this.emit))) made++;
        }
        return made;
      },
    };
  }

  /** Resolve once the named cue fired (immediately if already fired, absent, or the effect ended). */
  cue(name: string): Promise<void> {
    if (this.finished || this.fired.has(name) || !this.tl.ops.some((o) => o.a.k === 'cue' && o.a.name === name)) return Promise.resolve();
    return new Promise((resolve) => this.waits.push({ name, resolve }));
  }

  fireCue(name: string): void {
    if (this.fired.has(name)) return;
    this.fired.add(name);
    for (let i = this.waits.length - 1; i >= 0; i--) {
      const w = this.waits[i]!;
      if (w.name === name) {
        this.waits.splice(i, 1);
        w.resolve();
      }
    }
  }

  /** Release every waiter (end / cancel). */
  settle(): void {
    this.finished = true;
    this.blocked = false;
    for (const w of this.waits.splice(0)) w.resolve();
    this.resolveBlock();
    this.resolveDone();
  }
}

export interface StartOptions {
  u: number;
  seed?: number;
  /** Count multiplier from the quality setting (1 high, 0.5 low). */
  quality?: number;
  /** Accent (§6.2 demotion): no shake / hit-stop / flash, like an effect started while skipping. */
  quiet?: boolean;
  /** Quality 'low' (VFX.md §15.4): no soft additive glows (incl. flashes), no shake. */
  lite?: boolean;
  /** Timeline frames per FX frame (< 1: the whole effect plays slower in proportion; `extendRate`). */
  rate?: number;
  /** Timeline frame at which play() resolves instead of the timeline's block frame (`extendBlock`). */
  block?: number;
}

/** Log of executed side effects (tests / determinism checks). */
export interface RunLogEntry {
  frame: number;
  effect: number;
  k: Action['k'];
  v: string;
}

export class Runner {
  readonly pool: ParticlePool;
  readonly effects: Effect[] = [];
  /** FX frames executed (global). */
  frame = 0;
  /** Hit-stop frames left (FX time frozen). */
  freeze = 0;
  skipping = false;
  /** Frames (global) on which a flash started, for the 1 s flash budget. */
  private flashFrames: number[] = [];
  private nextId = 1;
  log: RunLogEntry[] | null = null;

  constructor(
    public hooks: RunnerHooks = {},
    cap = POOL_CAP,
    private baseSeed = 0x5eed,
  ) {
    this.pool = new ParticlePool(cap);
  }

  get idle(): boolean {
    return this.effects.length === 0 && this.pool.liveCount === 0;
  }

  start(tl: Timeline, o: StartOptions): Effect {
    const id = this.nextId++;
    const rng = mulberry32(o.seed ?? mixSeed(this.baseSeed, id));
    const quiet = this.skipping || !!o.quiet;
    const q = (o.quality ?? 1) * (quiet ? 0.5 : 1);
    const e = new Effect(id, tl, this, rng, o.u, q, quiet, !!o.lite, o.rate ?? 1, o.block ?? tl.block);
    this.effects.push(e);
    return e;
  }

  /** Advance `n` FX frames (engine: 1 per 30 Hz tick × speed, 5 when skipping). */
  advance(n: number): void {
    for (let k = 0; k < n; k++) {
      if (this.freeze > 0 && !this.skipping) {
        this.freeze--;
        continue;
      }
      this.freeze = 0;
      stepParticles(this.pool);
      for (const e of this.effects) this.runFrame(e);
      this.frame++;
      this.reap();
    }
  }

  /** Skip tap: fire pending cues now, drop hit-stops; the engine runs 5 frames per tick. */
  skip(): void {
    this.skipping = true;
    this.freeze = 0;
    for (const e of this.effects)
      for (const o of e.tl.ops) if (o.a.k === 'cue' && !e.fired.has(o.a.name)) this.exec(e, o);
  }

  /** Cancel everything (screen exit, resize, visibility change). */
  stopAll(): void {
    for (const e of this.effects.splice(0)) e.settle();
    this.pool.clear();
    this.freeze = 0;
    this.skipping = false;
  }

  private runFrame(e: Effect): void {
    const ops = e.tl.ops;
    while (e.idx < ops.length && ops[e.idx]!.f <= e.f) this.exec(e, ops[e.idx++]!);
    if (e.blocked && e.f >= e.blockAt) {
      e.blocked = false;
      e.resolveBlock();
    }
    e.f += e.rate;
  }

  private reap(): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]!;
      if (e.f > e.tl.end && e.idx >= e.tl.ops.length && this.pool.countOf(e.id) === 0) {
        this.effects.splice(i, 1);
        e.settle();
      }
    }
    if (!this.effects.length && this.pool.liveCount === 0) this.skipping = false;
  }

  private note(e: Effect, k: Action['k'], v: string): void {
    this.log?.push({ frame: this.frame, effect: e.id, k, v });
  }

  private exec(e: Effect, o: Op): void {
    const a = o.a;
    const h = this.hooks;
    switch (a.k) {
      case 'spawn':
        a.fn(e.emit);
        return;
      case 'shake':
        if (e.quiet || e.lite || this.skipping) return;
        this.note(e, 'shake', `${a.px}/${a.ms}`);
        h.shake?.(a.px, a.ms / e.rate);
        return;
      case 'hitStop':
        if (e.quiet || this.skipping) return;
        this.note(e, 'hitStop', String(a.frames));
        this.freeze = Math.max(this.freeze, a.frames);
        return;
      case 'flash': {
        if (e.quiet && !this.skipping) return;
        // Flash budget (VFX.md §3.7/§8.1): ≤ 3 flash frames per 1 s window, alpha ≤ 0.25.
        const since = this.frame - 30;
        this.flashFrames = this.flashFrames.filter((f) => f > since);
        const frames = Math.min(a.frames, 3 - this.flashFrames.length);
        if (frames <= 0) return;
        for (let i = 0; i < frames; i++) this.flashFrames.push(this.frame + i);
        e.stats.flashFrames += frames;
        this.note(e, 'flash', `${frames}`);
        const alpha = Math.min(0.25, a.alpha);
        // A large soft additive glow (no full-screen rectangle).
        e.emit.emit({
          anim: 'glow',
          x: a.x,
          y: a.y,
          life: frames + 1,
          s: a.r / 32 / (e.u / 30),
          a: alpha * 1.6,
          fadeOut: frames + 1,
          blend: 'add',
          layer: 3,
          tint: a.color ?? '#FFFFFF',
        });
        return;
      }
      case 'sfx':
        this.note(e, 'sfx', `${a.name}@${(a.pitch ?? 1).toFixed(3)}`);
        h.sfx?.(a.name, { ...(a.pitch !== undefined ? { pitch: a.pitch } : {}), ...(a.gain !== undefined ? { gain: a.gain } : {}) });
        return;
      case 'haptic':
        this.note(e, 'haptic', a.kind);
        h.haptic?.(a.kind);
        return;
      case 'cue':
        if (e.fired.has(a.name)) return;
        this.note(e, 'cue', a.name);
        e.fireCue(a.name);
        return;
      case 'dom':
        if (h.dom) a.fn(h.dom);
        return;
      case 'block':
        return;
    }
  }
}

/**
 * Frames an effect lasts: its last op, or the last particle of a spawn (delay + life), whichever is
 * later. The spawns are dry-run against a recording context (no pool, a throwaway RNG); the presets'
 * spawn functions only emit.
 */
export function timelineFrames(tl: Timeline, u = 30): number {
  let end = tl.end;
  let at = 0;
  const see = (p: PSpec): boolean => {
    end = Math.max(end, at + (p.delay ?? 0) + p.life);
    return true;
  };
  const rng = mulberry32(1);
  const ctx: EmitCtx = {
    rng,
    u,
    q: 1,
    emit: see,
    burst: (n, make) => {
      for (let k = 0; k < n; k++) see(make(k, n, ctx));
      return n;
    },
  };
  for (const o of tl.ops) {
    at = o.f;
    if (o.a.k === 'spawn') o.a.fn(ctx);
    else if (o.a.k === 'flash') end = Math.max(end, at + o.a.frames + 1);
  }
  return end;
}

/**
 * Rate (timeline frames per FX frame) that stretches an event's effect in proportion so it lasts
 * `EVENT_EXTEND.motionMs` longer (`stretch` = fx/time.ts `eventStretch(effect ms)`).
 */
export function extendRate(tl: Timeline, stretch: (ms: number) => number, u = 30): number {
  return 1 / stretch((timelineFrames(tl, u) * 1000) / 30);
}

/**
 * Block frame (timeline frames) of an effect stretched by `rate` such that whoever awaits it waits
 * exactly `frames` FX frames longer than for the unstretched effect (EVENT_EXTEND.motionMs: an
 * event's effect holds the sequence that much longer, its tail keeps playing after). A timeline
 * without a block (fire and forget) keeps none.
 */
export function extendBlock(tl: Timeline, rate: number, frames: number): number {
  if (tl.block <= 0) return tl.block;
  return Math.min(timelineFrames(tl), (tl.block + frames) * rate);
}

/**
 * Reduced motion / no-canvas path (VFX.md §8.3): no particles, no shake; the timeline's first sfx
 * and haptic (plus ops marked `rm`) play, every cue fires immediately, and one static highlight.
 */
export function runReduced(
  tl: Timeline,
  hooks: RunnerHooks & { highlight?(target: HighlightTarget, ms: number): void },
  withSound = true,
): void {
  if (withSound) {
    let sfxDone = false;
    let hapDone = false;
    for (const o of tl.ops) {
      const a = o.a;
      if (a.k === 'sfx' && (!sfxDone || a.rm)) {
        sfxDone = true;
        hooks.sfx?.(a.name, { ...(a.pitch !== undefined ? { pitch: a.pitch } : {}), ...(a.gain !== undefined ? { gain: a.gain } : {}) });
      } else if (a.k === 'haptic' && (!hapDone || a.rm)) {
        hapDone = true;
        hooks.haptic?.(a.kind);
      }
    }
  }
  if (tl.highlight) hooks.highlight?.(tl.highlight, 800);
}
