/**
 * Haptics: Capacitor Haptics on device, `navigator.vibrate` on the web, silent elsewhere. Off while
 * the vibration setting is off (main.ts applyPrefs → `setHapticsEnabled`).
 */
import { isNative, nativeHaptics } from '@/ui/shell/capacitor';

export type HapticKind = 'tick' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

type HapticsModule = typeof import('@capacitor/haptics');

/** Web vibration patterns (ms). */
const PATTERNS: Record<HapticKind, number | number[]> = {
  tick: 6,
  light: 12,
  medium: 24,
  heavy: 40,
  success: [14, 60, 22],
  warning: [26, 80, 26],
  error: [40, 60, 40, 60, 40],
};

let selectionStarted = false;
/** The plugin call for each kind. */
const NATIVE: Record<HapticKind, (m: HapticsModule) => Promise<void>> = {
  tick: async ({ Haptics: H }) => {
    if (!selectionStarted) {
      selectionStarted = true;
      await H.selectionStart();
    }
    await H.selectionChanged();
  },
  light: ({ Haptics: H, ImpactStyle }) => H.impact({ style: ImpactStyle.Light }),
  medium: ({ Haptics: H, ImpactStyle }) => H.impact({ style: ImpactStyle.Medium }),
  heavy: ({ Haptics: H, ImpactStyle }) => H.impact({ style: ImpactStyle.Heavy }),
  success: ({ Haptics: H, NotificationType }) => H.notification({ type: NotificationType.Success }),
  warning: ({ Haptics: H, NotificationType }) => H.notification({ type: NotificationType.Warning }),
  error: ({ Haptics: H, NotificationType }) => H.notification({ type: NotificationType.Error }),
};

let enabled = true;

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

export function haptic(kind: HapticKind): void {
  if (!enabled) return;
  if (isNative()) {
    void nativeHaptics().then(async (m) => {
      if (!m) return;
      try {
        await NATIVE[kind](m);
      } catch {
        /* device without a vibrator */
      }
    });
    return;
  }
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(PATTERNS[kind]);
  } catch {
    /* not allowed before user activation */
  }
}
