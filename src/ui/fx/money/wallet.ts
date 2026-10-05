/**
 * A player's wallet pile at their seat edge (docs/MONEY-EVENTS.md §3): gold / silver / bronze
 * columns built from the cash's digits, the exact amount on a pill below, rotated to face the seat.
 *
 * DOM: 4 nodes — the wallet (tray + amount label as pseudo-elements) and ONE element per column:
 * the coin slice tile repeated in y (`background-repeat`, height = coins × slice), its top coin face
 * as `::before`, a `+` as `::after` when the column holds more than it shows.
 *
 * Paying (`depart`) removes a flight's coins at once and steps the number down by its value; a
 * needed break first flashes the bigger coin and turns it into ten smaller ones (`breakBeat`).
 * Receiving (`land`) stacks the coins with a small bounce and counts the number up (ease-out
 * cubic, ≤ 15 label writes per second); `merge` turns 10 bronze → 1 silver, 10 silver → 1 gold.
 */
import type { Seat } from '@/engine';
import { fmtMoney } from '@/i18n';
import { atlasReady, frameBox, sliceUrl, topAnim } from './atlas';
import type { Pt } from './coins';
import { f } from './clock';
import { columnOverflows, countMs, easeOutCubic, METALS, pileOf, pileValue, planMerge, visibleCoins, type Break, type Flight, type Merge, type Metal, type Pile } from './denom';

/**
 * Coin slice / top-face proportions (sprites-money.ts SLICE / COIN_TOP: 40 × 6, 40 × 14). The slice
 * is drawn 1.5× thicker than baked (a chunkier, taller pile that reads from across the table).
 */
const SLICE_K = 9 / 40;
const CAP_K = 14 / 40;
const CAP_FALLBACK: Record<Metal, string> = { gold: '#FFC94A', silver: '#DCE3EE', bronze: '#E69C61' };
/** Tallest visible column, in coins. */
const MAX_VIS = 15;

export const SEAT_ROT: Record<Seat, number> = { S: 0, E: -90, N: 180, W: 90 };

export interface WalletGeom {
  /** Coin width (CSS px). */
  coin: number;
  slice: number;
  cap: number;
  gap: number;
  pad: number;
  label: number;
  w: number;
  h: number;
}

export function walletGeom(coin: number): WalletGeom {
  const slice = coin * SLICE_K;
  const cap = coin * CAP_K;
  const gap = coin * 0.2;
  const pad = coin * 0.28;
  const label = Math.max(20, coin * 0.64);
  const w = 3 * coin + 2 * gap + 2 * pad;
  const h = label + pad * 0.6 + MAX_VIS * slice + cap + pad * 0.4;
  return { coin, slice, cap, gap, pad, label, w, h };
}

/** Rotate a local vector (x right, y down in the wallet's frame) by `deg` (CSS rotate, clockwise). */
export function rotate(x: number, y: number, deg: number): Pt {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
}

/** Clock-agnostic tween runner the stage provides (scene time). */
export interface TweenHost {
  tween(ms: number, fn: (u: number) => void): Promise<void>;
  /** Run `fn(t)` every frame until it returns false. */
  every(fn: (t: number) => boolean): void;
  now(): number;
  reduced(): boolean;
}

export class Wallet {
  readonly el: HTMLElement;
  readonly cols: Record<Metal, HTMLElement>;
  seat: Seat = 'S';
  color = '#4A6CF7';
  pile: Pile = pileOf(0);
  /** Exact number shown on the label. */
  shown = 0;
  private target = 0;
  private countFrom = 0;
  private countT0 = 0;
  private countMs = 0;
  private lastWrite = -Infinity;
  anchor: Pt = { x: 0, y: 0 };
  rot = 0;
  g: WalletGeom = walletGeom(40);
  /** Rise offset (px along the wallet's local +y; 0 = in place). */
  private rise = 0;
  private bumpK = 1;
  private bumpT = -1;
  visible = false;

  constructor(doc: Document) {
    this.el = doc.createElement('div');
    this.el.className = 'mw';
    const cols = {} as Record<Metal, HTMLElement>;
    for (const m of METALS) {
      const c = doc.createElement('i');
      c.className = 'mw-col';
      c.dataset.m = m;
      this.el.append(c);
      cols[m] = c;
    }
    this.cols = cols;
  }

  /** Set up for a scene: seat, colour, cash, geometry; hidden below its edge until `enter`. */
  setup(o: { seat: Seat; color: string; cash: number; anchor: Pt; coin: number }): void {
    this.seat = o.seat;
    this.color = o.color;
    this.anchor = o.anchor;
    this.rot = SEAT_ROT[o.seat];
    this.g = walletGeom(o.coin);
    this.pile = pileOf(o.cash);
    this.shown = this.target = Math.max(0, Math.round(o.cash));
    this.countMs = 0;
    this.counting = false;
    this.lastWrite = -Infinity;
    this.el.classList.remove('is-broke');
    const g = this.g;
    const s = this.el.style;
    s.width = `${g.w}px`;
    s.height = `${g.h}px`;
    s.setProperty('--pc', o.color);
    s.setProperty('--lab', `${g.label}px`);
    s.setProperty('--coin', `${g.coin}px`);
    METALS.forEach((m, i) => {
      const c = this.cols[m].style;
      c.left = `${g.pad + i * (g.coin + g.gap)}px`;
      c.bottom = `${g.label + g.pad * 0.6}px`;
      c.width = `${g.coin}px`;
      c.backgroundImage = sliceUrl(m);
      c.backgroundSize = `${g.coin}px ${g.slice}px`;
      c.setProperty('--cap-h', `${g.cap}px`);
      const b = atlasReady() ? frameBox(topAnim(m), 0, g.coin / 40) : null;
      if (b) {
        c.setProperty('--cap-img', b.url);
        c.setProperty('--cap-size', b.size);
        c.setProperty('--cap-pos', b.pos);
      } else {
        // Atlas not loaded yet: a flat ellipse in the metal's colour.
        c.setProperty('--cap-img', `radial-gradient(closest-side, ${CAP_FALLBACK[m]} 96%, transparent)`);
        c.setProperty('--cap-size', '100% 100%');
        c.setProperty('--cap-pos', '0 0');
      }
    });
    this.rise = this.hiddenRise();
    this.writeLabel(this.shown);
    this.renderPile();
    this.place();
  }

  private hiddenRise(): number {
    return this.g.h + 24;
  }

  /** Local point (x from the wallet's centre, y up from its bottom edge) → stage point. */
  local(x: number, yUp: number): Pt {
    const v = rotate(x, -yUp + this.rise, this.rot);
    return { x: this.anchor.x + v.x, y: this.anchor.y + v.y };
  }

  private colX(m: Metal): number {
    const i = METALS.indexOf(m);
    return -this.g.w / 2 + this.g.pad + i * (this.g.coin + this.g.gap) + this.g.coin / 2;
  }

  private colBase(): number {
    return this.g.label + this.g.pad * 0.6;
  }

  /** Top of a column (where a coin leaves / lands), stage coords. */
  top(m: Metal): Pt {
    const n = visibleCoins(m, this.pile[m]);
    return this.local(this.colX(m), this.colBase() + n * this.g.slice + this.g.cap * 0.25);
  }

  /** Centre of the amount label, stage coords. */
  labelPoint(): Pt {
    return this.local(0, this.g.label / 2);
  }

  /** Middle of the pile (for a wallet-sized burst). */
  center(): Pt {
    return this.local(0, this.colBase() + 3 * this.g.slice);
  }

  // ------------------------------------------------------------------ rendering

  private place(): void {
    const g = this.g;
    const s = this.el.style;
    s.transform =
      `translate(${(this.anchor.x - g.w / 2).toFixed(1)}px,${(this.anchor.y - g.h).toFixed(1)}px) rotate(${this.rot}deg)` +
      ` translateY(${this.rise.toFixed(1)}px)` +
      (this.bumpK !== 1 ? ` scale(${this.bumpK.toFixed(3)})` : '');
  }

  renderPile(): void {
    for (const m of METALS) {
      const n = this.pile[m];
      const vis = visibleCoins(m, n);
      const c = this.cols[m];
      c.style.height = `${(vis * this.g.slice).toFixed(2)}px`;
      c.classList.toggle('is-empty', vis === 0);
      c.classList.toggle('is-more', columnOverflows(m, n));
    }
  }

  private writeLabel(v: number): void {
    this.el.dataset.v = fmtMoney(Math.round(v));
  }

  // ------------------------------------------------------------------ beats

  /** Rise from the seat edge (6 frames, ease-out). */
  async enter(host: TweenHost, ms = f(6)): Promise<void> {
    this.visible = true;
    this.el.classList.add('is-on');
    const from = this.hiddenRise();
    await host.tween(ms, (u) => {
      this.rise = from * (1 - easeOutCubic(u));
      this.place();
    });
  }

  /** Sink back below the edge. */
  async exit(host: TweenHost, ms = f(6)): Promise<void> {
    const to = this.hiddenRise();
    await host.tween(ms, (u) => {
      this.rise = to * u * u;
      this.place();
    });
    this.hide();
  }

  hide(): void {
    if (this.visible) this.settleCount();
    this.visible = false;
    this.el.classList.remove('is-on');
    this.rise = this.hiddenRise();
    this.place();
  }

  /** A quick squash-bounce of the whole pile (landing / paying). */
  bump(host: TweenHost, k = 1.06, ms = f(4)): void {
    const t0 = host.now();
    this.bumpT = t0;
    void host.tween(ms, (u) => {
      if (this.bumpT !== t0) return;
      this.bumpK = 1 + (k - 1) * Math.sin(Math.PI * u);
      this.place();
    });
  }

  /** Breaks before a coin leaves: the bigger coin flashes (2 f), then becomes ten smaller ones. */
  async breakBeat(host: TweenHost, breaks: readonly Break[], onBreak?: (b: Break, at: Pt) => void): Promise<void> {
    for (const b of breaks) {
      const col = this.cols[b.from];
      const at = this.top(b.from);
      col.classList.add('is-flash');
      onBreak?.(b, at);
      await host.tween(f(2), () => undefined);
      col.classList.remove('is-flash');
      this.pile[b.from] -= 1;
      if (b.to === 'rest') this.pile.rest += 10;
      else this.pile[b.to] += 10;
      this.renderPile();
      if (b.to !== 'rest') {
        const c = this.cols[b.to];
        c.classList.add('is-pop');
        await host.tween(f(2), () => undefined);
        c.classList.remove('is-pop');
      }
    }
  }

  /** A flight leaves: its coins come off the piles and the number steps down by its value. */
  depart(fl: Flight): Pt {
    const from = this.top(fl.metal);
    for (const m of fl.coins) this.pile[m] = Math.max(0, this.pile[m] - 1);
    this.pile.rest = Math.max(0, this.pile.rest - fl.rest);
    this.renderPile();
    this.target = Math.max(0, this.target - fl.value);
    this.shown = this.target;
    this.countMs = 0;
    this.writeLabel(this.shown);
    return from;
  }

  /** A flight lands: coins stack, the number counts up toward the new total. */
  land(host: TweenHost, fl: Flight): void {
    for (const m of fl.coins) this.pile[m] += 1;
    this.pile.rest += fl.rest;
    this.renderPile();
    this.addValue(host, fl.value);
    this.bump(host, 1.05, f(3));
  }

  /**
   * Count the label toward `target + v`: one ease-out cubic from the first landing's value to the
   * (growing) target, lasting countMs(first chunk) and at least 8 frames past the latest landing.
   */
  addValue(host: TweenHost, v: number): void {
    if (!v) return;
    this.target += v;
    if (host.reduced()) {
      this.countMs = 0;
      this.shown = this.target;
      this.writeLabel(this.shown);
      return;
    }
    const now = host.now();
    if (!this.countMs) {
      this.countFrom = this.shown;
      this.countT0 = now;
      if (this.lastWrite > now) this.lastWrite = -Infinity;
      this.countMs = countMs(this.target - this.shown);
    } else {
      this.countMs = Math.max(this.countMs, now - this.countT0 + f(8));
    }
    if (!this.counting) {
      this.counting = true;
      host.every((t) => {
        const more = this.tick(t);
        if (!more) this.counting = false;
        return more;
      });
    }
  }

  /** Jump the label to its target (scene end / skip). */
  settleCount(): void {
    this.countMs = 0;
    this.counting = false;
    this.shown = this.target;
    this.writeLabel(this.shown);
  }
  private counting = false;

  /** Set the pile and number outright (scene start / skip / headless). */
  setCash(v: number): void {
    this.counting = false;
    this.pile = pileOf(v);
    this.shown = this.target = Math.max(0, Math.round(v));
    this.countMs = 0;
    this.writeLabel(this.shown);
    this.renderPile();
  }

  /** Per-frame: the count-up (label writes ≤ 15 Hz). Returns true while counting. */
  tick(t: number): boolean {
    if (!this.countMs) return false;
    const u = (t - this.countT0) / this.countMs;
    const v = u >= 1 ? this.target : Math.round(this.countFrom + (this.target - this.countFrom) * easeOutCubic(u));
    if (u >= 1) this.countMs = 0;
    if (v !== this.shown && (u >= 1 || t - this.lastWrite >= 66)) {
      this.shown = v;
      this.lastWrite = t;
      this.writeLabel(v);
    }
    return this.countMs > 0;
  }

  /** The final tidy-up: 10 bronze → 1 silver, 10 silver → 1 gold (each a flash + pop). */
  async merge(host: TweenHost, onMerge?: (m: Merge, at: Pt) => void): Promise<number> {
    const { merges, after } = planMerge(this.pile);
    for (const m of merges) {
      const col = this.cols[m.from];
      col.classList.add('is-flash');
      onMerge?.(m, this.top(m.from));
      await host.tween(f(2), () => undefined);
      col.classList.remove('is-flash');
      this.pile[m.from] -= m.count * 10;
      this.pile[m.to] += m.count;
      this.renderPile();
      this.cols[m.to].classList.add('is-pop');
      await host.tween(f(2), () => undefined);
      this.cols[m.to].classList.remove('is-pop');
    }
    this.pile = after;
    this.renderPile();
    return merges.length;
  }

  /** Total the pile currently holds (sanity checks). */
  value(): number {
    return pileValue(this.pile);
  }
}
