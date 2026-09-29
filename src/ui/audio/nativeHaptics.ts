/**
 * Haptics implementation: Capacitor Haptics on device, `navigator.vibrate` on the web,
 * silent no-op elsewhere. Installed by main.ts via `installHaptics(createHaptics())`.
 */
import type { HapticKind, Haptics } from './haptics';
import { isNative, nativeHaptics } from '@/ui/shell/capacitor';

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

export function createHaptics(enabled = true): Haptics {
  let on = enabled;
  let selectionStarted = false;

  const native = (kind: HapticKind) => {
    void nativeHaptics().then(async (m) => {
      if (!m) return;
      const { Haptics: H, ImpactStyle, NotificationType } = m;
      try {
        switch (kind) {
          case 'tick':
            if (!selectionStarted) {
              selectionStarted = true;
              await H.selectionStart();
            }
            await H.selectionChanged();
            break;
          case 'light':
            await H.impact({ style: ImpactStyle.Light });
            break;
          case 'medium':
            await H.impact({ style: ImpactStyle.Medium });
            break;
          case 'heavy':
            await H.impact({ style: ImpactStyle.Heavy });
            break;
          case 'success':
            await H.notification({ type: NotificationType.Success });
            break;
          case 'warning':
            await H.notification({ type: NotificationType.Warning });
            break;
          case 'error':
            await H.notification({ type: NotificationType.Error });
            break;
        }
      } catch {
        /* device without a vibrator */
      }
    });
  };

  const web = (kind: HapticKind) => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(PATTERNS[kind]);
    } catch {
      /* not allowed before user activation */
    }
  };

  return {
    trigger(kind) {
      if (!on) return;
      if (isNative()) native(kind);
      else web(kind);
    },
    setEnabled(v) {
      on = v;
    },
    isEnabled: () => on,
  };
}
