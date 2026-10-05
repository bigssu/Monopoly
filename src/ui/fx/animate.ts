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
 * Money (docs/MONEY-EVENTS.md §10–§11): every purchase, payment and income is a full-screen cut-in on
 * the money stage. `planMoney` (moneymap.ts) groups a batch's money events (one action's money =
 * one cut-in); the group's scene plays at its first event, the state of all its events is applied
 * at the scene's 'settle' cue (the board / panels change as the cut-in hands back), and the old
 * canvas money presets, panel floats and the toll card do not play for them.
 *
 * Speed: every duration goes through `fx/time` — `setAnimSpeed(0)` makes the whole queue
 * instant and plays no effect (tests), a "skip" tap accelerates it ×5 (and fires pending fx cues
 * now), reduced motion keeps every beat but holds still (presets: sound + a static highlight,
 * VFX.md §8.3). The policy lives in `fx/time.ts`.
 */
import { deepClone, getBoardInfo, groupOf, isFinalStretch, type GameEvent, type GameState, type PlayerId } from '@/engine';
import { GROUP_NAMES } from '@/content/board';
import { getCard } from '@/content/cards';
import { playerColor } from '@/content/palette';
import { loc, t } from '@/i18n';
import type { GameView } from '@/ui/game/view';
import { isDevHook, money, spaceIcon } from '@/ui/game/util';
import { iconMarkup } from '@/content/icons';
import { edgeToast } from './floats';
import { groupFx, planFx, type FxCtx, type FxStep } from './fxmap';
import { animSpeed, headless, sleep, turnRest, wait, whenRunning } from './time';
import { BEAT } from './motion';
import { playMusic } from '@/ui/audio/music';
import type { FxPlay } from './vfx';
import { applyMoneyState, planMoney, type MoneyGroup, type MoneyScene } from './moneymap';
import * as M from './money';
import { festivalMultiplier, type Level as EngineLevel } from '@/engine';

type Alive = () => boolean;
const boardOf = (state: GameState) => getBoardInfo(state.settings.spacesPerSide ?? 7).board;

/** Dev (?dev=1): a User Timing mark per event, so perf traces can say what a long frame was doing. */
const MARK = typeof window !== 'undefined' && isDevHook();

/** Events that change the board / a panel without the sequencer waiting on their animation. */
const CHANGE_BEATS: ReadonlySet<GameEvent['type']> = new Set<GameEvent['type']>([
  'CardKept', 'CardUsed', 'ExpressGranted', 'Escaped',
  'FestivalSet', 'TravelDeclined', 'AuctionBid', 'AuctionDropped',
]);

/** Per-batch state shared between events (previous event). */
interface Batch {
  prev: GameEvent['type'] | null;
}

/** Dev (?dev=1): the money scenes played so far (e2e/money-events.spec.ts reads `__moneyLog`). */
export interface MoneyLogEntry {
  scene: MoneyScene['kind'];
  /** The stage scene that ran (after tier / variant choice). */
  play: string;
  tier: string;
  keep: boolean;
  events: string[];
  /** Wallet labels per seat when the scene settled (what the players read). */
  wallets: Record<string, string>;
  t: number;
  /** Real ms of the still hold (result pose → hand-back) and of the whole cut-in on screen. */
  stillMs: number;
  liveMs: number;
}
const MONEY_LOG: MoneyLogEntry[] | null =
  typeof window !== 'undefined' && isDevHook() ? (((window as unknown as { __moneyLog?: MoneyLogEntry[] }).__moneyLog ??= [])) : null;

export async function playEvents(
  view: GameView,
  prev: GameState,
  events: readonly GameEvent[],
  next: GameState,
  alive: Alive,
): Promise<void> {
  const vs = deepClone(prev);
  const fast = headless();
  const batch: Batch = { prev: null };
  // Money cut-ins: group start index → group; every grouped event index → its group.
  const groups = planMoney(events);
  const starts = new Map<number, MoneyGroup>();
  const grouped = new Set<number>();
  for (const g of groups) {
    starts.set(g.start, g);
    for (const k of g.events) grouped.add(k);
  }
  let firstMoney = true;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    // Paused: the next event waits for resume.
    await whenRunning();
    if (!alive()) return;
    const g = starts.get(i);
    if (g) {
      try {
        // A CPU's own decision: its hand lifts off the button and leaves before the cut-in comes up.
        if (!fast && firstMoney) await view.hand.whenGone();
        firstMoney = false;
        await playMoney(view, vs, events, g, fast);
      } catch (e) {
        console.error('[animate] money', g.scene.kind, e);
        for (const k of g.events) applyMoneyState(vs, events[k]!);
        render(view, vs);
      }
      batch.prev = g.scene.kind === 'bankruptcy' ? 'Bankrupt' : events[g.events[g.events.length - 1]!]!.type;
      continue;
    }
    if (grouped.has(i)) continue;
    // One thing at a time: the cut-in hands back (stage down, board updated) before the next event
    // plays — unless it is kept up for a money scene that follows directly (one cut-in, §4.3).
    if (!fast && view.money.live && !view.money.kept) {
      await view.money.enqueue(() => Promise.resolve());
      if (!alive()) return;
    }
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
      // Pacing: a held beat after a change whose own animation is not awaited, so one thing
      // happens at a time and each can be seen (holds follow the game pace).
      // Not before a finale: it has its own beats, and a tap must skip it from the first frame.
      if (!fast && CHANGE_BEATS.has(ev.type) && next.phase.kind !== 'gameOver') await sleep(BEAT.change);
    } catch (e) {
      // An animation must never break the game loop.
      console.error('[animate]', ev.type, e);
    }
    batch.prev = ev.type;
  }
  if (!alive()) return;
  // The prompt comes up once the last cut-in has handed back.
  if (!fast && view.money.live) {
    if (view.money.kept) await view.money.releaseKept();
    await view.money.enqueue(() => Promise.resolve());
  }
  // The next prompt waits for a big moment (landmark, takeover, monopoly…) to finish its beats.
  await settleBig(view);
  // Only before a person's decision: the CPU's own think time already separates its actions.
  if (!fast && events.length && next.phase.kind !== 'gameOver' && !next.players[next.phase.playerId]!.isCpu) await sleep(BEAT.beforePrompt);
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

function ctxFor(view: GameView, vs: GameState): FxCtx {
  return {
    vs,
    cardAt: () => (fxOn() ? view.stage.cardClientCenter() : undefined),
    dice: () => (fxOn() ? view.stage.dice.clientCenters() : undefined),
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
  const ctx = ctxFor(view, vs);
  switch (ev.type) {
    case 'RoundStarted': {
      vs.round = ev.round;
      if (isFinalStretch(vs)) void playMusic('final');
      const steps = planFx(ev, ctx);
      if (!steps.length) {
        // Every new round gets its own beat (staging: the table sees the round turn over).
        if (!fast && ev.round > 1) await stage.toast(t('g.round.start', { n: ev.round }), 500, 'info', 'restart');
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
      // A repeated money event in the same turn plays at 0.7× (MONEY-EVENTS §10.3).
      view.money.newTurn();
      const p = vs.players[ev.playerId]!;
      render(view, vs);
      stage.setTurn(p, vs);
      stage.dice.show(vs.lastDice);
      board.setActiveToken(ev.playerId);
      // Fixed view (one human vs CPUs): faces S every turn, so it never turns (src/ui/orientation.ts).
      const face = view.orient.face(p.seat);
      if (fast) {
        void stage.rotateTo(face);
        return;
      }
      fire(view, steps);
      await Promise.all([stage.rotateTo(face), stage.announce()]);
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
      // Anticipation: a breath between reading the total and the token setting off.
      if (!fast && ev.steps > 0) await sleep(BEAT.beforeMove);
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
    // Money events are cut-ins (planMoney → playMoney); one that no group claimed only changes state.
    case 'PassedStart':
    case 'MoneyChanged':
    case 'PotChanged':
    case 'PropertyBought':
    case 'Built':
    case 'TollPaid':
    case 'TakenOver':
    case 'BuildingSold':
    case 'PropertySold':
    case 'PropertyTransferred':
    case 'Bankrupt':
      applyMoneyState(vs, ev);
      render(view, vs);
      return;
    case 'CannotAfford':
      fire(view, planFx(ev, ctx));
      if (!fast) await stage.toast(t('g.cannotAfford'), 700, 'bad', 'coin');
      return;
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
      void edgeToast(board.overlay, view.orient.readers(vs.players.map((q) => q.seat)), p, spaceIcon(boardOf(vs)[ev.missing]!), playerColor(p.colorId).hex);
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

// ------------------------------------------------------------------------------------------ money

const cardTitle = (id: string | null): string | undefined => (id ? loc(getCard(id as never).title) : undefined);

/** Start the stage scene for a planned money group (cash in `vs` = before the events). */
function startScene(view: GameView, vs: GameState, sc: MoneyScene, keep: boolean): M.MoneyPlay {
  const st = view.money;
  // Drawn seats (wallets, coin endpoints); what the cut-in faces is the stage's call (`upright`).
  const party = (pid: PlayerId): M.Party => ({ seat: view.orient.seat(vs.players[pid]!.seat), cash: vs.players[pid]!.cash, color: view.colorOf(pid) });
  const me = (pid: PlayerId) => ({ seat: view.orient.seat(vs.players[pid]!.seat), cash: vs.players[pid]!.cash, playerColor: view.colorOf(pid) });
  const name = (i: number): string => loc(boardOf(vs)[i]!.short);
  switch (sc.kind) {
    case 'purchase':
      return M.purchase(st, { ...me(sc.player), spaceIndex: sc.spaceIndex, price: sc.price, auction: sc.via === 'auction', keep });
    case 'build':
      return M.build(st, {
        ...me(sc.player), spaceIndex: sc.spaceIndex, cost: sc.cost, level: Math.max(1, Math.min(4, sc.level)) as 1 | 2 | 3 | 4, free: sc.free, keep,
        ...(sc.free ? { title: t('m.upgrade') } : {}),
      });
    case 'toll': {
      const mult = sc.festival ? festivalMultiplier(vs) : 1;
      return M.toll(st, { payer: party(sc.payer), owner: party(sc.owner), spaceIndex: sc.spaceIndex, amount: sc.amount, festival: sc.festival, stamp: `×${mult * sc.multiplier}`, keep });
    }
    case 'tollWaived':
      return M.tollWaived(st, { payer: party(sc.payer), owner: party(sc.owner), spaceIndex: sc.spaceIndex, keep });
    case 'takeover':
      return M.takeover(st, { buyer: party(sc.buyer), seller: party(sc.seller), spaceIndex: sc.spaceIndex, price: sc.price, keep });
    case 'collectFromAll':
      return M.collectFromAll(st, { receiver: party(sc.receiver), payers: sc.payers.map((p) => ({ ...party(p.id), amount: p.amount })), keep, ...(cardTitle(sc.cardId) ? { title: cardTitle(sc.cardId) } : {}) });
    case 'payAll':
      return M.payAll(st, { payer: party(sc.payer), receivers: sc.receivers.map((p) => ({ ...party(p.id), amount: p.amount })), keep, ...(cardTitle(sc.cardId) ? { title: cardTitle(sc.cardId) } : {}) });
    case 'transfer':
      return M.transfer(st, { from: party(sc.from), to: party(sc.to), via: 'center', amount: sc.amount, keep, title: cardTitle(sc.cardId) ?? t(sc.reason === 'toll' ? 'm.toll' : 'm.payAll') });
    case 'receive': {
      const kind = sc.source === 'pot' ? 'pot' : sc.source === 'salary' ? 'salary' : 'bonus';
      const title = sc.source === 'doubleUp' ? t('m.doubleUp.win') : cardTitle(sc.cardId);
      return M.receive(st, { ...me(sc.player), amount: sc.amount, kind, keep, ...(title ? { title } : {}) });
    }
    case 'pay': {
      const kind = sc.sink === 'doubleUp' ? 'fine' : sc.sink;
      const title = sc.sink === 'doubleUp' ? t('m.doubleUp.lose') : cardTitle(sc.cardId);
      return M.pay(st, { ...me(sc.player), amount: sc.amount, kind, keep, ...(title ? { title } : {}) });
    }
    case 'sale': {
      // §4.2 "dismantle" picture is not built yet: the sold building (or the city card) is the hero.
      const art = sc.building !== null ? buildingArt(sc.building) : undefined;
      return M.transfer(st, {
        from: 'bank', to: party(sc.player), amount: sc.amount, keep,
        title: sc.building !== null ? t('m.sale.building') : t('m.sale.land', { name: name(sc.spaceIndex) }),
        ...(art ? { hero: art } : {}),
      });
    }
    case 'bankruptcy':
      return M.bankruptcy(st, { debtor: party(sc.debtor), creditor: sc.creditor === null ? null : party(sc.creditor), properties: sc.properties, keep });
  }
}

const BUILDING_ICON: Record<1 | 2 | 3 | 4, string> = { 1: 'villa', 2: 'building', 3: 'hotel', 4: 'landmark' };
function buildingArt(level: EngineLevel): string | undefined {
  const id = BUILDING_ICON[Math.max(1, Math.min(4, level)) as 1 | 2 | 3 | 4];
  try {
    return `<div class="mh-sinkpic">${iconMarkup(id)}</div>`;
  } catch {
    return undefined;
  }
}

/**
 * One money group: the cut-in plays; at its 'settle' cue the group's events change the view state
 * and the board / panels render (the scene's wallet numbers = the engine's cash). Headless: the
 * state is applied at once, nothing shows.
 */
async function playMoney(view: GameView, vs: GameState, events: readonly GameEvent[], g: MoneyGroup, fast: boolean): Promise<void> {
  const evs = g.events.map((k) => events[k]!);
  if (!fast) for (const e of evs) view.director.onEvent(e, vs, 'before');
  if (!fast) {
    const play = startScene(view, vs, g.scene, g.keep);
    let tStart = 0;
    let tResult = 0;
    if (MONEY_LOG) {
      void play.cue('start').then(() => (tStart = performance.now()));
      void play.cue('result').then(() => (tResult = performance.now()));
    }
    await play;
    if (MONEY_LOG) {
      const wallets: Record<string, string> = {};
      for (const s of M.SEATS) if (view.money.wallets[s].visible) wallets[s] = view.money.wallets[s].el.dataset.v ?? '';
      const entry: MoneyLogEntry = { scene: g.scene.kind, play: play.kind, tier: play.tier, keep: g.keep, events: evs.map((e) => e.type), wallets, t: Math.round(performance.now()), stillMs: Math.round(performance.now() - tResult), liveMs: 0 };
      MONEY_LOG.push(entry);
      // On screen from stage-in to park (or to the hand-over when kept up for the next scene).
      void play.done.then(() => (entry.liveMs = Math.round(performance.now() - tStart)));
    }
  }
  for (const e of evs) applyMoneyState(vs, e);
  render(view, vs);
  if (!fast) for (const e of evs) view.director.onEvent(e, vs, 'after');
  // What the board still does by itself after the cut-in hands back.
  const sc = g.scene;
  if (sc.kind === 'purchase') await groupMoment(view, vs, sc.player, sc.spaceIndex, fast);
  else if (sc.kind === 'takeover') await groupMoment(view, vs, sc.buyer, sc.spaceIndex, fast);
  else if (sc.kind === 'bankruptcy' && !fast) await view.panel(sc.debtor)?.breakApart();
}
