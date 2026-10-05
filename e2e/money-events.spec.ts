/**
 * Money cut-ins in the real game (docs/MONEY-EVENTS.md §11): seeded scenarios played by clicking
 * the real controls at normal speed — a human buys and builds, pays a toll to another seat (and
 * takes the city over), draws a collect-from-all card, pays tax. For each: the money stage is up
 * while it plays, the dev log names the scene that ran, the wallets' labels end on the engine's
 * cash, no console errors, and afterwards the stage is parked (no clock callback = zero idle).
 *
 * The second block captures in-game filmstrips under the manual clock (1600×1000 and 800×450,
 * seats S and N): docs/assets/money-ingame/<scene>-<seat>-<w>x<h>.jpg (every 2 ticks while the stage
 * is live) and a key frame each in e2e/__screenshots__/money-<scene>-<seat>-<w>x<h>.png.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

interface LogEntry {
  scene: string;
  play: string;
  tier: string;
  keep: boolean;
  events: string[];
  wallets: Record<string, string>;
}

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

async function boot(page: Page, w: number, h: number): Promise<void> {
  await page.setViewportSize({ width: w, height: h });
  await page.goto('/?dev=1');
  await page.waitForFunction(() => !!window.__lotAndRoll && document.getElementById('app')?.dataset.screen === 'title', null, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}

/**
 * A fresh 4-human game (easy rules: one card, no card choice), the player at `seat` to act, patched
 * by `patch(s, me, other)` (`other(k)` = the player k seats on) and resumed. Normal speed.
 */
async function craft(page: Page, seat: string, patch: string, manual = false): Promise<void> {
  await page.evaluate(
    ({ seat, patch, manual }) => {
      const hook = window.__lotAndRoll!;
      hook.manualClock(false);
      if (manual) hook.setAnimSpeed(1);
      hook.setPromptTimer(0);
      hook.startGame({ ...hook.demoSettings(4, false), rules: 'easy' } as never, 7);
      const s = hook.getState()!;
      const me = s.players.findIndex((p) => p.seat === seat);
      s.current = me;
      s.phase = { kind: 'preRoll', playerId: me, rollAgain: false };
      const other = (k: number): number => (me + k) % s.players.length;
      new Function('s', 'me', 'other', patch)(s, me, other);
      hook.loadState(s);
      (window as unknown as { __moneyLog: unknown[] }).__moneyLog.length = 0;
    },
    { seat, patch, manual },
  );
  await page.waitForSelector('.game .board');
  await page.evaluate(() => window.__lotAndRoll!.whenIdle());
  await page.waitForTimeout(300);
}

const log = (page: Page): Promise<LogEntry[]> => page.evaluate(() => (window as unknown as { __moneyLog: LogEntry[] }).__moneyLog.slice());
const stageLive = (page: Page): Promise<boolean> => page.evaluate(() => !!document.querySelector('.money-stage.is-live'));

/** Click the prompt control for `action`, watch the stage come up, wait for the next human prompt. */
async function act(page: Page, action: string): Promise<{ sawStage: boolean }> {
  const btn = page.locator(`.st-prompt [data-action="${action}"]:not(:disabled)`).first();
  await expect(btn).toBeVisible({ timeout: 30_000 });
  const n0 = (await log(page)).length;
  await btn.click();
  // The stage must be seen live while the scene plays (polled from the page every frame).
  const sawStage = await page.evaluate(
    (n0) =>
      new Promise<boolean>((resolve) => {
        const t0 = performance.now();
        let seen = false;
        const tick = (): void => {
          if (document.querySelector('.money-stage.is-live')) seen = true;
          const done = (window as unknown as { __moneyLog: unknown[] }).__moneyLog.length > n0 && !window.__lotAndRoll!.isBusy();
          if ((seen && done) || performance.now() - t0 > 40_000) resolve(seen);
          else requestAnimationFrame(tick);
        };
        tick();
      }),
    n0,
  );
  await page.evaluate(() => window.__lotAndRoll!.whenIdle());
  return { sawStage };
}

/** The last scene's wallets show the engine's cash (digits of the label = cash). */
async function expectWalletsMatch(page: Page, entry: LogEntry): Promise<void> {
  const cash = await page.evaluate(() => {
    const s = window.__lotAndRoll!.getState()!;
    return Object.fromEntries(s.players.map((p) => [p.seat, p.cash]));
  });
  expect(Object.keys(entry.wallets).length, `${entry.scene}: wallets shown`).toBeGreaterThan(0);
  for (const [seat, label] of Object.entries(entry.wallets)) expect(Number(label.replace(/\D/g, '')), `${entry.scene} wallet ${seat} = engine cash`).toBe(cash[seat]);
}

/** Parked and idle: off-screen, no scene clock, no frame callback. */
async function expectParked(page: Page): Promise<void> {
  await expect.poll(() => stageLive(page), { timeout: 8000 }).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.activeTicks()), { timeout: 8000 }).toBe(0);
  const st = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.money-stage')!;
    const r = el.getBoundingClientRect();
    return { right: r.right, transform: getComputedStyle(el).transform, board: document.querySelector<HTMLElement>('.game .board')!.style.transform };
  });
  expect(st.right, 'stage parked off-screen').toBeLessThanOrEqual(0);
  expect(st.board, 'board camera back').toBe('');
}

test.describe('money cut-ins (normal speed, real controls)', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('buy + build, toll + takeover, collect-from-all card, tax', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = watchConsole(page);
    await boot(page, 1600, 1000);

    // 1. Buy Cairo, then build a villa on it.
    await craft(page, 'S', `s.players[me].position = 0; s.testHooks = { diceQueue: [[1, 3]] };`);
    await act(page, 'Roll');
    let r = await act(page, 'Buy');
    expect(r.sawStage, 'purchase: stage up').toBe(true);
    let L = await log(page);
    expect(L.at(-1)!.scene).toBe('purchase');
    await expectWalletsMatch(page, L.at(-1)!);
    r = await act(page, 'Build');
    expect(r.sawStage, 'build: stage up').toBe(true);
    L = await log(page);
    expect(L.at(-1)!.scene).toBe('build');
    await expectWalletsMatch(page, L.at(-1)!);
    expect(await page.evaluate(() => window.__lotAndRoll!.getState()!.properties[4])).toMatchObject({ owner: 0, level: 1 });
    await expectParked(page);

    // 2. Toll to the opposite seat on Cairo (villa), then take the city over.
    await craft(page, 'S', `s.players[me].position = 0; s.players[me].cash = 3000; s.properties[4] = { owner: other(2), level: 1 }; s.testHooks = { diceQueue: [[1, 3]] };`);
    r = await act(page, 'Roll');
    expect(r.sawStage, 'toll: stage up').toBe(true);
    L = await log(page);
    expect(L.map((e) => e.scene)).toContain('toll');
    const toll = L.find((e) => e.scene === 'toll')!;
    expect(Object.keys(toll.wallets).sort()).toEqual(['N', 'S']);
    await expectWalletsMatch(page, toll);
    r = await act(page, 'Takeover');
    expect(r.sawStage, 'takeover: stage up').toBe(true);
    L = await log(page);
    expect(L.at(-1)!.scene).toBe('takeover');
    await expectWalletsMatch(page, L.at(-1)!);
    expect(await page.evaluate(() => window.__lotAndRoll!.getState()!.properties[4]!.owner)).toBe(0);
    await expectParked(page);

    // 3. Happy birthday: every other player pays into the centre, the total flies to me.
    await craft(page, 'S', `s.players[me].position = 0; s.testHooks = { diceQueue: [[1, 2]], cardQueue: ['birthday'] };`);
    r = await act(page, 'Roll');
    expect(r.sawStage, 'collect: stage up').toBe(true);
    L = await log(page);
    const col = L.find((e) => e.scene === 'collectFromAll')!;
    expect(col, 'collectFromAll ran').toBeTruthy();
    expect(Object.keys(col.wallets).sort()).toEqual(['E', 'N', 'S', 'W']);
    await expectWalletsMatch(page, col);
    await expectParked(page);

    // 4. Tax office.
    await craft(page, 'S', `s.players[me].position = 20; s.players[me].cash = 4560; s.testHooks = { diceQueue: [[1, 2]] };`);
    r = await act(page, 'Roll');
    expect(r.sawStage, 'tax: stage up').toBe(true);
    L = await log(page);
    expect(L.at(-1)!.scene).toBe('pay');
    expect(L.at(-1)!.play).toBe('tax');
    await expectWalletsMatch(page, L.at(-1)!);
    await expectParked(page);

    expect(errors, errors.join('\n')).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------- filmstrips

const EVERY = 2;
const STRIPS = 'docs/assets/money-ingame';
const SHOTS = 'e2e/__screenshots__';

interface Shot {
  img: string;
  label: string;
}

/** Dispatch `action` under the manual clock; a shot every EVERY ticks while the stage is live. */
async function capture(page: Page, action: string, maxTicks = 900): Promise<Shot[]> {
  await page.evaluate((a) => {
    const hook = window.__lotAndRoll!;
    hook.manualClock(true);
    const w = window as unknown as { __mDone: boolean };
    w.__mDone = false;
    const s = hook.getState()!;
    const act = hook.legal().find((x) => x.type === a)!;
    void hook.dispatch(act ?? { type: a, playerId: (s.phase as { playerId: number }).playerId } as never).then(() => (w.__mDone = true));
  }, action);
  const shots: Shot[] = [];
  let wasLive = false;
  for (let tick = 0; tick <= maxTicks; tick += EVERY) {
    if (tick) await page.evaluate((n) => window.__lotAndRoll!.stepFrames(n), EVERY);
    const st = await page.evaluate(() => {
      const ms = document.querySelector('.money-stage');
      return {
        live: !!ms?.classList.contains('is-live'),
        done: (window as unknown as { __mDone: boolean }).__mDone,
        coins: document.querySelectorAll('.money-stage .mc[style*="opacity: 1"]').length,
        scenes: (window as unknown as { __moneyLog: unknown[] }).__moneyLog.length,
      };
    });
    if (st.live) shots.push({ img: (await page.screenshot({ type: 'png' })).toString('base64'), label: `t${tick} c${st.coins} s${st.scenes}` });
    if (wasLive && !st.live && shots.length) shots.push({ img: (await page.screenshot({ type: 'png' })).toString('base64'), label: `t${tick} parked` });
    wasLive = st.live;
    if (st.done && !st.live) break;
  }
  await page.evaluate(() => window.__lotAndRoll!.stepFrames(30));
  await page.evaluate(() => window.__lotAndRoll!.manualClock(false));
  await page.evaluate(() => window.__lotAndRoll!.whenIdle());
  return shots;
}

async function compose(page: Page, shots: Shot[], title: string, w: number, h: number): Promise<Buffer> {
  const composer = await page.context().newPage();
  try {
    const b64 = await composer.evaluate(
      async ({ shots, title, w, h }) => {
        const cols = 8;
        const tw = 250;
        const th = Math.round((h * tw) / w);
        const rows = Math.ceil(shots.length / cols);
        const c = document.createElement('canvas');
        c.width = Math.min(cols, shots.length) * tw;
        c.height = rows * (th + 16) + 26;
        const g = c.getContext('2d')!;
        g.fillStyle = '#0E141C';
        g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#E8EDF5';
        g.font = 'bold 15px sans-serif';
        g.fillText(title, 6, 18);
        for (let i = 0; i < shots.length; i++) {
          const img = new Image();
          img.src = `data:image/png;base64,${shots[i]!.img}`;
          await img.decode();
          const x = (i % cols) * tw;
          const y = 26 + Math.floor(i / cols) * (th + 16);
          g.drawImage(img, x, y, tw - 2, th);
          g.fillStyle = '#9FB0C8';
          g.font = '11px monospace';
          g.fillText(shots[i]!.label, x + 3, y + th + 12);
        }
        return c.toDataURL('image/jpeg', 0.8).split(',')[1]!;
      },
      { shots, title, w, h },
    );
    return Buffer.from(b64, 'base64');
  } finally {
    await composer.close();
  }
}

const SCENARIOS: Array<{ name: string; patch: string; pre?: string[]; action: string; key?: number }> = [
  { name: 'buy', patch: `s.players[me].position = 0; s.testHooks = { diceQueue: [[1, 3]] };`, pre: ['Roll'], action: 'Buy' },
  { name: 'build', patch: `s.players[me].position = 0; s.properties[4] = { owner: me, level: 0 }; s.testHooks = { diceQueue: [[1, 3]] };`, pre: ['Roll'], action: 'Build' },
  { name: 'toll', patch: `s.players[me].position = 0; s.properties[4] = { owner: other(2), level: 2 }; s.testHooks = { diceQueue: [[1, 3]] };`, action: 'Roll' },
  { name: 'takeover', patch: `s.players[me].position = 0; s.players[me].cash = 3500; s.properties[4] = { owner: other(1), level: 1 }; s.testHooks = { diceQueue: [[1, 3]] };`, pre: ['Roll'], action: 'Takeover' },
  { name: 'collect', patch: `s.players[me].position = 0; s.testHooks = { diceQueue: [[1, 2]], cardQueue: ['birthday'] };`, action: 'Roll' },
  { name: 'tax', patch: `s.players[me].position = 20; s.players[me].cash = 4560; s.testHooks = { diceQueue: [[1, 2]] };`, action: 'Roll' },
];

for (const size of [{ w: 1600, h: 1000 }, { w: 800, h: 450 }]) {
  for (const seat of ['S', 'N']) {
    test(`filmstrips ${size.w}x${size.h} seat ${seat}`, async ({ page }) => {
      test.setTimeout(420_000);
      const errors = watchConsole(page);
      await boot(page, size.w, size.h);
      mkdirSync(STRIPS, { recursive: true });
      for (const sc of SCENARIOS) {
        await craft(page, seat, sc.patch, true);
        for (const a of sc.pre ?? []) {
          await page.evaluate((a) => {
            const hook = window.__lotAndRoll!;
            return hook.dispatch(hook.legal().find((x) => x.type === a)!);
          }, a);
          await page.evaluate(() => window.__lotAndRoll!.whenIdle());
        }
        const shots = await capture(page, sc.action);
        expect(shots.length, `${sc.name}: stage seen`).toBeGreaterThan(6);
        const tag = `${sc.name}-${seat}-${size.w}x${size.h}`;
        // Review aid: MONEY_SHOTS_DIR=… dumps every frame at full size.
        if (process.env.MONEY_SHOTS_DIR) shots.forEach((x, k) => writeFileSync(`${process.env.MONEY_SHOTS_DIR}/${tag}-${String(k).padStart(3, '0')}.png`, Buffer.from(x.img, 'base64')));
        writeFileSync(`${STRIPS}/${tag}.jpg`, await compose(page, shots, `${sc.name} @${seat} ${size.w}x${size.h} — every ${EVERY} ticks while the money stage is live`, size.w, size.h));
        // Key frame: just past the middle of the cut-in (coins arriving / result).
        const key = shots[Math.min(shots.length - 1, Math.round(shots.length * (sc.key ?? 0.55)))]!;
        writeFileSync(`${SHOTS}/money-${tag}.png`, Buffer.from(key.img, 'base64'));
        await expectParked(page);
      }
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
}
