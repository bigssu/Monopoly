import { expect, test } from '@playwright/test';
import { reduceMotion } from './motion';

test.use({ viewport: { width: 1280, height: 800 } });

async function setup(page: import('@playwright/test').Page): Promise<void> {
  await reduceMotion(page);
  await page.goto('/?dev=1');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
  await page.locator('[data-action="new"]').click();
}

test('seat editor keeps keyboard focus inside the modal', async ({ page }) => {
  await setup(page);
  await page.locator('.seat-anchor[data-seat="E"] .seat-join').click();
  await page.locator('.seat-anchor[data-seat="W"] .seat-join').click();
  await page.locator('.seat-anchor[data-seat="E"] .seat-player').click();
  const editor = page.locator('.seat-editor');
  await expect(editor).toBeVisible();

  // The last editor control must wrap to the editor's first control, never the E-seat leave button.
  await editor.locator('.se-ctrl button').last().focus();
  await page.keyboard.press('Tab');
  await expect(editor.locator('.se-name')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.dlg-input')).toBeFocused();
  await expect(page.locator('.seat-anchor[data-seat="E"]')).toHaveClass(/is-on/);

  await page.keyboard.press('Escape');
  await editor.locator('.se-name').focus();
  await page.keyboard.press('Shift+Tab');
  await expect(editor.locator('.se-ctrl button').last()).toBeFocused();
});

test('nested name dialog restores focus to its editor invoker', async ({ page }) => {
  await setup(page);
  await page.locator('.seat-anchor[data-seat="E"] .seat-join').click();
  await page.locator('.seat-anchor[data-seat="E"] .seat-player').click();
  const rename = page.locator('.seat-editor .se-name');
  await rename.focus();
  await rename.click();
  await expect(page.locator('.dlg-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.dlg-input')).toHaveCount(0);
  await expect(rename).toBeFocused();
});

test('closing the in-game menu restores its menu button focus', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.__lotAndRoll!.startGame(window.__lotAndRoll!.demoSettings(2, false), 7));
  const menu = page.locator('.menu-btn');
  await menu.focus();
  await menu.click();
  const sheet = page.locator('.menu-sheet');
  await expect(sheet).toBeVisible();
  await sheet.locator('.menu-item').last().focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('.menu-sheet') !== null)).toBe(true);
  await sheet.locator('.menu-x').click();
  await expect(page.locator('.menu-overlay')).not.toHaveClass(/is-open/);
  await expect(menu).toBeFocused();
});

test('rapid menu open and close does not revive its hidden focus trap', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.__lotAndRoll!.startGame(window.__lotAndRoll!.demoSettings(2, false), 7));
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('.menu-btn')!.click();
    document.querySelector<HTMLButtonElement>('.menu-x')!.click();
  });
  await expect(page.locator('.menu-overlay')).not.toHaveClass(/is-open/);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.closest('.menu-sheet') === null)).toBe(true);
});
