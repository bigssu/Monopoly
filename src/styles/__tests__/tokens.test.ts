/**
 * Tone tokens (tokens.css): every --tone-*-ink must stay readable on its --tone-*-bg
 * (WCAG AA, 4.5:1 for normal-size text; chips are small).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DUR, EASE } from '@/ui/fx/motion';

const css = readFileSync(join(__dirname, '..', 'tokens.css'), 'utf8');

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('tone tokens', () => {
  const tones = [...css.matchAll(/--tone-([a-z]+)-bg:\s*(#[0-9A-Fa-f]{6})/g)].map((m) => m[1]!);

  it('defines the five chip tones', () => {
    expect(tones).toEqual(['neutral', 'gold', 'good', 'bad', 'info']);
  });

  it.each(tones)('%s ink meets 4.5:1 on its bg', (tone) => {
    const bg = css.match(new RegExp(`--tone-${tone}-bg:\\s*(#[0-9A-Fa-f]{6})`))![1]!;
    const ink = css.match(new RegExp(`--tone-${tone}-ink:\\s*(#[0-9A-Fa-f]{6})`))![1]!;
    expect(contrast(ink, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('motion tokens', () => {
  const token = (name: string) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.replace(/\s+/g, '');
  it('mirror ui/fx/motion.ts (one vocabulary for CSS and code)', () => {
    expect(token('ease-out')).toBe(EASE.settle);
    expect(token('ease-spring')).toBe(EASE.overshoot);
    expect(token('ease-anticipate')).toBe(EASE.anticipate);
    expect(token('ease-breathe')).toBe(EASE.breathe);
    expect(token('ease-in-out')).toBe(EASE.inOut);
    expect(token('t-press')).toBe(`${DUR.press}ms`);
    expect(token('t-release')).toBe(`${DUR.release}ms`);
    expect(token('t-breathe')).toBe(`${DUR.breathe / 1000}s`);
  });
});
