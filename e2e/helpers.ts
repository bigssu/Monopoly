/**
 * Shared harness for the browser specs: stored prefs, boot the app on the title screen, collect
 * console errors (plus warnings when asked) and page errors, and drive hand-crafted games.
 */
import { expect, type Page } from '@playwright/test';
import type { GameState } from '../src/engine/types';
import type { HandRecord } from '../src/ui/stage/CpuHand';

/** The app's stored prefs (src/ui/shell/prefs.ts). */
export const PREFS_KEY = 'lotandroll:prefs:v1';

/**
 * Merge `patch` into the stored prefs before the app's scripts run (call before `page.goto`).
 * Keeps whatever else the page stores in its prefs.
 */
export async function setPrefs(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.addInitScript(
    ({ key, patch }) => {
      try {
        const prev = JSON.parse(localStorage.getItem(key) ?? '{}');
        localStorage.setItem(key, JSON.stringify({ ...prev, ...patch }));
      } catch {
        /* storage blocked: the defaults apply */
      }
    },
    { key: PREFS_KEY, patch },
  );
}

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
 * Open `/?dev=1` (plus `query`, e.g. `&mres=low`) at `w`×`h` (the test's viewport when omitted),
 * with `prefs` merged into the stored prefs, and wait for the dev hook, the title screen and the fonts.
 */
export async function boot(
  page: Page,
  opts: { w?: number; h?: number; query?: string; prefs?: Record<string, unknown> } = {},
): Promise<void> {
  if (opts.prefs) await setPrefs(page, opts.prefs);
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

/** Boot at 1600×1000, animations ×2, no prompt timer, the skill guide seen (these specs roll by keyboard). */
export async function bootFast(page: Page): Promise<void> {
  await boot(page, { w: 1600, h: 1000, prefs: { skillGuideSeen: true } });
  await page.evaluate(() => {
    window.__lotAndRoll!.setAnimSpeed(2);
    window.__lotAndRoll!.setPromptTimer(0);
  });
}

export async function getState(page: Page): Promise<GameState> {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__lotAndRoll!.getState())) as GameState);
}

/** Wait until the game waits for a person (or is over); event cards are tapped away and counted in `stats`. */
export async function waitIdle(page: Page, stats?: { cards: number }): Promise<void> {
  for (let k = 0; k < 2000; k++) {
    const st = await page.evaluate(() => ({
      busy: window.__lotAndRoll!.isBusy(),
      card: !!document.querySelector('.ev-card-inner.is-flipped'),
    }));
    if (st.card) {
      const ok = await page
        .locator('.ev-card')
        .click({ timeout: 1500 })
        .then(() => true)
        .catch(() => false);
      if (ok && stats) stats.cards++;
    }
    if (!st.busy) break;
    await page.waitForTimeout(20);
  }
  await page.evaluate(() => window.__lotAndRoll!.whenIdle());
}

/**
 * A fresh all-human game (`players` seats, 4 by default; `demoSettings` plus `settings`), patched by
 * `patch` (a function body over `s`) and loaded (the resume path).
 */
export async function loadCrafted(page: Page, opts: { players?: number; settings?: Record<string, unknown> }, patch: string): Promise<void> {
  await page.evaluate(
    ({ n, settings, patch }) => {
      const hook = window.__lotAndRoll!;
      hook.startGame({ ...hook.demoSettings(n, false), ...settings } as never, 7);
      const s = hook.getState()!;
      new Function('s', patch)(s);
      hook.loadState(s);
    },
    { n: opts.players ?? 4, settings: opts.settings ?? {}, patch },
  );
  await page.waitForSelector('.game .board');
  await waitIdle(page);
}

/** A plain roll: the keyboard on the pad (a weak toss; no stride / aim chosen). */
export async function roll(page: Page): Promise<void> {
  await page.locator('.stage [data-action="Roll"]').first().click();
  await waitIdle(page);
}
