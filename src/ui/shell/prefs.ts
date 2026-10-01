/**
 * App preferences (language, sound, haptics, volume, prompt timer, last setup, battery saver, effects quality).
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
}

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
  return { lang: detectLang(), sound: true, haptics: true, volume: 0.8, promptTimer: 15, lastSetup: null, batterySaver: true, fxQuality: 'low' };
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
