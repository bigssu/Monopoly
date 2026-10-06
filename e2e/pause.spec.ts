/**
 * The visible pause button freezes a turn in progress (holds and animations stop where they are)
 * and Resume carries on from there.
 */
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

test('pause mid-turn freezes the board; resume continues', async ({ page }) => {
  await page.goto('/?dev=1');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
  await page.evaluate(() => {
    const h = window.__lotAndRoll!;
    h.setPromptTimer(0);
    h.startGame(h.demoSettings(2, false) as never, 3);
    const s = h.getState()!;
    s.current = 0;
    s.phase = { kind: 'preRoll', playerId: 0, rollAgain: false };
    s.testHooks = { diceQueue: [[3, 4]] };
    h.loadState(s);
  });
  const roll = page.locator('.stage [data-action="Roll"]:not(:disabled)');
  await expect(roll).toBeVisible({ timeout: 30_000 });
  await roll.click();
  await page.waitForTimeout(1200); // the dice have landed; the move has not finished
  await page.locator('.pause-btn').click();
  await expect(page.locator('.menu-title')).toContainText('일시 정지');
  const where = () => page.evaluate(() => {
    const r = document.querySelectorAll('.token')[0]!.getBoundingClientRect();
    return `${Math.round(r.x)},${Math.round(r.y)}`;
  });
  const before = await where();
  await page.waitForTimeout(2500);
  expect(await where()).toBe(before);
  expect(await page.evaluate(() => window.__lotAndRoll!.isBusy())).toBe(true);

  await page.locator('.menu-item.is-primary').click(); // 계속하기
  await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.getState()!.phase.kind), { timeout: 30_000 }).toBe('buy');
  await page.waitForFunction(() => !window.__lotAndRoll!.isBusy(), null, { timeout: 30_000 });
});
