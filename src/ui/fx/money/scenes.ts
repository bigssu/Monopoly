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
import { fmtMoney, t } from '@/i18n';
import { headless } from '../time';
import { f, type MoneyClock } from './clock';
import type { Pt } from './coins';
import {
  TIER, flightsForAmount, maxTier, planDrain, planFlights, tierFor,
  type Flight, type FlightRange, type Metal, type Tier,
} from './denom';
import { SEAT_UP, SEATS, type MoneyStage, type SpaceArt } from './stage';
import { rotate, type Wallet } from './wallet';
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

// ------------------------------------------------------------------------------- beats

/**
 * The beat grammar of every cut-in (docs/MONEY-EVENTS.md §12 "비트와 12원칙"), pose to pose, in 30 fps
 * frames at the default game pace:
 *
 *   INTRO  ≥ 0.5 s  the stage dims, hero and wallets come in and SETTLE; the coins that will leave
 *                   lift and shimmer (anticipation) — the first coin leaves at ≈ f18
 *   ACTION ≥ 1.2 s  coins fly one after another on eased arcs; numbers move with each coin
 *   RESULT ≥ 0.5 s  the hero's result pose (building pops with overshoot + landing squash, flag
 *                   plants and keeps waving, vault opens …), THEN the plaque pops in
 *   STILL  ≥ 1.0 s  nothing moves but an idle glint: hero, plaque and final numbers readable
 *   OUT      0.3 s  the hero flies to its tile, wallets sink, the stage fades
 *
 * A cut-in is never shorter than MIN_SCENE_MS on screen (stage in → park), also when a repeated
 * event plays at 0.7×: the still hold grows to make up the difference.
 */
export const BEATS_F = { intro: 18, lift: 8, result: 15, plaque: 9, still: 30, out: 9 } as const;
/** Floor of a cut-in on screen at the default pace (ms). */
export const MIN_SCENE_MS = 3100;

const easeOutBack = (u: number, s = 1.70158): number => {
  const c3 = s + 1;
  return 1 + c3 * (u - 1) ** 3 + s * (u - 1) ** 2;
};
const smooth = (u: number): number => u * u * (3 - 2 * u);
/** Damped wobble 0 → 0 (follow-through after an impact). */
const wobble = (u: number, cycles = 1.5): number => Math.sin(Math.PI * 2 * cycles * u) * (1 - u) ** 1.6;

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
  // Slow in / slow out arcs, long enough for the eye to follow each coin (timing, §12).
  const hopF = o.hopF ?? 6;
  const travelF = o.travelF ?? 15;
  src.wallet?.lift(false);
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
      src.wallet.bump(x.st, 0.97, f(3));
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
      hopF,
      travelF,
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
  // Nothing to pay (a bankrupt with no cash left): no decorative coins out of an empty pile.
  if (amount <= 0) return [];
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

/**
 * Zoom the hero in (from small and leaning back) facing `seat`: 10 frames with an overshoot that
 * settles (slow out; the picture lands, it does not slide in). Every helper here that places or
 * turns something "for a seat" goes through `x.st.face` / `x.st.rot`: in the fixed view
 * (src/ui/orientation.ts) the composition faces S whoever acts; wallets keep their real seats.
 */
async function heroIn(x: Ctx, html: string, seat: Seat, cls: string, o: Partial<{ s: number; rx: number; at: Pt }> = {}): Promise<void> {
  const g = x.st.geom;
  const at = o.at ?? g.c;
  x.st.setHero(html, { x: at.x, y: at.y, s: 0.5, rz: x.st.rot(seat), rx: 40, o: 0 }, cls);
  await x.st.poseTo({ s: o.s ?? 1, rx: o.rx ?? 14, o: 1 }, f(10), (u) => easeOutBack(u, 1.4));
}

/** A short scale punch on the hero (a coin lands, the total locks in); < 1 = a squash. */
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
  // Fixed view: the wallets stand on the side panels and there is one plaque, so it takes the
  // front-centre, under the hero (clear of the S panel's wallet and of every coin path).
  if (x.st.upright) return { x: c.x, y: c.y + hero * 0.47 };
  const v = rotate(hero * 0.5, hero * 0.36, x.st.rot(seat));
  return { x: c.x + v.x, y: c.y + v.y };
}

interface PlaqueOpts {
  title?: string;
  amount?: number | null;
  sign?: '' | '+' | '−';
  tone?: 'gold' | 'bad' | 'good';
}

/**
 * The plaque comes in AFTER the action (staging): it pops from small with an overshoot that settles
 * (slow in / slow out), its number counting up to the final amount meanwhile.
 */
function revealPlaque(x: Ctx, i: number, seat: Seat, at: Pt, o: PlaqueOpts): Promise<void> {
  const p = x.st.plaque(i);
  const amount = o.amount === undefined ? null : o.amount;
  p.set({ title: o.title ?? '', amount: amount === null ? null : 0, sign: o.sign ?? '', tone: o.tone });
  if (amount !== null) void p.count(x.c, amount, f(BEATS_F.plaque - 1));
  return x.st.tween(f(BEATS_F.plaque), (u) => p.place(at, x.st.rot(seat), 0.35 + 0.65 * easeOutBack(u, 2.2), Math.min(1, u * 2.5)));
}

/** The coins about to leave lift and shimmer (anticipation) before the first one goes. */
async function anticipate(x: Ctx, ...ws: Wallet[]): Promise<void> {
  for (const w of ws) {
    w.lift(true);
    w.bump(x.st, 1.07, f(BEATS_F.lift));
  }
  x.st.sound.buzz('light');
  await x.c.after(f(BEATS_F.lift));
}

/** Subtle idle glints around the hero during the still hold (the only thing that moves). */
function idleGlints(x: Ctx, ms: number, seat: Seat): void {
  if (ms <= 0) return;
  const g = x.st.geom;
  const spots = [0.3, 0.75, 0.15, 0.6];
  const n = Math.max(1, Math.floor(ms / f(14)));
  for (let k = 0; k < n; k++) {
    const a = spots[k % spots.length]! * Math.PI * 2 + x.st.rot(seat);
    void x.c.after(f(4) + k * f(14)).then(() =>
      x.st.fx('sparkle4', { x: g.c.x + Math.cos(a) * g.hero * 0.36, y: g.c.y + Math.sin(a) * g.hero * 0.3 }, { scale: g.hero / 330, tint: '#FFF2B8', fps: 14 }),
    );
  }
}

interface FinishOpts {
  keep?: boolean;
  tile?: number | null;
  /** The hero is that tile's new building (level): it lands on the pop-out building, not the card. */
  building?: number;
  wallets?: Wallet[];
  /** The hero's result pose (runs first; the beat lasts at least BEATS_F.result). */
  result?: () => Promise<void> | void;
  /** The plaque (after the result pose). */
  plaque?: () => Promise<void> | void;
  /** Seat the idle glints circle from. */
  seat?: Seat;
  /** Something that keeps going through the still hold (the flag waving: follow-through). */
  idle?: (ms: number) => void;
}

/**
 * RESULT (≥ 0.5 s) → plaque → STILL (≥ 1.0 s; longer when the cut-in would end before MIN_SCENE_MS)
 * → 'settle' → OUT (0.3 s: the hero flies to its tile, wallets sink, the stage fades) → down.
 */
async function finish(x: Ctx, o: FinishOpts): Promise<void> {
  x.cues.fire('arrive');
  const r0 = x.c.t;
  await o.result?.();
  await x.c.until(r0 + f(BEATS_F.result));
  await o.plaque?.();
  // The numbers are final before the still hold.
  for (const s of SEATS) if (x.st.wallets[s].visible) x.st.wallets[s].settleCount();
  x.cues.fire('result');
  // STILL: at least 1 s, and long enough that the whole cut-in is ≥ MIN_SCENE_MS on screen (a
  // repeated event at 0.7× included: scene time runs 1/factor faster).
  const out = o.keep ? 0 : f(BEATS_F.out);
  const still = Math.max(f(BEATS_F.still), MIN_SCENE_MS / x.c.factor - x.c.t - out);
  idleGlints(x, still, o.seat ?? 'S');
  o.idle?.(still);
  await x.c.after(still);
  x.cues.fire('settle');
  if (o.keep) {
    await x.st.close(x.tier, true);
    return;
  }
  const g = x.st.geom;
  const r =
    o.tile === null || o.tile === undefined
      ? null
      : ((o.building ? x.st.host.buildingRect?.(o.tile, o.building) : null) ?? x.st.host.tileRect?.(o.tile) ?? null);
  const jobs: Promise<void>[] = [];
  if (r) {
    const l = x.st.local(r);
    const s = Math.max(0.08, Math.min(l.w, l.h) / g.hero);
    jobs.push(x.st.poseTo({ x: l.x + l.w / 2, y: l.y + l.h / 2, s, rx: 0, o: 0.2 }, out, smooth));
  } else jobs.push(x.st.poseTo({ s: x.st.heroPose.s * 0.8, o: 0 }, out, smooth));
  for (const p of x.st.plaques) jobs.push(x.st.tween(f(6), (u) => (p.el.style.opacity = String(Math.min(Number(p.el.style.opacity || 0), 1 - u)))));
  if (x.st.stamp.style.opacity && x.st.stamp.style.opacity !== '0') jobs.push(x.st.tween(f(6), (u) => (x.st.stamp.style.opacity = String(1 - u))));
  for (const w of o.wallets ?? SEATS.map((s) => x.st.wallets[s]).filter((w) => w.visible)) jobs.push(w.exit(x.st, out));
  await x.st.close(x.tier, false, out, jobs);
}

/** Raise a party's wallet (or reuse it when the stage is kept up). */
function walletOf(x: Ctx, p: Party): Wallet {
  return x.st.wallet(p.seat, p.cash, p.color);
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

/** Anticipation on the hero: it trembles before it gives (the vault before it opens). */
function tremble(x: Ctx, frames: number, px = 4): Promise<void> {
  const x0 = x.st.heroPose.x;
  return x.st.tween(f(frames), (u) => x.st.pose({ x: x0 + Math.sin(u * Math.PI * 8) * px * x.st.geom.S * 0.0012 * (u > 0.2 ? 1 : u * 5) }));
}

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
    const flights = payFlights(pw, a.amount, pw && center && rw ? { min: 4, max: 6 } : tier);
    const front = frontOf(x, seat, center ? 0.46 : 0);
    const plaque = (): Promise<void> => revealPlaque(x, 0, seat, front, { title: a.title ?? '', amount: a.amount, sign: pw ? '' : '+', tone: pw ? 'gold' : 'good' });
    await x.at(BEATS_F.intro - BEATS_F.lift);
    if (pw) await anticipate(x, pw);
    else {
      // From the bank / pot: the place swells (anticipation), then the coins burst out of it.
      heroPunch(x, 1.1, BEATS_F.lift);
      await x.c.after(f(BEATS_F.lift));
    }
    const centerPt = (): Pt => x.st.geom.c;
    let shown = false;
    if (center && pw && rw) {
      // Leg 1: into the centre; the total locks in (the plaque comes now: what gathered), a breath.
      const ladder = { i: 0 };
      await stream(x, { wallet: pw }, { point: centerPt, sound: 'pot', ladder, onLand: () => heroPunch(x) }, flights, { start: x.c.t / f(1), stagger: 2, sid: 0, travelF: 13 });
      x.st.sound.cue('toll');
      await plaque();
      shown = true;
      await tremble(x, 4);
    }
    if (rw) {
      const out = pw ? (center ? regroup(flights, 6) : flights) : flights;
      const src: Src = pw && !center ? { wallet: pw } : { point: centerPt };
      await stream(x, src, { wallet: rw, sound: 'receive' }, out, { start: x.c.t / f(1), stagger: pw && center ? 1 : x.T.stagger, sid: 1, hopF: pw && center ? 4 : 6, travelF: pw && center ? 11 : 15, cueDepart: !shown });
    } else if (pw) {
      await stream(x, { wallet: pw }, { point: centerPt, sound: 'sink', onLand: () => heroPunch(x) }, flights, { start: x.c.t / f(1), stagger: x.T.stagger, sid: 0 });
    }
    await finish(x, {
      keep: a.keep,
      seat,
      result: () => {
        if (rw) {
          rw.bump(x.st, 1.1, f(6));
          void rw.merge(x.st, (_m, at) => void x.st.fx('coin_burst', at, { scale: x.coin / 36 }));
        } else heroPunch(x, 1.08, 6);
      },
      plaque: shown ? undefined : plaque,
    });
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

/** E1: my wallet → the empty lot (landmark big, lot sign); coins fall in; my flag goes up and waves. */
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
    if (a.auction) {
      // Sold! Two gavel knocks (wound up, then struck) and the stamp, before the payment.
      await x.at(10);
      const g = x.st.geom;
      for (let k = 0; k < 2; k++) {
        await x.st.swing('hammer', lotPoint(x, a.seat, -0.12), x.st.rot(a.seat), { scale: g.hero / 230, ms: f(8), onHit: () => {
          x.st.sound.cue('build', { pitch: 1.35 });
          x.st.sound.buzz('medium');
        } });
      }
      await x.st.stampAt(t('m.sold'), lotPoint(x, a.seat, -0.3), a.seat, 'gold', f(8));
    } else await x.at(BEATS_F.intro - BEATS_F.lift);
    await anticipate(x, w);
    const flights = payFlights(w, a.price, { min: Math.max(5, TIER[tier].min - 2), max: Math.min(8, TIER[tier].max) });
    const plotPt = (): Pt => lotPoint(x, a.seat, 0.04);
    await stream(x, { wallet: w }, {
      point: plotPt,
      sound: 'pot',
      onLand: () => {
        heroPunch(x, 1.03, 4);
        void x.st.fx('coin_burst', plotPt(), { scale: x.coin / 52 });
      },
    }, flights, { start: x.c.t / f(1), stagger: x.T.stagger, sid: 0 });
    const flag = x.st.heroIn.querySelector<HTMLElement>('.mh-flag');
    await finish(x, {
      keep: a.keep,
      tile: a.spaceIndex,
      seat: a.seat,
      result: async () => {
        // Impact: the flag is driven in (overshoot + squash on landing), the lot takes my colour.
        x.st.sound.cue('buy');
        x.st.sound.buzz('medium');
        x.st.heroIn.querySelector('.mh-lot')?.classList.add('is-owned');
        void x.st.fx('sparkle4', lotPoint(x, a.seat, -0.18), { scale: x.st.geom.hero / 150, tint: a.playerColor, fps: 16 });
        void x.st.fx('coin_burst', plotPt(), { scale: x.st.geom.hero / 150 });
        if (flag) {
          await x.st.tween(f(9), (u) => (flag.style.transform = `translateY(${((1 - easeOutBack(u, 2.4)) * 70).toFixed(1)}%) scale(${(0.3 + 0.7 * easeOutBack(u, 2.4)).toFixed(3)})`));
          await x.st.tween(f(5), (u) => (flag.style.transform = `scale(${(1 + 0.12 * wobble(u, 1)).toFixed(3)},${(1 - 0.14 * wobble(u, 1)).toFixed(3)})`));
        }
      },
      plaque: () => revealPlaque(x, 0, a.seat, front, { title: a.title ?? t(a.auction ? 'm.auction' : 'm.bought', { name: sp.name }), amount: a.price }),
      // Follow-through: the flag keeps waving in the still hold.
      idle: (ms) => {
        if (flag) void x.st.tween(ms, (u) => (flag.style.transform = `rotate(${(Math.sin(u * Math.PI * 2 * (ms / 900)) * 4).toFixed(2)}deg)`));
      },
    });
  });
}

/** Where on the lot coins land (a little in front of centre, toward the actor). */
function lotPoint(x: Ctx, seat: Seat, d: number): Pt {
  const u = SEAT_UP[x.st.face(seat)];
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
const BUILD_COINS: Record<1 | 2 | 3 | 4, number> = { 1: 4, 2: 5, 3: 6, 4: 8 };

/** E2: my wallet → the construction site; wound-up hammer hits (= level); the site crouches, the building rises (L4: XL). */
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
    await x.at(BEATS_F.intro - BEATS_F.lift);
    const site = (): Pt => lotPoint(x, a.seat, 0.02);
    if (w) {
      await anticipate(x, w);
      const n = BUILD_COINS[a.level];
      const flights = payFlights(w, a.cost, { min: n, max: n });
      await stream(x, { wallet: w }, { point: site, sound: 'pot', onLand: () => heroPunch(x, 1.03, 4) }, flights, { start: x.c.t / f(1), stagger: a.level === 4 ? 2 : 3, sid: 0 });
    } else {
      // Free: the site gathers itself (anticipation), then a sparkle drops onto it instead of coins.
      heroPunch(x, 0.95, BEATS_F.lift);
      await x.c.after(f(BEATS_F.lift));
      x.cues.fire('depart');
      x.st.sound.cue('card');
      void x.st.fx('sparkle4', site(), { scale: x.st.geom.hero / 160, tint: '#FFE08A', fps: 14 });
      await x.c.after(f(14));
    }
    // Hammer hits (one per level, L4: three heavy ones): each one wound up, then struck.
    const hits = a.level === 4 ? 3 : a.level;
    const g = x.st.geom;
    for (let k = 0; k < hits; k++) {
      void x.c.after(f(5)).then(() => x.st.fx('dust_puff', site(), { scale: g.hero / 230, tint: '#E9D3B0', fps: 18 }));
      await x.st.swing('hammer', lotPoint(x, a.seat, -0.05), x.st.rot(a.seat), {
        scale: g.hero / (a.level === 4 ? 170 : 210),
        ms: f(8),
        onHit: () => {
          x.st.sound.cue('build', { pitch: 1 + k * 0.06 });
          x.st.sound.buzz(a.level === 4 ? 'heavy' : 'light');
          void x.st.shake(a.level === 4 ? 4 : 2, 6);
          heroPunch(x, 0.96, 3);
        },
      });
      await x.c.after(f(2));
    }
    const rise = x.st.heroIn.querySelector<HTMLElement>('.mh-bld');
    await finish(x, {
      keep: a.keep,
      tile: a.spaceIndex,
      building: a.level,
      seat: a.seat,
      result: async () => {
        // Anticipation: the site crouches; then the building springs up past its height (≈ 18 %
        // overshoot), lands with a squash and settles (squash & stretch, follow-through).
        await x.st.poseTo({ s: x.st.heroPose.s * 0.95 }, f(4), smooth);
        void x.st.poseTo({ s: x.st.heroPose.s / 0.95 }, f(6), (u) => easeOutBack(u, 1.6));
        void x.st.fx('dust_puff', lotPoint(x, a.seat, 0.02), { scale: g.hero / 150, tint: '#E9D3B0', fps: 16 });
        if (rise) {
          await x.st.tween(f(a.level === 4 ? 12 : 10), (u) => {
            const k = easeOutBack(u, 2.6);
            rise.style.transform = `translateY(${((1 - k) * 100).toFixed(2)}%) scale(${(1 - 0.1 * (1 - u)).toFixed(3)},${(1 + 0.18 * Math.sin(Math.PI * u)).toFixed(3)})`;
          });
          x.st.sound.cue(a.level === 4 ? 'landmark' : 'build', { pitch: 1.12 });
          await x.st.tween(f(6), (u) => {
            const k = wobble(u, 1);
            rise.style.transform = `scale(${(1 + 0.1 * k).toFixed(3)},${(1 - 0.12 * k).toFixed(3)})`;
          });
        }
        if (a.level === 4) {
          x.st.heroIn.querySelector('.mh-site')?.classList.add('is-rays');
          void x.st.poseTo({ s: 1.12, rx: 6 }, f(8), (u) => easeOutBack(u, 2));
          x.st.sound.buzz('heavy');
          void x.st.shake(6, 12);
          for (let k = 0; k < 4; k++) {
            const ang = (k / 4) * Math.PI * 2 + 0.4;
            void x.c.after(f(k * 3)).then(() =>
              x.st.fx('sparkle4', { x: g.c.x + Math.cos(ang) * g.hero * 0.38, y: g.c.y + Math.sin(ang) * g.hero * 0.34 }, { scale: g.hero / 260, tint: '#FFE08A', fps: 14 }),
            );
          }
          void x.st.fx('sparkle4', g.c, { scale: g.hero / 90, tint: '#FFF6C2', fps: 12 });
        } else void x.st.fx('sparkle4', lotPoint(x, a.seat, -0.25), { scale: g.hero / 200, tint: '#FFF2B8', fps: 14 });
      },
      plaque: () => revealPlaque(x, 0, a.seat, front, { title: a.title ?? t(`m.built.${a.level}`), amount: w ? a.cost : null }),
    });
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
    x.st.sound.buzz('medium');
    if (a.festival) {
      await x.at(10);
      x.st.sound.cue('festival');
      await x.st.stampAt(a.stamp ?? t('m.x2'), lotPoint(x, a.payer.seat, -0.3), a.payer.seat, 'gold', f(8));
    } else await x.at(BEATS_F.intro - BEATS_F.lift);
    await anticipate(x, pw);
    const flights = payFlights(pw, a.amount, tier === 'XL' ? { min: 8, max: 10 } : { min: 4, max: 6 });
    const cityPt = (): Pt => x.st.geom.c;
    await stream(x, { wallet: pw }, { point: cityPt, sound: 'pot', ladder: { i: 0 }, onLand: () => heroPunch(x, 1.03, 3) }, flights, {
      start: x.c.t / f(1), stagger: tier === 'XL' ? 1.6 : 2, sid: 0, travelF: 13,
    });
    // The total locks in on the city: the plaque pops, a beat of stillness with a tremble, then on to the owner.
    x.st.sound.cue('toll');
    await revealPlaque(x, 0, a.payer.seat, front, { title: a.title ?? t(a.festival ? 'm.toll.festival' : 'm.toll'), amount: a.amount, tone: 'bad' });
    void x.st.shake(x.T.shake, 6);
    await tremble(x, 4);
    await stream(x, { point: cityPt }, { wallet: ow, sound: 'receive' }, regroup(flights, tier === 'XL' ? 8 : 6), { start: x.c.t / f(1), stagger: 1, sid: 1, hopF: 4, travelF: 11, cueDepart: false });
    await finish(x, {
      keep: a.keep,
      tile: a.spaceIndex,
      seat: a.payer.seat,
      result: () => {
        ow.bump(x.st, 1.1, f(6));
        void ow.merge(x.st, (_m, at) => void x.st.fx('coin_burst', at, { scale: x.coin / 36 }));
      },
    });
  });
}

export interface WaivedArgs extends SceneOpts {
  payer: Party;
  owner: Party;
  spaceIndex: number;
}

/** A toll pass waives the toll: the city, the payer's coins lift — and stay; a "면제!" stamp. */
export function tollWaived(st: MoneyStage, a: WaivedArgs): MoneyPlay {
  return runScene(st, 'tollWaived', a.tier ?? 'S', a, async (x) => {
    const pw = walletOf(x, a.payer);
    walletOf(x, a.owner);
    const sp = art(x, a.spaceIndex);
    void heroIn(x, cityCard(sp, a.owner.color), a.payer.seat, 'is-city', { s: 0.92 });
    const front = frontOf(x, a.payer.seat, 0.5);
    await x.at(BEATS_F.intro - BEATS_F.lift);
    await anticipate(x, pw);
    await x.c.after(f(6));
    pw.lift(false);
    x.cues.fire('depart');
    await finish(x, {
      keep: a.keep,
      tile: a.spaceIndex,
      seat: a.payer.seat,
      result: async () => {
        x.st.sound.cue('escape');
        x.st.sound.buzz('medium');
        void x.st.fx('sparkle4', lotPoint(x, a.payer.seat, 0), { scale: x.st.geom.hero / 160, tint: '#B9F2CF', fps: 16 });
        await x.st.stampAt(t('m.waived'), lotPoint(x, a.payer.seat, 0.02), a.payer.seat, 'gold', f(9));
        heroPunch(x, 1.05, 5);
      },
      plaque: () => revealPlaque(x, 0, a.payer.seat, front, { title: a.title ?? t('m.toll'), amount: null, tone: 'good' }),
    });
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
    for (let k = 0; k < 2; k++) void x.c.after(f(k * 6)).then(() => x.st.fx('siren', lotPoint(x, a.buyer.seat, -0.36), { scale: g.hero / 120, fps: 10 }));
    await x.at(12);
    x.st.sound.cue('takeover');
    x.st.sound.buzz('heavy');
    void x.st.shake(6, 12);
    await x.st.stampAt(t('m.takeover'), lotPoint(x, a.buyer.seat, 0.05), a.buyer.seat, 'bad', f(7));
    await anticipate(x, bw);
    // Each coin passes through the city on its way to the seller.
    const flights = payFlights(bw, a.price, { min: 6, max: 8 });
    const cityPt = (): Pt => x.st.geom.c;
    let thru = 0;
    let resolveThru!: () => void;
    const allThru = new Promise<void>((r) => (resolveThru = r));
    await stream(x, { wallet: bw }, {
      point: cityPt,
      sound: 'none',
      onLand: (_k, _last, fl) => {
        heroPunch(x, 1.02, 2);
        const k = thru;
        x.st.coins.launch({
          from: cityPt(),
          to: () => sw.top(fl.metal),
          metal: fl.metal,
          size: x.coin,
          at: x.c.t,
          stream: 1,
          hopF: 2,
          travelF: 11,
          onLand: () => {
            thru++;
            sw.land(x.st, fl);
            x.st.sound.land(k, x.T.ladder, thru === flights.length);
            if (thru === flights.length) resolveThru();
          },
        });
      },
    }, flights, { start: x.c.t / f(1), stagger: 2, sid: 0, hopF: 5, travelF: 12 });
    await allThru;
    await finish(x, {
      keep: a.keep,
      tile: a.spaceIndex,
      seat: a.buyer.seat,
      result: async () => {
        // Ownership changes hands: the frame stamps into the buyer's colour (squash on the stamp).
        const card = x.st.heroIn.querySelector<HTMLElement>('.mh-card');
        if (card) {
          card.style.setProperty('--frame', a.buyer.color);
          card.classList.add('is-stamped');
        }
        x.st.sound.cue('buy');
        heroPunch(x, 0.93, 3);
        await x.c.after(f(3));
        heroPunch(x, 1.08, 6);
        sw.bump(x.st, 1.1, f(6));
        void sw.merge(x.st);
      },
      plaque: () => revealPlaque(x, 0, a.buyer.seat, front, { title: t('m.takeover'), amount: a.price, tone: 'bad' }),
    });
  });
}

export interface CollectArgs extends SceneOpts {
  payers: Array<Party & { amount: number }>;
  receiver: Party;
}

/** E6: every payer → the vault (one rising ladder), the total for all four seats, the vault opens → receiver. */
export function collectFromAll(st: MoneyStage, a: CollectArgs): MoneyPlay {
  const total = a.payers.reduce((s, p) => s + p.amount, 0);
  const tier = a.tier ?? maxTier('L', tierFor(total));
  return runScene(st, 'collect', tier, a, async (x) => {
    const rw = walletOf(x, a.receiver);
    const pws = a.payers.map((p) => ({ p, w: walletOf(x, p) }));
    void heroIn(x, vaultPair(), a.receiver.seat, 'is-place', { s: 0.82, rx: 10 });
    const g = x.st.geom;
    const ladder = { i: 0 };
    const vaultPt = (): Pt => g.c;
    const arrived: Flight[] = [];
    await x.at(BEATS_F.intro - BEATS_F.lift);
    await anticipate(x, ...pws.map((p) => p.w));
    const t0 = x.c.t / f(1);
    await Promise.all(
      pws.map(({ p, w }, k) => {
        const flights = payFlights(w, p.amount, { min: 4, max: 4 });
        return stream(x, { wallet: w }, {
          point: vaultPt,
          sound: 'pot',
          ladder,
          onLand: (_k, _l, fl) => {
            arrived.push(fl);
            heroPunch(x, 1.03, 2);
          },
        }, flights, { start: t0 + 3 * k, stagger: 2, sid: k, travelF: 13, cueDepart: k === 0 });
      }),
    );
    // The total pops for every seat (four plaques around the vault; the fixed view: one, facing
    // S), the vault trembles …
    x.st.sound.cue('toll');
    const spots = (x.st.upright ? (['S'] as const) : SEATS).map((s, i) => ({ s, i, at: frontOf(x, s, 0.56) }));
    const mine = x.st.face(a.receiver.seat);
    await Promise.all(
      spots.map((sp) =>
        revealPlaque(x, sp.i, sp.s, sp.at, { title: sp.s === mine ? t('m.collect.total', { n: fmtMoney(total) }) : a.title ?? t('m.collect'), amount: total }),
      ),
    );
    await tremble(x, 5, 5);
    // … and opens: a fast stream to the receiver.
    openVault(x);
    heroPunch(x, 1.1, 5);
    x.st.sound.cue('coin-break');
    await stream(x, { point: vaultPt }, { wallet: rw, sound: 'receive' }, regroup(arrived, 8), { start: x.c.t / f(1), stagger: 1, sid: 3, hopF: 4, travelF: 11, cueDepart: false });
    await finish(x, {
      keep: a.keep,
      seat: a.receiver.seat,
      result: () => {
        rw.bump(x.st, 1.12, f(7));
        void x.st.shake(x.T.shake, 8);
        void rw.merge(x.st, (_m, at) => void x.st.fx('coin_burst', at, { scale: x.coin / 36 }));
      },
    });
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
    await x.at(BEATS_F.intro - BEATS_F.lift);
    await anticipate(x, pw);
    const flights = payFlights(pw, total, { min: 6, max: 6 });
    await stream(x, { wallet: pw }, { point: () => g.c, sound: 'pot', onLand: () => heroPunch(x, 1.03, 2) }, flights, { start: x.c.t / f(1), stagger: 2, sid: 0, travelF: 13 });
    await revealPlaque(x, 0, a.payer.seat, front, { title: a.title ?? t('m.payAll'), amount: total, tone: 'bad' });
    await tremble(x, 4, 3);
    openVault(x);
    heroPunch(x, 1.08, 5);
    const t0 = x.c.t / f(1);
    await Promise.all(
      rws.map(({ r, w }, k) =>
        stream(x, { point: () => g.c }, { wallet: w, sound: 'receive' }, flightsForAmount(r.amount, { min: 3, max: 3 }), { start: t0 + 3 * k, stagger: 2, sid: 1 + k, hopF: 4, travelF: 11, cueDepart: false }),
      ),
    );
    await finish(x, {
      keep: a.keep,
      seat: a.payer.seat,
      result: () => {
        for (const { w } of rws) {
          w.bump(x.st, 1.08, f(6));
          void w.merge(x.st);
        }
      },
    });
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

/** E4: the bank (or the pot) swells, then a fountain of coins rains into my wallet. */
export function receive(st: MoneyStage, a: ReceiveArgs): MoneyPlay {
  const tier = a.tier ?? maxTier('M', tierFor(a.amount));
  return runScene(st, a.kind, tier, a, async (x) => {
    const w = walletOf(x, { seat: a.seat, cash: a.cash, color: a.playerColor });
    const src = x.st.toward(x.st.face(a.seat), -0.12);
    void heroIn(x, a.kind === 'pot' ? icon('pot') : bank(), a.seat, 'is-place', { s: 0.62, rx: 8, at: src });
    const front = frontOf(x, a.seat, 0.25);
    if (a.kind !== 'pot') x.st.sound.cue('pass-start');
    await x.at(BEATS_F.intro - BEATS_F.lift);
    // Anticipation: the bank swells and trembles before it gives.
    heroPunch(x, 0.94, 3);
    await x.c.after(f(3));
    heroPunch(x, 1.12, 6);
    await x.c.after(f(BEATS_F.lift - 3));
    const flights = flightsForAmount(a.amount, { min: 8, max: a.kind === 'pot' ? 12 : 10 });
    // Coins burst up out of the bank in a fountain (away from me, fanned ±55°) and rain into my pile.
    const away = SEAT_UP[x.st.face(a.seat)];
    const fan = (i: number): Pt => {
      const k = ((i * 7) % 11) / 10 - 0.5;
      const ang = Math.atan2(-away.y, -away.x) + k * 1.9;
      return { x: Math.cos(ang), y: Math.sin(ang) };
    };
    await stream(x, { point: () => ({ x: src.x, y: src.y }) }, { wallet: w, sound: 'receive' }, flights, {
      start: x.c.t / f(1), stagger: 2.5, sid: 0, hopF: 8, travelF: 15, hop: fan, hopSize: x.st.geom.hero * 0.3, bend: (i) => (i % 2 ? 0.3 : -0.3),
    });
    await finish(x, {
      keep: a.keep,
      seat: a.seat,
      result: () => {
        w.bump(x.st, 1.1, f(6));
        void x.st.fx('coin_burst', w.center(), { scale: x.coin / 30 });
        void w.merge(x.st, (_m, at) => void x.st.fx('coin_burst', at, { scale: x.coin / 36 }));
      },
      plaque: () => revealPlaque(x, 0, a.seat, front, { title: a.title ?? t(`m.${a.kind}`), amount: a.amount, sign: '+', tone: 'good' }),
    });
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
    await x.at(BEATS_F.intro - BEATS_F.lift);
    await anticipate(x, w);
    const flights = payFlights(w, a.amount, { min: 5, max: 7 });
    const mouth = (): Pt => x.st.geom.c;
    await stream(x, { wallet: w }, { point: mouth, sound: 'sink', onLand: () => heroPunch(x, 1.05, 3) }, flights, { start: x.c.t / f(1), stagger: 3, sid: 0 });
    await finish(x, {
      keep: a.keep,
      seat: a.seat,
      result: async () => {
        // Impact: a stamp-like thud (tax) or a soft bounce (donation): squash, then settle.
        x.st.sound.cue('coin-thud', { pitch: a.kind === 'donation' ? 1.2 : 0.9 });
        x.st.sound.buzz('medium');
        void x.st.shake(a.kind === 'tax' ? 3 : 1, 6);
        heroPunch(x, a.kind === 'donation' ? 1.1 : 0.9, 4);
        await x.c.after(f(4));
        heroPunch(x, a.kind === 'donation' ? 0.97 : 1.06, 5);
      },
      plaque: () => revealPlaque(x, 0, a.seat, front, { title: a.title ?? t(`m.${a.kind}`), amount: a.amount, sign: '', tone: 'bad' }),
    });
  });
}

export interface BankruptcyArgs extends SceneOpts {
  debtor: Party;
  /** Creditor, or null for the bank. */
  creditor: Party | null;
  /** Spaces handed over (≤ 8 shown, the rest flip at once). */
  properties: number[];
  /**
   * No single creditor: the players the remaining cash is split between (a pay-each card). The
   * debtor's coins gather in the centre, then each share flies to its wallet; the rest goes to the bank.
   */
  receivers?: Array<Party & { amount: number }>;
}

/** E9: the debtor's pile empties to the creditor; their cities flip one by one to the creditor's colour. */
export function bankruptcy(st: MoneyStage, a: BankruptcyArgs): MoneyPlay {
  return runScene(st, 'bankruptcy', a.tier ?? 'XL', a, async (x) => {
    const dw = walletOf(x, a.debtor);
    const cw = a.creditor ? walletOf(x, a.creditor) : null;
    const shares = cw ? [] : (a.receivers ?? []).filter((r) => r.amount > 0).map((r) => ({ r, w: walletOf(x, r) }));
    const g = x.st.geom;
    const shown = a.properties.slice(0, 8);
    const cards = shown.map((i) => cityCard(art(x, i), a.debtor.color)).join('');
    void heroIn(x, `<div class="mh-deeds n${Math.max(1, shown.length)}">${cards || bank()}</div>`, a.debtor.seat, 'is-deeds', { s: 0.9, rx: 12 });
    dw.el.classList.add('is-broke');
    x.st.sound.cue('bankrupt');
    x.st.sound.buzz('error');
    const front = frontOf(x, a.debtor.seat, 0.52);
    await x.at(BEATS_F.intro - BEATS_F.lift);
    await anticipate(x, dw);
    void x.st.shake(4, 10);
    const flights = payFlights(dw, a.debtor.cash, { min: 3, max: 12 });
    const legs: Promise<void>[] = [];
    const t0 = x.c.t / f(1);
    legs.push(
      stream(
        x,
        { wallet: dw },
        cw ? { wallet: cw, sound: 'receive' } : shares.length ? { point: () => g.c, sound: 'pot' } : { point: () => x.st.toward(x.st.face(a.debtor.seat), -0.45), sound: 'sink' },
        flights,
        { start: t0, stagger: 3, sid: 0 },
      ).then(async () => {
        // Split between the players owed: each share leaves the centre for its wallet.
        if (!shares.length) return;
        const t1 = x.c.t / f(1);
        await Promise.all(
          shares.map(({ r, w }, k) =>
            stream(x, { point: () => g.c }, { wallet: w, sound: 'receive' }, flightsForAmount(r.amount, { min: 2, max: 3 }), { start: t1 + 3 * k, stagger: 2, sid: 1 + k, hopF: 4, travelF: 11, cueDepart: false }),
          ),
        );
      }),
    );
    // Deeds flip one by one (stagger 5 f) into the creditor's colour (grey for the bank).
    const els = [...x.st.heroIn.querySelectorAll<HTMLElement>('.mh-card')];
    legs.push(
      (async () => {
        await x.at(t0 + 18);
        for (let k = 0; k < els.length; k++) {
          const e = els[k]!;
          e.style.setProperty('--frame', a.creditor?.color ?? '#8E9BB5');
          e.classList.add('is-stamped');
          x.st.sound.clink(2 ** ((k * 2) / 12), 0.9);
          void x.st.fx('coin_burst', { x: g.c.x, y: g.c.y }, { scale: x.coin / 60 });
          await x.c.after(f(shown.length > 5 ? 4 : 5));
        }
      })(),
    );
    await Promise.all(legs);
    await finish(x, {
      keep: a.keep,
      seat: a.debtor.seat,
      result: async () => {
        if (cw) void cw.merge(x.st);
        x.st.sound.cue('coin-thud', { pitch: 0.7 });
        x.st.sound.buzz('heavy');
        await x.st.stampAt(t('m.bankrupt'), lotPoint(x, a.debtor.seat, 0.05), a.debtor.seat, 'bad', f(8));
      },
      plaque: () => revealPlaque(x, 0, a.debtor.seat, front, { title: a.title ?? t('m.bankrupt'), amount: a.debtor.cash, tone: 'bad' }),
    });
    dw.el.classList.remove('is-broke');
  });
}

/** Every scene, by name (demo / wiring tables). */
export const SCENES = { transfer, purchase, build, toll, tollWaived, takeover, collectFromAll, payAll, receive, pay, bankruptcy } as const;
export type SceneName = keyof typeof SCENES;
export type { Metal };
