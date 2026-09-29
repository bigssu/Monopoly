/**
 * Illustrated, swipeable rules (6 pages). Also usable as an overlay from the game menu:
 *   import { openRulesOverlay } from '@/ui/screens/Rules';  openRulesOverlay();
 */
import { GROUP_COLORS } from '@/content/board';
import { icon, LOGO_SVG } from '@/content/icons';
import { onLangChange, t } from '@/i18n';
import { sfx } from '@/ui/audio/sfx';
import { registerScreen } from '@/ui/router';
import { h, ico, iconButton, onTap } from '@/ui/shell/dom';
import { goBackTo, setBackTarget } from '@/ui/shell/nav';
import { openDialog } from '@/ui/shell/dialog';
import { tokenAvatar } from '@/ui/shell/widgets';

function svgIcon(id: string, cls: string): HTMLElement {
  return h('span', { class: `art-ico ${cls}`, html: icon(id), 'aria-hidden': 'true' });
}

function points(items: [string, string][]): HTMLElement {
  return h(
    'ul',
    { class: 'rp-points' },
    items.map(([iconId, text]) => h('li', null, h('span', { class: 'rp-point-ico' }, iconId.startsWith('ui:') ? ico(iconId.slice(3)) : svgIcon(iconId, '')), h('span', null, text))),
  );
}

interface Page {
  id: string;
  build(): HTMLElement;
}

function textBlock(n: number, titleKey: string, bodyKey: string, extra?: HTMLElement): HTMLElement {
  return h(
    'div',
    { class: 'rp-text' },
    h('span', { class: 'rp-num num' }, String(n)),
    h('h2', { class: 'rp-title' }, t(titleKey)),
    h('p', { class: 'rp-body' }, t(bodyKey)),
    extra ?? null,
  );
}

const PAGES: Page[] = [
  {
    id: 'goal',
    build: () =>
      h(
        'div',
        { class: 'rp-card' },
        h(
          'div',
          { class: 'rp-art art-goal' },
          h('span', { class: 'art-disc' }),
          h('div', { class: 'art-goal-logo', html: LOGO_SVG }),
          tokenAvatar('car', 'red', 'art-tok t1'),
          tokenAvatar('cat', 'green', 'art-tok t2'),
          tokenAvatar('rocket', 'blue', 'art-tok t3'),
          tokenAvatar('crown', 'yellow', 'art-tok t4'),
          svgIcon('coin', 'art-coin c1'),
          svgIcon('coin', 'art-coin c2'),
          svgIcon('coin', 'art-coin c3'),
        ),
        textBlock(1, 'rules.goal.title', 'rules.goal.body', points([['ui:human', t('rules.goal.tip')]])),
      ),
  },
  {
    id: 'dice',
    build: () => {
      const track = h('div', { class: 'art-track' });
      for (let i = 0; i < 6; i++) track.append(h('span', { class: `art-tile ${i === 5 ? 'is-land' : ''}`.trim() }));
      track.append(tokenAvatar('car', 'red', 'art-hopper'));
      return h(
        'div',
        { class: 'rp-card' },
        h(
          'div',
          { class: 'rp-art art-dice' },
          h('span', { class: 'art-disc' }),
          svgIcon('dice-face-3', 'art-die d1'),
          svgIcon('dice-face-3', 'art-die d2'),
          h('span', { class: 'art-burst display' }, t('rules.double')),
          track,
        ),
        textBlock(
          2,
          'rules.dice.title',
          'rules.dice.body',
          points([
            ['dice-face-6', t('rules.dice.double')],
            ['corner-island', t('rules.dice.triple')],
          ]),
        ),
      );
    },
  },
  {
    id: 'build',
    build: () => {
      const steps: [string, string, string][] = [
        ['land', 'rules.lv.land', '×0.1'],
        ['villa', 'rules.lv.villa', '×1'],
        ['building', 'rules.lv.building', '×2'],
        ['hotel', 'rules.lv.hotel', '×3'],
        ['landmark', 'rules.lv.landmark', '×4'],
      ];
      const stair = h('div', { class: 'art-stairs' });
      steps.forEach(([id, key, mult], i) => {
        const pic = id === 'land' ? h('span', { class: 'art-ico art-plot' }) : svgIcon(id, '');
        stair.append(
          h(
            'div',
            { class: 'art-step', '--i': String(i) },
            h('div', { class: 'art-step-pic' }, pic),
            h('div', { class: 'art-step-name' }, t(key)),
            h('div', { class: 'art-step-mult num' }, mult),
          ),
        );
      });
      return h(
        'div',
        { class: 'rp-card' },
        h('div', { class: 'rp-art art-build' }, stair, h('div', { class: 'art-caption' }, t('rules.build.toll'))),
        textBlock(3, 'rules.build.title', 'rules.build.body', points([['ui:check', t('rules.build.group')]])),
      );
    },
  },
  {
    id: 'toll',
    build: () =>
      h(
        'div',
        { class: 'rp-card' },
        h(
          'div',
          { class: 'rp-art art-toll' },
          h('span', { class: 'art-disc' }),
          h('div', { class: 'art-city' }, svgIcon('city-athens', 'art-city-ico'), h('span', { class: 'art-city-flag' })),
          tokenAvatar('cat', 'green', 'art-payer'),
          svgIcon('coin', 'art-fly f1'),
          svgIcon('coin', 'art-fly f2'),
          svgIcon('coin', 'art-fly f3'),
          h('span', { class: 'art-stamp display' }, t('rules.stamp')),
          svgIcon('cards-shield', 'art-shield'),
        ),
        textBlock(
          4,
          'rules.toll.title',
          'rules.toll.body',
          points([
            ['landmark', t('rules.toll.landmark')],
            ['cards-shield', t('rules.toll.shield')],
            ['pot', t('rules.toll.debt')],
          ]),
        ),
      ),
  },
  {
    id: 'spaces',
    build: () => {
      const items: [string, string][] = [
        ['corner-start', 'start'],
        ['corner-island', 'island'],
        ['corner-festival', 'festival'],
        ['corner-tour', 'travel'],
        ['space-event', 'event'],
        ['space-tax', 'tax'],
        ['space-donation', 'donation'],
        ['hub-airport', 'hub'],
      ];
      return h(
        'div',
        { class: 'rp-card is-grid' },
        h('div', { class: 'rp-grid-head' }, h('span', { class: 'rp-num num' }, '5'), h('h2', { class: 'rp-title' }, t('rules.spaces.title'))),
        h(
          'div',
          { class: 'rp-grid g4' },
          items.map(([iconId, key], i) =>
            h(
              'div',
              { class: 'rp-tile', '--i': String(i) },
              svgIcon(iconId, 'rp-tile-ico'),
              h('div', { class: 'rp-tile-text' }, h('h3', { class: 'rp-tile-title' }, t(`rules.spaces.${key}`)), h('p', { class: 'rp-tile-desc' }, t(`rules.spaces.${key}.d`))),
            ),
          ),
        ),
      );
    },
  },
  {
    id: 'win',
    build: () => {
      const chips = (colors: string[], cls: string) =>
        h('span', { class: `win-chips ${cls}` }, colors.map((c) => h('i', { style: { background: c } })));
      const hubs = h('span', { class: 'win-hubs' }, ['hub-port', 'hub-airport', 'hub-rail', 'hub-space'].map((id) => svgIcon(id, '')));
      const items: [HTMLElement, string][] = [
        [chips([GROUP_COLORS.pink, GROUP_COLORS.orange, GROUP_COLORS.blue], 'triple'), 'triple'],
        [chips([GROUP_COLORS.red, GROUP_COLORS.red, GROUP_COLORS.red, GROUP_COLORS.red], 'line'), 'line'],
        [hubs, 'hubs'],
        [svgIcon('pot', 'win-ico'), 'bankrupt'],
        [h('span', { class: 'win-trophy' }, ico('trophy')), 'rounds'],
      ];
      return h(
        'div',
        { class: 'rp-card is-grid' },
        h(
          'div',
          { class: 'rp-grid-head' },
          h('span', { class: 'rp-num num' }, '6'),
          h('h2', { class: 'rp-title' }, t('rules.win.title')),
          h('p', { class: 'rp-grid-sub' }, t('rules.win.body')),
        ),
        h(
          'div',
          { class: 'rp-grid g5' },
          items.map(([art, key], i) =>
            h(
              'div',
              { class: 'rp-tile is-win', '--i': String(i) },
              h('div', { class: 'rp-tile-art' }, art),
              h('div', { class: 'rp-tile-text' }, h('h3', { class: 'rp-tile-title' }, t(`rules.win.${key}`)), h('p', { class: 'rp-tile-desc' }, t(`rules.win.${key}.d`))),
            ),
          ),
        ),
      );
    },
  },
];

/**
 * Mount the rules viewer into `host`. `onClose` is called by the back / done buttons.
 * Returns a cleanup function.
 */
export function mountRules(host: HTMLElement, onClose: () => void, startPage = 0): () => void {
  let page = Math.min(Math.max(0, startPage), PAGES.length - 1);
  const wrap = h('div', { class: 'rules' });
  host.append(wrap);

  const render = () => {
    wrap.innerHTML = '';
    const counter = h('span', { class: 'rules-counter num' });
    const head = h(
      'header',
      { class: 'rules-head' },
      iconButton('chevron-left', t('shell.back'), onClose),
      h('h1', { class: 'rules-title' }, ico('help'), t('rules.title')),
      counter,
    );
    const track = h('div', { class: 'rules-track' });
    PAGES.forEach((p, i) => track.append(h('section', { class: 'rp', 'data-page': p.id, 'aria-hidden': 'true', '--p': String(i) }, p.build())));
    const viewport = h('div', { class: 'rules-viewport' }, track);

    const prev = h('button', { type: 'button', class: 'btn btn-ghost rules-prev', 'data-action': 'prev' }, ico('chevron-left'), h('span', null, t('rules.prev')));
    const next = h('button', { type: 'button', class: 'btn btn-primary rules-next', 'data-action': 'next' });
    const dots = h('div', { class: 'rules-dots', role: 'tablist' });
    PAGES.forEach((p, i) => {
      const d = h('button', { type: 'button', class: 'rules-dot', role: 'tab', 'aria-label': t('rules.page', { n: i + 1, total: PAGES.length }), 'data-page': p.id });
      onTap(d, () => setPage(i), { haptic: 'tick' });
      dots.append(d);
    });

    const setPage = (i: number, fromSwipe = false) => {
      const clamped = Math.min(Math.max(0, i), PAGES.length - 1);
      if (clamped !== page && fromSwipe) sfx.play('card');
      page = clamped;
      track.style.transition = '';
      track.style.transform = `translate3d(${-page * 100}%,0,0)`;
      track.querySelectorAll('.rp').forEach((el, j) => {
        el.setAttribute('aria-hidden', String(j !== page));
        el.classList.toggle('is-active', j === page);
      });
      dots.querySelectorAll('.rules-dot').forEach((el, j) => el.setAttribute('aria-selected', String(j === page)));
      counter.textContent = t('rules.page', { n: page + 1, total: PAGES.length });
      prev.disabled = page === 0;
      const last = page === PAGES.length - 1;
      next.innerHTML = '';
      next.append(h('span', null, last ? t('rules.done') : t('rules.next')), ico(last ? 'check' : 'chevron-right'));
      next.dataset.last = String(last);
    };
    onTap(prev, () => setPage(page - 1));
    onTap(next, () => (page === PAGES.length - 1 ? onClose() : setPage(page + 1)));

    // Swipe: follow the finger, then snap.
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let dragging = false;
    let axis: 'x' | 'y' | null = null;
    viewport.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      dragging = true;
      axis = null;
      startX = e.clientX;
      startY = e.clientY;
      startT = performance.now();
    });
    viewport.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!axis && Math.hypot(dx, dy) > 8) {
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (axis === 'x') viewport.setPointerCapture(e.pointerId);
      }
      if (axis !== 'x') return;
      const edge = (page === 0 && dx > 0) || (page === PAGES.length - 1 && dx < 0) ? 0.35 : 1;
      track.style.transition = 'none';
      track.style.transform = `translate3d(calc(${-page * 100}% + ${dx * edge}px),0,0)`;
    });
    const end = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (axis !== 'x') return;
      const dx = e.clientX - startX;
      const v = dx / Math.max(1, performance.now() - startT);
      const w = viewport.clientWidth || 1;
      if (dx < -w * 0.18 || v < -0.45) setPage(page + 1, true);
      else if (dx > w * 0.18 || v > 0.45) setPage(page - 1, true);
      else setPage(page);
    };
    viewport.addEventListener('pointerup', end);
    viewport.addEventListener('pointercancel', end);

    wrap.append(head, viewport, h('footer', { class: 'rules-foot' }, prev, dots, next));
    setPage(page);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') wrap.querySelector<HTMLButtonElement>('.rules-next')?.click();
    if (e.key === 'ArrowLeft') wrap.querySelector<HTMLButtonElement>('.rules-prev:not(:disabled)')?.click();
  };
  window.addEventListener('keydown', onKey);
  render();
  const offLang = onLangChange(render);
  return () => {
    offLang();
    window.removeEventListener('keydown', onKey);
    wrap.remove();
  };
}

/** Show the rules above the current screen (e.g. from the in-game menu). */
export function openRulesOverlay(): void {
  let cleanup: (() => void) | null = null;
  const close = openDialog(
    (closeFn) => {
      const host = h('div', { class: 'rules-overlay' });
      cleanup = mountRules(host, closeFn);
      return host;
    },
    { cls: 'overlay-backdrop', dismissable: false, onClose: () => cleanup?.() },
  );
  void close;
}

registerScreen('rules', (root, props) => {
  setBackTarget(props.back ?? 'title');
  const screen = h('div', { class: 'screen rules-screen safe-pad' });
  root.append(screen);
  return mountRules(screen, () => goBackTo(props.back ?? 'title'));
});
