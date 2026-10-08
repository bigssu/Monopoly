/**
 * Which on-screen control a CPU decision is "pressed" on (the CPU hand, `CpuHand.ts`).
 *
 * Pure (no DOM): the controls are found by the stable `data-*` hooks `prompts.ts` puts on every
 * prompt button (`data-action`, `data-space`, `data-card`, `data-guess`).
 *
 * - `pad`: the roll pad over the stage centre (Stage.armPad): the hand presses the dice, holds
 *   them while they rattle, and flicks toward the board centre (the throw follows the stroke).
 * - `control`: a button in the prompt card (buy, pass, sell, bid, card, guess, the island roll…).
 *   `space` is the board space it is about, highlighted while pressed (debt sales).
 * - `space`: a board space (travel destination, festival, free upgrade, typhoon target, build
 *   anywhere). `selector` is the matching row of the prompt's list, shown pressed with it.
 * - `none`: no visible control; the CPU acts without the hand. Only reachable with an action the
 *   phase does not offer (every legal CPU action has a control, see the unit test).
 *
 * Event cards are not a decision: their reveal dismisses itself after the read time for every
 * player (Stage.showCard), so there is nothing for the CPU to tap.
 */
import type { Action, ActionType, GameState, Phase } from '@/engine';

export type HandTarget =
  | { kind: 'pad'; selector: string }
  | { kind: 'control'; selector: string; space: number | null; hold: boolean }
  | { kind: 'space'; space: number; selector: string | null }
  | { kind: 'none'; reason: string };

/** Phases whose prompt shows a "Pass" (or decline / stop / pay) button. */
const PASS_BUTTON: ReadonlySet<Phase['kind']> = new Set<Phase['kind']>([
  'buy', 'build', 'takeover', 'festival', 'freeUpgrade', 'travel', 'auction', 'doubleUp', 'useCard', 'gamble', 'invest',
]);

/** Board-pick actions: the hand taps the space on the board. */
const BOARD_PICK: ReadonlySet<ActionType> = new Set<ActionType>(['ChooseTravel', 'SetFestival', 'FreeUpgrade', 'ChooseTarget', 'Invest', 'Counterbuy']);

/** The phase each action is offered in (`legalActions`). */
const OFFERED_IN: Record<ActionType, ReadonlyArray<Phase['kind']>> = {
  Roll: ['preRoll', 'island'],
  PayBail: ['island'],
  UseEscapeCard: ['island'],
  ChooseTravel: ['travel'],
  Buy: ['buy'],
  Build: ['build'],
  Takeover: ['takeover'],
  SetFestival: ['festival'],
  FreeUpgrade: ['freeUpgrade'],
  Bid: ['auction'],
  SellBuilding: ['debt'],
  SellProperty: ['debt'],
  ChooseCard: ['cardChoice'],
  UseCard: ['useCard'],
  DoubleUpGuess: ['doubleUp'],
  ChooseTarget: ['target'],
  Gamble: ['gamble'],
  // Rules version 3: the start investment's list, and the block-buy strip under the turn's prompt.
  Invest: ['invest'],
  Counterbuy: ['preRoll', 'island', 'travel'],
  Pass: [...PASS_BUTTON],
};

/** CSS selector of the prompt control that dispatches `a` (prompts.ts `button()` / pick rows). */
export function controlSelector(a: Action): string {
  let sel = `[data-action="${a.type}"]`;
  if ('spaceIndex' in a) sel += `[data-space="${a.spaceIndex}"]`;
  if ('cardId' in a) sel += `[data-card="${a.cardId}"]`;
  if ('guess' in a) sel += `[data-guess="${a.guess}"]`;
  return sel;
}

/** The board space the current prompt is about, if any (buy / build / takeover / auction / use card). */
function phaseSpace(ph: Phase): number | null {
  return 'spaceIndex' in ph && typeof ph.spaceIndex === 'number' ? ph.spaceIndex : null;
}

export function cpuHandTarget(state: GameState, a: Action): HandTarget {
  const ph = state.phase;
  if (ph.kind === 'gameOver') return { kind: 'none', reason: 'game over' };
  // The land swap's target prompt (rules version 2) has a "keep mine" Pass; the typhoon's has none.
  const swapPass = a.type === 'Pass' && ph.kind === 'target' && ph.card === 'swap';
  if (!OFFERED_IN[a.type].includes(ph.kind) && !swapPass) return { kind: 'none', reason: `${a.type} has no control in the ${ph.kind} prompt` };
  // The turn's roll: the pad (the roll button, when shown in Settings, is not what the hand uses).
  if (a.type === 'Roll' && ph.kind === 'preRoll') return { kind: 'pad', selector: '.roll-pad' };
  if (BOARD_PICK.has(a.type) && 'spaceIndex' in a) return { kind: 'space', space: a.spaceIndex, selector: controlSelector(a) };
  const space = 'spaceIndex' in a ? a.spaceIndex : phaseSpace(ph);
  return { kind: 'control', selector: controlSelector(a), space, hold: a.type === 'Roll' };
}
