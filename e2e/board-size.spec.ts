import { expect, test } from '@playwright/test';
import { getBoard } from '../src/content/board';
import { reduceMotion } from './motion';

test.use({ viewport: { width: 1280, height: 800 } });

for (const spacesPerSide of [7, 8, 9] as const) {
  test(`${spacesPerSide} spaces per side render, accept taps, and survive save/resume`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await reduceMotion(page);
    await page.goto('/?dev=1');
    await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
    await page.locator('[data-action="new"]').click();
    await page.getByRole('radiogroup', { name: '한 변 칸 수' }).getByRole('radio', { name: String(spacesPerSide), exact: true }).click();

    await page.reload();
    await page.locator('[data-action="new"]').click();
    await expect(page.getByRole('radiogroup', { name: '한 변 칸 수' }).getByRole('radio', { name: String(spacesPerSide), exact: true })).toHaveAttribute('aria-checked', 'true');
    await page.evaluate(() => window.__lotAndRoll!.setPromptTimer(0));
    await page.locator('[data-action="start"]').click();

    const stride = spacesPerSide + 1;
    const total = stride * 4;
    await expect(page.locator('.board-svg > g.sp')).toHaveCount(total);
    await expect(page.locator('.board-svg > .sp-island')).toHaveAttribute('data-i', String(stride));
    await expect(page.locator('.board-svg > .sp-festival')).toHaveAttribute('data-i', String(stride * 2));
    await expect(page.locator('.board-svg > .sp-travel')).toHaveAttribute('data-i', String(stride * 3));
    await expect(page.locator('.board-base')).toBeVisible();
    expect(await page.evaluate(() => {
      const state = window.__lotAndRoll!.getState()!;
      return [state.settings.spacesPerSide, state.properties.length];
    })).toEqual([spacesPerSide, total]);

    // The opening (turn banner, dealer greeting) re-renders the stage; open the card after it.
    await page.waitForFunction(() => !window.__lotAndRoll!.isBusy());
    await page.locator(`.board-svg > .sp[data-i="${total - 1}"]`).click();
    await expect(page.locator('.info-card .pc-title')).toHaveText(getBoard(spacesPerSide)[total - 1]!.name.ko);
    await page.locator('.info-card').click();
    await page.locator('.menu-btn').click();
    await page.getByRole('button', { name: '저장 후 나가기' }).click();
    await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
    await page.reload();
    await page.locator('[data-action="continue"]').click();
    await expect(page.locator('.board-svg > g.sp')).toHaveCount(total);
    expect(await page.evaluate(() => window.__lotAndRoll!.getState()!.settings.spacesPerSide)).toBe(spacesPerSide);
    await page.screenshot({ path: test.info().outputPath(`board-${spacesPerSide}.png`), scale: 'css' });
    expect(errors).toEqual([]);
  });
}

test('circular corner only opens when its visible waypoint is tapped', async ({ page }) => {
  await reduceMotion(page);
  await page.goto('/?dev=1');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
  await page.evaluate(() => {
    const hook = window.__lotAndRoll!;
    hook.setAnimSpeed(0);
    hook.setPromptTimer(0);
    hook.startGame(hook.demoSettings(4, false), 11);
  });
  await expect(page.locator('.board-base')).toBeVisible();
  const hit = page.locator('.board-svg > .sp[data-i="0"] circle[pointer-events="all"]');
  const rect = await hit.boundingBox();
  expect(rect).not.toBeNull();
  await page.mouse.click(rect!.x + 8, rect!.y + 8);
  await expect(page.locator('.info-card')).toHaveCount(0);
  await hit.click();
  await expect(page.locator('.info-card .pc-title')).toHaveText('출발');
});

test('nine-space board keeps every ownership chip inside small four-player panels', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 450 });
  await page.goto('/?dev=1');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
  await page.evaluate(() => {
    const hook = window.__lotAndRoll!;
    hook.setAnimSpeed(0);
    hook.setPromptTimer(0);
    hook.startGame({ ...hook.demoSettings(4, false), spacesPerSide: 9 }, 11);
    const state = structuredClone(hook.getState()!);
    state.players.forEach((player) => { player.position = 1; });
    state.properties[1] = { owner: 0, level: 3 };
    hook.loadState(state);
  });
  await expect(page.locator('.pp-card')).toHaveCount(4);
  await expect(page.locator('.board-base')).toBeVisible();
  const clipped = await page.locator('.pp-card').evaluateAll((cards) => cards.flatMap((card, player) => {
    const bounds = card.getBoundingClientRect();
    return [...card.querySelectorAll('.slot')].flatMap((slot, index) => {
      const r = slot.getBoundingClientRect();
      return r.left < bounds.left - 1 || r.right > bounds.right + 1 || r.top < bounds.top - 1 || r.bottom > bounds.bottom + 1
        ? [`player ${player}, slot ${index}`] : [];
    });
  }));
  expect(clipped).toEqual([]);
  for (const panel of await page.locator('.pp').all()) await expect(panel).toHaveCSS('--member-tracks', '5');
  await page.screenshot({ path: test.info().outputPath('board-9-small-four-player.png'), scale: 'css' });
});
