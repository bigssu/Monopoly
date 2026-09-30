/**
 * The Stage: the board's inner square. It rotates (420 ms) to face whoever must act and hosts
 * the turn banner, the dice, prompt cards, card reveals, toasts and the space info popover.
 */
import { getCard, type CardId } from '@/content/cards';
import { loc, t } from '@/i18n';
import type { GameState, Player, Seat } from '@/engine';
import { ranking } from '@/engine';
import { sfx } from '@/ui/audio/sfx';
import { haptic } from '@/ui/audio/haptics';
import { anim, gridTimeout, instant, onFrame, sleep } from '@/ui/fx/time';
import { cardIcon, h, iconEl, money, SEAT_ANGLE, setPlayerVars, svg, svgNode, tokenBadge } from '@/ui/game/util';
import { Dice } from './Dice';

export type Tone = 'info' | 'good' | 'bad' | 'gold';

export class Stage {
  readonly el: HTMLElement;
  readonly dice: Dice;
  private rot: HTMLElement;
  private banner: HTMLElement;
  private round: HTMLElement;
  private promptSlot: HTMLElement;
  private toastLayer: HTMLElement;
  private popLayer: HTMLElement;
  private noticeLayer: HTMLElement;
  private rankStrip: HTMLElement;
  private thinking: HTMLElement;
  private diceWrap: HTMLElement;
  private angle = 0;
  private seat: Seat = 'S';
  private timerId = 0;
  private tickId = 0;
  private countId = 0;
  private fitRaf = 0;
  private stopFit: (() => void) | null = null;
  private fitRo: ResizeObserver | null = null;
  private cardDone: (() => void) | null = null;

  constructor() {
    this.dice = new Dice();
    this.banner = h('div', { class: 'st-banner' });
    this.round = h('div', { class: 'st-round' });
    this.rankStrip = h('div', { class: 'st-rank' });
    this.thinking = h('div', { class: 'st-thinking', text: t('g.cpu.thinking') });
    this.promptSlot = h('div', { class: 'st-prompt' });
    this.toastLayer = h('div', { class: 'st-toasts' });
    this.popLayer = h('div', { class: 'st-pop' });
    this.noticeLayer = h('div', { class: 'st-notices' });
    const top = h('div', { class: 'st-top' }, this.banner, this.round, this.noticeLayer);
    const diceWrap = h('div', { class: 'st-dice' }, this.dice.el, this.thinking);
    this.diceWrap = diceWrap;
    this.rot = h('div', { class: 'stage-rot' }, top, this.rankStrip, diceWrap, this.promptSlot, this.toastLayer, this.popLayer);
    this.el = h('div', { class: 'stage' }, h('div', { class: 'stage-bg' }), this.rot);
    this.popLayer.addEventListener('click', () => this.hideInfo());
  }

  get currentSeat(): Seat {
    return this.seat;
  }

  /** Rotate to face a seat along the shortest arc. */
  async rotateTo(seat: Seat): Promise<void> {
    const target = SEAT_ANGLE[seat];
    let delta = (((target - this.angle) % 360) + 540) % 360 - 180;
    if (delta === -180) delta = 180;
    this.seat = seat;
    this.el.dataset.seat = seat;
    if (delta === 0) return;
    const from = this.angle;
    this.angle += delta;
    this.rot.style.transform = `rotate(${this.angle}deg)`;
    // On the 30 Hz frame budget like everything else (a 60 Hz turn every turn change alone pushed
    // the presented rate to ~36 fps, docs/PERFORMANCE.md); the ease-in-out keeps the stepped
    // turn's largest per-frame step at ~11 degrees for a quarter turn.
    await anim(this.rot, [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${this.angle}deg)` }], {
      duration: 420,
      easing: 'cubic-bezier(.65,0,.35,1)',
    });
  }

  /** Update the (static) turn banner text for the player whose turn it is. */
  setTurn(p: Player, state: GameState): void {
    this.banner.innerHTML = '';
    setPlayerVars(this.banner, p.colorId);
    this.banner.append(tokenBadge(p, 'tok-badge st-banner-tok'), h('span', { class: 'st-banner-name', text: t('g.turn', { name: p.name }) }));
    const limit = state.settings.roundLimit;
    this.round.textContent = limit ? t('g.round.of', { n: state.round, max: limit }) : t('g.round', { n: state.round });
    this.setRanking(state);
  }

  /** Pop the banner (turn start). */
  async announce(): Promise<void> {
    sfx.play('turn');
    await anim(
      this.banner,
      [
        { transform: 'translateY(-40%) scale(.7)', opacity: 0 },
        { transform: 'translateY(0) scale(1.08)', opacity: 1, offset: 0.6 },
        { transform: 'translateY(0) scale(1)', opacity: 1 },
      ],
      { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' },
    );
  }

  setThinking(on: boolean): void {
    this.thinking.classList.toggle('is-on', on);
  }

  /** Compact ranking strip during the last 3 rounds. */
  setRanking(state: GameState): void {
    const limit = state.settings.roundLimit;
    const show = limit !== null && state.round > limit - 3;
    this.rankStrip.classList.toggle('is-on', show);
    if (!show) return;
    this.rankStrip.innerHTML = '';
    for (const r of ranking(state)) {
      const p = state.players[r.playerId]!;
      if (p.bankrupt) continue;
      const row = h('span', { class: 'rk' }, h('b', { text: String(r.rank) }), tokenBadge(p, 'tok-badge rk-tok'));
      this.rankStrip.append(row);
    }
  }

  // -------------------------------------------------------------------------
  // Prompts
  // -------------------------------------------------------------------------

  /** Show a prompt card (replacing any). `timer` seconds > 0 draws a countdown ring. */
  showPrompt(card: HTMLElement, opts: { timer?: number; onTimeout?: () => void; big?: boolean } = {}): void {
    this.clearTimer();
    this.promptSlot.innerHTML = '';
    this.el.classList.toggle('has-big', !!opts.big);
    this.el.classList.add('has-prompt');
    const timer = opts.timer ?? 0;
    if (timer > 0 && opts.onTimeout) {
      const ring = h('div', {
        class: 'timer-ring',
        html: `<svg viewBox="0 0 36 36"><circle class="tr-bg" cx="18" cy="18" r="15"/><circle class="tr-fg" cx="18" cy="18" r="15" pathLength="100"/></svg>`,
      });
      ring.style.setProperty('--timer', `${timer}s`);
      // Seconds left, in the middle of the ring.
      const num = h('b', { class: 'tr-n', text: String(timer) });
      ring.append(num);
      card.append(ring);
      let left = timer;
      this.countId = window.setInterval(() => {
        left = Math.max(0, left - 1);
        num.textContent = String(left);
      }, 1000);
      const cb = opts.onTimeout;
      this.timerId = window.setTimeout(() => {
        this.clearTimer();
        cb();
      }, timer * 1000);
      this.tickId = window.setTimeout(() => {
        ring.classList.add('is-urgent');
        sfx.play('timer-tick');
      }, Math.max(0, timer - 3) * 1000);
    }
    this.promptSlot.append(card);
    this.fitDice();
    // On the slot (its own layer, same box as the card): see .st-prompt in stage.css.
    void anim(this.promptSlot, [{ transform: 'translateY(30%) scale(.9)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
      duration: 300,
      easing: 'cubic-bezier(.22,1,.36,1)',
    });
  }

  /**
   * Hide the dice when a prompt leaves too little room for them (small screens). A ResizeObserver
   * on the dice slot and the dice reports their sizes after the frame's own layout, so nothing
   * forces a synchronous style + layout (the old read in the next clock frame was the largest
   * self-time JS item at 4x CPU throttle, docs/PERFORMANCE.md); a class it toggles still lands in
   * that same frame. Without ResizeObserver: measured on the next clock frame.
   */
  fitDice(): void {
    if (this.fitRo || this.fitRaf) return;
    if (typeof ResizeObserver !== 'undefined') {
      this.fitRo = new ResizeObserver(() => this.measureDice());
      this.fitRo.observe(this.diceWrap);
      this.fitRo.observe(this.dice.el);
      return;
    }
    // On the animation clock (a grid frame), not a bare rAF: the class it may toggle would
    // otherwise present an extra frame between two budgeted ones.
    this.fitRaf = 1;
    this.stopFit = onFrame(() => {
      this.fitRaf = 0;
      this.stopFit = null;
      this.measureDice();
      return false;
    });
  }

  private measureDice(): void {
    // `no-dice` only hides the dice (visibility), so the sizes read the same with it on or off.
    const free = this.diceWrap.clientHeight;
    const need = this.dice.el.offsetHeight;
    const hide = this.el.classList.contains('has-prompt') && free > 0 && need > 0 && free < need * 0.9;
    if (hide !== this.el.classList.contains('no-dice')) this.el.classList.toggle('no-dice', hide);
  }

  clearTimer(): void {
    window.clearTimeout(this.timerId);
    window.clearTimeout(this.tickId);
    window.clearInterval(this.countId);
    this.timerId = 0;
  }

  clearPrompt(): void {
    this.clearTimer();
    // A held roll button may vanish without a pointerup (timer / dispatch): stop the shake loop.
    this.dice.shake(false);
    this.promptSlot.innerHTML = '';
    this.el.classList.remove('has-prompt', 'has-big', 'no-dice');
  }

  // -------------------------------------------------------------------------
  // Transient overlays
  // -------------------------------------------------------------------------

  /** A short toast in the middle of the stage (faces the acting player). */
  async toast(content: string | Node, ms = 900, tone: Tone = 'info', iconId?: string): Promise<void> {
    if (instant()) return;
    const el = h('div', { class: `st-toast tone-${tone}` });
    if (iconId) el.append(iconEl(iconId, 'ico st-toast-ico'));
    el.append(typeof content === 'string' ? h('span', { text: content }) : content);
    this.toastLayer.append(el);
    await anim(el, [{ transform: 'scale(.5)', opacity: 0 }, { transform: 'scale(1.06)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }], {
      duration: 260,
      easing: 'cubic-bezier(.34,1.56,.64,1)',
    });
    await sleep(ms);
    await anim(el, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(-20%)' }], { duration: 200 });
    el.remove();
  }

  /**
   * A small non-blocking notice pinned under the turn banner (e.g. "time's up — auto-picked").
   * Unlike `toast` it is not part of the event sequence, so nothing waits for it.
   */
  async notice(text: string, iconId?: string): Promise<void> {
    const el = h('div', { class: 'st-toast st-notice is-autopass tone-info', role: 'status' });
    if (iconId) el.append(iconEl(iconId, 'ico st-toast-ico'));
    el.append(h('span', { text }));
    this.noticeLayer.append(el);
    // Real time (not the animation speed): it must stay readable even at test speeds. The DOM
    // changes still land in budgeted frames (gridTimeout).
    await new Promise<void>((r) => gridTimeout(r, 1600));
    el.classList.add('is-leaving');
    await new Promise<void>((r) => gridTimeout(r, 260));
    el.remove();
  }

  /** Big stamp text ("더블!", "인수!"). */
  async stamp(text: string, tone: Tone = 'gold'): Promise<void> {
    if (instant()) return;
    const el = h('div', { class: `st-stamp tone-${tone}`, text });
    this.toastLayer.append(el);
    await anim(
      el,
      [
        { transform: 'scale(2.4) rotate(-14deg)', opacity: 0 },
        { transform: 'scale(.92) rotate(-8deg)', opacity: 1, offset: 0.35 },
        { transform: 'scale(1) rotate(-8deg)', opacity: 1, offset: 0.8 },
        { transform: 'scale(1.1) rotate(-8deg)', opacity: 0 },
      ],
      { duration: 900, easing: 'cubic-bezier(.22,1,.36,1)' },
    );
    el.remove();
  }

  /** Flip an event card; resolves after a read delay or a tap. */
  async showCard(id: CardId, readMs = 1400): Promise<void> {
    if (instant()) return;
    const c = getCard(id);
    const front = h(
      'div',
      { class: 'card-face card-front' },
      h('div', { class: 'card-kicker', text: t('g.card.kicker') }),
      iconEl(cardIcon(id), 'ico card-ico'),
      h('div', { class: 'card-title', text: loc(c.title) }),
      h('div', { class: 'card-desc', text: loc(c.description) }),
      h('div', { class: 'card-tap', text: t('g.tapToContinue') }),
    );
    const back = h('div', { class: 'card-face card-back', html: svg('space-event') });
    const card = h('div', { class: 'ev-card' }, h('div', { class: 'ev-card-inner' }, back, front));
    this.toastLayer.append(card);
    sfx.play('card');
    haptic('light');
    const inner = card.firstElementChild as HTMLElement;
    await anim(card, [{ transform: 'translateY(60%) scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
      duration: 320,
      easing: 'cubic-bezier(.22,1,.36,1)',
    });
    // Two-step flip (0→90°, swap faces, −90→0°): never relies on backface culling.
    await anim(inner, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(90deg)' }], { duration: 230, easing: 'cubic-bezier(.5,0,1,1)' });
    inner.classList.add('is-flipped');
    await anim(inner, [{ transform: 'rotateY(-90deg)' }, { transform: 'rotateY(0deg)' }], {
      duration: 320,
      easing: 'cubic-bezier(.2,1.4,.5,1)',
    });
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        this.cardDone = null;
        resolve();
      };
      this.cardDone = finish;
      card.addEventListener('pointerdown', finish, { once: true });
      void sleep(readMs).then(finish);
    });
    await anim(card, [{ opacity: 1 }, { opacity: 0, transform: 'scale(.85)' }], { duration: 220 });
    card.remove();
  }

  /** Space info popover (tap anywhere to close). */
  showInfo(content: HTMLElement): void {
    this.popLayer.innerHTML = '';
    this.popLayer.append(content);
    this.popLayer.classList.add('is-on');
    void anim(content, [{ transform: 'scale(.85)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], {
      duration: 220,
      easing: 'cubic-bezier(.34,1.56,.64,1)',
    });
  }

  hideInfo(): void {
    this.popLayer.classList.remove('is-on');
    this.popLayer.innerHTML = '';
  }

  /** Paid-toll card: payer → owner, auto-dismisses. */
  async showToll(opts: { payer: Player; owner: Player; amount: number; festival: boolean; waived: boolean; multiplier: number }): Promise<void> {
    if (instant()) return;
    const el = h(
      'div',
      { class: 'toll-card' },
      h('div', { class: 'toll-kicker', text: opts.waived ? t('g.toll.waived') : t('g.toll.paid') }),
      h(
        'div',
        { class: 'toll-flow' },
        tokenBadge(opts.payer, 'tok-badge toll-tok'),
        h('span', { class: 'toll-arrow' }, svgNode('chevron-right')),
        tokenBadge(opts.owner, 'tok-badge toll-tok'),
      ),
      h('div', { class: 'toll-amt', text: opts.waived ? t('g.free') : money(opts.amount) }),
      opts.festival || opts.multiplier > 1
        ? h('div', { class: 'toll-tags' }, opts.festival ? h('span', { class: 'tag', text: t('g.toll.festival') }) : null, opts.multiplier > 1 ? h('span', { class: 'tag', text: `×${opts.multiplier}` }) : null)
        : null,
    );
    this.toastLayer.append(el);
    await anim(el, [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], {
      duration: 280,
      easing: 'cubic-bezier(.34,1.56,.64,1)',
    });
    await sleep(700);
    void anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 200 }).then(() => el.remove());
  }

  /** Dismiss a pending card reveal early (skip). */
  hurry(): void {
    this.cardDone?.();
  }

  dispose(): void {
    this.fitRo?.disconnect();
    this.fitRo = null;
    this.stopFit?.();
    this.stopFit = null;
    this.fitRaf = 0;
    this.clearTimer();
    this.dice.dispose();
  }
}
