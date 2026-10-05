/**
 * The game screen: `showScreen('game', { settings, seed })` or `showScreen('game', { resume })`.
 */
import '@/i18n/game';
import { createGame, type GameState } from '@/engine';
import { onScreenChange, registerScreen, showScreen } from '@/ui/router';
import { clearSavedGame, saveGame } from '@/ui/shell/persist';
import { go } from '@/ui/shell/nav';
import { openRulesOverlay } from '@/ui/screens/Rules';
import { openSettingsOverlay } from '@/ui/screens/SettingsScreen';
import { flushAll, gridTimeout, instant } from '@/ui/fx/time';
import { GameController } from '@/ui/game/controller';
import { GameMenu } from '@/ui/game/menu';
import { GameView } from '@/ui/game/view';
import { currentTimerOverride, demoSettings, installDevHook, setCurrentController } from '@/ui/game/devhook';
import { isDevHook } from '@/ui/game/util';

registerScreen('game', (root, props) => {
  let state: GameState;
  let fresh: boolean;
  if ('resume' in props) {
    state = props.resume;
    fresh = false;
  } else {
    // Setup already randomized who starts (turn order = settings.players order).
    state = createGame(props.settings, props.seed);
    fresh = true;
  }
  const view = new GameView(state);
  view.mount(root);
  // FX atlas in idle time after the game is up (not part of boot; a play() before it loads waits for it).
  const cancelVfxPreload = gridTimeout(() => void view.vfx.preload(), 600);

  let leaving = false;
  const ctrl = new GameController({
    view,
    state,
    onGameOver: (s) => {
      clearSavedGame();
      gridTimeout(() => {
        if (!leaving) showScreen('result', { state: s });
      }, instant() ? 0 : 500);
    },
  });
  ctrl.timerOverride = currentTimerOverride();
  setCurrentController(ctrl);

  /** Shell overlay (rules / settings) currently open above the game. */
  let overlayOpen = false;
  /** Run only while nothing covers the table: menu, overlay, portrait hint or a hidden app. */
  function syncPause(): void {
    if (menu.isOpen() || overlayOpen || view.layout?.portrait || document.hidden) ctrl.pause();
    else ctrl.resume();
  }

  const menu = new GameMenu({
    onOpen: () => ctrl.pause(),
    onClose: () => syncPause(),
    onRules: () => overlay(openRulesOverlay, '.rules-overlay'),
    onSettings: () => overlay(openSettingsOverlay, '.settings-overlay'),
    onSaveQuit: () => {
      saveGame(ctrl.state);
      leaving = true;
      go('title', {});
    },
    onResign: () => {
      clearSavedGame();
      leaving = true;
      go('title', {});
    },
  });
  /** Shell overlays sit above the running game; keep it paused until they close. */
  let overlayPoll = 0;
  function overlay(open: () => void, selector: string): void {
    overlayOpen = true;
    ctrl.pause();
    open();
    window.clearInterval(overlayPoll);
    overlayPoll = window.setInterval(() => {
      if (document.querySelector(selector)) return;
      window.clearInterval(overlayPoll);
      overlayOpen = false;
      syncPause();
    }, 250);
  }

  view.onPortraitChange = () => syncPause();
  // App in the background (Android pause / hidden tab): no CPU moves or prompt auto-picks.
  const onVisibility = (): void => syncPause();
  document.addEventListener('visibilitychange', onVisibility);
  if (view.layout?.portrait || document.hidden) ctrl.pause();

  ctrl.onPauseRequest = () => menu.show(true);
  view.menuSlot.append(menu.button, menu.pauseButton);
  view.root.append(menu.overlay);

  const onBack = (e: Event): void => {
    e.preventDefault();
    menu.toggle();
  };
  // Escape reaches `onBack` through the shell (main.ts → handleBack), which first closes any open
  // rules/settings overlay; a second Escape listener here would re-open the menu on that press.
  window.addEventListener('lotandroll:back', onBack);

  if (fresh) saveGame(state);
  void ctrl.start(fresh);

  // Dev only (`npm run dev` → /?dev=1&fxdemo=1): "연출 미리보기" panel over the live board.
  let unmountFxDemo: (() => void) | null = null;
  if (import.meta.env.DEV && FX_DEMO) {
    void import('@/ui/game/fxdemo').then((m) => {
      if (!leaving) unmountFxDemo = m.mountFxDemo(view, () => ctrl.state);
    });
  }

  return () => {
    leaving = true;
    cancelVfxPreload();
    window.clearInterval(overlayPoll);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('lotandroll:back', onBack);
    unmountFxDemo?.();
    ctrl.dispose();
    view.dispose();
    flushAll();
    setCurrentController(null);
  };
});

installDevHook();

/** `?fxdemo=1` (dev server only): VFX preview panel + a 4-human game to try it on. */
const FX_DEMO = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('fxdemo') === '1';

// Dev: `/?dev=1#game` starts a seeded 4-CPU demo game as soon as the app has booted
// (after the shell's first screen), or after 2.5 s if nothing else mounts a screen.
if (isDevHook() && (location.hash === '#game' || FX_DEMO)) {
  let started = false;
  const startDemo = (): void => {
    if (started) return;
    started = true;
    off();
    window.setTimeout(() => {
      // The preview needs a quiet table: 4 humans, no prompt timer.
      if (FX_DEMO) window.__lotAndRoll?.setPromptTimer(0);
      showScreen('game', { settings: demoSettings(4, !FX_DEMO), seed: 20260929 });
    }, 0);
  };
  const off = onScreenChange((name) => {
    if (name !== 'game') startDemo();
  });
  window.setTimeout(() => {
    if (!document.getElementById('app')?.dataset.screen) startDemo();
  }, 2500);
}
