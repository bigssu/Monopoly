import { expect, test, type Page } from '@playwright/test';

const viewports = [
  { width: 640, height: 360 },
  { width: 800, height: 450 },
  { width: 1280, height: 800 },
] as const;
const seats = ['S', 'E', 'N', 'W'] as const;

async function openSetup(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?dev=1');
  await expect(page.locator('#app[data-screen="title"]')).toBeVisible();
  await page.locator('[data-action="new"]').click();
  await page.waitForTimeout(650);
  for (const seat of ['E', 'W']) {
    await page.locator(`.seat-anchor[data-seat="${seat}"] .seat-join`).click();
  }
  await page.waitForTimeout(650);
}

async function expectEditorReachable(page: Page): Promise<void> {
  const editor = page.locator('.seat-editor');
  const bounds = await editor.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return { rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, width: style.width, maxHeight: style.maxHeight };
  });
  if (bounds.scrollHeight > bounds.clientHeight) {
    expect(bounds.clientHeight).toBeGreaterThan(0);
  } else {
    expect(bounds.rect.left).toBeGreaterThanOrEqual(-1);
    expect(bounds.rect.top).toBeGreaterThanOrEqual(-1);
    expect(bounds.rect.right).toBeLessThanOrEqual((page.viewportSize()!.width) + 1);
    expect(bounds.rect.bottom, JSON.stringify(bounds)).toBeLessThanOrEqual((page.viewportSize()!.height) + 1);
  }

  for (const control of await editor.locator('button').all()) {
    await control.scrollIntoViewIfNeeded();
    const rect = await control.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeGreaterThanOrEqual(-1);
    expect(rect!.y).toBeGreaterThanOrEqual(-1);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  }
}

for (const viewport of viewports) {
  test(`seat editors remain usable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openSetup(page);

    for (const seat of seats) {
      await page.locator(`.seat-anchor[data-seat="${seat}"] .seat-player`).click();
      await expect(page.locator('.seat-editor')).toHaveAttribute('data-seat', seat);
      await page.waitForTimeout(650);
      await expectEditorReachable(page);
      await page.locator('.seat-editor .se-color').first().click();
      await page.locator('.seat-editor .se-ctrl').getByRole('radio', { name: '사람' }).click();
      await page.locator('.seat-editor .se-done').click();
      await expect(page.locator('.seat-editor')).toHaveCount(0);
    }
  });
}
