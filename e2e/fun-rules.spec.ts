/**
 * Rules version 2 (docs/research/08-fun-analysis.md), played by clicking the real controls: all or
 * nothing at the tax office, the doubles bonus card, the comeback card offer + land swap + leader
 * raid, the news flash and its round tag, and the win-back takeover (advanced). The dev hook only
 * loads hand-crafted states (with queued dice / cards / picks) and reads the state.
 * Screenshots → e2e/__screenshots__/fun-*.png
 */
import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../src/engine/types';
import { boot, watchConsole } from './helpers';

const SHOTS = 'e2e/__screenshots__';

/** Boot at 1600×1000, animations ×2, no prompt timer, the skill guide seen. */
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

/** A fresh all-human game (4 seats, normal rules version 2 unless `settings` says otherwise), patched by `patch`. */
async function loadCrafted(page: Page, settings: Record<string, unknown>, patch: string): Promise<void> {
  await page.evaluate(
    ({ settings, patch }) => {
      const hook = window.__lotAndRoll!;
      hook.startGame({ ...hook.demoSettings(4, false), ...settings } as never, 7);
      const s = hook.getState()!;
      new Function('s', patch)(s);
      hook.loadState(s);
    },
    { settings, patch },
  );
  await page.waitForSelector('.game .board');
  await waitIdle(page);
}

async function roll(page: Page): Promise<void> {
  await page.locator('.stage [data-action="Roll"]').click();
  await waitIdle(page);
}

test.describe('fun rules (rules version 2)', () => {
  test.use({ actionTimeout: 10_000 });

  test('all or nothing: the tax prompt, a winning roll and a sure payment', async ({ page }) => {
    test.setTimeout(120_000);
    const logs = watchConsole(page, { warnings: true });
    await bootFast(page);
    // 18 → 23 (tax office) with 2 000 cash; the gamble's die is the first die of the next queued roll.
    await loadCrafted(page, {}, `const me = s.players[s.current]; me.position = 18; me.cash = 2000; s.testHooks = { diceQueue: [[2, 3], [5, 1]] };`);
    await roll(page);
    let s = await getState(page);
    expect(s.phase).toMatchObject({ kind: 'gamble', tax: 200 });
    await expect(page.locator('.pc-gamble [data-action="Gamble"]')).toBeEnabled();
    await expect(page.locator('.pc-gamble [data-action="Pass"]')).toHaveText(/그냥 내기/);
    await page.screenshot({ path: `${SHOTS}/fun-gamble-1600x1000.png` });
    const me = s.current;
    await page.locator('.pc-gamble [data-action="Gamble"]').click();
    await expect(page.locator('.st-stamp, .stamp').filter({ hasText: /면제/ }).first()).toBeVisible({ timeout: 10_000 });
    await waitIdle(page);
    s = await getState(page);
    expect(s.players[me]!.cash).toBe(2000);
    // The sure payment goes into the donation pot.
    await loadCrafted(page, {}, `const me = s.players[s.current]; me.position = 18; me.cash = 2000; s.pot = 0; s.testHooks = { diceQueue: [[2, 3]] };`);
    await roll(page);
    await page.locator('.pc-gamble [data-action="Pass"]').click();
    await waitIdle(page);
    s = await getState(page);
    expect(s.pot).toBe(200);
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('doubles bonus card: after the landing, a card to pick, then the extra roll', async ({ page }) => {
    test.setTimeout(120_000);
    const logs = watchConsole(page, { warnings: true });
    await bootFast(page);
    await loadCrafted(page, {}, `s.players[s.current].position = 0; s.testHooks = { diceQueue: [[2, 2]], cardQueue: ['bank-dividend', 'fine'] };`);
    await roll(page);
    expect((await getState(page)).phase.kind).toBe('buy');
    await page.locator('.st-prompt [data-action="Pass"]').click();
    await waitIdle(page);
    let s = await getState(page);
    expect(s.phase).toMatchObject({ kind: 'cardChoice', bonus: true });
    await expect(page.locator('.pc-cardpick .pc-tags')).toContainText('더블 보너스');
    await page.screenshot({ path: `${SHOTS}/fun-bonus-card-1600x1000.png` });
    await page.locator('.st-prompt [data-action="ChooseCard"][data-card="bank-dividend"]').click();
    await waitIdle(page);
    s = await getState(page);
    expect(s.phase).toMatchObject({ kind: 'preRoll', rollAgain: true });
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('comeback cards: the last player is offered one; land swap by tapping the city; leader raid', async ({ page }) => {
    test.setTimeout(150_000);
    const logs = watchConsole(page, { warnings: true });
    await bootFast(page);
    // The current player is far behind (owns Manila only); the next player owns Seoul (L2).
    const setup = (card: string) => `const me = s.players[s.current]; me.position = 0; me.cash = 300;
       const rich = s.players[(s.current + 1) % 4]; rich.cash = 6000;
       s.properties[1] = { owner: me.id, level: 1 };
       s.properties[31] = { owner: rich.id, level: 2 };
       s.testHooks = { diceQueue: [[1, 2]], cardQueue: ['${card}', 'fine'] };`;
    await loadCrafted(page, {}, setup('swap'));
    await roll(page);
    let s = await getState(page);
    expect(s.phase).toMatchObject({ kind: 'cardChoice', underdog: true, options: ['swap', 'fine'] });
    await expect(page.locator('.pc-cardpick .pc-tags')).toContainText('역전 기회');
    await page.screenshot({ path: `${SHOTS}/fun-comeback-offer-1600x1000.png` });
    const me = s.current;
    await page.locator('.st-prompt [data-action="ChooseCard"][data-card="swap"]').click();
    await waitIdle(page);
    s = await getState(page);
    expect(s.phase).toMatchObject({ kind: 'target', card: 'swap', options: [31] });
    await expect(page.locator('.pc-swap')).toContainText('마닐라');
    await expect(page.locator('.board-svg g.sp.is-pick[data-i="31"]')).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}/fun-swap-1600x1000.png` });
    await page.locator('.board-svg g.sp[data-i="31"]').click();
    await waitIdle(page);
    s = await getState(page);
    expect(s.properties[31]).toEqual({ owner: me, level: 2 });
    expect(s.properties[1]!.owner).toBe((me + 1) % 4);

    await loadCrafted(page, {}, setup('raid'));
    const raider = (await getState(page)).current;
    await roll(page);
    await page.locator('.st-prompt [data-action="ChooseCard"][data-card="raid"]').click();
    await waitIdle(page);
    s = await getState(page);
    // 20% of the leader's 6 000.
    expect(s.players[raider]!.cash).toBe(300 + 1200);
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('news flash: a headline at the start of round 4, its tag on the round line; a quake', async ({ page }) => {
    test.setTimeout(150_000);
    const logs = watchConsole(page, { warnings: true });
    await bootFast(page);
    // The last seat's turn in round 3; it lands on an unowned city and passes, then round 4 starts.
    const atRound3 = (pick: string, extra = '') => `s.round = 3; s.current = 3; s.phase = { kind: 'preRoll', playerId: 3, rollAgain: false };
       s.players[3].position = 0; ${extra} s.testHooks = { diceQueue: [[1, 3]], pickQueue: [${pick}] };`;
    await loadCrafted(page, {}, atRound3('0'));
    const pot0 = (await getState(page)).pot;
    await roll(page);
    await page.locator('.st-prompt [data-action="Pass"]').click();
    await expect(page.locator('.st-toast').filter({ hasText: '뉴스 속보' }).first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SHOTS}/fun-news-1600x1000.png` });
    await waitIdle(page);
    let s = await getState(page);
    expect(s.round).toBe(4);
    expect(s.news).toMatchObject({ id: 'tollFever', round: 4 });
    expect(s.pot).toBe(pot0 + 100);
    await expect(page.locator('.st-round')).toContainText('통행료 ×2');
    // A quake: the only built group (red) loses a level.
    await loadCrafted(page, {}, atRound3('1, 0', `s.properties[19] = { owner: 1, level: 2 }; s.properties[20] = { owner: 2, level: 4 };`));
    await roll(page);
    await page.locator('.st-prompt [data-action="Pass"]').click();
    await waitIdle(page);
    s = await getState(page);
    expect(s.news).toMatchObject({ id: 'quake', group: 'red' });
    expect([s.properties[19]!.level, s.properties[20]!.level]).toEqual([1, 4]);
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('win-back (advanced): the city taken from you comes back for 1× its value', async ({ page }) => {
    test.setTimeout(120_000);
    const logs = watchConsole(page, { warnings: true });
    await bootFast(page);
    await loadCrafted(
      page,
      { rules: 'advanced' },
      `const me = s.players[s.current]; me.position = 26; me.cash = 5000;
       const taker = (s.current + 1) % 4;
       s.properties[31] = { owner: taker, level: 1 };
       s.takenFrom = { 31: { from: me.id, by: taker } };
       s.testHooks = { diceQueue: [[2, 3]] };`,
    );
    await roll(page);
    let s = await getState(page);
    expect(s.phase).toMatchObject({ kind: 'takeover', winBack: true, price: 1500 });
    await expect(page.locator('.pc-takeover')).toContainText('되찾기');
    await page.screenshot({ path: `${SHOTS}/fun-winback-1600x1000.png` });
    const me = s.current;
    await page.locator('.st-prompt [data-action="Takeover"]').click();
    await waitIdle(page);
    s = await getState(page);
    expect(s.properties[31]!.owner).toBe(me);
    expect(logs, logs.join('\n')).toEqual([]);
  });
});
