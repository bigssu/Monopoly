/**
 * EVENT_EXTEND on the canvas effects (fx/time.ts): an event's preset plays slower in proportion
 * (`extendRate`), so it lasts `motionMs` longer: the same particles and beats, every frame of the
 * timeline (block, cues) and every particle's life later by the same factor.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PACE, EVENT_EXTEND, eventHoldMs, eventStretch } from '../../time';
import { buildPreset, type PresetName, type PresetParams } from '../presets';
import { extendBlock, extendRate, Runner, timelineFrames } from '../timeline';
import { fakeEnv } from './helpers';

const FRAMES = EVENT_EXTEND.motionMs / (1000 / 30);

/** FX frames until the effect is gone, the block frame, particles spawned. */
function run<N extends PresetName>(name: N, params: PresetParams<N>, rate = 1, ext = false): { frames: number; blockAt: number; spawned: number; cues: Record<string, number> } {
  const tl = buildPreset(name, params, fakeEnv());
  const r = new Runner({}, 5000);
  const e = r.start(tl, { u: 30, seed: 3, rate, ...(ext ? { block: extendBlock(tl, rate, FRAMES) } : {}) });
  let blockAt = -1;
  const cues: Record<string, number> = {};
  // Cue frames from the runner's log (promises would resolve after the loop).
  r.log = [];
  let frames = 0;
  while (!r.idle && frames < 600) {
    r.advance(1);
    frames++;
    if (blockAt < 0 && !e.blocked) blockAt = frames;
  }
  for (const l of r.log) if (l.k === 'cue') cues[l.v] = l.frame;
  return { frames, blockAt, spawned: e.stats.spawned, cues };
}


const CASES: Array<[string, () => ReturnType<typeof run>, (rate: number) => ReturnType<typeof run>, PresetName, unknown]> = [
  ['festival burst', () => run('festivalBurst', { space: 12, player: 1, previous: 4 }), (k) => run('festivalBurst', { space: 12, player: 1, previous: 4 }, k, true), 'festivalBurst', { space: 12, player: 1, previous: 4 }],
  ['island splash (3rd double)', () => run('islandSiren', { space: 6, player: 0, cause: 'doubles' }), (k) => run('islandSiren', { space: 6, player: 0, cause: 'doubles' }, k, true), 'islandSiren', { space: 6, player: 0, cause: 'doubles' }],
  ['monopoly chain', () => run('groupChain', { spaces: [19, 20, 22], player: 2, color: '#E8564F' }), (k) => run('groupChain', { spaces: [19, 20, 22], player: 2, color: '#E8564F' }, k, true), 'groupChain', { spaces: [19, 20, 22], player: 2, color: '#E8564F' }],
  ['victory', () => run('victory', { winner: 0, kind: 'line', spaces: [1, 2, 3, 4, 5, 6] }), (k) => run('victory', { winner: 0, kind: 'line', spaces: [1, 2, 3, 4, 5, 6] }, k, true), 'victory', { winner: 0, kind: 'line', spaces: [1, 2, 3, 4, 5, 6] }],
  ['ring pulse (travel)', () => run('ringPulse', { at: { space: 18 }, color: '#6EC6F0', sparkles: 8 }), (k) => run('ringPulse', { at: { space: 18 }, color: '#6EC6F0', sparkles: 8 }, k, true), 'ringPulse', { at: { space: 18 }, color: '#6EC6F0', sparkles: 8 }],
];

describe('EVENT_EXTEND on event presets', () => {
  it('the constants: +0.5 s motion, +0.5 s hold at the default pace', () => {
    expect(EVENT_EXTEND).toEqual({ motionMs: 500, holdMs: 500 });
    expect(eventStretch(1000)).toBeCloseTo(1.5, 9);
    expect(eventStretch(0)).toBe(1);
    // sleep() multiplies by the pace: the hold is 500 ms at the default pace.
    expect(eventHoldMs() * DEFAULT_PACE).toBe(500);
  });

  for (const [name, base, ext, preset, params] of CASES) {
    it(`${name}: lasts motionMs longer, the same particles, every beat later in proportion`, () => {
      const b = base();
      const tl = buildPreset(preset, params as never, fakeEnv());
      const rate = extendRate(tl, eventStretch);
      expect(rate).toBeLessThan(1);
      const x = ext(rate);
      // The effect's own span (timeline + particle lives) + 15 frames (hit-stops are not stretched).
      expect(Math.abs(x.frames - (b.frames + FRAMES)), `${name}: ${b.frames} → ${x.frames} frames`).toBeLessThanOrEqual(2);
      expect(x.spawned).toBe(b.spawned);
      // The block (what the sequencer waits for) comes exactly motionMs later; the cues move with
      // the stretch.
      if (b.blockAt > 1) expect(Math.abs(x.blockAt - (b.blockAt + FRAMES)), `${name}: block ${b.blockAt} → ${x.blockAt}`).toBeLessThanOrEqual(1);
      for (const [cue, at] of Object.entries(b.cues)) if (at > 1) expect(Math.abs(x.cues[cue]! - at / rate), `${name} cue ${cue}`).toBeLessThanOrEqual(2);
      // The dry run that sizes the stretch sees the same span the runner plays.
      expect(Math.abs(timelineFrames(tl) - b.frames)).toBeLessThanOrEqual(6);
    });
  }

  it('an explicit stretch (the event card glints) plays exactly that much slower', () => {
    const b = run('cardReveal', { tone: 'good' });
    const x = run('cardReveal', { tone: 'good' }, 1 / 1.5);
    expect(Math.abs(x.frames - b.frames * 1.5)).toBeLessThanOrEqual(2);
  });
});
