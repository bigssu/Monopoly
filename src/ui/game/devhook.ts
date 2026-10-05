/**
 * Dev/test hook: `window.__lotAndRoll` (only with `import.meta.env.DEV` or `?dev=1`).
 *   startGame(settings, seed) · getState() · dispatch(action) · setAnimSpeed(x)
 *   + autoStep() · whenIdle() · setPromptTimer(sec|null) · isBusy() · demoSettings(n, cpu)
 *   + loadState(state) (resume an arbitrary, e.g. hand-crafted, state) · suggest() (the CPU
 *     policy's choice for whoever must act — e2e tests click the matching on-screen control)
 *   + setLang('ko' | 'en')
 *   + cpuHand() (the CPU hand's press log; freeze(true) holds every hand at its press until release())
 */
import { chooseAction, defaultPlayers, defaultSettings, deepClone, legalActions, type Action, type GameState, type Settings } from '@/engine';
import { setLang, type Lang } from '@/i18n';
import { showScreen } from '@/ui/router';
import { activeFrameTicks, setAnimSpeed, setPace, setTurnRest, setManualClock, stepClock } from '@/ui/fx/time';
import type { FxStats, PresetName, PresetParams } from '@/ui/fx/vfx';
import type { GameController } from './controller';
import { isDevHook } from './util';
import { handDev, type HandRecord } from '@/ui/stage/CpuHand';

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
  /** VFX engine stats of the running game (null off the game screen). */
  fx(): FxStats | null;
  /** Play a VFX preset on the live board; resolves at its block frame. */
  playFx<N extends PresetName>(name: N, params: PresetParams<N>): Promise<void>;
  /** Registered 30 Hz clock callbacks (0 = idle). */
  activeTicks(): number;
  /** Hand-driven animation clock (deterministic in-game filmstrips): on / off. */
  manualClock(on: boolean): void;
  /** Advance the manual clock `n` frames (microtasks and timers flushed after each). */
  stepFrames(n: number): Promise<void>;
  /** The money stage (docs/MONEY-EVENTS.md §11): live, scene clock (ms), kept, scenes run, coins in flight. */
  money(): { live: boolean; t: number; kept: boolean; scenes: number; flying: number; tier: string; scale: number; tilt: boolean; camera: boolean; source: string; budgetMB: number; auto: string; health: string[]; log: string[] } | null;
  /** The CPU hand: presses so far, and a switch that holds each hand at its press. */
  cpuHand(): { log: HandRecord[]; clear(): void; freeze(on: boolean): void; release(): void; frozen(): boolean };
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
    // Tests that drive the clock keep the original pace (holds unstretched, no turn rest).
    setAnimSpeed: (x) => {
      setPace(1);
      setTurnRest(0);
      setAnimSpeed(x);
    },
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
    fx: () => current?.view.vfx.stats() ?? null,
    playFx: (name, params) => Promise.resolve(current?.view.vfx.play(name, params)),
    activeTicks: () => activeFrameTicks(),
    manualClock: (on) => setManualClock(on),
    stepFrames: async (n) => {
      for (let k = 0; k < n; k++) {
        stepClock(1);
        await new Promise((r) => setTimeout(r, 0));
      }
    },
    money: () => {
      const st = current?.view.money;
      const info = current?.view.moneyInfo();
      return st && info ? { live: st.live, t: Math.round(st.clock?.t ?? 0), kept: st.kept, scenes: st.stats.scenes, flying: st.coins.flying, ...info } : null;
    },
    cpuHand: () => ({
      log: handDev?.log ?? [],
      clear: () => {
        if (handDev) handDev.log.length = 0;
      },
      freeze: (on) => {
        if (!handDev) return;
        handDev.freeze = on;
        if (!on) handDev.release?.();
      },
      release: () => {
        const r = handDev?.release;
        if (handDev) handDev.release = null;
        r?.();
      },
      // A hand is being held at its press right now.
      frozen: () => !!handDev?.release,
    }),
  };
}
