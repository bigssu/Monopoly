/**
 * Event sequencer.
 *
 * After each `reduce`, the controller calls `playEvents(view, prev, events, next)`. The sequencer
 * keeps a *view state* (a clone of `prev`) and walks the engine events in order: each event
 * patches the view state (so the board/panels re-render statelessly) and plays its animation —
 * DOM (hop, tumble, flip, toasts, stamps) plus the canvas VFX presets chosen by `fxmap.ts`
 * (docs/VFX.md §7). At the end the view is synced to `next`, so any drift is corrected and a
 * resumed game renders identically.
 *
 * VFX rules (docs/VFX-WIRING.md §8):
 * - The sequencer awaits a preset's *block* frame only; its tail plays on in the background.
 * - Purchases, builds and takeovers apply their state at the preset's cue ('frame' / 'swap'):
 *   the owner colour / level icon changes under the dust curtain, not before the effect.
 * - Presets carry their own sounds / haptics / shake; the matching old calls are gone here.
 *
 * Speed: every duration goes through `fx/time` — `setAnimSpeed(0)` makes the whole queue
 * instant and plays no effect (tests), a "skip" tap accelerates it ×5 (and fires pending fx cues
 * now), prefers-reduced-motion is instant for DOM motion while the presets still play their
 * sound + a static highlight (VFX.md §8.3).
 */
import { deepClone, getBoardInfo, groupOf, isFinalStretch, type GameEvent, type GameState, type Level, type PlayerId } from '@/engine';
import { GROUP_NAMES } from '@/content/board';
import { getCard } from '@/content/cards';
import { playerColor } from '@/content/palette';
import { loc, t } from '@/i18n';
import type { GameView } from '@/ui/game/view';
import { isDevHook, money, spaceIcon } from '@/ui/game/util';
import { edgeToast } from './floats';
import { groupFx, planFx, type FxCtx, type FxStep } from './fxmap';
import { animSpeed, sleep, turnRest, wait } from './time';
import { BEAT } from './motion';
import { playMusic } from '@/ui/audio/music';
import type { FxPlay } from './vfx';

type Alive = () => boolean;
const boardOf = (state: GameState) => getBoardInfo(state.settings.spacesPerSide ?? 7).board;

/** Dev (?dev=1): a User Timing mark per event, so perf traces can say what a long frame was doing. */
const MARK = typeof window !== 'undefined' && isDevHook();

/** Per-batch state shared between events (toll arrival → receiver float, transfer count, previous event). */
interface Batch {
  tollArrive: Promise<void> | null;
  transfers: number;
  prev: GameEvent['type'] | null;
}

export async function playEvents(
  view: GameView,
  prev: GameState,
  events: readonly GameEvent[],
  next: GameState,
  alive: Alive,
): Promise<void> {
  const vs = deepClone(prev);
  // Reduced motion still plays the sequence (still frames, same beats); only speed 0 skips it.
  const fast = animSpeed() === 0;
  const batch: Batch = { tollArrive: null, transfers: 0, prev: null };
  for (const ev of events) {
    if (!alive()) return;
    try {
      if (MARK) performance.mark(`lr:${ev.type}`);
      // Let the dealer finish the last line before the stage turns to the next player (and before
      // he announces that turn), so he is never spun around mid-sentence.
      if (!fast && ev.type === 'TurnStarted') {
        await view.dealer.whenQuiet();
        if (!alive()) return;
      }
      if (!fast) view.director.onEvent(ev, vs, 'before');
      await step(view, vs, ev, fast, batch);
      if (!fast) view.director.onEvent(ev, vs, 'after');
    } catch (e) {
      // An animation must never break the game loop.
      console.error('[animate]', ev.type, e);
    }
    batch.prev = ev.type;
  }
  if (!alive()) return;
  // The next prompt waits for a big moment (landmark, takeover, monopoly…) to finish its beats.
  await settleBig(view);
  if (!alive()) return;
  view.render(next);
}

/** Wait for running I3+ effects to finish their timeline (skip-aware: they run ×10 when skipped). */
function settleBig(view: GameView): Promise<void> {
  return fxOn() ? view.vfx.settled(3) : Promise.resolve();
}

function render(view: GameView, vs: GameState): void {
  view.render(vs);
}

const NOOP: FxPlay = (() => {
  const p = Promise.resolve();
  return { name: '', tier: 0, then: p.then.bind(p), cue: () => p, done: p, block: p, cancel() {} };
})();

/** Effects run unless the animation speed is 0 (tests); reduced motion is handled by the engine. */
const fxOn = (): boolean => animSpeed() > 0;

function play(view: GameView, s: FxStep): FxPlay {
  if (!fxOn()) return NOOP;
  return view.vfx.play(s.preset as never, s.params as never);
}

/**
 * Play the (non-hop) steps in order. `apply` runs once, at the first step's `applyAt` cue (or
 * right away when no step defers it); each step's `wait` is honoured. Returns the handles.
 */
async function runSteps(view: GameView, steps: readonly FxStep[], apply?: () => void): Promise<FxPlay[]> {
  const hs: FxPlay[] = [];
  let applied = !apply;
  for (const s of steps) {
    if (s.hop !== undefined) continue;
    const h = play(view, s);
    hs.push(h);
    if (s.applyAt && !applied) {
      await h.cue(s.applyAt);
      applied = true;
      apply!();
    }
    if (s.wait === 'block') await h;
    else if (s.wait === 'done') await h.done;
  }
  if (!applied) apply!();
  return hs;
}

/** Start the steps without waiting (the caller awaits handles itself). */
function fire(view: GameView, steps: readonly FxStep[]): FxPlay[] {
  return steps.filter((s) => s.hop === undefined).map((s) => play(view, s));
}

function ctxFor(view: GameView, vs: GameState, batch: Batch): FxCtx {
  return {
    vs,
    cardAt: () => (fxOn() ? view.stage.cardClientCenter() : undefined),
    dice: () => (fxOn() ? view.stage.dice.clientCenters() : undefined),
    transfers: batch.transfers,
  };
}

/** Derived GroupCompleted: the colour group is now fully owned → chain + finale, "monopoly" stamp. */
async function groupMoment(view: GameView, vs: GameState, pid: PlayerId, i: number, fast: boolean): Promise<void> {
  const steps = groupFx(vs, pid, i);
  if (!steps.length || !fxOn()) return;
  const [h] = fire(view, steps);
  const g = groupOf(i, vs.settings.spacesPerSide ?? 7);
  if (!fast && g) void h!.cue('stamp').then(() => view.stage.stamp(t('g.monopoly.done', { name: loc(GROUP_NAMES[g]) }), 'gold'));
  void h!.cue('badge').then(() => view.panel(pid)?.bump());
  await h;
}

async function step(view: GameView, vs: GameState, ev: GameEvent, fast: boolean, batch: Batch): Promise<void> {
  const { board, stage } = view;
  const ctx = ctxFor(view, vs, batch);
  switch (ev.type) {
    case 'RoundStarted': {
      vs.round = ev.round;
      if (isFinalStretch(vs)) void playMusic('final');
      const steps = planFx(ev, ctx);
      if (!steps.length) {
        // Every new round gets its own beat (staging: the table sees the round turn over).
        if (!fast && ev.round > 1) await stage.toast(t('g.round.start', { n: ev.round }), 700, 'info', 'restart');
        return;
      }
      fire(view, steps);
      if (!fast) {
        view.playSfx('warning');
        await stage.toast(t('g.round.final', { n: 3 }), 900, 'gold', 'timer');
      }
      return;
    }
    case 'TurnStarted': {
      // Do not turn the stage away while the previous player's big moment (stamp, close-up) plays.
      if (!fast) await settleBig(view);
      const steps = planFx(ev, ctx);
      vs.current = ev.playerId;
      vs.round = ev.round;
      vs.turn = ev.turn;
      const p = vs.players[ev.playerId]!;
      render(view, vs);
      stage.setTurn(p, vs);
      stage.dice.show(vs.lastDice);
      board.setActiveToken(ev.playerId);
      if (fast) {
        void stage.rotateTo(p.seat);
        return;
      }
      fire(view, steps);
      await Promise.all([stage.rotateTo(p.seat), stage.announce()]);
      // Staging: let the turn banner read before anything else moves.
      await sleep(BEAT.turnBanner);
      return;
    }
    case 'TurnEnded':
      // Timing: a rest between players so the last moment lands before the next turn starts.
      if (!fast) await turnRest();
      return;
    case 'DiceRolled': {
      vs.lastDice = ev.dice;
      if (fast) {
        stage.dice.show(ev.dice);
        await runSteps(view, planFx(ev, ctx).filter((s) => s.wait));
        return;
      }
      await stage.dice.roll(ev.dice[0], ev.dice[1], ev.total, ev.isDouble);
      const hs = fire(view, planFx(ev, ctx));
      // Timing: the total, huge, held so it can be read before anything else happens.
      await stage.bigTotal(ev.total, BEAT.diceRead);
      if (ev.isDouble && ev.consecutiveDoubles >= 3) {
        // The siren preset plays the warning sound + haptic.
        await Promise.all([hs[1], stage.stamp(t('g.doubles.three'), 'bad')]);
      } else if (ev.isDouble) {
        // Staging: the stamp finishes before the token moves (one thing at a time).
        await stage.stamp(t('g.doubles'), 'gold');
        await sleep(BEAT.doubles);
      } else if (ev.context === 'island' && ev.steps === 0) {
        await sleep(BEAT.islandFail);
      }
      if (ev.express) void stage.toast(t('g.express'), 500, 'gold', 'hub-rail');
      return;
    }
    case 'TokenMoved': {
      const steps = planFx(ev, ctx);
      if (ev.mode === 'jump') await Promise.all([...fire(view, steps), board.jump(ev.playerId, ev.to)]);
      else {
        const hops = steps.filter((s) => s.hop !== undefined);
        await board.hop(ev.playerId, ev.path, ev.direction === 'backward', (n) => {
          const s = hops[n];
          if (s) void play(view, s);
        });
      }
      vs.players[ev.playerId]!.position = ev.to;
      render(view, vs);
      // Settle on the landing space before its consequence (toll, prompt, card) plays.
      if (!fast) await sleep(BEAT.landing);
      return;
    }
    case 'PassedStart': {
      // Salary coins fly Start → panel (the preset plays pass-start + cash-in).
      fire(view, planFx(ev, ctx));
      if (!fast && ev.landed) void stage.toast(t('g.passStart.landed'), 600, 'good', 'corner-start');
      return;
    }
    case 'MoneyChanged': {
      const steps = planFx(ev, ctx);
      vs.players[ev.playerId]!.cash = ev.balance;
      const toll = ev.reason === 'toll';
      const panel = view.panel(ev.playerId);
      if (toll && ev.delta > 0 && batch.tollArrive && !fast) {
        // The receiver's number pops when the toll coins land on their panel ('arrive' cue).
        await batch.tollArrive;
        batch.tollArrive = null;
        render(view, vs);
        panel?.float(ev.delta, t('g.toll'));
        await sleep(BEAT.money);
        return;
      }
      render(view, vs);
      // Toll: caption the float so the receiver (and payer) see what the money was for.
      panel?.float(ev.delta, toll ? t('g.toll') : undefined);
      fire(view, steps);
      if (fast) return;
      // Only reasons without a dedicated preset make their own sound (presets play cash-in / -out).
      if (ev.reason === 'pot' || ev.reason === 'sale') view.playSfx('cash-in');
      await sleep(ev.reason === 'bankruptcy' ? BEAT.moneyBankrupt : BEAT.money);
      return;
    }
    case 'PotChanged':
      vs.pot = ev.pot;
      render(view, vs);
      fire(view, planFx(ev, ctx));
      return;
    case 'PropertyBought': {
      const steps = planFx(ev, ctx);
      if (!fast) void stage.toast(t('g.bought', { name: loc(boardOf(vs)[ev.spaceIndex]!.short) }), 500, 'good', spaceIcon(boardOf(vs)[ev.spaceIndex]!));
      // Coins in → tag drop → the owner colour lands on the 'frame' cue.
      await runSteps(view, steps, () => {
        vs.properties[ev.spaceIndex]!.owner = ev.playerId;
        render(view, vs);
      });
      await groupMoment(view, vs, ev.playerId, ev.spaceIndex, fast);
      return;
    }
    case 'CannotAfford':
      fire(view, planFx(ev, ctx));
      if (!fast) await stage.toast(t('g.cannotAfford'), 700, 'bad', 'coin');
      return;
    case 'Built': {
      const steps = planFx(ev, ctx);
      const [h] = fire(view, steps);
      if (ev.level === 4 && !fast) void h!.cue('stamp').then(() => stage.stamp(t('g.landmark.done'), 'gold'));
      // Hammer hits → dust curtain → the new level icon is swapped in under the dust ('swap' cue).
      await h!.cue('swap');
      vs.properties[ev.spaceIndex]!.level = ev.level;
      render(view, vs);
      await h;
      return;
    }
    case 'Demolished': {
      vs.properties[ev.spaceIndex]!.level = ev.level;
      render(view, vs);
      const hs = fire(view, planFx(ev, ctx));
      if (fast) return;
      if (ev.cause === 'typhoon') {
        view.playSfx('warning');
        await Promise.all([
          ...hs,
          board.pulseSpace(ev.spaceIndex, 'shake'),
          stage.toast(t('g.typhoon', { name: loc(boardOf(vs)[ev.spaceIndex]!.short) }), 800, 'bad', spaceIcon(boardOf(vs)[ev.spaceIndex]!)),
        ]);
      } else await board.pulseSpace(ev.spaceIndex, 'shake');
      return;
    }
    case 'TollPaid': {
      const hs = fire(view, planFx(ev, ctx));
      batch.tollArrive = hs[0] && !ev.waived ? hs[0].cue('arrive') : null;
      if (fast) return;
      const payer = vs.players[ev.payerId]!;
      const owner = vs.players[ev.ownerId]!;
      await Promise.all([stage.showToll({ payer, owner, amount: ev.amount, festival: ev.festival, waived: ev.waived, multiplier: ev.multiplier }), ...hs]);
      return;
    }
    case 'TakenOver': {
      const [h] = fire(view, planFx(ev, ctx));
      if (!fast) void h!.cue('stamp').then(() => stage.stamp(t('g.takeover.done'), 'bad'));
      // Sirens → stamp impact → the ownership frame swaps on the 'frame' cue.
      await h!.cue('frame');
      vs.properties[ev.spaceIndex]!.owner = ev.buyerId;
      render(view, vs);
      await h;
      await groupMoment(view, vs, ev.buyerId, ev.spaceIndex, fast);
      return;
    }
    case 'TakeoverBlocked':
      fire(view, planFx(ev, ctx));
      if (!fast) {
        view.playSfx('warning');
        await stage.toast(t('g.takeover.blocked'), 900, 'bad', 'cards-shield');
      }
      return;
    case 'CardDrawn': {
      if (fast) {
        fire(view, planFx(ev, ctx));
        return;
      }
      // Glints around the card at the flip apex (the card rises 320 ms, flips 230 ms).
      const shown = stage.showCard(ev.cardId);
      await wait(430);
      fire(view, planFx(ev, ctx));
      await shown;
      return;
    }
    case 'CardKept':
      vs.players[ev.playerId]!.cards.push(ev.card);
      render(view, vs);
      fire(view, planFx(ev, ctx));
      return;
    case 'CardUsed': {
      const cards = vs.players[ev.playerId]!.cards;
      const k = cards.indexOf(ev.card);
      if (k >= 0) cards.splice(k, 1);
      render(view, vs);
      fire(view, planFx(ev, ctx));
      if (!fast) void stage.toast(t(`g.cardUsed.${ev.card}`), 700, 'gold', ev.card === 'escape' ? 'cards-escape' : ev.card === 'shield' ? 'cards-shield' : 'cards-freepass');
      return;
    }
    case 'ExpressGranted':
      vs.players[ev.playerId]!.expressPending = true;
      render(view, vs);
      fire(view, planFx(ev, ctx));
      return;
    case 'CardNoEffect':
      fire(view, planFx(ev, ctx));
      if (!fast) await stage.toast(t('g.card.noEffect', { card: loc(getCard(ev.cardId).title) }), 700, 'info');
      return;
    case 'SentToIsland': {
      vs.players[ev.playerId]!.islandTurns = 3;
      render(view, vs);
      const hs = fire(view, planFx(ev, ctx));
      // The splash preset plays the island sound + haptic.
      if (!fast) await Promise.all([...hs, stage.toast(t('g.island.stuck'), 600, 'bad', 'corner-island')]);
      return;
    }
    case 'IslandStay':
      vs.players[ev.playerId]!.islandTurns = ev.turnsLeft;
      render(view, vs);
      fire(view, planFx(ev, ctx));
      if (!fast && ev.turnsLeft > 0) await stage.toast(t('g.island.stay', { n: ev.turnsLeft }), 650, 'info', 'corner-island');
      return;
    case 'Escaped':
      vs.players[ev.playerId]!.islandTurns = 0;
      render(view, vs);
      fire(view, planFx(ev, ctx));
      if (!fast) {
        view.playSfx('escape');
        void stage.toast(t('g.escaped'), 600, 'good', 'corner-island');
      }
      return;
    case 'FestivalSet': {
      vs.festival = ev.spaceIndex;
      render(view, vs);
      const hs = fire(view, planFx(ev, ctx));
      if (!fast && ev.spaceIndex !== null) {
        // The burst preset plays the festival sound + haptic and pops the flags.
        void stage.toast(t('g.festival.set', { name: loc(boardOf(vs)[ev.spaceIndex]!.short) }), 700, 'gold', 'festival-marker');
        await Promise.all(hs);
      }
      return;
    }
    case 'TravelGranted':
      vs.players[ev.playerId]!.travelPending = true;
      render(view, vs);
      fire(view, planFx(ev, ctx));
      if (!fast) {
        view.playSfx('travel');
        await stage.toast(t('g.travel.granted'), 700, 'gold', 'corner-tour');
      }
      return;
    case 'FinalRoundCalled':
      vs.endsAfterRound = true;
      render(view, vs);
      if (!fast) await stage.toast(t('g.finalRound'), 1200, 'bad', 'timer');
      return;
    case 'TravelDeclined':
      vs.players[ev.playerId]!.travelPending = false;
      render(view, vs);
      if (!fast) void stage.toast(t('g.travel.declined'), 600, 'info', 'corner-tour');
      return;
    case 'DebtStarted':
      fire(view, planFx(ev, ctx));
      if (!fast) {
        view.playSfx('warning');
        await stage.toast(t('g.debt.started', { amount: money(ev.shortfall) }), 900, 'bad', 'pot');
      }
      return;
    case 'DebtSettled':
      fire(view, planFx(ev, ctx));
      if (!fast) await stage.toast(t('g.debt.settled'), 600, 'good', 'check');
      return;
    case 'BuildingSold':
      fire(view, planFx(ev, ctx));
      return;
    case 'PropertySold': {
      const steps = planFx(ev, ctx);
      vs.properties[ev.spaceIndex]!.owner = null;
      vs.properties[ev.spaceIndex]!.level = 0;
      render(view, vs);
      fire(view, steps);
      if (!fast) await board.pulseSpace(ev.spaceIndex, 'shake');
      return;
    }
    case 'PropertyTransferred': {
      const steps = planFx(ev, ctx);
      batch.transfers++;
      const pr = vs.properties[ev.spaceIndex]!;
      pr.owner = ev.to;
      pr.level = (ev.to === null ? 0 : ev.level) as Level;
      render(view, vs);
      fire(view, steps);
      if (!fast) await wait(90);
      return;
    }
    case 'Bankrupt': {
      vs.players[ev.playerId]!.bankrupt = true;
      render(view, vs);
      const hs = fire(view, planFx(ev, ctx));
      if (fast) return;
      // The crack preset plays the bankrupt sound, heavy haptic and the shake.
      await Promise.all([...hs, view.panel(ev.playerId)?.breakApart(), stage.stamp(t('g.bankrupt'), 'bad')]);
      return;
    }
    case 'AuctionStarted':
      fire(view, planFx(ev, ctx));
      if (!fast) await stage.toast(t('g.auction.started'), 700, 'gold', spaceIcon(boardOf(vs)[ev.spaceIndex]!));
      return;
    case 'AuctionBid':
      fire(view, planFx(ev, ctx));
      if (!fast) {
        view.playSfx('tap');
        void stage.toast(t('g.auction.bidMade', { name: vs.players[ev.playerId]!.name, amount: money(ev.amount) }), 450, 'info');
      }
      return;
    case 'AuctionDropped':
      if (!fast) void stage.toast(t('g.auction.dropped', { name: vs.players[ev.playerId]!.name }), 450, 'info');
      return;
    case 'AuctionEnded':
      if (fast) return;
      if (ev.winnerId === null) await stage.toast(t('g.auction.noWinner'), 600, 'info');
      else await stage.toast(t('g.auction.won', { name: vs.players[ev.winnerId]!.name, amount: money(ev.price) }), 800, 'good', spaceIcon(boardOf(vs)[ev.spaceIndex]!));
      return;
    case 'OneAway': {
      fire(view, planFx(ev, ctx));
      if (fast) return;
      // The preset plays the warning sound + haptic.
      const p = vs.players[ev.playerId]!;
      // Camera: punch in on the one space that would end the game.
      board.zoomPunch(ev.missing, 1.18);
      void edgeToast(board.overlay, view.seats, p, spaceIcon(boardOf(vs)[ev.missing]!), playerColor(p.colorId).hex);
      await sleep(BEAT.oneAway);
      return;
    }
    case 'PromptOpened':
      return;
    case 'GameOver': {
      if (fast) {
        fire(view, planFx(ev, ctx));
        return;
      }
      stage.clearPrompt();
      // A first bankruptcy ends the game: a beat of silence between the crack and the finale (§7.4).
      if (batch.prev === 'Bankrupt') await sleep(BEAT.bankruptSilence);
      const hs = fire(view, planFx(ev, ctx));
      await Promise.all([...hs, stage.stamp(t('g.gameOver'), 'gold')]);
      await sleep(BEAT.finale);
      return;
    }
  }
}
