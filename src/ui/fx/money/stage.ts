/**
 * The money stage (docs/MONEY-EVENTS.md §2): ONE full-screen layer for money cut-ins, created once,
 * parked off-screen by a transform while idle (no show/hide paint, no compositor layer, no timers).
 *
 *   .money-stage   root: static vignette + dim (opacity-composited only while live)
 *     .ms-hero     the zoomed hero picture (city, plot, vault, bank…), leaning back by a
 *                  foreshortened 2D scale (no 3D: see money.css)
 *     .ms-wallets  four wallet piles, one per seat edge, rotated to face their seat (over the hero)
 *     .ms-fg       plaques, one-shot sprites, the flying-coin pool
 *
 * Extra compositor layers while a scene runs: the root only (= 1); idle: 0.
 *
 * The stage knows nothing about the game: the wiring injects a host (rect providers for the seat
 * panels / board / tiles, space art, and a board-camera callback). Everything moves on one
 * MoneyClock per scene (fx/money/clock.ts) — the shared 30 Hz grid and THE TIME POLICY.
 */
import type { Seat } from '@/engine';
import { headless, reducedMotion } from '../time';
import { loadMoneyAtlas, paintFrame, animSize } from './atlas';
import { MoneyClock, f } from './clock';
import { CoinPool, type Pt } from './coins';
import type { Tier } from './denom';
import { easeOutCubic } from './denom';
import { CoinSound } from './sound';
import { SEAT_ROT, Wallet, type TweenHost } from './wallet';
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
  /** Landmark art / name of a space. */
  space?(spaceIndex: number): SpaceArt | null;
  camera?: BoardCamera;
  /** z-index of the stage (default 45: above the board and FX canvas, below menus). */
  zIndex?: number;
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
    this.aEl.textContent = (this.aEl.dataset.sign ?? '') + Math.round(v).toLocaleString();
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
const N_PLAQUES = 4;

export class MoneyStage implements TweenHost {
  readonly root: HTMLElement;
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

  constructor(readonly host: MoneyHost) {
    const doc = host.parent.ownerDocument;
    const el = (cls: string, tag = 'div'): HTMLElement => {
      const e = doc.createElement(tag);
      e.className = cls;
      return e;
    };
    this.root = el('money-stage');
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
    this.root.append(this.dim, this.hero, walletLayer, this.fg);
    host.parent.append(this.root);
    void loadMoneyAtlas();
  }

  /** Remove the stage (screen unmount). */
  destroy(): void {
    this.clock?.dispose();
    this.coins.clear();
    this.root.remove();
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

  /** Measure the layout (one rect read per scene). */
  measure(): StageGeom {
    const pr = this.host.parent.getBoundingClientRect();
    this.origin = { x: pr.left, y: pr.top };
    const W = pr.width || (typeof innerWidth === 'number' ? innerWidth : 1600);
    const H = pr.height || (typeof innerHeight === 'number' ? innerHeight : 1000);
    const S = Math.min(W, H);
    const b = this.host.boardRect?.() ?? null;
    const c = b ? { x: b.x - pr.left + b.w / 2, y: b.y - pr.top + b.h / 2 } : { x: W / 2, y: H / 2 };
    // Zoomed in to fill the screen (MONEY-EVENTS §11): wallet coins ≈ 9 % of the short side (a
    // readable pile ≈ 18–25 % tall at its seat edge), the hero box 80 % (its picture ≈ 60–65 %).
    const coin = Math.round(Math.min(120, Math.max(30, S * 0.09)));
    const hero = Math.round(S * 0.8);
    this.geom = { W, H, S, c, coin, hero };
    this.coins.center = c;
    this.root.style.setProperty('--pu', `${Math.max(9, S * 0.026).toFixed(1)}px`);
    return this.geom;
  }

  /** Client rect → stage-local rect. */
  local(r: Rect): Rect {
    return { x: r.x - this.origin.x, y: r.y - this.origin.y, w: r.w, h: r.h };
  }

  /** Where a seat's wallet stands: on the screen edge, on the board's axis. */
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
    this.clock = new MoneyClock();
    this.clock.factor = factor;
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
    this.dim.style.opacity = String(dim);
    if (!wasLive) {
      this.root.style.opacity = '0';
      void this.tween(f(5), (u) => (this.root.style.opacity = String(easeOutCubic(u))));
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
  async close(tier: Tier, keep = false): Promise<void> {
    this.stats.peakFlying = Math.max(this.coins.peakFlying, 0);
    this.stats.peakNodes = this.coins.peakNodes;
    if (keep) {
      this.kept = true;
      return;
    }
    this.kept = false;
    this.host.camera?.('out', tier, f(5));
    await this.tween(f(5), (u) => (this.root.style.opacity = String(1 - easeOutCubic(u))));
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
    this.coins.flush();
    for (const s of SEATS) this.wallets[s].settleCount();
    for (const p of this.plaques) p.stopCounting();
    for (const n of this.fxNodes) this.resetFx(n);
    this.fxFree = [...this.fxNodes];
    c.dispose();
  }

  /** Idle: off-screen, no layers, no timers. */
  park(): void {
    this.releaseClock();
    this.coins.clear();
    for (const s of SEATS) this.wallets[s].hide();
    for (const p of this.plaques) p.hide();
    this.heroIn.textContent = '';
    this.hero.style.opacity = '0';
    this.stamp.className = 'ms-stamp';
    this.stamp.textContent = '';
    this.stamp.style.opacity = '0';
    for (const n of this.fxNodes) this.resetFx(n);
    this.fxFree = [...this.fxNodes];
    this.root.classList.remove('is-live');
    this.root.style.opacity = '';
    this.root.style.transform = '';
    this.live = false;
  }

  // ------------------------------------------------------------------ parts

  /** Set up and raise a seat's wallet. */
  wallet(seat: Seat, cash: number, color: string, raise = true): Wallet {
    const w = this.wallets[seat];
    if (!w.visible) {
      w.setup({ seat, color, cash, anchor: this.seatAnchor(seat), coin: this.geom.coin });
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
    const sy = h.s * Math.cos((h.rx * Math.PI) / 180);
    this.hero.style.transform =
      `translate(${(h.x - g.hero / 2).toFixed(1)}px,${(h.y - g.hero / 2).toFixed(1)}px) rotate(${h.rz}deg)` +
      ` scale(${h.s.toFixed(4)},${sy.toFixed(4)})`;
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
  shake(px: number, frames = 8): Promise<void> {
    if (!px) return Promise.resolve();
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
  swing(anim: FxAnimName, at: Pt, seatRot: number, o: { scale?: number; ms?: number } = {}): Promise<void> {
    if (!this.clock || this.reduced() || headless() || !this.fxFree.length) return Promise.resolve();
    const n = this.fxFree.pop()!;
    const { w, h } = animSize(anim);
    const s = o.scale ?? 1;
    if (!paintFrame(n, anim, 0, s)) {
      this.fxFree.push(n);
      return Promise.resolve();
    }
    n.style.transformOrigin = `${w * s * 0.75}px ${h * s * 0.85}px`;
    n.style.opacity = '1';
    return this.tween(o.ms ?? f(4), (u) => {
      const k = u < 0.7 ? (u / 0.7) ** 2 : 1 - (u - 0.7) * 0.6;
      const ang = seatRot - 70 + 85 * k;
      n.style.transform = `translate(${(at.x - w * s * 0.75).toFixed(1)}px,${(at.y - h * s * 0.85).toFixed(1)}px) rotate(${ang.toFixed(1)}deg)`;
    }).then(() => {
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
    const rot = SEAT_ROT[seat] - 12;
    await this.tween(ms, (u) => {
      const k = u < 0.6 ? 2.4 - 1.5 * (u / 0.6) : 0.9 + 0.1 * ((u - 0.6) / 0.4);
      s.style.transform = `translate(${at.x.toFixed(1)}px,${at.y.toFixed(1)}px) translate(-50%,-50%) rotate(${rot}deg) scale(${k.toFixed(3)})`;
      s.style.opacity = String(Math.min(1, u * 3));
    });
  }
}
