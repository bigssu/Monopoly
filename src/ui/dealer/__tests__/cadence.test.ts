/**
 * Dealer lip sync and body takes (cadence.ts, acting.ts; docs/research/12-dealer-acting.md): the
 * mouth follows the voice's loudness, the expression shows on phrase pauses only and an arms-up
 * pose never more often than the owner's cap (review 2026-10-06 "the arms go up over and over");
 * every body take keeps volume, ends at rest and grows with the line's weight.
 */
import { describe, expect, it } from 'vitest';
import { bodyTake } from '../acting';
import { ARMS_UP, ARMS_UP_MAX_PER_S, lipTrack, MOUTH_HZ, mouthLevels, POSE_FRAMES } from '../cadence';
import type { DealerExpr } from '../lines';

const RATE = 24000;
const ALL: DealerExpr[] = ['idle', 'point', 'cheer', 'surprised', 'sad', 'thinking', 'nervous', 'laugh', 'dice', 'present', 'trophy'];

/** A fake voice: `[ms, amplitude]` segments of a 200 Hz tone (0 = silence). */
function voice(segments: [number, number][]): Float32Array {
  const total = segments.reduce((a, [ms]) => a + Math.round((ms * RATE) / 1000), 0);
  const out = new Float32Array(total);
  let i = 0;
  for (const [ms, amp] of segments) for (let n = Math.round((ms * RATE) / 1000); n > 0; n--, i++) out[i] = amp * Math.sin((2 * Math.PI * 200 * i) / RATE);
  return out;
}

/** Speech-like: words of 180 ms with 60 ms gaps, a 400 ms breath every 4 words. */
const speech = (seconds: number): Float32Array => {
  const seg: [number, number][] = [];
  for (let t = 0, w = 0; t < seconds * 1000; w++) {
    seg.push([180, w % 2 ? 0.8 : 0.4]);
    const gap = w % 4 === 3 ? 400 : 60;
    seg.push([gap, 0]);
    t += 180 + gap;
  }
  return voice(seg);
};

describe('lip sync', () => {
  it('opens the mouth with the sound and shuts it in silence', () => {
    const lv = mouthLevels(voice([[300, 0], [300, 0.8], [300, 0]]), RATE);
    expect(lv.length).toBe(Math.ceil((0.9 * RATE) / (RATE / MOUTH_HZ)));
    expect(lv[3]).toBe(0);
    expect(lv[14]).toBe(2);
    expect(lv[25]).toBe(0);
  });

  it('tells a quiet syllable from a loud one, and a whisper still moves the mouth', () => {
    const lv = mouthLevels(voice([[300, 0.9], [300, 0.25], [300, 0]]), RATE);
    expect(lv[4]).toBe(2);
    expect(lv[14]).toBe(1);
    const whisper = mouthLevels(voice([[300, 0.02], [200, 0]]), RATE);
    expect(Math.max(...whisper)).toBe(2);
  });

  it('leads the sound by one frame', () => {
    const lv = mouthLevels(voice([[200, 0], [200, 0.8]]), RATE);
    expect(lv[5]).toBe(2); // sound starts in frame 6
  });

  it('closes the mouth (idle) on gaps between words and poses only on a breath', () => {
    const track = lipTrack(mouthLevels(speech(4), RATE), 'present');
    expect(track).toContain('talk-a');
    expect(track).toContain('talk-b');
    expect(track).toContain('idle');
    expect(track).toContain('present');
    let run = 0;
    for (const s of [...track, 'end']) {
      if (s === 'present') run++;
      else {
        if (run) expect(run).toBeGreaterThanOrEqual(POSE_FRAMES);
        run = 0;
      }
    }
  });

  it('never raises the arms more often than the cap', () => {
    for (const e of ARMS_UP) {
      const track = lipTrack(mouthLevels(speech(12), RATE), e);
      let shows = 0;
      track.forEach((s, i) => s === e && track[i - 1] !== e && shows++);
      expect(shows, e).toBeGreaterThan(0);
      expect(shows / (track.length / MOUTH_HZ), e).toBeLessThanOrEqual(ARMS_UP_MAX_PER_S);
    }
  });

  it('a silent buffer gives a shut mouth', () => {
    expect(Math.max(...mouthLevels(new Float32Array(4800), RATE))).toBe(0);
  });
});

/** scaleX × scaleY of a keyframe's transform (1 at rest). */
const volume = (tf: string): number => {
  const m = tf.match(/scale\(([-\d.]+), ([-\d.]+)\)/);
  return m ? Number(m[1]) * Number(m[2]) : 1;
};

describe('body takes', () => {
  it.each(ALL)('%s keeps its volume, starts and ends at rest', (e) => {
    for (const p of [1, 4, 6]) {
      const { keyframes, ms } = bodyTake(e, p);
      expect(keyframes[0]!.offset).toBe(0);
      expect(keyframes.at(-1)!.offset).toBe(1);
      expect(keyframes.at(-1)!.transform).toBe('none');
      expect(ms).toBeGreaterThan(300);
      expect(ms).toBeLessThan(1200);
      for (const k of keyframes) expect(Math.abs(volume(String(k.transform)) - 1), `${e} ${k.transform}`).toBeLessThan(0.06);
    }
  });

  it('starts with an anticipation against the action (a squash before the rise)', () => {
    for (const e of ['cheer', 'surprised', 'trophy', 'dice'] as DealerExpr[]) {
      const sy = String(bodyTake(e, 4).keyframes[1]!.transform).match(/scale\([-\d.]+, ([-\d.]+)\)/)![1];
      expect(Number(sy), e).toBeLessThan(1);
    }
  });

  it('moves more, and a little slower, for bigger moments (exaggeration)', () => {
    const lift = (p: number) => Math.min(...bodyTake('cheer', p).keyframes.map((k) => Number(String(k.transform).match(/translate\([-\d.]+%, ([-\d.]+)%/)?.[1] ?? 0)));
    expect(lift(6)).toBeLessThan(lift(4));
    expect(lift(4)).toBeLessThan(lift(1));
    expect(bodyTake('cheer', 6).ms).toBeGreaterThan(bodyTake('cheer', 1).ms);
  });

  it('sorrow is slower than nerves (timing)', () => {
    expect(bodyTake('sad', 4).ms).toBeGreaterThan(bodyTake('nervous', 4).ms);
  });
});
