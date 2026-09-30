import { describe, expect, it } from 'vitest';
import { bigBusy, fxPolicy, MERGE_FRAMES, PitchLadder, type RunningFx } from '../director';
import { buildPreset } from '../presets';
import { Runner } from '../timeline';
import { fakeEnv } from './helpers';

const run = (name: string, tier: 0 | 1 | 2 | 3 | 4, f: number, o: Partial<RunningFx> = {}): RunningFx => ({ name, tier, f, active: true, ...o });

describe('escalation policy (VFX.md §6.2)', () => {
  it('merges the same preset on the same target within 400 ms into an accent', () => {
    const next = { name: 'coinIn', tier: 1 as const, highlight: { space: 11 } };
    expect(fxPolicy(next, [run('coinIn', 1, 5, { highlight: { space: 11 } })])).toBe('accent');
    expect(fxPolicy(next, [run('coinIn', 1, MERGE_FRAMES + 1, { highlight: { space: 11 } })])).toBe('full');
    expect(fxPolicy(next, [run('coinIn', 1, 5, { highlight: { space: 12 } })])).toBe('full');
  });

  it('demotes I1–I2 effects while an I3+ timeline runs (chain demotion); I3+ always full', () => {
    const big = run('landmarkReveal', 3, 20);
    expect(fxPolicy({ name: 'buildSeq1', tier: 1 }, [big])).toBe('accent');
    expect(fxPolicy({ name: 'tollPay', tier: 2 }, [big])).toBe('accent');
    expect(fxPolicy({ name: 'hopDust', tier: 0 }, [big])).toBe('full');
    expect(fxPolicy({ name: 'buildSeq1', tier: 1 }, [{ ...big, active: false }])).toBe('full');
    expect(fxPolicy({ name: 'takeoverStamp', tier: 3 }, [big])).toBe('full');
    expect(bigBusy([big])).toBe(true);
    expect(bigBusy([{ ...big, active: false }, run('tollPay', 2, 3)])).toBe(false);
  });

  it('caps concurrent full-strength effects per tier (I2 ≤ 2, I1 ≤ 4)', () => {
    const two = [run('a', 2, 30), run('b', 2, 30)];
    expect(fxPolicy({ name: 'c', tier: 2 }, two)).toBe('accent');
    expect(fxPolicy({ name: 'c', tier: 2 }, two.slice(1))).toBe('full');
    const four = [1, 2, 3, 4].map((k) => run(`x${k}`, 1, 30));
    expect(fxPolicy({ name: 'y', tier: 1 }, four)).toBe('accent');
    expect(fxPolicy({ name: 'y', tier: 1 }, four.slice(1))).toBe('full');
  });

  it('cash pitch ladder: +1 semitone per cash-in within 1.5 s (≤ 7), resets after a pause; cash-out falls (≥ −4)', () => {
    const l = new PitchLadder();
    const ins = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((t) => l.apply('cash-in', undefined, t) ?? 1);
    const semis = ins.map((p) => Math.round(12 * Math.log2(p)));
    expect(semis).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 7, 7]);
    expect(l.apply('cash-in', undefined, 3000)).toBeUndefined();
    expect(Math.round(12 * Math.log2(l.apply('cash-in', 1.5, 3100)!))).toBe(Math.round(12 * Math.log2(1.5)) + 1);
    const outs = [0, 50, 100, 150, 200, 250].map((t) => Math.round(12 * Math.log2(l.apply('cash-out', undefined, 10_000 + t) ?? 1)));
    expect(outs).toEqual([0, -1, -2, -3, -4, -4]);
    expect(l.apply('build', 0.8, 0)).toBe(0.8);
  });

  it('an accent runs quiet: no shake / hit-stop / flash, fewer particles, same sounds', () => {
    const env = fakeEnv();
    const tl = buildPreset('buildSeq', { space: 6, player: 0, level: 3 }, env);
    const count = (quiet: boolean) => {
      const shakes: number[] = [];
      const sounds: string[] = [];
      const r = new Runner({ shake: (px) => shakes.push(px), sfx: (n) => sounds.push(n) });
      const e = r.start(tl, { u: env.c.u, seed: 1, quiet, quality: quiet ? 0.8 : 1 });
      r.advance(60);
      return { shakes: shakes.length, sounds, spawned: e.stats.spawned, flash: e.stats.flashFrames, freeze: r.log };
    };
    const full = count(false);
    const acc = count(true);
    expect(full.shakes).toBeGreaterThan(0);
    expect(acc.shakes).toBe(0);
    expect(acc.flash).toBe(0);
    expect(acc.spawned).toBeLessThan(full.spawned * 0.6);
    expect(acc.sounds).toEqual(full.sounds);
  });
});
