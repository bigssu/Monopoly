/**
 * Economy constants — the single place to tune the game's money flow.
 *
 * Property prices live in `src/content/board.ts`; card amounts in `src/content/cards.ts`.
 * Everything else that moves money is here. docs/BALANCE.md has the full simulation report.
 *
 * SETTLED NUMBERS (500 seeds, 4 normal CPUs, default settings, `npm run sim`):
 *   median 15 rounds (cap), mean 13.6 · 41.2% end before the 15-round cap
 *   (34.8% bankruptcy, 4.0% hub, 1.6% line, 0.8% triple) · bankruptcy before round 5 in 0.2%
 *   of games, before round 8 in 1.8%.
 *
 * CHANGES vs DESIGN §4 (see docs/BALANCE.md for why):
 *   - City toll rates L0–L4: 0.10 / 0.35 / 0.90 / 1.60 / 3.00 × P  →  0.10 / 1.00 / 2.00 / 3.00 / 4.00 × P
 *   - `buildOnPurchase`: a city may get its first level on the visit it is bought (§4 is silent).
 *   - New setting `endOnFirstBankruptcy` (default on, in Settings — not here): the first
 *     bankruptcy ends the game and total assets decide.
 *   Everything else (salary 300, build costs, 2× takeover, hub tolls, tax, donation, bail,
 *   island, card amounts, start cash) is exactly as in §4.
 */

/**
 * Skill throw (rules version 3, docs/research/11-skill-throw.md §1): the chance at a perfect
 * accuracy that the roll is drawn inside the aimed band. 0.6 → the two-dice low band (2–5, 27.8 %
 * naturally) comes up 0.6 + 0.4 × 0.278 ≈ 71 % of the time. Chosen by simulation (docs/BALANCE.md
 * "Rules version 3").
 */
export const SKILL_CAP = 0.6;

/** Skill throw bands [low, high] by stride (inclusive sums). */
export const SKILL_BANDS: Readonly<Record<1 | 2, Readonly<Record<'low' | 'high', readonly [number, number]>>>> = {
  1: { low: [1, 2], high: [5, 6] },
  2: { low: [2, 5], high: [9, 12] },
};

export const ECONOMY = {
  /** Default starting cash (setup options: 2,000 / 3,000 / 5,000). */
  startCash: 3000,
  /** Salary for passing (or landing on) Start. */
  salary: 300,

  /**
   * City toll as a fraction of price, indexed by building level
   * (0 land, 1 villa, 2 building, 3 hotel, 4 landmark). Rounded to the nearest 10.
   */
  tollRates: [0.1, 1.0, 2.0, 3.0, 4.0] as readonly number[],
  /** Land-only (level 0) toll multiplier when the owner holds the complete color group. */
  groupLandMultiplier: 2,
  /** Festival marker toll multiplier (one marker on the board, never stacks). */
  festivalMultiplier: 2,
  /** Grand festival (대축제): festival multiplier by level 1..3 (rules ≥ normal). */
  grandFestivalMultipliers: [2, 3, 5],
  /** Late toll: with a round limit, the last `lateTollRounds` rounds add `lateTollStep` each. */
  lateTollRounds: 5,
  lateTollStep: 0.25,
  /** Hub growth: each toll paid at a hub adds one step, up to ×`hubGrowthMax` (rules = advanced). */
  hubGrowthMax: 4,
  /** Double-up: right guesses allowed on the salary (×2 each), rules = advanced. */
  doubleUpMaxWins: 3,
  /** Seat bonus (rules ≥ normal): extra start cash by turn order (sim: seat win spread 16 → 4 pp). */
  seatBonus: [0, 200, 400, 600],
  /** Dice gauge: chance (at a full pull) of a second roll that keeps the low/high one. */
  diceGaugeBias: 0.35,

  /**
   * Build cost as a fraction of price, indexed by the level being built
   * (index 0 unused). Rounded to the nearest 10.
   */
  buildCostRates: [0, 0.5, 0.6, 0.7, 1.0] as readonly number[],
  /** Highest building level (landmark). */
  maxLevel: 4,
  /**
   * After buying a city the buyer may immediately build one level on the same visit
   * (still "one level per visit"). DESIGN §4 is silent; turning it off drops the
   * before-cap rate from 41% to 11%.
   */
  buildOnPurchase: true,
  /** After a takeover the new owner may build one level on the same visit. */
  buildAfterTakeover: true,

  /** Takeover price = multiplier × property value. */
  takeoverMultiplier: 2,

  /** Hub toll = perHub × hubs owned by the owner. */
  hubTollPerHub: 100,

  /** Tax office: fraction of current cash, rounded to 10, paid into the pot. */
  taxRate: 0.1,
  /** Donation box: fixed amount (or all cash if less), paid into the pot. */
  donation: 100,

  /** Island: number of turns you may be stuck (you leave automatically after this many failures). */
  islandTurns: 3,
  /** Island bail (paid to the bank). */
  bail: 200,
  /** Third consecutive doubles sends you to the island. */
  maxConsecutiveDoubles: 3,

  /** Selling back to the bank: fraction of build cost / price / value. */
  sellRate: 0.5,

  /** Auction: opening bid and increment as fractions of the price (rounded to 10). */
  auctionStartRate: 0.5,
  auctionIncrementRate: 0.1,

  /** Default round limit (setup options 10/15/20/30/∞). */
  defaultRoundLimit: 15,

  // --- Rules version 2 (docs/research/08-fun-analysis.md, docs/BALANCE.md "Fun rules") ---------
  /** Lucky vault: the bank adds this to the pot at the start of every round (from round 2). */
  vaultSeed: 100,
  /** News flash: a headline every this many rounds (rounds 4, 8, 12, …). */
  newsEvery: 4,
  /** News "toll fever": every toll × this for the round. */
  newsTollMultiplier: 2,
  /** News "build boom": build costs × this for the round (rounded to 10). */
  newsBuildRate: 0.5,
  /** News "takeover sale": takeover price = this × value for the round (instead of 2×). */
  newsTakeoverMultiplier: 1.5,
  /** News "share day": the richest gives this fraction of their cash to the poorest (rounded to 10). */
  newsShareRate: 0.1,
  /** News "vault boom": the bank matches the pot, at least this much. */
  newsVaultMin: 200,
  /** Comeback card offer: the drawer is last and the leader has at least this × their assets. */
  comebackGap: 1.25,
  /** All or nothing: a die of at least this pays no tax; below it pays the tax × `gambleLoss`. */
  gambleWinFrom: 4,
  gambleLoss: 2,
  /** Win-back: the player who lost a city in a takeover may take it back for this × value. */
  winBackMultiplier: 1,

  // --- Rules version 3 (docs/research/10-strategy-depth.md, docs/BALANCE.md "Rules version 3") ---
  /** Skill throw assist cap (`SKILL_CAP`); read through here so the balance scripts can sweep it. */
  skillCap: SKILL_CAP as number,
} as const;
