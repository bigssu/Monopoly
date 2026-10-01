/**
 * Font subset guard (docs/PERFORMANCE.md, "글꼴"): the preloaded app faces (public/fonts/app) hold
 * every character the UI source can show; anything else — e.g. an unusual Hangul syllable typed in a
 * player name — must fall back to the remaining Google Fonts slices on demand. The complete
 * font stack must cover all 11,172 modern Hangul syllables at every weight the UI uses.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (name === '__tests__') continue;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(ts|css)$/.test(name)) out.push(rel);
  }
  return out;
}

interface Face {
  family: string;
  weight: [number, number];
  src: string;
  ranges: [number, number][] | null;
}

function faces(): Face[] {
  const css = read('public/fonts/fonts.css');
  return [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => {
    const b = m[1]!;
    const ur = /unicode-range:\s*([^;]+);/.exec(b);
    const weights = /font-weight:\s*([\d ]+);/.exec(b)![1]!.trim().split(/\s+/).map(Number);
    return {
      family: /font-family:\s*'([^']+)'/.exec(b)![1]!,
      weight: [weights[0]!, weights[1] ?? weights[0]!],
      src: /url\(([^)]+)\)/.exec(b)![1]!,
      ranges: ur
        ? ur[1]!.split(',').map((r) => {
            const [a, z] = r.trim().slice(2).split('-');
            return [parseInt(a!, 16), parseInt(z ?? a!, 16)] as [number, number];
          })
        : null,
    };
  });
}

const covers = (fs: Face[], cp: number): boolean => fs.some((f) => f.ranges?.some(([a, z]) => cp >= a && cp <= z));

describe('app font subset', () => {
  it('contains every character used by the UI sources', () => {
    const charset = new Set([...read('public/fonts/app/charset.txt')].map((c) => c.codePointAt(0)!));
    const missing = new Set<string>();
    for (const f of ['index.html', ...sourceFiles('src')]) {
      for (const ch of read(f)) {
        const cp = ch.codePointAt(0)!;
        if (cp < 0x20 || (cp >= 0xd800 && cp <= 0xdfff)) continue;
        if (!charset.has(cp)) missing.add(`${ch} U+${cp.toString(16).toUpperCase()} (${f})`);
      }
    }
    // New UI text with new characters → re-run scripts/subset-fonts.py.
    expect([...missing]).toEqual([]);
  });

  it('covers all 11,172 Hangul syllables through the app and fallback font stacks', () => {
    const all = faces();
    for (const [family, weights] of [
      ['Noto Sans KR', [400, 700, 900]],
      ['Jua', [400]],
    ] as const) {
      for (const w of weights) {
        // Jua itself contains only 2,367 Hangul syllables; the Noto stack covers rare names.
        const families = [family, `${family} Fallback`, 'Noto Sans KR', 'Noto Sans KR Fallback'];
        const fs = all.filter((f) => families.includes(f.family) && f.weight[0] <= w && f.weight[1] >= w);
        expect(fs.length, `${family} ${w}`).toBeGreaterThan(0);
        const gaps: number[] = [];
        for (let cp = 0xac00; cp <= 0xd7a3; cp++) if (!covers(fs, cp)) gaps.push(cp);
        expect(gaps.length, `${family} ${w}: uncovered syllables`).toBe(0);
        // Every slice file referenced must ship.
        for (const f of fs) expect(statSync(join(ROOT, 'public/fonts', f.src)).size, f.src).toBeGreaterThan(0);
      }
    }
  });

  it('declares each fallback source once and keeps bundled fonts below 4.5 MB', () => {
    const fallback = faces().filter((f) => f.family.endsWith(' Fallback'));
    expect(new Set(fallback.map((f) => `${f.family}:${f.src}`)).size).toBe(fallback.length);
    const bytes = (dir: string): number => readdirSync(dir).reduce((total, name) => {
      const path = join(dir, name);
      const stat = statSync(path);
      return total + (stat.isDirectory() ? bytes(path) : stat.size);
    }, 0);
    expect(bytes(join(ROOT, 'public/fonts'))).toBeLessThan(4_500_000);
  });

  it('lists the fallback families after the subsets in every UI font stack', () => {
    const tokens = read('src/styles/tokens.css');
    for (const v of ['--font-display', '--font-body', '--font-num']) {
      const stack = new RegExp(`${v}:([^;]+);`).exec(tokens)![1]!;
      expect(stack).toContain("'Noto Sans KR Fallback'");
      expect(stack.indexOf("'Noto Sans KR'")).toBeLessThan(stack.indexOf("'Noto Sans KR Fallback'"));
    }
  });
});
