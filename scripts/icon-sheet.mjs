// Generates the icon contact sheet as HTML in the temp dir (the path is printed) and, if playwright +
// Chromium are available, docs/assets/icon-sheet.png.
// Usage: node scripts/icon-sheet.mjs [--no-shot]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './fx/common.mjs';
import { loadAll } from './lib/load-icons.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sets = loadAll();
// optional: --only=TOKEN_ICONS,UI_ICONS --out=/tmp/x.png (for quick iteration; the default run renders everything)
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').split('=')[1];
const only = arg('only') ? arg('only').split(',') : null;
if (only) for (const k of Object.keys(sets)) if (!only.includes(k)) delete sets[k];
const keys = arg('keys') ? arg('keys').split(',') : null;
if (keys) for (const set of Object.values(sets)) for (const k of Object.keys(set)) if (!keys.includes(k)) delete set[k];
const TINTS = ['#EF5B5B', '#4A6CF7', '#5CC689', '#F2C94C'];
let ti = 0;
const cell = (id, svg, name) => {
  const tinted = name === 'TOKEN_ICONS' || name === 'BUILDING_ICONS';
  const color = tinted ? TINTS[ti++ % TINTS.length] : 'inherit';
  const style = name === 'UI_ICONS' ? 'width:24px;height:24px' : '';
  const sizes = name === 'UI_ICONS' ? [20, 24, 48] : [28, 64, 128];
  const strip = (bg, fg) =>
    `<div class="strip" style="background:${bg};color:${name === 'UI_ICONS' ? fg : color}">` +
    sizes.map((s) => `<i style="width:${s}px;height:${s}px">${svg}</i>`).join('') + '</div>';
  return `<figure><figcaption>${id}</figcaption>${strip('#fff', '#2B3245')}${strip('#232a3d', '#f2f4f8')}</figure>`;
};
let body = '';
for (const [name, entries] of Object.entries(sets)) {
  body += `<h2>${name} (${Object.keys(entries).length})</h2><section>`;
  for (const [id, svg] of Object.entries(entries)) body += cell(id, svg, name);
  body += '</section>';
}
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Icon sheet</title><style>
body{margin:0;padding:16px;background:#e9edf3;font:12px system-ui,sans-serif;color:#2B3245}
h2{margin:18px 0 8px;font-size:16px}
section{display:flex;flex-wrap:wrap;gap:10px}
figure{margin:0;background:#fff;border-radius:10px;padding:6px;box-shadow:0 1px 3px #0002}
figcaption{font-size:11px;margin:0 0 4px 2px;opacity:.7}
.strip{display:flex;align-items:flex-end;gap:8px;padding:6px;border-radius:6px;margin-bottom:4px}
i{display:block;flex:none}i svg{width:100%;height:100%;display:block}
</style></head><body>${body}</body></html>`;
const htmlPath = path.join(os.tmpdir(), only || keys ? 'icon-sheet-part.html' : 'icon-sheet.html');
fs.writeFileSync(htmlPath, html);
console.log('wrote', htmlPath);

if (!process.argv.includes('--no-shot')) {
  try {
    const browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.goto('file://' + htmlPath);
    const out = arg('out') || path.join(here, '..', 'docs', 'assets', 'icon-sheet.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out, fullPage: true });
    await browser.close();
    console.log('wrote', out);
  } catch (e) {
    console.log('screenshot skipped:', e.message);
  }
}
