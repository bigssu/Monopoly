import { expect, test } from '@playwright/test';

test('board spaces open a labelled dialog from the keyboard and restore focus when closed', async ({ page }) => {
  await page.goto('/?dev=1');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
  await page.evaluate(() => {
    const hook = window.__lotAndRoll!;
    hook.setAnimSpeed(0);
    hook.setPromptTimer(0);
    hook.startGame(hook.demoSettings(4, false), 17);
  });

  const space = page.locator('g.sp[data-i="1"]');
  await expect(space).toHaveAttribute('role', 'button');
  await expect(space).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(space).not.toHaveAttribute('aria-label', '');
  await space.focus();
  await space.press('Enter');

  const dialog = page.locator('.info-card[role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAttribute('aria-modal');
  await expect(page.locator('.st-prompt')).toHaveAttribute('inert', '');
  await expect(dialog.locator('[data-action="close-info"]')).toBeVisible();
  await expect(dialog.locator('[data-action="close-info"]')).toHaveCSS('min-height', '48px');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.st-prompt')).not.toHaveAttribute('inert');
  await expect(space).toBeFocused();

  await space.press(' ');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-action="close-info"]').click();
  await expect(dialog).toHaveCount(0);
  await expect(space).toBeFocused();
});

test('board destination choices announce selection and activate by keyboard', async ({ page }) => {
  await page.goto('/?dev=1');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
  await page.evaluate(() => {
    const hook = window.__lotAndRoll!;
    hook.setAnimSpeed(0);
    hook.setPromptTimer(0);
    hook.startGame(hook.demoSettings(2, false), 17);
    const state = hook.getState()!;
    const playerId = state.current;
    state.properties[1] = { owner: playerId, level: 0 };
    state.properties[9] = { owner: playerId, level: 0 };
    state.phase = { kind: 'festival', playerId, options: [1, 9] };
    hook.loadState(state);
  });
  await expect(page.locator('.st-prompt .pick-row')).toHaveCount(2);
  const choice = page.locator('g.sp[data-i="9"]');
  await expect(choice).toHaveAttribute('aria-label', /선택/);
  await expect(choice).not.toHaveAttribute('aria-haspopup');
  await expect(page.locator('g.sp[data-i="2"]')).toHaveAttribute('aria-label', /정보 보기/);
  await choice.focus();
  await choice.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.getState()?.festival)).toBe(9);
});
