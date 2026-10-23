import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const res = path.join(root, 'android/app/src/main/res');
const obsolete = [
  'drawable/splash.png',
  ...['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'].flatMap((density) => [
    `drawable-${density}/splash_icon.png`,
    `drawable-land-${density}/splash.png`,
    `drawable-port-${density}/splash.png`,
  ]),
];

function pngSize(file: string): [number, number] {
  const png = fs.readFileSync(file);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

function splashPngs(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? splashPngs(file) : entry.name.includes('splash') && entry.name.endsWith('.png') ? [file] : [];
  });
}

describe('Android splash assets', () => {
  it('uses one 512px nodpi icon and no density-specific splash overrides', () => {
    const shared = path.join(res, 'drawable-nodpi/splash_icon.png');
    expect(fs.existsSync(shared)).toBe(true);
    expect(pngSize(shared)).toEqual([512, 512]);
    expect(splashPngs(res)).toEqual([shared]);
    for (const asset of obsolete) expect(fs.existsSync(path.join(res, asset))).toBe(false);
  });

  it('draws the table background with a centered 288dp shared icon', () => {
    const splash = fs.readFileSync(path.join(res, 'drawable/splash.xml'), 'utf8');
    expect(splash).toContain('<layer-list');
    expect(splash).toContain('@color/table_bg');
    expect(splash).toContain('android:width="288dp" android:height="288dp" android:gravity="center"');
    expect(splash).toContain('<bitmap android:src="@drawable/splash_icon" android:gravity="fill" android:filter="true"');
  });
});

describe('Android launcher assets', () => {
  it('uses the selected 256px image and power-of-two icons per density (docs/research/13-image-budget.md)', () => {
    expect(pngSize(path.join(root, 'docs/assets/launcher-mark-256.png'))).toEqual([256, 256]);
    expect(fs.existsSync(path.join(root, 'docs/assets/launcher-mark.svg'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'docs/assets/launcher-mark-1024.png'))).toBe(false);
    expect(pngSize(path.join(root, 'docs/assets/play-icon-512.png'))).toEqual([512, 512]);
    // The power of two at or below each density's Android size (legacy 48dp, adaptive foreground 108dp).
    const pot = (px: number): number => 2 ** Math.floor(Math.log2(px));
    for (const [density, dpi] of Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 })) {
      const legacy = pot(48 * dpi);
      const fg = pot(108 * dpi);
      expect(pngSize(path.join(res, `mipmap-${density}/ic_launcher.png`))).toEqual([legacy, legacy]);
      expect(pngSize(path.join(res, `mipmap-${density}/ic_launcher_round.png`))).toEqual([legacy, legacy]);
      expect(pngSize(path.join(res, `mipmap-${density}/ic_launcher_foreground.png`))).toEqual([fg, fg]);
    }
  });
});
