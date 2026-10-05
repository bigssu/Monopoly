/**
 * App preferences (language, sound, haptics, volume, prompt timer, last setup, battery saver, effects quality, game pace, turn pause, dealer).
 *
 *   prefs.get().sound
 *   prefs.set({ volume: 0.6 })
 *   const off = prefs.onChange((next, prev) => …)
 */
import type { Lang } from '@/i18n';
import { kvGet, kvSet } from './storage';
import { normalizeDraft, type SetupDraft } from './setupModel';

export interface Prefs {
  lang: Lang;
  sound: boolean;
  haptics: boolean;
  /** 0..1 */
  volume: number;
  /** Default prompt timer (seconds, 0 = off) — prefills Setup and applies in-game. */
  promptTimer: 0 | 15 | 30;
  /** The last Setup screen configuration (prefills the next game). */
  lastSetup: SetupDraft | null;
  /** Battery saver: animations produce ~30 distinct frames per second instead of 60. */
  batterySaver: boolean;
  /** Effects quality (docs/VFX.md §15.4): auto adapts to the device; off = static highlight + sound. */
  fxQuality: FxQualityPref;
  /** Game pace: how long holds/reading pauses last (1 = original, 2 = twice as long). */
  gamePace: GamePacePref;
  /** Rest after each turn before the next player (ms). */
  turnPause: TurnPausePref;
  /** How much the dealer talks (voice in Korean, subtitles in English). */
  dealer: DealerPref;
  /** Background music on/off (follows `sound` and `volume` too). */
  music: boolean;
  /**
   * The player turned the canvas effects on in the Android app (Settings → 연출 품질). Off by
   * default there: some WebViews draw the effect canvases as opaque white boxes (see `fxQualityOn`).
   */
  fxNative: boolean;
  /** Animations: full, or reduced (no movement, same timing). The device setting is not read. */
  motion: MotionPref;
}

export const MOTION_PREFS = ['full', 'reduced'] as const;
export type MotionPref = (typeof MOTION_PREFS)[number];

/**
 * The effects quality that applies on this platform. In the Android app the canvas effects stay
 * off until the player chooses a quality there: on some devices' WebView the effect canvases show
 * as white rectangles flashing over the table (a tablet report, twice). Dice, token moves, toasts
 * and every beat are DOM motion and are not affected; 'off' still plays each effect's sound and a
 * static highlight.
 */
export function fxQualityOn(p: Pick<Prefs, 'fxQuality' | 'fxNative'>, native: boolean): FxQualityPref {
  return native && !p.fxNative ? 'off' : p.fxQuality;
}

export const DEALER_PREFS = ['off', 'min', 'normal', 'full'] as const;
export type DealerPref = (typeof DEALER_PREFS)[number];

export const TURN_PAUSES = [1000, 1500, 2000, 3000] as const;
export type TurnPausePref = (typeof TURN_PAUSES)[number];

export const GAME_PACES = [3, 2.5, 2, 1.5, 1] as const;
export type GamePacePref = (typeof GAME_PACES)[number];

export type FxQualityPref = 'auto' | 'high' | 'low' | 'off';

export const PREFS_KEY = 'lotandroll:prefs:v1';

type Listener = (next: Readonly<Prefs>, prev: Readonly<Prefs>) => void;

function detectLang(): Lang {
  try {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    const first = (langs[0] ?? 'ko').toLowerCase();
    return first.startsWith('ko') ? 'ko' : 'en';
  } catch {
    return 'ko';
  }
}

export function defaultPrefs(): Prefs {
  return { lang: detectLang(), sound: true, haptics: true, volume: 0.8, promptTimer: 15, lastSetup: null, batterySaver: true, fxQuality: 'low', gamePace: 2, turnPause: 1500, dealer: 'normal', music: true, fxNative: false, motion: 'full' };
}

function sanitize(raw: unknown): Prefs {
  const d = defaultPrefs();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Prefs>;
  return {
    lang: r.lang === 'ko' || r.lang === 'en' ? r.lang : d.lang,
    sound: typeof r.sound === 'boolean' ? r.sound : d.sound,
    haptics: typeof r.haptics === 'boolean' ? r.haptics : d.haptics,
    volume: typeof r.volume === 'number' && Number.isFinite(r.volume) ? Math.min(1, Math.max(0, r.volume)) : d.volume,
    promptTimer: r.promptTimer === 0 || r.promptTimer === 15 || r.promptTimer === 30 ? r.promptTimer : d.promptTimer,
    lastSetup: r.lastSetup ? normalizeDraft(r.lastSetup) : null,
    batterySaver: typeof r.batterySaver === 'boolean' ? r.batterySaver : d.batterySaver,
    fxQuality: r.fxQuality === 'auto' || r.fxQuality === 'high' || r.fxQuality === 'low' || r.fxQuality === 'off' ? r.fxQuality : d.fxQuality,
    gamePace: GAME_PACES.includes(r.gamePace as GamePacePref) ? (r.gamePace as GamePacePref) : d.gamePace,
    turnPause: TURN_PAUSES.includes(r.turnPause as TurnPausePref) ? (r.turnPause as TurnPausePref) : d.turnPause,
    dealer: DEALER_PREFS.includes(r.dealer as DealerPref) ? (r.dealer as DealerPref) : d.dealer,
    music: typeof r.music === 'boolean' ? r.music : d.music,
    fxNative: r.fxNative === true,
    motion: MOTION_PREFS.includes(r.motion as MotionPref) ? (r.motion as MotionPref) : d.motion,
  };
}

function read(): Prefs {
  const raw = kvGet(PREFS_KEY);
  if (!raw) return defaultPrefs();
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return defaultPrefs();
  }
}

let state: Prefs | null = null;
const listeners = new Set<Listener>();

export const prefs = {
  get(): Readonly<Prefs> {
    state ??= read();
    return state;
  },
  set(partial: Partial<Prefs>): void {
    const prev = prefs.get();
    const next = sanitize({ ...prev, ...partial });
    state = next;
    kvSet(PREFS_KEY, JSON.stringify(next));
    for (const l of listeners) l(next, prev);
  },
  onChange(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Re-read from storage (after native hydration at boot). */
  reload(): void {
    state = read();
  },
};
