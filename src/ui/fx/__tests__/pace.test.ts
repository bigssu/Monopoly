/**
 * Game pace (Settings "게임 속도") stretches holds (`sleep`) but not motion durations (`D`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { D, headless, noMotion, reducedMotion, setAnimSpeed, setFrameRate, setHeld, setPace, setReducedMotion, setTurnRest, sleep, turnRest } from '../time';

afterEach(() => {
  setPace(1);
  setTurnRest(0);
  setAnimSpeed(1);
  setReducedMotion(false);
  setHeld(false);
  vi.useRealTimers();
});

async function heldFor(ms: number, wait: (ms: number) => Promise<void> = sleep): Promise<number> {
  setFrameRate(60); // plain timers (the 30 Hz budget waits on rAF)
  vi.useFakeTimers();
  let done = false;
  void wait(ms).then(() => (done = true));
  let waited = 0;
  while (!done && waited < 10_000) {
    await vi.advanceTimersByTimeAsync(10);
    waited += 10;
  }
  return waited;
}

describe('game pace', () => {
  it('stretches sleep by the pace', async () => {
    setPace(2);
    expect(await heldFor(100)).toBe(200);
  });

  it('keeps the original hold at pace 1', async () => {
    expect(await heldFor(100)).toBe(100);
  });

  it('rests between turns for the set time whatever the pace', async () => {
    setTurnRest(1500);
    setPace(2.5);
    expect(await heldFor(0, () => turnRest())).toBe(1500);
  });

  it('does not change motion durations', () => {
    setPace(2.5);
    expect(D(300)).toBe(300);
  });
});

/** The time policy (fx/time.ts header): reduced motion removes movement, never time. */
describe('time policy', () => {
  it('reduced motion keeps every hold and duration', async () => {
    setReducedMotion(true);
    setPace(2);
    expect(reducedMotion()).toBe(true);
    expect(headless()).toBe(false);
    expect(noMotion()).toBe(true);
    expect(D(300)).toBe(300);
    expect(await heldFor(100)).toBe(200);
  });

  it('the device media query never turns reduced motion on', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(reducedMotion()).toBe(false);
    expect(noMotion()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('only speed 0 is headless: no time passes', async () => {
    setAnimSpeed(0);
    expect(headless()).toBe(true);
    expect(D(300)).toBe(0);
    expect(await heldFor(1000)).toBeLessThanOrEqual(10); // one polling step of the helper
  });

  it('a pause freezes a hold and resume finishes what was left', async () => {
    setFrameRate(60);
    vi.useFakeTimers();
    let done = false;
    void sleep(100).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(40);
    setHeld(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(done).toBe(false);
    setHeld(false);
    await vi.advanceTimersByTimeAsync(50);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(done).toBe(true);
  });
});
