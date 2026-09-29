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
