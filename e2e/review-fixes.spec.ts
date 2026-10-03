import { expect, test } from '@playwright/test';
import { BOARD, GROUP_COLORS, GROUP_IDS } from '../src/content/board';
import { PLAYER_COLORS } from '../src/content/palette';

test.use({ viewport: { width: 1280, height: 800 } });

test('price text meets normal-text contrast on every group color', async ({ page }) => {
  await page.goto('/?dev=1');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
  const spaces = GROUP_IDS.map((group) => BOARD.find((space) => space.group === group)!.index);
  await page.evaluate((spaces) => {
    const hook = window.__lotAndRoll!;
    hook.setAnimSpeed(0);
    hook.setPromptTimer(0);
    hook.startGame(hook.demoSettings(4, false), 11);
    const state = structuredClone(hook.getState()!);
    for (const index of spaces) state.properties[index] = { owner: 0, level: 0 };
    hook.loadState(state);
  }, spaces);
  await expect(page.locator('.board-base')).toBeVisible();
  const luminance = (rgb: number[]) => rgb.map((v) => {
    const n = v / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
  for (const [i, group] of GROUP_IDS.entries()) {
    const price = page.locator(`.sp[data-i="${spaces[i]}"] .sp-price`);
    const fill = await price.evaluate((el) => getComputedStyle(el).fill);
    const foreground = luminance(fill.match(/[\d.]+/g)!.slice(0, 3).map(Number));
    const hex = GROUP_COLORS[group];
    const background = luminance([1, 3, 5].map((p) => parseInt(hex.slice(p, p + 2), 16)));
    const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    expect(ratio, `${group} contrast`).toBeGreaterThanOrEqual(4.5);
    expect(Number(await price.getAttribute('font-size'))).toBeGreaterThanOrEqual(64);
  }
  const ownedNameFill = await page.locator('.sp-name.on-owner').first().evaluate((el) => getComputedStyle(el).fill);
  const ownedName = luminance(ownedNameFill.match(/[\d.]+/g)!.slice(0, 3).map(Number));
  for (const color of PLAYER_COLORS) {
    const band = luminance([1, 3, 5].map((p) => parseInt(color.hex.slice(p, p + 2), 16)));
    expect((Math.max(ownedName, band) + 0.05) / (Math.min(ownedName, band) + 0.05), `${color.id} owner band`).toBeGreaterThanOrEqual(4.5);
  }
});

test('initial FX coordinates reuse layout without measuring game elements', async ({ page }) => {
  await page.addInitScript(() => {
    const reads: string[] = [];
    Object.assign(window, { fxLayoutReads: reads });
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this.matches('.fx-layer,.board,.stage,.pp') && /get(?:Layer|Board|Stage|Panel)Rect/.test(new Error().stack ?? '')) {
        reads.push(this.className.toString());
      }
      return original.call(this);
    };
  });
  await page.goto('/?dev=1');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
  await page.evaluate(() => {
    const hook = window.__lotAndRoll!;
    hook.setPromptTimer(0);
    hook.startGame(hook.demoSettings(4, false), 11);
  });
  await expect(page.locator('.roll-btn')).toBeVisible();
  await page.waitForFunction(() => window.__lotAndRoll!.fx()?.atlas === 'ready');
  expect(await page.evaluate(() => (window as unknown as { fxLayoutReads: string[] }).fxLayoutReads)).toEqual([]);
});

test('resizing a game retains only the board and one icon atlas', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 450 });
  await page.addInitScript(() => {
    const urls = new Set<string>();
    Object.assign(window, { retainedPngs: urls });
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (blob instanceof Blob && blob.type === 'image/png') urls.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => { urls.delete(url); revoke(url); };
  });
  await page.goto('/?dev=1');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
  await page.evaluate(() => {
    const hook = window.__lotAndRoll!;
    hook.setPromptTimer(0);
    hook.startGame(hook.demoSettings(4, false), 4242);
  });
  const retained = () => page.evaluate(() => (window as unknown as { retainedPngs: Set<string> }).retainedPngs.size);
  await expect.poll(retained).toBe(2);
  for (let i = 1; i <= 5; i++) {
    await page.setViewportSize({ width: 800 + i * 40, height: 450 + i * 25 });
    // Let the debounced board raster and image decoding finish before counting retained URLs.
    await page.waitForTimeout(500);
    await expect.poll(retained).toBe(2);
  }
  await page.locator('.menu-btn').click();
  await page.getByRole('button', { name: '저장 후 나가기' }).click();
  await expect.poll(retained).toBe(0);
});
