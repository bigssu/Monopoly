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
 * place, and the "throw me" wobble plays (with a rattle each lean, the hint blinking) once and
 * once more after 5 s, for humans only. Positions are sampled on the DOM path (`?dice=dom`, the
 * Android default); the canvas path (the web default) is checked by its canvas and the throw's
 * screen box.
 */
import { expect, test, type Page } from '@playwright/test';
import { PREFS_KEY, boot, checkPress, setPrefs, watchConsole } from './helpers';
import { reduceMotion } from './motion';

interface Rec {
  mode: string;
  path: string | null;
  kind: string | null;
  aim: { x: number; y: number; strength: number } | null;
  faces: number[];
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

/**
 * Player `current` about to roll `dice` from the start: of 2 humans (S, N) by default, or of `n`
 * humans (4: seats S, E, N, W) — the table view, the Stage turned toward that seat. `rules:
 * 'advanced'` is strategy mode (the skill throw); `cpu` hands that seat to a normal CPU.
 */
async function craft(
  page: Page,
  dice: [number, number],
  o: { n?: number; current?: number; rules?: 'advanced'; cpu?: boolean; seed?: number } = {},
): Promise<void> {
  await page.evaluate(({ dice, n, current, rules, cpu, seed }) => {
    const h = window.__lotAndRoll!;
    h.setPromptTimer(0);
    h.dice().clear();
    h.skill().clear();
    const st = h.demoSettings(n, false) as { rules: string; players: { isCpu: boolean; cpuLevel?: string }[] };
    if (rules) st.rules = rules;
    if (cpu) {
      st.players[current]!.isCpu = true;
      st.players[current]!.cpuLevel = 'normal';
    }
    h.startGame(st as never, seed);
    const s = h.getState()!;
    s.current = current;
    s.phase = { kind: 'preRoll', playerId: current, rollAgain: false };
    s.testHooks = { diceQueue: [dice] };
    h.loadState(s);
  }, { dice, n: o.n ?? 2, current: o.current ?? 0, rules: o.rules ?? null, cpu: !!o.cpu, seed: o.seed ?? 7 });
  if (!o.cpu) await expect(page.locator('.roll-pad:not(:disabled)')).toBeVisible({ timeout: 30_000 });
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
    const logs = watchConsole(page, { warnings: true, ignore: /favicon|Failed to load resource/ });
    await boot(page, { ...VIEW, query: '&dice=dom' });
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
    const logs = watchConsole(page, { warnings: true, ignore: /favicon|Failed to load resource/ });
    await boot(page, { ...VIEW, query: '&dice=dom' });
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
    const logs = watchConsole(page, { warnings: true, ignore: /favicon|Failed to load resource/ });
    await boot(page, { ...VIEW });
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
    const logs = watchConsole(page, { warnings: true, ignore: /favicon|Failed to load resource/ });
    await boot(page, { ...VIEW });
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
    const logs = watchConsole(page, { warnings: true, ignore: /favicon|Failed to load resource/ });
    await reduceMotion(page);
    await boot(page, { ...VIEW, query: '&dice=dom' });
    await craft(page, [6, 2]);
    // No wobble without motion.
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (document.querySelector('.st-dice .dice-pair') as HTMLElement).style.transform)).toBe('');
    expect(await page.evaluate(() => document.querySelector('.st-dice .dice')!.classList.contains('is-inviting'))).toBe(false);
    // The "throw me" rattles still play (sound is not motion); the hint does not blink.
    await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.dice().rattles.length)).toBe(3);
    expect(await page.evaluate(() => document.querySelector('.pc-roll .roll-hint')!.getAnimations().length)).toBe(0);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.pc-roll .roll-hint')!).opacity)).toBe('1');
    await stroke(page, await pairCentre(page), 0, -160);
    await checkResult(page, [6, 2], 'reduced');
    const rec = (await lastRec(page))!;
    expect(rec.mode).toBe('inplace');
    expect(rec.kind).toBeNull();
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('"throw me": the dice wobble for a human\'s roll, once more after 5 s, then rest; not for a CPU', async ({ page }) => {
    test.setTimeout(90_000);
    const logs = watchConsole(page, { warnings: true, ignore: /favicon|Failed to load resource/ });
    await boot(page, { ...VIEW });
    // Recorded in the page every frame (a loaded machine may answer a round trip from here only
    // after the ~1.2 s wobble has ended): wobbling = the pair's transform is being stepped
    // (Dice.invite, on the 30 Hz clock); blinking = a running Web Animation on the hint strip;
    // the rattles = the dev log of each "throw me" dice-shake.
    type Frame = { t: number; wob: boolean; blink: number; rattles: number };
    const recorded = page.evaluate(
      () =>
        new Promise<Frame[]>((resolve) => {
          const out: Frame[] = [];
          const t0 = performance.now();
          let fourAt = -1;
          const tick = (): void => {
            const now = performance.now() - t0;
            const pair = document.querySelector('.st-dice .dice-pair') as HTMLElement | null;
            const hint = document.querySelector('.pc-roll .roll-hint');
            const rattles = window.__lotAndRoll!.dice().rattles.length;
            out.push({ t: now, wob: !!pair?.style.transform, blink: hint ? hint.getAnimations().filter((x) => x.playState === 'running').length : 0, rattles });
            if (rattles >= 4 && fourAt < 0) fourAt = now;
            if ((fourAt >= 0 && now - fourAt > 2000) || now > 20_000) resolve(out);
            else requestAnimationFrame(tick);
          };
          tick();
        }),
    );
    await craft(page, [1, 3]);
    const frames = await recorded;
    // Two wobbles: the first with the prompt, the second about 5 s later; then rest.
    const runs: { from: number; to: number; blink: boolean }[] = [];
    for (const f of frames) {
      const last = runs[runs.length - 1];
      if (f.wob && (!last || f.t - last.to > 300)) runs.push({ from: f.t, to: f.t, blink: f.blink > 0 });
      else if (f.wob) {
        last!.to = f.t;
        last!.blink ||= f.blink > 0;
      }
    }
    // (A wobble from the game start's own roll prompt, replaced at once by the crafted one, is not counted.)
    while (runs.length > 2 && runs[1]!.from - runs[0]!.from < 1500) runs.shift();
    console.log(`[dice-throw] throw me: wobbles ${runs.map((r) => `${Math.round(r.from)}-${Math.round(r.to)} ms`).join(', ')}`);
    expect(runs.length, 'two wobbles').toBe(2);
    // (5 s after the invitation; the first frames of a wobble can come late on a loaded machine.)
    expect(runs[1]!.from - runs[0]!.from, 'the second one about 5 s after the first').toBeGreaterThan(3500);
    expect(runs[1]!.from - runs[0]!.from, 'the second one about 5 s after the first').toBeLessThan(6500);
    expect(runs[0]!.blink && runs[1]!.blink, 'the hint blinks with each wobble').toBe(true);
    // A rattle per lean: three with the first wobble, one with the second.
    expect(Math.max(...frames.filter((f) => f.t <= runs[0]!.to + 200).map((f) => f.rattles)), 'three rattles').toBe(3);
    expect(Math.min(...frames.filter((f) => f.t >= runs[1]!.from).map((f) => f.rattles)), 'one more').toBe(4);
    // Between and after: no blink, no wobble (the blink ~1.2 s, then the hint rests).
    const quiet = (a: number, b: number): Frame[] => frames.filter((f) => f.t > a && f.t < b);
    expect(quiet(runs[0]!.from + 1600, runs[1]!.from - 100).every((f) => !f.wob && f.blink === 0), 'rests between').toBe(true);
    expect(quiet(runs[1]!.from + 1600, Infinity).every((f) => !f.wob && f.blink === 0), 'rests after').toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.pc-roll .roll-hint')!).opacity), 'resting fully visible').toBe('1');
    // Then nothing: no clock callback.
    await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.activeTicks()), { timeout: 3000 }).toBe(0);

    // A press stops it all at once, mid-wobble: pressed from inside the page the moment the wobble
    // is seen (a round trip from here can miss the 1.2 s window on a loaded machine).
    const c = await pairCentre(page);
    await page.mouse.move(c.x, c.y);
    const pressed = page.evaluate(
      (c) =>
        new Promise<{ mid: { wob: boolean; blink: number; rattles: number }; held: { wob: boolean; blink: number; rattles: number } }>((resolve) => {
          const state = (): { wob: boolean; blink: number; rattles: number } => ({
            wob: !!(document.querySelector('.st-dice .dice-pair') as HTMLElement | null)?.style.transform,
            blink: document.querySelector('.pc-roll .roll-hint')?.getAnimations().length ?? 0,
            rattles: window.__lotAndRoll!.dice().rattles.length,
          });
          const ev = (type: string): PointerEvent =>
            new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: c.x, clientY: c.y, buttons: type === 'pointerup' ? 0 : 1 });
          const wait = (): void => {
            const mid = state();
            const pad = document.querySelector('.roll-pad:not(:disabled)');
            if (!pad || !mid.wob || !mid.blink) {
              requestAnimationFrame(wait);
              return;
            }
            pad.dispatchEvent(ev('pointerdown'));
            // Held for ~0.9 s: nothing wobbles, blinks or rattles any more.
            const t0 = performance.now();
            const hold = (): void => {
              if (performance.now() - t0 < 900) {
                requestAnimationFrame(hold);
                return;
              }
              const held = state();
              pad.dispatchEvent(ev('pointerup'));
              resolve({ mid, held });
            };
            requestAnimationFrame(hold);
          };
          wait();
        }),
      c,
    );
    await craft(page, [2, 2]);
    const { mid, held } = await pressed;
    expect(mid.wob && mid.blink > 0 && mid.rattles >= 1, `mid-wobble ${JSON.stringify(mid)}`).toBe(true);
    expect(held, 'pressed: no wobble, no blink, no more rattles').toEqual({ wob: false, blink: 0, rattles: mid.rattles });
    await checkResult(page, [2, 2], 'pressed during the wobble');
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
      const logs = watchConsole(page, { warnings: true, ignore: /favicon|Failed to load resource/ });
      await boot(page, { ...VIEW, query: `&dice=${path}` });
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
    const logs = watchConsole(page, { warnings: true, ignore: /favicon|Failed to load resource/ });
    await boot(page, { ...VIEW, query: '&dice=dom' });
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

// ---------------------------------------------------------------------------------------------
// Strategy mode (advanced rules, version 3): the skill throw (docs/DESIGN.md "Skill throw",
// src/ui/stage/SkillPad.ts). Timing on the hand-driven clock (`manualClock` / `stepFrames`), so the
// ring's phase at the drag is exact.
// ---------------------------------------------------------------------------------------------

/** The ring's accuracy and phase right now. */
async function ring(page: Page): Promise<{ acc: number; phase: number; text: string }> {
  return page.evaluate(() => {
    const r = document.querySelector<SVGElement>('.skill-ring')!;
    return { acc: Number(r.dataset.acc ?? 0), phase: Number(r.dataset.phase ?? 0), text: document.querySelector('.skill-acc')?.textContent ?? '' };
  });
}

/**
 * Press the dice on the manual clock, step until the ring's accuracy is at least `minAcc` (or `frames`
 * frames), drag by (dx, dy) screen px, step a frame (the arrow draws), read the arrow's label, release.
 */
async function skillThrow(page: Page, dx: number, dy: number, o: { minAcc?: number; frames?: number } = {}): Promise<{ acc: number; label: string | null; readout: string }> {
  const c = await pairCentre(page);
  await page.evaluate(() => window.__lotAndRoll!.manualClock(true));
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  let r = await ring(page);
  for (let k = 0; k < (o.frames ?? 90); k++) {
    if (o.minAcc !== undefined && r.acc >= o.minAcc) break;
    await page.evaluate(() => window.__lotAndRoll!.stepFrames(1));
    r = await ring(page);
  }
  if (dx || dy) {
    // No clock frame between the moves: the accuracy locks at the frame read above.
    await page.mouse.move(c.x + dx / 3, c.y + dy / 3);
    await page.mouse.move(c.x + dx, c.y + dy);
    await page.evaluate(() => window.__lotAndRoll!.stepFrames(1));
  }
  const label = await page.evaluate(() => document.querySelector('.skill-aim-label')?.textContent ?? null);
  const readout = (await ring(page)).text;
  await page.mouse.up();
  await page.evaluate(() => window.__lotAndRoll!.manualClock(false));
  return { acc: r.acc, label, readout };
}

interface SkillRoll {
  zone: string;
  aim?: string;
  accuracy: number;
  stride: number;
  throwAim: { x: number; y: number; strength: number } | null;
}

async function lastSkill(page: Page): Promise<SkillRoll> {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__lotAndRoll!.skill().rolls.at(-1))) as SkillRoll);
}

test.describe('skill throw (strategy mode)', () => {
  test('casual mode keeps the plain throw: no chips, no ring, no aim labels, no result line, no guide', async ({ page }) => {
    test.setTimeout(90_000);
    const logs = watchConsole(page, { warnings: true, ignore: /favicon|Failed to load resource/ });
    await setPrefs(page, { skillGuideSeen: false });
    await boot(page, { ...VIEW, query: '&dice=dom' });
    // demoSettings: rules 'normal' (casual).
    await craft(page, [2, 3]);
    await expect(page.locator('.stride-chips, .skill-ring, .skill-guide')).toHaveCount(0);
    await flick(page, await pairCentre(page), 0, -150, 1500);
    await checkResult(page, [2, 3], 'casual');
    expect((await lastRec(page))!.kind).toBe('flick');
    await expect(page.locator('.skill-aim-layer, .roll-result')).toHaveCount(0);
    expect(await page.evaluate(() => window.__lotAndRoll!.skill().rolls.length)).toBe(0);
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('press until the needle is on green, drag short: aim low at ≥ 90 %; the arrow, the readout and the result line', async ({ page }) => {
    test.setTimeout(120_000);
    const logs = watchConsole(page, { warnings: true, ignore: /favicon|Failed to load resource/ });
    await setPrefs(page, { skillGuideSeen: true });
    await boot(page, { ...VIEW, query: '&dice=dom' });
    await craft(page, [1, 3], { rules: 'advanced' });
    // At rest: the chips (two dice chosen), the static ring; no needle, no readout.
    await expect(page.locator('.stride-chip[data-stride="2"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.stride-chip[data-stride="1"]')).toHaveText(/하나\s*1–6/);
    await expect(page.locator('.skill-ring')).toBeVisible();
    await expect(page.locator('.skill-acc')).toBeHidden();
    await expect(page.locator('.roll-gauge')).toHaveCount(0);
    const ds = (await page.locator('.st-dice .die').first().boundingBox())!.height;
    const r = await skillThrow(page, 8, -ds * 0.95, { minAcc: 0.9 });
    expect(r.acc, 'pressed until the needle sat in the band').toBeGreaterThanOrEqual(0.9);
    expect(r.label).toBe('작게 2–5');
    expect(r.readout).toBe(`정확 ${Math.round(r.acc * 100)}%`);
    const s = await lastSkill(page);
    expect(s.zone).toBe('low');
    expect(s.aim).toBe('low');
    expect(s.stride).toBe(2);
    expect(s.accuracy).toBeGreaterThanOrEqual(0.9);
    expect(s.accuracy).toBeCloseTo(r.acc, 2);
    await checkResult(page, [1, 3], 'aimed low');
    // The throw went the arrow's way (up), softly.
    const rec = (await lastRec(page))!;
    expect(rec.kind).toBe('flick');
    expect(rec.aim!.y).toBeLessThan(0);
    expect(rec.aim!.strength).toBeLessThan(0.36);
    // The result line, from the DiceRolled fields: 4 is in 2–5.
    const line = page.locator('.st-dice .roll-result');
    await expect(line).toHaveAttribute('aria-label', /^정확 9\d% · 작게 노림 → 성공 \(4\)$|^정확 100% · 작게 노림 → 성공 \(4\)$/, { timeout: 8000 });
    await expect(line).toHaveCount(0, { timeout: 8000 });
    await expect(page.locator('.skill-aim-layer')).toHaveCount(0);
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('a long drag aims high (a strong throw); a tap rolls 보통 (no aim, no result line); the keyboard too', async ({ page }) => {
    test.setTimeout(150_000);
    const logs = watchConsole(page, { warnings: true, ignore: /favicon|Failed to load resource/ });
    await setPrefs(page, { skillGuideSeen: true });
    await boot(page, { ...VIEW, query: '&dice=dom' });
    await craft(page, [3, 3], { rules: 'advanced' });
    const ds = (await page.locator('.st-dice .die').first().boundingBox())!.height;
    // Outside the band: 6 frames in (phase ~0.14), accuracy 0.
    const r = await skillThrow(page, 20, -ds * 3.3, { frames: 6 });
    expect(r.label).toBe('크게 9–12');
    expect(r.readout).toBe('정확 0%');
    const s = await lastSkill(page);
    expect(s.aim).toBe('high');
    expect(s.accuracy).toBe(0);
    await checkResult(page, [3, 3], 'aimed high');
    const rec = (await lastRec(page))!;
    expect(rec.kind).toBe('flick');
    expect(rec.aim!.strength).toBeGreaterThan(0.72);
    await expect(page.locator('.st-dice .roll-result')).toHaveAttribute('aria-label', '정확 0% · 크게 노림 → 빗나감 (6)', { timeout: 8000 });

    // A middle drag: 보통 (no aim), thrown at a medium strength.
    await craft(page, [2, 5], { rules: 'advanced' });
    const m = await skillThrow(page, 0, -ds * 2.1, { frames: 3 });
    expect(m.label).toBe('보통');
    expect((await lastSkill(page)).aim).toBeUndefined();
    await checkResult(page, [2, 5], 'middle');

    // A tap: 보통, a weak toss.
    await craft(page, [4, 1], { rules: 'advanced' });
    await skillThrow(page, 0, 0, { frames: 4 });
    const tap = await lastSkill(page);
    expect(tap.zone).toBe('tap');
    expect(tap.aim).toBeUndefined();
    expect(tap.throwAim).toBeNull();
    await checkResult(page, [4, 1], 'tap');
    expect((await lastRec(page))!.kind).toBe('toss');
    await page.waitForTimeout(600);
    await expect(page.locator('.roll-result')).toHaveCount(0);

    // The keyboard: 보통 with the chosen stride (a toss).
    await craft(page, [6, 2], { rules: 'advanced' });
    await expect(page.locator('.roll-pad')).toBeFocused();
    await page.keyboard.press('Enter');
    await checkResult(page, [6, 2], 'keyboard');
    expect((await lastRec(page))!.kind).toBe('toss');
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('one die: the chip shows one die and lights 1–6 ahead; the throw renders one die and lands on the engine\'s face', async ({ page }) => {
    test.setTimeout(120_000);
    const logs = watchConsole(page, { warnings: true, ignore: /favicon|Failed to load resource/ });
    await setPrefs(page, { skillGuideSeen: true });
    await boot(page, { ...VIEW, query: '&dice=dom' });
    await craft(page, [5, 2], { rules: 'advanced' });
    const two = (await page.locator('.st-dice .dice-pair').boundingBox())!;
    await page.locator('.stride-chip[data-stride="1"]').click();
    await expect(page.locator('.stride-chip[data-stride="1"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.st-dice .dice')).toHaveClass(/is-single/);
    await expect(page.locator('.st-dice .dice-pair > .die:visible')).toHaveCount(1);
    // The six reachable spaces light up for a moment, then go.
    await expect(page.locator('.bm-hl')).toHaveCount(6);
    await expect(page.locator('.bm-pick')).toHaveCount(6);
    await expect(page.locator('.bm-hl')).toHaveCount(0, { timeout: 6000 });
    await expect(page.locator('.bm-pick')).toHaveCount(0);
    await expect(page.locator('.bm-dim')).toHaveCount(0, { timeout: 2000 });
    // The single die stands where the pair's centre was.
    const one = (await page.locator('.st-dice .dice-pair').boundingBox())!;
    expect(Math.abs(one.x + one.width / 2 - (two.x + two.width / 2))).toBeLessThan(2);
    const ds = one.height;
    await startSampling(page);
    const r = await skillThrow(page, ds * 2.2, -ds * 2.2, { frames: 20 });
    expect(r.label).toBe('크게 5–6');
    const s = await lastSkill(page);
    expect(s.stride).toBe(1);
    expect(s.aim).toBe('high');
    const smp = await samples(page);
    // One die flew (the second, hidden, has no box).
    expect(smp.every((f) => f.r.filter((r) => r.w > 0).length === 1)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.getState()!.lastDice)).toEqual([5, 0]);
    const rec = (await lastRec(page))!;
    expect(rec.faces).toEqual([5]);
    expect(rec.kind).toBe('flick');
    await expect.poll(() => page.evaluate(() => (window.__lotAndRoll!.dice().log.at(-1)?.endedAt ?? null) !== null)).toBe(true);
    const shown = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.st-dice .dice-pair > .die')].filter((d) => d.offsetParent !== null).map((d) => {
        const f = [...d.querySelectorAll<HTMLElement>('.face')].find((x) => x.style.visibility !== 'hidden' && !x.classList.contains('is-side'));
        return f ? Number(/f(\d)/.exec(f.className)![1]) : 0;
      }),
    );
    expect(shown).toEqual([5]);
    await expect(page.locator('.dice-fly')).toHaveCount(0);
    await expect(page.locator('.die-ph')).toHaveCount(0);
    await expect(page.locator('.st-dice .roll-result')).toHaveAttribute('aria-label', /크게 노림 → 성공 \(5\)$/, { timeout: 8000 });
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('the guide shows the first time a human rolls in strategy mode, once; Settings opens it again', async ({ page }) => {
    test.setTimeout(90_000);
    const logs = watchConsole(page, { warnings: true, ignore: /favicon|Failed to load resource/ });
    await boot(page, { ...VIEW, query: '&dice=dom' });
    await craft(page, [1, 2], { rules: 'advanced' });
    const guide = page.locator('.st-pop .skill-guide');
    await expect(guide).toBeVisible();
    await expect(guide.locator('.sg-step')).toHaveCount(3);
    await expect(guide.locator('.sg-title')).toHaveText(['누르기', '초록에서 끌기', '길이로 노리기']);
    await guide.locator('.sg-ok').click();
    await expect(guide).toHaveCount(0);
    expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').skillGuideSeen, PREFS_KEY)).toBe(true);
    // The pad works after it.
    await skillThrow(page, 0, 0, { frames: 2 });
    await checkResult(page, [1, 2], 'after the guide');
    // The next strategy roll: no guide.
    await craft(page, [2, 2], { rules: 'advanced' });
    await page.waitForTimeout(300);
    await expect(page.locator('.skill-guide')).toHaveCount(0);
    // Settings → 손맛 던지기 안내 → 다시 보기.
    await page.goto('/?dev=1');
    await page.waitForFunction(() => document.getElementById('app')?.dataset.screen === 'title');
    await page.locator('[data-action="settings"]').click();
    await page.locator('[data-action="skill-guide"]').click();
    await expect(page.locator('.skill-guide-dlg .skill-guide')).toBeVisible();
    await page.locator('.skill-guide-dlg .sg-ok').click();
    await expect(page.locator('.skill-guide-dlg')).toHaveCount(0);
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('reduced motion: no ring while held, the accuracy counts as text on the same timing; the arrow still shows', async ({ page }) => {
    test.setTimeout(90_000);
    const logs = watchConsole(page, { warnings: true, ignore: /favicon|Failed to load resource/ });
    await reduceMotion(page);
    await setPrefs(page, { skillGuideSeen: true });
    await boot(page, { ...VIEW, query: '&dice=dom' });
    await craft(page, [3, 4], { rules: 'advanced' });
    const c = await pairCentre(page);
    await page.evaluate(() => window.__lotAndRoll!.manualClock(true));
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    const texts: string[] = [];
    for (let k = 0; k < 24; k++) {
      await page.evaluate(() => window.__lotAndRoll!.stepFrames(1));
      texts.push(await page.locator('.skill-acc').textContent() ?? '');
    }
    // The ring is hidden; the readout is shown and counts up to 100 % at the band's centre (21 frames ≈ 0.5 lap).
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.skill-ring .sr-needle')!).visibility)).toBe('hidden');
    await expect(page.locator('.skill-acc.is-rm')).toBeVisible();
    expect(new Set(texts).size).toBeGreaterThan(3);
    expect(texts).toContain('정확 100%');
    const ds = (await page.locator('.st-dice .die').first().boundingBox())!.height;
    await page.mouse.move(c.x, c.y - ds * 0.9);
    await page.evaluate(() => window.__lotAndRoll!.stepFrames(1));
    await expect(page.locator('.skill-aim-label')).toHaveText('작게 2–5');
    await page.mouse.up();
    await page.evaluate(() => window.__lotAndRoll!.manualClock(false));
    await checkResult(page, [3, 4], 'reduced');
    expect((await lastRec(page))!.mode).toBe('inplace');
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('a CPU acts out its AI roll: presses, the ring stops at its accuracy, it drags into its zone, releases', async ({ page }) => {
    test.setTimeout(150_000);
    const logs = watchConsole(page, { warnings: true, ignore: /favicon|Failed to load resource/ });
    await setPrefs(page, { skillGuideSeen: true });
    await boot(page, { ...VIEW, query: '&dice=dom' });
    // Watch, in the page, what the arrow and the readout showed while the CPU dragged.
    await page.evaluate(() => {
      const w = window as unknown as { __seen: { label: string; readout: string }[] };
      w.__seen = [];
      new MutationObserver(() => {
        const label = document.querySelector('.skill-aim-label')?.textContent;
        if (label) w.__seen.push({ label, readout: document.querySelector('.skill-acc')?.textContent ?? '' });
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    for (const seed of [0, 1, 2]) {
      await page.evaluate(() => window.__lotAndRoll!.cpuHand().clear());
      await page.evaluate(() => ((window as unknown as { __seen: unknown[] }).__seen.length = 0));
      // Seats S and N (the Stage turned 180° for N), different seeds: different AI choices.
      await craft(page, [seed + 1, seed + 3], { rules: 'advanced', cpu: true, current: seed % 2, seed: 100 + seed * 17 });
      await page.waitForFunction(() => window.__lotAndRoll!.skill().rolls.length > 0, null, { timeout: 30_000 });
      const press = (await page.evaluate(() => JSON.parse(JSON.stringify(window.__lotAndRoll!.cpuHand().log.find((r) => r.action === 'Roll')))))!;
      checkPress(press, 'cpu skill roll');
      const act = JSON.parse(press.act) as { stride: number; aim?: string; accuracy: number };
      expect(typeof act.accuracy).toBe('number');
      const s = await lastSkill(page);
      // The pad's release is the AI's choice: its zone, its accuracy, its stride.
      expect(s.aim).toBe(act.aim);
      expect(s.accuracy).toBeCloseTo(act.accuracy, 2);
      expect(s.stride).toBe(act.stride);
      // What showed while the hand still held the dice (the arrow fades a moment after the release).
      const seen = (await page.evaluate(() => (window as unknown as { __seen: { label: string; readout: string }[] }).__seen)).filter((x) => x.readout);
      const want = act.aim === 'low' ? '작게' : act.aim === 'high' ? '크게' : '보통';
      expect(seen.at(-1)!.label.startsWith(want), JSON.stringify(seen.at(-1))).toBe(true);
      expect(seen.at(-1)!.readout).toBe(`정확 ${Math.round(act.accuracy * 100)}%`);
      if (act.aim) await expect(page.locator('.st-dice .roll-result')).toHaveAttribute('aria-label', new RegExp(`^정확 ${Math.round(act.accuracy * 100)}% · ${want} 노림 → `), { timeout: 10_000 });
      console.log(`[skill] CPU roll ${press.act} → arrow "${seen.at(-1)!.label}", ${seen.at(-1)!.readout}`);
    }
    expect(logs, logs.join('\n')).toEqual([]);
  });

  test('a strategy-mode CPU game plays 20+ turns without errors (one-die rolls included)', async ({ page }) => {
    test.setTimeout(300_000);
    const logs = watchConsole(page, { warnings: true, ignore: /favicon|Failed to load resource/ });
    await boot(page, { ...VIEW, query: '&dice=dom' });
    await page.evaluate(() => {
      const h = window.__lotAndRoll!;
      h.setPromptTimer(0);
      h.setAnimSpeed(6);
      const st = h.demoSettings(4, true) as { rules: string };
      st.rules = 'advanced';
      h.startGame(st as never, 20261008);
    });
    await page.waitForFunction(() => (window.__lotAndRoll!.getState()?.turn ?? 0) >= 21 || window.__lotAndRoll!.getState()?.phase.kind === 'gameOver', null, { timeout: 280_000, polling: 500 });
    const rolls = await page.evaluate(() => window.__lotAndRoll!.skill().rolls.map((r) => r.stride));
    console.log(`[skill] CPU game: ${rolls.length} skill rolls, ${rolls.filter((s) => s === 1).length} with one die`);
    expect(rolls.length).toBeGreaterThan(10);
    expect(logs, logs.join('\n')).toEqual([]);
  });
});
