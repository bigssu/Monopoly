/**
 * A seat panel: token, name, cash (tweened), total assets, property chips, held cards,
 * island badge, turn glow, rank (last 3 rounds), bankrupt state. Rotated to face its seat
 * by layout.ts; content adapts to its own (pre-rotation) box with container queries.
 */
import { BOARD } from '@/content/board';
import {
  GROUP_IDS,
  HUB_INDICES,
  citiesInGroup,
  oneAwayWarnings,
  ranking,
  totalAssets,
  type GameState,
  type Player,
} from '@/engine';
import { fmtMoney, loc, t } from '@/i18n';
import { anim, D, instant } from '@/ui/fx/time';
import { groupColor, h, iconEl, setPlayerVars, signedMoney, svg } from '@/ui/game/util';

const CARD_ICON: Record<string, string> = { escape: 'cards-escape', 'toll-pass': 'cards-freepass', shield: 'cards-shield' };

/** The set grid: one line per color group + one for hubs (board order). */
const SETS: readonly (readonly number[])[] = [...GROUP_IDS.map((g) => citiesInGroup(g)), HUB_INDICES];

export class PlayerPanel {
  readonly el: HTMLElement;
  private cardEl: HTMLElement;
  private cashNum: HTMLElement;
  private assets: HTMLElement;
  private chips: HTMLElement;
  private slots: Map<number, HTMLElement>;
  private badges: HTMLElement;
  private rank: HTMLElement;
  private floats: HTMLElement;
  private shown = 0;
  private target = 0;
  private raf = 0;
  private sig = '';

  constructor(readonly player: Player) {
    this.el = h('div', { class: 'pp', 'data-seat': player.seat, 'data-pid': player.id });
    setPlayerVars(this.el, player.colorId);
    const badge = h('span', { class: 'pp-tok', html: svg(player.tokenId) });
    this.rank = h('span', { class: 'pp-rank' });
    const name = h('div', { class: 'pp-name' }, h('span', { class: 'pp-name-t', text: player.name }), player.isCpu ? h('span', { class: 'pp-cpu', text: t('g.cpu') }) : null);
    this.cashNum = h('span', { class: 'pp-cash-n' });
    const cash = h('div', { class: 'pp-cash' }, iconEl('coin', 'ico pp-coin'), this.cashNum);
    this.assets = h('div', { class: 'pp-assets' });
    this.chips = h('div', { class: 'pp-sets' });
    this.slots = new Map();
    SETS.forEach((members, g) => {
      members.forEach((i, k) => {
        const sp = BOARD[i]!;
        const slot = h('span', { class: `slot${sp.kind === 'hub' ? ' is-hub' : ''}` });
        slot.style.setProperty('--gc', groupColor(sp) ?? '#7B8AA3');
        slot.style.setProperty('--g', String(g + 1));
        slot.style.setProperty('--k', String(k + 1));
        slot.title = loc(sp.short);
        this.chips.append(slot);
        this.slots.set(i, slot);
      });
    });
    this.badges = h('div', { class: 'pp-badges' });
    this.floats = h('div', { class: 'pp-floats' });
    const head = h('div', { class: 'pp-head' }, h('div', { class: 'pp-tokwrap' }, badge, this.rank), h('div', { class: 'pp-id' }, name, cash, this.assets));
    this.cardEl = h('div', { class: 'pp-card' }, head, this.badges, this.chips, h('div', { class: 'pp-broken', 'data-label': t('g.panel.bankrupt') }), this.floats);
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
    const avail = hgt - tok - pad * 3;
    const inner = w - pad * 2;
    const colsMode = Math.min(inner / 8, avail / 4);
    const rowsMode = Math.min(inner / 4, avail / 8);
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
    const props = SETS.flat().map((i) => `${state.properties[i]?.owner === p.id ? state.properties[i]!.level : '-'}`);
    const away = oneAwayWarnings(state).filter((w) => w.playerId === p.id && w.kind !== 'line').map((w) => w.missing);
    const sig = [totalAssets(state, p.id), r, props.join(','), away.join(','), p.cards.join(','), p.islandTurns, state.festival, p.expressPending, p.travelPending].join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    this.assets.textContent = t('g.panel.assets', { amount: fmtMoney(totalAssets(state, p.id)) });
    this.rank.textContent = r ? String(r) : '';
    this.rank.classList.toggle('is-on', r > 0);
    this.rank.classList.toggle('is-first', r === 1);
    // Set grid.
    SETS.forEach((members) => {
      const complete = members.every((i) => state.properties[i]?.owner === p.id);
      for (const i of members) {
        const slot = this.slots.get(i)!;
        const pr = state.properties[i]!;
        const mine = pr.owner === p.id;
        slot.className = `slot${BOARD[i]!.kind === 'hub' ? ' is-hub' : ''}${mine ? ' is-mine' : ''}${complete ? ' is-complete' : ''}${mine && pr.level === 4 ? ' is-lm' : ''}${mine && state.festival === i ? ' is-fest' : ''}${!mine && away.includes(i) ? ' is-missing' : ''}`;
        slot.innerHTML = '';
        if (mine && pr.level > 0 && pr.level < 4) {
          const pips = h('span', { class: 'slot-pips' });
          for (let k = 0; k < pr.level; k++) pips.append(h('i'));
          slot.append(pips);
        } else if (mine && pr.level === 4) slot.append(h('span', { class: 'slot-star', text: '★' }));
      }
    });
    // Badges.
    this.badges.innerHTML = '';
    if (p.islandTurns > 0) this.badges.append(h('span', { class: 'bdg is-island' }, iconEl('corner-island', 'ico bdg-ico'), h('b', { text: String(p.islandTurns) })));
    if (p.travelPending) this.badges.append(h('span', { class: 'bdg' }, iconEl('corner-tour', 'ico bdg-ico')));
    if (p.expressPending) this.badges.append(h('span', { class: 'bdg' }, iconEl('hub-rail', 'ico bdg-ico'), h('b', { text: '×2' })));
    for (const c of p.cards) this.badges.append(h('span', { class: 'bdg is-card' }, iconEl(CARD_ICON[c] ?? 'cards-escape', 'ico bdg-ico')));
  }

  private tweenTo(v: number): void {
    const from = this.shown;
    const up = v > this.target;
    this.target = v;
    this.cardEl.classList.remove('flash-up', 'flash-down');
    if (instant()) {
      this.shown = v;
      this.cashNum.textContent = fmtMoney(v);
      return;
    }
    void this.cardEl.offsetWidth; // restart flash
    this.cardEl.classList.add(up ? 'flash-up' : 'flash-down');
    const dur = D(650);
    const t0 = performance.now();
    cancelAnimationFrame(this.raf);
    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / Math.max(1, dur));
      const e = 1 - Math.pow(1 - k, 3);
      this.shown = Math.round(from + (v - from) * e);
      this.cashNum.textContent = fmtMoney(this.shown);
      if (k < 1) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /** "+300" / "−120" float rising from the panel (rotated with it). */
  float(delta: number): void {
    if (instant() || delta === 0) return;
    const el = h('span', { class: `pp-float ${delta > 0 ? 'is-up' : 'is-down'}`, text: signedMoney(delta) });
    this.floats.append(el);
    void anim(
      el,
      [
        { transform: 'translate(-50%, 20%) scale(.6)', opacity: 0 },
        { transform: 'translate(-50%, -40%) scale(1.1)', opacity: 1, offset: 0.25 },
        { transform: 'translate(-50%, -160%) scale(1)', opacity: 0 },
      ],
      { duration: 1300, easing: 'cubic-bezier(.22,1,.36,1)' },
    ).then(() => el.remove());
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
      { duration: 900, easing: 'ease-out' },
    );
  }

  /** Centre in client px (for coin arcs). */
  clientCenter(): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
  }
}
