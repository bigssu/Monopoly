/**
 * What a player SEES, in every environment the game runs in (the time policy, src/ui/fx/time.ts).
 *
 * The other specs check state; this one samples the screen over time during one human turn and
 * one CPU turn: the held dice shake, the roll tumbles before the total shows, the token passes
 * through the spaces, the turn takes seconds (not zero), and the CPU's turn is shown.
 *
 * It exists because the game once went instant wherever the DEVICE asked for reduced motion
 * (Windows Remote Desktop, Android battery saver) while every test ran without that flag. So the
 * matrix includes those devices, where the game must look exactly like the default.
 */
import { expect, test, type Page } from '@playwright/test';
import { reduceMotion } from './motion';

interface Env {
  name: string;
  /** The device reports prefers-reduced-motion (must change nothing). */
  deviceReduce?: boolean;
  phone?: boolean;
  /** The player chose Settings → 애니메이션 → 줄이기: same beats, no tweens. */
  reducedSetting?: boolean;
}

const ENVS: Env[] = [
  { name: 'desktop' },
  { name: 'remote desktop (device asks for reduced motion)', deviceReduce: true },
  { name: 'phone on battery saver (touch, device asks for reduced motion)', deviceReduce: true, phone: true },
  { name: 'reduced-motion setting', reducedSetting: true },
];

/** Sample `fn` in the page every `every` ms until `until()` is true (or `max` ms). */
async function sample<T>(page: Page, fn: string, until: string, max = 30_000, every = 40): Promise<{ t: number; v: T }[]> {
  return page.evaluate(
    ({ fn, until, max, every }) =>
      new Promise<{ t: number; v: never }[]>((resolve) => {
        const f = new Function(`return (${fn})()`) as () => never;
        const done = new Function(`return (${until})()`) as () => boolean;
        const out: { t: number; v: never }[] = [];
        const t0 = performance.now();
        const id = setInterval(() => {
          const t = performance.now() - t0;
          out.push({ t, v: f() });
          if (done() || t > max) {
            clearInterval(id);
            resolve(out);
          }
        }, every);
      }),
    { fn, until, max, every },
  );
}

const SNAP = `() => {
  const h = window.__lotAndRoll, s = h.getState();
  const box = (pid) => { const r = document.querySelector('.token[data-pid="' + pid + '"]').getBoundingClientRect(); return Math.round(r.x) + ',' + Math.round(r.y); };
  return {
    cur: s.current, phase: s.phase.kind, busy: h.isBusy(),
    tumble: !!document.querySelector('.dice-canvas'),
    total: !!document.querySelector('.st-total'),
    t0: box(0), t1: box(1),
    tween: document.getAnimations().some((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.token')),
    banner: document.querySelector('.st-banner-name')?.textContent ?? '',
  };
}`;

type Snap = { cur: number; phase: string; busy: boolean; tumble: boolean; total: boolean; t0: string; t1: string; tween: boolean; banner: string };
const span = (xs: { t: number; v: Snap }[], on: (v: Snap) => boolean): number => {
  const hit = xs.filter((x) => on(x.v));
  return hit.length ? hit[hit.length - 1]!.t - hit[0]!.t : 0;
};
const distinct = (xs: { t: number; v: Snap }[], key: 't0' | 't1'): number => new Set(xs.map((x) => x.v[key])).size;

for (const env of ENVS) {
  test.describe(env.name, () => {
    test.use(env.phone ? { viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } });

    test('a turn is shown beat by beat', async ({ page }) => {
      test.setTimeout(120_000);
      if (env.deviceReduce) await page.emulateMedia({ reducedMotion: 'reduce' });
      if (env.reducedSetting) await reduceMotion(page);
      await page.goto('/?dev=1');
      await expect(page.locator('#app')).toHaveAttribute('data-screen', 'title');
      await page.evaluate(() => {
        const h = window.__lotAndRoll!;
        h.setPromptTimer(0);
        const d = h.demoSettings(2, false);
        d.players[1]!.isCpu = true;
        h.startGame(d as never, 7);
        const s = h.getState()!;
        s.current = 0;
        s.phase = { kind: 'preRoll', playerId: 0, rollAgain: false };
        s.testHooks = { diceQueue: [[1, 3], [2, 4]] }; // plain cities, no doubles
        h.loadState(s);
      });
      const roll = page.locator('.st-prompt [data-action="Roll"]:not(:disabled)');
      await expect(roll).toBeVisible({ timeout: 30_000 });

      // 1. Holding the button visibly shakes the dice.
      const b = (await roll.boundingBox())!;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      // Sampled inside the page every frame for 600 ms: sampling from here, one round trip at a
      // time, can land on the same phase of the 120 ms loop every time and see no movement.
      const shakes = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const seen = new Set<string>();
            const die = document.querySelector('.dice .die')!;
            const t0 = performance.now();
            const tick = (): void => {
              seen.add(getComputedStyle(die).transform);
              if (performance.now() - t0 < 600) requestAnimationFrame(tick);
              else resolve(seen.size);
            };
            tick();
          }),
      );
      expect(shakes, 'the held dice move').toBeGreaterThanOrEqual(3);

      // 2. Release: tumble → total → the token walks → the decision.
      const mine = sample<Snap>(page, SNAP, `() => { const s = window.__lotAndRoll.getState(); return s.phase.kind === 'buy' && !window.__lotAndRoll.isBusy(); }`);
      await page.mouse.up();
      const a = await mine;
      const tumble = span(a, (v) => v.tumble);
      const firstTotal = a.find((x) => x.v.total)?.t ?? -1;
      const lastTumble = [...a].reverse().find((x) => x.v.tumble)?.t ?? -1;
      const turnMs = a[a.length - 1]!.t;
      console.log(`[${env.name}] human: tumble ${Math.round(tumble)} ms, total at ${Math.round(firstTotal)} ms, ${distinct(a, 't0')} token positions, roll→decision ${Math.round(turnMs)} ms`);
      expect(tumble, 'the dice are seen rolling').toBeGreaterThanOrEqual(700);
      expect(firstTotal, 'the total shows after the roll, not with it').toBeGreaterThan(lastTumble - 60);
      expect(distinct(a, 't0'), 'the token passes through each space').toBeGreaterThanOrEqual(4);
      expect(turnMs, 'a turn takes time').toBeGreaterThanOrEqual(3000);
      expect(a.some((x) => x.v.tween), 'token tweens run').toBe(!env.reducedSetting);

      // 3. Decline; the CPU's turn is shown, not skipped.
      const theirs = sample<Snap>(page, SNAP, `() => { const s = window.__lotAndRoll.getState(); return s.current === 0 && s.turn > 2 && !window.__lotAndRoll.isBusy(); }`, 60_000);
      await page.locator('.st-prompt [data-action="Pass"]:not(:disabled)').click();
      const c = await theirs;
      const cpu = c.filter((x) => x.v.cur === 1);
      const cpuMs = cpu.length ? cpu[cpu.length - 1]!.t - cpu[0]!.t : 0;
      console.log(`[${env.name}] cpu: ${Math.round(cpuMs)} ms, ${distinct(c, 't1')} token positions`);
      expect(c.some((x) => x.v.banner.includes('2')), 'the banner names the CPU').toBe(true);
      expect(cpuMs, 'the CPU turn takes time').toBeGreaterThanOrEqual(3000);
      expect(distinct(c, 't1'), 'the CPU token is seen moving').toBeGreaterThanOrEqual(4);
    });
  });
}
