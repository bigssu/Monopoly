import { LANDMARK_ICONS } from './landmarks';
import { TOKEN_ICONS } from './tokens';
import { BUILDING_ICONS } from './buildings';
import { UI_ICONS } from './ui';

export { LANDMARK_ICONS } from './landmarks';
export { TOKEN_ICONS } from './tokens';
export { BUILDING_ICONS } from './buildings';
export { UI_ICONS } from './ui';
export { LOGO_SVG } from './logo';

const ALL: Record<string, string> = { ...LANDMARK_ICONS, ...TOKEN_ICONS, ...BUILDING_ICONS, ...UI_ICONS };

/** All icon ids across every set (landmarks, tokens, buildings, ui). */
export const ICON_IDS: readonly string[] = Object.keys(ALL);

/**
 * Returns the SVG markup for an icon id, looking across all sets.
 * Throws on an unknown id in dev; in production returns an empty string so a typo never crashes the game.
 * Token/building icons paint their main body with `currentColor` (set CSS `color` to tint);
 * UI icons are 24x24 monochrome `currentColor`, everything else is 64x64 full color.
 */
export function icon(id: string): string {
  const svg = ALL[id];
  if (svg === undefined) {
    const dev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV ?? true;
    if (dev) throw new Error(`Unknown icon id: "${id}"`);
    return '';
  }
  return svg;
}
