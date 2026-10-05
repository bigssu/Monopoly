/**
 * A seat panel: token, name, cash (tweened), total assets, property chips, held cards,
 * island badge, turn glow, rank (last 3 rounds), bankrupt state. Rotated to face its seat
 * by layout.ts; content adapts to its own (pre-rotation) box with container queries.
 */
import {
  GROUP_IDS,
  citiesInGroup,
  getBoardInfo,
  oneAwayWarnings,
  ranking,
  totalAssets,
  type GameState,
  type Player,
  type SpacesPerSide,
} from '@/engine';
import { getCard } from '@/content/cards';
import { fmtMoney, loc, t } from '@/i18n';
import { anim, D, gridTimeout, headless, onFrame } from '@/ui/fx/time';
import { chip, groupColor, h, iconEl, setPlayerVars, signedMoney, spaceIcon, svgNode } from '@/ui/game/util';
import { playerColor } from '@/content/palette';
import { EASE } from '@/ui/fx/motion';

const CARD_ICON: Record<string, string> = { escape: 'cards-escape', 'toll-pass': 'cards-freepass', shield: 'cards-shield' };

/** The set grid: one line per color group + one for hubs (board order). */
const setsFor = (size: SpacesPerSide): readonly (readonly number[])[] => [...GROUP_IDS.map((g) => citiesInGroup(g, size)), getBoardInfo(size).hubIndices];

export class PlayerPanel {
  readonly el: HTMLElement;
  /** The set grid was tapped (the dealer explains it). */
  onSetsTap: (() => void) | null = null;
  private cardEl: HTMLElement;
  private cashNum: HTMLElement;
  private assets: HTMLElement;
  private chips: HTMLElement;
  private slots: Map<number, HTMLElement>;
  private badges: HTMLElement;
  private rank: HTMLElement;
  private floats: HTMLElement;
  /** Pre-painted green/red rim + tint; money in/out only animates its opacity (no repaint). */
  private wash: HTMLElement;
  private shown = 0;
  private target = 0;
  private stopTween: (() => void) | null = null;
  private sig = '';
  private badgeKey = '';
  /** Last rendered class + content (0 = empty, 1-3 pips, 4 = star) of every set slot. */
  private slotState = new Map<number, { cls: string; content: number }>();

  private readonly sets: readonly (readonly number[])[];
  private readonly board;
  private readonly maxMembers: number;

  constructor(readonly player: Player, size: SpacesPerSide = 7) {
    this.sets = setsFor(size);
    this.board = getBoardInfo(size).board;
    this.maxMembers = Math.max(...this.sets.map((set) => set.length));
    this.el = h('div', { class: player.isCpu ? 'pp is-cpu' : 'pp', 'data-seat': player.seat, 'data-pid': player.id });
    this.el.style.setProperty('--member-tracks', String(this.maxMembers));
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
    this.chips = h('div', { class: 'pp-sets', role: 'button', tabindex: '0', 'aria-label': t('g.panel.setsHelp') });
    // What the grid is: one square per city (rows = colour groups, circles = hubs).
    const setsHead = h(
      'div',
      { class: 'pp-sets-h', 'aria-hidden': 'true' },
      h('b', { text: t('g.panel.sets') }),
      h('span', { class: 'lg-mine' }, h('i'), t('g.panel.setsMine')),
      h('span', { class: 'lg-miss' }, h('i'), t('g.panel.setsMissing')),
      h('span', { class: 'lg-taken' }, h('i'), t('g.panel.setsTaken')),
    );
    const explain = (): void => this.onSetsTap?.();
    for (const el of [this.chips, setsHead]) el.addEventListener('click', explain);
    this.chips.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        explain();
      }
    });
    this.slots = new Map();
    this.sets.forEach((members, g) => {
      members.forEach((i, k) => {
        const sp = this.board[i]!;
        const slot = h('span', { class: `slot${sp.kind === 'hub' ? ' is-hub' : ''}` });
        // Each square shows its city's landmark (or the hub): faded until it is mine.
        slot.append(iconEl(spaceIcon(sp), 'ico slot-ico'), h('span', { class: 'slot-mark' }));
        slot.style.setProperty('--gc', groupColor(sp) ?? '#7B8AA3');
        slot.style.setProperty('--g', String(g + 1));
        slot.style.setProperty('--k', String(k + 1));
        slot.title = loc(sp.short);
        this.chips.append(slot);
        this.slots.set(i, slot);
      });
    });
    this.floats = h('div', { class: 'pp-floats' });
    this.wash = h('div', { class: 'pp-wash' });
    const head = h('div', { class: 'pp-head' }, h('div', { class: 'pp-tokwrap' }, badge, this.rank), h('div', { class: 'pp-id' }, name, cash, h('div', { class: 'pp-sub' }, this.assets, this.badges)));
    this.cardEl = h('div', { class: 'pp-card' }, head, setsHead, this.chips, h('div', { class: 'pp-broken', 'data-label': t('g.panel.bankrupt') }), this.floats, this.wash);
    this.el.append(this.cardEl);
    this.shown = player.cash;
    this.target = player.cash;
    this.cashNum.textContent = fmtMoney(player.cash);
  }

  /** Choose the set-grid orientation that gives the biggest chips for this box (px, pre-rotation). */
  setBox(w: number, hgt: number): void {
    const pad = Math.max(8, Math.min(w, hgt) * 0.05);
    const wide = w / hgt >= 1.25;
    const tok = Math.max(32, Math.min(104, wide ? Math.min(0.2 * w, 0.3 * hgt) : Math.min(0.3 * w, 0.22 * hgt)));
    const inner = w - pad * 2;
    // Leave room for the set grid's title + legend, which wraps on narrow cards: its font follows
    // panels.css (.pp-sets-h, clamp(11px, min(4.4cqw, 3.4cqh), 14px)) and it is ~17em long.
    const font = Math.max(11, Math.min(0.044 * w, 0.034 * hgt, 14));
    const head = Math.ceil((17 * font) / inner) * font * 1.25;
    const avail = hgt - tok - pad * 3 - head;
    const colsMode = Math.min(inner / this.sets.length, avail / this.maxMembers);
    const rowsMode = Math.min(inner / this.maxMembers, avail / this.sets.length);
    const rows = rowsMode > colsMode * 1.05;
    this.chips.classList.toggle('is-rows', rows);
    this.chips.classList.toggle('is-cols', !rows);
    this.el.style.setProperty('--slot', `${Math.floor(Math.max(10, (rows ? rowsMode : colsMode) * 0.84))}px`);
  }

  update(state: GameState, opts: { isTurn: boolean }): void {
    const p = state.players[this.player.id]!;
    this.el.classList.toggle('is-turn', opts.isTurn && !p.bankrupt);
    this.el.classList.toggle('is-bankrupt', p.bankrupt);
    // Cash tween.
    if (p.cash !== this.target) this.tweenTo(p.cash);
    // Everything else only when it changes.
    const limit = state.settings.roundLimit;
    const showRank = limit !== null && state.round > limit - 3;
    const r = showRank ? (ranking(state).find((e) => e.playerId === p.id)?.rank ?? 0) : 0;
    // Mine with level, or who else owns it (others' squares get the owner's colour dot).
    const props = this.sets.flat().map((i) => { const o = state.properties[i]?.owner; return o === p.id ? `${state.properties[i]!.level}` : o === null || o === undefined ? '-' : `o${o}`; });
    const away = oneAwayWarnings(state).filter((w) => w.playerId === p.id && w.kind !== 'line').map((w) => w.missing);
    const sig = [totalAssets(state, p.id), r, props.join(','), away.join(','), p.cards.join(','), p.islandTurns, state.festival, p.expressPending, p.travelPending].join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    const assets = t('g.panel.assets', { amount: fmtMoney(totalAssets(state, p.id)) });
    if (this.assets.textContent !== assets) this.assets.textContent = assets;
    const rank = r ? String(r) : '';
    if (this.rank.textContent !== rank) this.rank.textContent = rank;
    this.rank.classList.toggle('is-on', r > 0);
    this.rank.classList.toggle('is-first', r === 1);
    // Set grid.
    this.sets.forEach((members) => {
      const complete = members.every((i) => state.properties[i]?.owner === p.id);
      for (const i of members) {
        const slot = this.slots.get(i)!;
        const pr = state.properties[i]!;
        const mine = pr.owner === p.id;
        const taken = !mine && pr.owner !== null;
        const cls = `slot${this.board[i]!.kind === 'hub' ? ' is-hub' : ''}${mine ? ' is-mine' : ''}${taken ? ' is-taken' : ''}${complete ? ' is-complete' : ''}${mine && pr.level === 4 ? ' is-lm' : ''}${mine && state.festival === i ? ' is-fest' : ''}${!mine && away.includes(i) ? ' is-missing' : ''}`;
        if (taken) slot.style.setProperty('--oc', playerColor(state.players[pr.owner!]!.colorId).hex);
        // Only touch slots that changed: rebuilding all 28 on every money change restyled and
        // re-laid-out ~250 elements per panel (docs/PERFORMANCE.md).
        const content = mine ? pr.level : 0;
        const prev = this.slotState.get(i);
        if (prev && prev.cls === cls && prev.content === content) continue;
        this.slotState.set(i, { cls, content });
        if (slot.className !== cls) slot.className = cls;
        if (prev?.content === content) continue;
        // The icon stays; only the building mark (pips / landmark star) is redrawn.
        const mark = slot.querySelector('.slot-mark')!;
        mark.textContent = '';
        if (mine && pr.level > 0 && pr.level < 4) {
          const pips = h('span', { class: 'slot-pips' });
          for (let k = 0; k < pr.level; k++) pips.append(h('i'));
          mark.append(pips);
        } else if (mine && pr.level === 4) mark.append(h('span', { class: 'slot-star', text: '★' }));
      }
    });
    // Badges (rebuilt only when they change).
    const badgeKey = [p.islandTurns, p.travelPending, p.expressPending, p.cards.join(',')].join('|');
    if (badgeKey === this.badgeKey) return;
    this.badgeKey = badgeKey;
    this.badges.innerHTML = '';
    if (p.islandTurns > 0) this.badges.append(chip({ icon: 'corner-island', text: String(p.islandTurns), tone: 'info', label: t('g.island.stay', { n: p.islandTurns }) }));
    if (p.travelPending) this.badges.append(chip({ icon: 'corner-tour', label: t('g.kind.travel') }));
    if (p.expressPending) this.badges.append(chip({ icon: 'hub-rail', text: '×2', label: t('g.express') }));
    for (const c of p.cards) this.badges.append(chip({ icon: CARD_ICON[c] ?? 'cards-escape', tone: 'gold', cls: 'is-card', label: loc(getCard(c).title) }));
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

  /** "+300" / "−120" float rising from the panel (rotated with it), with an optional caption. */
  float(delta: number, note?: string): void {
    if (headless() || delta === 0) return;
    const el = h('span', { class: `pp-float ${delta > 0 ? 'is-up' : 'is-down'}`, text: signedMoney(delta) });
    if (note) el.append(h('small', { class: 'pp-float-note', text: note }));
    this.floats.append(el);
    void anim(
      el,
      [
        { transform: 'translate(-50%, 20%) scale(.6)', opacity: 0 },
        { transform: 'translate(-50%, -40%) scale(1.1)', opacity: 1, offset: 0.2 },
        { transform: 'translate(-50%, -85%) scale(1)', opacity: 1, offset: 0.65 },
        { transform: 'translate(-50%, -150%) scale(1)', opacity: 0 },
      ],
      { duration: note ? 1700 : 1300, easing: EASE.settle },
    ).then(() => el.remove());
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

  /** Client rect (fx engine `getPanelRect`). */
  clientRect(): DOMRect {
    return this.el.getBoundingClientRect();
  }

  /** Centre in client px (for coin arcs). */
  clientCenter(): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  dispose(): void {
    this.stopTween?.();
    this.stopTween = null;
  }
}
