/**
 * The CPU hand (src/ui/stage/CpuHand.ts): whenever a CPU decides, a glove reaches from its seat
 * and presses the control it chose before the action is dispatched. A seeded 4-CPU game at the
 * default (normal) pace; hand-crafted states reach the rarer decisions.
 *
 * Checked for every press (the dev hook's press log, `__lotAndRoll.cpuHand()`): the control was
 * on screen, the measured fingertip lay inside it, it was the control of the chosen action, and
 * the decision was still pending (not dispatched yet). Covers roll (the hand presses the dice on
 * the throw pad and flicks toward the board centre: the throw follows the stroke), buy, pass, build, takeover,
 * a board pick (festival / travel), the island choice and debt sales, on all four seats.
 * Screenshots (hand held at its press) → e2e/__screenshots__/cpu-hand-*.png
 */
import { expect, test, type Page } from '@playwright/test';
import type { HandRecord } from '../src/ui/stage/CpuHand';
import { boot, checkPress, watchConsole } from './helpers';

const SHOTS = 'e2e/__screenshots__';
const SEED = 20261005;

/** Boot at w×h, then a seeded four-CPU game. */
async function bootGame(page: Page, w: number, h: number): Promise<void> {
  await boot(page, { w, h });
  // Default prefs: game pace 2 (normal), real animation speed. Four CPUs, seeded.
  await page.evaluate((seed) => {
    const h = window.__lotAndRoll!;
    h.setPromptTimer(0);
    h.cpuHand().clear();
    h.startGame(h.demoSettings(4, true) as never, seed);
  }, SEED);
  await page.waitForSelector('.game .board');
}

async function log(page: Page): Promise<HandRecord[]> {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__lotAndRoll!.cpuHand().log)) as HandRecord[]);
}

/** Wait until the press log has a pressed (measured) record matching `want` (`phase:Action` regex). */
async function waitPress(page: Page, want: RegExp, timeout = 40_000): Promise<HandRecord> {
  await page.waitForFunction(
    (src) => {
      const re = new RegExp(src);
      return window.__lotAndRoll!.cpuHand().log.some((r) => r.tip && re.test(`${r.phase}:${r.action}`));
    },
    want.source,
    { timeout, polling: 50 },
  );
  return (await log(page)).find((r) => r.tip && want.test(`${r.phase}:${r.action}`))!;
}

/**
 * Load a crafted state for CPU `pid` (seat: 0 S, 1 E, 2 N, 3 W): `patch` edits `s` / `me` (the
 * phase starts as preRoll). Clears the press log.
 */
async function craft(page: Page, pid: number, patch: string): Promise<void> {
  await page.evaluate(
    ({ pid, patch }) => {
      const h = window.__lotAndRoll!;
      h.cpuHand().clear();
      const s = h.getState()!;
      s.current = pid;
      const me = s.players[pid]!;
      s.phase = { kind: 'preRoll', playerId: pid, rollAgain: false };
      new Function('s', 'me', patch)(s, me);
      h.loadState(s);
    },
    { pid, patch },
  );
  await page.waitForSelector('.game .board');
}

/** The hand held at its press, for a screenshot; then let it go. */
async function shotAtPress(page: Page, name: string, pid: number, patch: string, want: RegExp): Promise<HandRecord> {
  await page.evaluate(() => window.__lotAndRoll!.cpuHand().freeze(true));
  await craft(page, pid, patch);
  const r = await waitPress(page, want);
  await page.waitForFunction(() => window.__lotAndRoll!.cpuHand().frozen(), null, { timeout: 10_000 });
  // The ripple ring is a decoration that fades: wait it out so the shot shows the press itself.
  await page.waitForTimeout(450);
  await expect(page.locator('.cpu-hand')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${name}` });
  await page.evaluate(() => window.__lotAndRoll!.cpuHand().freeze(false));
  return r;
}

const S = 0;
const E = 1;
const N = 2;
const W = 3;

/** Crafted decisions (patch for `craft`). */
const BUY = `me.position = 4; me.cash = 3000; s.phase = { kind: 'buy', playerId: me.id, spaceIndex: 4, price: 160 };`;
const PASS = `me.position = 31; me.cash = 300; s.phase = { kind: 'buy', playerId: me.id, spaceIndex: 31, price: 1000 };`;
/** Rolls 1+2 from 1 onto its own villa at 4: roll, then build. */
const BUILD = `me.position = 1; me.cash = 3000; s.properties[4] = { owner: me.id, level: 1 }; s.testHooks = { diceQueue: [[1, 2]] };`;
/** Rolls 1+3 from 12 onto the festival corner (16), owning five cities: roll, then a board pick. */
const FESTIVAL = `me.position = 12; for (const i of [1, 9, 12, 22, 31]) s.properties[i] = { owner: me.id, level: 2 }; s.testHooks = { diceQueue: [[1, 3]] };`;
const TRAVEL = `me.position = 24; me.travelPending = true; s.phase = { kind: 'travel', playerId: me.id, options: [...Array(32).keys()].filter((i) => i !== 8 && i !== 24) };`;
const ISLAND = `me.position = 8; me.islandTurns = 2; me.cash = 3000; s.phase = { kind: 'island', playerId: me.id, turnsLeft: 2, bail: 200, canPayBail: true, hasEscapeCard: false };`;
/** Rolls 2+3 from 12 onto an opponent's hotel at 17 with 40 cash: debt, sells until paid. */
const DEBT = `me.position = 12; me.cash = 40; s.properties[4] = { owner: me.id, level: 2 }; s.properties[6] = { owner: me.id, level: 1 }; s.properties[26] = { owner: me.id, level: 3 };
  s.properties[17] = { owner: (me.id + 1) % 4, level: 3 }; s.testHooks = { diceQueue: [[2, 3]] };`;
/** Rolls 2+3 from 12 onto an opponent's building at 17 with cash to spare: toll, then takeover / pass. */
const TAKEOVER = `me.position = 12; me.cash = 5000; s.properties[17] = { owner: (me.id + 1) % 4, level: 2 }; s.testHooks = { diceQueue: [[2, 3]] };`;

test.describe('CPU hand', () => {
  test('1600x1000: a seeded 4-CPU game shows the hand on every decision', async ({ page }) => {
    test.setTimeout(300_000);
    const logs = watchConsole(page, { warnings: true, ignore: /favicon|Failed to load resource/ });
    await bootGame(page, 1600, 1000);
    const seen = new Set<string>();
    const record = (r: HandRecord, ctx: string): void => {
      checkPress(r, ctx);
      seen.add(`${r.phase}:${r.action}`);
    };

    // The opening turns as they come: every press is on its control, before its dispatch.
    await page.waitForFunction(() => window.__lotAndRoll!.cpuHand().log.filter((r) => r.tip).length >= 4, null, { timeout: 90_000, polling: 100 });
    const natural = (await log(page)).filter((r) => r.tip);
    for (const r of natural) record(r, 'natural');
    expect(new Set(natural.map((r) => r.seat)).size, 'more than one seat acted').toBeGreaterThan(1);

    // Every seat's hand lands on the dice (the Stage turned toward that seat) and flicks them
    // away from its seat: in the Stage's frame (turned to that seat) that is always "up".
    for (const pid of [S, E, N, W]) {
      await page.evaluate(() => window.__lotAndRoll!.dice().clear());
      await craft(page, pid, '');
      const r = await waitPress(page, /^preRoll:Roll$/);
      record(r, `roll seat ${pid}`);
      expect(r.target, `roll seat ${pid}`).toBe('pad');
      await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.dice().log.at(-1)?.kind ?? null), { timeout: 15_000 }).toBe('flick');
      const aim = await page.evaluate(() => window.__lotAndRoll!.dice().log.at(-1)!.aim!);
      expect(-aim.y, `seat ${pid}: thrown toward the board centre`).toBeGreaterThan(Math.abs(aim.x));
    }
    await craft(page, S, BUY);
    record(await waitPress(page, /^buy:/), 'buy');
    await craft(page, N, PASS);
    const pass = await waitPress(page, /^buy:/);
    expect(pass.action).toBe('Pass');
    record(pass, 'pass');
    await craft(page, E, BUILD);
    record(await waitPress(page, /^preRoll:Roll$/), 'build: roll');
    record(await waitPress(page, /^build:/), 'build');
    await craft(page, W, FESTIVAL);
    record(await waitPress(page, /^festival:/), 'festival');
    await craft(page, S, TRAVEL);
    record(await waitPress(page, /^travel:/), 'travel');
    await craft(page, N, ISLAND);
    record(await waitPress(page, /^island:/), 'island');
    await craft(page, E, TAKEOVER);
    record(await waitPress(page, /^takeover:/), 'takeover');
    await craft(page, W, DEBT);
    record(await waitPress(page, /^debt:Sell/), 'debt sale');
    for (const r of (await log(page)).filter((x) => x.tip)) record(r, 'debt flow');

    for (const k of ['preRoll:Roll', 'buy:Buy', 'buy:Pass', 'build:Build', 'island:']) {
      expect([...seen].some((x) => x.startsWith(k)), `saw ${k} in ${[...seen].join(', ')}`).toBe(true);
    }
    expect([...seen].some((x) => /^(festival:SetFestival|travel:ChooseTravel)$/.test(x)), `a board pick in ${[...seen].join(', ')}`).toBe(true);
    console.log(`[cpu-hand] presses seen: ${[...seen].sort().join(', ')}`);
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('pause freezes the hand where it is; resume presses and dispatches', async ({ page }) => {
    test.setTimeout(120_000);
    const logs = watchConsole(page, { warnings: true, ignore: /favicon|Failed to load resource/ });
    await bootGame(page, 1280, 800);
    await craft(page, S, BUY);
    await page.waitForSelector('.cpu-hand', { timeout: 30_000 });
    await page.locator('.pause-btn').click();
    await expect(page.locator('.menu-title')).toContainText('일시 정지');
    // (On a loaded machine the click can land after the release: then the check is that nothing
    // moves on while paused, from wherever the turn was.)
    const snap = () =>
      page.evaluate(() => {
        const hand = document.querySelector('.cpu-hand');
        const s = window.__lotAndRoll!.getState()!;
        return { pose: hand ? getComputedStyle(hand).transform : null, phase: s.phase.kind, turn: s.turn };
      });
    const before = await snap();
    await page.waitForTimeout(1500);
    expect(await snap(), 'the hand holds still and nothing is dispatched while paused').toEqual(before);
    await page.locator('.menu-item.is-primary').click(); // 계속하기
    await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.getState()!.phase.kind), { timeout: 30_000 }).not.toBe('buy');
    const presses = (await log(page)).filter((r) => r.phase === 'buy');
    expect(presses, 'one press for the one decision').toHaveLength(1);
    checkPress(presses[0]!, 'after resume');
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('pause during the roll hold silences the dice; resume rattles them again until the release', async ({ page }) => {
    test.setTimeout(120_000);
    const logs = watchConsole(page, { warnings: true, ignore: /favicon|Failed to load resource/ });
    await bootGame(page, 1280, 800);
    // The hand is held at its press (still in the roll hold) by the dev freeze.
    await page.evaluate(() => window.__lotAndRoll!.cpuHand().freeze(true));
    await craft(page, S, '');
    await waitPress(page, /^preRoll:Roll$/);
    await page.waitForFunction(() => window.__lotAndRoll!.cpuHand().frozen(), null, { timeout: 10_000 });
    const dice = page.locator('.st-dice .dice');
    await expect(dice).toHaveClass(/is-shaking/);
    await expect(page.locator('.roll-pad')).toHaveClass(/is-held/);
    await page.locator('.pause-btn').click();
    await expect(page.locator('.menu-title')).toContainText('일시 정지');
    await expect(dice, 'paused: the dice stop rattling').not.toHaveClass(/is-shaking/);
    await page.locator('.menu-item.is-primary').click(); // 계속하기
    await expect(dice, 'resumed mid-hold: rattling again').toHaveClass(/is-shaking/);
    await expect(page.locator('.roll-pad')).toHaveClass(/is-held/);
    expect(await page.evaluate(() => window.__lotAndRoll!.getState()!.phase.kind), 'still holding, not rolled').toBe('preRoll');
    await page.evaluate(() => window.__lotAndRoll!.cpuHand().freeze(false));
    await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.getState()!.phase.kind), { timeout: 30_000 }).not.toBe('preRoll');
    checkPress((await log(page)).find((r) => r.phase === 'preRoll')!, 'roll after pause');
    expect(logs, logs.join('\n')).toEqual([]);
  });

  for (const vp of [
    { w: 1600, h: 1000 },
    { w: 800, h: 450 },
  ]) {
    test(`${vp.w}x${vp.h}: the hand on the control, seats S and N (screenshots)`, async ({ page }) => {
      test.setTimeout(240_000);
      const logs = watchConsole(page, { warnings: true, ignore: /favicon|Failed to load resource/ });
      await bootGame(page, vp.w, vp.h);
      const size = `${vp.w}x${vp.h}`;
      checkPress(await shotAtPress(page, `cpu-hand-roll-S-${size}.png`, S, '', /^preRoll:Roll$/), 'roll S');
      checkPress(await shotAtPress(page, `cpu-hand-roll-N-${size}.png`, N, '', /^preRoll:Roll$/), 'roll N');
      checkPress(await shotAtPress(page, `cpu-hand-buy-S-${size}.png`, S, BUY, /^buy:/), 'buy S');
      checkPress(await shotAtPress(page, `cpu-hand-pass-N-${size}.png`, N, PASS, /^buy:/), 'pass N');
      checkPress(await shotAtPress(page, `cpu-hand-travel-S-${size}.png`, S, TRAVEL, /^travel:/), 'travel S');
      checkPress(await shotAtPress(page, `cpu-hand-island-N-${size}.png`, N, ISLAND, /^island:/), 'island N');
      // East / west land on their controls too (no screenshot).
      for (const pid of [E, W]) {
        await craft(page, pid, BUY);
        checkPress(await waitPress(page, /^buy:/), `buy seat ${pid}`);
      }
      expect(logs, logs.join('\n')).toEqual([]);
    });
  }
});
