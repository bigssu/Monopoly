/**
 * Human play-through e2e (QA). Every decision is made by CLICKING the real on-screen control
 * (roll button, prompt buttons, list rows, board spaces, the event card…) — the dev hook is only
 * used to read state, to ask the CPU policy which choice to make (`suggest()`), to speed up
 * animations, and to load hand-crafted states for the rarer flows (debt, bankruptcy, auction,
 * festival, travel).
 *
 * Checked at every prompt: the Stage faces the acting player's seat, every legal action has an
 * enabled, correctly labelled control, and the chosen control is clickable (Playwright's
 * actionability check fails if a toast or overlay covers it). No console errors or warnings.
 * Screenshots → e2e/__screenshots__/human-*.png
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Action, GameState, Seat } from '../src/engine/types';
import { reduceMotion } from './motion';

const SHOTS = 'e2e/__screenshots__';
/** Animation speed multiplier for the long runs (durations ÷ 10; not instant, so fx code runs). */
const FAST = 10;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function watchConsole(page: Page): string[] {
  const out: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const url = m.location().url ?? '';
    if (/favicon/.test(url)) return;
    if (/Failed to load resource/.test(m.text()) && !url) return;
    out.push(`${m.type()}: ${m.text()} @ ${url}`);
  });
  page.on('pageerror', (e) => out.push(`pageerror: ${String(e)}`));
  return out;
}

async function boot(page: Page, w = 1600, h = 1000): Promise<void> {
  await page.setViewportSize({ width: w, height: h });
  await page.goto('/?dev=1');
  await page.waitForFunction(() => !!window.__lotAndRoll && document.getElementById('app')?.dataset.screen === 'title', null, {
    timeout: 20_000,
  });
  await page.evaluate(() => document.fonts.ready);
}

async function screen(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__lotAndRoll!.screen());
}

async function getState(page: Page): Promise<GameState> {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__lotAndRoll!.getState())) as GameState);
}

/** Wait until the game waits for a human (or is over); dismiss event cards by tapping them. */
async function waitIdle(page: Page, stats?: { cards: number }): Promise<void> {
  for (let k = 0; k < 2000; k++) {
    const st = await page.evaluate(() => ({
      busy: window.__lotAndRoll!.isBusy(),
      card: !!document.querySelector('.ev-card-inner.is-flipped'),
    }));
    if (st.card) {
      const ok = await page
        .locator('.ev-card')
        .click({ timeout: 1500 })
        .then(() => true)
        .catch(() => false);
      if (ok && stats) stats.cards++;
    }
    if (!st.busy) break;
    await page.waitForTimeout(20);
  }
  await page.evaluate(() => window.__lotAndRoll!.whenIdle());
}

/** Expected control labels (Korean | English). */
const LABEL: Partial<Record<Action['type'], RegExp>> = {
  Roll: /굴리기|더블 노리기|Roll|Go for doubles/,
  Buy: /구매|Buy/,
  Pass: /패스|그냥 굴리기|그냥 내기|포기|Pass|Just roll|Just pay|Drop out/,
  Build: /건설|Build|Landmark/,
  Takeover: /인수|Take over/,
  PayBail: /보석금|Pay bail/,
  UseEscapeCard: /탈출권|Escape Pass/,
  Bid: /입찰|Bid/,
  SellBuilding: /판매|Sell/,
  SellProperty: /판매|Sell/,
};

function sel(a: Action): string {
  const sp = 'spaceIndex' in a ? `[data-space="${a.spaceIndex}"]` : '';
  const card = 'cardId' in a ? `[data-card="${a.cardId}"]` : '';
  const parity = 'parity' in a ? `[data-parity="${a.parity}"]` : '';
  return `.st-prompt [data-action="${a.type}"]${sp}${card}${parity}`;
}

function boardSpace(page: Page, i: number): Locator {
  return page.locator(`.board-svg g.sp[data-i="${i}"]`);
}

/**
 * Validate the prompt for the current phase: stage faces the actor, and every legal action has
 * an enabled control with the right label.
 */
async function checkPrompt(page: Page, s: GameState): Promise<void> {
  if (s.phase.kind === 'gameOver') return;
  const seat = s.players[s.phase.playerId]!.seat;
  await expect(page.locator('.stage')).toHaveAttribute('data-seat', seat);
  await expect(page.locator('.st-prompt .pcard')).toHaveCount(1);
  const legal = await page.evaluate(() => window.__lotAndRoll!.legal());
  for (const a of legal) {
    if (a.type === 'ChooseTravel' || a.type === 'SetFestival' || a.type === 'FreeUpgrade' || (a.type === 'Build' && s.phase.kind === 'preRoll')) {
      await expect(page.locator(`.board-svg g.sp.is-pick[data-i="${a.spaceIndex}"]`)).toHaveCount(1);
      if (a.type !== 'Build') await expect(page.locator(sel(a))).toBeEnabled();
      continue;
    }
    const ctl = page.locator(sel(a));
    await expect(ctl, `${a.type} control in ${s.phase.kind}`).toHaveCount(1);
    await expect(ctl).toBeEnabled();
    const re = LABEL[a.type];
    if (re) await expect(ctl).toHaveText(re);
  }
}

let travelByBoard = 0;
let pickByBoard = 0;

/** Click the on-screen control for `a`. */
async function clickAction(page: Page, a: Action): Promise<void> {
  if (a.type === 'ChooseTravel') {
    travelByBoard++;
    await boardSpace(page, a.spaceIndex).click();
    return;
  }
  if ((a.type === 'SetFestival' || a.type === 'FreeUpgrade') && pickByBoard++ % 2 === 0) {
    await boardSpace(page, a.spaceIndex).click();
    return;
  }
  await page.locator(sel(a)).click();
}

/** One human decision: read the phase, check the prompt, click what the CPU policy would pick. */
async function humanStep(page: Page, stats: { cards: number; kinds: Record<string, number> }, override?: (s: GameState, a: Action) => Action): Promise<GameState> {
  await waitIdle(page, stats);
  const s = await getState(page);
  if (s.phase.kind === 'gameOver') return s;
  stats.kinds[s.phase.kind] = (stats.kinds[s.phase.kind] ?? 0) + 1;
  await checkPrompt(page, s);
  let a = (await page.evaluate(() => window.__lotAndRoll!.suggest()))!;
  if (override) a = override(s, a);
  const before = JSON.stringify(s);
  await clickAction(page, a);
  // The click must have been accepted: the state changes (or the game is animating it).
  await expect
    .poll(async () => page.evaluate((b) => window.__lotAndRoll!.isBusy() || JSON.stringify(window.__lotAndRoll!.getState()) !== b, before), {
      timeout: 5000,
    })
    .toBe(true);
  return s;
}

/** A fresh all-human state from `demoSettings`, patched by `patch` and loaded (resume path). */
async function loadCrafted(page: Page, opts: { players?: number; settings?: Record<string, unknown> }, patch: string): Promise<void> {
  await page.evaluate(
    ({ n, settings, patch }) => {
      const hook = window.__lotAndRoll!;
      const st = { ...hook.demoSettings(n, false), ...settings };
      hook.startGame(st as never, 7);
      const s = hook.getState()!;
      new Function('s', patch)(s);
      hook.loadState(s);
    },
    { n: opts.players ?? 4, settings: opts.settings ?? {}, patch },
  );
  await page.waitForSelector('.game .board');
  await waitIdle(page);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('human play (clicking real controls)', () => {
  test.use({ actionTimeout: 10_000 });
  test('4 humans via the Setup screen: 60+ turns, menu, info popover, save & resume', async ({ page }) => {
    test.setTimeout(600_000);
    const logs = watchConsole(page);
    await boot(page);
    await page.evaluate((x) => {
      window.__lotAndRoll!.setAnimSpeed(x);
      window.__lotAndRoll!.setPromptTimer(0);
    }, FAST);

    // Title → Setup → 4 human seats → start.
    await page.click('[data-action="new"]');
    await expect(page.locator('#app[data-screen="setup"]')).toBeVisible();
    for (const seat of ['E', 'W']) {
      if (!(await page.locator(`.seat-anchor[data-seat="${seat}"].is-on`).count())) await page.click(`.seat-anchor[data-seat="${seat}"] .seat-join`);
    }
    await expect(page.locator('.seat-anchor.is-on')).toHaveCount(4);
    await page.click('[data-action="start"]');
    await expect(page.locator('#app[data-screen="game"]')).toBeVisible();
    const s0 = await getState(page);
    expect(s0.players.every((p) => !p.isCpu)).toBe(true);

    const stats = { cards: 0, kinds: {} as Record<string, number> };
    let turns = 0; // turns of finished games
    let games = 1;
    let checkedMenu = false;
    let checkedInfo = false;
    let checkedResume = false;
    for (;;) {
      await waitIdle(page, stats);
      const s = await getState(page);
      if (s.phase.kind === 'gameOver') {
        // Game over early: from the result screen, play again (a new game, still all human).
        await expect.poll(() => screen(page), { timeout: 15_000 }).toBe('result');
        turns += s.turn;
        games++;
        await page.locator('.rs-btn.is-primary').click();
        await expect.poll(() => screen(page)).toBe('game');
        continue;
      }
      const total = turns + s.turn;
      if (total >= 60) break;
      // Side trips, each while a human prompt is waiting.
      if (!checkedMenu && total >= 5 && s.phase.kind !== 'preRoll') {
        checkedMenu = true;
        await menuRoundTrip(page);
      } else if (!checkedInfo && total >= 8 && s.phase.kind === 'preRoll') {
        checkedInfo = true;
        await infoPopover(page);
      } else if (!checkedResume && total >= 20) {
        checkedResume = true;
        await saveQuitResume(page);
      }
      await humanStep(page, stats);
    }
    expect(checkedMenu && checkedInfo && checkedResume).toBe(true);
    // A healthy spread of prompts was exercised.
    for (const k of ['preRoll', 'buy', 'build']) expect(stats.kinds[k] ?? 0, JSON.stringify(stats.kinds)).toBeGreaterThan(0);
    console.log(`[human] prompts ${JSON.stringify(stats.kinds)} games=${games} cards tapped=${stats.cards}`);
    await page.screenshot({ path: `${SHOTS}/human-4p-mid-1600x1000.png` });
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('debt: sell assets by tapping the sell buttons until the toll is paid', async ({ page }) => {
    test.setTimeout(120_000);
    const logs = watchConsole(page);
    await boot(page);
    await page.evaluate(() => {
      window.__lotAndRoll!.setAnimSpeed(2);
      window.__lotAndRoll!.setPromptTimer(0);
    });
    // The current player sits on 12 with 40 cash, owns Cairo (L2), Nairobi (L1), Cape Town, Lima, rolls 2+3 onto
    // Madrid (17, villa, toll 360) owned by the next player: selling is enough, bankruptcy is not.
    await loadCrafted(
      page,
      {},
      `const me = s.players[s.current];
       me.position = 12; me.cash = 40;
       s.properties[4] = { owner: me.id, level: 2 };
       s.properties[6] = { owner: me.id, level: 1 };
       s.properties[7] = { owner: me.id, level: 0 };
       s.properties[9] = { owner: me.id, level: 0 };
       const other = s.players[(s.current + 1) % 4];
       s.properties[17] = { owner: other.id, level: 1 };
       s.testHooks = { diceQueue: [[2, 3]] };`,
    );
    const s = await getState(page);
    const me = s.players[s.current]!;
    await expect(page.locator('.stage')).toHaveAttribute('data-seat', me.seat);
    await page.locator('.st-prompt [data-action="Roll"]').click();
    await waitIdle(page);
    let st = await getState(page);
    expect(st.phase.kind).toBe('debt');
    await expect(page.locator('.stage')).toHaveAttribute('data-seat', me.seat);
    await expect(page.locator('.pc-debt .debt-meter')).toBeVisible();
    await expect(page.locator('.pc-debt .debt-row')).not.toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/human-debt-1600x1000.png` });
    let sold = 0;
    while (st.phase.kind === 'debt') {
      await checkPrompt(page, st);
      // Tap the highlighted "best" sale.
      await page.locator('.pc-debt .debt-row.is-best .pbtn').click();
      sold++;
      await waitIdle(page);
      st = await getState(page);
    }
    expect(sold).toBeGreaterThan(0);
    expect(st.players[me.id]!.bankrupt).toBe(false);
    expect(st.players[me.id]!.cash).toBeGreaterThanOrEqual(0);
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('bankruptcy (elimination mode) greys the panel; game over → result buttons', async ({ page }) => {
    test.setTimeout(150_000);
    const logs = watchConsole(page);
    await boot(page);
    await page.evaluate(() => {
      window.__lotAndRoll!.setAnimSpeed(1);
      window.__lotAndRoll!.setPromptTimer(0);
    });
    // Elimination mode: the game goes on after the first bankruptcy so the panel state shows.
    await loadCrafted(
      page,
      { players: 3, settings: { endOnFirstBankruptcy: false } },
      `const me = s.players[s.current];
       me.position = 12; me.cash = 10;
       const other = s.players[(s.current + 1) % 3];
       s.properties[17] = { owner: other.id, level: 4 };
       s.testHooks = { diceQueue: [[2, 3]] };`,
    );
    const s = await getState(page);
    const me = s.players[s.current]!;
    await page.locator('.st-prompt [data-action="Roll"]').click();
    await waitIdle(page);
    const after = await getState(page);
    expect(after.players[me.id]!.bankrupt).toBe(true);
    await expect(page.locator(`.pp[data-pid="${me.id}"]`)).toHaveClass(/is-bankrupt/);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/human-bankrupt-panel-1600x1000.png` });

    // Now end a game: first-bankruptcy mode, land broke on a landmark (easy rules end at once;
    // normal plays the round out first).
    await page.evaluate((x) => window.__lotAndRoll!.setAnimSpeed(x), FAST);
    await loadCrafted(
      page,
      { settings: { rules: 'easy' } },
      `const me = s.players[s.current];
       me.position = 12; me.cash = 10;
       s.properties[17] = { owner: (s.current + 1) % 4, level: 4 };
       s.testHooks = { diceQueue: [[2, 3]] };`,
    );
    const ended = await getState(page);
    await page.locator('.st-prompt [data-action="Roll"]').click();
    await expect.poll(() => screen(page), { timeout: 20_000 }).toBe('result');
    await expect(page.locator('.rs-card')).toBeVisible();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/human-result-1600x1000.png` });

    // "↻ 화면 돌리기" rotates the result card toward the other seats.
    const rotateBtn = page.locator('.rs-rotate');
    await expect(rotateBtn).toBeVisible();
    const seat0 = await page.locator('.rs-card').getAttribute('data-seat');
    await rotateBtn.click();
    const seat1 = await page.locator('.rs-card').getAttribute('data-seat');
    expect(seat1).not.toBe(seat0);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/human-result-rotated-1600x1000.png` });

    // 다시 하기 → a new game (same players, starting seat rotated by a random offset).
    await page.locator('.rs-btn.is-primary').click();
    await expect.poll(() => screen(page)).toBe('game');
    await waitIdle(page);
    const fresh = await getState(page);
    expect(fresh.turn).toBe(1);
    expect(fresh.seed).not.toBe(ended.seed);
    // Same table (names + seats), turn order around the table kept (rotated by an offset).
    const ring = (ps: GameState['players']) => ps.map((p) => `${p.seat}:${p.name}`);
    const a = ring(ended.players);
    const b = ring(fresh.players);
    expect([...b].sort()).toEqual([...a].sort());
    const k = a.indexOf(b[0]!);
    expect([...a.slice(k), ...a.slice(0, k)]).toEqual(b);

    // Game over again → 타이틀로.
    await loadCrafted(
      page,
      { settings: { rules: 'easy' } },
      `const me = s.players[s.current];
       me.position = 12; me.cash = 10;
       s.properties[17] = { owner: (s.current + 1) % 4, level: 4 };
       s.testHooks = { diceQueue: [[2, 3]] };`,
    );
    await page.locator('.st-prompt [data-action="Roll"]').click();
    await expect.poll(() => screen(page), { timeout: 20_000 }).toBe('result');
    await page.locator('.rs-btn:not(.is-primary)').click();
    await expect.poll(() => screen(page)).toBe('title');
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('result screen: the ↻ pill turns the card to every seat (README shot faces S)', async ({ page }) => {
    test.setTimeout(150_000);
    const logs = watchConsole(page);
    await boot(page);
    await page.evaluate(() => {
      const hook = window.__lotAndRoll!;
      hook.setAnimSpeed(0);
      hook.setPromptTimer(0);
      hook.startGame(hook.demoSettings(4, true), 4242);
    });
    await expect.poll(() => screen(page), { timeout: 120_000, intervals: [250] }).toBe('result');
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      seen.add((await page.locator('.rs-card').getAttribute('data-seat'))!);
      await page.locator('.rs-rotate').click();
    }
    expect([...seen].sort().join('')).toBe('ENSW');
    while ((await page.locator('.rs-card').getAttribute('data-seat')) !== 'S') await page.locator('.rs-rotate').click();
    // The pill stays upright and clear of the card (once the turn animation has settled).
    await page.waitForTimeout(800);
    const pill = (await page.locator('.rs-rotate').boundingBox())!;
    const card = (await page.locator('.rs-card').boundingBox())!;
    expect(pill.y).toBeGreaterThanOrEqual(card.y + card.height - 1);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/human-result-facing-S-1600x1000.png` });
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('auction, festival, travel (board tap) and the event card tap', async ({ page }) => {
    test.setTimeout(150_000);
    const logs = watchConsole(page);
    await boot(page);
    await page.evaluate(() => {
      window.__lotAndRoll!.setAnimSpeed(3);
      window.__lotAndRoll!.setPromptTimer(0);
    });
    const stats = { cards: 0, kinds: {} as Record<string, number> };

    // --- Auction: decline to buy → every other player bids / drops out on their own seat.
    await loadCrafted(page, { settings: { auction: true } }, `s.players[s.current].position = 0; s.testHooks = { diceQueue: [[1, 3]] };`);
    await page.locator('.st-prompt [data-action="Roll"]').click();
    await waitIdle(page);
    let s = await getState(page);
    expect(s.phase.kind).toBe('buy');
    await checkPrompt(page, s);
    await page.locator('.st-prompt [data-action="Pass"]').click();
    await waitIdle(page);
    s = await getState(page);
    expect(s.phase.kind).toBe('auction');
    await page.screenshot({ path: `${SHOTS}/human-auction-1600x1000.png` });
    let rounds = 0;
    const seatsSeen = new Set<Seat>();
    while (s.phase.kind === 'auction' && rounds < 20) {
      await checkPrompt(page, s);
      seatsSeen.add(s.players[s.phase.playerId]!.seat);
      // First two bidders bid, then everyone drops.
      await page.locator(`.st-prompt [data-action="${rounds < 2 ? 'Bid' : 'Pass'}"]`).click();
      rounds++;
      await waitIdle(page);
      s = await getState(page);
    }
    expect(s.phase.kind).not.toBe('auction');
    expect(seatsSeen.size).toBeGreaterThan(1);
    expect(s.properties[4]!.owner).not.toBeNull();

    // --- Festival with own cities: pick one by tapping the board.
    await loadCrafted(
      page,
      {},
      `const me = s.players[s.current];
       me.position = 12;
       s.properties[1] = { owner: me.id, level: 1 };
       s.properties[9] = { owner: me.id, level: 0 };
       s.testHooks = { diceQueue: [[1, 3]] };`,
    );
    await page.locator('.st-prompt [data-action="Roll"]').click();
    await waitIdle(page);
    s = await getState(page);
    expect(s.phase.kind).toBe('festival');
    await checkPrompt(page, s);
    await expect(page.locator('.st-prompt .pick-row')).toHaveCount(2);
    await page.screenshot({ path: `${SHOTS}/human-festival-1600x1000.png` });
    await boardSpace(page, 9).click();
    await waitIdle(page);
    s = await getState(page);
    expect(s.festival).toBe(9);

    // --- Travel: land on 자유여행, others take their turns, then fly by tapping a board space.
    await loadCrafted(page, { players: 2 }, `const me = s.players[s.current]; me.position = 20; s.testHooks = { diceQueue: [[1, 3], [1, 2]] };`);
    const traveller = (await getState(page)).current;
    await page.locator('.st-prompt [data-action="Roll"]').click();
    for (let k = 0; k < 12; k++) {
      s = await getState(page);
      if (s.phase.kind === 'travel') break;
      await humanStep(page, stats, (st, a) => (st.phase.kind === 'buy' || st.phase.kind === 'build' ? { type: 'Pass', playerId: a.playerId } : a));
    }
    await waitIdle(page);
    s = await getState(page);
    expect(s.phase.kind).toBe('travel');
    expect(s.current).toBe(traveller);
    await checkPrompt(page, s);
    await page.screenshot({ path: `${SHOTS}/human-travel-1600x1000.png` });
    await boardSpace(page, 31).click();
    await waitIdle(page);
    s = await getState(page);
    expect(s.players[traveller]!.position).toBe(31);

    // --- Event card: normal speed, tap the card to dismiss it early.
    await page.evaluate(() => window.__lotAndRoll!.setAnimSpeed(1));
    await loadCrafted(page, {}, `s.players[s.current].position = 0; s.testHooks = { diceQueue: [[1, 2]], cardQueue: ['lottery', 'fine'] };`);
    await page.locator('.st-prompt [data-action="Roll"]').click();
    // Normal rules (the default): pick one of two cards first, then it flips.
    await page.locator('.st-prompt [data-action="ChooseCard"][data-card="lottery"]').click({ timeout: 15_000 });
    await expect(page.locator('.ev-card-inner.is-flipped')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${SHOTS}/human-card-1600x1000.png` });
    const t0 = Date.now();
    await page.locator('.ev-card').click();
    await expect(page.locator('.ev-card')).toHaveCount(0, { timeout: 1500 });
    expect(Date.now() - t0).toBeLessThan(1500);
    await waitIdle(page);
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('toll moment: money cut-in + receiver panel flash; soft timer auto-pass is announced', async ({ page }) => {
    test.setTimeout(90_000);
    const logs = watchConsole(page);
    await boot(page);
    await page.evaluate(() => {
      window.__lotAndRoll!.setAnimSpeed(1);
      window.__lotAndRoll!.setPromptTimer(0);
    });
    await loadCrafted(
      page,
      {},
      `const me = s.players[s.current];
       me.position = 12;
       s.properties[17] = { owner: (s.current + 2) % 4, level: 2 };
       s.testHooks = { diceQueue: [[2, 3]] };`,
    );
    const s = await getState(page);
    const owner = (s.current + 2) % 4;
    await page.locator('.st-prompt [data-action="Roll"]').click();
    // The toll is a money cut-in (MONEY-EVENTS §11): payer's coins → the city → the owner's pile.
    await expect(page.locator('.money-stage.is-live')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.money-stage .mw.is-on')).toHaveCount(2, { timeout: 5000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/human-toll-1600x1000.png` });
    // When it hands back, the owner's panel counts up.
    await expect(page.locator(`.pp[data-pid="${owner}"] .pp-card`)).toHaveClass(/flash-up/, { timeout: 8000 });
    await waitIdle(page);

    // Soft timer: a 2 s timer on the takeover/build prompt → ring visible, then auto-pass + toast.
    await page.evaluate(() => window.__lotAndRoll!.setPromptTimer(2));
    await loadCrafted(page, {}, `s.players[s.current].position = 0; s.testHooks = { diceQueue: [[1, 3]] };`);
    await page.locator('.st-prompt [data-action="Roll"]').click();
    await waitIdle(page);
    expect((await getState(page)).phase.kind).toBe('buy');
    await expect(page.locator('.st-prompt .timer-ring')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/human-timer-1600x1000.png` });
    await expect(page.locator('.st-toast.is-autopass')).toBeVisible({ timeout: 5000 });
    await expect.poll(async () => (await getState(page)).phase.kind, { timeout: 5000 }).not.toBe('buy');
    await page.evaluate(() => window.__lotAndRoll!.setPromptTimer(0));
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('soft timer pauses: hidden app, rules overlay + Escape; a held roll button stops shaking', async ({ page }) => {
    test.setTimeout(90_000);
    const logs = watchConsole(page);
    await reduceMotion(page);
    await boot(page);
    await page.evaluate(() => {
      window.__lotAndRoll!.setAnimSpeed(0);
      // Leave ample time for loadState and the first prompt to settle before simulating pause.
      window.__lotAndRoll!.setPromptTimer(30);
    });
    await loadCrafted(page, { players: 2 }, `s.testHooks = { diceQueue: [[1, 3], [2, 4], [3, 5]] };`);
    const setHidden = (hidden: boolean) =>
      page.evaluate((h) => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);

    // App in the background: the 2 s timer must not roll for the absent player…
    await setHidden(true);
    await page.evaluate(() => window.__lotAndRoll!.setPromptTimer(2));
    await page.waitForTimeout(3000);
    expect((await getState(page)).lastDice).toBeNull();
    // …and runs again (fresh ring) once the app is back.
    await setHidden(false);
    await expect.poll(async () => (await getState(page)).lastDice, { timeout: 6000 }).not.toBeNull();
    await waitIdle(page);

    // Rules overlay from the in-game menu: Escape closes it and does not re-open the menu.
    await page.evaluate(() => window.__lotAndRoll!.setPromptTimer(0));
    await page.locator('.menu-btn').click();
    await page.locator('.menu-item').first().click();
    await expect(page.locator('.rules-overlay')).toBeVisible();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await expect(page.locator('.rules-overlay')).toHaveCount(0);
    await expect(page.locator('.menu-overlay')).not.toHaveClass(/is-open/);

    // Hold the roll button until the soft timer rolls: the shake loop (haptic + sound) must stop.
    await page.evaluate(() => window.__lotAndRoll!.setPromptTimer(2));
    await loadCrafted(page, { players: 2 }, `s.testHooks = { diceQueue: [[1, 3]] };`);
    const box = (await page.locator('.st-prompt .roll-btn').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect.poll(async () => (await getState(page)).lastDice, { timeout: 6000 }).not.toBeNull();
    await page.mouse.up();
    await expect(page.locator('.stage .dice')).not.toHaveClass(/is-shaking/);
    await page.evaluate(() => window.__lotAndRoll!.setPromptTimer(0));
    expect(logs, logs.join('\n')).toEqual([]);
  });

  for (const vp of [
    { w: 800, h: 450 },
    { w: 1600, h: 1000 },
  ]) {
    test(`English text fits on the game screen at ${vp.w}x${vp.h}`, async ({ page }) => {
      test.setTimeout(240_000);
      const logs = watchConsole(page);
      await boot(page, vp.w, vp.h);
      await page.evaluate(() => {
        const hook = window.__lotAndRoll!;
        hook.setLang('en');
        hook.setAnimSpeed(0);
        hook.setPromptTimer(0);
        hook.startGame({ ...hook.demoSettings(4, false), startCash: 5000 }, 99);
      });
      await page.waitForSelector('.game .board');
      const stats = { cards: 0, kinds: {} as Record<string, number> };
      const problems = new Set<string>();
      const seen = new Set<string>();
      for (let i = 0; i < 160; i++) {
        await waitIdle(page);
        const s = await getState(page);
        if (!s || s.phase.kind === 'gameOver') break;
        if (!seen.has(s.phase.kind)) {
          seen.add(s.phase.kind);
          await page.waitForTimeout(50);
          await page.screenshot({ path: `${SHOTS}/human-en-${s.phase.kind}-${vp.w}x${vp.h}.png` });
        }
        for (const p of await findOverflow(page)) problems.add(`${s.phase.kind}: ${p}`);
        const a = (await page.evaluate(() => window.__lotAndRoll!.suggest()))!;
        await page.evaluate((a) => window.__lotAndRoll!.dispatch(a), a);
      }
      // The auction / debt / island / festival / travel cards too.
      for (const [name, settings, patch, roll = true] of CRAFTED_EN) {
        await loadCrafted(page, { settings }, patch);
        if (roll) await page.locator('.st-prompt [data-action="Roll"]').click();
        await waitIdle(page);
        const s = await getState(page);
        await checkPrompt(page, s);
        if (s.phase.kind === 'buy' && name === 'auction') {
          await page.locator('.st-prompt [data-action="Pass"]').click();
          await waitIdle(page);
        }
        await page.waitForTimeout(50);
        await page.screenshot({ path: `${SHOTS}/human-en-${name}-${vp.w}x${vp.h}.png` });
        for (const p of await findOverflow(page)) problems.add(`${name}: ${p}`);
      }
      expect([...problems], [...problems].join('\n')).toEqual([]);
      expect(logs, logs.join('\n')).toEqual([]);
    });
  }
});

/** [name, settings, patch, roll first?] */
const CRAFTED_EN: Array<[string, Record<string, unknown>, string, boolean?]> = [
  ['auction', { auction: true }, `s.players[s.current].position = 0; s.testHooks = { diceQueue: [[1, 3]] };`],
  [
    'debt',
    {},
    `const me = s.players[s.current]; me.position = 12; me.cash = 40;
     s.properties[4] = { owner: me.id, level: 2 }; s.properties[6] = { owner: me.id, level: 1 }; s.properties[26] = { owner: me.id, level: 3 };
     s.properties[17] = { owner: (s.current + 1) % 4, level: 3 }; s.testHooks = { diceQueue: [[2, 3]] };`,
  ],
  [
    'festival',
    {},
    `const me = s.players[s.current]; me.position = 12;
     for (const i of [1, 9, 12, 22, 31]) s.properties[i] = { owner: me.id, level: 2 };
     s.testHooks = { diceQueue: [[1, 3]] };`,
  ],
  [
    'island',
    {},
    `const me = s.players[s.current]; me.position = 8; me.islandTurns = 3; me.cards = ['escape'];
     s.phase = { kind: 'island', playerId: me.id, turnsLeft: 3, bail: 200, canPayBail: true, hasEscapeCard: true };`,
    false,
  ],
  [
    'travel',
    {},
    `const me = s.players[s.current]; me.position = 24; me.travelPending = true;
     s.phase = { kind: 'travel', playerId: me.id, options: [...Array(32).keys()].filter((i) => i !== 8 && i !== 24) };`,
    false,
  ],
  ['takeover', {}, `const me = s.players[s.current]; me.position = 12; s.properties[17] = { owner: (s.current + 1) % 4, level: 2 }; s.testHooks = { diceQueue: [[2, 3]] };`],
];

/** Text that is clipped (ellipsis / overflow) or boxes that spill out of the viewport. */
async function findOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const W = innerWidth;
    const H = innerHeight;
    const scope = document.querySelectorAll(
      '.game .pcard *, .game .st-banner *, .game .st-round, .game .pp *, .game .info-card *',
    );
    for (const el of scope) {
      const he = el as HTMLElement;
      if (!he.offsetParent && he.tagName !== 'svg') continue;
      if (he.closest('svg')) continue;
      const cs = getComputedStyle(he);
      const txt = (he.textContent ?? '').trim();
      if (!txt || he.children.length > 0) continue;
      if (he.scrollWidth > he.clientWidth + 1 && (cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis' || cs.overflowX === 'hidden')) {
        out.push(`clipped "${txt}" (${he.className})`);
      }
    }
    // Prompt card and panels inside the viewport; prompt card inside the stage.
    const stage = document.querySelector('.stage')?.getBoundingClientRect();
    for (const el of document.querySelectorAll('.game .pcard, .game .pp')) {
      const r = el.getBoundingClientRect();
      if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push(`off-screen ${el.className}`);
      if (stage && el.classList.contains('pcard') && (r.left < stage.left - 2 || r.right > stage.right + 2 || r.top < stage.top - 2 || r.bottom > stage.bottom + 2)) {
        out.push(`pcard spills out of the stage (${el.className}) card=${[r.left, r.top, r.right, r.bottom].map(Math.round)} stage=${[stage.left, stage.top, stage.right, stage.bottom].map(Math.round)}`);
      }
    }
    // Buttons: label fits.
    for (const b of document.querySelectorAll('.game .pbtn, .game .roll-btn')) {
      const e = b as HTMLElement;
      if (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) out.push(`button overflow "${e.textContent}"`);
    }
    return out;
  });
}

async function menuRoundTrip(page: Page): Promise<void> {
  const before = JSON.stringify(await getState(page));
  await page.locator('.menu-btn').click();
  await expect(page.locator('.menu-overlay')).toHaveClass(/is-open/);
  await expect(page.locator('.menu-sheet .menu-item')).not.toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/human-menu-1600x1000.png` });
  await page.locator('.menu-x').click();
  await expect(page.locator('.menu-overlay')).not.toHaveClass(/is-open/);
  // Escape toggles it too.
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu-overlay')).toHaveClass(/is-open/);
  await page.locator('.menu-item.is-primary').click();
  await expect(page.locator('.menu-overlay')).not.toHaveClass(/is-open/);
  expect(JSON.stringify(await getState(page))).toBe(before);
}

async function infoPopover(page: Page): Promise<void> {
  // Tap a space on the board (not picking): its info card pops up on the stage.
  await boardSpace(page, 31).click();
  await expect(page.locator('.st-pop.is-on .info-card')).toBeVisible();
  await expect(page.locator('.st-pop .info-card .pc-title')).toHaveText(/서울/);
  await page.screenshot({ path: `${SHOTS}/human-info-1600x1000.png` });
  await page.locator('.st-pop').click();
  await expect(page.locator('.st-pop.is-on')).toHaveCount(0);
}

async function saveQuitResume(page: Page): Promise<void> {
  const before = await getState(page);
  await page.locator('.menu-btn').click();
  await page.locator('.menu-item', { hasText: '저장 후 나가기' }).click();
  await expect.poll(() => screen(page)).toBe('title');
  await expect(page.locator('[data-action="continue"]')).toBeVisible();
  await expect(page.locator('[data-action="continue"]')).toContainText('이어하기');
  await page.locator('[data-action="continue"]').click();
  await expect.poll(() => screen(page)).toBe('game');
  await waitIdle(page);
  const after = await getState(page);
  expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  await checkPrompt(page, after);
}
