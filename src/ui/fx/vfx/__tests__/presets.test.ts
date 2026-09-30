import { describe, expect, it } from 'vitest';
import { FX_ANIM_NAMES } from '@/content/fx/manifest';
import { ANIM_INDEX } from '../particles';
import { buildPreset, PRESETS, type PresetName, type PresetParams } from '../presets';
import { Runner, TIER_CAP, type Timeline } from '../timeline';
import { COLORS, fakeEnv } from './helpers';

interface Run {
  tl: Timeline;
  requested: number;
  spawned: number;
  peak: number;
  cues: Record<string, number>;
  blockAt: number;
  frames: number;
  tints: Set<string>;
  anims: Set<string>;
  flashFrames: number;
}

/** Run a preset headless (big pool, no budget pressure) and collect counts / cue frames. */
function measure<N extends PresetName>(name: N, params: PresetParams<N>, seed = 1): Run {
  const tl = buildPreset(name, params, fakeEnv());
  const r = new Runner({}, 5000);
  r.log = [];
  const e = r.start(tl, { u: 30, seed });
  let blockAt = -1;
  void e.block.then(() => (blockAt = r.frame));
  const tints = new Set<string>();
  const anims = new Set<string>();
  let frames = 0;
  while (!r.idle && frames < 400) {
    r.advance(1);
    frames++;
    for (let i = 0; i < r.pool.cap; i++)
      if (r.pool.isAlive(i)) {
        tints.add(r.pool.tints[r.pool.tint[i]!]!);
        anims.add(FX_ANIM_NAMES[r.pool.anim[i]!]!);
      }
  }
  const cues: Record<string, number> = {};
  // FX frame of each cue = the effect frame at execution (hit-stops excluded).
  for (const o of tl.ops) if (o.a.k === 'cue') cues[o.a.name] = o.f;
  return { tl, requested: e.stats.requested, spawned: e.stats.spawned, peak: r.pool.peak, cues, blockAt, frames, tints, anims, flashFrames: e.stats.flashFrames };
}

describe('presets: spawn totals within tier caps (VFX.md §6.1, §7.2b)', () => {
  const cases: Array<[PresetName, unknown, number | null]> = [
    ['plotClaim', { space: 1, player: 0, price: 100 }, 14],
    ['plotClaim', { space: 19, player: 2, price: 420 }, 24],
    ['plotClaim', { space: 28, player: 1, price: 600 }, 34],
    ['plotClaim', { space: 31, player: 1, price: 1000 }, 44],
    ['buildSeq', { space: 6, player: 0, level: 1 }, 17],
    ['buildSeq', { space: 6, player: 0, level: 2 }, 33],
    ['buildSeq', { space: 6, player: 0, level: 3 }, 55 + 1], // + 1 flash glow
    ['buildSeq', { space: 4, player: 0, level: 4 }, 171 + 1],
    ['landmarkReveal', { space: 20, player: 2 }, 171 + 1],
    ['freeUpgrade', { space: 2, player: 0, level: 1 }, 21], // §7.2b.6 ≈19 + tier ring + chimney smoke
    ['freeUpgrade', { space: 2, player: 0, level: 2 }, null],
    ['freeUpgrade', { space: 2, player: 0, level: 3 }, null],
    ['freeUpgrade', { space: 2, player: 0, level: 4 }, null],
    ['takeoverStamp', { space: 22, buyer: 0, seller: 2 }, null],
    ['groupChain', { spaces: [19, 20, 22], player: 2, color: '#E8564F' }, 77 + 1],
    ['groupChain', { spaces: [25, 26, 28, 30], player: 1, color: '#F2C94C' }, null],
    ['groupFinale', { spaces: [9, 10, 12], player: 3, color: '#F28AB2' }, null],
    ['landmarkReveal', { space: 31, player: 1, group: { spaces: [30, 31], color: '#4A6CF7' } }, null],
    ['tollPay', { payer: 0, receiver: 1, amount: 150 }, 13],
    ['tollPay', { payer: 0, receiver: 1, amount: 600 }, null],
    ['tollPay', { payer: 0, receiver: 1, amount: 1500 }, null],
    ['tollPay', { payer: 0, receiver: 1, amount: 3000 }, null],
    ['tollPay', { payer: 0, receiver: 1, amount: 400, festival: true, space: 16 }, null],
    ['tollPay', { payer: 0, receiver: 1, amount: 400, multiplier: 2 }, null],
    ['tollPay', { payer: 0, receiver: 1, amount: 400, waived: true, space: 10 }, null],
    ['passStart', { player: 0 }, null],
    ['passStart', { player: 1, landed: true }, null],
    ['cardReveal', { tone: 'good' }, null],
    ['islandSiren', { space: 8, player: 0, cause: 'doubles' }, null],
    ['festivalBurst', { space: 20, player: 2, previous: 12 }, null],
    ['bankruptcy', { player: 1 }, null],
    ['victory', { winner: 0, kind: 'hubs', spaces: [5, 13, 21, 29] }, null],
    ['victory', { winner: 0, kind: 'triple', spaces: [2, 15, 20], colors: ['#A0715B', '#F5A25D', '#E8564F'] }, null],
    ['victory', { winner: 2, kind: 'line', spaces: [25, 26, 27, 28, 29, 30, 31] }, null],
    ['victory', { winner: 3, kind: 'bankruptcy' }, null],
    ['oneAway', { space: 4, player: 0 }, 11],
    ['doublesFlash', {}, null],
    ['doublesFlash', { triple: true }, null],
    ['diceLand', {}, 6],
    ['hopDust', { space: 3, long: true }, 3],
    ['tap', { x: 500, y: 500, player: 0 }, 5],
    ['coinIn', { from: { panel: 3 }, to: { space: 11 }, n: 6 }, 7],
    ['frameSwap', { space: 15, from: 3, to: 1 }, 11],
  ];
  for (const [name, params, expected] of cases) {
    it(`${name} ${JSON.stringify(params)}`, () => {
      const m = measure(name, params as PresetParams<typeof name>);
      const cap = TIER_CAP[m.tl.tier];
      expect(m.requested).toBeLessThanOrEqual(cap);
      expect(m.spawned).toBe(m.requested);
      if (expected !== null) expect(m.requested).toBe(expected);
      expect(m.peak).toBeLessThanOrEqual(300);
      // Every effect finishes (no endless loops): ≤ 4 s + tail.
      expect(m.frames).toBeLessThan(m.tl.tier === 4 ? 140 : 90);
      for (const a of m.anims) expect(ANIM_INDEX[a as keyof typeof ANIM_INDEX]).toBeGreaterThanOrEqual(0);
      expect(m.tl.bounds.width).toBeGreaterThan(0);
    });
  }

  it('every registered preset is covered', () => {
    const covered = new Set(cases.map((c) => c[0]));
    expect([...Object.keys(PRESETS)].filter((k) => !covered.has(k as PresetName))).toEqual([]);
  });
});

describe('presets: beats and cues (VFX.md §7.2b)', () => {
  it('build swap cue precedes (or equals) the block frame; landmark swap f17 / block f24 / stamp f22', () => {
    for (const level of [1, 2, 3, 4] as const) {
      const m = measure('buildSeq', { space: 6, player: 0, level });
      expect(m.cues.swap).toBeDefined();
      expect(m.cues.swap!).toBeLessThanOrEqual(m.tl.block);
    }
    const lm = measure('landmarkReveal', { space: 4, player: 0 });
    expect(lm.cues).toMatchObject({ swap: 17, stamp: 22 });
    expect(lm.tl.block).toBe(24);
    expect(lm.flashFrames).toBe(2);
    expect(measure('buildSeq', { space: 6, player: 0, level: 3 }).flashFrames).toBe(1);
    expect(measure('buildSeq', { space: 6, player: 0, level: 1 }).cues.swap).toBe(6);
    expect(measure('buildSeq', { space: 6, player: 0, level: 2 }).cues.swap).toBe(9);
    expect(measure('buildSeq', { space: 6, player: 0, level: 3 }).cues.swap).toBe(13);
  });

  it('hammer hits = level (L4: 3 + crown)', () => {
    for (const level of [1, 2, 3] as const) {
      const tl = buildPreset('buildSeq', { space: 6, player: 0, level }, fakeEnv());
      expect(tl.ops.filter((o) => o.a.k === 'sfx' && o.a.name === 'build').length).toBe(level);
    }
    const tl = buildPreset('landmarkReveal', { space: 6, player: 0 }, fakeEnv());
    expect(tl.ops.filter((o) => o.a.k === 'sfx' && o.a.name === 'build').length).toBe(4); // 3 hits + the impact thud
  });

  it('takeover: frame cue f18, stamp f16, block f21; purchase: frame cue at the block f10', () => {
    const m = measure('takeoverStamp', { space: 22, buyer: 0, seller: 2 });
    expect(m.cues).toMatchObject({ frame: 18, stamp: 16 });
    expect(m.tl.block).toBe(21);
    const p = measure('plotClaim', { space: 1, player: 0, price: 100 });
    expect(p.cues.frame).toBe(10);
    expect(p.tl.block).toBe(10);
  });

  it('group chain n=3: impact f12, badge f14, block f24', () => {
    const m = measure('groupChain', { spaces: [19, 20, 22], player: 2, color: '#E8564F' });
    expect(m.cues).toMatchObject({ badge: 14, stamp: 18 });
    expect(m.tl.block).toBe(24);
  });

  it("keeps the acting player's colour", () => {
    expect(measure('buildSeq', { space: 6, player: 1, level: 3 }).tints.has(COLORS[1]!)).toBe(true);
    expect(measure('plotClaim', { space: 6, player: 2, price: 300 }).tints.has(COLORS[2]!)).toBe(true);
    const t = measure('takeoverStamp', { space: 22, buyer: 0, seller: 2 });
    expect(t.tints.has(COLORS[0]!) && t.tints.has(COLORS[2]!)).toBe(true);
  });

  it('is deterministic for a seed', () => {
    const a = measure('landmarkReveal', { space: 4, player: 0 }, 9);
    const b = measure('landmarkReveal', { space: 4, player: 0 }, 9);
    expect([...a.tints]).toEqual([...b.tints]);
    const pos = (seed: number): string => {
      const r = new Runner();
      r.start(buildPreset('victory', { winner: 0, kind: 'roundLimit' }, fakeEnv()), { u: 30, seed });
      r.advance(20);
      return Array.from(r.pool.x).map((v) => v.toFixed(2)).join();
    };
    expect(pos(5)).toBe(pos(5));
  });

  it('under budget pressure the landmark still fits the 300 pool (budgeter trims)', () => {
    const r = new Runner();
    const env = fakeEnv();
    r.start(buildPreset('victory', { winner: 0, kind: 'hubs', spaces: [5, 13, 21, 29] }, env), { u: 30 });
    r.start(buildPreset('landmarkReveal', { space: 31, player: 1, group: { spaces: [30, 31], color: '#4A6CF7' } }, env), { u: 30 });
    r.start(buildPreset('tollPay', { payer: 3, receiver: 2, amount: 3200 }, env), { u: 30 });
    let peak = 0;
    for (let i = 0; i < 200 && !r.idle; i++) {
      r.advance(1);
      peak = Math.max(peak, r.pool.liveCount);
    }
    expect(peak).toBeLessThanOrEqual(300);
  });
});
