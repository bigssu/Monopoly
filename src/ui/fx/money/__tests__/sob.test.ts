/**
 * The crying dealer's sob rhythm (sob.ts, docs/MONEY-EVENTS.md §14.5) and the baked sheet's numbers
 * (src/content/fx/sob-sheet.ts, written by scripts/dealer/bake-sob.py).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SOB, SOB_SHEET } from '@/content/fx/sob-sheet';
import { f } from '../clock';
import { BREATH_F, SOB_F, phaseAt, type Sob } from '../sob';

/** Phase per scene frame 0 … n − 1 (the clock steps whole frames at 1×; stretched it steps less). */
const run = (n: number, sobs: Sob[], start = 0): number[] => Array.from({ length: n }, (_, k) => phaseAt(f(k), start, sobs));
/** Lengths of runs of the same phase. */
const runs = (ps: number[]): number[] => ps.reduce<number[]>((a, p, k) => (k && p === ps[k - 1] ? (a[a.length - 1]!++, a) : [...a, 1]), []);

describe('sob sheet', () => {
  it('6 cells of 320 px; headDy per phase, measured by the bake (the head is rigid, it only moves)', () => {
    expect(SOB.cells).toBe(6);
    expect(SOB.cell).toBe(320);
    expect(SOB.headDy).toHaveLength(SOB.cells);
    // A breath: the head sinks (squash) and rises above the still (stretch), within ±5 % of the sprite.
    expect(Math.max(...SOB.headDy)).toBeGreaterThan(0);
    expect(Math.min(...SOB.headDy)).toBeLessThan(0);
    for (const d of SOB.headDy) expect(Math.abs(d) / SOB.cell).toBeLessThan(0.05);
    // The committed sheet is the 6-cell strip (RIFF WebP, VP8X canvas 1920 × 320 with alpha).
    const b = readFileSync(`public/${SOB_SHEET}`);
    expect(b.subarray(0, 4).toString()).toBe('RIFF');
    expect(b.subarray(12, 16).toString()).toBe('VP8X');
    expect(b[20]! & 0x10, 'alpha').toBeTruthy();
    expect(1 + b.readUIntLE(24, 3)).toBe(SOB.cells * SOB.cell);
    expect(1 + b.readUIntLE(27, 3)).toBe(SOB.cell);
  });
});

describe('sob rhythm (phaseAt)', () => {
  it('pure and deterministic: the same scene time gives the same phase', () => {
    const sobs = [{ at: 10, cycles: 2 }];
    expect(run(120, sobs)).toEqual(run(120, sobs));
    // Only whole frames count: anywhere inside a frame is that frame's phase.
    for (let k = 0; k < 90; k++) expect(phaseAt(f(k) + 20, 0, sobs)).toBe(phaseAt(f(k), 0, sobs));
  });

  it('a slow breath: one 6-phase cycle per 45 frames (≈ 1.5 s), every phase in order', () => {
    const ps = run(BREATH_F * 2, []);
    expect(BREATH_F).toBe(45);
    expect(ps.slice(0, BREATH_F)).toEqual(ps.slice(BREATH_F));
    expect([...new Set(ps)]).toEqual([0, 1, 2, 3, 4, 5]);
    for (const r of runs(ps)) expect(r).toBeGreaterThanOrEqual(7);
  });

  it('a sob: whole fast cycles (15 frames ≈ 0.5 s each), then the breath goes on where it left', () => {
    expect(SOB_F).toBe(15);
    const at = 10;
    const ps = run(at + 2 * SOB_F + 60, [{ at, cycles: 2 }]);
    const calm = run(at + 60, []);
    // Before: the breath. During: two fast cycles, every phase twice, 2–3 frames each.
    expect(ps.slice(0, at)).toEqual(calm.slice(0, at));
    const fast = ps.slice(at, at + 2 * SOB_F);
    for (const r of runs(fast)) expect(r).toBeLessThanOrEqual(3);
    expect(new Set(fast).size).toBe(6);
    expect(runs(fast).length).toBeGreaterThanOrEqual(12);
    // After: the breath resumes on the phase it left (no jump in or out).
    expect(ps.slice(at + 2 * SOB_F)).toEqual(calm.slice(at, at + 60));
    // Always forward, one cell per change (never a skip, never back).
    for (let k = 1; k < ps.length; k++) expect([0, 1]).toContain((ps[k]! - ps[k - 1]! + 6) % 6);
  });

  it('two sobs (the sniffle beats: 2 cycles, later 1) and a late start', () => {
    const sobs = [{ at: 12, cycles: 2 }, { at: 70, cycles: 1 }];
    const ps = run(160, sobs, 2);
    expect(ps[0]).toBe(0);
    const calm = run(200, [], 2);
    expect(ps.slice(70 + SOB_F)).toEqual(calm.slice(70 - 2 * SOB_F, 160 - 2 * SOB_F - SOB_F));
  });
});
