/**
 * Title screen: animated emblem + wordmark, new game / continue / how to play / settings.
 */
import { icon, LOGO_SVG } from '@/content/icons';
import { onLangChange, t } from '@/i18n';
import { registerScreen } from '@/ui/router';
import { button, h, ico, onTap } from '@/ui/shell/dom';
import { confirmDialog, toast } from '@/ui/shell/dialog';
import { go, setBackTarget } from '@/ui/shell/nav';
import { clearSavedGame, loadSavedGame, savedGameSummary } from '@/ui/shell/persist';
import { tokenAvatar } from '@/ui/shell/widgets';
import { version } from '../../../package.json';

/** Drifting background pieces (icon id, x%, y%, size em, duration s, delay s, rotation deg). */
const FLOATIES: [string, number, number, number, number, number, number][] = [
  ['dice-face-5', 8, 18, 4.2, 15, -3, -14],
  ['coin', 22, 78, 3.2, 12, -7, 10],
  ['star', 44, 8, 2.8, 17, -2, 18],
  ['dice-face-3', 62, 84, 3.6, 14, -9, 22],
  ['crown', 88, 14, 3.4, 16, -5, -10],
  ['coin', 57, 5, 2.6, 13, -1, -20],
  ['rocket', 4, 60, 3, 18, -11, 8],
  ['dice-face-2', 74, 40, 2.4, 19, -4, 30],
];

function render(root: HTMLElement): void {
  root.innerHTML = '';
  const screen = h('div', { class: 'screen title-screen' });

  // --- background
  const bg = h('div', { class: 'title-bg', 'aria-hidden': 'true' });
  for (let i = 1; i <= 4; i++) bg.append(h('span', { class: `title-blob b${i}` }));
  bg.append(h('div', { class: 'title-rays' }));
  for (const [id, x, y, s, d, delay, r] of FLOATIES) {
    const f = h('span', {
      class: 'floaty',
      '--x': `${x}%`,
      '--y': `${y}%`,
      '--s': `${s}em`,
      '--d': `${d}s`,
      '--delay': `${delay}s`,
      '--r': `${r}deg`,
    });
    f.innerHTML = icon(id);
    bg.append(f);
  }

  // --- hero
  const logo = h('div', { class: 'title-logo', html: LOGO_SVG });
  const hero = h(
    'div',
    { class: 'title-hero' },
    h('div', { class: 'title-logo-wrap' }, h('span', { class: 'title-logo-glow' }), logo, h('span', { class: 'title-logo-shadow' })),
    h(
      'div',
      { class: 'title-words' },
      h('h1', { class: 'title-word' }, t('title.name')),
      h('div', { class: 'title-alt' }, t('title.nameAlt')),
      h('p', { class: 'title-tagline' }, t('title.tagline')),
    ),
  );

  // --- menu
  const summary = savedGameSummary();
  const menu = h('nav', { class: 'title-menu', 'aria-label': t('title.name') });

  const newGame = () => {
    if (summary) {
      void confirmDialog({
        title: t('title.newOverTitle'),
        body: t('title.newOverBody'),
        ok: t('title.newOverOk'),
      }).then((ok) => {
        if (ok) go('setup', {});
      });
    } else go('setup', {});
  };

  if (summary) {
    const cont = h('button', { type: 'button', class: 'btn btn-primary btn-xl title-continue', 'data-action': 'continue' });
    const info = summary.roundLimit
      ? t('title.continueInfoLimit', { round: summary.round, limit: summary.roundLimit, count: summary.players.length })
      : t('title.continueInfo', { round: summary.round, count: summary.players.length });
    cont.append(
      ico('play', 'title-continue-ico'),
      h(
        'span',
        { class: 'title-continue-text' },
        h('span', { class: 'title-continue-label' }, t('title.continue')),
        h(
          'span',
          { class: 'title-continue-info' },
          h('span', { class: 'title-continue-tokens' }, summary.players.map((p) => tokenAvatar(p.tokenId, p.colorId, 'avatar-xs'))),
          h('span', null, info),
        ),
      ),
    );
    onTap(cont, () => {
      const state = loadSavedGame();
      if (state) go('game', { resume: state });
      else render(root);
    });
    const discard = h('button', {
      type: 'button',
      class: 'btn btn-icon btn-ghost title-discard',
      'aria-label': t('title.discard'),
      title: t('title.discard'),
    });
    discard.append(ico('close'));
    onTap(discard, () => {
      void confirmDialog({
        title: t('title.discardTitle'),
        body: t('title.discardBody'),
        ok: t('title.discardOk'),
        danger: true,
      }).then((ok) => {
        if (!ok) return;
        clearSavedGame();
        toast(t('title.discarded'));
        render(root);
      });
    });
    menu.append(h('div', { class: 'title-continue-row' }, cont, discard));
    menu.append(button(t('title.new'), newGame, { cls: 'btn-lg title-new', icon: 'plus', attrs: { 'data-action': 'new' } }));
  } else {
    menu.append(button(t('title.new'), newGame, { cls: 'btn-primary btn-xl title-new', icon: 'play', attrs: { 'data-action': 'new' } }));
  }
  menu.append(
    h(
      'div',
      { class: 'title-menu-row' },
      button(t('title.rules'), () => go('rules', { back: 'title' }), { cls: 'btn-ghost', icon: 'help', attrs: { 'data-action': 'rules' } }),
      button(t('title.settings'), () => go('settings', { back: 'title' }), { cls: 'btn-ghost', icon: 'settings', attrs: { 'data-action': 'settings' } }),
    ),
  );
  menu.append(h('p', { class: 'title-players' }, ico('human'), t('title.players')));

  screen.append(
    bg,
    h('div', { class: 'title-main safe-pad' }, hero, menu),
    h('div', { class: 'title-foot num' }, `v${version}`),
  );
  root.append(screen);
}

registerScreen('title', (root) => {
  setBackTarget(undefined);
  render(root);
  const off = onLangChange(() => render(root));
  return () => off();
});
