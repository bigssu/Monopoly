/**
 * Settings: language, sound + volume, vibration, prompt timer, battery saver, effects quality, saved game, credits & licenses.
 * Also usable as an overlay from the game menu:
 *   import { openSettingsOverlay } from '@/ui/screens/SettingsScreen';
 */
import { LOGO_SVG } from '@/content/icons';
import { getLang, onLangChange, t, type Lang } from '@/i18n';
import { sfx } from '@/ui/audio/sfx';
import { registerScreen } from '@/ui/router';
import { button, h, ico, iconButton } from '@/ui/shell/dom';
import { confirmDialog, openDialog, toast } from '@/ui/shell/dialog';
import { markdownToHtml } from '@/ui/shell/markdown';
import { goBackTo, setBackTarget } from '@/ui/shell/nav';
import { clearSavedGame, savedGameSummary } from '@/ui/shell/persist';
import { prefs, type FxQualityPref } from '@/ui/shell/prefs';
import { segmented, switcher } from '@/ui/shell/widgets';
import licensesMd from '../../../docs/THIRD_PARTY_LICENSES.md?raw';
import { version } from '../../../package.json';

const GLOBE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12H21.5"/><path d="M12 2.5Q7 7 7 12T12 21.5Q17 17 17 12T12 2.5Z"/></svg>`;
const BATTERY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="7" width="17" height="10" rx="2.5"/><path d="M22 10.5V13.5"/><path d="M11.5 8.8L8.8 12.2H12.2L9.5 15.2"/></svg>`;
const SPARKLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M10 3.5L11.8 8.2L16.5 10L11.8 11.8L10 16.5L8.2 11.8L3.5 10L8.2 8.2Z"/><path d="M18 14.5L18.9 16.6L21 17.5L18.9 18.4L18 20.5L17.1 18.4L15 17.5L17.1 16.6Z"/></svg>`;
const LEVELS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 19V15M10 19V11M15 19V7.5M20 19V4"/></svg>`;

function row(iconId: string | HTMLElement, label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h(
    'div',
    { class: 'set-row' },
    h('div', { class: 'set-label' }, typeof iconId === 'string' ? h('span', { class: 'set-ico' }, iconId.startsWith('<') ? h('span', { class: 'ico', html: iconId }) : ico(iconId)) : iconId, h('span', { class: 'set-label-text' }, h('span', null, label), hint ? h('small', null, hint) : null)),
    h('div', { class: 'set-control' }, control),
  );
}

function openLicenses(): void {
  openDialog((close) => {
    const ofl = h('pre', { class: 'lic-ofl' }, t('settings.loading'));
    fetch('./fonts/jua/OFL.txt')
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((txt) => (ofl.textContent = txt.trim()))
      .catch(() => (ofl.textContent = 'SIL Open Font License, Version 1.1 — https://openfontlicense.org'));
    return h(
      'div',
      { class: 'dlg dlg-wide lic' },
      h('div', { class: 'lic-head' }, h('h2', { class: 'dlg-title' }, t('settings.licensesTitle')), iconButton('close', t('shell.close'), close, 'btn-ghost lic-close')),
      h(
        'div',
        { class: 'lic-scroll' },
        h('div', { class: 'md', html: markdownToHtml(licensesMd) }),
        h('h3', { class: 'lic-ofl-title' }, t('settings.oflTitle')),
        ofl,
      ),
    );
  });
}

/** Mount the settings UI into `host`; returns a cleanup function. */
export function mountSettings(host: HTMLElement, onClose: () => void): () => void {
  const wrap = h('div', { class: 'settings' });
  host.append(wrap);

  const render = () => {
    const p = prefs.get();
    wrap.innerHTML = '';

    const lang = segmented<Lang>(
      [
        { value: 'ko', label: t('lang.ko') },
        { value: 'en', label: t('lang.en') },
      ],
      getLang(),
      (v) => prefs.set({ lang: v }),
      { label: t('settings.language') },
    );

    const volume = h('input', {
      type: 'range',
      class: 'vol',
      min: '0',
      max: '100',
      step: '5',
      value: String(Math.round(p.volume * 100)),
      'aria-label': t('settings.volume'),
    });
    const setFill = () => volume.style.setProperty('--fill', `${volume.value}%`);
    setFill();
    volume.addEventListener('input', () => {
      setFill();
      prefs.set({ volume: Number(volume.value) / 100 });
    });
    volume.addEventListener('change', () => sfx.play('cash-in'));
    volume.disabled = !p.sound;

    const soundIco = h('span', { class: 'set-ico' }, ico(p.sound ? 'sound-on' : 'sound-off'));
    const soundSwitch = switcher(p.sound, (v) => {
      prefs.set({ sound: v });
      volume.disabled = !v;
      soundIco.innerHTML = '';
      soundIco.append(ico(v ? 'sound-on' : 'sound-off'));
      if (v) sfx.play('turn');
    }, t('settings.sound'));

    const test = iconButton('sound-on', t('settings.test'), () => sfx.play('win'), 'btn-ghost set-test');

    const fxq = segmented<FxQualityPref>(
      [
        { value: 'auto', label: t('settings.fxAuto') },
        { value: 'high', label: t('settings.fxHigh') },
        { value: 'low', label: t('settings.fxLow') },
        { value: 'off', label: t('settings.fxOff') },
      ],
      p.fxQuality,
      (v) => prefs.set({ fxQuality: v }),
      { label: t('settings.fx') },
    );

    const timer = segmented(
      [0, 15, 30].map((v) => ({ value: v as 0 | 15 | 30, label: v === 0 ? t('setup.timerOff') : t('setup.seconds', { n: v }) })),
      p.promptTimer,
      (v) => prefs.set({ promptTimer: v }),
      { label: t('settings.timer') },
    );

    const general = h(
      'section',
      { class: 'set-card' },
      h('h2', { class: 'set-card-title' }, t('settings.general')),
      row(GLOBE_SVG, t('settings.language'), lang),
      row(soundIco, t('settings.sound'), h('div', { class: 'set-inline' }, soundSwitch)),
      row(LEVELS_SVG, t('settings.volume'), h('div', { class: 'set-inline set-volume' }, volume, test)),
      row('vibrate', t('settings.haptics'), switcher(p.haptics, (v) => prefs.set({ haptics: v }), t('settings.haptics'))),
      row('timer', t('settings.timer'), timer, t('settings.timerHint')),
      row(
        BATTERY_SVG,
        t('settings.batterySaver'),
        h('div', { class: 'set-inline' }, switcher(p.batterySaver, (v) => prefs.set({ batterySaver: v }), t('settings.batterySaver'))),
        t('settings.batterySaverHint'),
      ),
      row(SPARKLE_SVG, t('settings.fx'), fxq, t('settings.fxHint')),
    );

    const summary = savedGameSummary();
    const del = button(t('settings.deleteSave'), () => {
      void confirmDialog({ title: t('title.discardTitle'), body: t('title.discardBody'), ok: t('title.discardOk'), danger: true }).then((ok) => {
        if (!ok) return;
        clearSavedGame();
        toast(t('settings.deleted'));
        render();
      });
    }, { cls: 'btn-danger-ghost set-delete', icon: 'close', attrs: { 'data-action': 'delete-save' } });
    if (!summary) del.disabled = true;
    const data = h(
      'section',
      { class: 'set-card set-card-data' },
      h('h2', { class: 'set-card-title' }, t('settings.data')),
      h('div', { class: 'set-save' }, h('span', { class: 'set-ico' }, ico('save')), h('p', { class: 'set-save-text' }, summary ? t('settings.hasSave', { round: summary.round, count: summary.players.length }) : t('settings.noSave'))),
      del,
    );

    const about = h(
      'section',
      { class: 'set-card set-card-about' },
      h('h2', { class: 'set-card-title' }, t('settings.about')),
      h(
        'div',
        { class: 'about-brand' },
        h('div', { class: 'about-logo', html: LOGO_SVG }),
        h('div', null, h('div', { class: 'about-name display' }, t('title.name')), h('div', { class: 'about-ver num' }, t('shell.version', { v: version }))),
      ),
      h('p', { class: 'about-text' }, t('settings.aboutBody')),
      h('ul', { class: 'about-list' }, h('li', null, ico('check'), t('settings.original')), h('li', null, ico('check'), t('settings.fonts'))),
      button(t('settings.licenses'), openLicenses, { cls: 'btn-ghost about-lic', icon: 'help', attrs: { 'data-action': 'licenses' } }),
    );

    wrap.append(
      h('header', { class: 'settings-head' }, iconButton('chevron-left', t('shell.back'), onClose), h('h1', { class: 'settings-title' }, ico('settings'), t('settings.title'))),
      h('div', { class: 'settings-body' }, h('div', { class: 'settings-col' }, general), h('div', { class: 'settings-col' }, data, about)),
    );
  };

  render();
  const offLang = onLangChange(render);
  return () => {
    offLang();
    wrap.remove();
  };
}

/** Show settings above the current screen (e.g. from the in-game menu). */
export function openSettingsOverlay(): void {
  let cleanup: (() => void) | null = null;
  openDialog(
    (close) => {
      const host = h('div', { class: 'settings-overlay' });
      cleanup = mountSettings(host, close);
      return host;
    },
    { cls: 'overlay-backdrop', dismissable: false, onClose: () => cleanup?.() },
  );
}

registerScreen('settings', (root, props) => {
  setBackTarget(props.back ?? 'title');
  const screen = h('div', { class: 'screen settings-screen safe-pad' });
  root.append(screen);
  return mountSettings(screen, () => goBackTo(props.back ?? 'title'));
});
