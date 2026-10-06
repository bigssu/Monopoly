/**
 * Shared harness for the browser specs: boot the app on the title screen and collect console
 * errors (plus warnings when asked) and page errors.
 */
import { expect, type Page } from '@playwright/test';
import type { HandRecord } from '../src/ui/stage/CpuHand';

/**
 * Console errors (and warnings with `warnings: true`) and uncaught page errors, as readable lines.
 * The browser's own favicon probe and URL-less "Failed to load resource" lines are not app errors;
 * `ignore` drops more (matched against the text and the URL).
 */
export function watchConsole(page: Page, opts: { warnings?: boolean; ignore?: RegExp } = {}): string[] {
  const out: string[] = [];
  page.on('console', (m) => {
    const type = m.type();
    if (type !== 'error' && !(opts.warnings && type === 'warning')) return;
    const url = m.location().url ?? '';
    if (/favicon/.test(url)) return;
    if (/Failed to load resource/.test(m.text()) && !url) return;
    if (opts.ignore?.test(`${m.text()} ${url}`)) return;
    out.push(`${type}: ${m.text()} @ ${url}`);
  });
  page.on('pageerror', (e) => out.push(`pageerror: ${String(e)}`));
  return out;
}

/**
 * Open `/?dev=1` (plus `query`, e.g. `&mres=low`) at `w`×`h` (the test's viewport when omitted) and
 * wait for the dev hook, the title screen and the fonts.
 */
export async function boot(page: Page, opts: { w?: number; h?: number; query?: string } = {}): Promise<void> {
  if (opts.w && opts.h) await page.setViewportSize({ width: opts.w, height: opts.h });
  await page.goto(`/?dev=1${opts.query ?? ''}`);
  await page.waitForFunction(() => !!window.__lotAndRoll && document.getElementById('app')?.dataset.screen === 'title', null, {
    timeout: 20_000,
  });
  await page.evaluate(() => document.fonts.ready);
}

/** A CPU hand press (CpuHand log record) hit the control or space its action dispatches. */
export function checkPress(r: HandRecord, ctx: string): void {
  const where = `${ctx} ${r.seat} ${r.phase}:${r.action} pressed=${r.pressed} tip=${JSON.stringify(r.tip)} at=${JSON.stringify(r.at)}`;
  expect(r.target, where).not.toBe('none');
  expect(r.found, `control on screen: ${where}`).toBe(true);
  expect(r.tipInside, `fingertip on the control: ${where}`).toBe(true);
  expect(r.pending, `pressed before the dispatch: ${where}`).toBe(true);
  const a = JSON.parse(r.act) as { type: string; spaceIndex?: number };
  if (r.target === 'space') expect(r.pressed, where).toBe(`space:${a.spaceIndex}`);
  else expect(r.pressed, where).toBe(`${a.type}${a.spaceIndex !== undefined ? `:${a.spaceIndex}` : ''}`);
}
