/**
 * Motion language (the 12 principles of animation, one vocabulary for the whole app). The same
 * curves and durations live in tokens.css (`--ease-*`, `--t-*`) for stylesheets; code animations
 * (`anim()` in fx/time.ts) use these constants.
 *
 * - settle:     slow-out to rest (entrances, moves) — "slow in and slow out"
 * - overshoot:  goes past and springs back (pops, releases) — "squash & stretch", "follow-through"
 * - anticipate: pulls back a little before leaving (exits) — "anticipation"
 * - breathe:    symmetric slow in/out for loops (calls to act, idle floats)
 * - inOut:      deliberate travel between two places (stage turns, arcs)
 */
export const EASE = {
  settle: 'cubic-bezier(.22,1,.36,1)',
  overshoot: 'cubic-bezier(.34,1.56,.64,1)',
  anticipate: 'cubic-bezier(.36,0,.66,-0.56)',
  breathe: 'cubic-bezier(.45,0,.55,1)',
  inOut: 'cubic-bezier(.65,0,.35,1)',
} as const;

/**
 * Pacing beats (ms) for game moments, held with `sleep()` so the Settings "게임 속도" stretches
 * them. UI chrome stays uniform (EASE/DUR); game moments are split into beats — anticipation →
 * action → reaction → rest — so each can be followed and enjoyed. Tune pacing here, not inline.
 */
export const BEAT = {
  /** Staging: the turn banner reads before anything moves. */
  turnBanner: 450,
  /** The rolled total, held big so it can be read (Stage.bigTotal). */
  diceRead: 500,
  /** After the doubles stamp, before the move. */
  doubles: 300,
  /** A failed island roll lands. */
  islandFail: 300,
  /** Settle on the landing space before its consequence (toll, prompt, card). */
  landing: 350,
  /** After a money change (and the toll receiver's number pop). */
  money: 300,
  moneyBankrupt: 150,
  /** The one-away warning reads before play goes on. */
  oneAway: 500,
  /** Silence between a bankruptcy crack and the finale. */
  bankruptSilence: 400,
  /** The game-over stamp lingers before the result screen. */
  finale: 1100,
  /** Anticipation: after the total is read, a breath before the token sets off. */
  beforeMove: 300,
  /** A change on the board or a panel (bought, built, taken over, card kept…) is seen before the
   * next one starts: the events whose own animation the sequencer does not wait for. */
  change: 400,
  /** The last change settles before the next decision's buttons pop in. */
  beforePrompt: 300,
} as const;

/** Durations (ms) shared with tokens.css. */
export const DUR = {
  press: 90,
  release: 260,
  enter: 380,
  exit: 220,
  breathe: 2000,
  stagger: 60,
} as const;
