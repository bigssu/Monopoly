/**
 * Game screen e2e (GAME agent). Uses the dev hook `window.__lotAndRoll` (enabled by `?dev=1`).
 *  - a seeded 4-CPU game at animation speed 0 reaches gameOver with zero console errors
 *  - screenshots (1600×1000, 2560×1600, 1024×768, 800×450): mid-game, stage facing S/E/N/W,
 *    a normal-speed animation frame, and the result screen → e2e/__screenshots__/game-*.png
 */
import { expect, test, type Page } from '@playwright/test';
import { OWNED_SAMPLE, checkOwnedBoard, craftOwned } from './owned-board';

const VIEWPORTS = [
  { w: 1600, h: 1000 },
  { w: 2560, h: 1600 },
  { w: 1024, h: 768 },
  { w: 800, h: 450 },
] as const;
const SHOTS = 'e2e/__screenshots__';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // The browser's own favicon probe is not an app error.
    if (/favicon/.test(m.location().url) || (/Failed to load resource/.test(m.text()) && /favicon/.test(m.location().url ?? ''))) return;
    if (/Failed to load resource/.test(m.text()) && !m.location().url) return;
    errors.push(`${m.text()} @ ${m.location().url}`);
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function boot(page: Page, w: number, h: number): Promise<void> {
  await page.setViewportSize({ width: w, height: h });
  await page.goto('/?dev=1');
  await page.waitForFunction(() => !!window.__lotAndRoll && !!document.getElementById('app')?.dataset.screen, null, {
    timeout: 20_000,
  });
  await page.evaluate(() => document.fonts.ready);
}

/** Start a seeded game (all CPU or all human) at the given animation speed. */
async function start(page: Page, opts: { seed: number; cpu: boolean; players?: number; speed: number }): Promise<void> {
  await page.evaluate(({ seed, cpu, players, speed }) => {
    const hook = window.__lotAndRoll!;
    hook.setAnimSpeed(speed);
    hook.setPromptTimer(0);
    hook.startGame(hook.demoSettings(players, cpu), seed);
  }, { seed: opts.seed, cpu: opts.cpu, players: opts.players ?? 4, speed: opts.speed });
  await page.waitForSelector('.game .board');
}

/** Drive an all-human game with the CPU policy until `pred` holds (checked while idle). */
async function driveUntil(page: Page, fn: string, arg: unknown, maxSteps = 600): Promise<boolean> {
  return page.evaluate(
    async ({ fn, arg, maxSteps }) => {
      const hook = window.__lotAndRoll!;
      const pred = new Function('s', 'arg', fn) as (s: unknown, a: unknown) => boolean;
      for (let i = 0; i < maxSteps; i++) {
        await hook.whenIdle();
        const s = hook.getState() as { phase: { kind: string } } | null;
        if (!s || s.phase.kind === 'gameOver') return false;
        if (pred(s, arg)) return true;
        await hook.autoStep();
      }
      return false;
    },
    { fn, arg, maxSteps },
  );
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => window.__lotAndRoll!.whenIdle());
  await page.waitForTimeout(450);
}

test.describe('game screen', () => {
  test('a seeded 4-CPU game plays to the end without errors', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    await boot(page, 1600, 1000);
    await start(page, { seed: 4242, cpu: true, speed: 0 });
    await page.waitForFunction(() => window.__lotAndRoll!.getState()?.phase.kind === 'gameOver' || window.__lotAndRoll!.screen() === 'result', null, {
      timeout: 150_000,
      polling: 250,
    });
    await page.waitForFunction(() => window.__lotAndRoll!.screen() === 'result', null, { timeout: 15_000 });
    await expect(page.locator('.rs-card')).toBeVisible();
    await expect(page.locator('.rs-row')).toHaveCount(4);
    for (const v of VIEWPORTS) {
      await page.setViewportSize({ width: v.w, height: v.h });
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${SHOTS}/game-result-${v.w}x${v.h}.png` });
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });

  for (const v of VIEWPORTS) {
    test(`mid-game layout ${v.w}x${v.h}`, async ({ page }) => {
      test.setTimeout(120_000);
      const errors = watchErrors(page);
      await boot(page, v.w, v.h);
      await start(page, { seed: 31, cpu: false, speed: 0 });
      // ~30 turns in, stop on a human prompt that is not a plain roll if possible.
      await driveUntil(page, 'return s.turn >= 30 && s.phase.kind !== "preRoll";', null, 400);
      await settle(page);
      await page.screenshot({ path: `${SHOTS}/game-mid-${v.w}x${v.h}.png` });
      // Nothing may spill out of the viewport horizontally/vertically.
      const overflow = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll('.pp, .board')) {
          const r = el.getBoundingClientRect();
          if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(el.className);
        }
        return out;
      });
      expect(overflow).toEqual([]);
      const owned = await checkOwnedBoard(page);
      expect(owned.problems, owned.problems.join('\n')).toEqual([]);
      expect(owned.owned).toBeGreaterThan(0);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }

  for (const v of [VIEWPORTS[0], VIEWPORTS[3]]) {
    test(`owned spaces ${v.w}x${v.h}: owner-color cards, pop-out buildings on every side`, async ({ page }) => {
      const errors = watchErrors(page);
      await boot(page, v.w, v.h);
      await start(page, { seed: 31, cpu: false, speed: 0 });
      await craftOwned(page, OWNED_SAMPLE);
      const owned = await checkOwnedBoard(page);
      expect(owned.problems, owned.problems.join('\n')).toEqual([]);
      expect(owned.owned).toBe(Object.keys(OWNED_SAMPLE).length);
      expect(owned.buildings).toBe(Object.values(OWNED_SAMPLE).filter(([, l]) => l > 0).length);
      // Table view: each building is upright for its side's reader (the space text's rotation).
      const rots = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll<HTMLElement>('.bb')].map((b) => [b.dataset.i, getComputedStyle(b).rotate])));
      expect(rots['4']).toBe('none');
      expect(rots['10']).toBe('90deg');
      expect(rots['19']).toBe('180deg');
      expect(rots['28']).toBe('-90deg');
      // Selling back to the bank returns the card to the empty look (no fill, no building).
      await page.evaluate(() => {
        const hook = window.__lotAndRoll!;
        const s = structuredClone(hook.getState()!);
        s.properties[28] = { owner: null, level: 0 };
        hook.loadState(s);
      });
      await page.waitForFunction(() => !document.querySelector('.bb[data-i="28"]'));
      const after = await checkOwnedBoard(page);
      expect(after.problems, after.problems.join('\n')).toEqual([]);
      await page.screenshot({ path: `${SHOTS}/game-owned-${v.w}x${v.h}.png` });
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }

  test('stage faces each acting seat (S/E/N/W)', async ({ page }) => {
    test.setTimeout(150_000);
    const errors = watchErrors(page);
    for (const v of [VIEWPORTS[0], VIEWPORTS[3]]) {
      await boot(page, v.w, v.h);
      await start(page, { seed: 77, cpu: false, speed: 0 });
      for (const seat of ['S', 'E', 'N', 'W']) {
        const ok = await driveUntil(
          page,
          'const p = s.players[s.phase.playerId]; return s.turn > 6 && p.seat === arg && ["buy","build","takeover","island","festival","travel","debt"].includes(s.phase.kind);',
          seat,
          500,
        );
        if (!ok) await driveUntil(page, 'return s.players[s.phase.playerId].seat === arg;', seat, 50);
        await settle(page);
        await page.screenshot({ path: `${SHOTS}/game-seat-${seat}-${v.w}x${v.h}.png` });
        const rot = await page.evaluate(() => (document.querySelector('.stage') as HTMLElement).dataset.seat);
        expect(rot).toBe(seat);
        await page.evaluate(() => window.__lotAndRoll!.autoStep());
      }
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('normal-speed animations run cleanly', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = watchErrors(page);
    await boot(page, 1600, 1000);
    await start(page, { seed: 9, cpu: true, speed: 1.5 });
    await page.waitForTimeout(9000);
    await page.screenshot({ path: `${SHOTS}/game-anim-1600x1000.png` });
    // Tap to fast-forward, then let it keep playing.
    await page.mouse.click(800, 500);
    await page.waitForTimeout(6000);
    const s = await page.evaluate(() => window.__lotAndRoll!.getState()?.turn ?? 0);
    expect(s).toBeGreaterThan(2);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
