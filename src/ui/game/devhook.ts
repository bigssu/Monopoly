/**
 * Dev/test hook: `window.__lotAndRoll` (only with `import.meta.env.DEV` or `?dev=1`).
 *   startGame(settings, seed) · getState() · dispatch(action) · setAnimSpeed(x)
 *   + autoStep() · whenIdle() · setPromptTimer(sec|null) · isBusy() · demoSettings(n, cpu)
 *   + loadState(state) (resume an arbitrary, e.g. hand-crafted, state) · suggest() (the CPU
 *     policy's choice for whoever must act — e2e tests click the matching on-screen control)
 *   + setLang('ko' | 'en')
 */
import { chooseAction, defaultPlayers, defaultSettings, deepClone, legalActions, type Action, type GameState, type Settings } from '@/engine';
import { setLang, type Lang } from '@/i18n';
import { showScreen } from '@/ui/router';
import { setAnimSpeed } from '@/ui/fx/time';
import type { GameController } from './controller';
import { isDevHook } from './util';

let current: GameController | null = null;

export function setCurrentController(c: GameController | null): void {
  current = c;
}

export function demoSettings(n = 4, cpu = true): Settings {
  return defaultSettings({ players: defaultPlayers(n, { cpu }) });
}

export interface LotAndRollHook {
  startGame(settings: Settings, seed: number): void;
  getState(): GameState | null;
  dispatch(action: Action): Promise<boolean>;
  setAnimSpeed(x: number): void;
  autoStep(): Promise<boolean>;
  whenIdle(): Promise<void>;
  isBusy(): boolean;
  setPromptTimer(sec: number | null): void;
  demoSettings(n?: number, cpu?: boolean): Settings;
  screen(): string | undefined;
  loadState(state: GameState): void;
  suggest(): Action | null;
  legal(): Action[];
  setLang(lang: Lang): void;
}

declare global {
  interface Window {
    __lotAndRoll?: LotAndRollHook;
  }
}

let timerOverride: number | null = null;

export function currentTimerOverride(): number | null {
  return timerOverride;
}

export function installDevHook(): void {
  if (!isDevHook() || window.__lotAndRoll) return;
  window.__lotAndRoll = {
    startGame: (settings, seed) => showScreen('game', { settings, seed }),
    getState: () => current?.state ?? null,
    dispatch: (a) => current?.dispatch(a) ?? Promise.resolve(false),
    setAnimSpeed,
    autoStep: () => current?.autoStep() ?? Promise.resolve(false),
    whenIdle: () => current?.whenIdle() ?? Promise.resolve(),
    isBusy: () => current?.isBusy() ?? false,
    setPromptTimer: (sec) => {
      timerOverride = sec;
      if (current) current.timerOverride = sec;
    },
    demoSettings,
    screen: () => document.getElementById('app')?.dataset.screen,
    loadState: (state) => showScreen('game', { resume: deepClone(state) }),
    suggest: () => {
      const s = current?.state;
      if (!s || s.phase.kind === 'gameOver') return null;
      return chooseAction(s, s.phase.playerId);
    },
    legal: () => {
      const s = current?.state;
      return s && s.phase.kind !== 'gameOver' ? legalActions(s) : [];
    },
    setLang,
  };
}
