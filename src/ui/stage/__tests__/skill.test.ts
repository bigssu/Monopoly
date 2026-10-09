/**
 * The skill throw's rules on the UI side (src/ui/stage/skill.ts): the ring's accuracy from its
 * phase, the arrow's zone from its length, the strength from the length, the stride's reachable
 * spaces, one-die faces, the result line's parts, and the mode switch (strategy only).
 */
import { describe, expect, it } from 'vitest';
import { defaultSettings, ruleFlags, SKILL_BANDS } from '@/engine';
import {
  accuracyAt,
  aimOf,
  deadZone,
  dragStrength,
  pct,
  phaseFor,
  resultParts,
  ringPeriod,
  ringPhase,
  rolledFaces,
  SKILL,
  strideReach,
  zoneLength,
  zoneOf,
} from '../skill';
import { launchOf } from '../throw';

describe('ring timing → accuracy', () => {
  it('one lap per period, starting at the bottom; the band centre (the top) is half a lap in', () => {
    expect(ringPhase(0, 1400)).toBe(0);
    expect(ringPhase(700, 1400)).toBeCloseTo(0.5, 9);
    expect(ringPhase(1400 + 350, 1400)).toBeCloseTo(0.25, 9);
    expect(ringPhase(5, 0)).toBe(0);
  });

  it('accuracy is 1 at the band centre, falls linearly to 0 at its edges (±12 % of the lap), 0 outside', () => {
    expect(SKILL.band).toBe(0.12);
    expect(accuracyAt(0.5)).toBe(1);
    expect(accuracyAt(0.5 + 0.06)).toBeCloseTo(0.5, 9);
    expect(accuracyAt(0.5 - 0.06)).toBeCloseTo(0.5, 9);
    expect(accuracyAt(0.5 + 0.12)).toBeCloseTo(0, 9);
    expect(accuracyAt(0.2)).toBe(0);
    expect(accuracyAt(0.95)).toBe(0);
    // Symmetric and monotonic toward the centre.
    let prev = -1;
    for (let u = 0.38; u <= 0.5; u += 0.01) {
      const a = accuracyAt(u);
      expect(a).toBeGreaterThanOrEqual(prev);
      expect(a).toBeCloseTo(accuracyAt(1 - u), 9);
      prev = a;
    }
  });

  it('phaseFor is the inverse (the CPU hand stops the ring at its accuracy)', () => {
    for (const a of [0.05, 0.25, 0.55, 0.9, 1]) {
      expect(accuracyAt(phaseFor(a, -1))).toBeCloseTo(a, 9);
      expect(accuracyAt(phaseFor(a, 1))).toBeCloseTo(a, 9);
    }
    expect(accuracyAt(phaseFor(0))).toBe(0);
  });

  it('the period follows the game pace (1.4 s at the default), never below 1 s', () => {
    expect(ringPeriod(2)).toBe(1400);
    expect(ringPeriod(3)).toBe(2100);
    expect(ringPeriod(1)).toBe(1000);
    expect(pct(0.925)).toBe(93);
  });
});

describe('arrow length → zone, aim and strength', () => {
  it('dead zone = a tap (보통); short = 작게; middle = 보통; long = 크게', () => {
    expect(zoneOf(0, 100)).toBe('tap');
    expect(zoneOf(0.3, 100)).toBe('tap');
    expect(zoneOf(0.4, 100)).toBe('low');
    expect(zoneOf(1.49, 100)).toBe('low');
    expect(zoneOf(1.5, 100)).toBe('mid');
    expect(zoneOf(2.69, 100)).toBe('mid');
    expect(zoneOf(2.7, 100)).toBe('high');
    expect(zoneOf(9, 100)).toBe('high');
    expect(zoneOf(Number.NaN, 100)).toBe('tap');
    // A small die keeps a dead zone of at least 16 px (finger jitter).
    expect(deadZone(38)).toBeCloseTo(16 / 38, 9);
    expect(zoneOf(0.4, 38)).toBe('tap');
    expect(aimOf('low')).toBe('low');
    expect(aimOf('high')).toBe('high');
    expect(aimOf('mid')).toBeUndefined();
    expect(aimOf('tap')).toBeUndefined();
  });

  it('the CPU\'s drag lengths fall in their zones', () => {
    expect(zoneOf(zoneLength('low'))).toBe('low');
    expect(zoneOf(zoneLength(undefined))).toBe('mid');
    expect(zoneOf(zoneLength('high'))).toBe('high');
  });

  it('length → strength → launch is monotonic (작게 soft and short, 크게 hard and far), clamped', () => {
    let prev = -1;
    let prevSpeed = -1;
    for (let L = 0.35; L <= SKILL.max + 1; L += 0.1) {
      const s = dragStrength(L);
      expect(s).toBeGreaterThanOrEqual(prev);
      const sp = launchOf(s).speed;
      expect(sp).toBeGreaterThanOrEqual(prevSpeed);
      prev = s;
      prevSpeed = sp;
    }
    expect(dragStrength(0.35)).toBe(0);
    expect(dragStrength(SKILL.max)).toBe(1);
    expect(dragStrength(SKILL.max * 3)).toBe(1);
    expect(dragStrength(zoneLength('low'))).toBeLessThan(dragStrength(zoneLength('high')));
  });
});

describe('stride', () => {
  it('lights 1–6 or 2–12 spaces ahead (wrapping; an express ticket doubles)', () => {
    expect(strideReach(0, 1, 32)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(strideReach(0, 2, 32)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(strideReach(28, 2, 32)).toEqual([30, 31, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(strideReach(0, 1, 32, true)).toEqual([2, 4, 6, 8, 10, 12]);
  });

  it('bands: two dice 2–5 / 9–12, one die 1–2 / 5–6', () => {
    expect(SKILL_BANDS[2].low).toEqual([2, 5]);
    expect(SKILL_BANDS[2].high).toEqual([9, 12]);
    expect(SKILL_BANDS[1].low).toEqual([1, 2]);
    expect(SKILL_BANDS[1].high).toEqual([5, 6]);
  });

  it('a one-die roll is [die, 0]: one face shows; a saved lastDice too', () => {
    expect(rolledFaces([4, 0], 1)).toEqual([4]);
    expect(rolledFaces([4, 0])).toEqual([4]);
    expect(rolledFaces([3, 5], 2)).toEqual([3, 5]);
    expect(rolledFaces([3, 5])).toEqual([3, 5]);
  });
});

describe('the result line', () => {
  const ev = (o: object) => ({ dice: [2, 2] as [number, number], total: 4, ...o });
  it('says hit or miss from the band, with the accuracy; nothing for 보통 / casual', () => {
    expect(resultParts(ev({ stride: 2, aim: 'low', accuracy: 0.92, assisted: true }))).toEqual({ accuracy: 92, aim: 'low', hit: true, total: 4 });
    expect(resultParts({ dice: [3, 3], total: 6, stride: 2, aim: 'low', accuracy: 0.4, assisted: false })).toEqual({ accuracy: 40, aim: 'low', hit: false, total: 6 });
    expect(resultParts({ dice: [6, 0], total: 6, stride: 1, aim: 'high', accuracy: 0.5, assisted: false })).toEqual({ accuracy: 50, aim: 'high', hit: true, total: 6 });
    expect(resultParts({ dice: [4, 0], total: 4, stride: 1, aim: 'high', accuracy: 0.5, assisted: false })!.hit).toBe(false);
    expect(resultParts(ev({ stride: 2 }))).toBeNull();
    expect(resultParts(ev({}))).toBeNull();
  });
});

describe('mode', () => {
  it('strategy mode (advanced, version 3) only; casual and older saves keep the plain throw', () => {
    expect(ruleFlags(defaultSettings({ rules: 'advanced' })).skillThrow).toBe(true);
    expect(ruleFlags(defaultSettings({ rules: 'advanced' })).strideChoice).toBe(true);
    expect(ruleFlags(defaultSettings({ rules: 'normal' })).skillThrow).toBe(false);
    expect(ruleFlags(defaultSettings({ rules: 'easy' })).skillThrow).toBe(false);
    expect(ruleFlags({ rules: 'advanced', rulesVersion: 2 }).skillThrow).toBe(false);
    expect(ruleFlags({ rules: 'advanced' }).skillThrow).toBe(false);
  });
});
