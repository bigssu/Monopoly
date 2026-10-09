/**
 * Reduced motion in tests = the app's own setting (prefs.motion), like a player would choose it in
 * Settings. The device media query (`page.emulateMedia({ reducedMotion })`) is deliberately not
 * read by the app (src/ui/fx/time.ts), so emulating it changes nothing.
 */
import type { Page } from '@playwright/test';
import { setPrefs } from './helpers';

/** Call before `page.goto`. Keeps whatever else the page stores in its prefs. */
export async function reduceMotion(page: Page): Promise<void> {
  await setPrefs(page, { motion: 'reduced' });
}
