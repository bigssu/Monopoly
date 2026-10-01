import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 2560, height: 1600 }, deviceScaleFactor: 3 });

test('large tablets use power-of-two game textures no larger than 2K', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const sizes: number[][] = [];
    Object.assign(window, { textureSizes: sizes });
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      if (blob instanceof Blob && blob.type === 'image/png') {
        void createImageBitmap(blob).then((image) => {
          sizes.push([image.width, image.height]);
          image.close();
        });
      }
      return create(blob);
    };
  });
  await page.goto('/?dev=1');
  await page.waitForFunction(() => !!window.__lotAndRoll && document.getElementById('app')?.dataset.screen === 'title');
  await page.evaluate(() => {
    const hook = window.__lotAndRoll!;
    hook.setPromptTimer(0);
    hook.startGame(hook.demoSettings(4, false), 4242);
  });
  const base = page.locator('img.board-base');
  await expect(base).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { textureSizes: number[][] }).textureSizes.length)).toBeGreaterThanOrEqual(2);
  const sizes = await page.evaluate(() => (window as unknown as { textureSizes: number[][] }).textureSizes);
  expect(sizes.filter(([w, h]) => w! > 1024 || h! > 1024)).toHaveLength(1);
  for (const [width, height] of sizes) {
    for (const side of [width!, height!]) {
      expect(side, `${width}x${height} texture`).toBeLessThanOrEqual(2048);
      expect(side & (side - 1), `${width}x${height} must use power-of-two sides`).toBe(0);
    }
  }
  await page.screenshot({ path: test.info().outputPath('tablet-dpr3.png') });
  expect(errors).toEqual([]);
});

test('a board slightly above 1K stays at 1K on an entry-level tablet', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.2 });
  try {
    const page = await context.newPage();
    await page.goto('/?dev=1');
    await page.waitForFunction(() => !!window.__lotAndRoll && document.getElementById('app')?.dataset.screen === 'title');
    await page.evaluate(() => {
      const hook = window.__lotAndRoll!;
      hook.setPromptTimer(0);
      hook.startGame(hook.demoSettings(4, false), 4242);
    });
    await expect(page.locator('img.board-base')).toBeVisible();
    expect(await page.locator('img.board-base').evaluate((el) => [(el as HTMLImageElement).naturalWidth, (el as HTMLImageElement).naturalHeight])).toEqual([1024, 1024]);
  } finally {
    await context.close();
  }
});

test('leaving a game releases its generated textures and effect worker', async ({ page }) => {
  const workers = new Set();
  page.on('worker', (worker) => {
    workers.add(worker);
    worker.on('close', () => workers.delete(worker));
  });
  await page.addInitScript(() => {
    const live = new Set<string>();
    Object.assign(window, { liveTextureUrls: live });
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (blob instanceof Blob && blob.type === 'image/png') live.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => { live.delete(url); revoke(url); };
  });
  await page.goto('/?dev=1');
  await page.waitForFunction(() => !!window.__lotAndRoll && document.getElementById('app')?.dataset.screen === 'title');
  await page.evaluate(() => {
    const hook = window.__lotAndRoll!;
    hook.setPromptTimer(0);
    hook.startGame(hook.demoSettings(4, false), 4242);
  });
  await page.waitForFunction(() => window.__lotAndRoll!.fx()?.atlas === 'ready');
  await expect.poll(() => page.evaluate(() => (window as unknown as { liveTextureUrls: Set<string> }).liveTextureUrls.size)).toBeGreaterThanOrEqual(2);
  await page.locator('.menu-btn').click();
  await page.getByRole('button', { name: '저장 후 나가기' }).click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
  await expect(page.locator('.screen-ghost')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { liveTextureUrls: Set<string> }).liveTextureUrls.size)).toBe(0);
  await expect.poll(() => workers.size).toBe(0);
});
