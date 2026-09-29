/**
 * Screen router. Each screen is a factory that mounts into the root and returns an unmount fn.
 *
 *   registerScreen('title', (root, props) => { ...; return () => cleanup });
 *   showScreen('game', { settings, seed })
 */
import type { GameState, Settings } from '@/engine';

export interface ScreenProps {
  title: Record<string, never>;
  setup: { resume?: false };
  game: { settings: Settings; seed: number } | { resume: GameState };
  rules: { back?: ScreenName };
  settings: { back?: ScreenName };
  result: { state: GameState };
}
export type ScreenName = keyof ScreenProps;
export type ScreenFactory<N extends ScreenName> = (root: HTMLElement, props: ScreenProps[N]) => () => void;

const screens = new Map<ScreenName, ScreenFactory<ScreenName>>();
let unmount: (() => void) | null = null;
let currentName: ScreenName | null = null;
const listeners = new Set<(name: ScreenName) => void>();

export function registerScreen<N extends ScreenName>(name: N, factory: ScreenFactory<N>): void {
  screens.set(name, factory as ScreenFactory<ScreenName>);
}

export function showScreen<N extends ScreenName>(name: N, props: ScreenProps[N]): void {
  const factory = screens.get(name);
  if (!factory) throw new Error(`screen not registered: ${name}`);
  const root = document.getElementById('app');
  if (!root) throw new Error('#app missing');
  unmount?.();
  root.innerHTML = '';
  root.dataset.screen = name;
  unmount = factory(root, props);
  currentName = name;
  for (const l of listeners) l(name);
}

export function currentScreen(): ScreenName | null {
  return currentName;
}

export function onScreenChange(fn: (name: ScreenName) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
