/**
 * How the dealer's body moves when a line starts (docs/research/12-dealer-acting.md): one short
 * "take" per expression, built on the twelve principles — anticipation (a dip against the motion),
 * squash and stretch (scaleX × scaleY ≈ 1, volume kept), arcs (rise + lean together), slow in /
 * slow out (an easing per keyframe), follow-through (an overshoot past rest, then settle),
 * timing (sorrow slow, nerves quick) and exaggeration (bigger for bigger moments: `priority`).
 *
 * Transform only, on the dealer's own layer (`.dealer-body`, origin at the feet): compositor work,
 * the stage under it never repaints. Every take ends at rest (`none`).
 */
import { EASE } from '@/ui/fx/motion';
import type { DealerExpr } from './lines';

/** [time 0..1, x %, y %, rotate deg, scaleX, scaleY, easing into the next key]. */
type Key = readonly [number, number, number, number, number, number, string?];

const OUT = EASE.settle;
const IN = 'cubic-bezier(.55,0,1,.45)';
const IO = EASE.inOut;

/** Base takes at exaggeration 1 (an `event` line). */
const TAKES: Record<DealerExpr, { ms: number; keys: readonly Key[] }> = {
  // A hop: crouch, spring up stretched on an arc, land squashed, settle.
  cheer: { ms: 620, keys: [[0, 0, 0, 0, 1, 1, OUT], [0.18, 0, 0, 0, 1.08, 0.9, IN], [0.45, 0, -14, -3, 0.94, 1.08, IN], [0.68, 0, 0, 0, 1.1, 0.9, OUT], [0.84, 0, 0, 1, 0.97, 1.03, IO], [1, 0, 0, 0, 1, 1]] },
  // The classic "take": a small dip, then shoot up tall and lean back, hold, settle.
  surprised: { ms: 600, keys: [[0, 0, 0, 0, 1, 1, OUT], [0.15, 0, 2, 0, 1.06, 0.93, IN], [0.32, -2, -6, -5, 0.92, 1.1, OUT], [0.7, -2, -5, -4, 0.95, 1.06, IO], [1, 0, 0, 0, 1, 1]] },
  // Belly laugh: two bounces that shrink (follow-through), a little side to side.
  laugh: { ms: 640, keys: [[0, 0, 0, 0, 1, 1, OUT], [0.2, 0, -5, -3, 0.96, 1.05, IN], [0.38, 0, 0, 0, 1.06, 0.94, OUT], [0.58, 0, -3, 3, 0.98, 1.03, IN], [0.76, 0, 0, 0, 1.03, 0.97, OUT], [1, 0, 0, 0, 1, 1]] },
  // Sorrow: slow in, sink and slump to one side, slow out.
  sad: { ms: 900, keys: [[0, 0, 0, 0, 1, 1, IO], [0.55, 0, 3, -3, 1.04, 0.95, IO], [0.8, 0, 2.5, -2.5, 1.03, 0.96, IO], [1, 0, 0, 0, 1, 1]] },
  // Nerves: a quick shiver that dies away.
  nervous: { ms: 520, keys: [[0, 0, 0, 0, 1, 1, OUT], [0.12, 0, 1, 0, 1.03, 0.97, OUT], [0.24, -1.5, 1, -2.5, 1.03, 0.97, OUT], [0.38, 1.5, 1, 2.5, 1.03, 0.97, OUT], [0.52, -1, 0.5, -1.5, 1.01, 0.99, OUT], [0.68, 0.5, 0, 1, 1, 1, OUT], [1, 0, 0, 0, 1, 1]] },
  // Pondering: lean back a touch, then a slow tilt (slow in, slow out).
  thinking: { ms: 820, keys: [[0, 0, 0, 0, 1, 1, OUT], [0.2, 1, 0, 2, 1, 1, IO], [0.7, -1, -1, -4, 0.99, 1.01, IO], [1, 0, 0, 0, 1, 1]] },
  // Pointing at the bubble: wind back, then lean in toward it with an overshoot.
  point: { ms: 560, keys: [[0, 0, 0, 0, 1, 1, OUT], [0.2, -2, 0, -3, 1.02, 0.98, IN], [0.48, 3, -2, 5, 0.97, 1.03, OUT], [0.75, 1.5, -1, 2, 0.99, 1.01, IO], [1, 0, 0, 0, 1, 1]] },
  // Presenting: a small bow down, then open up and rise.
  present: { ms: 640, keys: [[0, 0, 0, 0, 1, 1, OUT], [0.25, 0, 2, 2, 1.04, 0.96, IO], [0.6, 0, -3, -1, 0.97, 1.04, OUT], [1, 0, 0, 0, 1, 1]] },
  // Shaking the dice: crouch, then two quick wobbles.
  dice: { ms: 600, keys: [[0, 0, 0, 0, 1, 1, OUT], [0.15, 0, 2, 0, 1.05, 0.95, OUT], [0.32, 1, -2, 5, 0.98, 1.02, IO], [0.5, -1, -2, -5, 0.98, 1.02, IO], [0.68, 0.5, -1, 3, 0.99, 1.01, IO], [1, 0, 0, 0, 1, 1]] },
  // The cup held up: a deep crouch, a big stretched rise, a long hold, a soft landing.
  trophy: { ms: 900, keys: [[0, 0, 0, 0, 1, 1, OUT], [0.16, 0, 3, 0, 1.1, 0.88, IN], [0.4, 0, -12, 0, 0.92, 1.1, OUT], [0.72, 0, -10, 0, 0.95, 1.06, IN], [0.86, 0, 0, 0, 1.05, 0.95, OUT], [1, 0, 0, 0, 1, 1]] },
  // Settling in: a small breath.
  idle: { ms: 520, keys: [[0, 0, 0, 0, 1, 1, IO], [0.5, 0, -1, 0, 0.99, 1.02, IO], [1, 0, 0, 0, 1, 1]] },
};

/** Exaggeration by line priority (lines.ts P): quips barely move, endings move most. */
const SIZE: Record<number, number> = { 1: 0.45, 2: 0.65, 3: 0.75, 4: 1, 5: 1.25, 6: 1.4 };

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** The take for `expr` at line `priority`: Web Animation keyframes and its length (ms). */
export function bodyTake(expr: DealerExpr, priority: number): { keyframes: Keyframe[]; ms: number } {
  const t = TAKES[expr];
  const k = SIZE[priority] ?? 1;
  const keyframes: Keyframe[] = t.keys.map(([offset, x, y, rot, sx, sy, easing], i) => {
    const last = i === t.keys.length - 1;
    const transform = last ? 'none' : `translate(${r2(x * k)}%, ${r2(y * k)}%) rotate(${r2(rot * k)}deg) scale(${r2(1 + (sx - 1) * k)}, ${r2(1 + (sy - 1) * k)})`;
    return easing ? { offset, transform, easing } : { offset, transform };
  });
  // Bigger moments also take a little longer (timing follows weight).
  return { keyframes, ms: Math.round(t.ms * (0.85 + 0.15 * k)) };
}
