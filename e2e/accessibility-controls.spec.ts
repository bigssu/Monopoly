import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

async function boot(page: import('@playwright/test').Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?dev=1');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
}

test('viewport permits user zoom and Setup radios use roving keyboard focus', async ({ page }) => {
  await boot(page);
  await expect(page.locator('meta[name="viewport"]')).not.toHaveAttribute('content', /user-scalable=no/);

  await page.locator('[data-action="new"]').click();
  const spaces = page.getByRole('radiogroup', { name: '한 변 칸 수' });
  const selected = spaces.getByRole('radio', { checked: true });
  await selected.focus();
  await page.keyboard.press('ArrowRight');
  await expect(spaces.getByRole('radio', { checked: true })).toBeFocused();

  await page.locator('.seat-anchor[data-seat="E"] .seat-join').click();
  await page.locator('.seat-anchor[data-seat="E"] .seat-player').click();
  const tokens = page.locator('.se-tokens');
  await tokens.getByRole('radio', { checked: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tokens.getByRole('radio', { checked: true })).toBeFocused();
});

test('Rules tabs hide inactive slides and support roving keyboard navigation', async ({ page }) => {
  await boot(page);
  await page.locator('[data-action="rules"]').click();
  const tabs = page.getByRole('tablist').getByRole('tab');
  await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
  await expect(page.locator('.rp').nth(1)).toHaveAttribute('inert', '');
  await expect(page.locator('.rp').nth(1)).toHaveAttribute('aria-hidden', 'true');

  const first = tabs.nth(0);
  await first.focus();
  await page.keyboard.press('End');
  await expect(tabs.nth(5)).toBeFocused();
  await expect(tabs.nth(5)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(0)).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('.rp').nth(0)).toHaveAttribute('inert', '');
  await expect(page.locator('.rp').nth(5)).not.toHaveAttribute('inert', '');
});

test('language radio retains keyboard focus after localized rerender', async ({ page }) => {
  await boot(page);
  await page.locator('[data-action="settings"]').click();
  const language = page.getByRole('radiogroup', { name: '언어' });
  await language.getByRole('radio', { checked: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.settings-title')).toHaveText('Settings');
  await expect(page.getByRole('radiogroup', { name: 'Language' }).getByRole('radio', { checked: true })).toBeFocused();
});
