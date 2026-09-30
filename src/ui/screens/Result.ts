/**
 * Result screen: the celebration card is rotated to face the winner's seat.
 * Ranking rows with cash/property asset bars, game stats, "다시 하기" / "타이틀로".
 */
import '@/i18n/game';
import { GROUP_NAMES } from '@/content/board';
import { loc, t, fmtMoney } from '@/i18n';
import type { GameState, Seat } from '@/engine';
import { registerScreen } from '@/ui/router';
import { go } from '@/ui/shell/nav';
import { rotateStart } from '@/ui/shell/setupModel';
import { sfx } from '@/ui/audio/sfx';
import { haptic } from '@/ui/audio/haptics';
import { createFx } from '@/ui/fx/vfx';
import { prefs } from '@/ui/shell/prefs';
import { anim, gridTimeout, instant } from '@/ui/fx/time';
import { watchViewport } from '@/ui/layout';
import { h, iconEl, SEAT_ANGLE, setPlayerVars, svg, tokenBadge } from '@/ui/game/util';

const SEAT_CYCLE: readonly Seat[] = ['S', 'E', 'N', 'W'];
/** Vertical px kept free at the bottom (S edge) for the rotate pill. */
const PILL_ROOM = 46;

function victoryDetail(state: GameState): string {
  const ph = state.phase;
  if (ph.kind !== 'gameOver') return '';
  const r = ph.result;
  if (r.victory === 'triple' && r.groups) return r.groups.map((g) => loc(GROUP_NAMES[g])).join(' · ');
  return t(`r.victory.${r.victory}.detail`);
}

registerScreen('result', (root, { state }) => {
  const ph = state.phase;
  const result = ph.kind === 'gameOver' ? ph.result : null;
  const winnerId = result?.winnerId ?? 0;
  const winner = state.players[winnerId]!;
  const ranking = result?.ranking ?? [];
  const maxTotal = Math.max(1, ...ranking.map((r) => r.totalAssets));

  const hero = h(
    'div',
    { class: 'rs-hero' },
    h('div', { class: 'rs-crown', html: svg('trophy') }),
    h('div', { class: 'rs-tok', html: svg(winner.tokenId) }),
    h('div', { class: 'rs-win', text: t('r.winner', { name: winner.name }) }),
    h('div', { class: 'rs-kind', text: result ? t(`r.victory.${result.victory}`) : '' }),
    h('div', { class: 'rs-detail', text: victoryDetail(state) }),
  );
  setPlayerVars(hero, winner.colorId);

  const rows = h('div', { class: 'rs-rows' });
  for (const r of ranking) {
    const p = state.players[r.playerId]!;
    const row = h('div', { class: `rs-row${r.rank === 1 ? ' is-first' : ''}${p.bankrupt ? ' is-bankrupt' : ''}` });
    setPlayerVars(row, p.colorId);
    const bar = h('div', { class: 'rs-bar' });
    const cashW = (Math.max(0, r.cash) / maxTotal) * 100;
    const propW = (Math.max(0, r.propertyValue) / maxTotal) * 100;
    bar.append(h('span', { class: 'rs-bar-cash', style: `width:${cashW}%` }), h('span', { class: 'rs-bar-prop', style: `width:${propW}%` }));
    row.append(
      h('b', { class: 'rs-rank', text: String(r.rank) }),
      tokenBadge(p, 'tok-badge rs-row-tok'),
      h('div', { class: 'rs-row-main' }, h('div', { class: 'rs-row-name' }, h('span', { text: p.name }), p.bankrupt ? h('em', { text: t('g.panel.bankrupt') }) : null), bar),
      h('b', { class: 'rs-total', text: fmtMoney(r.totalAssets) }),
    );
    rows.append(row);
  }
  const legend = h(
    'div',
    { class: 'rs-legend' },
    h('span', { class: 'lg-cash' }, h('i'), t('r.cash')),
    h('span', { class: 'lg-prop' }, h('i'), t('r.property')),
  );
  const stats = h(
    'div',
    { class: 'rs-stats' },
    h('div', { class: 'rs-stat' }, h('b', { text: String(result?.round ?? state.round) }), h('span', { text: t('r.rounds') })),
    h('div', { class: 'rs-stat' }, h('b', { text: String(state.turn) }), h('span', { text: t('r.turns') })),
    h('div', { class: 'rs-stat' }, h('b', { text: String(state.bankruptOrder.length) }), h('span', { text: t('r.bankruptcies') })),
  );
  const again = h('button', { class: 'rs-btn is-primary', type: 'button' }, iconEl('restart', 'ico'), h('span', { text: t('r.again') }));
  const home = h('button', { class: 'rs-btn', type: 'button' }, iconEl('home', 'ico'), h('span', { text: t('r.title') }));
  again.addEventListener('click', () => {
    sfx.play('tap');
    haptic('light');
    // Same table and house rules; a random player starts this time (DESIGN §4.1).
    const settings = { ...state.settings, players: rotateStart(state.settings.players) };
    go('game', { settings, seed: (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0 });
  });
  home.addEventListener('click', () => {
    sfx.play('tap');
    go('title', {});
  });
  const side = h('div', { class: 'rs-side' }, h('div', { class: 'rs-h', text: t('r.ranking') }), rows, legend, stats, h('div', { class: 'rs-btns' }, again, home));
  const card = h('div', { class: 'rs-card', 'data-seat': winner.seat }, hero, side);
  const fx = h('div', { class: 'fx-layer' });
  // Always-upright pill on the S edge: turns the card toward the next seat so everyone at the
  // table can read the ranking (cycles through the occupied seats S → E → N → W).
  const seats = SEAT_CYCLE.filter((x) => state.players.some((p) => p.seat === x));
  const rotate = h('button', { class: 'rs-rotate', type: 'button', 'aria-label': t('r.rotate') }, iconEl('rotate', 'ico'), h('span', { text: t('r.rotate') }));
  const screen = h('div', { class: 'result' }, card, seats.length > 1 ? rotate : null, fx);
  root.append(screen);

  let seat: Seat = winner.seat;
  let angle = SEAT_ANGLE[seat];
  let size = { W: window.innerWidth, H: window.innerHeight };
  const room = seats.length > 1 ? PILL_ROOM : 0;
  const layout = (): void => {
    const { W, H } = size;
    const sideways = seat === 'E' || seat === 'W';
    // The card sits in the area above the rotate pill.
    const avH = H - room;
    const w = sideways ? Math.min(avH * 0.94, 980) : Math.min(W * 0.94, 980);
    const hh = sideways ? Math.min(W * 0.92, 900) : Math.min(avH * 0.92, 680);
    card.style.width = `${w}px`;
    card.style.height = `${hh}px`;
    card.style.top = `${avH / 2}px`;
    card.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
    card.classList.toggle('is-tall', hh / w > 1.05);
    card.dataset.seat = seat;
  };
  const stop = watchViewport((W, H) => {
    size = { W, H };
    layout();
  });
  rotate.addEventListener('click', () => {
    sfx.play('tap');
    haptic('light');
    const next = seats[(seats.indexOf(seat) + 1) % seats.length]!;
    // Shortest arc from the current angle.
    let delta = (((SEAT_ANGLE[next] - angle) % 360) + 540) % 360 - 180;
    if (delta === -180) delta = 180;
    angle += delta;
    seat = next;
    card.classList.add('is-turning');
    layout();
  });
  card.addEventListener('transitionend', () => card.classList.remove('is-turning'));

  // Confetti on the VFX canvas engine (one canvas, freed when the last piece lands: idle zero).
  const vfx = createFx({
    layer: fx,
    getLayerRect: () => fx.getBoundingClientRect(),
    getBoardRect: () => {
      const r = fx.getBoundingClientRect();
      const s = Math.min(r.width, r.height);
      return { x: r.left + (r.width - s) / 2, y: r.top + (r.height - s) / 2, width: s, height: s };
    },
    getSpaceRect: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    getPanelRect: () => null,
    getSeat: () => 'S',
    quality: prefs.get().fxQuality,
  });
  sfx.play('win');
  void anim(hero, [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], {
    duration: 520,
    easing: 'cubic-bezier(.34,1.56,.64,1)',
  });
  // After the screen's entry (its layout settles first); decided now, like every animation of the
  // mount (speed 0 / reduced motion at mount = no confetti, even if the speed changes 60 ms later).
  const cancelConfetti = instant() ? () => {} : gridTimeout(() => void vfx.play('confettiRain', { n: 60 }), 60);

  return () => {
    cancelConfetti();
    vfx.dispose();
    stop();
  };
});
