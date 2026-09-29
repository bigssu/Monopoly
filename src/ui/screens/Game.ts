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
import { flushAll, instant } from '@/ui/fx/time';
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

  let leaving = false;
  const ctrl = new GameController({
    view,
    state,
    onGameOver: (s) => {
      clearSavedGame();
      window.setTimeout(() => {
        if (!leaving) showScreen('result', { state: s });
      }, instant() ? 0 : 500);
    },
  });
  ctrl.timerOverride = currentTimerOverride();
  setCurrentController(ctrl);

  const menu = new GameMenu({
    onOpen: () => ctrl.pause(),
    onClose: () => ctrl.resume(),
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
    ctrl.pause();
    open();
    window.clearInterval(overlayPoll);
    overlayPoll = window.setInterval(() => {
      if (document.querySelector(selector)) return;
      window.clearInterval(overlayPoll);
      if (!menu.isOpen()) ctrl.resume();
    }, 250);
  }

  view.onPortraitChange = (portrait) => {
    if (portrait) ctrl.pause();
    else if (!menu.isOpen()) ctrl.resume();
  };
  if (view.layout?.portrait) ctrl.pause();

  view.menuSlot.append(menu.button);
  view.root.append(menu.overlay);

  const onBack = (e: Event): void => {
    e.preventDefault();
    menu.toggle();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') menu.toggle();
  };
  window.addEventListener('lotandroll:back', onBack);
  window.addEventListener('keydown', onKey);

  if (fresh) saveGame(state);
  void ctrl.start(fresh);

  return () => {
    leaving = true;
    window.clearInterval(overlayPoll);
    window.removeEventListener('lotandroll:back', onBack);
    window.removeEventListener('keydown', onKey);
    ctrl.dispose();
    view.dispose();
    flushAll();
    setCurrentController(null);
  };
});

installDevHook();

// Dev: `/?dev=1#game` starts a seeded 4-CPU demo game as soon as the app has booted
// (after the shell's first screen), or after 2.5 s if nothing else mounts a screen.
if (isDevHook() && location.hash === '#game') {
  let started = false;
  const startDemo = (): void => {
    if (started) return;
    started = true;
    off();
    window.setTimeout(() => showScreen('game', { settings: demoSettings(4, true), seed: 20260929 }), 0);
  };
  const off = onScreenChange((name) => {
    if (name !== 'game') startDemo();
  });
  window.setTimeout(() => {
    if (!document.getElementById('app')?.dataset.screen) startDemo();
  }, 2500);
}
