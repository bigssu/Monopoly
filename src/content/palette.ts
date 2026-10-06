/**
 * Player colors and design-token mirrors shared by engine content and UI.
 * Keep in sync with src/styles/tokens.css.
 */
export interface PlayerColor {
  id: string;
  ko: string;
  en: string;
  /** Main fill. */
  hex: string;
  /** Darker shade for text-on-light / shadows. */
  dark: string;
  /** Very light tint for backgrounds. */
  tint: string;
}

export const PLAYER_COLORS: readonly PlayerColor[] = [
  { id: 'red', ko: '빨강', en: 'Red', hex: '#E8564F', dark: '#B33A34', tint: '#FDE8E7' },
  { id: 'blue', ko: '파랑', en: 'Blue', hex: '#4A6CF7', dark: '#2F49B8', tint: '#E6EAFE' },
  { id: 'green', ko: '초록', en: 'Green', hex: '#3DBB6E', dark: '#25874C', tint: '#E4F7EB' },
  { id: 'yellow', ko: '노랑', en: 'Yellow', hex: '#F2B633', dark: '#B5841A', tint: '#FDF3DA' },
  { id: 'purple', ko: '보라', en: 'Purple', hex: '#9B6BF2', dark: '#6B43BE', tint: '#F0E9FD' },
  { id: 'orange', ko: '주황', en: 'Orange', hex: '#F5844A', dark: '#BF5A25', tint: '#FEEBE0' },
  { id: 'teal', ko: '청록', en: 'Teal', hex: '#2EC4B6', dark: '#1D8A80', tint: '#E1F7F5' },
  { id: 'pink', ko: '분홍', en: 'Pink', hex: '#F272A8', dark: '#B9457A', tint: '#FDE7F1' },
];

export const TOKEN_IDS: readonly string[] = [
  'car', 'rocket', 'cat', 'robot', 'crown', 'star', 'ufo', 'dino', 'whale', 'boot', 'camera', 'teapot',
];

export function playerColor(id: string): PlayerColor {
  return PLAYER_COLORS.find((c) => c.id === id) ?? PLAYER_COLORS[0]!;
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance of a #RRGGBB color. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two #RRGGBB colors (1–21). */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Minimum contrast of the text on an owner-filled board space (names and prices: normal text). */
export const OWNER_INK_CONTRAST = 4.5;

/**
 * The player's `dark` shade pushed toward black just far enough to read on the full player color
 * (≥ 5:1, a margin over OWNER_INK_CONTRAST), so the ink still carries the color's hue.
 */
function deepShade(c: PlayerColor): string {
  const ch = channels(c.dark);
  let out = '#000000';
  for (let k = 0.5; k >= 0; k -= 0.05) {
    out = `#${ch.map((v) => Math.round(v * k).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
    if (contrast(out, c.hex) >= 5) break;
  }
  return out;
}

/**
 * Text on a space filled with the owner's color (board ownership fill), computed per color: white
 * with a soft dark halo where white reaches OWNER_INK_CONTRAST, else a deep shade of the color with
 * a soft light halo. (In the current palette white reaches at most 4.4:1 — blue — so every color
 * takes its deep shade; the palette's own `dark` is under 2:1 on its color.)
 */
export function inkOn(c: PlayerColor): { ink: string; halo: string; light: boolean } {
  if (contrast('#FFFFFF', c.hex) >= OWNER_INK_CONTRAST) return { ink: '#FFFFFF', halo: 'rgba(20, 16, 30, 0.42)', light: true };
  return { ink: deepShade(c), halo: 'rgba(255, 255, 255, 0.3)', light: false };
}
