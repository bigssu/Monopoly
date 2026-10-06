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
import { boot, watchConsole } from './helpers';
import { reduceMotion } from './motion';

interface LogEntry {
  stillMs: number;
  liveMs: number;
  scene: string;
  play: string;
  tier: string;
  keep: boolean;
  events: string[];
  wallets: Record<string, string>;
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
      void manual; // filmstrips run at the default game pace (no setAnimSpeed: it would set pace 1)
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
  const btn = page.locator(`.stage [data-action="${action}"]:not(:disabled)`).first();
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

/**
 * Pose-to-pose beats (MONEY-EVENTS §12) + EVENT_EXTEND (fx/time.ts, +0.5 s motion, +0.5 s still):
 * every cut-in ≥ 4.1 s on screen, a still hold ≥ 1.5 s before it hands back.
 */
function expectBeats(e: LogEntry): void {
  expect(e.liveMs, `${e.play}: ${e.liveMs} ms on screen`).toBeGreaterThanOrEqual(3950);
  expect(e.stillMs, `${e.play}: still ${e.stillMs} ms`).toBeGreaterThanOrEqual(1450);
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
    await boot(page, { w: 1600, h: 1000 });

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
    for (const e of await log(page)) expectBeats(e);

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
    for (const e of await log(page)) expectBeats(e);

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
    for (const e of await log(page)) expectBeats(e);

    // 4. Tax office.
    await craft(page, 'S', `s.players[me].position = 20; s.players[me].cash = 4560; s.testHooks = { diceQueue: [[1, 2]] };`);
    r = await act(page, 'Roll');
    expect(r.sawStage, 'tax: stage up').toBe(true);
    L = await log(page);
    expect(L.at(-1)!.scene).toBe('pay');
    expect(L.at(-1)!.play).toBe('tax');
    await expectWalletsMatch(page, L.at(-1)!);
    await expectParked(page);
    for (const e of await log(page)) expectBeats(e);
    console.log(`[money] on screen: ${(await log(page)).map((e) => `${e.play} ${e.liveMs} ms (still ${e.stillMs})`).join(', ')}`);

    expect(errors, errors.join('\n')).toEqual([]);
  });
});

const TOLL = `s.players[me].position = 0; s.players[me].cash = 3000; s.properties[4] = { owner: other(2), level: 2 }; s.testHooks = { diceQueue: [[1, 3]] };`;

/** Roll into the toll and time the cut-in: ms from the stage going live to parked, coins seen. */
async function timeToll(page: Page, during?: () => Promise<void>): Promise<{ liveMs: number; coinsSeen: number }> {
  await page.locator('.stage [data-action="Roll"]:not(:disabled)').click();
  await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.money()!.live), { timeout: 20_000 }).toBe(true);
  const t0 = Date.now();
  const sampler = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let coins = 0;
        const tick = (): void => {
          coins = Math.max(coins, document.querySelectorAll('.money-stage .mc[style*="opacity: 1"]').length);
          if (window.__lotAndRoll!.money()!.live) requestAnimationFrame(tick);
          else resolve(coins);
        };
        tick();
      }),
  );
  await during?.();
  const coinsSeen = await sampler;
  return { liveMs: Date.now() - t0, coinsSeen };
}

test.describe('money cut-ins follow the time policy (fx/time.ts)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('pause freezes the scene clock, resume finishes it; a skip tap plays it ×5', async ({ page }) => {
    test.setTimeout(150_000);
    const errors = watchConsole(page);
    await boot(page, { w: 1280, h: 800 });
    // Normal speed, for reference.
    await craft(page, 'S', TOLL);
    const normal = await timeToll(page);
    await page.evaluate(() => window.__lotAndRoll!.whenIdle());
    expect(normal.coinsSeen, 'coins fly').toBeGreaterThan(2);

    // Pause in the middle: the scene clock stands still (and nothing ticks), resume carries on.
    await craft(page, 'S', TOLL);
    await timeToll(page, async () => {
      await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.money()!.t), { timeout: 10_000 }).toBeGreaterThan(600);
      await page.locator('.pause-btn').click();
      await expect(page.locator('.menu-title')).toContainText('일시 정지');
      const t1 = await page.evaluate(() => window.__lotAndRoll!.money()!.t);
      await page.waitForTimeout(1500);
      expect(await page.evaluate(() => window.__lotAndRoll!.money()!.t), 'clock frozen while paused').toBe(t1);
      expect(await page.evaluate(() => window.__lotAndRoll!.money()!.live)).toBe(true);
      await page.locator('.menu-item.is-primary').click();
    });
    await page.evaluate(() => window.__lotAndRoll!.whenIdle());
    expect((await log(page)).map((e) => e.scene)).toContain('toll');

    // Skip: a tap on the table plays the rest ×5.
    await craft(page, 'S', TOLL);
    const skipped = await timeToll(page, async () => {
      await page.waitForTimeout(150);
      await page.mouse.click(640, 400);
    });
    console.log(`[money] toll cut-in: normal ${normal.liveMs} ms, skipped ${skipped.liveMs} ms`);
    expect(skipped.liveMs, 'skip shortens the cut-in').toBeLessThan(normal.liveMs * 0.6);
    await page.evaluate(() => window.__lotAndRoll!.whenIdle());
    await expectParked(page);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('headless (speed 0): no cut-in, the state is applied at once', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page, { w: 1280, h: 800 });
    await craft(page, 'S', TOLL);
    const res = await page.evaluate(async () => {
      const h = window.__lotAndRoll!;
      h.setAnimSpeed(0);
      let seen = false;
      const id = setInterval(() => (seen ||= !!h.money()?.live), 5);
      const s0 = h.getState()!;
      await h.dispatch({ type: 'Roll', playerId: s0.current });
      clearInterval(id);
      const s = h.getState()!;
      const owner = s.properties[4]!.owner!;
      return { seen, live: h.money()!.live, ticks: h.activeTicks(), payer: s.players[s0.current]!.cash, owner: s.players[owner]!.cash, logged: (window as unknown as { __moneyLog: unknown[] }).__moneyLog.length };
    });
    expect(res.seen, 'stage never up').toBe(false);
    expect(res.live).toBe(false);
    expect(res.logged, 'no scene played').toBe(0);
    expect(res.payer, 'toll paid').toBeLessThan(3000);
    expect(res.owner).toBeGreaterThan(3000);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('reduced-motion setting: same beats and numbers, no flying coins', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = watchConsole(page);
    await reduceMotion(page);
    await boot(page, { w: 1280, h: 800 });
    await craft(page, 'S', TOLL);
    const r = await timeToll(page);
    await page.evaluate(() => window.__lotAndRoll!.whenIdle());
    console.log(`[money] toll cut-in with reduced motion: ${r.liveMs} ms, coins seen ${r.coinsSeen}`);
    expect(r.coinsSeen, 'no coin moves').toBe(0);
    expect(r.liveMs, 'time is kept').toBeGreaterThan(1500);
    const L = await log(page);
    const toll = L.find((e) => e.scene === 'toll')!;
    await expectWalletsMatch(page, toll);
    await expectParked(page);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

test('CPU buy: the hand presses and leaves, then the cut-in plays (no overlap)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchConsole(page);
  await boot(page, { w: 1600, h: 1000 });
  // Seat N is a CPU at the buy prompt for Cairo.
  await page.evaluate(() => {
    const hook = window.__lotAndRoll!;
    hook.setPromptTimer(0);
    hook.startGame({ ...hook.demoSettings(4, false), rules: 'easy' } as never, 7);
    const s = hook.getState()!;
    const me = s.players.findIndex((p) => p.seat === 'N');
    s.players[me]!.isCpu = true;
    s.players[me]!.position = 4;
    s.current = me;
    s.phase = { kind: 'buy', playerId: me, spaceIndex: 4, price: 160 };
    hook.loadState(s);
    (window as unknown as { __moneyLog: unknown[] }).__moneyLog.length = 0;
  });
  await page.waitForSelector('.game .board');
  // Sample every frame: is a hand out, is the stage up (and opaque enough to cover it)?
  const r = await page.evaluate(
    () =>
      new Promise<{ both: number; handFrames: number; stageFrames: number; order: string }>((resolve) => {
        let both = 0;
        let handFrames = 0;
        let stageFrames = 0;
        let order = '';
        const t0 = performance.now();
        const tick = (): void => {
          const hand = !!document.querySelector('.cpu-hand-layer');
          const st = document.querySelector<HTMLElement>('.money-stage.is-live');
          const up = !!st && Number(getComputedStyle(st).opacity) > 0.05;
          if (hand) handFrames++;
          if (up) stageFrames++;
          if (hand && up) both++;
          const k = hand ? 'H' : up ? 'S' : '';
          if (k && !order.endsWith(k)) order += k;
          const done = (window as unknown as { __moneyLog: unknown[] }).__moneyLog.length > 0 && !st;
          if (done || performance.now() - t0 > 30_000) resolve({ both, handFrames, stageFrames, order });
          else requestAnimationFrame(tick);
        };
        tick();
      }),
  );
  console.log(`[money] CPU buy: hand ${r.handFrames} frames, stage ${r.stageFrames} frames, both ${r.both}, order ${r.order}`);
  expect(r.handFrames, 'the hand pressed').toBeGreaterThan(5);
  expect(r.stageFrames, 'the cut-in played').toBeGreaterThan(20);
  expect(r.both, 'hand and cut-in never on screen together').toBe(0);
  expect(r.order.startsWith('HS'), `hand first, then the stage (${r.order})`).toBe(true);
  const L = await log(page);
  expect(L[0]!.scene).toBe('purchase');
  expect(errors, errors.join('\n')).toEqual([]);
});

test.describe('render tiers (MONEY-EVENTS §13)', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  for (const tier of ['high', 'mid', 'low'] as const) {
    test(`tier ${tier}: the cut-in plays at its render scale and parks`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = watchConsole(page);
      await boot(page, { w: 1600, h: 1000, query: `&mres=${tier}` });
      await craft(page, 'S', TOLL);
      const info = await page.evaluate(() => window.__lotAndRoll!.money()!);
      expect(info.tier).toBe(tier);
      expect(info.scale).toBe({ high: 1, mid: 0.75, low: 0.5 }[tier]);
      const r = await act(page, 'Roll');
      expect(r.sawStage, 'stage up').toBe(true);
      const toll = (await log(page)).find((e) => e.scene === 'toll')!;
      await expectWalletsMatch(page, toll);
      await expectParked(page);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }

  test('low vs high: same layout, only the resolution differs (screenshots)', async ({ page }) => {
    test.setTimeout(120_000);
    const rects: Record<string, unknown> = {};
    for (const tier of ['high', 'low'] as const) {
      // 3D off on both: the high tier would tilt the hero (a different box), this compares resolution only.
      await boot(page, { w: 1600, h: 1000, query: `&mres=${tier}&m3d=0` });
      await craft(page, 'S', TOLL, true);
      await page.evaluate(() => {
        const hook = window.__lotAndRoll!;
        hook.manualClock(true);
        void hook.dispatch({ type: 'Roll', playerId: hook.getState()!.current });
      });
      // Step to the moment the total locks in on the city (same scene frame on both tiers).
      for (let k = 0; k < 400; k++) {
        await page.evaluate(() => window.__lotAndRoll!.stepFrames(2));
        const t = await page.evaluate(() => window.__lotAndRoll!.money()!.t);
        if (t >= 1700) break;
      }
      writeFileSync(`${SHOTS}/money-tier-${tier}-1600x1000.png`, await page.screenshot());
      rects[tier] = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.money-stage .mw.is-on, .money-stage .ms-hero, .money-stage .ms-plq')]
          .filter((e) => getComputedStyle(e).opacity !== '0')
          .map((e) => {
            const b = e.getBoundingClientRect();
            return [e.className.split(' ')[0], Math.round(b.x / 4), Math.round(b.y / 4), Math.round(b.width / 4), Math.round(b.height / 4)].join(' ');
          }),
      );
      await page.evaluate(() => window.__lotAndRoll!.stepFrames(200));
      await page.evaluate(() => window.__lotAndRoll!.manualClock(false));
    }
    // Same boxes on both tiers (units of 4 px, ±1 for text metrics at the smaller size): the stage
    // is laid out at s × size and scaled back.
    const lo = rects.low as string[];
    const hi = rects.high as string[];
    expect(lo.length).toBe(hi.length);
    lo.forEach((r, i) => {
      const a = r.split(' ');
      const b = hi[i]!.split(' ');
      expect(a[0]).toBe(b[0]);
      for (let k = 1; k < 5; k++) expect(Math.abs(Number(a[k]) - Number(b[k])), `${r} vs ${hi[i]}`).toBeLessThanOrEqual(1);
    });
  });
});

// ------------------------------------------------------------------------------------- filmstrips

const EVERY = 2;
const STRIPS = 'docs/assets/money-ingame';
const SHOTS = 'e2e/__screenshots__';

interface Shot {
  img: string;
  label: string;
  /** What `probe` read in the page at that tick. */
  data?: unknown;
}

interface CaptureOpts {
  /** Read something in the page at every live tick (stored on the shot). */
  probe?: () => unknown;
  /** Take screenshots (default true; false = probe only). */
  shoot?: boolean;
}

/** Dispatch `action` under the manual clock; a shot every EVERY ticks while the stage is live. */
async function capture(page: Page, action: string, maxTicks = 900, o: CaptureOpts = {}): Promise<Shot[]> {
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
    const shoot = async (): Promise<string> => (o.shoot === false ? '' : (await page.screenshot({ type: 'png' })).toString('base64'));
    if (st.live) shots.push({ img: await shoot(), label: `t${tick} c${st.coins} s${st.scenes}`, ...(o.probe ? { data: await page.evaluate(o.probe) } : {}) });
    if (wasLive && !st.live && shots.length) shots.push({ img: await shoot(), label: `t${tick} parked` });
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
      // Six cut-ins of 4–6.5 s (EVENT_EXTEND), screenshot every 2 ticks: ~100 s each on this VM.
      test.setTimeout(720_000);
      const errors = watchConsole(page);
      await boot(page, { w: size.w, h: size.h });
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

test.describe('a cut-in cut short (review round 1)', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });
  const TAX = `s.players[me].position = 20; s.players[me].cash = 4560; s.testHooks = { diceQueue: [[1, 2]] };`;
  const idleWithin = (page: Page, ms: number): Promise<boolean> =>
    page.evaluate((ms) => Promise.race([window.__lotAndRoll!.whenIdle().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]), ms);

  for (const how of ['resize', 'orientationchange'] as const) {
    test(`${how} 300 ms into a cut-in: the scene finishes at once, the game reaches the next prompt`, async ({ page }) => {
      const errors = watchConsole(page);
      await boot(page, { w: 1600, h: 1000 });
      await craft(page, 'S', TAX);
      await page.locator('.stage [data-action="Roll"]:not(:disabled)').click();
      await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.money()?.t ?? 0), { timeout: 20_000, intervals: [16] }).toBeGreaterThan(300);
      if (how === 'resize') await page.setViewportSize({ width: 1500, height: 1000 });
      else await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
      expect(await idleWithin(page, 20_000), 'the game goes on (no hang)').toBe(true);
      await expect(page.locator('.stage [data-action]:not(:disabled)').first()).toBeVisible();
      const r = await page.evaluate(() => {
        const s = window.__lotAndRoll!.getState()!;
        return {
          engine: s.players.map((p) => p.cash),
          panel: [...document.querySelectorAll<HTMLElement>('.pp')].map((el) => ({ pid: Number(el.dataset.pid), cash: Number((el.querySelector('.pp-cash-n')?.textContent ?? '').replace(/\D/g, '')) })),
        };
      });
      for (const p of r.panel) expect(p.cash, `panel ${p.pid} = engine cash`).toBe(r.engine[p.pid]);
      await expectParked(page);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------- selling

/**
 * In debt (docs/MONEY-EVENTS.md §11.1 "sell"): I sit on 12 with 280, own Cairo (4, building) and
 * Nairobi (6, villa); 2 + 3 takes me to Madrid (17, the next player's villa): a 360 toll, 80 short.
 * Two building sales to the bank (45 + 50) pay it.
 */
const DEBT = `s.players[me].position = 12; s.players[me].cash = 280; s.properties[4] = { owner: me, level: 2 }; s.properties[6] = { owner: me, level: 1 }; s.properties[17] = { owner: other(1), level: 1 }; s.testHooks = { diceQueue: [[2, 3]] };`;

/** The sad sprite's lower eyelids (fractions of the sprite; scenes.ts SAD_EYES, measured on public/dealer/sad.webp). */
const EYES = [{ x: 0.405, y: 0.398 }, { x: 0.548, y: 0.374 }];

interface CryProbe {
  src: string;
  /** Sprite box on screen (px). */
  w: number;
  /** Tear streams: top / bottom centre relative to the sprite box, and grown (> 0 px tall). */
  streams: Array<{ x: number; y: number; yb: number; h: number }>;
  /** Visible drops: centre relative to the sprite box. */
  drops: Array<{ x: number; y: number }>;
}

/** Where the tears are on the crying dealer (relative to the sprite's box on screen). */
function cryProbe(): CryProbe | null {
  const img = document.querySelector<HTMLElement>('.money-stage .mh-crier-img');
  if (!img) return null;
  const r = img.getBoundingClientRect();
  if (!r.width) return null;
  const rel = (e: Element) => {
    const b = e.getBoundingClientRect();
    return { x: (b.left + b.width / 2 - r.left) / r.width, y: (b.top - r.top) / r.height, yb: (b.bottom - r.top) / r.height, cy: (b.top + b.height / 2 - r.top) / r.height, h: b.height, o: Number(getComputedStyle(e).opacity) };
  };
  return {
    src: img.getAttribute('src') ?? '',
    w: r.width,
    streams: [...document.querySelectorAll('.money-stage .mh-stream')].map(rel).map((q) => ({ x: q.x, y: q.y, yb: q.yb, h: q.h })),
    drops: [...document.querySelectorAll('.money-stage .mh-tear')].map(rel).filter((q) => q.o > 0.05).map((q) => ({ x: q.x, y: q.cy })),
  };
}

/**
 * Every grown stream starts on an eye's lower lid; every drop is on the face or falling from it.
 * `flip`: the hero faces seat N (turned 180° on screen): the sprite's own coordinates are 1 − screen.
 */
function expectTearsOnFace(p: CryProbe, where: string, flip = false): void {
  const grown = p.streams.filter((q) => q.h > 1);
  expect(grown.length, `${where}: both streams`).toBe(2);
  grown.forEach((q, i) => {
    const x = flip ? 1 - q.x : q.x;
    const y = flip ? 1 - q.yb : q.y;
    expect(Math.abs(x - EYES[i]!.x), `${where}: stream ${i} x ${x.toFixed(3)}`).toBeLessThanOrEqual(0.03);
    expect(Math.abs(y - EYES[i]!.y), `${where}: stream ${i} y ${y.toFixed(3)}`).toBeLessThanOrEqual(0.03);
  });
  for (const d0 of p.drops) {
    const d = flip ? { x: 1 - d0.x, y: 1 - d0.y } : d0;
    expect(d.x, `${where}: drop x`).toBeGreaterThan(0.3);
    expect(d.x, `${where}: drop x`).toBeLessThan(0.65);
    expect(d.y, `${where}: drop y`).toBeGreaterThan(0.33);
    expect(d.y, `${where}: drop y`).toBeLessThan(0.75);
  }
}

test.describe('selling to the bank: the crying dealer (owner review 2026-10-06)', () => {
  test('debt: every sale is a crying-dealer cut-in, wallets = engine cash, the last one chains into the toll', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = watchConsole(page);
    await boot(page, { w: 1600, h: 1000 });
    await craft(page, 'S', DEBT);
    await act(page, 'Roll');
    expect(await page.evaluate(() => window.__lotAndRoll!.getState()!.phase.kind)).toBe('debt');
    // Sell the cheapest building first (a real tap on the debt card), then whatever the card suggests.
    let sold = 0;
    for (let k = 0; k < 6; k++) {
      const phase = await page.evaluate(() => window.__lotAndRoll!.getState()!.phase.kind);
      if (phase !== 'debt') break;
      const action = k === 0 ? 'SellBuilding' : await page.locator('.pc-debt .debt-row.is-best [data-action]').first().getAttribute('data-action');
      const r = await act(page, action!);
      expect(r.sawStage, `sale ${k}: stage up`).toBe(true);
      sold++;
    }
    expect(sold).toBeGreaterThan(0);
    const L = await log(page);
    const sells = L.filter((e) => e.scene === 'sell');
    expect(sells.length, L.map((e) => e.scene).join(',')).toBe(sold);
    sells.forEach((e, k) => {
      expect(e.play).toBe('sell');
      expect(Object.keys(e.wallets)).toEqual(['S']);
      // A repeat of the same kind in a turn plays at 0.7× (§12.1, §12.4): still ≥ 4.1 s on screen,
      // its still hold 0.7 × 1 s + holdMs.
      if (k === 0) expectBeats(e);
      else {
        expect(e.liveMs, `sell ${k}: ${e.liveMs} ms on screen`).toBeGreaterThanOrEqual(3950);
        expect(e.stillMs, `sell ${k}: still ${e.stillMs} ms`).toBeGreaterThanOrEqual(1150);
      }
    });
    // The first sale's wallet ended on what the engine had then (+ the sale); the toll that the
    // last sale settles plays in the same cut-in (keep), and the wallets end on the engine's cash.
    expect(sells[0]!.events).toEqual(['BuildingSold', 'Demolished', 'MoneyChanged']);
    expect(sells.at(-1)!.keep).toBe(true);
    expect(L.at(-1)!.scene).toBe('toll');
    await expectWalletsMatch(page, L.at(-1)!);
    await expectParked(page);
    const st = await page.evaluate(() => window.__lotAndRoll!.getState()!);
    expect(st.phase.kind).not.toBe('debt');
    console.log(`[money] sell: ${sells.map((e) => `${e.liveMs} ms (still ${e.stillMs})`).join(', ')}`);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  for (const size of [{ w: 1600, h: 1000 }, { w: 800, h: 450 }]) {
    test(`filmstrip + crying hero ${size.w}x${size.h}`, async ({ page }) => {
      test.setTimeout(180_000);
      const errors = watchConsole(page);
      await boot(page, { w: size.w, h: size.h });
      mkdirSync(STRIPS, { recursive: true });
      await craft(page, 'S', DEBT, true);
      await page.evaluate(() => {
        const hook = window.__lotAndRoll!;
        return hook.dispatch(hook.legal().find((x) => x.type === 'Roll')!);
      });
      await page.evaluate(() => window.__lotAndRoll!.whenIdle());
      const shots = await capture(page, 'SellBuilding', 900, { probe: cryProbe });
      expect(shots.length, 'stage seen').toBeGreaterThan(6);
      const tag = `sell-S-${size.w}x${size.h}`;
      if (process.env.MONEY_SHOTS_DIR) shots.forEach((x, k) => writeFileSync(`${process.env.MONEY_SHOTS_DIR}/${tag}-${String(k).padStart(3, '0')}.png`, Buffer.from(x.img, 'base64')));
      writeFileSync(`${STRIPS}/${tag}.jpg`, await compose(page, shots, `sell (crying dealer) @S ${size.w}x${size.h} — every ${EVERY} ticks while the money stage is live`, size.w, size.h));
      // The hero is the sad dealer, big; tears on the face in every frame they show.
      const probes = shots.map((x) => x.data as CryProbe | null).filter((p): p is CryProbe => !!p);
      expect(probes.length).toBeGreaterThan(6);
      expect(probes.every((p) => p.src.endsWith('dealer/sad.webp'))).toBe(true);
      expect(Math.max(...probes.map((p) => p.w)), 'the dealer fills about half the short side').toBeGreaterThan(size.h * 0.45);
      const crying = probes.filter((p) => p.streams.some((q) => q.h > 1));
      expect(crying.length, 'crying for most of the cut-in').toBeGreaterThan(probes.length * 0.6);
      expect(crying.some((p) => p.drops.length >= 2), 'drops run down').toBe(true);
      // Fully grown streams (from a few frames in) sit on the eyes.
      crying.slice(4).forEach((p, k) => expectTearsOnFace(p, `frame ${k}`));
      // Key frame: the still hold (plaque up, tears running).
      const key = shots[Math.min(shots.length - 1, Math.round(shots.length * 0.75))]!;
      writeFileSync(`${SHOTS}/money-${tag}.png`, Buffer.from(key.img, 'base64'));
      await expectParked(page);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }

  test('tears sit on the face at every render tier and seat; reduced motion: still tears, same time', async ({ page }) => {
    test.setTimeout(300_000);
    const errors = watchConsole(page);
    for (const v of ['high', 'mid', 'low', 'N', 'reduced'] as const) {
      if (v === 'reduced') await reduceMotion(page);
      await boot(page, { w: 1280, h: 800, query: v === 'reduced' || v === 'N' ? '' : `&mres=${v}` });
      // Seat N: the cut-in turns 180° to face the seller across the table.
      await craft(page, v === 'N' ? 'N' : 'S', DEBT, true);
      await page.evaluate(() => {
        const hook = window.__lotAndRoll!;
        return hook.dispatch(hook.legal().find((x) => x.type === 'Roll')!);
      });
      await page.evaluate(() => window.__lotAndRoll!.whenIdle());
      const shots = await capture(page, 'SellBuilding', 900, { probe: cryProbe, shoot: false });
      const probes = shots.map((x) => x.data as CryProbe | null).filter((p): p is CryProbe => !!p);
      const crying = probes.filter((p) => p.streams.some((q) => q.h > 1));
      expect(crying.length, `${v}: crying`).toBeGreaterThan(probes.length * 0.6);
      crying.slice(4).forEach((p, k) => expectTearsOnFace(p, `${v} frame ${k}`, v === 'N'));
      if (v === 'reduced') {
        // No movement: the drops stand still on the cheeks for the whole cut-in (one per eye).
        const at = crying.slice(4).map((p) => JSON.stringify(p.drops.map((d) => [d.x.toFixed(2), d.y.toFixed(2)])));
        expect(new Set(at).size, `${v}: drops do not move`).toBe(1);
        expect(crying[4]!.drops.length).toBe(2);
        // Same time on screen: the frames the stage was live, like a normal cut-in.
        expect(shots.length * EVERY, `${v}: ticks live`).toBeGreaterThan(90);
      }
      const info = await page.evaluate(() => window.__lotAndRoll!.money()!);
      if (v !== 'reduced' && v !== 'N') expect(info.tier).toBe(v);
      await expectParked(page);
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
