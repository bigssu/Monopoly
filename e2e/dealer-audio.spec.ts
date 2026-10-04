/**
 * Dealer host and sound (docs/superpowers/specs/2026-10-04-dealer-voice-design.md,
 * 2026-10-04-sound-design.md): the bubble follows the dealer setting and the UI language, sound
 * off plays nothing, and the advanced double-up flow completes from real clicks.
 */
import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

const PREFS_KEY = 'lotandroll:prefs:v1';

/** Boot with prefs overrides and counters on every way the app can start a sound. */
async function boot(page: Page, prefs: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript(([key, p]) => {
    try {
      const prev = JSON.parse(localStorage.getItem(key as string) ?? '{}');
      localStorage.setItem(key as string, JSON.stringify({ ...prev, ...(p as object) }));
    } catch {
      /* storage blocked: defaults apply */
    }
    const w = window as unknown as { __starts: number };
    w.__starts = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a: Parameters<typeof start>) {
      w.__starts++;
      return start.apply(this, a);
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      w.__starts++;
      return play.call(this);
    };
  }, [PREFS_KEY, prefs] as const);
  await page.goto('/?dev=1');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
  await page.mouse.click(5, 790); // a first gesture unlocks audio
}

async function startGame(page: Page, rules = 'normal'): Promise<void> {
  await page.evaluate((r) => {
    const h = window.__lotAndRoll!;
    h.setPromptTimer(0);
    h.startGame({ ...h.demoSettings(2, false), rules: r } as never, 3);
  }, rules);
  await page.waitForSelector('.game .board');
}

test('the dealer greets and his bubble shows at the default setting', async ({ page }) => {
  await boot(page);
  await startGame(page);
  await expect(page.locator('.dealer-bubble.is-in')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.dealer-text')).not.toHaveText('');
});

test('dealer off: no bubble during play', async ({ page }) => {
  await boot(page, { dealer: 'off' });
  await startGame(page);
  await page.locator('.st-prompt [data-action="Roll"]').click();
  await page.waitForTimeout(6000);
  await expect(page.locator('.dealer-bubble.is-in')).toHaveCount(0);
});

test('English UI: the dealer speaks in English subtitles', async ({ page }) => {
  await boot(page, { lang: 'en' });
  await startGame(page);
  const text = page.locator('.dealer-bubble.is-in .dealer-text');
  await expect(text).toBeVisible({ timeout: 15_000 });
  expect(await text.innerText()).toMatch(/^[\x20-\x7E’—…]+$/);
});

test('sound off: no sample, voice or music is ever started', async ({ page }) => {
  await boot(page, { sound: false });
  await startGame(page);
  await page.locator('.st-prompt [data-action="Roll"]').click();
  await page.waitForTimeout(6000);
  expect(await page.evaluate(() => (window as unknown as { __starts: number }).__starts)).toBe(0);
});

test('control: with sound on, samples do start (the counter works)', async ({ page }) => {
  await boot(page, { sound: true });
  await startGame(page);
  await page.locator('.st-prompt [data-action="Roll"]').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __starts: number }).__starts), { timeout: 15_000 }).toBeGreaterThan(0);
});

test('advanced rules: the double-up bonus completes from real clicks', async ({ page }) => {
  await boot(page, { dealer: 'off' });
  await startGame(page, 'advanced');
  await page.evaluate(() => {
    const h = window.__lotAndRoll!;
    const s = h.getState()!;
    s.current = 0;
    s.phase = { kind: 'preRoll', playerId: 0, rollAgain: false };
    s.players[0]!.position = 27;
    s.testHooks = { diceQueue: [[2, 3]] };
    h.loadState(s);
  });
  await page.waitForSelector('.game .board');
  await page.locator('.st-prompt [data-action="Roll"]').click();
  const pick = page.locator('.st-prompt [data-action="DoubleUpGuess"]:not(:disabled)').first();
  await expect(pick).toBeVisible({ timeout: 20_000 });
  await pick.click();
  // Win → another round (stop it), lose → the bonus is over.
  await page.waitForFunction(() => window.__lotAndRoll!.getState()!.phase.kind !== 'doubleUp' || !window.__lotAndRoll!.isBusy(), null, { timeout: 20_000 });
  if ((await page.evaluate(() => window.__lotAndRoll!.getState()!.phase.kind)) === 'doubleUp') {
    await page.locator('.st-prompt [data-action="Pass"]').click();
  }
  await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.getState()!.phase.kind), { timeout: 20_000 }).not.toBe('doubleUp');
});
