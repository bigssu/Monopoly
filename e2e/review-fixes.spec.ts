import { expect, test } from '@playwright/test';
import { BOARD, GROUP_IDS } from '../src/content/board';
import { PLAYER_COLORS } from '../src/content/palette';
import { checkOwnedBoard } from './owned-board';

test.use({ viewport: { width: 1280, height: 800 } });

test('price text meets normal-text contrast on every group color', async ({ page }) => {
  await page.goto('/?dev=1');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
  const spaces = GROUP_IDS.map((group) => BOARD.find((space) => space.group === group)!.index);
  // One space of every group, owned by each of the four players in turn (red, blue, green, yellow).
  await page.evaluate((spaces) => {
    const hook = window.__lotAndRoll!;
    hook.setAnimSpeed(0);
    hook.setPromptTimer(0);
    hook.startGame(hook.demoSettings(4, false), 11);
    const state = structuredClone(hook.getState()!);
    spaces.forEach((index, k) => (state.properties[index] = { owner: k % 4, level: 0 }));
    hook.loadState(state);
  }, spaces);
  await expect(page.locator('.board-base')).toBeVisible();
  const luminance = (rgb: number[]) => rgb.map((v) => {
    const n = v / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
  const colors = await page.evaluate(() => window.__lotAndRoll!.getState()!.players.map((p) => p.colorId));
  for (const [i, group] of GROUP_IDS.entries()) {
    // The price sits on the owner-filled card (DESIGN.md §3 "Ownership and buildings").
    const price = page.locator(`.sp[data-i="${spaces[i]}"] .sp-price`);
    const fill = await price.evaluate((el) => getComputedStyle(el).fill);
    const foreground = luminance(fill.match(/[\d.]+/g)!.slice(0, 3).map(Number));
    const hex = PLAYER_COLORS.find((c) => c.id === colors[i % 4])!.hex;
    const background = luminance([1, 3, 5].map((p) => parseInt(hex.slice(p, p + 2), 16)));
    const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    expect(ratio, `${group} price on ${colors[i % 4]}`).toBeGreaterThanOrEqual(4.5);
    expect(Number(await price.getAttribute('font-size'))).toBeGreaterThanOrEqual(64);
  }
  // Names and prices on every owned card, against that card's owner color (computed colors).
  const owned = await checkOwnedBoard(page);
  expect(owned.problems, owned.problems.join('\n')).toEqual([]);
  expect(owned.owned).toBe(spaces.length);
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
  await expect(page.locator('.roll-pad')).toBeVisible();
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
