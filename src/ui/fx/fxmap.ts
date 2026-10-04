/**
 * GameEvent → VFX preset mapping (docs/VFX.md §7, docs/VFX-WIRING.md §8) as a PURE function:
 * `planFx(event, ctx)` returns the preset calls for one engine event; the sequencer
 * (`animate.ts`) plays them, applies the event's state at the step's `applyAt` cue (the icon /
 * owner change happens under the dust curtain) and awaits `wait` ('block' = the preset's block
 * frame only; the tail keeps playing in the background).
 *
 * `EVENT_FX` has one entry per `GameEventType` (a new engine event without a mapping is a type
 * error, and `__tests__/fxmap.test.ts` also checks the engine's source list at runtime).
 * The derived `GroupCompleted` moment (a colour group fully owned after a purchase / takeover)
 * is `groupFx()`.
 */
import {
  citiesInGroup,
  citiesOnSide,
  getBoardInfo,
  groupOf,
  isHub,
  ownsGroup,
  type GameEvent,
  type GameEventType,
  type GameState,
  type GroupId,
  type PlayerId,
} from '@/engine';
import { GROUP_COLORS } from '@/content/board';
import { getCard, type CardId } from '@/content/cards';
import { getBoardGeometry } from '@/ui/board/geometry';
import type { PresetName, PresetParams } from './vfx/presets';
import type { CardTone } from './vfx/presets';

export interface Pt {
  x: number;
  y: number;
}

/** One preset call. */
export type FxStep = {
  [N in PresetName]: {
    preset: N;
    params: PresetParams<N>;
    /** 'block': the sequencer waits for the block frame; 'done': for the last particle; default: not at all. */
    wait?: 'block' | 'done';
    /** The event's state change (and render) is applied at this cue ('swap' / 'frame'). */
    applyAt?: string;
    /** Walk: played at the landing of hop #n (Board.hop callback), not up front. */
    hop?: number;
  };
}[PresetName];

export interface FxCtx {
  /** View state BEFORE the event is applied. */
  vs: GameState;
  /** Client centre of the stage card / prompt (free-upgrade comet, card glints). */
  cardAt?(): Pt | undefined;
  /** Client centres of the two landed dice. */
  dice?(): Pt[] | undefined;
  /** How many `PropertyTransferred` already played in this batch (only the first 6 get particles). */
  transfers?: number;
}

const SKY = '#6EC6F0';
const AMBER = '#F5A25D';
const GREEN = '#3DBB6E';
const PURPLE = '#B08AF5';
/** Particles only for the first 6 tiles of a chain (§6.2-5). */
export const TRANSFER_FX_MAX = 6;

function step<N extends PresetName>(preset: N, params: PresetParams<N>, o: { wait?: 'block' | 'done'; applyAt?: string; hop?: number } = {}): FxStep {
  return { preset, params, ...o } as FxStep;
}

/** Card tone for the reveal glow: good = gold, bad = red-grey, move = sky, keep = purple. */
export function cardTone(id: CardId): CardTone {
  const e = getCard(id).effect;
  switch (e.kind) {
    case 'moveTo':
    case 'goToIsland':
    case 'moveBack':
    case 'nearestHub':
    case 'randomCity':
      return 'move';
    case 'keep':
      return 'keep';
    case 'money':
      return e.amount >= 0 ? 'good' : 'bad';
    case 'perBuildingLevel':
    case 'payEach':
    case 'typhoon':
      return 'bad';
    default:
      return 'good';
  }
}

/** Screen direction (deg) of travel from space a to space b (hop speed lines). */
const profile = (s: GameState) => getBoardInfo(s.settings.spacesPerSide ?? 7);

function dirDeg(a: number, b: number, s: GameState): number {
  const geom = getBoardGeometry(s.settings.spacesPerSide ?? 7);
  const p = geom[a]!;
  const q = geom[b]!;
  return (Math.atan2(q.cy - p.cy, q.cx - p.cx) * 180) / Math.PI;
}

/** Bills for a card win: 4 / 6 / 10 by amount. */
export function billCount(delta: number): number {
  return delta >= 300 ? 10 : delta >= 100 ? 6 : 4;
}

/** Group colour + member cities when `pid` owns i's whole colour group in `vs` (derived GroupCompleted). */
export function completedGroup(vs: GameState, pid: PlayerId, i: number): { group: GroupId; spaces: number[]; color: string } | null {
  const size = vs.settings.spacesPerSide ?? 7;
  const g = groupOf(i, size);
  if (!g || !ownsGroup(vs, pid, g)) return null;
  return { group: g, spaces: [...citiesInGroup(g, size)], color: GROUP_COLORS[g] };
}

/** Derived GroupCompleted (after the ownership change is applied to `vs`): chain → finale. */
export function groupFx(vs: GameState, pid: PlayerId, i: number): FxStep[] {
  const g = completedGroup(vs, pid, i);
  return g ? [step('groupChain', { spaces: g.spaces, player: pid, color: g.color }, { wait: 'block' })] : [];
}

type Planner<K extends GameEventType> = (ev: Extract<GameEvent, { type: K }>, c: FxCtx) => FxStep[];

const at = (c: FxCtx, pid: PlayerId): number => c.vs.players[pid]?.position ?? 0;

export const EVENT_FX: { [K in GameEventType]: Planner<K> } = {
  RoundStarted: (ev, c) => {
    const limit = c.vs.settings.roundLimit;
    return limit !== null && ev.round === limit - 2 ? [step('ringPulse', { at: { stage: true }, color: AMBER, sparkles: 0 })] : [];
  },
  // Turn halo on the active token (I0).
  TurnStarted: (ev, c) => [step('ringPulse', { at: { space: at(c, ev.playerId) }, player: ev.playerId, sparkles: 3 })],
  TurnEnded: () => [],
  DiceRolled: (ev, c) => {
    const pts = c.dice?.();
    const out: FxStep[] = [step('diceLand', pts ? { points: pts } : {})];
    if (ev.isDouble && ev.consecutiveDoubles >= 3) out.push(step('doublesFlash', { triple: true }, { wait: 'block' }));
    else if (ev.isDouble) out.push(step('doublesFlash', {}));
    return out;
  },
  TokenMoved: (ev, c) => {
    if (ev.mode === 'jump') return [step('cometJump', { from: ev.from, to: ev.to, player: ev.playerId }, { wait: 'block' })];
    // Dust on the landing hop only: dust on every hop kept the canvas alive (one upload per frame)
    // for the whole walk for a barely visible accent (4x frame budget, docs/VFX.md §14).
    const n = ev.path.length - 1;
    if (n < 0) return [];
    const sp = ev.path[n]!;
    return [step('hopDust', { space: sp, long: ev.path.length >= 6, dir: dirDeg(n ? ev.path[n - 1]! : ev.from, sp, c.vs) }, { hop: n })];
  },
  PassedStart: (ev) => [step('passStart', { player: ev.playerId, landed: ev.landed })],
  MoneyChanged: (ev, c) => {
    if (ev.reason === 'card' && ev.delta > 0) return [step('billRain', { player: ev.playerId, n: billCount(ev.delta) })];
    if (ev.delta < 0 && (ev.reason === 'card' || ev.reason === 'tax' || ev.reason === 'donation' || ev.reason === 'bail')) {
      const to = ev.reason === 'bail' ? { space: profile(c.vs).islandIndex } : ev.spaceIndex !== undefined ? { space: ev.spaceIndex } : { stage: true as const };
      return [step('coinIn', { from: { panel: ev.playerId }, to, n: 5 })];
    }
    // salary / pot / toll / purchase / build / takeover / sale / auction / bankruptcy: the dedicated
    // event's preset shows the money (no double effect); the panel counts up.
    return [];
  },
  PotChanged: (ev, c) => (ev.delta > 0 ? [step('ringPulse', { at: { space: profile(c.vs).startIndex }, sparkles: 2, scale: 0.6 })] : []),
  PropertyBought: (ev, c) => [
    step('plotClaim', { space: ev.spaceIndex, player: ev.playerId, price: ev.price, hub: isHub(ev.spaceIndex, c.vs.settings.spacesPerSide ?? 7), via: ev.via }, { applyAt: 'frame', wait: 'block' }),
  ],
  CannotAfford: (ev) => [step('puff', { at: { panel: ev.playerId }, smoke: 1 })],
  Built: (ev, c) => {
    const lv = ev.level as 1 | 2 | 3 | 4;
    if (lv === 4 && !ev.free) return [step('landmarkReveal', { space: ev.spaceIndex, player: ev.playerId }, { applyAt: 'swap', wait: 'block' })];
    const from = ev.free ? c.cardAt?.() : undefined;
    return [step('buildSeq', { space: ev.spaceIndex, player: ev.playerId, level: lv, free: ev.free, ...(from ? { from } : {}) }, { applyAt: 'swap', wait: 'block' })];
  },
  Demolished: (ev) =>
    ev.cause === 'typhoon'
      ? [step('puff', { at: { space: ev.spaceIndex }, smoke: 3, bricks: 8, scale: 1.2 }, { wait: 'block' })]
      : [step('puff', { at: { space: ev.spaceIndex }, bricks: 3 })],
  TollPaid: (ev, c) => [
    step(
      'tollPay',
      {
        payer: ev.payerId,
        receiver: ev.ownerId,
        amount: ev.amount,
        festival: ev.festival,
        multiplier: ev.multiplier,
        waived: ev.waived,
        space: ev.spaceIndex,
        payerCashAfter: (c.vs.players[ev.payerId]?.cash ?? 0) - ev.amount,
        // The receiver's number pop is the MoneyChanged float, played at the 'arrive' cue.
        label: null,
      },
      { wait: 'block' },
    ),
  ],
  TakenOver: (ev) => [step('takeoverStamp', { space: ev.spaceIndex, buyer: ev.buyerId, seller: ev.sellerId }, { applyAt: 'frame', wait: 'block' })],
  TakeoverBlocked: (ev) => [step('ringPulse', { at: { space: ev.spaceIndex }, color: SKY, double: true, sparkles: 8 })],
  CardsOffered: () => [],
  DoubleUpOffered: () => [],
  DoubleUpRolled: () => [],
  CardDrawn: (ev, c) => {
    const p = c.cardAt?.();
    return [step('cardReveal', { tone: cardTone(ev.cardId), ...(p ? { at: p } : {}) })];
  },
  CardKept: (ev) => [step('ringPulse', { at: { panel: ev.playerId }, color: PURPLE, sparkles: 6 })],
  CardUsed: (ev) => [step('puff', { at: { panel: ev.playerId }, color: '#FFFFFF' })],
  CardNoEffect: () => [step('puff', { at: { stage: true } })],
  ExpressGranted: (ev) => [step('ringPulse', { at: { panel: ev.playerId }, sparkles: 4 })],
  // Third double: the sirens already swept in DiceRolled — the splash only.
  SentToIsland: (ev, c) => [step('islandSiren', { space: profile(c.vs).islandIndex, player: ev.playerId, cause: ev.cause === 'doubles' ? 'space' : ev.cause }, { wait: 'block' })],
  IslandStay: (_ev, c) => [step('ringPulse', { at: { space: profile(c.vs).islandIndex }, color: SKY, double: true, sparkles: 0 })],
  Escaped: (ev, c) => [step('ringPulse', { at: { space: profile(c.vs).islandIndex }, player: ev.playerId, sparkles: 8 })],
  FestivalSet: (ev) =>
    ev.spaceIndex !== null
      ? [step('festivalBurst', { space: ev.spaceIndex, player: ev.playerId, previous: ev.previous }, { wait: 'block' })]
      : ev.previous !== null
        ? [step('puff', { at: { space: ev.previous } })]
        : [],
  TravelGranted: (_ev, c) => [step('ringPulse', { at: { space: profile(c.vs).travelIndex }, color: SKY, sparkles: 8 })],
  TravelDeclined: () => [],
  DebtStarted: (ev) => [step('ringPulse', { at: { panel: ev.playerId }, color: AMBER, double: true, sparkles: 0 })],
  DebtSettled: (ev) => [step('ringPulse', { at: { panel: ev.playerId }, color: GREEN, sparkles: 6 })],
  BuildingSold: (ev) => [step('coinIn', { from: { space: ev.spaceIndex }, to: { panel: ev.playerId }, n: 4 })],
  PropertySold: (ev) => [
    step('coinIn', { from: { space: ev.spaceIndex }, to: { panel: ev.playerId }, n: 4 }),
    step('puff', { at: { space: ev.spaceIndex } }),
  ],
  PropertyTransferred: (ev, c) =>
    (c.transfers ?? 0) < TRANSFER_FX_MAX ? [step('ringPulse', { at: { space: ev.spaceIndex }, ...(ev.to !== null ? { player: ev.to } : { color: '#B9C0CC' }), sparkles: 2 })] : [],
  Bankrupt: (ev) => [step('bankruptcy', { player: ev.playerId }, { wait: 'block' })],
  AuctionStarted: (ev) => [step('ringPulse', { at: { space: ev.spaceIndex }, sparkles: 4 })],
  AuctionBid: (ev) => [step('ringPulse', { at: { panel: ev.playerId }, player: ev.playerId, sparkles: 2, scale: 0.5 })],
  AuctionDropped: () => [],
  // The winner's purchase is a PropertyBought (via 'auction').
  AuctionEnded: () => [],
  OneAway: (ev) => [step('oneAway', { space: ev.missing, player: ev.playerId })],
  PromptOpened: () => [],
  GameOver: (ev, c) => {
    const r = ev.result;
    let spaces: readonly number[] = [];
    let colors: string[] = [];
    if (r.victory === 'triple' && r.groups?.length) {
      const size = c.vs.settings.spacesPerSide ?? 7;
      spaces = r.groups.map((g) => citiesInGroup(g, size)[1] ?? citiesInGroup(g, size)[0]!);
      colors = r.groups.map((g) => GROUP_COLORS[g]);
    } else if (r.victory === 'line' && r.side) spaces = citiesOnSide(r.side, c.vs.settings.spacesPerSide ?? 7);
    else if (r.victory === 'hubs') spaces = profile(c.vs).hubIndices;
    return [step('victory', { winner: r.winnerId, kind: r.victory, spaces, colors }, { wait: 'block' })];
  },
};

/** The preset calls for one engine event (pure). */
export function planFx(ev: GameEvent, c: FxCtx): FxStep[] {
  return (EVENT_FX[ev.type] as Planner<GameEventType>)(ev as never, c);
}
