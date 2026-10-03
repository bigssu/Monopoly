/**
 * Navigation helpers on top of the router: 260 ms cross-fade between screens and the
 * shared "back" behaviour (hardware back button, Escape key, on-screen back buttons).
 */
import { currentScreen, showScreen, type ScreenName, type ScreenProps } from '@/ui/router';
import { hasSavedGame, loadSavedGame } from './persist';
import { closeTopDialog } from './dialog';

const FADE_MS = 260;

function reducedMotion(): boolean {
  if (document.documentElement.classList.contains('native-webview')) return true;
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** `showScreen` with a snapshot of the old screen cross-fading out above the new one. */
export function go<N extends ScreenName>(name: N, props: ScreenProps[N]): void {
  const app = document.getElementById('app');
  if (app && app.firstElementChild && !reducedMotion()) {
    document.querySelectorAll('.screen-ghost').forEach((g) => g.remove());
    const ghost = document.createElement('div');
    ghost.className = 'screen-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    // Clone rendered nodes only (no listeners), then let it fade.
    for (const child of Array.from(app.children)) ghost.appendChild(child.cloneNode(true));
    ghost.dataset.screen = app.dataset.screen ?? '';
    document.body.appendChild(ghost);
    setTimeout(() => ghost.remove(), FADE_MS + 40);
  }
  showScreen(name, props);
}

/** Leave a secondary screen (rules/settings) to where it was opened from. */
export function goBackTo(back: ScreenName | undefined): void {
  switch (back) {
    case 'setup':
      go('setup', {});
      return;
    case 'game': {
      const state = hasSavedGame() ? loadSavedGame() : null;
      if (state) go('game', { resume: state });
      else go('title', {});
      return;
    }
    case 'rules':
      go('rules', {});
      return;
    case 'settings':
      go('settings', {});
      return;
    default:
      go('title', {});
  }
}

let backTarget: ScreenName | undefined;
/** Screens call this on mount so the hardware back button knows where to go. */
export function setBackTarget(target: ScreenName | undefined): void {
  backTarget = target;
}

/**
 * Hardware back / Escape. Returns false when the app should exit (on the title screen).
 * In the game, a cancelable `lotandroll:back` event goes to the game screen instead.
 */
export function handleBack(): boolean {
  if (closeTopDialog()) return true;
  const screen = currentScreen();
  switch (screen) {
    case 'game':
      window.dispatchEvent(new CustomEvent('lotandroll:back', { cancelable: true }));
      return true;
    case 'title':
    case null:
      return false;
    case 'result':
      go('title', {});
      return true;
    default:
      goBackTo(backTarget);
      return true;
  }
}
