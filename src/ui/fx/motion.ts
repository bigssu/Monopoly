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
 * - reach:      ease-out with a small overshoot (the CPU hand arriving on a control)
 */
export const EASE = {
  settle: 'cubic-bezier(.22,1,.36,1)',
  overshoot: 'cubic-bezier(.34,1.56,.64,1)',
  anticipate: 'cubic-bezier(.36,0,.66,-0.56)',
  breathe: 'cubic-bezier(.45,0,.55,1)',
  inOut: 'cubic-bezier(.65,0,.35,1)',
  reach: 'cubic-bezier(.25,1.3,.5,1)',
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

/**
 * The CPU hand (src/ui/stage/CpuHand.ts): before a CPU decision is dispatched, a glove reaches
 * from the CPU's seat to the control it chose and presses it. Tweens (`anim`, speed/skip only)
 * and beats (`sleep`, × game pace). The dispatch happens at the release; lift and exit run on
 * during the decision's own animation and add no time.
 *
 * Added time per decision = reach + hover + press + hold:
 * pace 1 (fastest) ≈ 390 ms, pace 2 (default) ≈ 520 ms, pace 3 ≈ 650 ms; a roll is held longer so
 * the dice shake reads, then flicked (≈ 830 ms at pace 2). Headless (speed 0): none, the hand is not shown.
 */
export const HAND = {
  /** Seat edge → control (tween). Shorter at a fast game pace: 180 + 30 × pace ms. */
  reachBase: 180,
  reachPerPace: 30,
  /** On the control before pressing (beat). */
  hover: 40,
  /** Press down (tween). */
  press: 80,
  /** Held down (beat); a roll is held so the dice shake can be seen. */
  hold: 60,
  holdRoll: 160,
  /** A roll's flick: the short stroke toward the board centre that throws the dice (tween). */
  flick: 110,
  /** Lift and leave (tweens, not waited for). */
  lift: 90,
  exit: 240,
  /** Ripple ring around the pressed control (decoration). */
  ring: 380,
} as const;
