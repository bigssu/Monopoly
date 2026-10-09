/**
 * A seat panel: token, name, cash (tweened), total assets, the spaces this player owns (chips),
 * held cards, island badge, turn glow, rank (last 3 rounds), bankrupt state. Rotated to face its
 * seat by layout.ts; content adapts to its own (pre-rotation) box with container queries. The card
 * is only as tall as its content and stands on the box's seat edge (panels.css), so `clientRect`
 * reads the card, not the box.
 */
import { getBoardInfo, ranking, totalAssets, type GameState, type Player, type SpacesPerSide } from '@/engine';
import { getCard } from '@/content/cards';
import { fmtMoney, loc, t } from '@/i18n';
import { anim, D, gridTimeout, headless, onFrame } from '@/ui/fx/time';
import { chip, clamp, groupColor, h, iconEl, iconId, setPlayerVars, spaceIcon, svgNode } from '@/ui/game/util';
import { atlasNode } from '@/ui/game/iconAtlas';
import { EASE } from '@/ui/fx/motion';
import { chipSize, ownedChips, type OwnedChip } from './owned';

const CARD_ICON: Record<string, string> = { escape: 'cards-escape', 'toll-pass': 'cards-freepass', shield: 'cards-shield' };

/** Room for the owned chips in the panel's box (px, pre-rotation). */
interface ChipRoom {
  inner: number;
  avail: number;
  max: number;
  /** Card padding, header-to-chips gap, header height without / with badges, empty line. */
  pad: number;
  gap: number;
  head: number;
  headBadges: number;
  none: number;
}

export class PlayerPanel {
  readonly el: HTMLElement;
  /** Draw the chip pictures not drawn yet: from the atlas once it is ready, else the sprite. */
  fillIcons(): void {
    for (const [ico, id] of this.chipIcons) ico.append(atlasNode(iconId(id)) ?? svgNode(id));
    this.chipIcons = [];
  }

  /** The owned chips were tapped (the dealer explains them). */
  onSetsTap: (() => void) | null = null;
  private cardEl: HTMLElement;
  private cashNum: HTMLElement;
  private assets: HTMLElement;
  private owned: HTMLElement;
  private none: HTMLElement;
  /** One chip per owned space, created when bought, dropped when lost. */
  private chips = new Map<number, HTMLElement>();
  /** Last rendered class + level of every chip. */
  private chipState = new Map<number, { cls: string; level: number }>();
  /** Chip pictures still to draw (see `fillIcons`). */
  private chipIcons: Array<[HTMLElement, string]> = [];
  private badges: HTMLElement;
  private rank: HTMLElement;
  private floats: HTMLElement;
  /** Pre-painted green/red rim + tint; money in/out only animates its opacity (no repaint). */
  private wash: HTMLElement;
  private shown = 0;
  private target = 0;
  private stopTween: (() => void) | null = null;
  private sig = '';
  private ownedKey = '';
  private badgeKey = '';
  private owns = 0;
  /** Chip rows + size + badge count: when it changes, so does the card's height. */
  private shape = '';
  private room: ChipRoom = { inner: 200, avail: 200, max: 32, pad: 8, gap: 5, head: 32, headBadges: 32, none: 14 };
  private chipBox = { size: 0, gap: 0, rows: 0 };

  private readonly board;

  constructor(readonly player: Player, size: SpacesPerSide = 7) {
    this.board = getBoardInfo(size).board;
    this.el = h('div', { class: player.isCpu ? 'pp is-cpu' : 'pp', 'data-seat': player.seat, 'data-pid': player.id });
    setPlayerVars(this.el, player.colorId);
    const badge = h('span', { class: 'pp-tok' }, svgNode(player.tokenId));
    this.rank = h('span', { class: 'pp-rank' });
    const name = h('div', { class: 'pp-name' }, h('span', { class: 'pp-name-t', text: player.name }), player.isCpu ? h('span', { class: 'pp-cpu', text: t('g.cpu') }) : null);
    // Status badges (island, travel, express, cards) ride at the end of the assets line, so they
    // never sit on top of the name or the cash.
    this.badges = h('div', { class: 'pp-badges' });
    this.cashNum = h('span', { class: 'pp-cash-n' });
    const cash = h('div', { class: 'pp-cash' }, iconEl('coin', 'ico pp-coin'), this.cashNum);
    this.assets = h('div', { class: 'pp-assets' });
    // Only what this player owns: one chip per city / hub (owned.ts), nothing for anyone else's.
    this.none = h('span', { class: 'pp-none', text: t('g.panel.noProps') });
    this.owned = h('div', { class: 'pp-owned', role: 'button', tabindex: '0', 'aria-label': t('g.panel.noProps') }, this.none);
    const explain = (): void => this.onSetsTap?.();
    this.owned.addEventListener('click', explain);
    this.owned.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        explain();
      }
    });
    this.floats = h('div', { class: 'pp-floats' });
    this.wash = h('div', { class: 'pp-wash' });
    const head = h('div', { class: 'pp-head' }, h('div', { class: 'pp-tokwrap' }, badge, this.rank), h('div', { class: 'pp-id' }, name, cash, h('div', { class: 'pp-sub' }, this.assets, this.badges)));
    this.cardEl = h('div', { class: 'pp-card' }, head, this.owned, h('div', { class: 'pp-broken', 'data-label': t('g.panel.bankrupt') }), this.floats, this.wash);
    this.el.append(this.cardEl);
    this.shown = player.cash;
    this.target = player.cash;
    this.cashNum.textContent = fmtMoney(player.cash);
  }

  /**
   * The panel's box (px, pre-rotation): how much room the chips have under the header. The
   * header sizes mirror panels.css (.pp-card padding / gap, .pp-tok, .pp-name, .pp-cash,
   * .pp-assets, .pp-badges .chip; narrow and .is-wide variants).
   */
  setBox(w: number, hgt: number): void {
    const m = Math.min(w, hgt);
    const pad = clamp(m * 0.05, 8, 18);
    const gap = clamp(m * 0.03, 5, 14);
    const wide = w / hgt >= 1.25;
    const tok = clamp(wide ? Math.min(0.2 * w, 0.3 * hgt) : Math.min(0.3 * w, 0.22 * hgt), 32, 104);
    const name = clamp(wide ? Math.min(0.06 * w, 0.1 * hgt) : Math.min(0.09 * w, 0.07 * hgt), 13, 28);
    const cash = clamp(wide ? Math.min(0.09 * w, 0.145 * hgt) : Math.min(0.14 * w, 0.1 * hgt), 17, 46);
    const sub = clamp(wide ? Math.min(0.038 * w, 0.06 * hgt) : Math.min(0.056 * w, 0.042 * hgt), 11, 17);
    const badge = clamp(Math.min(0.1 * w, 0.08 * hgt), 20, 32);
    const id = name * 1.15 + cash * 1.1 + m * 0.01;
    const head = Math.max(tok, id + sub * 1.3);
    const headBadges = Math.max(tok, id + Math.max(sub * 1.3, badge));
    const inner = w - pad * 2;
    const none = clamp(Math.min(0.05 * w, 0.036 * hgt), 11, 15) * 1.3;
    this.room = { inner, avail: Math.max(0, hgt - pad * 2 - headBadges - gap) * 0.95, max: clamp(Math.min(tok * 0.48, inner / 5.2), 18, 48), pad, gap, head, headBadges, none };
    this.shape = '';
    this.layoutChips();
  }

  /** Size the chips so every owned space fits the box; returns the shape key. */
  private layoutChips(): string {
    const { size, gap, rows } = chipSize(Math.max(1, this.owns), this.room.inner, this.room.avail, this.room.max, 12);
    this.chipBox = { size, gap, rows: this.owns ? rows : 0 };
    const s = `${size}px`;
    if (this.owned.style.getPropertyValue('--chip') !== s) {
      this.owned.style.setProperty('--chip', s);
      this.owned.style.setProperty('--chip-gap', `${gap}px`);
    }
    return `${this.owns ? rows : 0}|${size}|${this.badges.childElementCount}`;
  }

  /**
   * The card's height (px, pre-rotation) from the box sizes and what it shows: the game view turns
   * it into the card's client rect (layout.ts `cardRect`) without measuring the DOM.
   */
  cardHeight(): number {
    const r = this.room;
    const head = this.badges.childElementCount ? r.headBadges : r.head;
    const { size, gap, rows } = this.chipBox;
    return r.pad * 2 + head + r.gap + (rows ? rows * (size + gap) - gap : r.none);
  }

  /**
   * Render the state. Returns true when the card's height may have changed (chip rows, chip
   * size, badges): a cached client rect of the card is stale then.
   */
  update(state: GameState, opts: { isTurn: boolean }): boolean {
    const p = state.players[this.player.id]!;
    this.el.classList.toggle('is-turn', opts.isTurn && !p.bankrupt);
    this.el.classList.toggle('is-bankrupt', p.bankrupt);
    // Cash tween.
    if (p.cash !== this.target) this.tweenTo(p.cash);
    // Everything else only when it changes.
    const limit = state.settings.roundLimit;
    const showRank = limit !== null && state.round > limit - 3;
    const r = showRank ? (ranking(state).find((e) => e.playerId === p.id)?.rank ?? 0) : 0;
    const chips = ownedChips(state, p.id);
    const ownedKey = chips.map((c) => `${c.index}:${c.level}:${c.complete ? 1 : 0}:${c.festival ? 1 : 0}`).join(',');
    const sig = [totalAssets(state, p.id), r, ownedKey, p.cards.join(','), p.islandTurns, p.expressPending, p.travelPending].join('|');
    if (sig === this.sig) return false;
    this.sig = sig;
    const assets = t('g.panel.assets', { amount: fmtMoney(totalAssets(state, p.id)) });
    if (this.assets.textContent !== assets) this.assets.textContent = assets;
    const rank = r ? String(r) : '';
    if (this.rank.textContent !== rank) this.rank.textContent = rank;
    this.rank.classList.toggle('is-on', r > 0);
    this.rank.classList.toggle('is-first', r === 1);
    if (ownedKey !== this.ownedKey) {
      this.ownedKey = ownedKey;
      this.owns = chips.length;
      this.renderChips(chips);
    }
    // Badges (rebuilt only when they change).
    const badgeKey = [p.islandTurns, p.travelPending, p.expressPending, p.cards.join(',')].join('|');
    if (badgeKey !== this.badgeKey) {
      this.badgeKey = badgeKey;
      this.badges.innerHTML = '';
      if (p.islandTurns > 0) this.badges.append(chip({ icon: 'corner-island', text: String(p.islandTurns), tone: 'info', label: t('g.island.stay', { n: p.islandTurns }) }));
      if (p.travelPending) this.badges.append(chip({ icon: 'corner-tour', label: t('g.kind.travel') }));
      if (p.expressPending) this.badges.append(chip({ icon: 'hub-rail', text: '×2', label: t('g.express') }));
      for (const c of p.cards) this.badges.append(chip({ icon: CARD_ICON[c] ?? 'cards-escape', tone: 'gold', cls: 'is-card', label: loc(getCard(c).title) }));
    }
    const shape = this.layoutChips();
    if (shape === this.shape) return false;
    this.shape = shape;
    return true;
  }

  /** Owned chips in owned.ts order; only chips that changed are touched (a buy adds one element). */
  private renderChips(chips: readonly OwnedChip[]): void {
    const label = chips.length ? t('g.panel.owned', { n: chips.length }) : t('g.panel.noProps');
    if (this.owned.getAttribute('aria-label') !== label) this.owned.setAttribute('aria-label', label);
    if (chips.length) this.none.remove();
    else if (!this.none.isConnected) this.owned.append(this.none);
    const keep = new Set(chips.map((c) => c.index));
    for (const [i, el] of this.chips) {
      if (keep.has(i)) continue;
      el.remove();
      this.chips.delete(i);
      this.chipState.delete(i);
    }
    chips.forEach((c, k) => {
      let el = this.chips.get(c.index);
      if (!el) {
        const sp = this.board[c.index]!;
        // The city's landmark (or the hub) from the icon atlas (one element); until the game's
        // atlas is ready the chip stays empty and `fillIcons` draws it.
        const ico = h('span', { class: 'ico own-ico', 'aria-hidden': 'true' });
        const id = spaceIcon(sp);
        const bm = atlasNode(iconId(id));
        if (bm) ico.append(bm);
        else this.chipIcons.push([ico, id]);
        el = h('span', { class: 'own', 'data-i': c.index }, ico, h('span', { class: 'own-mark' }));
        el.style.setProperty('--gc', groupColor(sp) ?? '#7B8AA3');
        el.title = loc(sp.short);
        this.chips.set(c.index, el);
      }
      if (this.owned.children[k] !== el) this.owned.insertBefore(el, this.owned.children[k] ?? null);
      const cls = `own${c.kind === 'hub' ? ' is-hub' : ''}${c.complete ? ' is-complete' : ''}${c.level === 4 ? ' is-lm' : ''}${c.festival ? ' is-fest' : ''}`;
      const prev = this.chipState.get(c.index);
      if (prev && prev.cls === cls && prev.level === c.level) return;
      this.chipState.set(c.index, { cls, level: c.level });
      if (el.className !== cls) el.className = cls;
      if (prev?.level === c.level) return;
      // The building mark: 1-3 pips (villa / building / hotel) or the landmark star.
      const mark = el.lastElementChild!;
      mark.textContent = '';
      if (c.level > 0 && c.level < 4) {
        const pips = h('span', { class: 'own-pips' });
        for (let n = 0; n < c.level; n++) pips.append(h('i'));
        mark.append(pips);
      } else if (c.level === 4) mark.append(h('span', { class: 'own-star', text: '★' }));
    });
  }

  private tweenTo(v: number): void {
    const from = this.shown;
    const up = v > this.target;
    this.target = v;
    // `flash-up` / `flash-down` mark the last money direction (tests and styling hooks).
    this.cardEl.classList.remove('flash-up', 'flash-down');
    this.stopTween?.();
    this.stopTween = null;
    this.cashNum.style.color = '';
    if (headless()) {
      this.shown = v;
      this.cashNum.textContent = fmtMoney(v);
      return;
    }
    this.cardEl.classList.add(up ? 'flash-up' : 'flash-down');
    // Rim + tint wash: opacity only, on its own pre-painted layer.
    this.wash.classList.toggle('is-down', !up);
    void anim(this.wash, [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: 1000, easing: EASE.settle });
    // Count-up on the shared frame clock, redrawn on every third tick (~10 Hz: each redraw
    // repaints the panel, docs/PERFORMANCE.md) in the gain/loss color, which returns to ink with
    // the final value (formerly a separate 800 ms main-thread color animation: ~24 more repaints).
    const dur = D(650);
    // Timed from the first frame step on the shared clock (its `now`: real or the manual test clock).
    let t0 = -1;
    const color = up ? '#25A55A' : '#D2443D';
    let n = 0;
    this.cashNum.style.color = color;
    this.stopTween = onFrame((now) => {
      if (t0 < 0) t0 = now;
      const k = Math.min(1, (now - t0) / Math.max(1, dur));
      if (k < 1 && n++ % 3) return true;
      const e = 1 - Math.pow(1 - k, 3);
      this.shown = Math.round(from + (v - from) * e);
      this.cashNum.textContent = fmtMoney(this.shown);
      if (k < 1) return true;
      this.cashNum.style.color = '';
      this.stopTween = null;
      return false;
    });
  }

  /** A number pop / caption rising from the panel (fx `floatText`: the canvas never draws text). */
  floatText(text: string, up = true): void {
    if (headless() || !text) return;
    const el = h('span', { class: `pp-float ${up ? 'is-up' : 'is-down'}`, text });
    this.floats.append(el);
    void anim(
      el,
      [
        { transform: 'translate(-50%, 20%) scale(.6)', opacity: 0 },
        { transform: 'translate(-50%, -40%) scale(1.1)', opacity: 1, offset: 0.2 },
        { transform: 'translate(-50%, -85%) scale(1)', opacity: 1, offset: 0.65 },
        { transform: 'translate(-50%, -150%) scale(1)', opacity: 0 },
      ],
      { duration: 1300, easing: EASE.settle },
    ).then(() => el.remove());
  }

  /** Reduced-motion static highlight (class toggle, no animation). */
  highlight(color: string, ms = 800): void {
    this.cardEl.style.setProperty('--fx-hl', color);
    this.cardEl.classList.add('fx-hl');
    gridTimeout(() => this.cardEl.classList.remove('fx-hl'), ms);
  }

  /** A short "you got paid" bump of the whole panel. */
  async bump(): Promise<void> {
    await anim(
      this.cardEl,
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.045)', offset: 0.35 },
        { transform: 'scale(0.99)', offset: 0.7 },
        { transform: 'scale(1)' },
      ],
      { duration: 520, easing: EASE.overshoot },
    );
  }

  /** Bankruptcy: shake + break. */
  async breakApart(): Promise<void> {
    this.el.classList.add('is-bankrupt');
    await anim(
      this.cardEl,
      [
        { transform: 'none' },
        { transform: 'translateX(-4%) rotate(-2deg)', offset: 0.15 },
        { transform: 'translateX(4%) rotate(2deg)', offset: 0.3 },
        { transform: 'translateX(-3%) rotate(-1deg)', offset: 0.45 },
        { transform: 'translateY(3%) rotate(-3deg)', offset: 0.7 },
        { transform: 'translateY(2%) rotate(-3deg)' },
      ],
      { duration: 900, easing: EASE.settle },
    );
  }

  /** Client rect of the card (fx `getPanelRect`, money-stage wallets): the box around it can be taller. */
  clientRect(): DOMRect {
    return this.cardEl.getBoundingClientRect();
  }

  dispose(): void {
    this.stopTween?.();
    this.stopTween = null;
  }
}
