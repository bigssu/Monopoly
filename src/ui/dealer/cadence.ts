/**
 * Which sprite the dealer shows while a voiced line plays (Dealer.lipSync): lip sync from the voice
 * itself (docs/research/12-dealer-acting.md). The decoded line is cut into 1/30 s frames; each
 * frame's loudness picks the mouth — talk-a (wide open), talk-b (a small "o"), or shut. Before
 * (until 2026-10), the mouth flapped every 120 ms whatever was said, and started 350 ms after
 * the voice.
 *
 * Pose to pose: the line's expression comes back only on a pause in the speech (a breath between
 * phrases, POSE_FRAMES or longer); a short gap between words just closes the mouth (idle: mouth
 * shut, arms down). Owner review (2026-10-06): "every time the dealer speaks it throws its arms
 * up over and over — too distracting", so an arms-up expression never shows more often than
 * the old cap of 1.39 per second.
 */
import type { DealerExpr } from './lines';

/** Mouth frames per second (the app's frame clock runs at 30 Hz or a multiple). */
export const MOUTH_HZ = 30;

/**
 * Expressions whose sprite raises a hand to the face or above (public/dealer/*.webp, looked at):
 * cheer (both fists up), surprised (both hands on the cheeks), sad (a hand on the head), thinking
 * (a hand on the chin), point (an arm out at face height), dice (a die held up), trophy (the cup held
 * up). Arms down or at the chest: idle, nervous (fists at the chest), laugh (a hand on the belly),
 * present (hands out at the waist).
 */
export const ARMS_UP: ReadonlySet<DealerExpr> = new Set<DealerExpr>(['cheer', 'surprised', 'sad', 'thinking', 'point', 'dice', 'trophy']);

/** A pause this long (frames, ≈ 270 ms) is a breath between phrases: the expression shows. */
export const POSE_FRAMES = 8;
/** Arms-up poses at most this often (per second), the owner's cap. */
export const ARMS_UP_MAX_PER_S = 1.39;

/**
 * Mouth openness per frame of a decoded voice: 0 shut, 1 half, 2 open. Loudness is relative to
 * the line's own loud frames (its 90th percentile), so a whisper still moves the mouth. The mouth
 * leads the sound by one frame (it shapes before the sound comes out), and a one-frame gap
 * inside a word stays half open instead of snapping shut.
 */
export function mouthLevels(samples: Float32Array, sampleRate: number): Uint8Array {
  const win = Math.max(1, Math.round(sampleRate / MOUTH_HZ));
  const n = Math.ceil(samples.length / win);
  const rms = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const end = Math.min(samples.length, (i + 1) * win);
    for (let j = i * win; j < end; j++) sum += samples[j]! * samples[j]!;
    rms[i] = Math.sqrt(sum / Math.max(1, end - i * win));
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const ref = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  const out = new Uint8Array(n);
  if (!(ref > 1e-4)) return out;
  for (let i = 0; i < n; i++) {
    const v = rms[Math.min(n - 1, i + 1)]! / ref; // one frame of lead
    out[i] = v > 0.55 ? 2 : v > 0.18 ? 1 : 0;
  }
  for (let i = 1; i < n - 1; i++) if (out[i] === 0 && out[i - 1]! > 0 && out[i + 1]! > 0) out[i] = 1;
  return out;
}

/** The sprite for every mouth frame of a line spoken with `expr`. */
export function lipTrack(levels: ArrayLike<number>, expr: DealerExpr): string[] {
  const track: string[] = [];
  const minGap = Math.ceil(MOUTH_HZ / ARMS_UP_MAX_PER_S);
  let lastPose = -Infinity;
  for (let i = 0; i < levels.length; ) {
    if (levels[i]! > 0) {
      track.push(levels[i] === 2 ? 'talk-a' : 'talk-b');
      i++;
      continue;
    }
    let j = i;
    while (j < levels.length && levels[j] === 0) j++;
    const run = j - i;
    // A breath between phrases holds the pose (arms-up ones no more often than the cap).
    const pose = run >= POSE_FRAMES && (!ARMS_UP.has(expr) || i - lastPose >= minGap);
    if (pose) lastPose = i;
    for (let k = i; k < j; k++) track.push(pose ? expr : 'idle');
    i = j;
  }
  return track;
}
