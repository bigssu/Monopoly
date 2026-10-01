/**
 * In-game VFX e2e (docs/VFX.md §10.2, §14). Seeded, hand-crafted all-human states at animation
 * speed 1; the dev hook's MANUAL clock drives the whole game (engine FX, Web Animations, sleeps)
 * frame by frame, so every screenshot is deterministic:
 *
 *   buy (S, completes the blue group) → build L1 → L2 → L3 → L4 landmark (E) → toll (N rolls onto
 *   W's hotel) → takeover (N, completes the red group) → landmark (W) → hub victory (W)
 *
 * For every beat: no console errors, `fx()` shows live particles during the effect and, after it,
 * zero idle (canvas hidden, no clock callback). Filmstrips (one thumbnail every 2 ticks = 67 ms)
 * → docs/assets/vfx-ingame/<beat>-<W>x<H>.png; the busiest frame → e2e/__screenshots__/vfx-*.png.
 * Plus: reduced motion (no canvas, static highlight), prompt clickable through a running effect,
 * tap-to-skip of the finale.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const SHOTS = 'e2e/__screenshots__';
const STRIPS = 'docs/assets/vfx-ingame';
const EVERY = 2;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/favicon/.test(m.location().url ?? '')) return;
    if (/Failed to load resource/.test(m.text()) && !m.location().url) return;
    errors.push(`${m.text()} @ ${m.location().url}`);
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

/** A fresh 4-human game (seed 7), patched by `patch(s)` and resumed; real clock; waits until idle with the atlas loaded. */
async function craft(page: Page, patch: string): Promise<void> {
  await page.evaluate((patch) => {
    const hook = window.__lotAndRoll!;
    hook.manualClock(false);
    hook.setAnimSpeed(1);
    hook.setPromptTimer(0);
    hook.startGame(hook.demoSettings(4, false), 7);
    const s = hook.getState()!;
    new Function('s', patch)(s);
    hook.loadState(s);
  }, patch);
  await page.waitForSelector('.game .board');
  await page.waitForFunction(() => {
    const hook = window.__lotAndRoll!;
    const fx = hook.fx();
    return !hook.isBusy() && (fx?.atlas === 'ready' || (fx?.quality.tier === 'off' && fx.atlas === 'idle'));
  }, null, { timeout: 20_000 });
  await page.evaluate(() => window.__lotAndRoll!.whenIdle());
  await page.waitForTimeout(500);
}

interface Shot {
  buf: Buffer;
  label: string;
  live: number;
}

/**
 * Dispatch `action` under the manual clock, screenshot every EVERY ticks until the batch is done
 * and the FX engine idle; then run on (no shots) until idle. Returns the shots and the FX regions.
 */
async function capture(page: Page, action: string, maxTicks: number, focus: string[] = []): Promise<{ shots: Shot[]; region: { x: number; y: number; w: number; h: number } | null; maxLive: number; effects: string[] }> {
  await page.evaluate((a) => {
    const hook = window.__lotAndRoll!;
    hook.manualClock(true);
    const w = window as unknown as { __vfxDone: boolean };
    w.__vfxDone = false;
    void hook.dispatch(JSON.parse(a)).then(() => (w.__vfxDone = true));
  }, action);
  const shots: Shot[] = [];
  let region: { x0: number; y0: number; x1: number; y1: number } | null = null;
  let maxLive = 0;
  const effects = new Set<string>();
  for (let tick = 0; tick <= maxTicks; tick += EVERY) {
    if (tick) await page.evaluate((n) => window.__lotAndRoll!.stepFrames(n), EVERY);
    // fx() is null once the game has left for the Result screen (victory).
    const st = await page.evaluate(() => ({
      fx: window.__lotAndRoll!.fx() ?? { live: 0, effects: [] as string[], canvas: null, ticking: false },
      done: (window as unknown as { __vfxDone: boolean }).__vfxDone,
    }));
    maxLive = Math.max(maxLive, st.fx.live);
    st.fx.effects.forEach((e) => effects.add(e));
    const c = st.fx.canvas;
    // Crop region: while the beat's own effects run (not the next turn's halo).
    if (c && !c.hidden && (!focus.length || (st.fx.effects.length > 0 && st.fx.effects.every((e) => focus.some((f) => e.startsWith(f)))))) {
      region = region
        ? { x0: Math.min(region.x0, c.x), y0: Math.min(region.y0, c.y), x1: Math.max(region.x1, c.x + c.w), y1: Math.max(region.y1, c.y + c.h) }
        : { x0: c.x, y0: c.y, x1: c.x + c.w, y1: c.y + c.h };
    }
    shots.push({ buf: await page.screenshot(), label: `t${tick} n${st.fx.live}${st.fx.effects.length ? ' ' + st.fx.effects.join('+') : ''}`, live: st.fx.live });
    if (st.done && !st.fx.ticking && tick > 6) break;
  }
  // Run the rest (tails, next prompt) without shots, then back to real time.
  for (let k = 0; k < 400; k++) {
    const st = await page.evaluate(() => ({ t: !!window.__lotAndRoll!.fx()?.ticking, done: (window as unknown as { __vfxDone: boolean }).__vfxDone }));
    if (st.done && !st.t) break;
    await page.evaluate(() => window.__lotAndRoll!.stepFrames(4));
  }
  await page.evaluate(() => window.__lotAndRoll!.stepFrames(20));
  await page.evaluate(() => window.__lotAndRoll!.manualClock(false));
  return { shots, region: region ? { x: region.x0, y: region.y0, w: region.x1 - region.x0, h: region.y1 - region.y0 } : null, maxLive, effects: [...effects] };
}

/** Zero idle after an effect: canvas hidden, engine not ticking, no clock callback. */
async function expectIdle(page: Page): Promise<void> {
  await page.waitForTimeout(700);
  // (After a victory the Result screen's confetti may still be falling: wait for it.)
  await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.activeTicks()), { timeout: 6000 }).toBe(0);
  const st = await page.evaluate(() => ({ fx: window.__lotAndRoll!.fx(), ticks: window.__lotAndRoll!.activeTicks(), canvases: document.querySelectorAll('canvas.fx-canvas').length }));
  expect(!!st.fx?.ticking).toBe(false);
  expect(!st.fx?.canvas || st.fx.canvas.hidden).toBe(true);
  expect(st.ticks).toBe(0);
  expect(st.canvases).toBeLessThanOrEqual(16);
}

/** Compose a filmstrip PNG (thumbnails cropped to the effects' region) in a scratch page. */
async function filmstrip(page: Page, name: string, shots: Shot[], region: { x: number; y: number; w: number; h: number } | null, vw: number, vh: number): Promise<Buffer> {
  const m = 24;
  const clip = region
    ? { x: Math.max(0, region.x - m), y: Math.max(0, region.y - m), w: 0, h: 0 }
    : { x: 0, y: 0, w: vw, h: vh };
  if (region) {
    clip.w = Math.min(vw, region.x + region.w + m) - clip.x;
    clip.h = Math.min(vh, region.y + region.h + m) - clip.y;
  }
  const composer = await page.context().newPage();
  try {
    const b64 = await composer.evaluate(
      async ({ shots, clip, title }) => {
        const cols = 8;
        const thumb = 180;
        const k = Math.min(thumb / clip.w, (thumb * 1.1) / clip.h);
        const tw = Math.round(clip.w * k);
        const th = Math.round(clip.h * k);
        const rows = Math.ceil(shots.length / cols);
        const c = document.createElement('canvas');
        c.width = Math.min(cols, shots.length) * tw;
        c.height = rows * (th + 16) + 26;
        const g = c.getContext('2d')!;
        g.fillStyle = '#0E141C';
        g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#E8EDF5';
        g.font = 'bold 14px sans-serif';
        g.fillText(title, 6, 18);
        for (let i = 0; i < shots.length; i++) {
          const img = new Image();
          img.src = `data:image/png;base64,${shots[i]!.img}`;
          await img.decode();
          const x = (i % cols) * tw;
          const y = 26 + Math.floor(i / cols) * (th + 16);
          const s = img.naturalWidth / (clip.vw || img.naturalWidth);
          g.drawImage(img, clip.x * s, clip.y * s, clip.w * s, clip.h * s, x, y, tw - 2, th);
          g.fillStyle = '#9FB0C8';
          g.font = '10px monospace';
          g.fillText(shots[i]!.label.slice(0, 48), x + 3, y + th + 12);
        }
        return c.toDataURL('image/png').split(',')[1]!;
      },
      {
        shots: shots.map((s) => ({ img: s.buf.toString('base64'), label: s.label })),
        clip: { ...clip, vw },
        title: `${name} — in game, every ${EVERY} ticks (t = tick, n = live particles)`,
      },
    );
    return Buffer.from(b64, 'base64');
  } finally {
    await composer.close();
  }
}

interface Beat {
  name: string;
  /** State patch (null = continue from the previous beat's state). */
  patch: string | null;
  action: string;
  ticks: number;
  /** Presets that must have played. */
  expect: string[];
}

const ME = (pid: number) => `s.current = ${pid}; s.players.forEach((p) => (p.cash = 9000));`;

const BEATS: Beat[] = [
  {
    name: 'buy-group-S',
    patch: `${ME(0)} s.players[0].position = 31; s.properties[30] = { owner: 0, level: 0 }; s.phase = { kind: 'buy', playerId: 0, spaceIndex: 31, price: 1000 };`,
    action: JSON.stringify({ type: 'Buy', playerId: 0 }),
    ticks: 110,
    expect: ['plotClaim', 'groupChain'],
  },
  ...[1, 2, 3, 4].map(
    (lv): Beat => ({
      name: `build${lv}-E`,
      patch: `${ME(1)} s.players[1].position = 22; s.properties[22] = { owner: 1, level: ${lv - 1} }; s.phase = { kind: 'build', playerId: 1, spaceIndex: 22, toLevel: ${lv}, cost: ${[0, 240, 290, 340, 480][lv]} };`,
      action: JSON.stringify({ type: 'Build', playerId: 1, spaceIndex: 22 }),
      ticks: lv === 4 ? 90 : 50,
      expect: [lv === 4 ? 'landmarkReveal' : `buildSeq${lv}`],
    }),
  ),
  {
    name: 'toll-N',
    patch: `${ME(2)} s.players[2].position = 15; s.properties[20] = { owner: 3, level: 3 }; s.properties[19] = { owner: 2, level: 1 }; s.properties[22] = { owner: 2, level: 0 }; s.phase = { kind: 'preRoll', playerId: 2, rollAgain: false }; s.testHooks = { diceQueue: [[2, 3]] };`,
    action: JSON.stringify({ type: 'Roll', playerId: 2 }),
    ticks: 110,
    expect: ['tollPay'],
  },
  {
    name: 'takeover-group-N',
    patch: null,
    action: JSON.stringify({ type: 'Takeover', playerId: 2 }),
    ticks: 130,
    expect: ['takeoverStamp', 'groupChain'],
  },
  {
    name: 'landmark-W',
    patch: `${ME(3)} s.players[3].position = 12; s.properties[12] = { owner: 3, level: 3 }; s.phase = { kind: 'build', playerId: 3, spaceIndex: 12, toLevel: 4, cost: 280 };`,
    action: JSON.stringify({ type: 'Build', playerId: 3, spaceIndex: 12 }),
    ticks: 90,
    expect: ['landmarkReveal'],
  },
  {
    name: 'victory-hubs-W',
    patch: `${ME(3)} s.players[3].position = 29; for (const i of [5, 13, 21]) s.properties[i] = { owner: 3, level: 0 }; s.phase = { kind: 'buy', playerId: 3, spaceIndex: 29, price: 250 };`,
    action: JSON.stringify({ type: 'Buy', playerId: 3 }),
    ticks: 130,
    expect: ['plotClaim', 'victory'],
  },
];

const SIZES = [
  { w: 1600, h: 1000, beats: BEATS.map((b) => b.name) },
  { w: 800, h: 450, beats: ['buy-group-S', 'build1-E', 'build2-E', 'build3-E', 'build4-E', 'toll-N', 'takeover-group-N', 'victory-hubs-W'] },
];

test.describe('in-game VFX', () => {
  for (const size of SIZES) {
    test(`scripted sequence ${size.w}x${size.h}: effects play, anchored, zero idle after`, async ({ page }) => {
      test.setTimeout(420_000);
      const errors = watchErrors(page);
      await boot(page, size.w, size.h);
      mkdirSync(STRIPS, { recursive: true });
      const report: string[] = [];
      let prevOk = false;
      for (const beat of BEATS) {
        if (!size.beats.includes(beat.name)) {
          prevOk = false;
          continue;
        }
        if (beat.patch) await craft(page, beat.patch);
        else if (!prevOk) continue;
        else {
          await page.evaluate(() => window.__lotAndRoll!.whenIdle());
          await page.waitForTimeout(300);
        }
        const r = await capture(page, beat.action, beat.ticks, beat.expect);
        for (const e of beat.expect) expect(r.effects, `${beat.name}: ${r.effects.join(',')}`).toContain(e);
        expect(r.maxLive, beat.name).toBeGreaterThan(0);
        expect(r.maxLive, beat.name).toBeLessThanOrEqual(300);
        await expectIdle(page);
        const tag = `${beat.name}-${size.w}x${size.h}`;
        // The busiest frame as the reference shot; the filmstrip for review.
        const best = r.shots.reduce((a, b) => (b.live > a.live ? b : a), r.shots[0]!);
        writeFileSync(`${SHOTS}/vfx-${tag}.png`, best.buf);
        // Strip: the frames where something plays (plus the first and last).
        const strip = r.shots.filter((x, k) => k === 0 || k === r.shots.length - 1 || x.label.split(' ').length > 2 || x.live > 0);
        writeFileSync(`${STRIPS}/${tag}.png`, await filmstrip(page, tag, strip, r.region, size.w, size.h));
        report.push(`${tag}: ${r.shots.length} shots, peak ${r.maxLive}, ${r.effects.join('+')}`);
        prevOk = true;
      }
      console.log(report.join('\n'));
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }

  test('reduced motion: no canvas, static highlight, state still applied', async ({ page }) => {
    const errors = watchErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page, 1600, 1000);
    await craft(page, BEATS[0]!.patch!);
    await page.evaluate(() => void window.__lotAndRoll!.dispatch({ type: 'Buy', playerId: 0 }));
    await expect(page.locator('.bm-hl').first()).toBeAttached({ timeout: 3000 });
    await page.evaluate(() => window.__lotAndRoll!.whenIdle());
    expect(await page.evaluate(() => window.__lotAndRoll!.getState()!.properties[31]!.owner)).toBe(0);
    expect(await page.locator('canvas.fx-canvas').count()).toBe(0);
    expect(await page.evaluate(() => window.__lotAndRoll!.fx()?.atlas)).toBe('idle');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('prompts stay clickable through a running effect (pointer-events: none)', async ({ page }) => {
    const errors = watchErrors(page);
    await boot(page, 1600, 1000);
    await craft(page, BEATS[1]!.patch!);
    // A landmark effect (close-up card + stage veil) running…
    await page.evaluate(() => void window.__lotAndRoll!.playFx('landmarkReveal', { space: 31, player: 0 }));
    await page.waitForFunction(() => (window.__lotAndRoll!.fx()?.live ?? 0) > 20);
    await expect(page.locator('.fx-cu-veil')).toBeAttached();
    // …and the build prompt's button still takes the tap (Playwright checks nothing covers it).
    await page.locator('.st-prompt [data-action="Build"]').click({ timeout: 3000 });
    await expect.poll(() => page.evaluate(() => window.__lotAndRoll!.getState()!.properties[22]!.level)).toBe(1);
    await page.evaluate(() => window.__lotAndRoll!.whenIdle());
    await expectIdle(page);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('tap skips the finale: the engine is idle within 500 ms', async ({ page }) => {
    const errors = watchErrors(page);
    await boot(page, 1600, 1000);
    await craft(page, BEATS[BEATS.length - 1]!.patch!);
    await page.evaluate(() => void window.__lotAndRoll!.dispatch({ type: 'Buy', playerId: 3 }));
    await page.waitForFunction(() => window.__lotAndRoll!.fx()?.effects.includes('victory'), null, { timeout: 10_000 });
    await page.waitForTimeout(300);
    const t0 = Date.now();
    await page.mouse.click(800, 500);
    await page.waitForFunction(() => !window.__lotAndRoll!.fx()?.ticking, null, { timeout: 5000 });
    const ms = Date.now() - t0;
    console.log(`finale skip → idle in ${ms} ms`);
    expect(ms).toBeLessThanOrEqual(500);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});
