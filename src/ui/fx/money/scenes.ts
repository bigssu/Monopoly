/**
 * Money scenes (docs/MONEY-EVENTS.md §4, research 06 §9.1): each one is an async timeline on the
 * stage's MoneyClock, written in 30 fps frames:
 *
 *   appear (camera back, vignette, wallets rise, hero zooms in) → anticipation (wallet pulse,
 *   coins lift) → outflow (coins leave one by one, numbers fall per coin) → arrival (coins stack,
 *   numbers count up, ladder clinks, cha-ching) → result (the hero's moment) → settle.
 *
 * Every scene returns a MoneyPlay at once: `await play` (= `play.block`) resolves at the 'settle'
 * cue — the moment the wiring applies the board state (owner colour, level icon) while the cut-in
 * leaves; `play.done` when the stage is down; `play.cue(name)` for 'start' | 'depart' | 'arrive' |
 * 'result' | 'settle' | 'done'. Headless (speed 0): everything resolves immediately, nothing shows.
 * Scenes are queued (one cut-in at a time); `keep: true` keeps the stage up for a follow-up scene
 * (purchase → build in one cut-in, §4.3). A kind repeated in the same turn plays at 0.7×.
 */
import type { Seat } from '@/engine';
import { iconMarkup } from '@/content/icons';
import { bank, dirtPlot, plotSign, vault } from '@/content/fx/sprites-money';
import { t } from '@/i18n';
import { headless } from '../time';
import { f, type MoneyClock } from './clock';
import type { Pt } from './coins';
import {
  TIER, flightsForAmount, maxTier, planDrain, planFlights, tierFor,
  type Flight, type FlightRange, type Metal, type Tier,
} from './denom';
import { SEAT_UP, SEATS, type MoneyStage, type SpaceArt } from './stage';
import { SEAT_ROT, rotate, type Wallet } from './wallet';
import './strings';

export interface Party {
  seat: Seat;
  /** Cash BEFORE the event (만). */
  cash: number;
  /** Player colour (hex). */
  color: string;
}

export type Place = 'bank' | 'pot' | 'center';
export type End = Party | Place;
export type MoneyCue = 'start' | 'depart' | 'arrive' | 'result' | 'settle' | 'done';
export const CUES: readonly MoneyCue[] = ['start', 'depart', 'arrive', 'result', 'settle', 'done'];

export interface MoneyPlay extends PromiseLike<void> {
  readonly kind: string;
  readonly tier: Tier;
  /** Resolves at the 'settle' cue (apply board state here, continue the event sequence). */
  readonly block: Promise<void>;
  /** The stage is down (or kept up for a follow-up). */
  readonly done: Promise<void>;
  cue(name: MoneyCue): Promise<void>;
}

class Cues {
  private m = new Map<MoneyCue, { p: Promise<void>; r: () => void; fired: boolean }>();
  private get(n: MoneyCue) {
    let e = this.m.get(n);
    if (!e) {
      let r!: () => void;
      const p = new Promise<void>((res) => (r = res));
      e = { p, r, fired: false };
      this.m.set(n, e);
    }
    return e;
  }
  cue(n: MoneyCue): Promise<void> {
    return this.get(n).p;
  }
  fire(n: MoneyCue): void {
    const e = this.get(n);
    if (e.fired) return;
    // Cues fire in order: an earlier cue never resolves after a later one.
    for (const k of CUES) {
      if (k === n) break;
      this.fire(k);
    }
    e.fired = true;
    e.r();
  }
  fireAll(): void {
    for (const k of CUES) this.fire(k);
  }
}

function makePlay(kind: string, tier: Tier, cues: Cues, done: Promise<void>): MoneyPlay {
  const block = cues.cue('settle');
  return {
    kind,
    tier,
    block,
    done,
    cue: (n) => cues.cue(n),
    then: (a, b) => block.then(a, b),
  };
}

/** What a scene body gets. */
export interface Ctx {
  st: MoneyStage;
  c: MoneyClock;
  kind: string;
  tier: Tier;
  T: (typeof TIER)[Tier];
  cues: Cues;
  /** Resolves at scene frame `fr`. */
  at(fr: number): Promise<void>;
  /** Flying coin size (px). */
  coin: number;
}

export interface SceneOpts {
  /** Keep the stage up for a follow-up scene (one cut-in). */
  keep?: boolean;
  /** Force a tier. */
  tier?: Tier;
  /** Override the caption. */
  title?: string;
}

/** Run a scene body on the stage (queued); headless → resolved at once. */
export function runScene(st: MoneyStage, kind: string, tier: Tier, _opts: SceneOpts, body: (x: Ctx) => Promise<void>): MoneyPlay {
  const cues = new Cues();
  if (headless()) {
    cues.fireAll();
    return makePlay(kind, tier, cues, Promise.resolve());
  }
  const done = st.enqueue(async () => {
    const factor = st.turbo(kind);
    if (!st.open(tier, TIER[tier].dim, factor)) {
      cues.fireAll();
      return;
    }
    const c = st.clock!;
    const ctx: Ctx = { st, c, kind, tier, T: TIER[tier], cues, at: (fr) => c.until(f(fr)), coin: Math.round(st.geom.coin * 1.25) };
    cues.fire('start');
    try {
      await body(ctx);
    } catch (e) {
      console.error('[money]', kind, e);
      st.park();
    } finally {
      cues.fireAll();
    }
  });
  return makePlay(kind, tier, cues, done);
}

// ------------------------------------------------------------------------------- helpers

const easeOutBack = (u: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2;
};

const isParty = (e: End): e is Party => typeof e === 'object';

/** Shared ladder counter (one rising ladder across several payer streams into the pot). */
interface Ladder {
  i: number;
}

interface Src {
  wallet?: Wallet;
  point?: () => Pt;
  onDepart?: (i: number) => void;
}

interface Dst {
  wallet?: Wallet;
  point?: () => Pt;
  onLand?: (i: number, last: boolean, fl: Flight) => void;
  /** 'receive' = ladder up + cha-ching on the last; 'pot' = shared ladder, no cha-ching; 'sink' = dull clinks. */
  sound: 'receive' | 'pot' | 'sink' | 'none';
  ladder?: Ladder;
}

interface StreamOpts {
  /** First departure (frame). */
  start: number;
  /** Frames between departures. */
  stagger: number;
  sid: number;
  hopF?: number;
  travelF?: number;
  /** Per-coin spawn hop direction / arc bend (a fountain instead of a line). */
  hop?: (i: number) => Pt;
  hopSize?: number;
  bend?: (i: number) => number;
  /** Fire the 'depart' cue on the first departure. */
  cueDepart?: boolean;
}

/** Fly `flights` from a source to a destination; resolves when the last coin has landed. */
async function stream(x: Ctx, src: Src, dst: Dst, flights: readonly Flight[], o: StreamOpts): Promise<void> {
  const n = flights.length;
  if (!n) return;
  let landed = 0;
  let delay = 0;
  let all!: () => void;
  const allLanded = new Promise<void>((r) => (all = r));
  const ladder = dst.ladder ?? { i: 0 };
  for (let i = 0; i < n; i++) {
    await x.c.until(f(o.start + i * o.stagger) + delay);
    const fl = flights[i]!;
    let from: Pt;
    if (src.wallet) {
      if (fl.breaks.length) {
        const t0 = x.c.t;
        await src.wallet.breakBeat(x.st, fl.breaks, (_b, at) => {
          x.st.sound.breakCoin();
          void x.st.fx('coin_burst', at, { scale: x.coin / 40 });
        });
        delay += x.c.t - t0;
      }
      from = src.wallet.depart(fl);
      x.st.sound.depart(i, n);
      if (i === n - 1) void x.c.after(f(3)).then(() => x.st.sound.paid());
    } else {
      from = src.point!();
    }
    src.onDepart?.(i);
    if (i === 0 && o.cueDepart !== false) x.cues.fire('depart');
    const to = dst.wallet ? () => dst.wallet!.top(fl.metal) : dst.point!;
    x.st.coins.launch({
      from,
      to,
      metal: fl.metal,
      size: x.coin,
      at: x.c.t,
      stream: o.sid,
      hop: o.hop?.(i),
      hopSize: o.hopSize,
      bend: o.bend?.(i),
      hopF: o.hopF,
      travelF: o.travelF,
      onLand: () => {
        const k = landed++;
        const last = landed === n;
        if (dst.wallet) dst.wallet.land(x.st, fl);
        if (dst.sound === 'receive') x.st.sound.land(k, x.T.ladder, last);
        else if (dst.sound === 'pot') x.st.sound.land(ladder.i++, x.T.ladder + 2, false);
        else if (dst.sound === 'sink') x.st.sound.sink(k);
        dst.onLand?.(k, last, fl);
        if (last) all();
      },
    });
  }
  await allLanded;
}

/** Flights for a payment out of a wallet (or out of thin air for the bank / pot). */
function payFlights(w: Wallet | null, amount: number, range: FlightRange): Flight[] {
  if (!w) return flightsForAmount(amount, range);
  const plan = planDrain(w.pile, amount);
  return planFlights(plan, range);
}

/** The flights that leave the centre: the same coins that arrived, regrouped (≤ 12 in flight). */
function regroup(fl: readonly Flight[], max = 12): Flight[] {
  const coins = fl.flatMap((x) => x.coins.map((m) => ({ metal: m, breaks: [] })));
  const valued = fl.reduce((s, x) => s + x.value, 0);
  const coinValue = coins.reduce((s, c) => s + (c.metal === 'gold' ? 1000 : c.metal === 'silver' ? 100 : 10), 0);
  return planFlights({ coins, rest: valued - coinValue }, { min: Math.min(max, Math.max(3, fl.length)), max });
}

function art(x: Ctx, spaceIndex: number): SpaceArt {
  return x.st.host.space?.(spaceIndex) ?? { icon: 'space-event', name: '' };
}

function icon(id: string): string {
  try {
    return iconMarkup(id);
  } catch {
    return '';
  }
}

const escapeHtml = (v: string): string => v.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** A city card (landmark art on a paper card with the group band and an owner frame). */
function cityCard(a: SpaceArt, frame: string | null): string {
  return (
    `<div class="mh-card${frame ? ' is-owned' : ''}" style="--band:${a.color ?? '#B8AE9C'};--frame:${frame ?? 'transparent'}">` +
    `<i class="mh-band">${escapeHtml(a.name)}</i><div class="mh-art">${icon(a.icon)}</div></div>`
  );
}

/** Zoom the hero in (from small and tilted back) facing `seat`. */
async function heroIn(x: Ctx, html: string, seat: Seat, cls: string, o: Partial<{ s: number; rx: number; at: Pt }> = {}): Promise<void> {
  const g = x.st.geom;
  const at = o.at ?? g.c;
  x.st.setHero(html, { x: at.x, y: at.y, s: 0.55, rz: SEAT_ROT[seat], rx: 38, o: 0 }, cls);
  await x.st.poseTo({ s: o.s ?? 1, rx: o.rx ?? 14, o: 1 }, f(6), easeOutBack);
}

/** A short scale punch on the hero (a coin lands, the total locks in). */
function heroPunch(x: Ctx, k = 1.04, frames = 3): void {
  const s0 = x.st.heroPose.s;
  void x.st.tween(f(frames), (u) => x.st.pose({ s: s0 * (1 + (k - 1) * Math.sin(Math.PI * u)) }));
}

/**
 * Where a plaque facing `seat` stands: the hero's front-right corner as that seat sees it (clear of
 * the seat's own wallet on its edge midpoint, and of the coins' landing spot in the middle). Four
 * seats get four different corners, so the collect-from-all totals never overlap. `d` = 0: centre.
 */
function frontOf(x: Ctx, seat: Seat, d = 0.42): Pt {
  const { c, hero } = x.st.geom;
  if (!d) return c;
  const v = rotate(hero * 0.5, hero * 0.36, SEAT_ROT[seat]);
  return { x: c.x + v.x, y: c.y + v.y };
}

async function plaqueIn(x: Ctx, i: number, seat: Seat, at: Pt, o: { title?: string; amount?: number | null; sign?: '' | '+' | '−'; tone?: 'gold' | 'bad' | 'good' }): Promise<void> {
  const p = x.st.plaque(i);
  p.set({ title: o.title ?? '', amount: o.amount === undefined ? 0 : o.amount, sign: o.sign ?? '', tone: o.tone });
  await x.st.tween(f(5), (u) => p.place(at, SEAT_ROT[seat], 0.6 + 0.4 * easeOutBack(u), Math.min(1, u * 2)));
}

function plaquePop(x: Ctx, i: number, seat: Seat, at: Pt, k = 1.25): Promise<void> {
  const p = x.st.plaque(i);
  return x.st.tween(f(8), (u) => p.place(at, SEAT_ROT[seat], 1 + (k - 1) * Math.sin(Math.PI * Math.min(1, u * 1.6)) * (1 - u * 0.3)));
}

/** End: 'result' → hold → 'settle' (hero flies to its tile, wallets sink) → down. */
async function finish(x: Ctx, o: { keep?: boolean; tile?: number | null; resultHold?: number; settleHold?: number; wallets?: Wallet[] }): Promise<void> {
  x.cues.fire('arrive');
  await x.c.after(f(o.resultHold ?? 6));
  x.cues.fire('result');
  await x.c.after(f(o.settleHold ?? 4));
  // The numbers are final before the board changes under them.
  for (const s of SEATS) if (x.st.wallets[s].visible) x.st.wallets[s].settleCount();
  x.cues.fire('settle');
  if (o.keep) {
    await x.st.close(x.tier, true);
    return;
  }
  const g = x.st.geom;
  const r = o.tile !== null && o.tile !== undefined ? x.st.host.tileRect?.(o.tile) : null;
  const jobs: Promise<void>[] = [];
  if (r) {
    const l = x.st.local(r);
    const s = Math.max(0.08, Math.min(l.w, l.h) / g.hero);
    jobs.push(x.st.poseTo({ x: l.x + l.w / 2, y: l.y + l.h / 2, s, rx: 0, o: 0.2 }, f(7), (u) => u * u * (3 - 2 * u)));
  } else jobs.push(x.st.poseTo({ s: x.st.heroPose.s * 0.8, o: 0 }, f(6)));
  for (const p of x.st.plaques) jobs.push(x.st.tween(f(5), (u) => (p.el.style.opacity = String(1 - u))));
  if (x.st.stamp.style.opacity && x.st.stamp.style.opacity !== '0') jobs.push(x.st.tween(f(4), (u) => (x.st.stamp.style.opacity = String(1 - u))));
  for (const w of o.wallets ?? SEATS.map((s) => x.st.wallets[s]).filter((w) => w.visible)) jobs.push(w.exit(x.st));
  await Promise.all(jobs);
  await x.st.close(x.tier, false);
}

/** Raise a party's wallet (or reuse it when the stage is kept up). */
function walletOf(x: Ctx, p: Party): Wallet {
  return x.st.wallet(p.seat, p.cash, p.color);
}

/** Small pulse before coins leave (anticipation). */
function pulse(x: Ctx, w: Wallet): void {
  w.bump(x.st, 1.06, f(4));
}

// ------------------------------------------------------------------------------- scenes

export interface TransferArgs extends SceneOpts {
  from: End;
  to: End;
  /** Gather in the centre (plaque + hold) before going on. */
  via?: 'center' | null;
  amount: number;
  /** Seat the plaque faces (default: the paying party, else the receiver). */
  seat?: Seat;
  /** Hero picture for a centre stop (default: the vault). */
  hero?: string;
}

/** Closed and open vault in one hero (opening = a class switch, no markup parse mid-scene). */
const vaultPair = (): string => `<div class="mh-vault"><div class="mh-v0">${vault(false)}</div><div class="mh-v1">${vault(true)}</div></div>`;
function openVault(x: Ctx): void {
  x.st.heroIn.querySelector('.mh-vault')?.classList.add('is-open');
}

const placeHero = (p: Place): string => (p === 'bank' ? bank() : p === 'pot' ? icon('pot') : vaultPair());

/** Generic money move: wallet / bank / pot / centre → wallet / bank / pot / centre. */
export function transfer(st: MoneyStage, a: TransferArgs): MoneyPlay {
  const payer = isParty(a.from) ? a.from : null;
  const recv = isParty(a.to) ? a.to : null;
  const tier = a.tier ?? tierFor(a.amount, payer?.cash);
  const seat = a.seat ?? payer?.seat ?? recv?.seat ?? 'S';
  return runScene(st, 'transfer', tier, a, async (x) => {
    const pw = payer ? walletOf(x, payer) : null;
    const rw = recv ? walletOf(x, recv) : null;
    const center = a.via === 'center' || !payer || !recv;
    if (center) {
      const place: Place = !payer && typeof a.from === 'string' ? a.from : !recv && typeof a.to === 'string' ? a.to : 'center';
      void heroIn(x, a.hero ?? placeHero(place), seat, 'is-place');
    }
    const flights = payFlights(pw, a.amount, tier);
    const front = frontOf(x, seat, center ? 0.46 : 0);
    void plaqueIn(x, 0, seat, front, { title: a.title ?? '', amount: center ? 0 : a.amount, sign: '' });
    await x.at(4);
    if (pw) pulse(x, pw);
    const centerPt = (): Pt => x.st.geom.c;
    if (center && pw) {
      // Leg 1: into the centre (plaque counts what gathered).
      const ladder = { i: 0 };
      await stream(x, { wallet: pw }, { point: centerPt, sound: 'pot', ladder, onLand: (_k, _l, fl) => { heroPunch(x); void x.st.plaque(0).add(x.c, fl.value, f(4)); } }, flights, { start: 6, stagger: x.T.stagger, sid: 0, hopF: 4, travelF: 10 });
      x.st.sound.cue('toll');
      void plaquePop(x, 0, seat, front);
      await x.c.after(f(3));
    } else if (!pw) {
      // From the bank / pot: the place pops, then coins burst out of it.
      await x.at(8);
      heroPunch(x, 1.08, 4);
      void x.st.plaque(0).count(x.c, a.amount, f(10));
    }
    if (rw) {
      const out = pw ? (center ? regroup(flights) : flights) : flights;
      const src: Src = pw && !center ? { wallet: pw } : { point: centerPt };
      await stream(x, src, { wallet: rw, sound: 'receive' }, out, { start: x.c.t / f(1) + 1, stagger: center ? 1.2 : x.T.stagger, sid: 1, hopF: center ? 3 : 4, travelF: 11 });
      rw.bump(x.st, 1.08, f(4));
      void rw.merge(x.st, (_m, at) => void x.st.fx('coin_burst', at, { scale: x.coin / 36 }));
    } else if (pw && !center) {
      await stream(x, { wallet: pw }, { point: centerPt, sound: 'sink', onLand: () => heroPunch(x) }, flights, { start: 6, stagger: x.T.stagger, sid: 0 });
    }
    await finish(x, { keep: a.keep, resultHold: 6, settleHold: 6 });
  });
}

export interface PurchaseArgs extends SceneOpts {
  seat: Seat;
  cash: number;
  playerColor: string;
  spaceIndex: number;
  price: number;
  /** Won at auction: two gavel knocks and a "낙찰" stamp before the coins. */
  auction?: boolean;
}

/** E1: my wallet → the empty lot (landmark big, lot sign); coins fall in; my flag goes up. */
export function purchase(st: MoneyStage, a: PurchaseArgs): MoneyPlay {
  const tier = a.tier ?? maxTier('M', tierFor(a.price, a.cash));
  return runScene(st, 'purchase', tier, a, async (x) => {
    const me: Party = { seat: a.seat, cash: a.cash, color: a.playerColor };
    const w = walletOf(x, me);
    const sp = art(x, a.spaceIndex);
    const html =
      `<div class="mh-lot" style="--pc:${a.playerColor}">` +
      `<div class="mh-plot">${dirtPlot()}</div>` +
      `<div class="mh-landmark">${icon(sp.icon)}</div>` +
      `<div class="mh-sign">${plotSign()}</div>` +
      `<div class="mh-flag">${flagSvg(a.playerColor)}</div>` +
      `</div>`;
    void heroIn(x, html, a.seat, 'is-lot');
    const front = frontOf(x, a.seat, 0.56);
    void plaqueIn(x, 0, a.seat, front, { title: a.title ?? t(a.auction ? 'm.auction' : 'm.bought', { name: sp.name }), amount: 0 });
    await x.at(3);
    if (a.auction) {
      // Sold! Two gavel knocks (the build hammer, higher), the stamp, then the payment.
      const g = x.st.geom;
      for (let k = 0; k < 2; k++) {
        x.st.sound.cue('build', { pitch: 1.35 });
        x.st.sound.buzz('medium');
        void x.st.swing('hammer', lotPoint(x, a.seat, -0.12), SEAT_ROT[a.seat], { scale: g.hero / 230, ms: f(4) });
        await x.c.after(f(5));
      }
      void x.st.stampAt(t('m.sold'), lotPoint(x, a.seat, -0.3), a.seat, 'gold', f(6));
    }
    pulse(x, w);
    const flights = payFlights(w, a.price, { min: Math.max(4, TIER[tier].min - 2), max: Math.min(8, TIER[tier].max) });
    const plotPt = (): Pt => lotPoint(x, a.seat, 0.04);
    await stream(x, { wallet: w }, {
      point: plotPt,
      sound: 'pot',
      onLand: (_k, _l, fl) => {
        heroPunch(x, 1.03, 3);
        void x.st.plaque(0).add(x.c, fl.value, f(4));
        void x.st.fx('coin_burst', plotPt(), { scale: x.coin / 52 });
      },
    }, flights, { start: x.c.t / f(1) + 1, stagger: 2, sid: 0 });
    // Impact: the flag goes in, the lot takes the owner's colour.
    x.st.sound.cue('buy');
    x.st.sound.buzz('medium');
    const flag = x.st.heroIn.querySelector<HTMLElement>('.mh-flag');
    x.st.heroIn.querySelector('.mh-lot')?.classList.add('is-owned');
    if (flag) void x.st.tween(f(7), (u) => (flag.style.transform = `translateY(${(1 - easeOutBack(u)) * 60}%) scale(${(0.3 + 0.7 * easeOutBack(u)).toFixed(3)})`));
    void plaquePop(x, 0, a.seat, front);
    void x.st.fx('sparkle4', lotPoint(x, a.seat, -0.18), { scale: x.st.geom.hero / 150, tint: a.playerColor, fps: 18 });
    void x.st.fx('coin_burst', plotPt(), { scale: x.st.geom.hero / 150 });
    await finish(x, { keep: a.keep, tile: a.spaceIndex, resultHold: 8, settleHold: 6 });
  });
}

/** Where on the lot coins land (a little in front of centre, toward the actor). */
function lotPoint(x: Ctx, seat: Seat, d: number): Pt {
  const u = SEAT_UP[seat];
  const { c, hero } = x.st.geom;
  return { x: c.x - u.x * hero * d, y: c.y - u.y * hero * d };
}

function flagSvg(color: string): string {
  return (
    `<svg viewBox="0 0 40 56" xmlns="http://www.w3.org/2000/svg"><ellipse cx="9" cy="53" rx="7" ry="2" fill="#2B3245" opacity=".2"/>` +
    `<rect x="7" y="4" width="4" height="49" rx="2" fill="#8A5A34"/><circle cx="9" cy="4" r="3.4" fill="#FFC94A"/>` +
    `<path d="M11 7H36L30 15.5L36 24H11Z" fill="${color}"/><path d="M11 7H36L33 11H11Z" fill="#fff" opacity=".3"/></svg>`
  );
}

export interface BuildArgs extends SceneOpts {
  seat: Seat;
  cash: number;
  playerColor: string;
  spaceIndex: number;
  cost: number;
  level: 1 | 2 | 3 | 4;
  /** Free upgrade (card): no wallet, no coins — the hammer and the building only. */
  free?: boolean;
}

const BUILDING: Record<1 | 2 | 3 | 4, string> = { 1: 'villa', 2: 'building', 3: 'hotel', 4: 'landmark' };
const BUILD_COINS: Record<1 | 2 | 3 | 4, number> = { 1: 3, 2: 4, 3: 6, 4: 8 };

/** E2: my wallet → the construction site; hammer hits (= level); the building rises (L4: XL). */
export function build(st: MoneyStage, a: BuildArgs): MoneyPlay {
  const tier = a.tier ?? (a.level === 4 ? 'XL' : a.level === 3 ? maxTier('L', tierFor(a.cost, a.cash)) : maxTier('M', tierFor(a.cost, a.cash)));
  return runScene(st, a.level === 4 ? 'landmark' : 'build', tier, a, async (x) => {
    const w = a.free ? null : walletOf(x, { seat: a.seat, cash: a.cash, color: a.playerColor });
    const html =
      `<div class="mh-site lv${a.level}" style="color:${a.playerColor};--pc:${a.playerColor}">` +
      `<i class="mh-rays"></i>` +
      `<div class="mh-plot">${dirtPlot()}</div>` +
      `<div class="mh-rise"><div class="mh-bld">${icon(BUILDING[a.level])}</div></div>` +
      `</div>`;
    void heroIn(x, html, a.seat, 'is-site');
    const front = frontOf(x, a.seat, 0.54);
    void plaqueIn(x, 0, a.seat, front, { title: a.title ?? t(`m.built.${a.level}`), amount: w ? 0 : null });
    await x.at(3);
    const site = (): Pt => lotPoint(x, a.seat, 0.02);
    if (w) {
      pulse(x, w);
      const n = BUILD_COINS[a.level];
      const flights = payFlights(w, a.cost, { min: n, max: n });
      await stream(x, { wallet: w }, {
        point: site,
        sound: 'pot',
        onLand: (_k, _l, fl) => {
          heroPunch(x, 1.03, 3);
          void x.st.plaque(0).add(x.c, fl.value, f(4));
        },
      }, flights, { start: a.level === 4 ? 5 : 3, stagger: a.level === 4 ? 1.5 : 2, sid: 0 });
    } else {
      // Free: a sparkle drops onto the site instead of the coins.
      x.cues.fire('depart');
      x.st.sound.cue('card');
      void x.st.fx('sparkle4', site(), { scale: x.st.geom.hero / 160, tint: '#FFE08A', fps: 18 });
      await x.at(10);
    }
    // Hammer hits: one per level (L4: three heavy ones).
    const hits = a.level === 4 ? 3 : a.level;
    const g = x.st.geom;
    for (let k = 0; k < hits; k++) {
      x.st.sound.cue('build', { pitch: 1 + k * 0.06 });
      x.st.sound.buzz(a.level === 4 ? 'heavy' : 'light');
      void x.st.swing('hammer', lotPoint(x, a.seat, -0.05), SEAT_ROT[a.seat], { scale: g.hero / (a.level === 4 ? 170 : 210), ms: f(4) });
      void x.c.after(f(2)).then(() => x.st.fx('dust_puff', site(), { scale: g.hero / 230, tint: '#E9D3B0', fps: 20 }));
      void x.st.shake(a.level === 4 ? 4 : 2, 6);
      heroPunch(x, 0.97, 3);
      await x.c.after(f(4));
    }
    // The building rises out of the site (overshoot), dust around its feet.
    const rise = x.st.heroIn.querySelector<HTMLElement>('.mh-bld');
    void x.st.fx('dust_puff', lotPoint(x, a.seat, 0.02), { scale: g.hero / 150, tint: '#E9D3B0', fps: 18 });
    if (rise) await x.st.tween(f(a.level === 4 ? 10 : 8), (u) => (rise.style.transform = `translateY(${((1 - easeOutBack(u)) * 100).toFixed(2)}%)`));
    x.st.sound.cue(a.level === 4 ? 'landmark' : 'build', { pitch: 1.12 });
    if (a.level === 4) {
      x.st.heroIn.querySelector('.mh-site')?.classList.add('is-rays');
      void x.st.poseTo({ s: 1.14, rx: 6 }, f(8), easeOutBack);
      x.st.sound.buzz('heavy');
      void x.st.shake(6, 12);
      for (let k = 0; k < 4; k++) {
        const ang = (k / 4) * Math.PI * 2 + 0.4;
        void x.c.after(f(k * 3)).then(() =>
          x.st.fx('sparkle4', { x: g.c.x + Math.cos(ang) * g.hero * 0.38, y: g.c.y + Math.sin(ang) * g.hero * 0.34 }, { scale: g.hero / 260, tint: '#FFE08A', fps: 16 }),
        );
      }
      void x.st.fx('sparkle4', g.c, { scale: g.hero / 90, tint: '#FFF6C2', fps: 14 });
    }
    void plaquePop(x, 0, a.seat, front, a.level === 4 ? 1.35 : 1.2);
    await finish(x, { keep: a.keep, tile: a.spaceIndex, resultHold: a.level === 4 ? 12 : 6, settleHold: 4 });
  });
}

export interface TollArgs extends SceneOpts {
  payer: Party;
  owner: Party;
  spaceIndex: number;
  amount: number;
  festival?: boolean;
  /** Festival stamp text (default ×2; olympics ×3 / ×5). */
  stamp?: string;
}

/** E3: payer → the city (owner-coloured frame, gathers, total locks) → owner. Festival: ×2 stamp, XL. */
export function toll(st: MoneyStage, a: TollArgs): MoneyPlay {
  const tier = a.tier ?? (a.festival ? 'XL' : tierFor(a.amount, a.payer.cash));
  return runScene(st, 'toll', tier, a, async (x) => {
    const pw = walletOf(x, a.payer);
    const ow = walletOf(x, a.owner);
    const sp = art(x, a.spaceIndex);
    void heroIn(x, cityCard(sp, a.owner.color), a.payer.seat, 'is-city', { s: 0.92 });
    const front = frontOf(x, a.payer.seat, 0.5);
    void plaqueIn(x, 0, a.payer.seat, front, { title: a.title ?? t(a.festival ? 'm.toll.festival' : 'm.toll'), amount: 0, tone: 'bad' });
    x.st.sound.buzz('medium');
    if (a.festival) {
      await x.at(4);
      x.st.sound.cue('festival');
      void x.st.stampAt(a.stamp ?? t('m.x2'), lotPoint(x, a.payer.seat, -0.3), a.payer.seat, 'gold');
    }
    await x.at(a.festival ? 7 : 4);
    pulse(x, pw);
    const flights = payFlights(pw, a.amount, tier);
    const cityPt = (): Pt => x.st.geom.c;
    await stream(x, { wallet: pw }, {
      point: cityPt,
      sound: 'pot',
      ladder: { i: 0 },
      onLand: (_k, _l, fl) => {
        heroPunch(x, 1.03, 3);
        void x.st.plaque(0).add(x.c, fl.value, f(4));
      },
    }, flights, { start: x.c.t / f(1) + 2, stagger: tier === 'XL' ? 1.5 : x.T.stagger, sid: 0, hopF: 4, travelF: 10 });
    // The total locks in: plaque pop, a beat of stillness with a tremble, then off to the owner.
    x.st.sound.cue('toll');
    void plaquePop(x, 0, a.payer.seat, front);
    void x.st.shake(x.T.shake, 6);
    await x.c.after(f(tier === 'S' ? 2 : 3));
    await stream(x, { point: cityPt }, { wallet: ow, sound: 'receive' }, regroup(flights), { start: x.c.t / f(1), stagger: 1.2, sid: 1, hopF: 3, travelF: 10, cueDepart: false });
    ow.bump(x.st, 1.08, f(4));
    void ow.merge(x.st, (_m, at) => void x.st.fx('coin_burst', at, { scale: x.coin / 36 }));
    await finish(x, { keep: a.keep, tile: a.spaceIndex, resultHold: 5, settleHold: 4 });
  });
}

export interface WaivedArgs extends SceneOpts {
  payer: Party;
  owner: Party;
  spaceIndex: number;
}

/** A toll pass waives the toll: the city, a "면제!" stamp, no coins (short S beat). */
export function tollWaived(st: MoneyStage, a: WaivedArgs): MoneyPlay {
  return runScene(st, 'tollWaived', a.tier ?? 'S', a, async (x) => {
    walletOf(x, a.payer);
    const sp = art(x, a.spaceIndex);
    void heroIn(x, cityCard(sp, a.owner.color), a.payer.seat, 'is-city', { s: 0.92 });
    const front = frontOf(x, a.payer.seat, 0.5);
    void plaqueIn(x, 0, a.payer.seat, front, { title: a.title ?? t('m.toll'), amount: null, tone: 'good' });
    await x.at(7);
    x.cues.fire('depart');
    x.st.sound.cue('escape');
    x.st.sound.buzz('medium');
    void x.st.fx('sparkle4', lotPoint(x, a.payer.seat, 0), { scale: x.st.geom.hero / 160, tint: '#B9F2CF', fps: 18 });
    await x.st.stampAt(t('m.waived'), lotPoint(x, a.payer.seat, 0.02), a.payer.seat, 'gold', f(6));
    heroPunch(x, 1.05, 4);
    await finish(x, { keep: a.keep, tile: a.spaceIndex, resultHold: 8, settleHold: 4 });
  });
}

export interface TakeoverArgs extends SceneOpts {
  buyer: Party;
  seller: Party;
  spaceIndex: number;
  price: number;
}

/** E8: sirens, "인수!" stamp, coins buyer → through the city → seller, then the frame turns the buyer's colour. */
export function takeover(st: MoneyStage, a: TakeoverArgs): MoneyPlay {
  const tier = a.tier ?? maxTier('L', tierFor(a.price, a.buyer.cash));
  return runScene(st, 'takeover', tier, a, async (x) => {
    const bw = walletOf(x, a.buyer);
    const sw = walletOf(x, a.seller);
    const sp = art(x, a.spaceIndex);
    void heroIn(x, cityCard(sp, a.seller.color), a.buyer.seat, 'is-city', { s: 0.9 });
    const front = frontOf(x, a.buyer.seat, 0.5);
    const g = x.st.geom;
    x.st.sound.cue('warning');
    for (let k = 0; k < 2; k++) void x.c.after(f(k * 5)).then(() => x.st.fx('siren', lotPoint(x, a.buyer.seat, -0.36), { scale: g.hero / 120, fps: 12 }));
    await x.at(10);
    x.st.sound.cue('takeover');
    x.st.sound.buzz('heavy');
    void x.st.shake(6, 12);
    await x.st.stampAt(t('m.takeover'), lotPoint(x, a.buyer.seat, 0.05), a.buyer.seat, 'bad', f(5));
    void plaqueIn(x, 0, a.buyer.seat, front, { title: '', amount: 0, tone: 'bad' });
    pulse(x, bw);
    // Each coin passes through the city on its way to the seller.
    const flights = payFlights(bw, a.price, tier);
    const cityPt = (): Pt => x.st.geom.c;
    let thru = 0;
    let resolveThru!: () => void;
    const allThru = new Promise<void>((r) => (resolveThru = r));
    await stream(x, { wallet: bw }, {
      point: cityPt,
      sound: 'none',
      onLand: (_k, _last, fl) => {
        heroPunch(x, 1.02, 2);
        void x.st.plaque(0).add(x.c, fl.value, f(3));
        const k = thru;
        x.st.coins.launch({
          from: cityPt(),
          to: () => sw.top(fl.metal),
          metal: fl.metal,
          size: x.coin,
          at: x.c.t,
          stream: 1,
          hopF: 1,
          travelF: 9,
          onLand: () => {
            thru++;
            sw.land(x.st, fl);
            x.st.sound.land(k, x.T.ladder, thru === flights.length);
            if (thru === flights.length) resolveThru();
          },
        });
      },
    }, flights, { start: x.c.t / f(1) + 1, stagger: 1.2, sid: 0, hopF: 3, travelF: 9 });
    await allThru;
    // Ownership changes hands: the frame stamps into the buyer's colour.
    const card = x.st.heroIn.querySelector<HTMLElement>('.mh-card');
    if (card) {
      card.style.setProperty('--frame', a.buyer.color);
      card.classList.add('is-stamped');
    }
    heroPunch(x, 1.08, 5);
    x.st.sound.cue('buy');
    sw.bump(x.st, 1.08, f(4));
    void sw.merge(x.st);
    await finish(x, { keep: a.keep, tile: a.spaceIndex, resultHold: 6, settleHold: 4 });
  });
}

export interface CollectArgs extends SceneOpts {
  payers: Array<Party & { amount: number }>;
  receiver: Party;
}

/** E6: every payer → the vault (one rising ladder), total for all four seats, the vault opens → receiver. */
export function collectFromAll(st: MoneyStage, a: CollectArgs): MoneyPlay {
  const total = a.payers.reduce((s, p) => s + p.amount, 0);
  const tier = a.tier ?? maxTier('L', tierFor(total));
  return runScene(st, 'collect', tier, a, async (x) => {
    const rw = walletOf(x, a.receiver);
    const pws = a.payers.map((p) => ({ p, w: walletOf(x, p) }));
    void heroIn(x, vaultPair(), a.receiver.seat, 'is-place', { s: 0.82, rx: 10 });
    const g = x.st.geom;
    // The total faces every seat (four plaques around the vault).
    const spots = SEATS.map((s, i) => ({ s, i, at: frontOf(x, s, 0.56) }));
    for (const sp of spots) void plaqueIn(x, sp.i, sp.s, sp.at, { title: sp.s === a.receiver.seat ? a.title ?? t('m.collect') : '', amount: 0 });
    const ladder = { i: 0 };
    const vaultPt = (): Pt => g.c;
    let sum = 0;
    const legs: Promise<void>[] = [];
    const arrived: Flight[] = [];
    pws.forEach(({ p, w }, k) => {
      void x.at(6 + 6 * k).then(() => pulse(x, w));
      const flights = payFlights(w, p.amount, { min: 5, max: 5 });
      legs.push(
        stream(x, { wallet: w }, {
          point: vaultPt,
          sound: 'pot',
          ladder,
          onLand: (_k, _l, fl) => {
            arrived.push(fl);
            sum += fl.value;
            heroPunch(x, 1.03, 2);
            for (const sp of spots) void x.st.plaque(sp.i).count(x.c, sum, f(3));
          },
        }, flights, { start: 8 + 6 * k, stagger: 2, sid: k, hopF: 3, travelF: 10, cueDepart: k === 0 }),
      );
    });
    await Promise.all(legs);
    // Hold: the total pops for everyone, the vault trembles (anticipation) …
    x.st.sound.cue('toll');
    for (const sp of spots) {
      if (sp.s === a.receiver.seat) x.st.plaque(sp.i).set({ title: t('m.collect.total', { n: sum.toLocaleString() }) });
      void plaquePop(x, sp.i, sp.s, sp.at, 1.3);
    }
    const x0 = x.st.heroPose.x;
    await x.st.tween(f(8), (u) => x.st.pose({ x: x0 + Math.sin(u * Math.PI * 8) * 4 * (u > 0.3 ? 1 : 0) }));
    // … and opens: a fast stream to the receiver.
    openVault(x);
    heroPunch(x, 1.1, 4);
    x.st.sound.cue('coin-break');
    await stream(x, { point: vaultPt }, { wallet: rw, sound: 'receive' }, regroup(arrived), { start: x.c.t / f(1) + 1, stagger: 1.2, sid: 3, hopF: 2, travelF: 10, cueDepart: false });
    rw.bump(x.st, 1.1, f(5));
    void x.st.shake(x.T.shake, 8);
    void rw.merge(x.st, (_m, at) => void x.st.fx('coin_burst', at, { scale: x.coin / 36 }));
    await finish(x, { keep: a.keep, resultHold: 6, settleHold: 4 });
  });
}

export interface PayAllArgs extends SceneOpts {
  payer: Party;
  receivers: Array<Party & { amount: number }>;
}

/** E7: my wallet → the vault → shared out to every other wallet. */
export function payAll(st: MoneyStage, a: PayAllArgs): MoneyPlay {
  const total = a.receivers.reduce((s, r) => s + r.amount, 0);
  const tier = a.tier ?? maxTier('L', tierFor(total, a.payer.cash));
  return runScene(st, 'payAll', tier, a, async (x) => {
    const pw = walletOf(x, a.payer);
    const rws = a.receivers.map((r) => ({ r, w: walletOf(x, r) }));
    void heroIn(x, vaultPair(), a.payer.seat, 'is-place', { s: 0.82, rx: 10 });
    const g = x.st.geom;
    const front = frontOf(x, a.payer.seat, 0.56);
    void plaqueIn(x, 0, a.payer.seat, front, { title: a.title ?? t('m.payAll'), amount: 0, tone: 'bad' });
    await x.at(5);
    pulse(x, pw);
    const flights = payFlights(pw, total, { min: 8, max: 8 });
    await stream(x, { wallet: pw }, {
      point: () => g.c,
      sound: 'pot',
      onLand: (_k, _l, fl) => {
        heroPunch(x, 1.03, 2);
        void x.st.plaque(0).add(x.c, fl.value, f(3));
      },
    }, flights, { start: 6, stagger: 2, sid: 0, hopF: 4, travelF: 10 });
    void plaquePop(x, 0, a.payer.seat, front);
    const x0 = x.st.heroPose.x;
    await x.st.tween(f(8), (u) => x.st.pose({ x: x0 + Math.sin(u * Math.PI * 6) * 3 }));
    openVault(x);
    heroPunch(x, 1.08, 4);
    const t0 = x.c.t / f(1);
    await Promise.all(
      rws.map(({ r, w }, k) =>
        stream(x, { point: () => g.c }, { wallet: w, sound: 'receive' }, flightsForAmount(r.amount, { min: 4, max: 4 }), { start: t0 + 5 * k, stagger: 2, sid: 1 + k, hopF: 3, travelF: 11, cueDepart: false }).then(() => void w.merge(x.st)),
      ),
    );
    await finish(x, { keep: a.keep, resultHold: 6, settleHold: 4 });
  });
}

export interface ReceiveArgs extends SceneOpts {
  seat: Seat;
  cash: number;
  playerColor: string;
  amount: number;
  /** salary / bonus (from the bank) or the donation pot. */
  kind: 'salary' | 'bonus' | 'pot';
}

/** E4: coin rain from the bank (or the pot) on the far side into my wallet. */
export function receive(st: MoneyStage, a: ReceiveArgs): MoneyPlay {
  const tier = a.tier ?? maxTier('M', tierFor(a.amount));
  return runScene(st, a.kind, tier, a, async (x) => {
    const w = walletOf(x, { seat: a.seat, cash: a.cash, color: a.playerColor });
    const src = x.st.toward(a.seat, -0.12);
    void heroIn(x, a.kind === 'pot' ? icon('pot') : bank(), a.seat, 'is-place', { s: 0.62, rx: 8, at: src });
    const front = frontOf(x, a.seat, 0.25);
    void plaqueIn(x, 0, a.seat, front, { title: a.title ?? t(`m.${a.kind}`), amount: 0, sign: '+', tone: 'good' });
    if (a.kind !== 'pot') x.st.sound.cue('pass-start');
    await x.at(6);
    heroPunch(x, 1.1, 5);
    const flights = flightsForAmount(a.amount, { min: 8, max: a.kind === 'pot' ? 12 : 10 });
    // Coins burst up out of the bank in a fountain (away from me, fanned ±55°) and rain into my pile.
    const away = SEAT_UP[a.seat];
    const fan = (i: number): Pt => {
      const k = ((i * 7) % 11) / 10 - 0.5;
      const ang = Math.atan2(-away.y, -away.x) + k * 1.9;
      return { x: Math.cos(ang), y: Math.sin(ang) };
    };
    let got = 0;
    await stream(x, { point: () => ({ x: src.x, y: src.y }) }, {
      wallet: w,
      sound: 'receive',
      onLand: (_k, _l, fl) => {
        got += fl.value;
        void x.st.plaque(0).count(x.c, got, f(4));
      },
    }, flights, { start: 8, stagger: 1.5, sid: 0, hopF: 6, travelF: 12, hop: fan, hopSize: x.st.geom.hero * 0.3, bend: (i) => (i % 2 ? 0.3 : -0.3) });
    w.bump(x.st, 1.08, f(4));
    void x.st.fx('coin_burst', w.center(), { scale: x.coin / 30 });
    void plaquePop(x, 0, a.seat, front);
    void w.merge(x.st, (_m, at) => void x.st.fx('coin_burst', at, { scale: x.coin / 36 }));
    await finish(x, { keep: a.keep, resultHold: 6, settleHold: 4 });
  });
}

export interface PayArgs extends SceneOpts {
  seat: Seat;
  cash: number;
  playerColor: string;
  amount: number;
  kind: 'tax' | 'donation' | 'bail' | 'fine';
}

/** E5: my wallet → the tax office / donation box / bank in the centre, which swallows the coins. */
export function pay(st: MoneyStage, a: PayArgs): MoneyPlay {
  const tier = a.tier ?? tierFor(a.amount, a.cash);
  return runScene(st, a.kind, tier, a, async (x) => {
    const w = walletOf(x, { seat: a.seat, cash: a.cash, color: a.playerColor });
    const pic = a.kind === 'tax' ? icon('space-tax') : a.kind === 'donation' ? icon('space-donation') : bank();
    void heroIn(x, `<div class="mh-sinkpic">${pic}</div>`, a.seat, 'is-place', { s: 0.75, rx: 10 });
    const front = frontOf(x, a.seat, 0.42);
    void plaqueIn(x, 0, a.seat, front, { title: a.title ?? t(`m.${a.kind}`), amount: 0, sign: '', tone: 'bad' });
    await x.at(4);
    pulse(x, w);
    x.st.sound.buzz('light');
    const flights = payFlights(w, a.amount, { min: 5, max: 7 });
    const mouth = (): Pt => x.st.geom.c;
    await stream(x, { wallet: w }, {
      point: mouth,
      sound: 'sink',
      onLand: (_k, _l, fl) => {
        heroPunch(x, 1.05, 3);
        void x.st.plaque(0).add(x.c, fl.value, f(4));
      },
    }, flights, { start: 5, stagger: 2, sid: 0 });
    // Impact: a stamp-like thud (tax) or a soft bounce (donation).
    x.st.sound.cue('coin-thud', { pitch: a.kind === 'donation' ? 1.2 : 0.9 });
    x.st.sound.buzz('medium');
    void x.st.shake(a.kind === 'tax' ? 3 : 1, 6);
    heroPunch(x, a.kind === 'donation' ? 1.1 : 0.94, 4);
    void plaquePop(x, 0, a.seat, front, 1.15);
    await finish(x, { keep: a.keep, resultHold: a.kind === 'tax' ? 10 : 8, settleHold: 4 });
  });
}

export interface BankruptcyArgs extends SceneOpts {
  debtor: Party;
  /** Creditor, or null for the bank. */
  creditor: Party | null;
  /** Spaces handed over (≤ 8 shown, the rest flip at once). */
  properties: number[];
}

/** E9: the debtor's pile empties to the creditor; their cities flip one by one to the creditor's colour. */
export function bankruptcy(st: MoneyStage, a: BankruptcyArgs): MoneyPlay {
  return runScene(st, 'bankruptcy', a.tier ?? 'XL', a, async (x) => {
    const dw = walletOf(x, a.debtor);
    const cw = a.creditor ? walletOf(x, a.creditor) : null;
    const g = x.st.geom;
    const shown = a.properties.slice(0, 8);
    const cards = shown.map((i) => cityCard(art(x, i), a.debtor.color)).join('');
    void heroIn(x, `<div class="mh-deeds n${Math.max(1, shown.length)}">${cards || bank()}</div>`, a.debtor.seat, 'is-deeds', { s: 0.9, rx: 12 });
    dw.el.classList.add('is-broke');
    x.st.sound.cue('bankrupt');
    x.st.sound.buzz('error');
    const front = frontOf(x, a.debtor.seat, 0.52);
    void plaqueIn(x, 0, a.debtor.seat, front, { title: a.title ?? t('m.bankrupt'), amount: a.debtor.cash, tone: 'bad' });
    await x.at(10);
    void x.st.shake(4, 10);
    const flights = payFlights(dw, a.debtor.cash, { min: 3, max: 12 });
    const legs: Promise<void>[] = [];
    legs.push(
      stream(x, { wallet: dw }, cw ? { wallet: cw, sound: 'receive' } : { point: () => x.st.toward(a.debtor.seat, -0.45), sound: 'sink' }, flights, { start: 10, stagger: 2, sid: 0 }).then(() => undefined),
    );
    void x.c.until(f(10)).then(() => {
      const p = x.st.plaque(0);
      void p.count(x.c, 0, f(24));
    });
    // Deeds flip one by one (stagger 4 f) into the creditor's colour (grey for the bank).
    const els = [...x.st.heroIn.querySelectorAll<HTMLElement>('.mh-card')];
    legs.push(
      (async () => {
        await x.at(30);
        for (let k = 0; k < els.length; k++) {
          const e = els[k]!;
          e.style.setProperty('--frame', a.creditor?.color ?? '#8E9BB5');
          e.classList.add('is-stamped');
          x.st.sound.clink(2 ** ((k * 2) / 12), 0.9);
          void x.st.fx('coin_burst', { x: g.c.x, y: g.c.y }, { scale: x.coin / 60 });
          await x.c.after(f(shown.length > 5 ? 3 : 4));
        }
      })(),
    );
    await Promise.all(legs);
    if (cw) void cw.merge(x.st);
    x.st.sound.cue('coin-thud', { pitch: 0.7 });
    x.st.sound.buzz('heavy');
    await x.st.stampAt(t('m.bankrupt'), lotPoint(x, a.debtor.seat, 0.05), a.debtor.seat, 'bad', f(6));
    await finish(x, { keep: a.keep, resultHold: 10, settleHold: 6 });
    dw.el.classList.remove('is-broke');
  });
}

/** Every scene, by name (demo / wiring tables). */
export const SCENES = { transfer, purchase, build, toll, tollWaived, takeover, collectFromAll, payAll, receive, pay, bankruptcy } as const;
export type SceneName = keyof typeof SCENES;
export type { Metal };
