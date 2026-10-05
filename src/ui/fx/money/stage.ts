/**
 * The money stage (docs/MONEY-EVENTS.md §2): ONE full-screen layer for money cut-ins, created once,
 * parked off-screen by a transform while idle (no show/hide paint, no compositor layer, no timers).
 *
 *   .money-stage   root: positions + fades the stage (opacity), parked off-screen while idle
 *     .ms-scaler   THE compositor layer while live: laid out at render scale s × the screen and
 *                  scaled by 1/s (`will-change: transform`), so Chromium rasterizes it at s × the
 *                  device resolution — s² of the memory (render.ts, MONEY-EVENTS §12)
 *       .ms-dim      static vignette + dim
 *       .ms-hero     the zoomed hero picture (city, plot, vault, bank…); with 3D on it tilts back
 *                    (rotateX, its own layer), else a foreshortened 2D scale
 *       .ms-top      (3D: its own layer above the hero, raster scale held like the scaler's)
 *         .ms-wallets  four wallet piles, one per seat edge, rotated to face their seat (over the hero);
 *                      fixed view (`MoneyHost.upright`): upright, each standing on its seat's panel
 *         .ms-fg       plaques, one-shot sprites, the flying-coin pool
 *
 * All stage geometry (`geom`, `local()`) is in the scaler's px (= screen px × s).
 * Extra compositor layers while a scene runs: the scaler (2D) or scaler + hero + the squashed
 * wallets / coins above it (3D); idle: 0.
 *
 * The stage knows nothing about the game: the wiring injects a host (rect providers for the seat
 * panels / board / tiles, space art, and a board-camera callback). Everything moves on one
 * MoneyClock per scene (fx/money/clock.ts) — the shared 30 Hz grid and THE TIME POLICY.
 */
import type { Seat } from '@/engine';
import { fmtMoney } from '@/i18n';
import { headless, reducedMotion } from '../time';
import { loadMoneyAtlas, paintFrame, animSize } from './atlas';
import { MoneyClock, f } from './clock';
import { CoinPool, type Pt } from './coins';
import type { Tier } from './denom';
import { easeOutCubic } from './denom';
import { CoinSound } from './sound';
import { SEAT_ROT, Wallet, walletGeom, type TweenHost, type UprightSlide } from './wallet';
import type { MoneyAnimName as FxAnimName } from '@/content/fx/money-manifest';
import '@/styles/money.css';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a hero needs to know about a board space. */
export interface SpaceArt {
  /** Icon id (src/content/icons) of the space's landmark. */
  icon: string;
  name: string;
  /** Group colour band. */
  color?: string;
}

/** Board camera (the wiring binds it to the board): pull back + tilt while a cut-in is up. */
export type BoardCamera = (state: 'in' | 'out', tier: Tier, ms: number) => void;

export interface MoneyHost {
  /** Element the stage is appended to (the game root; the stage fills it). */
  parent: HTMLElement;
  /** The board's rect (client px): wallets line up on its axes. */
  boardRect?(): Rect | null;
  /** A seat panel's rect (client px), for the settle flight of a wallet back to its panel. */
  seatRect?(seat: Seat): Rect | null;
  /** A board space's rect (client px): the hero flies back there at settle. */
  tileRect?(spaceIndex: number): Rect | null;
  /** Where a space's pop-out building at `level` stands (client px): the build hero lands there. */
  buildingRect?(spaceIndex: number, level: number): Rect | null;
  /** Landmark art / name of a space. */
  space?(spaceIndex: number): SpaceArt | null;
  camera?: BoardCamera;
  /** z-index of the stage (default 45: above the board and FX canvas, below menus). */
  zIndex?: number;
  /**
   * Fixed view (src/ui/orientation.ts, one human vs CPUs): the whole cut-in faces S — hero,
   * plaques, stamps, wallet labels — while wallets still stand at their seat's edge and coins fly
   * between the real seats. Collect-from-all shows one total instead of one per seat.
   */
  upright?: boolean;
}

/** Stage geometry for the current scene (stage-local CSS px). */
export interface StageGeom {
  W: number;
  H: number;
  /** Short side. */
  S: number;
  /** Board centre. */
  c: Pt;
  /** Wallet coin width. */
  coin: number;
  /** Hero box side. */
  hero: number;
}

/** Unit vector from a seat's edge toward the centre ("up" for that seat). */
export const SEAT_UP: Record<Seat, Pt> = { S: { x: 0, y: -1 }, N: { x: 0, y: 1 }, E: { x: -1, y: 0 }, W: { x: 1, y: 0 } };
export const SEATS: readonly Seat[] = ['S', 'E', 'N', 'W'];

/** A hero transform (written as one `transform`). */
export interface HeroPose {
  x: number;
  y: number;
  s: number;
  /** Rotation about the screen normal (deg, faces a seat). */
  rz: number;
  /** Lean back (deg): drawn as a 2D foreshortening, cos(rx) along the facing axis. */
  rx: number;
  o: number;
}

export class Plaque {
  readonly el: HTMLElement;
  private tEl: HTMLElement;
  private aEl: HTMLElement;
  value = 0;
  /** Where the count is heading (adds accumulate even mid-count). */
  target = 0;
  private stopCount: (() => void) | null = null;
  constructor(doc: Document) {
    this.el = doc.createElement('div');
    this.el.className = 'ms-plq';
    this.tEl = doc.createElement('span');
    this.tEl.className = 'ms-plq-t';
    this.aEl = doc.createElement('b');
    this.aEl.className = 'ms-plq-a';
    this.el.append(this.tEl, this.aEl);
  }
  set(o: { title?: string; amount?: number | null; sign?: '' | '+' | '−'; tone?: 'gold' | 'bad' | 'good' }): void {
    if (o.title !== undefined) this.tEl.textContent = o.title;
    this.tEl.hidden = !o.title;
    if (o.amount !== undefined) {
      this.aEl.hidden = o.amount === null;
      if (o.amount !== null) {
        this.target = o.amount;
        this.write(o.amount);
      }
    }
    if (o.sign !== undefined) this.aEl.dataset.sign = o.sign;
    this.el.dataset.tone = o.tone ?? 'gold';
  }
  write(v: number): void {
    this.value = v;
    // The app's language, like the wallets (not the device locale: other digits / separators).
    this.aEl.textContent = (this.aEl.dataset.sign ?? '') + fmtMoney(Math.round(v));
  }
  place(p: Pt, rot: number, scale = 1, opacity = 1): void {
    this.el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) translate(-50%,-50%) rotate(${rot}deg) scale(${scale.toFixed(3)})`;
    this.el.style.opacity = String(opacity);
  }
  stopCounting(): void {
    this.stopCount?.();
    this.stopCount = null;
    this.write(this.target);
  }
  hide(): void {
    this.stopCount?.();
    this.stopCount = null;
    this.el.style.opacity = '0';
    this.el.style.transform = 'translate(-9999px,0)';
  }
  /** Count up by `v` (on top of any count in progress). */
  add(clock: MoneyClock, v: number, ms: number): Promise<void> {
    return this.count(clock, this.target + v, ms);
  }

  /** Count to `to` over `ms` scene ms (ease-out cubic, ≤ 15 writes / s). */
  count(clock: MoneyClock, to: number, ms: number): Promise<void> {
    this.stopCount?.();
    this.target = to;
    const from = this.value;
    const t0 = clock.t;
    let last = -Infinity;
    if (ms <= 0) {
      this.write(to);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const stop = clock.add((t) => {
        const u = Math.min(1, (t - t0) / ms);
        if (u >= 1 || t - last >= 66) {
          last = t;
          this.write(from + (to - from) * easeOutCubic(u));
        }
        if (u >= 1) {
          resolve();
          return false;
        }
        return true;
      });
      this.stopCount = () => {
        stop();
        resolve();
      };
    });
  }
}

const N_FX = 8;
/** Frames the stage holds at its small layout size so its layers rasterize there (render scale < 1). */
export const RASTER_HOLD_F = 3;
const N_PLAQUES = 4;

export class MoneyStage implements TweenHost {
  readonly root: HTMLElement;
  /** The scaled container (render scale, MONEY-EVENTS §12). */
  readonly scaler: HTMLElement;
  readonly dim: HTMLElement;
  readonly wallets: Record<Seat, Wallet>;
  readonly hero: HTMLElement;
  readonly heroIn: HTMLElement;
  readonly fg: HTMLElement;
  readonly plaques: Plaque[] = [];
  readonly stamp: HTMLElement;
  readonly coins: CoinPool;
  readonly sound = new CoinSound();
  private fxNodes: HTMLElement[] = [];
  private fxFree: HTMLElement[] = [];
  clock: MoneyClock | null = null;
  geom: StageGeom = { W: 0, H: 0, S: 0, c: { x: 0, y: 0 }, coin: 40, hero: 300 };
  private origin: Pt = { x: 0, y: 0 };
  heroPose: HeroPose = { x: 0, y: 0, s: 1, rz: 0, rx: 0, o: 0 };
  /** A scene is up (root live). */
  live = false;
  /** The last scene asked to keep the stage up for a follow-up (§4.3 one cut-in). */
  kept = false;
  private queue: Promise<void> = Promise.resolve();
  /** Event kinds played since `newTurn()` (a repeat plays at 0.7×). */
  private played = new Set<string>();
  /** Diagnostics: scenes run, last scene's peak flying coins. */
  stats = { scenes: 0, peakFlying: 0, peakNodes: 0 };
  /** Render scale of the stage's layer (1 = device resolution; render.ts tiers). */
  scale = 1;
  /** The hero tilts back in 3D (and the scaler keeps a perspective). */
  tilt = false;
  private pending: { scale: number; tilt: boolean } | null = null;
  /** Called with each scene-clock step's JS ms and the real ms since the previous step (frame health). */
  monitor: ((stepMs: number, gapMs: number) => void) | null = null;
  /** Called when a cut-in has gone down (not when kept up for a follow-up). */
  onCutInEnd: (() => void) | null = null;

  constructor(readonly host: MoneyHost) {
    const doc = host.parent.ownerDocument;
    const el = (cls: string, tag = 'div'): HTMLElement => {
      const e = doc.createElement(tag);
      e.className = cls;
      return e;
    };
    this.root = el('money-stage');
    this.scaler = el('ms-scaler');
    this.root.setAttribute('aria-hidden', 'true');
    if (host.zIndex !== undefined) this.root.style.zIndex = String(host.zIndex);
    this.dim = el('ms-dim');
    const walletLayer = el('ms-wallets');
    this.wallets = {} as Record<Seat, Wallet>;
    for (const s of SEATS) {
      const w = new Wallet(doc);
      w.el.dataset.seat = s;
      walletLayer.append(w.el);
      this.wallets[s] = w;
    }
    this.hero = el('ms-hero');
    this.heroIn = el('ms-hero-in');
    this.hero.append(this.heroIn);
    this.fg = el('ms-fg');
    for (let i = 0; i < N_PLAQUES; i++) {
      const p = new Plaque(doc);
      p.hide();
      this.plaques.push(p);
      this.fg.append(p.el);
    }
    this.stamp = el('ms-stamp');
    this.fg.append(this.stamp);
    for (let i = 0; i < N_FX; i++) {
      const n = el('ms-fx', 'i');
      this.fg.append(n);
      this.fxNodes.push(n);
      this.fxFree.push(n);
    }
    this.coins = new CoinPool(this.fg, () => this.clock);
    // Wallets over the hero: a zoomed-in hero reaches into the seat edges; the piles stay readable.
    // Wallets and coins in one container: with 3D on it is the one layer above the tilted hero, and
    // `will-change` holds its raster scale too (money.css).
    const top = el('ms-top');
    top.append(walletLayer, this.fg);
    this.scaler.append(this.dim, this.hero, top);
    this.root.append(this.scaler);
    host.parent.append(this.root);
    void loadMoneyAtlas();
  }

  /** Remove the stage (screen unmount). */
  destroy(): void {
    // Like a resize: a scene in progress finishes at once (its 'settle' / done resolve) and parks.
    this.abort();
    this.root.remove();
  }

  /**
   * Cut a running cut-in short (resize / rotation, screen exit): what was ticking finishes at once,
   * the scene body runs to its end without a clock (muted, nothing shown: the stage is parked), so
   * its cues fire — the sequencer applies the state and the next queued scene plays as usual.
   */
  abort(): void {
    // The rest of the cut-short scene runs silently (sound back on at the next `open()`).
    if (this.clock || this.live) this.sound.enabled = false;
    this.park();
  }

  /** Free one-shot sprite nodes (pool of 8; tests). */
  get fxAvailable(): number {
    return this.fxFree.length;
  }

  /** A new turn: repeated event kinds play at full length again. */
  newTurn(): void {
    this.played.clear();
  }

  /** Turbo factor for an event kind (0.7 when it already played this turn). */
  turbo(kind: string): number {
    const k = this.played.has(kind) ? 0.7 : 1;
    this.played.add(kind);
    return k;
  }

  /** Serialize scenes: `fn` starts when the previous scene is done. */
  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // ------------------------------------------------------------------ TweenHost

  now(): number {
    return this.clock?.t ?? 0;
  }

  reduced(): boolean {
    return reducedMotion();
  }

  every(fn: (t: number) => boolean): void {
    this.clock?.add(fn);
  }

  /** Run `fn(u)` for u 0→1 over `ms` scene ms (reduced motion: jumps to 1, keeps the time). */
  tween(ms: number, fn: (u: number) => void): Promise<void> {
    const c = this.clock;
    if (!c || ms <= 0 || headless()) {
      fn(1);
      return Promise.resolve();
    }
    const t0 = c.t;
    if (this.reduced()) {
      fn(1);
      return c.until(t0 + ms);
    }
    fn(0);
    return new Promise((resolve) => {
      c.add((t) => {
        const u = Math.min(1, (t - t0) / ms);
        fn(u);
        if (u >= 1) {
          resolve();
          return false;
        }
        return true;
      });
    });
  }

  // ------------------------------------------------------------------ lifecycle

  /**
   * Render scale and 3D for the next cut-in (a cut-in in progress keeps its own: it is measured once).
   * Takes effect at once when the stage is parked.
   */
  setRender(o: { scale: number; tilt: boolean }): void {
    const scale = Math.min(1, Math.max(0.25, o.scale));
    if (this.live) this.pending = { scale, tilt: o.tilt };
    else {
      this.scale = scale;
      this.tilt = o.tilt;
    }
  }

  /** Measure the layout (one rect read per scene). */
  measure(): StageGeom {
    if (this.pending) {
      this.scale = this.pending.scale;
      this.tilt = this.pending.tilt;
      this.pending = null;
    }
    const k = this.scale;
    const pr = this.host.parent.getBoundingClientRect();
    this.origin = { x: pr.left, y: pr.top };
    const W0 = pr.width || (typeof innerWidth === 'number' ? innerWidth : 1600);
    const H0 = pr.height || (typeof innerHeight === 'number' ? innerHeight : 1000);
    // The scaler is laid out at k × the screen and scaled back up (MONEY-EVENTS §12).
    const sc = this.scaler.style;
    sc.width = `${(W0 * k).toFixed(1)}px`;
    sc.height = `${(H0 * k).toFixed(1)}px`;
    // Scale 1 first: see `open()` (the raster scale is fixed by the first raster at this size).
    sc.transform = '';
    sc.perspective = this.tilt ? `${Math.round(1200 * k)}px` : '';
    this.scaler.classList.toggle('is-3d', this.tilt);
    const W = W0 * k;
    const H = H0 * k;
    const S = Math.min(W, H);
    const b = this.host.boardRect?.() ?? null;
    const c = b ? { x: (b.x - pr.left + b.w / 2) * k, y: (b.y - pr.top + b.h / 2) * k } : { x: W / 2, y: H / 2 };
    // Zoomed in to fill the screen (MONEY-EVENTS §11): wallet coins ≈ 9 % of the short side (a
    // readable pile ≈ 18–25 % tall at its seat edge), the hero box 80 % (its picture ≈ 60–65 %).
    const S0 = S / k;
    const coin = Math.min(120, Math.max(30, S0 * 0.09)) * k;
    const hero = Math.round(S0 * 0.8 * k);
    this.geom = { W, H, S, c, coin, hero };
    this.coins.center = c;
    this.root.style.setProperty('--pu', `${(Math.max(9, S0 * 0.026) * k).toFixed(2)}px`);
    return this.geom;
  }

  /** Client rect → stage-local rect. */
  local(r: Rect): Rect {
    const k = this.scale;
    return { x: (r.x - this.origin.x) * k, y: (r.y - this.origin.y) * k, w: r.w * k, h: r.h * k };
  }

  /** True when the cut-in faces S whatever the seat (fixed view). */
  get upright(): boolean {
    return !!this.host.upright;
  }

  /** The seat the cut-in's composition for `seat` faces (S in the fixed view). */
  face(seat: Seat): Seat {
    return this.host.upright ? 'S' : seat;
  }

  /** Rotation of content that faces `seat` (0 in the fixed view). */
  rot(seat: Seat): number {
    return SEAT_ROT[this.face(seat)];
  }

  /** Where a seat's wallet stands (its bottom-centre): on the screen edge, on the board's axis. */
  seatAnchor(seat: Seat): Pt {
    const { W, H, S, c } = this.geom;
    const m = Math.max(4, S * 0.012);
    switch (seat) {
      case 'S':
        return { x: c.x, y: H - m };
      case 'N':
        return { x: c.x, y: m };
      case 'E':
        return { x: W - m, y: c.y };
      default:
        return { x: m, y: c.y };
    }
  }

  /** A point `d` × short side from the centre toward (d < 0: away from) a seat. */
  toward(seat: Seat, d: number): Pt {
    const u = SEAT_UP[seat];
    const { c, S } = this.geom;
    return { x: c.x - u.x * d * S, y: c.y - u.y * d * S };
  }

  /**
   * Bring the stage up for a scene (or keep it up for a follow-up): new clock, vignette, camera.
   * Returns false in headless mode (the caller resolves at once).
   */
  open(tier: Tier, dim: number, factor = 1): boolean {
    if (headless()) return false;
    this.releaseClock();
    this.sound.enabled = true;
    this.clock = new MoneyClock();
    this.clock.factor = factor;
    this.clock.monitor = this.monitor;
    this.coins.hidden = this.reduced();
    this.coins.seed(4242 + this.stats.scenes * 17);
    this.coins.peakFlying = 0;
    this.coins.peakNodes = 0;
    this.stats.scenes++;
    const wasLive = this.live;
    if (!wasLive) this.measure();
    else {
      // A follow-up scene in the same cut-in: the last one's plaques and stamp go.
      for (const p of this.plaques) p.hide();
      this.stamp.style.opacity = '0';
    }
    this.live = true;
    this.root.classList.add('is-live');
    // The game under the cut-in drops what it does not need (stage.css: the dealer's layers).
    this.host.parent.classList.add('is-money-live');
    this.dim.style.opacity = String(dim);
    if (!wasLive) {
      const k = this.scale;
      if (k < 1 && !this.reduced()) {
        // Render scale (MONEY-EVENTS §12.2, measured with scripts/fx/money-raster.mjs): Chromium picks a
        // layer's raster scale at its first raster and keeps it for `will-change: transform` layers.
        // So the stage first shows (all but transparent) at its small layout size for RASTER_HOLD_F
        // frames, and only then is scaled up by 1/k: it stays rasterized at k × the device resolution
        // (k² of the memory). Laid out small and scaled at once, it was rasterized at full resolution.
        this.root.style.opacity = '0.01';
        const c = this.clock;
        void c.until(f(RASTER_HOLD_F)).then(() => {
          if (this.clock !== c) return;
          this.scaler.style.transform = `scale(${(1 / k).toFixed(5)})`;
          void this.tween(f(5), (u) => (this.root.style.opacity = String(Math.max(0.01, easeOutCubic(u)))));
        });
      } else {
        this.scaler.style.transform = k === 1 ? '' : `scale(${(1 / k).toFixed(5)})`;
        this.root.style.opacity = '0';
        void this.tween(f(5), (u) => (this.root.style.opacity = String(easeOutCubic(u))));
      }
      this.host.camera?.('in', tier, f(6));
    }
    return true;
  }

  /**
   * A scene kept the stage up for a follow-up that never came (the batch ended): take it down after
   * the queue is idle (wallets sink, everything fades, parked).
   */
  releaseKept(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.live || !this.kept) return;
      this.kept = false;
      const jobs: Promise<void>[] = [];
      for (const s of SEATS) if (this.wallets[s].visible) jobs.push(this.wallets[s].exit(this, f(5)));
      for (const p of this.plaques) jobs.push(this.tween(f(5), (u) => (p.el.style.opacity = String(Math.min(Number(p.el.style.opacity || 1), 1 - u)))));
      jobs.push(this.poseTo({ o: 0 }, f(5)));
      await Promise.all(jobs);
      await this.close('S', false);
    });
  }

  /** Take the stage down (unless `keep`: a follow-up scene continues the same cut-in). */
  async close(tier: Tier, keep = false, ms = f(5), alongside: Promise<void>[] = []): Promise<void> {
    this.stats.peakFlying = Math.max(this.coins.peakFlying, 0);
    this.stats.peakNodes = this.coins.peakNodes;
    if (keep) {
      this.kept = true;
      return;
    }
    this.kept = false;
    this.host.camera?.('out', tier, ms);
    // The fade runs with the scene's own out moves (hero to its tile, wallets sinking): one quick out.
    await Promise.all([...alongside, this.tween(ms, (u) => (this.root.style.opacity = String(1 - u * u)))]);
    this.park();
  }

  /**
   * Drop the scene clock and settle everything that was ticking on it (a kept follow-up scene gets
   * a fresh clock): pending coins land, counters jump to their targets, plaque counts stop, one-shot
   * sprites go back to the pool.
   */
  private releaseClock(): void {
    const c = this.clock;
    if (!c) return;
    this.clock = null;
    // First let everything on the clock finish (tweens resolve, coins land, counts end) …
    c.dispose();
    // … then whatever is left (coins launched meanwhile land at once: no clock).
    this.coins.flush();
    for (const s of SEATS) this.wallets[s].settleCount();
    for (const p of this.plaques) p.stopCounting();
    for (const n of this.fxNodes) this.resetFx(n);
    this.fxFree = [...this.fxNodes];
  }

  /** Idle: off-screen, no layers, no timers. */
  park(): void {
    this.releaseClock();
    this.coins.clear();
    for (const s of SEATS) this.wallets[s].hide();
    for (const p of this.plaques) p.hide();
    this.heroIn.textContent = '';
    this.hero.style.opacity = '0';
    // Drop the 3D context too: a tilted hero (and what is squashed above it) kept two layers alive
    // off-screen between cut-ins. `measure()` sets both again for the next scene.
    this.hero.style.transform = '';
    this.scaler.classList.remove('is-3d');
    this.scaler.style.perspective = '';
    this.stamp.className = 'ms-stamp';
    this.stamp.textContent = '';
    this.stamp.style.opacity = '0';
    for (const n of this.fxNodes) this.resetFx(n);
    this.fxFree = [...this.fxNodes];
    this.root.classList.remove('is-live');
    this.host.parent.classList.remove('is-money-live');
    this.root.style.opacity = '';
    this.root.style.transform = '';
    const was = this.live;
    this.live = false;
    this.kept = false;
    if (this.pending) {
      this.scale = this.pending.scale;
      this.tilt = this.pending.tilt;
      this.pending = null;
    }
    if (was) this.onCutInEnd?.();
  }

  // ------------------------------------------------------------------ parts

  /**
   * Fixed view: an upright wallet stands on its seat's panel (the side columns, where that
   * player's cash is shown; clear of the hero), kept on screen, and slides out past the nearer
   * side edge. Null without a panel rect (then it stands on its edge like the table model).
   */
  private uprightSpot(seat: Seat): { anchor: Pt; slide: UprightSlide } | null {
    const r = this.host.seatRect?.(seat);
    if (!r) return null;
    const { W, H, S, c, coin } = this.geom;
    const m = Math.max(4, S * 0.012);
    const g = walletGeom(coin, 20 * this.scale);
    const l = this.local(r);
    const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
    const x = clamp(l.x + l.w / 2, m + g.w / 2, Math.max(m + g.w / 2, W - m - g.w / 2));
    const y = clamp(l.y + l.h / 2 + g.h / 2, Math.min(H - m, m + g.h), H - m);
    const left = x < c.x;
    return { anchor: { x, y }, slide: { out: { x: left ? -1 : 1, y: 0 }, hide: (left ? x : W - x) + g.w / 2 + 24 * this.scale } };
  }

  /** Set up and raise a seat's wallet. */
  wallet(seat: Seat, cash: number, color: string, raise = true): Wallet {
    const w = this.wallets[seat];
    if (!w.visible) {
      const up = this.host.upright ? this.uprightSpot(seat) : null;
      const slide: UprightSlide | undefined = up?.slide ?? (this.host.upright ? { out: { x: 0, y: 1 }, hide: walletGeom(this.geom.coin, 20 * this.scale).h + 24 * this.scale } : undefined);
      w.setup({ seat, color, cash, anchor: up?.anchor ?? this.seatAnchor(seat), coin: this.geom.coin, upright: slide, minLabel: 20 * this.scale });
      if (raise) void w.enter(this);
    }
    return w;
  }

  /** Fill the hero with markup and pose it. */
  setHero(html: string, pose: Partial<HeroPose>, cls = ''): HTMLElement {
    this.heroIn.innerHTML = html;
    this.hero.className = `ms-hero ${cls}`.trim();
    const g = this.geom;
    this.hero.style.width = `${g.hero}px`;
    this.hero.style.height = `${g.hero}px`;
    this.hero.style.setProperty('--hu', `${(g.hero / 100).toFixed(2)}px`);
    this.pose({ x: g.c.x, y: g.c.y, s: 1, rz: 0, rx: 0, o: 1, ...pose });
    return this.heroIn;
  }

  pose(p: Partial<HeroPose>): void {
    const h = (this.heroPose = { ...this.heroPose, ...p });
    const g = this.geom;
    // Lean-back without 3D: the picture is foreshortened along the facing seat's axis (cos rx), and
    // pivots on its lower part so it seems to rise as it straightens (no compositor layer).
    // With 3D on (render tier, MONEY-EVENTS §12) it really tilts back (rotateX, its own layer).
    const at = `translate(${(h.x - g.hero / 2).toFixed(1)}px,${(h.y - g.hero / 2).toFixed(1)}px) rotate(${h.rz}deg)`;
    if (this.tilt) this.hero.style.transform = `${at} rotateX(${h.rx.toFixed(2)}deg) scale(${h.s.toFixed(4)})`;
    else {
      const sy = h.s * Math.cos((h.rx * Math.PI) / 180);
      this.hero.style.transform = `${at} scale(${h.s.toFixed(4)},${sy.toFixed(4)})`;
    }
    this.hero.style.opacity = h.o.toFixed(3);
  }

  /** Tween the hero pose to `to`. */
  poseTo(to: Partial<HeroPose>, ms: number, ease: (u: number) => number = easeOutCubic): Promise<void> {
    const from = { ...this.heroPose };
    return this.tween(ms, (u) => {
      const k = ease(u);
      const p: Partial<HeroPose> = {};
      for (const key of Object.keys(to) as Array<keyof HeroPose>) p[key] = from[key] + (to[key]! - from[key]) * k;
      this.pose(p);
    });
  }

  /** Shake the whole stage (circular, direction-neutral; px, frames). */
  shake(px0: number, frames = 8): Promise<void> {
    if (!px0) return Promise.resolve();
    const px = px0 * this.scale;
    return this.tween(f(frames), (u) => {
      const a = u * Math.PI * 7;
      const k = px * (1 - u) ** 2;
      this.root.style.transform = u >= 1 ? '' : `translate(${(Math.cos(a) * k).toFixed(1)}px,${(Math.sin(a * 1.3) * k).toFixed(1)}px)`;
    });
  }

  /** Play a one-shot atlas sprite at `at` (stage px): scale = display / nominal; tint for masks. */
  fx(anim: FxAnimName, at: Pt, o: { scale?: number; tint?: string; fps?: number; rot?: number } = {}): Promise<void> {
    if (!this.clock || this.reduced() || headless() || !this.fxFree.length) return Promise.resolve();
    const n = this.fxFree.pop()!;
    const { w, h, n: frames } = animSize(anim);
    const s = o.scale ?? 1;
    const ms = 1000 / (o.fps ?? 24);
    const t0 = this.clock.t;
    n.style.transform = `translate(${(at.x - (w * s) / 2).toFixed(1)}px,${(at.y - (h * s) / 2).toFixed(1)}px)` + (o.rot ? ` rotate(${o.rot}deg)` : '');
    n.style.transformOrigin = `${(w * s) / 2}px ${(h * s) / 2}px`;
    let last = -1;
    return new Promise((resolve) => {
      this.clock!.add((t) => {
        const i = Math.floor((t - t0) / ms);
        if (i >= frames) {
          this.resetFx(n);
          this.fxFree.push(n);
          resolve();
          return false;
        }
        if (i !== last) {
          last = i;
          if (!paintFrame(n, anim, i, s, o.tint)) {
            this.resetFx(n);
            this.fxFree.push(n);
            resolve();
            return false;
          }
          n.style.opacity = '1';
        }
        return true;
      });
    });
  }

  /**
   * A tool swinging in (the build hammer): frame 0 of a colour sprite at `at`, rotating from a
   * raised angle down onto the site over `ms`, then gone.
   */
  swing(anim: FxAnimName, at: Pt, seatRot: number, o: { scale?: number; ms?: number; onHit?: () => void } = {}): Promise<void> {
    if (!this.clock || this.reduced() || headless() || !this.fxFree.length) {
      o.onHit?.();
      return this.clock ? this.clock.after(o.ms ?? f(8)) : Promise.resolve();
    }
    const n = this.fxFree.pop()!;
    const { w, h } = animSize(anim);
    const s = o.scale ?? 1;
    if (!paintFrame(n, anim, 0, s)) {
      this.fxFree.push(n);
      o.onHit?.();
      return Promise.resolve();
    }
    n.style.transformOrigin = `${w * s * 0.75}px ${h * s * 0.85}px`;
    n.style.opacity = '1';
    let hit = false;
    // Anticipation: wound up further back (slow), then struck down fast (an arc about the grip),
    // a small recoil after the impact (follow-through).
    return this.tween(o.ms ?? f(8), (u) => {
      let ang: number;
      if (u < 0.45) ang = -70 - 25 * Math.sin((Math.PI / 2) * (u / 0.45));
      else if (u < 0.7) {
        const k = ((u - 0.45) / 0.25) ** 2;
        ang = -95 + 110 * k;
      } else {
        if (!hit) {
          hit = true;
          o.onHit?.();
        }
        ang = 15 - 12 * Math.sin(Math.PI * ((u - 0.7) / 0.3));
      }
      n.style.transform = `translate(${(at.x - w * s * 0.75).toFixed(1)}px,${(at.y - h * s * 0.85).toFixed(1)}px) rotate(${(seatRot + ang).toFixed(1)}deg)`;
    }).then(() => {
      if (!hit) o.onHit?.();
      this.resetFx(n);
      this.fxFree.push(n);
    });
  }

  private resetFx(n: HTMLElement): void {
    n.style.opacity = '0';
    n.style.transform = 'translate(-9999px,0)';
  }

  /** Plaques facing seats (one per entry). */
  plaque(i: number): Plaque {
    return this.plaques[i]!;
  }

  /** Show the stamp text (e.g. "×2", "인수!") at `at`, facing `seat`. */
  async stampAt(text: string, at: Pt, seat: Seat, tone: 'gold' | 'bad' = 'gold', ms = f(8)): Promise<void> {
    const s = this.stamp;
    s.textContent = text;
    s.className = `ms-stamp is-${tone}`;
    const rot = this.rot(seat) - 12;
    await this.tween(ms, (u) => {
      const k = u < 0.6 ? 2.4 - 1.5 * (u / 0.6) : 0.9 + 0.1 * ((u - 0.6) / 0.4);
      s.style.transform = `translate(${at.x.toFixed(1)}px,${at.y.toFixed(1)}px) translate(-50%,-50%) rotate(${rot}deg) scale(${k.toFixed(3)})`;
      s.style.opacity = String(Math.min(1, u * 3));
    });
  }
}
