/**
 * Key/value storage: synchronous localStorage (fast boot, web build) mirrored to
 * Capacitor Preferences (Android SharedPreferences) on device, which survives WebView
 * storage eviction (docs/research/03-tech-stack-android-research.md §7).
 *
 * localStorage is always written first, so when both exist it is the newest copy;
 * `hydrate()` only restores keys that localStorage lost.
 */
import { isNative, nativePreferences } from './capacitor';

const memory = new Map<string, string>();
const pending = new Map<string, string | null>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function ls(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function kvGet(key: string): string | null {
  const s = ls();
  if (s) {
    try {
      const v = s.getItem(key);
      if (v !== null) return v;
    } catch {
      /* fall through to memory */
    }
  }
  return memory.get(key) ?? null;
}

export function kvSet(key: string, value: string, opts: { debounceMs?: number } = {}): void {
  memory.set(key, value);
  const s = ls();
  if (s) {
    try {
      s.setItem(key, value);
    } catch {
      /* quota or disabled: memory + native copy still work */
    }
  }
  queueNative(key, value, opts.debounceMs ?? 0);
}

export function kvRemove(key: string): void {
  memory.delete(key);
  const s = ls();
  if (s) {
    try {
      s.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  queueNative(key, null, 0);
}

function queueNative(key: string, value: string | null, debounceMs: number): void {
  if (!isNative()) return;
  pending.set(key, value);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void kvFlush(), debounceMs);
}

/** Write pending native mirrors now (call on app pause / page hide). */
export async function kvFlush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!pending.size) return;
  const batch = [...pending];
  pending.clear();
  const prefs = await nativePreferences();
  if (!prefs) return;
  await Promise.all(
    batch.map(([key, value]) =>
      (value === null ? prefs.remove({ key }) : prefs.set({ key, value })).catch(() => undefined),
    ),
  );
}

/** Restore keys that localStorage lost from the native store (boot, device only). */
export async function kvHydrate(keys: string[]): Promise<void> {
  if (!isNative()) return;
  const prefs = await nativePreferences();
  if (!prefs) return;
  await Promise.all(
    keys.map(async (key) => {
      if (kvGet(key) !== null) return;
      try {
        const { value } = await prefs.get({ key });
        if (value !== null && value !== undefined) {
          memory.set(key, value);
          const s = ls();
          try {
            s?.setItem(key, value);
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
    }),
  );
}
