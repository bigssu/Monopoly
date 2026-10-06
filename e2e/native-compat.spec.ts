import { expect, test } from '@playwright/test';

test('native WebView mode avoids full-screen navigation layers', async ({ page }) => {
  await page.goto('/?dev=1');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
  await page.evaluate(() => document.documentElement.classList.add('native-webview'));
  await expect(page.locator('.screen')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.title-logo')).toHaveCSS('animation-name', 'none');
  await page.locator('[data-action="settings"]').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'settings');
  await expect(page.locator('.screen-ghost')).toHaveCount(0);
});

test('native WebView mode keeps the roll (the throw pad) usable without a repeating pulse', async ({ page }) => {
  await page.goto('/?dev=1');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
  await page.evaluate(() => {
    document.documentElement.classList.add('native-webview');
    const hook = window.__lotAndRoll!;
    hook.setAnimSpeed(0);
    hook.setPromptTimer(0);
    hook.startGame(hook.demoSettings(4, false), 11);
  });
  const roll = page.locator('.roll-pad');
  await expect(roll).toBeVisible();
  await expect(page.locator('.stage-bg')).toHaveCSS('background-color', 'rgb(10, 56, 71)');
  // The pad paints nothing and runs no animation (the roll button and its pulse are hidden by default).
  await expect(page.locator('.roll-btn')).toHaveCount(0);
  expect(await roll.evaluate((el) => el.getAnimations().length + getComputedStyle(el).animationName)).toBe('0none');
  const panel = page.locator('.pp.is-turn:not(.is-cpu) .pp-card').first();
  expect(await panel.evaluate((el) => getComputedStyle(el, '::before').animationName)).toBe('none');
  await roll.click();
  await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.getState()!.lastDice)).not.toBeNull();
});
