/**
 * Rules version 3, strategy mode (docs/research/10-strategy-depth.md), played by tapping the real
 * controls: the setup screen's mode choice and its "?" bubble, the start investment (board pick),
 * the set alert (outlined set, round line) and an opponent's block-buy from the pre-roll strip, the
 * takeover multiplier and its reason, the news forecast on the round line, the vault cap on the
 * Start info. The dev hook only loads hand-crafted states (queued dice / picks) and reads the state.
 * Screenshots → e2e/__screenshots__/v3-*.png
 */
import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../src/engine/types';
import { boot, watchConsole } from './helpers';

const SHOTS = 'e2e/__screenshots__';

async function bootFast(page: Page): Promise<void> {
  // Strategy mode shows the skill-throw guide at a human's first roll; these specs roll by keyboard.
  await page.addInitScript(() => {
    try {
      const key = 'lotandroll:prefs:v1';
      localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? '{}'), skillGuideSeen: true }));
    } catch {
      /* storage blocked */
    }
  });
  await boot(page, { w: 1600, h: 1000 });
  await page.evaluate(() => {
    window.__lotAndRoll!.setAnimSpeed(2);
    window.__lotAndRoll!.setPromptTimer(0);
  });
}

async function getState(page: Page): Promise<GameState> {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__lotAndRoll!.getState())) as GameState);
}

/** Wait until the game waits for a person; event cards are tapped away. */
async function waitIdle(page: Page): Promise<void> {
  for (let k = 0; k < 2000; k++) {
    const st = await page.evaluate(() => ({ busy: window.__lotAndRoll!.isBusy(), card: !!document.querySelector('.ev-card-inner.is-flipped') }));
    if (st.card) await page.locator('.ev-card').click({ timeout: 1500 }).catch(() => undefined);
    if (!st.busy) break;
    await page.waitForTimeout(20);
  }
  await page.evaluate(() => window.__lotAndRoll!.whenIdle());
}

/** A fresh all-human strategy-mode game (4 seats), patched by `patch`. */
async function loadCrafted(page: Page, patch: string): Promise<void> {
  await page.evaluate(
    ({ patch }) => {
      const hook = window.__lotAndRoll!;
      hook.startGame({ ...hook.demoSettings(4, false), rules: 'advanced', rulesVersion: 3 } as never, 7);
      const s = hook.getState()!;
      new Function('s', patch)(s);
      hook.loadState(s);
    },
    { patch },
  );
  await page.waitForSelector('.game .board');
  await waitIdle(page);
}

/** A plain roll: the keyboard on the pad (a weak toss; no stride / aim chosen). */
async function roll(page: Page): Promise<void> {
  await page.locator('.stage [data-action="Roll"]').first().click();
  await waitIdle(page);
}

test.describe('strategy mode (rules version 3)', () => {
  test.use({ actionTimeout: 10_000 });

  test('setup: casual / strategy with a description and a "?" bubble; strategy starts the advanced rules', async ({ page }) => {
    const logs = watchConsole(page, { warnings: true });
    await boot(page, { w: 1600, h: 1000 });
    await page.click('[data-action="new"]');
    await expect(page.locator('#app[data-screen="setup"]')).toBeVisible();
    await expect(page.locator('.opt-card')).toContainText('게임 모드');
    await expect(page.locator('.opt-card .seg-opt[aria-checked="true"]').filter({ hasText: '캐주얼 모드' })).toHaveCount(1);
    await expect(page.locator('.opt-level-note')).toHaveText('규칙이 가볍고 빠른 한 판');
    await page.locator('.opt-card .seg-opt').filter({ hasText: '전략 모드' }).click();
    await expect(page.locator('.opt-level-note')).toContainText('보폭 선택');
    // The bubble: tap "?" to open, an outside tap closes it.
    await page.locator('.mode-help').click();
    await expect(page.locator('.mode-bubble')).toBeVisible();
    await expect(page.locator('.mode-bubble')).toContainText('견제 매입');
    await page.screenshot({ path: `${SHOTS}/v3-setup-modes-1600x1000.png` });
    await page.locator('.setup-title').click();
    await expect(page.locator('.mode-bubble')).toBeHidden();
    await page.locator('.mode-help').click();
    await expect(page.locator('.mode-bubble')).toBeVisible();
    await page.locator('.mode-help').click();
    await expect(page.locator('.mode-bubble')).toBeHidden();
    await page.click('[data-action="start"]');
    await page.waitForSelector('.game .board');
    const s = await getState(page);
    expect(s.settings).toMatchObject({ rules: 'advanced', rulesVersion: 3 });
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('start investment: passing Start offers a city a level; tap it on the board', async ({ page }) => {
    test.setTimeout(120_000);
    const logs = watchConsole(page, { warnings: true });
    await bootFast(page);
    // 28 → 2 (an empty city, declined) passing Start; the current player owns Cairo (4).
    await loadCrafted(page, `const me = s.players[s.current]; me.position = 28; me.cash = 3000; s.properties[4] = { owner: me.id, level: 0 }; s.testHooks = { diceQueue: [[2, 4]] };`);
    await roll(page);
    expect((await getState(page)).phase.kind).toBe('buy');
    await page.locator('.st-prompt [data-action="Pass"]').click();
    await waitIdle(page);
    let s = await getState(page);
    expect(s.phase).toMatchObject({ kind: 'invest', options: [4] });
    await expect(page.locator('.pc-invest')).toContainText('출발 투자');
    await expect(page.locator('.board-svg g.sp.is-pick[data-i="4"]')).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}/v3-invest-1600x1000.png` });
    const me = s.current;
    await page.locator('.board-svg g.sp[data-i="4"]').click();
    await waitIdle(page);
    s = await getState(page);
    expect(s.properties[4]).toEqual({ owner: me, level: 1 });
    expect(s.players[me]!.cash).toBe(3000 + 300 - 80);
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('set alert: completing a line announces it; the next player block-buys a city from the pre-roll strip', async ({ page }) => {
    test.setTimeout(150_000);
    const logs = watchConsole(page, { warnings: true });
    await bootFast(page);
    // The current player holds side A but Hanoi (2) and lands on it from 31 (passing Start).
    await loadCrafted(
      page,
      `const me = s.players[s.current]; me.position = 31; me.cash = 3000;
       for (const i of [1, 4, 6, 7]) s.properties[i] = { owner: me.id, level: 0 };
       s.players[(s.current + 1) % 4].cash = 5000;
       s.testHooks = { diceQueue: [[1, 2]] };`,
    );
    const owner = (await getState(page)).current;
    await roll(page);
    await page.locator('.st-prompt [data-action="Buy"]').click();
    await expect(page.locator('.st-stamp, .stamp').filter({ hasText: '독점 예고' }).first()).toBeVisible({ timeout: 15_000 });
    await waitIdle(page);
    let s = await getState(page);
    expect(s.pendingWins).toEqual([expect.objectContaining({ playerId: owner, victory: 'line', side: 'A', members: [1, 2, 4, 6, 7] })]);
    await expect(page.locator('.bmark.bm-notice')).toHaveCount(5);
    // Decline the start investment and the build: the turn passes.
    for (let k = 0; k < 3 && (await getState(page)).current === owner; k++) {
      await page.locator('.st-prompt [data-action="Pass"]').first().click();
      await waitIdle(page);
    }
    s = await getState(page);
    const blocker = s.current;
    expect(blocker).toBe((owner + 1) % 4);
    await expect(page.locator('.st-round')).toContainText('독점 예고');
    await expect(page.locator('.pc-block')).toContainText('독점 예고');
    await page.screenshot({ path: `${SHOTS}/v3-set-alert-1600x1000.png` });
    await page.locator('.pc-block [data-action="block-open"]').click();
    await expect(page.locator('.pc-block [data-action="Counterbuy"]')).toHaveCount(5);
    await expect(page.locator('.board-svg g.sp.is-pick[data-i="1"]')).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}/v3-block-buy-1600x1000.png` });
    await page.locator('.board-svg g.sp[data-i="1"]').click();
    await expect(page.locator('.st-toast').filter({ hasText: '견제 성공' }).first()).toBeVisible({ timeout: 20_000 });
    await waitIdle(page);
    s = await getState(page);
    expect(s.properties[1]!.owner).toBe(blocker);
    expect(s.pendingWins).toBeUndefined();
    expect(s.phase).toMatchObject({ kind: 'preRoll', playerId: blocker });
    await expect(page.locator('.bmark.bm-notice')).toHaveCount(0);
    await expect(page.locator('.pc-block')).toHaveCount(0);
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('chase takeover: a poorer buyer sees the discount and why', async ({ page }) => {
    test.setTimeout(120_000);
    const logs = watchConsole(page, { warnings: true });
    await bootFast(page);
    await loadCrafted(
      page,
      `const me = s.players[s.current]; me.position = 4; me.cash = 1500;
       const rich = s.players[(s.current + 1) % 4]; rich.cash = 9000;
       s.properties[9] = { owner: rich.id, level: 1 };
       s.testHooks = { diceQueue: [[2, 3]] };`,
    );
    await roll(page);
    const s = await getState(page);
    expect(s.phase).toMatchObject({ kind: 'takeover', multiplier: 1.5, why: 'chase', price: 540 });
    await expect(page.locator('.pc-takeover')).toContainText('자산 차이로 1.5배 (할인)');
    await page.screenshot({ path: `${SHOTS}/v3-chase-takeover-1600x1000.png` });
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('news forecast on the round line; the vault cap on the Start info', async ({ page }) => {
    test.setTimeout(120_000);
    const logs = watchConsole(page, { warnings: true });
    await bootFast(page);
    // The last seat's turn in round 2: round 3 starts and forecasts round 4's headline.
    await loadCrafted(page, `s.round = 2; s.current = 3; s.phase = { kind: 'preRoll', playerId: 3, rollAgain: false };
       s.players[3].position = 9; s.testHooks = { diceQueue: [[1, 2]], pickQueue: [1] };`);
    await roll(page);
    await page.locator('.st-prompt [data-action="Pass"]').click();
    await expect(page.locator('.st-toast').filter({ hasText: '다음 라운드 예보' }).first()).toBeVisible({ timeout: 15_000 });
    await waitIdle(page);
    const s = await getState(page);
    expect(s.newsForecast).toEqual({ id: 'buildBoom', round: 4 });
    await expect(page.locator('.st-round')).toContainText('예보: 건설 붐');
    await page.screenshot({ path: `${SHOTS}/v3-forecast-1600x1000.png` });
    await page.locator('.board-svg g.sp[data-i="0"]').click();
    await expect(page.locator('.info-card')).toContainText('상한 500');
    expect(logs, logs.join('\n')).toEqual([]);
  });
});
