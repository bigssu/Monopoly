// Plain-Node loader: extracts { key: `<svg…>` } string entries from src/content/icons/*.ts (no TS toolchain needed).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'content', 'icons');
export const FILES = [
  ['landmarks', 'LANDMARK_ICONS'],
  ['tokens', 'TOKEN_ICONS'],
  ['buildings', 'BUILDING_ICONS'],
  ['ui', 'UI_ICONS'],
  ['logo', 'LOGO_SVG'],
];

export function loadAll() {
  const sets = {};
  for (const [file, name] of FILES) {
    if (!fs.existsSync(path.join(dir, `${file}.ts`))) continue;
    const text = fs.readFileSync(path.join(dir, `${file}.ts`), 'utf8');
    const entries = {};
    if (file === 'logo') {
      const m = text.match(/LOGO_SVG\s*=\s*`([^`]*)`/);
      if (m) entries.logo = m[1];
    } else {
      for (const m of text.matchAll(/^\s*'([\w-]+)'\s*:\s*`([^`]*)`,?\s*$/gm)) entries[m[1]] = m[2];
    }
    sets[name] = entries;
  }
  return sets;
}
