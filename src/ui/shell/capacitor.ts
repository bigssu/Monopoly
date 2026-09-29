/**
 * Every native (Capacitor) bridge the app uses, behind `isNative()` guards and dynamic
 * imports so the plain web build never touches a plugin.
 *
 * Android project setup (manifest orientation, immersive mode) is done by the packaging
 * step; this module only calls the JS APIs.
 */
import { Capacitor } from '@capacitor/core';
import type { PreferencesPlugin } from '@capacitor/preferences';

export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

type HapticsModule = typeof import('@capacitor/haptics');
let hapticsP: Promise<HapticsModule | null> | null = null;
/** The whole plugin module (for its enums), or null on the web. */
export function nativeHaptics(): Promise<HapticsModule | null> {
  if (!isNative()) return Promise.resolve(null);
  hapticsP ??= import('@capacitor/haptics').catch(() => null);
  return hapticsP;
}

let prefsP: Promise<PreferencesPlugin | null> | null = null;
export function nativePreferences(): Promise<PreferencesPlugin | null> {
  if (!isNative()) return Promise.resolve(null);
  prefsP ??= import('@capacitor/preferences').then((m) => m.Preferences).catch(() => null);
  return prefsP;
}

export interface NativeHandlers {
  /** Hardware back button. */
  onBack(): void;
  /** App went to the background. */
  onPause(): void;
  /** App came back to the foreground. */
  onResume(): void;
}

/** Lock landscape and wire app lifecycle + back button. No-op on the web. */
export async function initNative(handlers: NativeHandlers): Promise<void> {
  if (!isNative()) return;
  await Promise.all([
    import('@capacitor/screen-orientation')
      .then(({ ScreenOrientation }) => ScreenOrientation.lock({ orientation: 'landscape' }))
      .catch((e) => console.warn('[native] orientation lock failed', e)),
    import('@capacitor/app')
      .then(async ({ App }) => {
        await App.addListener('backButton', () => handlers.onBack());
        await App.addListener('pause', () => handlers.onPause());
        await App.addListener('resume', () => handlers.onResume());
      })
      .catch((e) => console.warn('[native] app listeners failed', e)),
  ]);
}

export async function hideNativeSplash(): Promise<void> {
  if (!isNative()) return;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide({ fadeOutDuration: 250 });
  } catch {
    /* plugin missing: nothing to hide */
  }
}

export async function exitApp(): Promise<void> {
  if (!isNative()) return;
  try {
    const { App } = await import('@capacitor/app');
    await App.exitApp();
  } catch {
    /* ignore */
  }
}
