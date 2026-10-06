/**
 * Fixed view (src/ui/orientation.ts; DESIGN §2.1): one human against CPUs is solo play, so the
 * screen faces that human and never turns. The human is drawn at the bottom (S) wherever they sat
 * in setup; the other players keep their places around the table.
 *
 * Checked every animation frame over 20+ turns (1 human + 3 CPUs, human seated S, then N): the
 * Stage stays at 0° and faces S for every acting player, every panel / wallet / plaque / hero is
 * upright, the "one away" toast is a single upright copy, the CPU hand comes from the CPU's drawn
 * edge and every press lands inside the chosen control (the cpu-hand dev log). Then the result
 * card faces S without the ↻ pill. A crafted collect-from-all shows ONE total. A 2-human game still
 * turns the Stage (table model). Screenshots → e2e/__screenshots__/fixed-*.png.
 */
import { expect, test, type Page } from '@playwright/test';
import type { HandRecord } from '../src/ui/stage/CpuHand';
import { OWNED_SAMPLE, checkOwnedBoard, craftOwned } from './owned-board';

const SHOTS = 'e2e/__screenshots__';
const ANGLE: Record<string, number> = { S: 0, E: -90, N: 180, W: 90 };

function watchConsole(page: Page): string[] {
  const out: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    if (/favicon|Failed to load resource|preloaded using link preload/.test(`${m.text()} ${m.location().url ?? ''}`)) return;
    out.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => out.push(`pageerror: ${String(e)}`));
  return out;
}

async function boot(page: Page, w: number, h: number): Promise<void> {
  await page.setViewportSize({ width: w, height: h });
  await page.goto('/?dev=1');
  await page.waitForFunction(() => !!window.__lotAndRoll && document.getElementById('app')?.dataset.screen === 'title', null, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}

/**
 * A seeded 4-player game: `humans` are the human seats (the rest are CPUs). Prompt timer off.
 * `speed`: animation rate (0 = headless).
 */
async function start(page: Page, o: { humans: string[]; seed: number; speed: number; roundLimit?: number }): Promise<void> {
  await page.evaluate(({ humans, seed, speed, roundLimit }) => {
    const hook = window.__lotAndRoll!;
    hook.setAnimSpeed(speed);
    hook.setPromptTimer(0);
    hook.cpuHand().clear();
    const d = hook.demoSettings(4, true);
    d.players.forEach((p, i) => {
      p.isCpu = !humans.includes(p.seat);
      p.name = p.isCpu ? `CPU ${i + 1}` : `나 ${i + 1}`;
    });
    if (roundLimit) d.roundLimit = roundLimit as never;
    hook.startGame(d, seed);
  }, o);
  await page.waitForSelector('.game .board');
}

/** Rotation (deg, -90 / 0 / 90 / 180) of an element's computed transform (0 when none). */
const ANGLE_OF = `(el) => {
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return 0;
  // matrix3d too (a money hero tilted back in 3D, MONEY-EVENTS §13): rotateX leaves the x-axis
  // column alone, so its first two entries still give the turn about the screen normal.
  const m = t.match(/matrix(?:3d)?\\(([^)]+)\\)/);
  if (!m) return NaN;
  const [a, b] = m[1].split(',').map(Number);
  const d = Math.round((Math.atan2(b, a) * 180) / Math.PI);
  return d === -180 ? 180 : d === 0 ? 0 : d;
}`;

interface Probe {
  frames: number;
  bad: string[];
  /** Drawn seats of the players who acted while sampled. */
  actors: string[];
  plaques: number;
  maxPlaques: number;
  wallets: string[];
  heroes: number;
  toasts: number;
  hands: string[];
}

/** Sample the fixed-view invariants every animation frame into `window.__fixedProbe`. */
async function installProbe(page: Page): Promise<void> {
  await page.evaluate((angleSrc) => {
    const angleOf = new Function(`return ${angleSrc}`)() as (el: Element) => number;
    const ANGLE: Record<string, number> = { S: 0, E: -90, N: 180, W: 90 };
    const p = {
      frames: 0,
      bad: [] as string[],
      actors: new Set<string>(),
      plaques: 0,
      maxPlaques: 0,
      wallets: new Set<string>(),
      heroes: 0,
      toasts: 0,
      hands: new Set<string>(),
      stop: false,
    };
    (window as unknown as { __fixedProbe: typeof p }).__fixedProbe = p;
    const bad = (s: string): void => {
      if (p.bad.length < 40) p.bad.push(s);
    };
    const visible = (el: HTMLElement): boolean => Number(getComputedStyle(el).opacity) > 0.05;
    const tick = (): void => {
      if (p.stop) return;
      const s = window.__lotAndRoll!.getState();
      const game = document.querySelector<HTMLElement>('.game');
      if (s && game && s.phase.kind !== 'gameOver') {
        p.frames++;
        const pid = s.phase.playerId;
        const seat = document.querySelector<HTMLElement>(`.pp[data-pid="${pid}"]`)?.dataset.seat ?? '?';
        p.actors.add(seat);
        const stage = document.querySelector<HTMLElement>('.stage')!;
        if (stage.dataset.seat !== 'S') bad(`turn ${s.turn}: stage faces ${stage.dataset.seat}`);
        const rot = angleOf(stage.querySelector('.stage-rot')!);
        if (rot !== 0) bad(`turn ${s.turn}: stage-rot at ${rot}°`);
        for (const el of document.querySelectorAll<HTMLElement>('.pp')) {
          const a = angleOf(el);
          if (a !== 0) bad(`turn ${s.turn}: panel ${el.dataset.pid}@${el.dataset.seat} at ${a}°`);
        }
        const live = document.querySelector('.money-stage.is-live');
        if (live) {
          let n = 0;
          for (const el of live.querySelectorAll<HTMLElement>('.ms-plq')) {
            // Idle plaques are parked off-screen (their opacity may still be written by a fade).
            const r = el.getBoundingClientRect();
            if (!visible(el) || r.right < 0 || r.left > innerWidth) continue;
            n++;
            const a = angleOf(el);
            if (a !== 0) bad(`turn ${s.turn}: plaque at ${a}°`);
          }
          p.plaques += n;
          p.maxPlaques = Math.max(p.maxPlaques, n);
          for (const el of live.querySelectorAll<HTMLElement>('.mw.is-on')) {
            p.wallets.add(el.dataset.seat ?? '?');
            const a = angleOf(el);
            if (a !== 0) bad(`turn ${s.turn}: wallet ${el.dataset.seat} at ${a}°`);
          }
          const hero = live.querySelector<HTMLElement>('.ms-hero');
          if (hero && visible(hero)) {
            p.heroes++;
            const a = angleOf(hero);
            if (a !== 0) bad(`turn ${s.turn}: hero at ${a}°`);
          }
        }
        const toasts = document.querySelectorAll<HTMLElement>('.edge-toast');
        if (toasts.length) p.toasts++;
        if (toasts.length > 1) bad(`turn ${s.turn}: ${toasts.length} edge toasts`);
        for (const el of toasts) if (el.style.getPropertyValue('--rot') !== '0deg') bad(`edge toast faces ${el.style.getPropertyValue('--rot')}`);
        // The hand of the latest press (it may still be leaving after its turn ended).
        const layer = document.querySelector<HTMLElement>('.cpu-hand-layer');
        const press = window.__lotAndRoll!.cpuHand().log.at(-1);
        if (layer && press) {
          const a = angleOf(layer);
          p.hands.add(press.seat);
          if (a !== ANGLE[press.seat]) bad(`turn ${s.turn}: hand layer at ${a}° for a CPU drawn at ${press.seat}`);
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, ANGLE_OF);
}

async function readProbe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const p = (window as unknown as { __fixedProbe: Record<string, unknown> & { actors: Set<string>; wallets: Set<string>; hands: Set<string> } }).__fixedProbe;
    return { ...p, actors: [...p.actors].sort(), wallets: [...p.wallets].sort(), hands: [...p.hands].sort() } as unknown as Probe;
  });
}

/** Play until turn `n` (the human's prompts are answered with the CPU policy). */
async function playUntilTurn(page: Page, n: number): Promise<void> {
  await page.evaluate(async (n) => {
    const hook = window.__lotAndRoll!;
    for (let i = 0; i < 400; i++) {
      await hook.whenIdle();
      const s = hook.getState()!;
      if (s.phase.kind === 'gameOver' || s.turn >= n) return;
      await hook.autoStep();
    }
  }, n);
}

async function handLog(page: Page): Promise<HandRecord[]> {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__lotAndRoll!.cpuHand().log)) as HandRecord[]);
}

function checkPress(r: HandRecord, ctx: string): void {
  const where = `${ctx} ${r.seat} ${r.phase}:${r.action} pressed=${r.pressed} tip=${JSON.stringify(r.tip)} at=${JSON.stringify(r.at)}`;
  expect(r.found, `control on screen: ${where}`).toBe(true);
  expect(r.tipInside, `fingertip on the control: ${where}`).toBe(true);
  expect(r.pending, `pressed before the dispatch: ${where}`).toBe(true);
  const a = JSON.parse(r.act) as { type: string; spaceIndex?: number };
  if (r.target === 'space') expect(r.pressed, where).toBe(`space:${a.spaceIndex}`);
  else expect(r.pressed, where).toBe(`${a.type}${a.spaceIndex !== undefined ? `:${a.spaceIndex}` : ''}`);
}

/** Every panel sits inside the viewport and its card inside the panel (no clipped content). */
async function expectPanelsFit(page: Page): Promise<void> {
  const out = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('.pp, .game .board')) {
      const r = el.getBoundingClientRect();
      if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) bad.push(`${el.className} off-screen`);
    }
    for (const pp of document.querySelectorAll<HTMLElement>('.pp')) {
      const box = pp.getBoundingClientRect();
      for (const sel of ['.pp-card', '.pp-name', '.pp-cash', '.pp-owned']) {
        const r = pp.querySelector(sel)?.getBoundingClientRect();
        if (r && (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1)) bad.push(`panel ${pp.dataset.seat} ${sel} spills out`);
      }
    }
    return bad;
  });
  expect(out).toEqual([]);
}

async function expectResultFacesS(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const hook = window.__lotAndRoll!;
    hook.setAnimSpeed(0);
    for (let i = 0; i < 2000; i++) {
      await hook.whenIdle();
      const s = hook.getState();
      if (!s || s.phase.kind === 'gameOver') return;
      await hook.autoStep();
    }
  });
  await page.waitForFunction(() => window.__lotAndRoll!.screen() === 'result', null, { timeout: 30_000 });
  await expect(page.locator('.result')).toHaveAttribute('data-view', 'fixed');
  await expect(page.locator('.rs-card')).toHaveAttribute('data-seat', 'S');
  await expect(page.locator('.rs-rotate')).toHaveCount(0);
  const a = await page.evaluate((src) => (new Function(`return ${src}`)() as (el: Element) => number)(document.querySelector('.rs-card')!), ANGLE_OF);
  expect(a, 'result card upright').toBe(0);
}

test.describe('fixed view: one human vs CPUs', () => {
  for (const run of [
    { human: 'S', seed: 515, vp: { w: 1600, h: 1000 } },
    { human: 'N', seed: 2027, vp: { w: 800, h: 450 } },
  ]) {
    test(`human seated ${run.human}: 20+ turns never turn the screen (${run.vp.w}x${run.vp.h})`, async ({ page }) => {
      test.setTimeout(420_000);
      const logs = watchConsole(page);
      await boot(page, run.vp.w, run.vp.h);
      await start(page, { humans: [run.human], seed: run.seed, speed: 4, roundLimit: 10 });
      await expect(page.locator('.game')).toHaveAttribute('data-view', 'fixed');
      // The human is drawn at S; the others keep their order around the table.
      const drawn = await page.evaluate(() => {
        const s = window.__lotAndRoll!.getState()!;
        return s.players.map((p) => ({ seat: p.seat, cpu: p.isCpu, at: document.querySelector<HTMLElement>(`.pp[data-pid="${p.id}"]`)!.dataset.seat }));
      });
      const cycle = ['S', 'E', 'N', 'W'];
      const k = cycle.indexOf(run.human);
      for (const d of drawn) expect(d.at, `seat ${d.seat}`).toBe(cycle[(cycle.indexOf(d.seat) - k + 4) % 4]);
      expect(drawn.find((d) => !d.cpu)!.at).toBe('S');

      await installProbe(page);
      await playUntilTurn(page, 22);
      await page.evaluate(() => window.__lotAndRoll!.whenIdle());
      const p = await readProbe(page);
      console.log(`[fixed ${run.human}] frames=${p.frames} actors=${p.actors} plaques=${p.plaques} (max ${p.maxPlaques}) wallets=${p.wallets} heroes=${p.heroes} toasts=${p.toasts} hands=${p.hands}`);
      expect(p.bad, p.bad.join('\n')).toEqual([]);
      expect(p.frames).toBeGreaterThan(200);
      expect(p.actors, 'every seat acted while sampled').toEqual(['E', 'N', 'S', 'W']);
      expect(p.hands, 'the hand came from each CPU edge').toEqual(['E', 'N', 'W']);
      expect(p.plaques, 'a money cut-in plaque was seen').toBeGreaterThan(0);
      expect(p.maxPlaques, 'one plaque at a time').toBe(1);
      expect(await page.evaluate(() => window.__lotAndRoll!.getState()!.turn)).toBeGreaterThanOrEqual(21);

      const presses = (await handLog(page)).filter((r) => r.tip);
      expect(presses.length).toBeGreaterThan(10);
      for (const r of presses) {
        checkPress(r, `fixed ${run.human}`);
        expect(['E', 'N', 'W'], 'hand from a CPU drawn seat').toContain(r.seat);
      }
      await expectPanelsFit(page);
      await expectResultFacesS(page);
      await page.screenshot({ path: `${SHOTS}/fixed-result-${run.human}-${run.vp.w}x${run.vp.h}.png` });
      expect(logs, logs.join('\n')).toEqual([]);
    });
  }

  for (const vp of [
    { w: 1600, h: 1000 },
    { w: 800, h: 450 },
  ]) {
    test(`${vp.w}x${vp.h}: screenshots — mid-game, the hand from N, a collect-from-all total (human seated N)`, async ({ page }) => {
      test.setTimeout(240_000);
      const logs = watchConsole(page);
      const size = `${vp.w}x${vp.h}`;
      await boot(page, vp.w, vp.h);
      // Mid-game: 24 turns at speed 0, then a human prompt at normal speed.
      await start(page, { humans: ['N'], seed: 31, speed: 0 });
      await playUntilTurn(page, 24);
      await page.evaluate(() => window.__lotAndRoll!.setAnimSpeed(1));
      const human = await page.evaluate(() => window.__lotAndRoll!.getState()!.players.find((p) => !p.isCpu)!.id);
      await page.evaluate(() => {
        const hook = window.__lotAndRoll!;
        hook.loadState(hook.getState()!);
      });
      await page.waitForSelector('.stage [data-action]', { timeout: 30_000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${SHOTS}/fixed-mid-${size}.png` });
      await expectPanelsFit(page);
      const owned = await checkOwnedBoard(page);
      expect(owned.problems, owned.problems.join('\n')).toEqual([]);

      // The CPU drawn at N (engine seat S) presses Buy: held at its press for the shot.
      await page.evaluate(() => {
        const hook = window.__lotAndRoll!;
        hook.cpuHand().clear();
        hook.cpuHand().freeze(true);
        const s = hook.getState()!;
        const cpu = s.players.find((p) => p.seat === 'S')!;
        s.current = cpu.id;
        cpu.position = 4;
        cpu.cash = 3000;
        s.properties[4] = { owner: null, level: 0 };
        s.phase = { kind: 'buy', playerId: cpu.id, spaceIndex: 4, price: 160 };
        hook.loadState(s);
      });
      await page.waitForFunction(() => window.__lotAndRoll!.cpuHand().frozen(), null, { timeout: 30_000 });
      await page.waitForTimeout(450);
      await page.screenshot({ path: `${SHOTS}/fixed-hand-N-${size}.png` });
      const r = (await handLog(page)).find((x) => x.tip)!;
      checkPress(r, 'buy from N');
      expect(r.seat).toBe('N');
      const angles = await page.evaluate((src) => {
        const angleOf = new Function(`return ${src}`)() as (el: Element) => number;
        return { layer: angleOf(document.querySelector('.cpu-hand-layer')!), stage: angleOf(document.querySelector('.stage-rot')!) };
      }, ANGLE_OF);
      expect(angles).toEqual({ layer: ANGLE.N, stage: 0 });
      await page.evaluate(() => window.__lotAndRoll!.cpuHand().freeze(false));

      // The same CPU rolls: its hand presses the dice on the throw pad (visible there, the stage
      // still upright for S) and flicks toward the centre, down the screen away from N; the throw
      // follows the stroke.
      await page.evaluate(() => {
        const hook = window.__lotAndRoll!;
        hook.cpuHand().clear();
        hook.dice().clear();
        hook.cpuHand().freeze(true);
        const s = hook.getState()!;
        const cpu = s.players.find((p) => p.seat === 'S')!;
        s.current = cpu.id;
        s.phase = { kind: 'preRoll', playerId: cpu.id, rollAgain: false };
        hook.loadState(s);
      });
      await page.waitForFunction(() => window.__lotAndRoll!.cpuHand().frozen(), null, { timeout: 30_000 });
      await expect(page.locator('.cpu-hand')).toBeVisible();
      await expect(page.locator('.roll-pad')).toHaveClass(/is-held/);
      const roll = (await handLog(page)).find((x) => x.tip)!;
      checkPress(roll, 'roll from N');
      expect(roll.target).toBe('pad');
      expect(roll.seat).toBe('N');
      await page.evaluate(() => window.__lotAndRoll!.cpuHand().freeze(false));
      await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.dice().log.at(-1)?.kind ?? null), { timeout: 15_000 }).toBe('flick');
      const aim = await page.evaluate(() => window.__lotAndRoll!.dice().log.at(-1)!.aim!);
      expect(aim.y, 'thrown down the screen, away from N').toBeGreaterThan(Math.abs(aim.x));

      // Happy birthday for the human: everyone pays into the vault — ONE upright total for S.
      await page.evaluate((human) => {
        const hook = window.__lotAndRoll!;
        const s = hook.getState()!;
        s.current = human;
        s.players[human]!.position = 0;
        s.phase = { kind: 'preRoll', playerId: human, rollAgain: false };
        s.testHooks = { diceQueue: [[1, 2]], cardQueue: ['birthday'] };
        s.settings.rules = 'easy';
        hook.loadState(s);
      }, human);
      const pad = page.locator('.stage [data-action="Roll"]:not(:disabled)');
      await expect(pad).toBeVisible({ timeout: 30_000 });
      await pad.click();
      // Hold the frame where the vault total pops (every payer's coins are in).
      const seen = await page.evaluate(
        (src) =>
          new Promise<{ plaques: number; angles: number[]; wallets: string[]; walletAngles: number[] }>((resolve) => {
            const angleOf = new Function(`return ${src}`)() as (el: Element) => number;
            const t0 = performance.now();
            let best = { plaques: 0, angles: [] as number[], wallets: [] as string[], walletAngles: [] as number[] };
            const tick = (): void => {
              const live = document.querySelector('.money-stage.is-live');
              if (live) {
                const pl = [...live.querySelectorAll<HTMLElement>('.ms-plq')].filter((e) => Number(getComputedStyle(e).opacity) > 0.05);
                const ws = [...live.querySelectorAll<HTMLElement>('.mw.is-on')];
                if (ws.length >= best.wallets.length) best = { plaques: Math.max(best.plaques, pl.length), angles: pl.map(angleOf), wallets: ws.map((w) => w.dataset.seat!).sort(), walletAngles: ws.map(angleOf) };
                if (ws.length === 4 && /[1-9]/.test(pl[0]?.querySelector('.ms-plq-a')?.textContent ?? '') && Number(getComputedStyle(live).opacity) > 0.95) {
                  window.__lotAndRoll!.manualClock(true);
                  resolve(best);
                  return;
                }
              }
              if (performance.now() - t0 > 30_000) resolve(best);
              else requestAnimationFrame(tick);
            };
            tick();
          }),
        ANGLE_OF,
      );
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${SHOTS}/fixed-collect-${size}.png` });
      await page.evaluate(() => window.__lotAndRoll!.manualClock(false));
      expect(seen.plaques, 'one total, not one per seat').toBe(1);
      expect(seen.angles).toEqual([0]);
      expect(seen.wallets).toEqual(['E', 'N', 'S', 'W']);
      expect(seen.walletAngles).toEqual([0, 0, 0, 0]);
      expect(logs, logs.join('\n')).toEqual([]);
    });
  }

  test('two humans: the table model still turns the Stage toward each acting seat', async ({ page }) => {
    test.setTimeout(120_000);
    const logs = watchConsole(page);
    await boot(page, 1600, 1000);
    await start(page, { humans: ['S', 'N'], seed: 77, speed: 0 });
    await expect(page.locator('.game')).toHaveAttribute('data-view', 'table');
    const seen = await page.evaluate(async (src) => {
      const angleOf = new Function(`return ${src}`)() as (el: Element) => number;
      const hook = window.__lotAndRoll!;
      // Speed 0: the CPUs play on their own; stop at each human prompt and read the Stage.
      const out: Record<string, number> = {};
      for (let i = 0; i < 200 && Object.keys(out).length < 2; i++) {
        await hook.whenIdle();
        const s = hook.getState()!;
        if (s.phase.kind === 'gameOver') break;
        const seat = s.players[s.phase.playerId]!.seat;
        const stage = document.querySelector<HTMLElement>('.stage')!;
        if (stage.dataset.seat !== seat) throw new Error(`stage faces ${stage.dataset.seat}, ${seat} acts`);
        out[seat] = angleOf(stage.querySelector('.stage-rot')!);
        await hook.autoStep();
      }
      return out;
    }, ANGLE_OF);
    expect(seen.S).toBe(0);
    expect(seen.N).toBe(180);
    const panels = await page.evaluate((src) => {
      const angleOf = new Function(`return ${src}`)() as (el: Element) => number;
      return Object.fromEntries([...document.querySelectorAll<HTMLElement>('.pp')].map((el) => [el.dataset.seat, angleOf(el)]));
    }, ANGLE_OF);
    expect(panels).toEqual({ S: 0, E: -90, N: 180, W: 90 });
    expect(logs, logs.join('\n')).toEqual([]);
  });
});

test.describe('fixed view: owned spaces', () => {
  for (const vp of [
    { w: 1600, h: 1000 },
    { w: 800, h: 450 },
  ]) {
    test(`${vp.w}x${vp.h}: owner-color cards, buildings upright for S (the top row's hang under it)`, async ({ page }) => {
      const logs = watchConsole(page);
      await boot(page, vp.w, vp.h);
      await start(page, { humans: ['S'], seed: 31, speed: 0 });
      await page.evaluate(() => window.__lotAndRoll!.whenIdle());
      await craftOwned(page, OWNED_SAMPLE);
      const owned = await checkOwnedBoard(page);
      expect(owned.problems, owned.problems.join('\n')).toEqual([]);
      expect(owned.buildings).toBe(Object.values(OWNED_SAMPLE).filter(([, l]) => l > 0).length);
      const top = await page.evaluate(() =>
        [17, 19, 20, 22].map((i) => {
          const b = document.querySelector<HTMLElement>(`.bb[data-i="${i}"]`)!;
          const card = document.querySelector(`.sp[data-i="${i}"] .sp-bg`)!.getBoundingClientRect();
          return { i, hanging: b.classList.contains('is-hanging'), rotate: getComputedStyle(b).rotate, gap: b.getBoundingClientRect().top - card.bottom };
        }),
      );
      for (const t of top) {
        expect(t.hanging, `${t.i}`).toBe(true);
        expect(t.rotate, `${t.i}`).toBe('none');
        // Entirely below its card (toward the centre): nothing of the card is covered.
        expect(t.gap, `${t.i}`).toBeGreaterThanOrEqual(-0.5);
      }
      // The side columns still read along their edge.
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('.bb[data-i="10"]')!).rotate)).toBe('90deg');
      await page.screenshot({ path: `${SHOTS}/fixed-owned-${vp.w}x${vp.h}.png` });
      expect(logs, logs.join('\n')).toEqual([]);
    });
  }
});
