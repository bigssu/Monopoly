/**
 * Engine events → money cut-ins (docs/MONEY-EVENTS.md §4, §10.4, §11) as a PURE function:
 * `planMoney(events)` walks one reduce batch and returns the money scenes it contains, each with
 * the event indices it stands for. The sequencer (`animate.ts`) plays a group's scene at its first
 * event, applies the state of every event in the group at the scene's 'settle' cue, and skips the
 * group's other events (their old canvas presets, panel floats and toll card are replaced by the
 * cut-in).
 *
 * Grouping (§4.3): one action's money is one cut-in.
 * - PropertyBought + its MoneyChanged(purchase / auction) → purchase
 * - MoneyChanged(build) + Built → build; Built(free) → build without coins
 * - TollPaid + both MoneyChanged(toll) → toll; TollPaid(waived) → the short "면제" beat
 * - TakenOver + both MoneyChanged(takeover) → takeover
 * - PassedStart + MoneyChanged(salary) → receive salary; a lone salary change (double-up) → receive
 *   bonus / pay fine
 * - PotChanged(−) + MoneyChanged(pot) → receive pot
 * - MoneyChanged(tax / donation / bail) (+ PotChanged) → pay
 * - every consecutive MoneyChanged(card) of one card → collectFromAll / payAll / transfer via the
 *   centre / receive bonus / pay fine
 * - BuildingSold / PropertySold (+ Demolished(sale), FestivalSet) + MoneyChanged(sale) → sale
 * - Bankrupt + MoneyChanged(bankruptcy)* + PropertyTransferred* → bankruptcy
 * A group is `keep` (the stage stays up for the next scene, one cut-in) when the next group follows
 * with nothing else in between.
 *
 * `REASON_SCENES` lists, per MoneyReason, the scenes that can show it; `__tests__/moneymap.test.ts`
 * checks it against the engine's MoneyReason union (a new reason without a mapping fails there)
 * and that seeded games leave no money event outside a group.
 */
import type { CardId } from '@/content/cards';
import type { GameEvent, GameEventType, GameState, Level, MoneyReason, PlayerId } from '@/engine';

export type MoneyScene =
  | { kind: 'purchase'; player: PlayerId; spaceIndex: number; price: number; via: 'buy' | 'auction' }
  | { kind: 'build'; player: PlayerId; spaceIndex: number; level: Level; cost: number; free: boolean }
  | { kind: 'toll'; payer: PlayerId; owner: PlayerId; spaceIndex: number; amount: number; festival: boolean; multiplier: number }
  | { kind: 'tollWaived'; payer: PlayerId; owner: PlayerId; spaceIndex: number }
  | { kind: 'takeover'; buyer: PlayerId; seller: PlayerId; spaceIndex: number; price: number; winBack?: boolean }
  | { kind: 'collectFromAll'; receiver: PlayerId; payers: Array<{ id: PlayerId; amount: number }>; cardId: CardId | null }
  | { kind: 'payAll'; payer: PlayerId; receivers: Array<{ id: PlayerId; amount: number }>; cardId: CardId | null }
  | { kind: 'transfer'; from: PlayerId; to: PlayerId; amount: number; reason: MoneyReason; cardId: CardId | null }
  | { kind: 'receive'; player: PlayerId; amount: number; source: 'salary' | 'bonus' | 'pot' | 'doubleUp'; cardId: CardId | null }
  | { kind: 'pay'; player: PlayerId; amount: number; sink: 'tax' | 'donation' | 'bail' | 'fine' | 'doubleUp'; cardId: CardId | null; spaceIndex: number | null }
  | { kind: 'sale'; player: PlayerId; amount: number; spaceIndex: number; building: Level | null }
  | {
      kind: 'bankruptcy';
      debtor: PlayerId;
      creditor: PlayerId | null;
      properties: number[];
      /** No single creditor (a pay-each card): the players the remaining cash was split between. */
      receivers: Array<{ id: PlayerId; amount: number }>;
    };

export type MoneySceneKind = MoneyScene['kind'];

export interface MoneyGroup {
  /** First event of the group (the scene plays here; cash in the view state is still "before"). */
  start: number;
  /** Every event the scene stands for (ascending; includes `start`). */
  events: number[];
  scene: MoneyScene;
  /** The next group follows directly: keep the stage up (one cut-in). */
  keep: boolean;
}

/** Which scenes show each MoneyReason (exhaustive: a new reason is a type error here). */
export const REASON_SCENES: { readonly [R in MoneyReason]: readonly MoneySceneKind[] } = {
  salary: ['receive', 'pay'],
  pot: ['receive'],
  toll: ['toll'],
  purchase: ['purchase'],
  build: ['build'],
  takeover: ['takeover'],
  tax: ['pay'],
  donation: ['pay'],
  bail: ['pay'],
  card: ['collectFromAll', 'payAll', 'transfer', 'receive', 'pay'],
  sale: ['sale'],
  auction: ['purchase'],
  bankruptcy: ['bankruptcy'],
  news: ['transfer'],
};

/** Event types a money group can consume (besides MoneyChanged). */
export const MONEY_EVENT_TYPES: ReadonlySet<GameEventType> = new Set<GameEventType>([
  'MoneyChanged', 'PotChanged', 'PropertyBought', 'Built', 'TollPaid', 'TakenOver', 'PassedStart',
  'BuildingSold', 'PropertySold', 'Bankrupt', 'PropertyTransferred',
]);

/** Events that may sit between two groups without breaking one cut-in (no picture of their own). */
const QUIET: ReadonlySet<GameEventType> = new Set<GameEventType>(['PotChanged', 'Demolished', 'DebtSettled', 'CardUsed']);

type MC = Extract<GameEvent, { type: 'MoneyChanged' }>;
const isMC = (e: GameEvent | undefined, reason?: MoneyReason): e is MC => !!e && e.type === 'MoneyChanged' && (!reason || e.reason === reason);

/** Plan the money cut-ins of one batch. */
export function planMoney(events: readonly GameEvent[]): MoneyGroup[] {
  const used = new Set<number>();
  const groups: Array<Omit<MoneyGroup, 'keep'>> = [];
  let card: CardId | null = null;
  const take = (k: number): void => void used.add(k);
  /** Next unused event index > i matching `pred`, looking at most `span` events ahead. */
  const find = (i: number, pred: (e: GameEvent) => boolean, span = 4): number => {
    for (let k = i + 1; k < events.length && k <= i + span; k++) if (!used.has(k) && pred(events[k]!)) return k;
    return -1;
  };
  const add = (scene: MoneyScene, idx: number[]): void => {
    const ev = [...new Set(idx)].filter((k) => k >= 0).sort((a, b) => a - b);
    ev.forEach(take);
    groups.push({ start: ev[0]!, events: ev, scene });
  };

  for (let i = 0; i < events.length; i++) {
    if (used.has(i)) continue;
    const e = events[i]!;
    switch (e.type) {
      case 'TurnStarted':
        card = null;
        break;
      case 'CardDrawn':
        card = e.cardId;
        break;
      case 'PropertyBought': {
        const k = find(i, (x) => isMC(x) && (x.reason === 'purchase' || x.reason === 'auction') && x.playerId === e.playerId);
        add({ kind: 'purchase', player: e.playerId, spaceIndex: e.spaceIndex, price: e.price, via: e.via }, [i, k]);
        break;
      }
      case 'Built':
        // A paid build's MoneyChanged comes before it (and is grouped from there); a lone Built is free.
        add({ kind: 'build', player: e.playerId, spaceIndex: e.spaceIndex, level: e.level, cost: e.cost, free: e.free }, [i]);
        break;
      case 'TollPaid': {
        if (e.waived) {
          add({ kind: 'tollWaived', payer: e.payerId, owner: e.ownerId, spaceIndex: e.spaceIndex }, [i]);
          break;
        }
        const a = find(i, (x) => isMC(x, 'toll') && x.playerId === e.payerId);
        const b = find(i, (x) => isMC(x, 'toll') && x.playerId === e.ownerId);
        add({ kind: 'toll', payer: e.payerId, owner: e.ownerId, spaceIndex: e.spaceIndex, amount: e.amount, festival: e.festival, multiplier: e.multiplier }, [i, a, b]);
        break;
      }
      case 'TakenOver': {
        const a = find(i, (x) => isMC(x, 'takeover') && x.playerId === e.buyerId);
        const b = find(i, (x) => isMC(x, 'takeover') && x.playerId === e.sellerId);
        add({ kind: 'takeover', buyer: e.buyerId, seller: e.sellerId, spaceIndex: e.spaceIndex, price: e.price, ...(e.winBack ? { winBack: true } : {}) }, [i, a, b]);
        break;
      }
      case 'PassedStart': {
        const k = find(i, (x) => isMC(x, 'salary') && x.playerId === e.playerId && x.delta > 0, 2);
        const amount = k >= 0 ? (events[k] as MC).delta : e.salary;
        add({ kind: 'receive', player: e.playerId, amount, source: 'salary', cardId: null }, [i, k]);
        break;
      }
      case 'PotChanged': {
        // The pot pays out: PotChanged(−) then MoneyChanged(pot).
        const k = e.delta < 0 ? find(i, (x) => isMC(x, 'pot'), 1) : -1;
        if (k >= 0) {
          const m = events[k] as MC;
          add({ kind: 'receive', player: m.playerId, amount: m.delta, source: 'pot', cardId: null }, [i, k]);
        }
        break;
      }
      case 'BuildingSold':
      case 'PropertySold': {
        const k = find(i, (x) => isMC(x, 'sale') && x.playerId === e.playerId, 3);
        const d = e.type === 'BuildingSold' ? find(i, (x) => x.type === 'Demolished' && x.cause === 'sale' && x.spaceIndex === e.spaceIndex, 2) : -1;
        // The building sold is the level it had (the event carries the level after the sale).
        const building = e.type === 'BuildingSold' ? (Math.min(4, e.level + 1) as Level) : null;
        add({ kind: 'sale', player: e.playerId, amount: e.amount, spaceIndex: e.spaceIndex, building }, [i, k, d]);
        break;
      }
      case 'Bankrupt': {
        const idx = [i];
        const properties: number[] = [];
        const receivers: Array<{ id: PlayerId; amount: number }> = [];
        for (let k = i + 1; k < events.length; k++) {
          const x = events[k]!;
          if (isMC(x, 'bankruptcy')) {
            idx.push(k);
            if (e.creditorId === null && x.delta > 0) receivers.push({ id: x.playerId, amount: x.delta });
          }
          else if (x.type === 'PropertyTransferred' && x.from === e.playerId) {
            idx.push(k);
            properties.push(x.spaceIndex);
          } else if (x.type === 'FestivalSet' && x.spaceIndex === null) continue;
          else break;
        }
        add({ kind: 'bankruptcy', debtor: e.playerId, creditor: e.creditorId, properties, receivers }, idx);
        break;
      }
      case 'MoneyChanged':
        planMoneyChanged(events, i, e, card, used, add);
        break;
      default:
        break;
    }
  }
  groups.sort((a, b) => a.start - b.start);
  return groups.map((g, n) => {
    const next = groups[n + 1];
    let keep = false;
    if (next) {
      const last = g.events[g.events.length - 1]!;
      keep = true;
      for (let k = last + 1; k < next.start; k++) {
        if (g.events.includes(k) || QUIET.has(events[k]!.type)) continue;
        keep = false;
        break;
      }
    }
    return { ...g, keep };
  });
}

/** A MoneyChanged that no dedicated event claimed (build cost, tax, card, double-up, …). */
function planMoneyChanged(
  events: readonly GameEvent[],
  i: number,
  e: MC,
  card: CardId | null,
  used: Set<number>,
  add: (s: MoneyScene, idx: number[]) => void,
): void {
  const potAfter = (): number => {
    const k = i + 1;
    return k < events.length && !used.has(k) && events[k]!.type === 'PotChanged' && (events[k] as { delta: number }).delta > 0 ? k : -1;
  };
  switch (e.reason) {
    case 'build': {
      // The Built that follows names the level.
      let k = -1;
      for (let j = i + 1; j < events.length && j <= i + 3; j++) {
        const x = events[j]!;
        if (x.type === 'Built' && x.playerId === e.playerId && !used.has(j)) {
          k = j;
          break;
        }
      }
      if (k >= 0) {
        const b = events[k] as Extract<GameEvent, { type: 'Built' }>;
        add({ kind: 'build', player: b.playerId, spaceIndex: b.spaceIndex, level: b.level, cost: -e.delta, free: false }, [i, k]);
      } else add({ kind: 'pay', player: e.playerId, amount: -e.delta, sink: 'fine', cardId: null, spaceIndex: e.spaceIndex ?? null }, [i]);
      return;
    }
    case 'tax':
    case 'donation':
    case 'bail':
      add({ kind: 'pay', player: e.playerId, amount: Math.abs(e.delta), sink: e.reason, cardId: null, spaceIndex: e.spaceIndex ?? null }, [i, potAfter()]);
      return;
    case 'card': {
      // Every consecutive card payment is one cut-in.
      const run: number[] = [];
      for (let k = i; k < events.length && !used.has(k); k++) {
        const x = events[k]!;
        if (isMC(x, 'card')) run.push(k);
        else if (x.type === 'PotChanged') run.push(k);
        else break;
      }
      const ms = run.map((k) => events[k]!).filter((x): x is MC => isMC(x));
      // Net per player (collect-from-each credits the receiver once per payer).
      const net = new Map<PlayerId, number>();
      for (const m of ms) net.set(m.playerId, (net.get(m.playerId) ?? 0) + m.delta);
      const gains = [...net].filter(([, d]) => d > 0).map(([playerId, delta]) => ({ playerId, delta }));
      const losses = [...net].filter(([, d]) => d < 0).map(([playerId, delta]) => ({ playerId, delta }));
      const fromPlayers = ms.length > 1 && ms.every((m) => typeof m.counterpart === 'number');
      if (gains.length === 1 && losses.length >= 2 && fromPlayers) {
        add({ kind: 'collectFromAll', receiver: gains[0]!.playerId, payers: losses.map((m) => ({ id: m.playerId, amount: -m.delta })), cardId: card }, run);
      } else if (losses.length === 1 && gains.length >= 2 && fromPlayers) {
        add({ kind: 'payAll', payer: losses[0]!.playerId, receivers: gains.map((m) => ({ id: m.playerId, amount: m.delta })), cardId: card }, run);
      } else if (losses.length === 1 && gains.length === 1 && fromPlayers) {
        add({ kind: 'transfer', from: losses[0]!.playerId, to: gains[0]!.playerId, amount: gains[0]!.delta, reason: 'card', cardId: card }, run);
      } else {
        // From / to the bank: one scene per player (normally just one).
        let first = true;
        for (const m of ms) {
          const k = events.indexOf(m, i);
          const idx = first ? run.filter((x) => !isMC(events[x])).concat(k) : [k];
          first = false;
          if (m.delta > 0) add({ kind: 'receive', player: m.playerId, amount: m.delta, source: 'bonus', cardId: card }, idx);
          else add({ kind: 'pay', player: m.playerId, amount: -m.delta, sink: 'fine', cardId: card, spaceIndex: null }, idx);
        }
      }
      return;
    }
    case 'salary':
      // Double-up: the stake won from / lost to the bank (no PassedStart).
      if (e.delta > 0) add({ kind: 'receive', player: e.playerId, amount: e.delta, source: 'doubleUp', cardId: null }, [i]);
      else add({ kind: 'pay', player: e.playerId, amount: -e.delta, sink: 'doubleUp', cardId: null, spaceIndex: e.spaceIndex ?? null }, [i]);
      return;
    case 'pot':
      add({ kind: 'receive', player: e.playerId, amount: e.delta, source: 'pot', cardId: null }, [i]);
      return;
    case 'sale':
      add({ kind: 'sale', player: e.playerId, amount: e.delta, spaceIndex: e.spaceIndex ?? 0, building: null }, [i]);
      return;
    default: {
      // toll / purchase / takeover / auction / bankruptcy without their event (never emitted so):
      // still a cut-in, never a silent jump.
      if (typeof e.counterpart === 'number' && e.delta < 0) {
        const k = events.findIndex((x, j) => j > i && !used.has(j) && isMC(x, e.reason) && x.playerId === e.counterpart);
        add({ kind: 'transfer', from: e.playerId, to: e.counterpart, amount: -e.delta, reason: e.reason, cardId: null }, [i, k]);
      } else if (e.delta > 0) add({ kind: 'receive', player: e.playerId, amount: e.delta, source: 'bonus', cardId: null }, [i]);
      else add({ kind: 'pay', player: e.playerId, amount: -e.delta, sink: 'fine', cardId: null, spaceIndex: e.spaceIndex ?? null }, [i]);
    }
  }
}

/** The state an event in a money group changes (applied at the scene's settle cue). */
export function applyMoneyState(vs: GameState, ev: GameEvent): void {
  switch (ev.type) {
    case 'MoneyChanged':
      vs.players[ev.playerId]!.cash = ev.balance;
      return;
    case 'PotChanged':
      vs.pot = ev.pot;
      return;
    case 'PropertyBought':
      vs.properties[ev.spaceIndex]!.owner = ev.playerId;
      return;
    case 'Built':
      vs.properties[ev.spaceIndex]!.level = ev.level;
      return;
    case 'TakenOver':
      vs.properties[ev.spaceIndex]!.owner = ev.buyerId;
      return;
    case 'Demolished':
      vs.properties[ev.spaceIndex]!.level = ev.level;
      return;
    case 'PropertySold':
      vs.properties[ev.spaceIndex]!.owner = null;
      vs.properties[ev.spaceIndex]!.level = 0;
      return;
    case 'PropertyTransferred': {
      const pr = vs.properties[ev.spaceIndex]!;
      pr.owner = ev.to;
      pr.level = (ev.to === null ? 0 : ev.level) as Level;
      return;
    }
    case 'Bankrupt':
      vs.players[ev.playerId]!.bankrupt = true;
      return;
    case 'FestivalSet':
      vs.festival = ev.spaceIndex;
      return;
    default:
      return;
  }
}

