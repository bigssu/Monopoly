/**
 * Tiny i18n. Modules register namespaced string tables; `t()` looks them up.
 *
 *   registerStrings({ ko: { 'game.roll': '굴리기' }, en: { 'game.roll': 'Roll' } });
 *   t('game.roll')                       // → '굴리기'
 *   t('toll.pay', { amount: '300' })     // '{amount}' placeholders
 *
 * Missing keys return the key itself (and warn once in dev) so nothing ever renders blank.
 */
export type Lang = 'ko' | 'en';
type StringTable = Record<string, string>;

const tables: Record<Lang, StringTable> = { ko: {}, en: {} };
let current: Lang = 'ko';
const listeners = new Set<(lang: Lang) => void>();
const warned = new Set<string>();

export function registerStrings(strings: { ko: StringTable; en: StringTable }): void {
  Object.assign(tables.ko, strings.ko);
  Object.assign(tables.en, strings.en);
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  document.documentElement.lang = lang;
  for (const l of listeners) l(lang);
}

export function onLangChange(fn: (lang: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key: string, params?: Record<string, string | number>): string {
  let s = tables[current][key] ?? tables.ko[key] ?? tables.en[key];
  if (s === undefined) {
    if (import.meta.env?.DEV && !warned.has(key)) {
      warned.add(key);
      console.warn(`[i18n] missing key: ${key}`);
    }
    s = key;
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

/** Pick a localized field from content objects shaped `{ ko, en }`. */
export function loc(v: { ko: string; en: string }): string {
  return v[current] ?? v.ko;
}

/** Format money: 1500 → '1,500' (unit suffix is handled by callers via t('money.unit')). */
const numberFormats = new Map<Lang, Intl.NumberFormat>();

export function fmtMoney(n: number): string {
  // Constructing an Intl.NumberFormat is slow; the cash tween calls this every frame.
  let f = numberFormats.get(current);
  if (!f) {
    f = new Intl.NumberFormat(current === 'ko' ? 'ko-KR' : 'en-US');
    numberFormats.set(current, f);
  }
  return f.format(n);
}
