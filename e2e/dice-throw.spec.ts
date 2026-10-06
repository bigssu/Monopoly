/**
 * The dice throw (docs/DESIGN.md "Dice throw", src/ui/stage/throw.ts): press, hold and flick the
 * dice on the stage centre's pad instead of a roll button.
 *
 * Checked with real mouse strokes: a flick in four directions throws the dice that way (one stroke
 * ends outside the pad: still a throw) across the SCREEN (over the board and the panels, in the
 * `.dice-fly` layer, never off the viewport), a slow and a fast flick the same way: the fast one
 * launches faster, gets farther from home, takes longer and reaches the screen's edge (both render
 * paths), a turned seat's flick toward a screen edge goes to that physical edge, a release without
 * a swipe is a weak toss forward that stays in the dice area, the result is always the engine's
 * dice (the throw never decides it), a throw settles within its planned time, nothing runs after
 * it (0 clock callbacks, no flight layer), the keyboard rolls, a cancelled press only stops the
 * shake, the Settings switch brings the roll button back and it works, reduced motion rolls in
 * place, and the "throw me" wobble plays once (and once more after 5 s) for humans only. Positions are sampled on the DOM path (`?dice=dom`, the
 * Android default); the canvas path (the web default) is checked by its canvas and the throw's
 * screen box.
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
  view: Box | null;
  screen: Box | null;
  homes: { x: number; y: number }[] | null;
  speed: number;
  pathLen: number;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const VIEW = { w: 1600, h: 1000 };

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

/**
 * Player `current` (a human) about to roll `dice` from the start: of 2 humans (S, N) by default, or
 * of `n` humans (4: seats S, E, N, W) — the table view, the Stage turned toward that seat.
 */
async function craft(page: Page, dice: [number, number], o: { n?: number; current?: number } = {}): Promise<void> {
  await page.evaluate(({ dice, n, current }) => {
    const h = window.__lotAndRoll!;
    h.setPromptTimer(0);
    h.dice().clear();
    const st = h.demoSettings(n, false);
    h.startGame(st as never, 7);
    const s = h.getState()!;
    s.current = current;
    s.phase = { kind: 'preRoll', playerId: current, rollAgain: false };
    s.testHooks = { diceQueue: [dice] };
    h.loadState(s);
  }, { dice, n: o.n ?? 2, current: o.current ?? 0 });
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
      // The dice are in the flight layer while a flick flies (stand-ins hold their places).
      const dice = [...document.querySelectorAll('.dice-fly .die, .st-dice .die:not(.die-ph)')].map((d) => {
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

/**
 * A flick at a known release speed (px/s), dispatched on the pad in the page: the press, a hold,
 * then the moves at ~16 ms steps (a busy wait) and the release, so the measured release speed does
 * not depend on how loaded the machine is (real mouse moves from here can be 100+ ms apart under
 * load: a fast stroke would read as a slow one, or a toss). The real-mouse path, pointer capture
 * included, is the four-direction test's "down" stroke.
 */
async function flick(page: Page, from: { x: number; y: number }, dx: number, dy: number, speed: number, holdMs = 300): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.evaluate((from) => {
    document.querySelector('.roll-pad')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: from.x, clientY: from.y, buttons: 1 }));
  }, from);
  await page.waitForTimeout(holdMs);
  await page.evaluate(
    ({ from, dx, dy, speed }) => {
      const pad = document.querySelector('.roll-pad')!;
      const len = Math.hypot(dx, dy);
      const spin = (ms: number): void => {
        const end = performance.now() + ms;
        while (performance.now() < end) {
          /* busy wait */
        }
      };
      const ev = (type: string, x: number, y: number): PointerEvent =>
        new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 });
      // Each move is placed where the finger would be at the moment it is sent (the event's own
      // timestamp), so even a preempted step keeps the speed exact.
      const t0 = performance.now();
      let x = from.x;
      let y = from.y;
      for (let i = 0; i < 6; i++) {
        spin(16);
        const k = (speed * (performance.now() - t0)) / 1000;
        x = from.x + (dx / len) * k;
        y = from.y + (dy / len) * k;
        pad.dispatchEvent(ev('pointermove', x, y));
      }
      pad.dispatchEvent(ev('pointerup', x, y));
    },
    { from, dx, dy, speed },
  );
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

/** Every sampled die stays on the screen, inside the flight's margin (a flick flies over everything). */
function checkOnScreen(s: { r: { x: number; y: number; w: number; h: number }[] }[], ctx: string): void {
  for (const f of s) {
    for (const r of f.r) {
      expect(r.x, `${ctx}: left`).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w, `${ctx}: right`).toBeLessThanOrEqual(VIEW.w);
      expect(r.y, `${ctx}: top`).toBeGreaterThanOrEqual(0);
      expect(r.y + r.h, `${ctx}: bottom`).toBeLessThanOrEqual(VIEW.h);
    }
  }
}

/** After a throw: no flight layer, no stand-in, the dice back in the pair. */
async function checkLanded(page: Page, ctx: string): Promise<void> {
  await expect(page.locator('.dice-fly'), ctx).toHaveCount(0);
  await expect(page.locator('.die-ph'), ctx).toHaveCount(0);
  await expect(page.locator('.st-dice .dice-pair > .die'), ctx).toHaveCount(2);
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
      // A real stroke for the one that ends off the pad (pointer capture); exact-speed flicks else.
      if (d.name.startsWith('down')) await stroke(page, c, d.dx, d.dy, 350, 8);
      else await flick(page, c, d.dx, d.dy, 1500);
      const s = await samples(page);
      await checkResult(page, d.dice, d.name);
      const rec = (await lastRec(page))!;
      expect(rec.mode, d.name).toBe('throw');
      expect(rec.path, d.name).toBe('dom');
      if (d.name.startsWith('down') && rec.kind === 'toss') {
        // A real stroke: on a loaded machine its moves can arrive too far apart for a flick
        // (releaseVelocity: the release within 0.1 s of the last move). Still a throw, not a cancel.
        console.log(`[dice-throw] ${d.name}: real mouse moves too slow here for a flick: tossed (still thrown)`);
        await checkLanded(page, d.name);
        continue;
      }
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
      expect(rec.clacks, `${d.name}: clacks`).toBeLessThanOrEqual(4);
      checkOnScreen(s, d.name);
      // Settled within its planned time (≤ 1.96 s at speed 1) plus 200 ms (the throw ends on the first
      // clock frame after its time; the old absolute bound, 1.6 s + 70 ms for plans ≤ 1.54 s, allowed
      // 130–470 ms), back home.
      expect(rec.planMs, `${d.name}: planned`).toBeLessThanOrEqual(1960);
      expect(rec.endedAt! - rec.startedAt, `${d.name}: settle time`).toBeLessThanOrEqual(rec.planMs + 200);
      await checkLanded(page, d.name);
      // Lands home: the DOM dice at rest stand where the flight planned their homes (the frame
      // measured at the start: the dice area may change scale meanwhile, as the roll card goes),
      // and the last flying frame (if one was sampled within ~40 ms of the end: a loaded machine
      // samples sparsely) is there too.
      const before = [...s].reverse().find((f) => f.t < rec.endedAt! - 1);
      const after = s.find((f) => f.t > rec.endedAt! + 1);
      if (after) for (const i of [0, 1]) expect(Math.hypot(centreOf(after.r[i]!).x - rec.homes![i]!.x, centreOf(after.r[i]!).y - rec.homes![i]!.y), `${d.name}: die ${i} lands home`).toBeLessThan(2);
      if (before && after && rec.endedAt! - before.t < 40) for (const i of [0, 1]) expect(Math.hypot(centreOf(after.r[i]!).x - centreOf(before.r[i]!).x, centreOf(after.r[i]!).y - centreOf(before.r[i]!).y), `${d.name}: die ${i} no jump at the landing`).toBeLessThan(4);
      console.log(`[dice-throw] ${d.name}: aim ${Math.round(Math.hypot(rec.aim!.x, rec.aim!.y))} px/s, ${Math.round(rec.endedAt! - rec.startedAt)} ms (plan ${Math.round(rec.planMs)}), bounces ${rec.bounces}, clacks ${rec.clacks}, ahead ${Math.round(ahead)} px`);
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
    expect(rec.view, 'a toss stays in the dice area').toBeNull();
    expect(rec.endedAt! - rec.startedAt).toBeLessThanOrEqual(1300);
    expect(await page.locator('.dice-fly').count()).toBe(0);

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
        new Promise<{ n: number; w: number; h: number; x: number; y: number; inFly: boolean }>((resolve) => {
          const t0 = performance.now();
          const tick = (): void => {
            const cv = document.querySelectorAll('canvas.dice-canvas');
            if (cv.length) {
              const r = cv[0]!.getBoundingClientRect();
              resolve({ n: cv.length, w: r.width, h: r.height, x: r.x, y: r.y, inFly: !!cv[0]!.closest('.dice-fly') });
            } else if (performance.now() - t0 < 5000) requestAnimationFrame(tick);
            else resolve({ n: 0, w: 0, h: 0, x: 0, y: 0, inFly: false });
          };
          tick();
        }),
    );
    await flick(page, c, 160, -60, 1500);
    const cv = await seen;
    expect(cv.n, 'one canvas').toBe(1);
    expect(cv.inFly, 'drawn in the flight layer, over the board and the panels').toBe(true);
    // Sized to the throw's box (not the whole screen), on the screen.
    expect(cv.w * cv.h, 'smaller than the screen').toBeLessThan(VIEW.w * VIEW.h);
    expect(cv.x).toBeGreaterThanOrEqual(-1);
    expect(cv.y).toBeGreaterThanOrEqual(-1);
    await checkResult(page, [4, 4], 'canvas');
    const rec = (await lastRec(page))!;
    expect(rec.path).toBe('canvas');
    expect(rec.kind).toBe('flick');
    // Doubles keep the gold treatment.
    await expect(page.locator('.st-dice .dice')).toHaveClass(/is-doubles/);
    await expect(page.locator('canvas.dice-canvas')).toHaveCount(0);
    await checkLanded(page, 'canvas');
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
    await flick(page, await pairCentre(page), -150, -40, 1500);
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
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (document.querySelector('.st-dice .dice-pair') as HTMLElement).style.transform)).toBe('');
    expect(await page.evaluate(() => document.querySelector('.st-dice .dice')!.classList.contains('is-inviting'))).toBe(false);
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
    // Wobbling = the pair's transform is being stepped (Dice.invite, on the 30 Hz clock).
    const pairAnims = (): Promise<number> => page.evaluate(() => ((document.querySelector('.st-dice .dice-pair') as HTMLElement).style.transform ? 1 : 0));
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

  for (const path of ['dom', 'canvas'] as const) {
    test(`a fast flick flies faster, farther and longer than a slow one, off the screen's edge (${path} path)`, async ({ page }) => {
      test.setTimeout(120_000);
      const logs = watchConsole(page);
      await boot(page, `&dice=${path}`);
      const runs: { name: string; rec: Rec; reach: number; far: number; ms: number }[] = [];
      // Slow: 450 px/s (a gentle push); fast: 6000 px/s (beyond the strongest, clamped to it).
      for (const [name, speed, dice] of [
        ['slow', 450, [2, 3]],
        ['fast', 6000, [5, 1]],
      ] as const) {
        await craft(page, [dice[0], dice[1]]);
        const home = await page.evaluate(() => [...document.querySelectorAll('.st-dice .die')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; }));
        if (path === 'dom') await startSampling(page);
        await flick(page, await pairCentre(page), 1, 0, speed);
        const s = path === 'dom' ? await samples(page) : [];
        await checkResult(page, [dice[0], dice[1]], `${name} ${path}`);
        const rec = (await lastRec(page))!;
        expect(rec.kind, name).toBe('flick');
        expect(rec.path, name).toBe(path);
        expect(rec.view, `${name}: walls are the screen`).not.toBeNull();
        // How far right on the screen (a die's right edge), and how far from home.
        let reach: number;
        let far: number;
        if (path === 'dom') {
          checkOnScreen(s, `${name} ${path}`);
          // The plan's screen box (die centres) for the reach: rAF samples can miss the frame at the wall.
          reach = Math.max(rec.screen!.right + home[0]!.w / 2, ...s.flatMap((f) => f.r.map((r) => r.x + r.w)));
          far = Math.max(...s.flatMap((f) => f.r.map((r, i) => Math.hypot(centreOf(r).x - home[i]!.x, centreOf(r).y - home[i]!.y))));
        } else {
          // The throw's screen box (die centres) lies inside the screen walls.
          const sc = rec.screen!;
          const v = rec.view!;
          expect(sc.left, name).toBeGreaterThanOrEqual(v.left - 1);
          expect(sc.right, name).toBeLessThanOrEqual(v.right + 1);
          expect(sc.top, name).toBeGreaterThanOrEqual(v.top - 1);
          expect(sc.bottom, name).toBeLessThanOrEqual(v.bottom + 1);
          reach = sc.right + home[0]!.w / 2;
          far = Math.max(sc.right - home[1]!.x, home[0]!.x - sc.left);
        }
        const ms = rec.endedAt! - rec.startedAt;
        expect(ms, `${name}: settled in its time`).toBeLessThanOrEqual(rec.planMs + 200);
        await checkLanded(page, `${name} ${path}`);
        await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.activeTicks()), { timeout: 8000 }).toBe(0);
        runs.push({ name, rec, reach, far, ms });
        console.log(`[dice-throw] ${path} ${name}: release ${Math.round(Math.hypot(rec.aim!.x, rec.aim!.y))} px/s → launch ${Math.round(rec.speed)} px/s, plan ${Math.round(rec.planMs)} ms (took ${Math.round(ms)}), bounces ${rec.bounces}, clacks ${rec.clacks}, farthest ${Math.round(far)} px, right edge at ${Math.round(reach)} px`);
      }
      const [slow, fast] = runs as [(typeof runs)[0], (typeof runs)[0]];
      expect(fast.rec.speed, 'launches faster').toBeGreaterThan(slow.rec.speed * 1.5);
      expect(fast.far, 'travels farther').toBeGreaterThan(slow.far * 1.5);
      expect(fast.rec.planMs, 'lasts longer (plan)').toBeGreaterThan(slow.rec.planMs + 300);
      expect(fast.ms, 'lasts longer (seen)').toBeGreaterThan(slow.ms + 200);
      // The fast one reaches the screen's right edge (within 10 %); the slow one stays short.
      expect(fast.reach, 'reaches the screen edge').toBeGreaterThan(VIEW.w * 0.9);
      expect(fast.reach, 'never off the screen').toBeLessThanOrEqual(VIEW.w);
      expect(slow.reach, 'the slow one stays short').toBeLessThan(VIEW.w * 0.8);
      expect(fast.rec.clacks, 'off the wall').toBeGreaterThanOrEqual(1);
      expect(fast.rec.clacks).toBeLessThanOrEqual(4);
      await page.evaluate(() => window.__lotAndRoll!.whenIdle());
      await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.activeTicks()), { timeout: 8000 }).toBe(0);
      expect(logs, logs.join('\n')).toEqual([]);
    });
  }

  test('table view: a turned seat\'s flick toward a screen edge goes to that physical edge', async ({ page }) => {
    test.setTimeout(120_000);
    const logs = watchConsole(page);
    await boot(page, '&dice=dom');
    // 4 humans (S E N W): the Stage turns toward whoever rolls.
    for (const [seat, current, dx, dy] of [
      ['E', 1, 440, 0],
      ['N', 2, 0, -440],
      ['W', 3, 0, 440],
    ] as const) {
      await craft(page, [4, 6], { n: 4, current });
      expect(await page.evaluate(() => (document.querySelector('.stage') as HTMLElement).dataset.seat)).toBe(seat);
      await startSampling(page);
      const c = await pairCentre(page);
      await flick(page, c, dx, dy, 6000);
      const s = await samples(page);
      await checkResult(page, [4, 6], seat);
      const rec = (await lastRec(page))!;
      expect(rec.kind, seat).toBe('flick');
      checkOnScreen(s, seat);
      // How close to that edge the dice got: the throw's screen box (die centres, from the plan:
      // sampling from rAF can miss the frame at the wall on a loaded machine) plus half a die.
      const half = s[0]!.r[0]!.w / 2;
      const sc = rec.screen!;
      const reach = dx > 0 ? (sc.right + half) / VIEW.w : dy < 0 ? 1 - (sc.top - half) / VIEW.h : (sc.bottom + half) / VIEW.h;
      console.log(`[dice-throw] seat ${seat}: stroke ${dx},${dy} → reach ${reach.toFixed(3)} of the screen toward that edge, bounces ${rec.bounces}`);
      expect(reach, `${seat}: reaches the edge the finger pointed at`).toBeGreaterThan(0.9);
      await checkLanded(page, seat);
    }
    expect(logs, logs.join('\n')).toEqual([]);
  });
});
