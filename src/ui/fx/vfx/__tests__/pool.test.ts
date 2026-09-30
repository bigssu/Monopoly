import { describe, expect, it } from 'vitest';
import { ParticlePool, POOL_CAP, PRIORITY } from '../pool';
import { hammerAngle, newSample, sampleParticle, stepParticles, writeParticle } from '../particles';

const fill = (pool: ParticlePool, n: number, prio: number, effect = 1): number[] => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = pool.alloc(prio, effect);
    if (s >= 0) {
      writeParticle(pool, s, { anim: 'sparkle4', life: 100 }, 1);
      out.push(s);
    }
  }
  return out;
};

describe('particle pool + budget (VFX.md §3.7)', () => {
  it('holds at most 300 live particles', () => {
    const pool = new ParticlePool();
    expect(pool.cap).toBe(POOL_CAP);
    expect(POOL_CAP).toBe(300);
    fill(pool, 320, PRIORITY.build);
    expect(pool.liveCount).toBe(300);
    expect(pool.peak).toBe(300);
    expect(pool.dropped).toBe(20);
  });

  it('grants everything while there is room', () => {
    const pool = new ParticlePool();
    fill(pool, 100, 3);
    expect(pool.request(150, 3)).toBe(150);
    expect(pool.dropped).toBe(0);
  });

  it('trims an oversized request to max(ceil(n/4), free) when nothing lower can be recycled', () => {
    const pool = new ParticlePool();
    fill(pool, 280, PRIORITY.victory);
    // 20 free, same/lower priority requester: cannot recycle the victory particles.
    expect(pool.request(100, PRIORITY.build)).toBe(20);
    expect(pool.dropped).toBe(80);
  });

  it('recycles the oldest lowest-priority particles for a higher-priority request', () => {
    const pool = new ParticlePool();
    const low = fill(pool, 150, PRIORITY.card, 1);
    fill(pool, 150, PRIORITY.build, 2);
    // Full: a landmark asks for 100 → max(25, 0) = 25 … up to 0 free + 300 recyclable → 25.
    expect(pool.request(100, PRIORITY.landmark)).toBe(25);
    const slot = pool.alloc(PRIORITY.landmark, 3);
    // The first card particle (oldest, lowest priority) is recycled.
    expect(slot).toBe(low[0]);
    expect(pool.reclaimed).toBe(1);
    expect(pool.countOf(1)).toBe(149);
    // Equal priority cannot recycle.
    const full = new ParticlePool(10);
    fill(full, 10, 5);
    expect(full.alloc(5, 9)).toBe(-1);
    expect(full.alloc(4, 9)).toBe(-1);
    expect(full.alloc(6, 9)).toBeGreaterThanOrEqual(0);
  });

  it('frees finished particles on step and clears per effect', () => {
    const pool = new ParticlePool();
    const a = pool.alloc(1, 1);
    writeParticle(pool, a, { anim: 'dust_puff', life: 3 }, 1);
    const b = pool.alloc(1, 2);
    writeParticle(pool, b, { anim: 'dust_puff', life: 10, delay: 2 }, 1);
    stepParticles(pool);
    stepParticles(pool);
    expect(pool.liveCount).toBe(2);
    stepParticles(pool);
    expect(pool.liveCount).toBe(1);
    pool.clear(2);
    expect(pool.liveCount).toBe(0);
  });
});

describe('particle motion', () => {
  it('integrates ballistic motion at a fixed 1/30 s step (velocity, gravity, drag)', () => {
    const pool = new ParticlePool(4);
    const i = pool.alloc(1, 1);
    writeParticle(pool, i, { anim: 'coin_spin', x: 0, y: 0, vx: 30, vy: -60, ay: 90, drag: 0.9, life: 40 }, 1);
    for (let k = 0; k < 10; k++) stepParticles(pool);
    // Closed form of the semi-implicit Euler scheme.
    let x = 0;
    let y = 0;
    let vx = 30;
    let vy = -60;
    for (let k = 0; k < 10; k++) {
      vx = vx * 0.9;
      vy = (vy + 90 / 30) * 0.9;
      x += vx / 30;
      y += vy / 30;
    }
    expect(pool.x[i]).toBeCloseTo(x, 4);
    expect(pool.y[i]).toBeCloseTo(y, 4);
  });

  it('follows a Bézier path and rests at its end', () => {
    const pool = new ParticlePool(4);
    const i = pool.alloc(1, 1);
    writeParticle(pool, i, { anim: 'coin_spin', path: { x0: 0, y0: 0, cx: 50, cy: -50, x1: 100, y1: 0, frames: 10 }, life: 20 }, 1);
    const s = newSample();
    for (let k = 0; k < 12; k++) stepParticles(pool);
    expect(sampleParticle(pool, i, s)).toBe(true);
    expect(s.x).toBeCloseTo(100);
    expect(s.y).toBeCloseTo(0);
  });

  it('delayed particles are invisible; fit animations span the life; scale and alpha curves', () => {
    const pool = new ParticlePool(4);
    const i = pool.alloc(1, 1);
    writeParticle(pool, i, { anim: 'ring_shock', life: 12, delay: 2, fit: true, s: 0.5, s1: 1, fadeOut: 4 }, 2);
    const s = newSample();
    expect(sampleParticle(pool, i, s)).toBe(false);
    stepParticles(pool);
    stepParticles(pool);
    expect(sampleParticle(pool, i, s)).toBe(true);
    expect(s.frame).toBe(0);
    expect(s.sx).toBeCloseTo(1); // 0.5 × unit 2
    for (let k = 0; k < 11; k++) stepParticles(pool);
    expect(sampleParticle(pool, i, s)).toBe(true);
    expect(s.frame).toBe(5); // ring_shock has 6 frames
    expect(s.alpha).toBeLessThan(0.3);
  });

  it('hammer strikes (+20°) exactly on the contact frames', () => {
    for (const [first, gap, hits] of [
      [5, 4, 1],
      [4, 4, 2],
      [4, 4, 3],
      [4, 5, 3],
    ] as const) {
      for (let k = 0; k < hits; k++) expect(hammerAngle(first + k * gap, first, gap, hits)).toBe(20);
      expect(hammerAngle(first - 2, first, gap, hits)).toBeCloseTo(-35);
      if (hits > 1) expect(hammerAngle(first + 2, first, gap, hits)).toBeLessThan(0);
    }
  });
});
