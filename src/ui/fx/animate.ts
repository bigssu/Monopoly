/**
 * Event sequencer.
 *
 * After each `reduce`, the controller calls `playEvents(view, prev, events, next)`. The sequencer
 * keeps a *view state* (a clone of `prev`) and walks the engine events in order: each event
 * first patches the view state (so the board/panels re-render immediately and statelessly),
 * then awaits its animation (hop, tumble, flip, coin arc…). At the end the view is synced to
 * `next`, so any drift is corrected and a resumed game renders identically.
 *
 * Speed: every duration goes through `fx/time` — `setAnimSpeed(0)` makes the whole queue
 * instant (tests), a "skip" tap accelerates it ×5 without breaking the order, and
 * prefers-reduced-motion is instant.
 */
import { BOARD, deepClone, type GameEvent, type GameState, type Level } from '@/engine';
import { getCard } from '@/content/cards';
import { playerColor } from '@/content/palette';
import { loc, t } from '@/i18n';
import { sfx } from '@/ui/audio/sfx';
import { haptic } from '@/ui/audio/haptics';
import type { GameView } from '@/ui/game/view';
import { money, spaceIcon } from '@/ui/game/util';
import { edgeToast } from './floats';
import { shake } from './shake';
import { instant, sleep } from './time';

type Alive = () => boolean;

export async function playEvents(
  view: GameView,
  prev: GameState,
  events: readonly GameEvent[],
  next: GameState,
  alive: Alive,
): Promise<void> {
  const vs = deepClone(prev);
  const fast = instant();
  for (const ev of events) {
    if (!alive()) return;
    try {
      await step(view, vs, ev, fast);
    } catch (e) {
      // An animation must never break the game loop.
      console.error('[animate]', ev.type, e);
    }
  }
  if (!alive()) return;
  view.render(next);
}

function render(view: GameView, vs: GameState): void {
  view.render(vs);
}

async function step(view: GameView, vs: GameState, ev: GameEvent, fast: boolean): Promise<void> {
  const { board, stage } = view;
  switch (ev.type) {
    case 'RoundStarted': {
      vs.round = ev.round;
      const limit = vs.settings.roundLimit;
      if (limit !== null && ev.round === limit - 2 && !fast) {
        sfx.play('warning');
        await stage.toast(t('g.round.final', { n: 3 }), 900, 'gold', 'timer');
      }
      return;
    }
    case 'TurnStarted': {
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
      await Promise.all([stage.rotateTo(p.seat), stage.announce()]);
      await sleep(180);
      return;
    }
    case 'TurnEnded':
      return;
    case 'DiceRolled': {
      vs.lastDice = ev.dice;
      if (fast) {
        stage.dice.show(ev.dice);
        return;
      }
      await stage.dice.roll(ev.dice[0], ev.dice[1], ev.total, ev.isDouble);
      if (ev.isDouble && ev.consecutiveDoubles >= 3) {
        haptic('warning');
        await stage.stamp(t('g.doubles.three'), 'bad');
      } else if (ev.isDouble) {
        await stage.stamp(t('g.doubles'), 'gold');
      } else if (ev.context === 'island' && ev.steps === 0) {
        await sleep(250);
      } else {
        await sleep(220);
      }
      if (ev.express) await stage.toast(t('g.express'), 500, 'gold', 'hub-rail');
      return;
    }
    case 'TokenMoved': {
      if (ev.mode === 'jump') await board.jump(ev.playerId, ev.to);
      else await board.hop(ev.playerId, ev.path, ev.direction === 'backward');
      vs.players[ev.playerId]!.position = ev.to;
      render(view, vs);
      return;
    }
    case 'PassedStart': {
      if (fast) return;
      sfx.play('pass-start');
      haptic('success');
      const c = board.spaceClientCenter(0);
      void view.particles.coinShower(c.x, c.y, 16);
      if (ev.landed) await stage.toast(t('g.passStart.landed'), 600, 'good', 'corner-start');
      return;
    }
    case 'MoneyChanged': {
      vs.players[ev.playerId]!.cash = ev.balance;
      render(view, vs);
      // Toll: caption the float so the receiver (and payer) see what the money was for.
      const toll = ev.reason === 'toll';
      const panel = view.panel(ev.playerId);
      panel?.float(ev.delta, toll ? t('g.toll') : undefined);
      if (fast) return;
      if (!toll) sfx.play(ev.delta > 0 ? 'cash-in' : 'cash-out');
      if (toll && ev.delta > 0) {
        // The receiver is usually not the acting player: give their panel a moment of its own
        // (bump + green wash + captioned float) before the next prompt takes the table's eye.
        sfx.play('cash-in');
        void panel?.bump();
        await sleep(620);
        return;
      }
      await sleep(ev.reason === 'bankruptcy' ? 80 : 180);
      return;
    }
    case 'PotChanged':
      vs.pot = ev.pot;
      render(view, vs);
      return;
    case 'PropertyBought': {
      vs.properties[ev.spaceIndex]!.owner = ev.playerId;
      render(view, vs);
      if (fast) return;
      sfx.play('buy');
      haptic('success');
      await Promise.all([board.pulseSpace(ev.spaceIndex, 'stamp'), stage.toast(t('g.bought', { name: loc(BOARD[ev.spaceIndex]!.short) }), 500, 'good', spaceIcon(BOARD[ev.spaceIndex]!))]);
      return;
    }
    case 'CannotAfford':
      if (!fast) await stage.toast(t('g.cannotAfford'), 700, 'bad', 'coin');
      return;
    case 'Built': {
      vs.properties[ev.spaceIndex]!.level = ev.level;
      render(view, vs);
      if (fast) return;
      sfx.play(ev.level === 4 ? 'landmark' : 'build');
      haptic(ev.level === 4 ? 'success' : 'light');
      if (ev.level === 4) await Promise.all([board.pulseSpace(ev.spaceIndex, 'pop'), stage.stamp(t('g.landmark.done'), 'gold')]);
      else await board.pulseSpace(ev.spaceIndex, 'pop');
      return;
    }
    case 'Demolished': {
      vs.properties[ev.spaceIndex]!.level = ev.level;
      render(view, vs);
      if (fast) return;
      if (ev.cause === 'typhoon') {
        sfx.play('warning');
        await Promise.all([board.pulseSpace(ev.spaceIndex, 'shake'), stage.toast(t('g.typhoon', { name: loc(BOARD[ev.spaceIndex]!.short) }), 800, 'bad', spaceIcon(BOARD[ev.spaceIndex]!))]);
      } else await board.pulseSpace(ev.spaceIndex, 'shake');
      return;
    }
    case 'TollPaid': {
      if (fast) return;
      const payer = vs.players[ev.payerId]!;
      const owner = vs.players[ev.ownerId]!;
      sfx.play('toll');
      haptic('medium');
      const from = view.panel(ev.payerId)?.clientCenter();
      const to = view.panel(ev.ownerId)?.clientCenter();
      await Promise.all([
        stage.showToll({ payer, owner, amount: ev.amount, festival: ev.festival, waived: ev.waived, multiplier: ev.multiplier }),
        !ev.waived && from && to ? view.particles.coinArc(from, to, 8) : Promise.resolve(),
      ]);
      return;
    }
    case 'TakenOver': {
      vs.properties[ev.spaceIndex]!.owner = ev.buyerId;
      render(view, vs);
      if (fast) return;
      sfx.play('takeover');
      haptic('heavy');
      await Promise.all([stage.stamp(t('g.takeover.done'), 'bad'), shake(view.table, 1.2), board.pulseSpace(ev.spaceIndex, 'stamp')]);
      return;
    }
    case 'TakeoverBlocked':
      if (!fast) {
        sfx.play('warning');
        haptic('warning');
        await stage.toast(t('g.takeover.blocked'), 900, 'bad', 'cards-shield');
      }
      return;
    case 'CardDrawn':
      if (!fast) await stage.showCard(ev.cardId);
      return;
    case 'CardKept':
      vs.players[ev.playerId]!.cards.push(ev.card);
      render(view, vs);
      return;
    case 'CardUsed': {
      const cards = vs.players[ev.playerId]!.cards;
      const k = cards.indexOf(ev.card);
      if (k >= 0) cards.splice(k, 1);
      render(view, vs);
      if (!fast) await stage.toast(t(`g.cardUsed.${ev.card}`), 700, 'gold', ev.card === 'escape' ? 'cards-escape' : ev.card === 'shield' ? 'cards-shield' : 'cards-freepass');
      return;
    }
    case 'ExpressGranted':
      vs.players[ev.playerId]!.expressPending = true;
      render(view, vs);
      return;
    case 'CardNoEffect':
      if (!fast) await stage.toast(t('g.card.noEffect', { card: loc(getCard(ev.cardId).title) }), 700, 'info');
      return;
    case 'SentToIsland':
      vs.players[ev.playerId]!.islandTurns = 3;
      render(view, vs);
      if (!fast) {
        sfx.play('island');
        haptic('warning');
        await stage.toast(t('g.island.stuck'), 800, 'bad', 'corner-island');
      }
      return;
    case 'IslandStay':
      vs.players[ev.playerId]!.islandTurns = ev.turnsLeft;
      render(view, vs);
      if (!fast && ev.turnsLeft > 0) await stage.toast(t('g.island.stay', { n: ev.turnsLeft }), 650, 'info', 'corner-island');
      return;
    case 'Escaped':
      vs.players[ev.playerId]!.islandTurns = 0;
      render(view, vs);
      if (!fast) {
        sfx.play('escape');
        await stage.toast(t('g.escaped'), 600, 'good', 'corner-island');
      }
      return;
    case 'FestivalSet':
      vs.festival = ev.spaceIndex;
      render(view, vs);
      if (!fast && ev.spaceIndex !== null) {
        sfx.play('festival');
        haptic('success');
        await Promise.all([board.pulseSpace(ev.spaceIndex, 'pop'), stage.toast(t('g.festival.set', { name: loc(BOARD[ev.spaceIndex]!.short) }), 700, 'gold', 'festival-marker')]);
      }
      return;
    case 'TravelGranted':
      vs.players[ev.playerId]!.travelPending = true;
      render(view, vs);
      if (!fast) {
        sfx.play('travel');
        await stage.toast(t('g.travel.granted'), 700, 'gold', 'corner-tour');
      }
      return;
    case 'TravelDeclined':
      vs.players[ev.playerId]!.travelPending = false;
      render(view, vs);
      return;
    case 'DebtStarted':
      if (!fast) {
        sfx.play('warning');
        haptic('warning');
        await stage.toast(t('g.debt.started', { amount: money(ev.shortfall) }), 900, 'bad', 'pot');
      }
      return;
    case 'DebtSettled':
      if (!fast) await stage.toast(t('g.debt.settled'), 600, 'good', 'check');
      return;
    case 'BuildingSold':
      return;
    case 'PropertySold':
      vs.properties[ev.spaceIndex]!.owner = null;
      vs.properties[ev.spaceIndex]!.level = 0;
      render(view, vs);
      if (!fast) await board.pulseSpace(ev.spaceIndex, 'shake');
      return;
    case 'PropertyTransferred': {
      const pr = vs.properties[ev.spaceIndex]!;
      pr.owner = ev.to;
      pr.level = (ev.to === null ? 0 : ev.level) as Level;
      render(view, vs);
      if (!fast) await sleep(90);
      return;
    }
    case 'Bankrupt': {
      vs.players[ev.playerId]!.bankrupt = true;
      render(view, vs);
      if (fast) return;
      sfx.play('bankrupt');
      haptic('heavy');
      await Promise.all([view.panel(ev.playerId)?.breakApart(), stage.stamp(t('g.bankrupt'), 'bad'), shake(view.table, 0.8)]);
      return;
    }
    case 'AuctionStarted':
      if (!fast) await stage.toast(t('g.auction.started'), 700, 'gold', spaceIcon(BOARD[ev.spaceIndex]!));
      return;
    case 'AuctionBid':
      if (!fast) {
        sfx.play('tap');
        await stage.toast(t('g.auction.bidMade', { name: vs.players[ev.playerId]!.name, amount: money(ev.amount) }), 450, 'info');
      }
      return;
    case 'AuctionDropped':
      return;
    case 'AuctionEnded':
      if (!fast && ev.winnerId === null) await stage.toast(t('g.auction.noWinner'), 600, 'info');
      return;
    case 'OneAway': {
      if (fast) return;
      const p = vs.players[ev.playerId]!;
      sfx.play('warning');
      haptic('warning');
      void edgeToast(board.overlay, view.seats, p, spaceIcon(BOARD[ev.missing]!), playerColor(p.colorId).hex);
      await sleep(500);
      return;
    }
    case 'PromptOpened':
      return;
    case 'GameOver': {
      if (fast) return;
      sfx.play('win');
      haptic('success');
      stage.clearPrompt();
      void view.particles.confetti(76);
      await stage.stamp(t('g.gameOver'), 'gold');
      await sleep(1700);
      return;
    }
  }
}
