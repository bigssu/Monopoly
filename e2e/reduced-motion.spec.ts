/**
 * Reduced motion (OS "remove animations" / the app setting) removes movement, not time: the CPU's
 * turn still takes its beats and the stage says whose turn it is. Before the fix the CPU played
 * in 0 ms, so a human vs CPU game looked like "only player 1 ever plays and the token never moves".
 */
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

test('reduced motion: the CPU turn is shown and takes time', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?dev=1');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
  await page.evaluate(() => {
    const h = window.__lotAndRoll!;
    h.setPromptTimer(0);
    const d = h.demoSettings(2, false);
    d.players[1]!.isCpu = true;
    h.startGame(d as never, 7);
    const s = h.getState()!;
    s.current = 0;
    s.phase = { kind: 'preRoll', playerId: 0, rollAgain: false };
    s.testHooks = { diceQueue: [[1, 3]] }; // a plain city, no doubles: the turn passes
    h.loadState(s);
  });
  await page.waitForSelector('.game .board');
  const roll = page.locator('.st-prompt [data-action="Roll"]:not(:disabled)');
  await expect(roll).toBeVisible({ timeout: 15_000 });
  await roll.click();
  // Decline whatever the landing offers until the CPU is up.
  await expect
    .poll(async () => {
      const cur = await page.evaluate(() => window.__lotAndRoll!.getState()!.current);
      if (cur === 0) await page.locator('.st-prompt [data-action="Pass"]:not(:disabled)').click({ timeout: 500 }).catch(() => {});
      return cur;
    }, { timeout: 30_000 })
    .toBe(1);
  const t0 = Date.now();
  await expect(page.locator('.st-banner-name')).toContainText('2', { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.getState()!.current), { timeout: 30_000 }).toBe(0);
  expect(Date.now() - t0).toBeGreaterThan(1500);
});
