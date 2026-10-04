/**
 * Game pace (Settings "게임 속도") stretches holds (`sleep`) but not motion durations (`D`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { D, setAnimSpeed, setFrameRate, setPace, setTurnRest, sleep, turnRest } from '../time';

afterEach(() => {
  setPace(1);
  setTurnRest(0);
  setAnimSpeed(1);
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
