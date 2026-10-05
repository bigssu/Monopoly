/**
 * Money-event arithmetic (docs/MONEY-EVENTS.md §3, research 06 §9.2): pure, no DOM.
 *
 * Game money is in 만. A wallet pile shows the cash as coins, digit by digit:
 *   gold = 1,000만 · silver = 100만 · bronze = 10만 · the rest (< 10만) only in the number.
 * Paying plans which coins leave (breaking a gold into 10 silver / a silver into 10 bronze when
 * change is needed); receiving stacks the arriving coins and merges 10 → 1 at the end. The coins
 * that fly are grouped into a tier-capped number of flights; each flight carries a value chunk so
 * the payer's number falls as each coin leaves and the receiver's rises as each one lands.
 */

export type Metal = 'gold' | 'silver' | 'bronze';
export const METALS: readonly Metal[] = ['gold', 'silver', 'bronze'];
/** Value of one coin (만). */
export const COIN_VALUE: Record<Metal, number> = { gold: 1000, silver: 100, bronze: 10 };

/** Coins per column + the invisible remainder (< 10만). */
export interface Pile {
  gold: number;
  silver: number;
  bronze: number;
  rest: number;
}

export function pileOf(amount: number): Pile {
  const v = Math.max(0, Math.floor(amount));
  return { gold: Math.floor(v / 1000), silver: Math.floor((v % 1000) / 100), bronze: Math.floor((v % 100) / 10), rest: v % 10 };
}

export function pileValue(p: Pile): number {
  return p.gold * 1000 + p.silver * 100 + p.bronze * 10 + p.rest;
}

/** Most coins a column shows; above it a `+` marks the overflow. */
export const COLUMN_MAX = 15;

/**
 * Visible coins of a column. Silver / bronze are digits (0–9, exact; up to 19 for a moment while a
 * break or an arrival waits for the merge). Gold can grow without bound, so it is log-compressed
 * above 5: n → 5 + floor(log2(n − 4)) (6→6, 8→7, 12→8, 20→9 …). The number label stays exact.
 */
export function visibleCoins(metal: Metal, n: number): number {
  const k = Math.max(0, Math.floor(n));
  const v = metal === 'gold' && k > 5 ? 5 + Math.floor(Math.log2(k - 4)) : k;
  return Math.min(COLUMN_MAX, v);
}

/** The column shows fewer coins than it holds (gold compression or the cap): draw a `+`. */
export function columnOverflows(metal: Metal, n: number): boolean {
  return visibleCoins(metal, n) < n;
}

// ---------------------------------------------------------------------------------------- paying

/** A gold turned into 10 silver, a silver into 10 bronze, or a bronze into the invisible rest. */
export interface Break {
  from: Metal;
  to: Metal | 'rest';
}

export interface DrainPlan {
  /** Coins leaving, largest first, each preceded by the breaks it needed. */
  coins: Array<{ metal: Metal; breaks: Break[] }>;
  /** Value paid below one bronze (taken from the invisible rest). */
  rest: number;
  /** Breaks needed only for that rest (they play with the flight that carries it). */
  restBreaks: Break[];
  /** The pile after paying (always canonical digits). */
  after: Pile;
  /** What was actually paid (≤ the cash). */
  paid: number;
}

/**
 * Which coins leave a pile to pay `amount`. Gold first, then silver, then bronze; when a column runs
 * short the next bigger coin is broken (one break = one "flash, 1 → 10" beat), right before the coin
 * that needed it. The remaining pile equals `pileOf(cash − amount)`.
 */
export function planDrain(pile: Pile, amount: number): DrainPlan {
  const p: Pile = { ...pile };
  const paid = Math.min(Math.max(0, Math.floor(amount)), pileValue(p));
  const need = pileOf(paid);
  const coins: DrainPlan['coins'] = [];
  let pending: Break[] = [];
  const breakDown = (m: Metal): boolean => {
    // Make one more coin of metal `m` available by breaking a bigger one (recursively).
    if (m === 'gold') return false;
    const up: Metal = m === 'bronze' ? 'silver' : 'gold';
    if (p[up] === 0 && !breakDown(up)) return false;
    p[up] -= 1;
    p[m] += 10;
    pending.push({ from: up, to: m });
    return true;
  };
  for (const m of METALS) {
    for (let k = 0; k < need[m]; k++) {
      if (p[m] === 0 && !breakDown(m)) break;
      p[m] -= 1;
      coins.push({ metal: m, breaks: pending });
      pending = [];
    }
  }
  // The sub-bronze remainder: break a bronze into the invisible rest if needed.
  pending = [];
  if (p.rest < need.rest) {
    if (p.bronze === 0) breakDown('bronze');
    if (p.bronze > 0) {
      p.bronze -= 1;
      p.rest += 10;
      pending.push({ from: 'bronze', to: 'rest' });
    }
  }
  p.rest -= Math.min(p.rest, need.rest);
  return { coins, rest: need.rest, restBreaks: pending, after: p, paid };
}

// ---------------------------------------------------------------------------------------- receiving

export interface Merge {
  from: Metal;
  to: Metal;
  /** How many times 10 → 1 happened. */
  count: number;
}

/** Normalize a pile after arrivals: 10 bronze → 1 silver, 10 silver → 1 gold, rest ≥ 10 → bronze. */
export function planMerge(pile: Pile): { merges: Merge[]; after: Pile } {
  const p: Pile = { ...pile };
  const merges: Merge[] = [];
  if (p.rest >= 10) {
    p.bronze += Math.floor(p.rest / 10);
    p.rest %= 10;
  }
  if (p.bronze >= 10) {
    const c = Math.floor(p.bronze / 10);
    p.bronze -= c * 10;
    p.silver += c;
    merges.push({ from: 'bronze', to: 'silver', count: c });
  }
  if (p.silver >= 10) {
    const c = Math.floor(p.silver / 10);
    p.silver -= c * 10;
    p.gold += c;
    merges.push({ from: 'silver', to: 'gold', count: c });
  }
  return { merges, after: p };
}

// ---------------------------------------------------------------------------------------- flights

export type Tier = 'S' | 'M' | 'L' | 'XL';
export const TIERS: readonly Tier[] = ['S', 'M', 'L', 'XL'];

/**
 * Tier from the amount (research 06 §9.0): S < 100만, M < 500만, L < 1,000만, XL ≥ 1,000만 or
 * ≥ 40 % of the payer's cash. Scenes may raise it (landmark, festival toll, bankruptcy → XL).
 */
export function tierFor(amount: number, payerCash?: number): Tier {
  if (amount >= 1000) return 'XL';
  if (payerCash !== undefined && payerCash > 0 && amount >= payerCash * 0.4 && amount >= 100) return 'XL';
  if (amount >= 500) return 'L';
  if (amount >= 100) return 'M';
  return 'S';
}

export function maxTier(a: Tier, b: Tier): Tier {
  return TIERS[Math.max(TIERS.indexOf(a), TIERS.indexOf(b))]!;
}

/** Per-tier pacing (30 fps frames): flights, departure stagger, total length, dim, shake, ladder top. */
export const TIER: Record<Tier, { min: number; max: number; stagger: number; frames: number; dim: number; shake: number; ladder: number }> = {
  S: { min: 3, max: 5, stagger: 3, frames: 36, dim: 0.92, shake: 0, ladder: 4 },
  M: { min: 6, max: 8, stagger: 3, frames: 54, dim: 0.95, shake: 2, ladder: 7 },
  L: { min: 10, max: 12, stagger: 2.5, frames: 72, dim: 0.97, shake: 4, ladder: 9 },
  XL: { min: 14, max: 16, stagger: 2, frames: 88, dim: 0.98, shake: 6, ladder: 12 },
};

/** One flying coin: the coins (and value) it carries from the payer to the receiver. */
export interface Flight {
  /** Sprite of the flying coin (its biggest coin). */
  metal: Metal;
  /** Coins removed from / added to the piles with this flight (empty = decoration). */
  coins: Metal[];
  /** Value in 만 (the numbers move by this much at departure / landing). */
  value: number;
  /** Part of `value` below one bronze (leaves / joins the pile's invisible rest). */
  rest: number;
  /** Breaks to play on the payer's pile right before this flight leaves. */
  breaks: Break[];
}

/**
 * Group the leaving coins into flights: between the tier's min and max flights (≤ 16). More coins
 * than flights → consecutive coins share a flight; fewer → decorative coins (value 0) top it up
 * (research 06 §9.2). The sub-bronze rest rides with the last valued flight. Values sum to `paid`.
 */
export type FlightRange = Tier | { min: number; max: number };

export function planFlights(plan: Pick<DrainPlan, 'coins' | 'rest'> & { restBreaks?: Break[] }, range: FlightRange): Flight[] {
  const { min, max } = typeof range === 'string' ? TIER[range] : range;
  const coins = plan.coins;
  const n = Math.max(min, Math.min(max, coins.length));
  const out: Flight[] = [];
  if (coins.length >= n) {
    for (let i = 0; i < n; i++) {
      const a = Math.floor((i * coins.length) / n);
      const b = Math.floor(((i + 1) * coins.length) / n);
      const group = coins.slice(a, b);
      out.push({
        metal: group[0]!.metal,
        coins: group.map((c) => c.metal),
        value: group.reduce((s, c) => s + COIN_VALUE[c.metal], 0),
        rest: 0,
        breaks: group.flatMap((c) => c.breaks),
      });
    }
  } else {
    // Fewer coins than flights: decorations (value 0) interleave, and the LAST flight is always a
    // valued one (the cha-ching and the last haptic belong to real money).
    const valued: Flight[] = coins.map((c) => ({ metal: c.metal, coins: [c.metal], value: COIN_VALUE[c.metal], rest: 0, breaks: c.breaks }));
    const deco: Metal = coins.length ? coins[coins.length - 1]!.metal : 'bronze';
    const slots = new Set(valued.map((_, j) => Math.round(((j + 1) * n) / valued.length) - 1));
    let j = 0;
    for (let i = 0; i < n; i++) out.push(slots.has(i) && j < valued.length ? valued[j++]! : { metal: deco, coins: [], value: 0, rest: 0, breaks: [] });
  }
  if (plan.rest || plan.restBreaks?.length) {
    const last = [...out].reverse().find((f) => f.value > 0) ?? out[out.length - 1];
    if (last) {
      last.value += plan.rest;
      last.rest += plan.rest;
      last.breaks.push(...(plan.restBreaks ?? []));
    }
  }
  return out;
}

/** Flights for money that comes from nowhere in particular (the bank, the pot, the center). */
export function flightsForAmount(amount: number, range: FlightRange): Flight[] {
  const p = pileOf(amount);
  const coins: DrainPlan['coins'] = [];
  for (const m of METALS) for (let k = 0; k < p[m]; k++) coins.push({ metal: m, breaks: [] });
  return planFlights({ coins, rest: p.rest }, range);
}

/** Split `amount` into `n` integer chunks (the last absorbs the rounding). */
export function chunks(amount: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(amount / n);
  const out = Array.from({ length: n }, () => base);
  out[n - 1]! += amount - base * n;
  return out;
}

// ---------------------------------------------------------------------------------------- counting

/** Count-up length (ms) for an amount (research 06 §2.4): 500 + 300·log10(1 + amount/10), ≤ 1,100. */
export function countMs(amount: number): number {
  return Math.min(1100, Math.max(500, 500 + 300 * Math.log10(1 + Math.abs(amount) / 10)));
}

/** Ease-out cubic. */
export const easeOutCubic = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

/** Pentatonic ladder (semitones) for arriving coins, capped by the tier's top. */
export const LADDER = [0, 2, 4, 7, 9, 12, 14, 16] as const;
export function ladderStep(i: number, top: number): number {
  const allowed = LADDER.filter((s) => s <= top);
  return allowed[Math.min(i, allowed.length - 1)]!;
}
