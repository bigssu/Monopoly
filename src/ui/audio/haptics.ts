/**
 * Haptics facade: Capacitor Haptics on device, navigator.vibrate on the web, no-op otherwise.
 * Implemented by the shell agent; the game-screen agent only calls `haptic(kind)`.
 */
export type HapticKind = 'tick' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

export interface Haptics {
  trigger(kind: HapticKind): void;
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
}

let impl: Haptics = { trigger() {}, setEnabled() {}, isEnabled: () => true };

export function haptic(kind: HapticKind): void {
  impl.trigger(kind);
}

export const haptics: Haptics = {
  trigger: (k) => impl.trigger(k),
  setEnabled: (on) => impl.setEnabled(on),
  isEnabled: () => impl.isEnabled(),
};

export function installHaptics(next: Haptics): void {
  impl = next;
}
