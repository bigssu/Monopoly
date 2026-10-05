// Well-formedness check for every icon string. Plain Node, no dependencies.
// Usage: node scripts/check-icons.mjs
import { loadAll } from './lib/load-icons.mjs';

const REQUIRED = {
  LANDMARK_ICONS: 'city-manila city-hanoi city-cairo city-nairobi city-capetown city-lima city-mexicocity city-buenosaires city-istanbul city-athens city-madrid city-berlin city-rome city-london city-dubai city-singapore city-tokyo city-newyork city-seoul hub-port hub-airport hub-rail hub-space corner-start corner-island corner-festival corner-tour space-event space-tax space-donation',
  TOKEN_ICONS: 'car rocket cat robot crown star ufo dino whale boot camera teapot',
  BUILDING_ICONS: 'villa building hotel landmark festival-marker pot coin dice-face-1 dice-face-2 dice-face-3 dice-face-4 dice-face-5 dice-face-6 cards-escape cards-freepass cards-shield',
  UI_ICONS: 'menu close settings sound-on sound-off vibrate help play pause restart home chevron-left chevron-right check cpu human rotate plus minus trophy timer save',
  LOGO_SVG: 'logo',
};
const VOID = new Set(['path', 'circle', 'rect', 'ellipse', 'line', 'polygon', 'polyline']);
const ALLOWED = new Set([...VOID, 'svg', 'g']);
let errors = 0, total = 0;
const err = (id, msg) => { errors++; console.error(`FAIL ${id}: ${msg}`); };

function checkSvg(id, s, is24) {
  const head = is24
    ? /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24"[^>]*>/
    : /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 64 64"[^>]*>/;
  if (!head.test(s)) err(id, `bad <svg> root / viewBox (expected ${is24 ? '24' : '64'})`);
  if (!s.endsWith('</svg>')) err(id, 'does not end with </svg>');
  if (/<(image|text|script|style|use|defs|linearGradient|radialGradient|clipPath|mask|filter)\b/.test(s) && !id.startsWith('logo')) err(id, 'uses a disallowed element');
  if (/(href|url\(|https?:)/.test(s.replace('http://www.w3.org/2000/svg', ''))) err(id, 'external/URL reference');
  const stack = [];
  for (const m of s.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^<>]*?)(\/?)>/g)) {
    const [, close, tag, attrs, self] = m;
    if (!ALLOWED.has(tag) && !(id === 'logo' && tag === 'text')) err(id, `unexpected <${tag}>`);
    if (close) {
      if (stack.pop() !== tag) err(id, `mismatched </${tag}>`);
    } else {
      // attributes must be name="value" pairs
      const rest = attrs.replace(/\s+[\w:-]+="[^"<>]*"/g, '');
      const names = [...attrs.matchAll(/\s([\w:-]+)="/g)].map((x) => x[1]);
      if (new Set(names).size !== names.length) err(id, `duplicate attribute in <${tag}>: ${names.join(',')}`);
      if (rest.trim() !== '') err(id, `malformed attributes in <${tag}>: ${rest.trim().slice(0, 40)}`);
      if (!self) stack.push(tag);
    }
  }
  if (stack.length) err(id, `unclosed: ${stack.join(',')}`);
  if (/NaN|undefined|null|\bInfinity\b/.test(s)) err(id, 'NaN/undefined in output');
  // stroke width >= 2 (in 64 icons)
  for (const m of s.matchAll(/stroke-width="([\d.]+)"/g)) if (parseFloat(m[1]) < 2) err(id, `stroke-width ${m[1]} < 2`);
  if (!is24 && s.length > 9000) console.warn(`warn ${id}: ${s.length} bytes`);
  // numbers in path data
  for (const m of s.matchAll(/ d="([^"]*)"/g)) if (!/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]+$/.test(m[1])) err(id, `bad path data: ${m[1].slice(0, 40)}`);
}

const sets = loadAll();
for (const [name, entries] of Object.entries(sets)) {
  const want = REQUIRED[name].split(' ');
  for (const k of want) if (!(k in entries)) err(`${name}.${k}`, 'missing');
  for (const k of Object.keys(entries)) if (!want.includes(k)) console.warn(`note: extra key ${name}.${k}`);
  for (const [k, v] of Object.entries(entries)) { total++; checkSvg(k, v, name === 'UI_ICONS'); }
  console.log(`${name}: ${Object.keys(entries).length} icons`);
}
console.log(errors ? `\n${errors} problem(s)` : `\nAll ${total} icons OK`);
process.exit(errors ? 1 : 0);
