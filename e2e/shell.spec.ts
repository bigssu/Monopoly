/**
 * Shell e2e: boots the app, walks Title → Setup → Rules → Settings, stores screenshots in
 * e2e/__screenshots__/ at 1600×1000 and 800×450, fails on console errors, and checks that
 * starting a game reaches the game screen.
 */
import { expect, test, type Page } from '@playwright/test';
import { reduceMotion } from './motion';

const VIEWPORTS = [
  { width: 1600, height: 1000 },
  { width: 800, height: 450 },
] as const;

const SHOTS = 'e2e/__screenshots__';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

async function boot(page: Page): Promise<void> {
  await reduceMotion(page);
  await page.goto('/?dev=1');
  await expect(page.locator('#app[data-screen="title"]')).toBeVisible();
  await expect(page.locator('#splash')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

async function shot(page: Page, name: string, vp: { width: number; height: number }): Promise<void> {
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOTS}/shell-${name}-${vp.width}x${vp.height}.png` });
}

for (const vp of VIEWPORTS) {
  test.describe(`shell @ ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    test('title, setup, rules, settings screenshots', async ({ page }) => {
      const errors = watchErrors(page);
      await boot(page);
      await shot(page, 'title', vp);

      // Title with a saved game (Continue + discard).
      await page.evaluate(() => (window as any).__lotAndRollShell.makeSampleSave(3, 6));
      await page.evaluate(() => (window as any).__lotAndRollShell.showScreen('title', {}));
      await expect(page.locator('[data-action="continue"]')).toBeVisible();
      await shot(page, 'title-continue', vp);
      await page.evaluate(() => (window as any).__lotAndRollShell.persist.clearSavedGame());
      await page.evaluate(() => (window as any).__lotAndRollShell.showScreen('title', {}));

      // Setup with 4 players.
      await page.click('[data-action="new"]');
      await expect(page.locator('#app[data-screen="setup"]')).toBeVisible();
      await shot(page, 'setup-2p', vp);
      for (const seat of ['E', 'W']) await page.click(`.seat-anchor[data-seat="${seat}"] .seat-join`);
      await expect(page.locator('.seat-anchor.is-on')).toHaveCount(4);
      await page.locator('.seat-anchor[data-seat="W"] .seat-player').click();
      await page.locator('.seat-editor [data-controller], .seat-editor .se-ctrl .seg-opt').nth(2).click();
      await page.locator('.seat-editor .se-done').click();
      await expect(page.locator('.seat-editor')).toHaveCount(0);
      await shot(page, 'setup', vp);

      // Seat editor (rotated toward the east seat) + name dialog.
      await page.locator('.seat-anchor[data-seat="E"] .seat-player').click();
      await expect(page.locator('.seat-editor')).toBeVisible();
      await page.locator('.seat-editor .se-token[data-token="whale"]').click();
      await page.locator('.seat-editor .se-color[data-color="purple"]').click();
      await shot(page, 'setup-editor-east', vp);
      await page.locator('.seat-editor .se-name').click();
      await page.locator('.dlg-input').fill('민지');
      await shot(page, 'setup-name', vp);
      await page.locator('.dlg-input').press('Enter');
      await page.locator('.seat-editor .se-done').click();
      await expect(page.locator('.seat-anchor[data-seat="E"] .seat-name')).toHaveText('민지');

      // Rules.
      await page.goto('/?dev=1');
      await expect(page.locator('#app[data-screen="title"]')).toBeVisible();
      await page.click('[data-action="rules"]');
      await expect(page.locator('#app[data-screen="rules"]')).toBeVisible();
      await shot(page, 'rules-1', vp);
      for (let i = 2; i <= 7; i++) {
        await page.click('[data-action="next"]');
        await shot(page, `rules-${i}`, vp);
      }
      await page.click('[data-action="next"]'); // "Got it" → back to title
      await expect(page.locator('#app[data-screen="title"]')).toBeVisible();

      // Settings.
      await page.click('[data-action="settings"]');
      await expect(page.locator('#app[data-screen="settings"]')).toBeVisible();
      await shot(page, 'settings', vp);
      await page.click('[data-action="licenses"]');
      await expect(page.locator('.lic')).toBeVisible();
      await shot(page, 'licenses', vp);

      expect(errors, errors.join('\n')).toEqual([]);
    });
  });
}

test.describe('start a game', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('adds an AI player and starts its turn', async ({ page }) => {
    const errors = watchErrors(page);
    await boot(page);
    await page.click('[data-action="new"]');

    const addAi = page.locator('[data-action="add-ai"]');
    await expect(addAi).toBeEnabled();
    await addAi.click();
    await expect(page.locator('.seat-anchor.is-on')).toHaveCount(3);
    await expect(page.locator('.seat-anchor[data-seat="E"] .seat-ctrl')).toHaveText('AI 보통');

    await page.locator('.seat-anchor[data-seat="E"] .seat-player').click();
    await page.locator('.seat-editor .se-ctrl .seg-opt').nth(1).click();
    await page.locator('.seat-editor .se-done').click();
    await expect(page.locator('.seat-anchor[data-seat="E"] .seat-ctrl')).toHaveText('AI 쉬움');

    await page.click('.seat-anchor[data-seat="W"] .seat-join');
    await expect(addAi).toBeDisabled();
    await page.evaluate(() => {
      Math.random = () => 0.4;
    });
    await page.click('[data-action="start"]');
    await expect(page.locator('#app[data-screen="game"]')).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const state = window.__lotAndRoll!.getState()!;
      return {
        currentIsAi: state.players[state.current]!.isCpu,
        east: state.players.find((player) => player.seat === 'E'),
        turn: state.turn,
      };
    })).toMatchObject({ currentIsAi: false, east: { isCpu: true, cpuLevel: 'easy' }, turn: 2 });
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('setup → game screen', async ({ page }) => {
    const errors = watchErrors(page);
    await boot(page);
    await page.click('[data-action="new"]');
    await page.click('[data-action="start"]');
    await expect(page.locator('#app[data-screen="game"]')).toBeVisible();
    const stub = await page.locator('[data-stub="game"]').count();
    if (stub) {
      test.info().annotations.push({ type: 'note', description: 'Game screen is still the shell stub; skipped game checks.' });
      test.skip(true, 'game screen stub');
    }
    await page.waitForTimeout(800);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('language switch to English', async ({ page }) => {
    const errors = watchErrors(page);
    await boot(page);
    await page.click('[data-action="settings"]');
    await page.getByRole('radio', { name: 'English' }).click();
    await expect(page.locator('.settings-title')).toHaveText('Settings');
    await page.keyboard.press('Escape');
    await expect(page.locator('#app[data-screen="title"]')).toBeVisible();
    await expect(page.locator('.title-word')).toHaveText('Land Poly');
    await page.setViewportSize({ width: 800, height: 450 });
    await page.screenshot({ path: `${SHOTS}/shell-title-en-800x450.png` });
    await page.click('[data-action="new"]');
    await page.screenshot({ path: `${SHOTS}/shell-setup-en-800x450.png` });
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
