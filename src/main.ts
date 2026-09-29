/**
 * Lot & Roll — app boot: styles, strings, screens, audio/haptics, preferences, native bridges.
 */
import '@/styles/index.css';
import '@/i18n/shell';
import '@/i18n/game';
import '@/ui/screens/Title';
import '@/ui/screens/Setup';
import '@/ui/screens/Rules';
import '@/ui/screens/SettingsScreen';
import '@/ui/screens/Game';
import '@/ui/screens/Result';

import { createGame, defaultPlayers, defaultSettings } from '@/engine';
import { setLang, t } from '@/i18n';
import { haptics, installHaptics } from '@/ui/audio/haptics';
import { createHaptics } from '@/ui/audio/nativeHaptics';
import { installSfx, sfx } from '@/ui/audio/sfx';
import { SynthSfx } from '@/ui/audio/synth';
import { currentScreen, showScreen } from '@/ui/router';
import { exitApp, hideNativeSplash, initNative, isNative } from '@/ui/shell/capacitor';
import { toast } from '@/ui/shell/dialog';
import { handleBack } from '@/ui/shell/nav';
import { calibrateFrameGrid, installCssAnimationQuantizer, setFrameRate } from '@/ui/fx/time';
import { clearSavedGame, loadSavedGame, SAVE_BACKUP_KEY, SAVE_KEY, saveGame } from '@/ui/shell/persist';
import { prefs, PREFS_KEY, type Prefs } from '@/ui/shell/prefs';
import { kvFlush, kvHydrate } from '@/ui/shell/storage';

/** The faces declared in public/fonts/fonts.css (one subset each). */
const APP_FONTS = ['400 16px "Jua"', '400 16px "Noto Sans KR"', '700 16px "Noto Sans KR"', '900 16px "Noto Sans KR"'];

function loadAppFonts(): Promise<unknown> {
  const fonts = document.fonts;
  if (!fonts?.load) return Promise.resolve();
  return Promise.all(APP_FONTS.map((f) => fonts.load(f, '가A1').catch(() => undefined)));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | void> {
  return Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))]);
}

const synth = new SynthSfx();

function applyPrefs(p: Readonly<Prefs>): void {
  setLang(p.lang);
  synth.setMuted(!p.sound);
  synth.setVolume(p.volume);
  haptics.setEnabled(p.haptics);
  setFrameRate(p.batterySaver ? 30 : 60);
}

let lastBackAt = 0;
function onBack(): void {
  if (handleBack()) return;
  // On the title screen: press twice to leave the app.
  const now = Date.now();
  if (now - lastBackAt < 2000) void exitApp();
  else {
    lastBackAt = now;
    if (isNative()) toast(t('shell.exitHint'));
  }
}

function suspendAll(): void {
  synth.suspend();
  void kvFlush();
}

function hideSplash(): void {
  const splash = document.getElementById('splash');
  if (!splash) return;
  requestAnimationFrame(() => {
    splash.classList.add('is-hidden');
    setTimeout(() => splash.remove(), 500);
  });
}

async function boot(): Promise<void> {
  // Device: restore anything the WebView evicted from localStorage (bounded wait).
  await withTimeout(kvHydrate([PREFS_KEY, SAVE_KEY, SAVE_BACKUP_KEY]), 800);
  prefs.reload();

  installCssAnimationQuantizer();
  calibrateFrameGrid();
  installSfx(synth);
  installHaptics(createHaptics(prefs.get().haptics));
  applyPrefs(prefs.get());
  prefs.onChange((next) => applyPrefs(next));

  // Web Audio needs a user gesture outside the Android WebView; resume on every return.
  window.addEventListener('pointerdown', () => sfx.unlock(), { capture: true, passive: true });
  window.addEventListener('keydown', () => sfx.unlock(), { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) suspendAll();
    else sfx.unlock();
  });
  window.addEventListener('pagehide', () => void kvFlush());

  // Escape = back (desktop/dev); the Android back button goes through the same path.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) onBack();
  });
  void initNative({
    onBack,
    onPause: suspendAll,
    onResume: () => sfx.unlock(),
  });

  // Load the four app faces (preloaded by index.html) before the first screen renders: a font
  // swap later would re-shape and re-lay out every text node (and the board's SVG labels).
  await withTimeout(loadAppFonts(), 1200);

  showScreen('title', {});
  hideSplash();
  void hideNativeSplash();

  if (new URLSearchParams(location.search).get('dev') === '1') {
    (window as unknown as Record<string, unknown>).__lotAndRollShell = {
      showScreen,
      currentScreen,
      prefs,
      sfx,
      persist: { saveGame, loadSavedGame, clearSavedGame },
      /** Save a small sample game (for testing the Continue button). */
      makeSampleSave(players = 3, round = 6) {
        const state = createGame(defaultSettings({ players: defaultPlayers(players) }), 7);
        state.round = round;
        saveGame(state);
      },
    };
  }
}

void boot().catch((e) => {
  console.error('[boot]', e);
  hideSplash();
  // launchAutoHide is off: without this a failed boot would leave the native splash up forever.
  void hideNativeSplash();
});
