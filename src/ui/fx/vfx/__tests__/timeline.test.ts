import { describe, expect, it, vi } from 'vitest';
import { block, burst, cue, flash, haptic, hitStop, Runner, runReduced, sfx, shake, spawn, t, timeline, TIER_CAP } from '../timeline';

const box = { x: 0, y: 0, width: 100, height: 100 };

describe('timeline DSL', () => {
  it('sorts ops by frame (stable) and derives block / end', () => {
    const tl = timeline('x', 1, 1, [t(5, sfx('build')), t(0, sfx('tap')), t(5, haptic('light')), t(3, block()), t(9, cue('end'))], box);
    expect(tl.ops.map((o) => `${o.f}:${o.a.k}`)).toEqual(['0:sfx', '3:block', '5:sfx', '5:haptic', '9:cue']);
    expect(tl.block).toBe(3);
    expect(tl.end).toBe(9);
  });
});

describe('runner', () => {
  it('fires ops on their frame, resolves block at the block frame and cues at the cue frame', async () => {
    const calls: string[] = [];
    const r = new Runner({ sfx: (n) => calls.push(n) });
    const tl = timeline('x', 1, 1, [t(0, sfx('tap')), t(4, cue('swap')), t(6, block()), t(8, sfx('build'))], box);
    const e = r.start(tl, { u: 30, seed: 1 });
    let blocked = false;
    let swapped = false;
    void e.block.then(() => (blocked = true));
    void e.cue('swap').then(() => (swapped = true));
    r.advance(4);
    await Promise.resolve();
    expect(calls).toEqual(['tap']);
    expect(swapped).toBe(false);
    r.advance(1); // frame 4
    await Promise.resolve();
    expect(swapped).toBe(true);
    expect(blocked).toBe(false);
    r.advance(2); // frame 6
    await Promise.resolve();
    expect(blocked).toBe(true);
    r.advance(3);
    expect(calls).toEqual(['tap', 'build']);
    expect(r.idle).toBe(true);
  });

  it('hit-stop freezes FX time (timelines and particles) for n frames', () => {
    const calls: number[] = [];
    const r = new Runner({ sfx: () => calls.push(r.frame) });
    const tl = timeline(
      'x',
      1,
      1,
      [t(0, spawn((e) => void e.emit({ anim: 'dust_puff', life: 10 }))), t(2, hitStop(3)), t(3, sfx('build'))],
      box,
    );
    r.start(tl, { u: 30 });
    r.advance(3); // frames 0,1,2 (hit-stop armed at 2)
    const age = r.pool.age[0]!;
    r.advance(3); // frozen
    expect(r.pool.age[0]).toBe(age);
    expect(calls).toEqual([]);
    r.advance(1);
    expect(calls).toEqual([3]);
  });

  it('skip fires pending cues immediately, drops hit-stops; new effects are quiet and halved', async () => {
    const shakes = vi.fn();
    const r = new Runner({ shake: shakes });
    const tl = timeline('x', 2, 1, [t(0, hitStop(5)), t(20, cue('swap')), t(30, shake(3, 200)), t(31, block())], box);
    const e = r.start(tl, { u: 30 });
    r.advance(1);
    expect(r.freeze).toBe(5);
    let swapped = false;
    void e.cue('swap').then(() => (swapped = true));
    r.skip();
    await Promise.resolve();
    expect(swapped).toBe(true);
    expect(r.freeze).toBe(0);
    // Cue fires exactly once even when its frame is reached later.
    const log: string[] = [];
    r.log = [];
    const q = r.start(timeline('y', 1, 1, [t(0, burst(20, () => ({ anim: 'sparkle4', life: 5 }))), t(1, shake(4, 100)), t(1, hitStop(2))], box), { u: 30 });
    r.advance(40);
    for (const l of r.log) log.push(`${l.k}:${l.v}`);
    expect(log.filter((l) => l.startsWith('cue:'))).toEqual([]);
    expect(shakes).not.toHaveBeenCalled();
    expect(q.stats.spawned).toBe(10);
  });

  it('enforces the per-effect tier cap', () => {
    const r = new Runner({}, 1000);
    const e = r.start(timeline('x', 1, 1, [t(0, burst(90, () => ({ anim: 'sparkle4', life: 5 })))], box), { u: 30 });
    r.advance(1);
    expect(e.stats.requested).toBe(90);
    expect(e.stats.spawned).toBe(TIER_CAP[1]);
  });

  it('flash budget: at most 3 flash frames per 1 s window, alpha ≤ 0.25', () => {
    const r = new Runner({}, 1000);
    const ops = [0, 2, 4, 6, 40].map((f) => t(f, flash(50, 50, 100, 0.9, 2)));
    const e = r.start(timeline('x', 3, 1, ops, box), { u: 30 });
    r.advance(8);
    expect(e.stats.flashFrames).toBe(3);
    r.advance(40);
    expect(e.stats.flashFrames).toBe(5);
  });

  it('same seed → same particles and side-effect log', () => {
    const run = (seed: number): string => {
      const r = new Runner();
      r.log = [];
      const tl = timeline('x', 2, 1, [t(0, burst(30, (_k, _n, e) => ({ anim: 'confetti_rect', vx: e.rng.jitter(100), vy: e.rng.jitter(100), ay: 50, life: 30 })))], box);
      r.start(tl, { u: 30, seed });
      r.advance(12);
      return Array.from(r.pool.x.slice(0, 30)).map((v) => v.toFixed(3)).join(',');
    };
    expect(run(3)).toBe(run(3));
    expect(run(3)).not.toBe(run(4));
  });

  it('stopAll settles every effect and clears the pool', async () => {
    const r = new Runner();
    const e = r.start(timeline('x', 1, 1, [t(0, burst(5, () => ({ anim: 'sparkle4', life: 50 }))), t(40, block())], box), { u: 30 });
    r.advance(2);
    let done = false;
    void e.done.then(() => (done = true));
    r.stopAll();
    await Promise.resolve();
    expect(done).toBe(true);
    expect(r.pool.liveCount).toBe(0);
    expect(r.idle).toBe(true);
  });
});

describe('reduced motion path', () => {
  it('plays only the first sfx / haptic (plus rm-marked ones) and one static highlight', () => {
    const s = vi.fn();
    const h = vi.fn();
    const hl = vi.fn();
    const tl = timeline(
      'x',
      3,
      1,
      [t(0, sfx('landmark', { gain: 0.3 })), t(0, haptic('tick')), t(19, sfx('build')), t(19, haptic('heavy', true)), t(22, sfx('festival'))],
      box,
      { space: 4 },
    );
    runReduced(tl, { sfx: s, haptic: h, highlight: hl });
    expect(s.mock.calls.map((c) => c[0])).toEqual(['landmark']);
    expect(h.mock.calls.map((c) => c[0])).toEqual(['tick', 'heavy']);
    expect(hl).toHaveBeenCalledWith({ space: 4 }, 800);
  });
});
