import { expect, test } from '@playwright/test';

test('the Roll and purchase views use a dark stage with a contained card', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?dev=1');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
  await page.evaluate(() => {
    const hook = window.__lotAndRoll!;
    hook.setAnimSpeed(0);
    hook.setPromptTimer(0);
    hook.startGame(hook.demoSettings(4, false), 31);
  });
  await expect(page.locator('.roll-btn')).toBeVisible();
  await expect(page.locator('.stage-bg')).toHaveCSS('background-color', 'rgb(10, 56, 71)');
  await page.evaluate(async () => {
    await window.__lotAndRoll!.whenIdle();
    await window.__lotAndRoll!.autoStep();
  });
  await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.getState()!.phase.kind)).toBe('buy');
  const stage = await page.locator('.stage').boundingBox();
  const card = await page.locator('.st-prompt .pcard').boundingBox();
  expect(stage).not.toBeNull();
  expect(card).not.toBeNull();
  expect(card!.x).toBeGreaterThanOrEqual(stage!.x - 1);
  expect(card!.y).toBeGreaterThanOrEqual(stage!.y - 1);
  expect(card!.x + card!.width).toBeLessThanOrEqual(stage!.x + stage!.width + 1);
  expect(card!.y + card!.height).toBeLessThanOrEqual(stage!.y + stage!.height + 1);
});
