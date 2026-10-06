/**
 * The dice throw (docs/DESIGN.md "Dice throw", src/ui/stage/throw.ts): press, hold and flick the
 * dice on the stage centre's pad instead of a roll button.
 *
 * Checked with real mouse strokes: a flick in four directions throws the dice that way (one stroke
 * ends outside the pad: still a throw), a release without a swipe is a weak toss forward that
 * still leaves home, the result is always the engine's dice (the throw never decides it), the dice
 * never leave the stage nor overlap the banner / round line, a throw settles within 1.6 s at speed
 * 1, nothing runs after it (0 clock callbacks), the keyboard rolls, a cancelled press only stops
 * the shake, the Settings switch brings the roll button back and it works, reduced motion rolls
 * in place, and the "throw me" wobble plays once (and once more after 5 s) for humans only.
 * Positions are sampled on the DOM path (`?dice=dom`, the Android default); the canvas path (the
 * web default) is checked for its size and clean-up.
 */
import { expect, test, type Page } from '@playwright/test';
import { reduceMotion } from './motion';

interface Rec {
  mode: string;
  path: string | null;
  kind: string | null;
  aim: { x: number; y: number } | null;
  faces: [number, number];
  planMs: number;
  startedAt: number;
  endedAt: number | null;
  bounces: number[];
  clacks: number;
  travel: number;
}

function watchConsole(page: Page): string[] {
  const out: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (/favicon|Failed to load resource/.test(`${m.text()} ${m.location().url ?? ''}`)) return;
    out.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => out.push(`pageerror: ${String(e)}`));
  return out;
}

async function boot(page: Page, query = ''): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/?dev=1${query}`);
  await page.waitForFunction(() => !!window.__lotAndRoll && document.getElementById('app')?.dataset.screen === 'title', null, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}

/** Player 0 (seat S, a human) about to roll `dice` from the start; player 1 a human too. */
async function craft(page: Page, dice: [number, number]): Promise<void> {
  await page.evaluate((dice) => {
    const h = window.__lotAndRoll!;
    h.setPromptTimer(0);
    h.dice().clear();
    const st = h.demoSettings(2, false);
    h.startGame(st as never, 7);
    const s = h.getState()!;
    s.current = 0;
    s.phase = { kind: 'preRoll', playerId: 0, rollAgain: false };
    s.testHooks = { diceQueue: [dice] };
    h.loadState(s);
  }, dice);
  await expect(page.locator('.roll-pad:not(:disabled)')).toBeVisible({ timeout: 30_000 });
  // The prompt has come in and the stage stands still.
  await page.waitForTimeout(500);
}

async function lastRec(page: Page): Promise<Rec | null> {
  return page.evaluate(() => {
    const l = window.__lotAndRoll!.dice().log;
    return l.length ? (JSON.parse(JSON.stringify(l[l.length - 1])) as Rec) : null;
  });
}

/** Client centre of the dice pair. */
async function pairCentre(page: Page): Promise<{ x: number; y: number }> {
  const b = (await page.locator('.st-dice .dice-pair').boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * Start sampling the dice (client rects, every frame) until the roll record has ended; the
 * result is read with `samples()`.
 */
async function startSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __diceSamples: { t: number; r: { x: number; y: number; w: number; h: number }[] }[]; __diceDone: boolean };
    w.__diceSamples = [];
    w.__diceDone = false;
    const t0 = performance.now();
    const tick = (): void => {
      const dice = [...document.querySelectorAll('.st-dice .die')].map((d) => {
        const r = d.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      w.__diceSamples.push({ t: performance.now(), r: dice });
      const l = window.__lotAndRoll!.dice().log;
      const rec = l[l.length - 1];
      // A few frames past the end (to see the landed DOM dice).
      if (rec && rec.endedAt !== null && rec.startedAt > t0 && performance.now() - rec.endedAt > 100) {
        w.__diceDone = true;
        return;
      }
      if (performance.now() - t0 < 10_000) requestAnimationFrame(tick);
      else w.__diceDone = true;
    };
    requestAnimationFrame(tick);
  });
}

async function samples(page: Page): Promise<{ t: number; r: { x: number; y: number; w: number; h: number }[] }[]> {
  await page.waitForFunction(() => (window as unknown as { __diceDone: boolean }).__diceDone, null, { timeout: 15_000 });
  return page.evaluate(() => (window as unknown as { __diceSamples: never }).__diceSamples);
}

/** A real stroke: press at `from`, hold `holdMs`, move by (dx, dy) in `steps` frames, release. */
async function stroke(page: Page, from: { x: number; y: number }, dx: number, dy: number, holdMs = 350, steps = 5): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
    await page.waitForTimeout(14);
  }
  await page.mouse.up();
}

/** After a roll: the engine's dice, the DOM dice showing them, the total badge. */
async function checkResult(page: Page, dice: [number, number], ctx: string): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.getState()!.lastDice), { message: ctx }).toEqual(dice);
  const rec = (await lastRec(page))!;
  expect(rec.faces, ctx).toEqual(dice);
  await expect.poll(() => page.evaluate(() => (window.__lotAndRoll!.dice().log.at(-1)?.endedAt ?? null) !== null), { message: ctx }).toBe(true);
  // The face shown white (not a grey side) on each DOM die is the engine's face.
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll('.st-dice .die')].map((d) => {
      const f = [...d.querySelectorAll<HTMLElement>('.face')].find((x) => x.style.visibility !== 'hidden' && !x.classList.contains('is-side'));
      return f ? Number(/f(\d)/.exec(f.className)![1]) : 0;
    }),
  );
  expect(shown, ctx).toEqual(dice);
}

/** Every sampled die stays on the stage, below the round line (the banner above it). */
async function checkInside(page: Page, s: { r: { x: number; y: number; w: number; h: number }[] }[], ctx: string): Promise<void> {
  const stage = (await page.locator('.stage').boundingBox())!;
  const round = (await page.locator('.st-round').boundingBox())!;
  const banner = (await page.locator('.st-banner').boundingBox())!;
  for (const f of s) {
    for (const r of f.r) {
      expect(r.x, `${ctx}: left`).toBeGreaterThanOrEqual(stage.x - 1);
      expect(r.x + r.w, `${ctx}: right`).toBeLessThanOrEqual(stage.x + stage.width + 1);
      expect(r.y + r.h, `${ctx}: bottom`).toBeLessThanOrEqual(stage.y + stage.height + 1);
      expect(r.y, `${ctx}: under the round line`).toBeGreaterThanOrEqual(round.y + round.height - 1);
      expect(r.y, `${ctx}: under the banner`).toBeGreaterThan(banner.y + banner.height);
    }
  }
}

const centreOf = (r: { x: number; y: number; w: number; h: number }): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

test.describe('dice throw', () => {
  test('a flick in four directions throws the dice that way; the result is the engine\'s', async ({ page }) => {
    test.setTimeout(180_000);
    const logs = watchConsole(page);
    await boot(page, '&dice=dom');
    const DIRS: { name: string; dx: number; dy: number; dice: [number, number] }[] = [
      { name: 'up', dx: 0, dy: -150, dice: [1, 3] },
      { name: 'right', dx: 150, dy: 0, dice: [2, 5] },
      { name: 'left', dx: -150, dy: 0, dice: [6, 4] },
      // Ends far below the pad (off the board): still a throw, not a cancel.
      { name: 'down (ending off the pad)', dx: 0, dy: 400, dice: [3, 4] },
    ];
    for (const d of DIRS) {
      await craft(page, d.dice);
      const home = await page.evaluate(() => [...document.querySelectorAll('.st-dice .die')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
      await startSampling(page);
      const c = await pairCentre(page);
      await stroke(page, c, d.dx, d.dy, 350, d.name.startsWith('down') ? 8 : 5);
      const s = await samples(page);
      await checkResult(page, d.dice, d.name);
      const rec = (await lastRec(page))!;
      expect(rec.mode, d.name).toBe('throw');
      expect(rec.path, d.name).toBe('dom');
      expect(rec.kind, d.name).toBe('flick');
      // Aimed the stroke's way (the stage faces S: its frame is the screen's).
      const len = Math.hypot(rec.aim!.x, rec.aim!.y);
      expect((rec.aim!.x * d.dx + rec.aim!.y * d.dy) / (len * Math.hypot(d.dx, d.dy)), `${d.name}: aim`).toBeGreaterThan(0.9);
      // The dice flew that way first: the farthest point along the stroke is well past home.
      const ux = d.dx / Math.hypot(d.dx, d.dy);
      const uy = d.dy / Math.hypot(d.dx, d.dy);
      const ahead = Math.max(...s.flatMap((f) => f.r.map((r, i) => (centreOf(r).x - home[i]!.x) * ux + (centreOf(r).y - home[i]!.y) * uy)));
      const ds = s[0]!.r[0]!.w;
      expect(ahead, `${d.name}: flew the stroke's way`).toBeGreaterThan(ds);
      expect(rec.bounces.reduce((a, b) => a + b, 0), `${d.name}: wall bounces`).toBeGreaterThanOrEqual(2);
      expect(rec.clacks, `${d.name}: clacks`).toBeLessThanOrEqual(3);
      await checkInside(page, s, d.name);
      // Settled within 1.6 s (plus a frame of slack), back home.
      expect(rec.endedAt! - rec.startedAt, `${d.name}: settle time`).toBeLessThanOrEqual(1600 + 70);
      // Lands home: no jump between the last flying frame and the DOM dice at rest.
      const before = [...s].reverse().find((f) => f.t < rec.endedAt! - 1);
      const after = s.find((f) => f.t > rec.endedAt! + 1);
      if (before && after) for (const i of [0, 1]) expect(Math.hypot(centreOf(after.r[i]!).x - centreOf(before.r[i]!).x, centreOf(after.r[i]!).y - centreOf(before.r[i]!).y), `${d.name}: die ${i} lands home`).toBeLessThan(4);
      console.log(`[dice-throw] ${d.name}: ${Math.round(rec.endedAt! - rec.startedAt)} ms (plan ${Math.round(rec.planMs)}), bounces ${rec.bounces}, clacks ${rec.clacks}, ahead ${Math.round(ahead)} px`);
    }
    // After the last throw the game goes on to the next decision and then rests: nothing runs.
    await page.evaluate(() => window.__lotAndRoll!.whenIdle());
    await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.activeTicks()), { timeout: 8000 }).toBe(0);
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('a release without a swipe tosses the dice forward; the keyboard rolls; a cancel only stops the shake', async ({ page }) => {
    test.setTimeout(120_000);
    const logs = watchConsole(page);
    await boot(page, '&dice=dom');
    await craft(page, [2, 6]);
    const home = await page.evaluate(() => [...document.querySelectorAll('.st-dice .die')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
    await startSampling(page);
    await stroke(page, await pairCentre(page), 0, 0, 300, 0);
    const s = await samples(page);
    await checkResult(page, [2, 6], 'tap');
    const rec = (await lastRec(page))!;
    expect(rec.kind).toBe('toss');
    // Moved from home before settling, forward (up the screen for seat S), a short way.
    const up = Math.max(...s.flatMap((f) => f.r.map((r, i) => home[i]!.y - centreOf(r).y)));
    const ds = s[0]!.r[0]!.w;
    expect(up, 'tossed forward').toBeGreaterThan(ds * 0.4);
    expect(rec.bounces.every((b) => b <= 1), 'at most one soft wall touch').toBe(true);
    await checkInside(page, s, 'tap');
    expect(rec.endedAt! - rec.startedAt).toBeLessThanOrEqual(1300);

    // Keyboard: the pad is focused when the roll comes up; Enter rolls (a toss).
    await craft(page, [1, 2]);
    await expect(page.locator('.roll-pad')).toBeFocused();
    await page.keyboard.press('Enter');
    await checkResult(page, [1, 2], 'keyboard');
    expect((await lastRec(page))!.kind).toBe('toss');

    // A cancelled press (the system took the pointer): the shake stops, nothing is rolled.
    await craft(page, [3, 5]);
    const c = await pairCentre(page);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await expect(page.locator('.st-dice .dice')).toHaveClass(/is-shaking/);
    await page.evaluate(() => document.querySelector('.roll-pad')!.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })));
    await expect(page.locator('.st-dice .dice')).not.toHaveClass(/is-shaking/);
    await page.mouse.up();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.__lotAndRoll!.getState()!.phase.kind)).toBe('preRoll');
    expect(await page.evaluate(() => window.__lotAndRoll!.dice().log.length)).toBe(0);
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('canvas path (web default): one canvas over the throw\'s box, gone after', async ({ page }) => {
    test.setTimeout(90_000);
    const logs = watchConsole(page);
    await boot(page);
    await craft(page, [4, 4]);
    const c = await pairCentre(page);
    const seen = page.evaluate(
      () =>
        new Promise<{ n: number; w: number; h: number; x: number; y: number }>((resolve) => {
          const t0 = performance.now();
          const tick = (): void => {
            const cv = document.querySelectorAll('canvas.dice-canvas');
            if (cv.length) {
              const r = cv[0]!.getBoundingClientRect();
              resolve({ n: cv.length, w: r.width, h: r.height, x: r.x, y: r.y });
            } else if (performance.now() - t0 < 5000) requestAnimationFrame(tick);
            else resolve({ n: 0, w: 0, h: 0, x: 0, y: 0 });
          };
          tick();
        }),
    );
    await stroke(page, c, 160, -60);
    const cv = await seen;
    expect(cv.n, 'one canvas').toBe(1);
    const stage = (await page.locator('.stage').boundingBox())!;
    expect(cv.w * cv.h, 'smaller than the stage').toBeLessThan(stage.width * stage.height);
    await checkResult(page, [4, 4], 'canvas');
    const rec = (await lastRec(page))!;
    expect(rec.path).toBe('canvas');
    expect(rec.kind).toBe('flick');
    // Doubles keep the gold treatment.
    await expect(page.locator('.st-dice .dice')).toHaveClass(/is-doubles/);
    await expect(page.locator('canvas.dice-canvas')).toHaveCount(0);
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('Settings "show roll button" brings the button back, and it rolls', async ({ page }) => {
    test.setTimeout(90_000);
    const logs = watchConsole(page);
    await boot(page);
    await craft(page, [1, 3]);
    await expect(page.locator('.roll-btn')).toHaveCount(0);
    await expect(page.locator('.pc-roll .roll-hint.is-strip')).toHaveText('주사위를 꾹 누르고 밀어 던지세요');
    await page.evaluate(() => (window as unknown as { __lotAndRollShell: { prefs: { set(p: object): void } } }).__lotAndRollShell.prefs.set({ rollButton: true }));
    await craft(page, [2, 3]);
    const btn = page.locator('.st-prompt .roll-btn:not(:disabled)');
    await expect(btn).toBeVisible();
    await expect(page.locator('.pc-roll .roll-hint')).toHaveText('꾹 누르면 주사위를 흔들어요');
    await btn.click();
    await checkResult(page, [2, 3], 'button');
    // The pad still works beside it.
    await craft(page, [5, 6]);
    await stroke(page, await pairCentre(page), -150, -40);
    await checkResult(page, [5, 6], 'pad beside the button');
    expect((await lastRec(page))!.kind).toBe('flick');
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('reduced motion: the dice roll in place (no trajectory)', async ({ page }) => {
    test.setTimeout(90_000);
    const logs = watchConsole(page);
    await reduceMotion(page);
    await boot(page, '&dice=dom');
    await craft(page, [6, 2]);
    // No wobble without motion.
    expect(await page.evaluate(() => document.querySelector('.st-dice .dice-pair')!.getAnimations().length)).toBe(0);
    await stroke(page, await pairCentre(page), 0, -160);
    await checkResult(page, [6, 2], 'reduced');
    const rec = (await lastRec(page))!;
    expect(rec.mode).toBe('inplace');
    expect(rec.kind).toBeNull();
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('"throw me": the dice wobble for a human\'s roll, once more after 5 s, then rest; not for a CPU', async ({ page }) => {
    test.setTimeout(90_000);
    const logs = watchConsole(page);
    await boot(page);
    await craft(page, [1, 3]);
    const pairAnims = (): Promise<number> => page.evaluate(() => document.querySelector('.st-dice .dice-pair')!.getAnimations().filter((a) => a.playState === 'running').length);
    // Started with the prompt (the craft wait was 0.5 s of its ~1.2 s).
    expect(await pairAnims(), 'wobbling').toBe(1);
    await expect.poll(pairAnims, { timeout: 3000 }).toBe(0);
    await expect.poll(pairAnims, { timeout: 6000, intervals: [100] }).toBe(1);
    await expect.poll(pairAnims, { timeout: 3000 }).toBe(0);
    // Then nothing: no clock callback, no running animation on the dice.
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.__lotAndRoll!.activeTicks())).toBe(0);
    expect(await pairAnims()).toBe(0);
    // A CPU's roll: no invitation.
    await page.evaluate(() => {
      const h = window.__lotAndRoll!;
      const s = h.getState()!;
      s.players[0]!.isCpu = true;
      s.current = 0;
      s.phase = { kind: 'preRoll', playerId: 0, rollAgain: false };
      h.cpuHand().freeze(true);
      h.loadState(s);
    });
    await expect(page.locator('.roll-pad')).toBeAttached({ timeout: 20_000 });
    await expect(page.locator('.roll-pad')).toBeDisabled();
    expect(await page.evaluate(() => document.querySelector('.st-dice .dice')!.classList.contains('is-inviting'))).toBe(false);
    await page.evaluate(() => window.__lotAndRoll!.cpuHand().freeze(false));
    expect(logs, logs.join('\n')).toEqual([]);
  });
});
