/**
 * Engine types. Everything here is plain JSON-serializable data.
 *
 * UI contract:
 *  - Render any `GameState` statelessly (resume).
 *  - `state.phase.kind` says which prompt to show and `phase.playerId` who must act
 *    (the Stage rotates toward that player's seat).
 *  - Animate `GameEvent`s returned from `reduce` in order.
 */
import type { CardId, KeepableCardId } from '../content/cards';
import type { GroupId, SideId } from '../content/board';

export type { CardId, KeepableCardId } from '../content/cards';
export type { GroupId, SideId, SpaceKind, SpaceDef } from '../content/board';

/** Player ids are their index in `state.players` (turn order). */
export type PlayerId = number;

export type Seat = 'S' | 'E' | 'N' | 'W';
export type CpuLevel = 'easy' | 'normal';

/** Building level: 0 land, 1 villa, 2 building, 3 hotel, 4 landmark. */
export type Level = 0 | 1 | 2 | 3 | 4;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface PlayerSetup {
  name: string;
  tokenId: string;
  colorId: string;
  seat: Seat;
  isCpu: boolean;
  cpuLevel: CpuLevel;
}

export interface Settings {
  players: PlayerSetup[];
  /** 2,000 / 3,000 / 5,000. */
  startCash: number;
  /** Rounds before the game ends on assets; `null` = unlimited. */
  roundLimit: number | null;
  /** Takeover (인수) allowed. Default on. */
  takeover: boolean;
  /** Auction when a player declines to buy. Default off. */
  auction: boolean;
  /**
   * The first bankruptcy ends the game (richest solvent player wins, victory `bankruptcy`)
   * instead of eliminating the player and playing on. Default on (see docs/BALANCE.md):
   * keeps a 30-minute table game from leaving someone watching for half the session.
   */
  endOnFirstBankruptcy: boolean;
  /** Allow building on any own city once per turn before rolling. Default off. */
  buildAnywhere: boolean;
  /** Prompt soft timer in seconds (UI only; 0 = off). */
  promptTimer: 0 | 15 | 30;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface Player {
  id: PlayerId;
  name: string;
  tokenId: string;
  colorId: string;
  seat: Seat;
  isCpu: boolean;
  cpuLevel: CpuLevel;
  cash: number;
  position: number;
  /** Island turns remaining (0 = free). */
  islandTurns: number;
  bankrupt: boolean;
  /** Keepable cards in hand. */
  cards: KeepableCardId[];
  /** Landed on TRAVEL: next turn may choose a destination. */
  travelPending: boolean;
  /** 급행 card: next movement roll is doubled. */
  expressPending: boolean;
  consecutiveDoubles: number;
}

export interface PropertyState {
  owner: PlayerId | null;
  level: Level;
}

/** Who receives a payment. */
export type Payee = PlayerId | 'bank' | 'pot';

export interface Payment {
  to: Payee;
  amount: number;
}

export type MoneyReason =
  | 'salary'
  | 'pot'
  | 'toll'
  | 'purchase'
  | 'build'
  | 'takeover'
  | 'tax'
  | 'donation'
  | 'bail'
  | 'card'
  | 'sale'
  | 'auction'
  | 'bankruptcy';

/** What happens after a debt is settled. */
export type Continuation =
  | { kind: 'takeoverCheck'; spaceIndex: number }
  | { kind: 'endLanding' };

export type VictoryKind =
  | 'lastStanding'
  | 'bankruptcy'
  | 'triple'
  | 'line'
  | 'hubs'
  | 'roundLimit';

export interface RankingEntry {
  playerId: PlayerId;
  rank: number;
  cash: number;
  propertyValue: number;
  totalAssets: number;
  cities: number;
  hubs: number;
  bankrupt: boolean;
}

export interface GameResult {
  winnerId: PlayerId;
  victory: VictoryKind;
  /** Groups completed (triple), side (line) — for the result screen. */
  groups?: GroupId[];
  side?: SideId;
  round: number;
  ranking: RankingEntry[];
}

export type Phase =
  /** Waiting for the current player to roll (after doubles: roll again). */
  | { kind: 'preRoll'; playerId: PlayerId; rollAgain: boolean }
  /** Stuck on the island: Roll (escape on doubles), PayBail, UseEscapeCard. */
  | {
      kind: 'island';
      playerId: PlayerId;
      /** Island turns remaining including this one (3, 2, 1). */
      turnsLeft: number;
      bail: number;
      canPayBail: boolean;
      hasEscapeCard: boolean;
    }
  /** On TRAVEL from last turn: ChooseTravel{spaceIndex} or Pass (then roll normally). */
  | { kind: 'travel'; playerId: PlayerId; options: number[] }
  /** Unowned property: Buy or Pass. */
  | { kind: 'buy'; playerId: PlayerId; spaceIndex: number; price: number }
  /** Own city: Build (one level) or Pass. */
  | { kind: 'build'; playerId: PlayerId; spaceIndex: number; toLevel: Level; cost: number }
  /** After paying toll: Takeover or Pass. */
  | {
      kind: 'takeover';
      playerId: PlayerId;
      spaceIndex: number;
      ownerId: PlayerId;
      price: number;
      /** Owner holds a 수호 방패 (the attempt will be blocked). Public info. */
      ownerHasShield: boolean;
    }
  /** Festival corner: SetFestival{spaceIndex} or Pass. */
  | { kind: 'festival'; playerId: PlayerId; options: number[] }
  /** Free upgrade card: FreeUpgrade{spaceIndex} or Pass. */
  | { kind: 'freeUpgrade'; playerId: PlayerId; options: number[] }
  /** Auction: `playerId` is the bidder who must act now: Bid (at `minBid`) or Pass (drop out). */
  | {
      kind: 'auction';
      playerId: PlayerId;
      spaceIndex: number;
      /** The player who declined to buy (whose turn it is). */
      declinedBy: PlayerId;
      /** Bidding order. */
      order: PlayerId[];
      /** Still in the auction. */
      active: PlayerId[];
      highBid: number | null;
      highBidderId: PlayerId | null;
      /** The amount a Bid action commits to. */
      minBid: number;
      increment: number;
    }
  /** Must raise cash: SellBuilding / SellProperty until cash ≥ amount (then auto-paid). */
  | {
      kind: 'debt';
      playerId: PlayerId;
      amount: number;
      payments: Payment[];
      reason: MoneyReason;
      then: Continuation;
      /** Set when the debt is a toll (TollPaid is emitted on settlement). */
      toll?: TollInfo;
    }
  | { kind: 'gameOver'; result: GameResult };

export interface TollInfo {
  spaceIndex: number;
  ownerId: PlayerId;
  baseToll: number;
  festival: boolean;
  multiplier: number;
}

export type PhaseKind = Phase['kind'];
export type PromptPhase = Exclude<Phase, { kind: 'gameOver' }>;

/** Test-only deterministic overrides (never set by the UI). */
export interface TestHooks {
  diceQueue?: Array<[number, number]>;
  cardQueue?: CardId[];
  /** Overrides for random picks (random city / typhoon / festival invite): index into the candidate list. */
  pickQueue?: number[];
}

export interface GameState {
  /** State schema version (see save.ts). */
  schema: 1;
  settings: Settings;
  seed: number;
  /** mulberry32 state. */
  rng: number;
  players: Player[];
  /** One entry per board space; `null` for non-property spaces. */
  properties: (PropertyState | null)[];
  /** City index holding the (single) festival marker. */
  festival: number | null;
  /** Donation pot. */
  pot: number;
  /** 1-based round number. */
  round: number;
  /** Total turns started. */
  turn: number;
  /** Whose turn it is. */
  current: PlayerId;
  phase: Phase;
  lastDice: [number, number] | null;
  /** The current roll was doubles and earns another roll after resolution. */
  extraRoll: boolean;
  /** buildAnywhere: remote build already used this turn. */
  remoteBuildUsed: boolean;
  /** Players in the order they went bankrupt. */
  bankruptOrder: PlayerId[];
  testHooks?: TestHooks;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'Roll'; playerId: PlayerId }
  | { type: 'PayBail'; playerId: PlayerId }
  | { type: 'UseEscapeCard'; playerId: PlayerId }
  | { type: 'ChooseTravel'; playerId: PlayerId; spaceIndex: number }
  | { type: 'Buy'; playerId: PlayerId }
  | { type: 'Build'; playerId: PlayerId; spaceIndex: number }
  | { type: 'Takeover'; playerId: PlayerId }
  | { type: 'SetFestival'; playerId: PlayerId; spaceIndex: number }
  | { type: 'FreeUpgrade'; playerId: PlayerId; spaceIndex: number }
  | { type: 'Bid'; playerId: PlayerId }
  | { type: 'SellBuilding'; playerId: PlayerId; spaceIndex: number }
  | { type: 'SellProperty'; playerId: PlayerId; spaceIndex: number }
  /** Decline the current prompt (buy/build/takeover/festival/freeUpgrade/travel/auction). */
  | { type: 'Pass'; playerId: PlayerId };

export type ActionType = Action['type'];

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type Counterpart = PlayerId | 'bank' | 'pot';

export type MoveCause = 'roll' | 'card' | 'travel' | 'island';

export type GameEvent =
  | { type: 'RoundStarted'; round: number }
  | { type: 'TurnStarted'; playerId: PlayerId; round: number; turn: number }
  | { type: 'TurnEnded'; playerId: PlayerId }
  | {
      type: 'DiceRolled';
      playerId: PlayerId;
      dice: [number, number];
      total: number;
      isDouble: boolean;
      /** Consecutive doubles this turn including this roll (0 if not a double). */
      consecutiveDoubles: number;
      /** 급행 applied: movement = total × 2. */
      express: boolean;
      /** Spaces the token will move (0 if the roll does not move: island fail / 3rd double). */
      steps: number;
      context: 'normal' | 'island';
    }
  | {
      type: 'TokenMoved';
      playerId: PlayerId;
      from: number;
      to: number;
      /** Every index stepped on, in order, excluding `from`, including `to`. For `jump` just [to]. */
      path: number[];
      direction: 'forward' | 'backward';
      /** 'walk' = hop space by space; 'jump' = teleport (island). */
      mode: 'walk' | 'jump';
      /** Salary is paid for this move (passed or landed on Start going forward). */
      passedStart: boolean;
      cause: MoveCause;
    }
  | { type: 'PassedStart'; playerId: PlayerId; salary: number; landed: boolean }
  | {
      type: 'MoneyChanged';
      playerId: PlayerId;
      delta: number;
      /** Cash after the change. */
      balance: number;
      reason: MoneyReason;
      counterpart: Counterpart;
      spaceIndex?: number;
    }
  | { type: 'PotChanged'; delta: number; pot: number }
  | { type: 'PropertyBought'; playerId: PlayerId; spaceIndex: number; price: number; via: 'buy' | 'auction' }
  | { type: 'CannotAfford'; playerId: PlayerId; spaceIndex: number; price: number }
  | { type: 'Built'; playerId: PlayerId; spaceIndex: number; level: Level; cost: number; free: boolean }
  | {
      type: 'Demolished';
      spaceIndex: number;
      ownerId: PlayerId;
      level: Level;
      cause: 'typhoon' | 'sale';
    }
  | {
      type: 'TollPaid';
      payerId: PlayerId;
      ownerId: PlayerId;
      spaceIndex: number;
      amount: number;
      /** Toll before the card multiplier and the pass. */
      baseToll: number;
      festival: boolean;
      /** Extra multiplier from a card (nearest-hub double toll). */
      multiplier: number;
      /** 통행료 면제권 consumed: nothing paid. */
      waived: boolean;
    }
  | { type: 'TakenOver'; buyerId: PlayerId; sellerId: PlayerId; spaceIndex: number; price: number }
  | { type: 'TakeoverBlocked'; buyerId: PlayerId; ownerId: PlayerId; spaceIndex: number }
  | { type: 'CardDrawn'; playerId: PlayerId; cardId: CardId }
  | { type: 'CardKept'; playerId: PlayerId; card: KeepableCardId }
  | { type: 'CardUsed'; playerId: PlayerId; card: KeepableCardId }
  | { type: 'ExpressGranted'; playerId: PlayerId }
  | { type: 'CardNoEffect'; playerId: PlayerId; cardId: CardId }
  | { type: 'SentToIsland'; playerId: PlayerId; cause: 'space' | 'doubles' | 'card' }
  | { type: 'IslandStay'; playerId: PlayerId; turnsLeft: number }
  | { type: 'Escaped'; playerId: PlayerId; method: 'doubles' | 'bail' | 'card' | 'served' }
  | { type: 'FestivalSet'; playerId: PlayerId; spaceIndex: number | null; previous: number | null }
  | { type: 'TravelGranted'; playerId: PlayerId }
  | { type: 'TravelDeclined'; playerId: PlayerId }
  | { type: 'DebtStarted'; playerId: PlayerId; amount: number; shortfall: number; reason: MoneyReason }
  | { type: 'DebtSettled'; playerId: PlayerId; amount: number }
  | { type: 'BuildingSold'; playerId: PlayerId; spaceIndex: number; level: Level; amount: number }
  | { type: 'PropertySold'; playerId: PlayerId; spaceIndex: number; amount: number }
  | {
      type: 'PropertyTransferred';
      spaceIndex: number;
      from: PlayerId;
      /** `null` = back to the bank (unowned, buildings removed). */
      to: PlayerId | null;
      level: Level;
    }
  | { type: 'Bankrupt'; playerId: PlayerId; creditorId: PlayerId | null; round: number }
  | { type: 'AuctionStarted'; spaceIndex: number; declinedBy: PlayerId; minBid: number; bidders: PlayerId[] }
  | { type: 'AuctionBid'; playerId: PlayerId; spaceIndex: number; amount: number }
  | { type: 'AuctionDropped'; playerId: PlayerId; spaceIndex: number; reason: 'pass' | 'cannotAfford' }
  | { type: 'AuctionEnded'; spaceIndex: number; winnerId: PlayerId | null; price: number }
  | {
      type: 'OneAway';
      playerId: PlayerId;
      kind: 'group' | 'line' | 'hub';
      id: GroupId | SideId | 'hubs';
      /** The missing property index. */
      missing: number;
    }
  | { type: 'PromptOpened'; phase: PromptPhase }
  | { type: 'GameOver'; result: GameResult };

export type GameEventType = GameEvent['type'];

export interface ReduceResult {
  state: GameState;
  events: GameEvent[];
}
