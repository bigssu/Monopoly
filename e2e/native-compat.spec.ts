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

test('native WebView mode keeps Roll usable without persistent stage layers', async ({ page }) => {
  await page.goto('/?dev=1');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
  await page.evaluate(() => {
    document.documentElement.classList.add('native-webview');
    const hook = window.__lotAndRoll!;
    hook.setAnimSpeed(0);
    hook.setPromptTimer(0);
    hook.startGame(hook.demoSettings(4, false), 11);
  });
  const roll = page.locator('.roll-btn');
  await expect(roll).toBeVisible();
  await expect(page.locator('.stage-rot')).toHaveCSS('will-change', 'auto');
  await expect(page.locator('.st-prompt')).toHaveCSS('will-change', 'auto');
  expect(await roll.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('none');
  const panel = page.locator('.pp.is-turn:not(.is-cpu) .pp-card').first();
  expect(await panel.evaluate((el) => getComputedStyle(el, '::before').animationName)).toBe('none');
  await roll.click();
  await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.getState()!.lastDice)).not.toBeNull();
});
