/**
 * Result screen: the celebration card is rotated to face the winner's seat (fixed view, one human
 * vs CPUs: faces S, no rotate pill — src/ui/orientation.ts).
 * Ranking rows with cash/property asset bars, awards revealed one by one, an assets-over-time
 * graph, game stats, "다시 하기" / "타이틀로".
 */
import '@/i18n/game';
import { GROUP_NAMES } from '@/content/board';
import { loc, t, fmtMoney } from '@/i18n';
import type { GameState, Seat } from '@/engine';
import { playerColor } from '@/content/palette';
import { awardsFor, leadChanges, storyFor } from './awards';
import { registerScreen } from '@/ui/router';
import { go } from '@/ui/shell/nav';
import { rotateStart } from '@/ui/shell/setupModel';
import { sfx } from '@/ui/audio/sfx';
import { haptic } from '@/ui/audio/haptics';
import { createFx } from '@/ui/fx/vfx';
import { fxCanvasFor, prefs } from '@/ui/shell/prefs';
import { isNative } from '@/ui/shell/capacitor';
import { anim, gridTimeout, noMotion } from '@/ui/fx/time';
import { watchViewport } from '@/ui/layout';
import { h, iconEl, SEAT_ANGLE, setPlayerVars, svg, tokenBadge } from '@/ui/game/util';
import { DUR, EASE } from '@/ui/fx/motion';
import { orientationFor } from '@/ui/orientation';

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

/** Total assets per player per round (+ the final standing), as coloured lines. */
function assetGraph(state: GameState, finals: Map<number, number>): SVGSVGElement | null {
  const rows = [...(state.history ?? [])];
  if (rows.length < 1) return null;
  rows.push(state.players.map((p) => finals.get(p.id) ?? 0));
  const max = Math.max(1, ...rows.flat());
  const ns = 'http://www.w3.org/2000/svg';
  const svgEl = document.createElementNS(ns, 'svg');
  svgEl.setAttribute('viewBox', '0 0 100 40');
  svgEl.setAttribute('class', 'rs-graph');
  svgEl.setAttribute('aria-hidden', 'true');
  for (const p of state.players) {
    const pts = rows.map((r, i) => `${((i / (rows.length - 1)) * 100).toFixed(1)},${(38 - ((r[p.id] ?? 0) / max) * 34).toFixed(1)}`).join(' ');
    const line = document.createElementNS(ns, 'polyline');
    line.setAttribute('points', pts);
    line.setAttribute('stroke', playerColor(p.colorId).hex);
    line.setAttribute('pathLength', '1');
    svgEl.append(line);
  }
  // Where the lead changed hands: a dot in the new leader's colour.
  for (const c of leadChanges(rows)) {
    const v = rows[c.at]![c.pid] ?? 0;
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', ((c.at / (rows.length - 1)) * 100).toFixed(1));
    dot.setAttribute('cy', (38 - (v / max) * 34).toFixed(1));
    dot.setAttribute('r', '1.6');
    dot.setAttribute('fill', playerColor(state.players[c.pid]!.colorId).hex);
    dot.setAttribute('class', 'rs-lead');
    svgEl.append(dot);
  }
  return svgEl;
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
  const graph = assetGraph(state, new Map(ranking.map((r) => [r.playerId, Math.max(0, r.totalAssets)])));
  if (graph) {
    hero.append(h('div', { class: 'rs-graph-h', text: t('r.graph') }), graph);
    const story = storyFor(state, state.players.map((p) => Math.max(0, ranking.find((r) => r.playerId === p.id)?.totalAssets ?? 0)));
    if (story) hero.append(h('div', { class: 'rs-story', text: t(story.key, story.params) }));
  }

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
  // Awards (staging: revealed one at a time after the card lands), then the plain game stats.
  const awards = awardsFor(state);
  const awardEls = awards.map((a) => {
    const p = state.players[a.pid]!;
    const el = h(
      'div',
      { class: 'rs-award' },
      iconEl(a.icon, 'ico rs-award-ico'),
      h('div', { class: 'rs-award-main' }, h('b', { text: t(`r.award.${a.id}`) }), h('span', {}, tokenBadge(p, 'tok-badge rs-award-tok'), h('i', { text: p.name }), h('em', { text: a.value }))),
    );
    setPlayerVars(el, p.colorId);
    return el;
  });
  const stats = h(
    'div',
    { class: 'rs-statline' },
    t('r.statsLine', { rounds: result?.round ?? state.round, turns: state.turn, b: state.bankruptOrder.length }),
  );
  const awardBox = awardEls.length ? h('div', { class: 'rs-awards' }, ...awardEls) : null;
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
  const side = h(
    'div',
    { class: 'rs-side' },
    h('div', { class: 'rs-h', text: t('r.ranking') }),
    rows,
    legend,
    awardBox ? h('div', { class: 'rs-h rs-h-awards', text: t('r.awards') }) : null,
    awardBox,
    stats,
    h('div', { class: 'rs-btns' }, again, home),
  );
  const orient = orientationFor(state.players);
  const card = h('div', { class: 'rs-card', 'data-seat': orient.face(winner.seat) }, hero, side);
  const fx = h('div', { class: 'fx-layer' });
  // Always-upright pill on the S edge: turns the card toward the next seat so everyone at the
  // table can read the ranking (cycles through the occupied seats S → E → N → W).
  // The fixed view has one reader (S): nothing to turn toward.
  const seats = orient.fixed ? ['S' as Seat] : SEAT_CYCLE.filter((x) => state.players.some((p) => p.seat === x));
  const rotate = h('button', { class: 'rs-rotate', type: 'button', 'aria-label': t('r.rotate') }, iconEl('rotate', 'ico'), h('span', { text: t('r.rotate') }));
  const screen = h('div', { class: 'result', 'data-view': orient.mode }, card, seats.length > 1 ? rotate : null, fx);
  root.append(screen);

  let seat: Seat = orient.face(winner.seat);
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
  // The Android app keeps canvas effects off unless chosen in Settings (white boxes on some
  // WebViews, docs/PERFORMANCE.md) and then paints them on the main thread: same rule as the game.
  const canvasFx = fxCanvasFor(prefs.get(), isNative());
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
    quality: canvasFx?.quality ?? 'off',
    ...(canvasFx && !canvasFx.worker ? { worker: false } : {}),
  });
  sfx.play('win');
  void anim(hero, [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], {
    duration: 520,
    easing: EASE.overshoot,
  });
  // After the screen's entry (its layout settles first); decided now, like every animation of the
  // mount (speed 0 / reduced motion at mount = no confetti, even if the speed changes 60 ms later).
  const cancelConfetti = noMotion() || !canvasFx ? () => {} : gridTimeout(() => void vfx.play('confettiRain', { n: 60 }), 60);
  // Awards pop in one by one (anticipation: hidden until their beat; overshoot on arrival); the
  // graph lines draw themselves after the hero lands.
  const cancels: Array<() => void> = [];
  if (!noMotion()) {
    awardEls.forEach((el, i) => {
      el.style.opacity = '0';
      cancels.push(gridTimeout(() => {
        el.style.opacity = '';
        sfx.play('tap', { pitch: 1 + i * 0.12 });
        void anim(el, [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: DUR.enter, easing: EASE.overshoot });
      }, 700 + i * DUR.stagger * 6));
    });
    graph?.querySelectorAll('polyline').forEach((line) => {
      void anim(line, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 1200, easing: EASE.inOut });
    });
  }

  return () => {
    cancels.forEach((c) => c());
    cancelConfetti();
    vfx.dispose();
    stop();
  };
});
