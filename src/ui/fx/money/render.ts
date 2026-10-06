/**
 * Adaptive render resolution for the money stage (docs/MONEY-EVENTS.md §12, docs/PERFORMANCE.md).
 *
 * A compositor layer costs w × h × DPR² × 4 bytes, so the same cut-in costs 4× more GPU memory on a
 * 2560×1600 DPR 2 tablet than on a 1280×800 DPR 2 one. The stage therefore renders its layers at a
 * render scale s (laid out at s × size inside a `will-change: transform` container scaled by 1/s:
 * Chromium rasterizes that layer at its layout size × DPR — measured, §12.2), which costs s² of the
 * memory. Pixelation is accepted (product owner). Each tier also has its own layer-memory budget:
 * big devices have bigger GPU budgets.
 *
 * | tier | render scale | 3D tilt + board camera | peak layer memory budget |
 * |------|--------------|------------------------|--------------------------|
 * | high | 1.0          | on                     | 250 MB                   |
 * | mid  | 0.75         | tilt if P ≤ 4.1 M (§12.3), no camera | 150 MB     |
 * | low  | 0.5          | off (2D)               | 100 MB                   |
 *
 * Auto tier (`pickTier`), from `navigator.deviceMemory` (GB, Chrome rounds it to 0.25 … 8; 8 means
 * "8 or more"; missing → assumed 4) and the device pixels P = innerWidth × innerHeight × DPR²:
 * - high: deviceMemory ≥ 8, DPR ≥ 2 (budget screens are DPR < 2) and P ≤ 7.0 M
 *   (1600×1000 DPR 2 = 6.4 M; 1280×800 DPR 2 = 4.1 M)
 * - mid:  deviceMemory ≥ 4 and P ≤ 7.0 M, or deviceMemory ≥ 8 and P ≤ 17 M (2560×1600 DPR 2 = 16.4 M)
 * - low:  everything else (deviceMemory ≤ 2, or a huge screen on a 4 GB device)
 *
 * Runtime safety net (`MoneyHealth`): every cut-in's frames are measured on the 30 Hz clock (JS per
 * scene step, gap between steps). Two bad cut-ins in a row step the stage one tier down for the rest
 * of the session; four healthy ones step it back up (never above the auto tier). Only in 'auto'.
 */

export type MoneyTier = 'high' | 'mid' | 'low';
export const MONEY_TIERS: readonly MoneyTier[] = ['high', 'mid', 'low'];

export const TIER_SCALE: Record<MoneyTier, number> = { high: 1, mid: 0.75, low: 0.5 };
/** Peak layer memory a cut-in may reach on this tier (MB; scripts/perf.mjs gates on it). */
export const TIER_BUDGET_MB: Record<MoneyTier, number> = { high: 250, mid: 150, low: 100 };
/**
 * 3D tilt (hero rotateX) + board camera per tier. Mid: only on screens up to P_MID_3D device pixels —
 * measured (4×, CPU demo game, §12.3): 1280×800 DPR 1.5 53.8 MB, but 1600×1000 DPR 2 149.2 MB (0.8 MB
 * under the 150 MB budget, 21 layers) and 2560×1600 DPR 2 377.7 MB.
 */
export const P_MID_3D = 4.1e6;
export function tier3d(tier: MoneyTier, pixels: number): boolean {
  return tier === 'high' || (tier === 'mid' && pixels <= P_MID_3D);
}

/** Device-pixel limits of the tier table (P = w × h × DPR²). */
export const P_HIGH = 7.0e6;
export const P_MID_BIG = 17e6;

export interface DeviceInfo {
  w: number;
  h: number;
  dpr: number;
  /** navigator.deviceMemory (GB) when the browser reports it. */
  deviceMemory?: number | null;
}

export function devicePixels(d: DeviceInfo): number {
  return Math.round(d.w * d.h * d.dpr * d.dpr);
}

export function pickTier(d: DeviceInfo): MoneyTier {
  const mem = d.deviceMemory && d.deviceMemory > 0 ? d.deviceMemory : 4;
  const p = devicePixels(d);
  if (mem >= 8 && d.dpr >= 2 && p <= P_HIGH) return 'high';
  if ((mem >= 4 && p <= P_HIGH) || (mem >= 8 && p <= P_MID_BIG)) return 'mid';
  return 'low';
}

/** The current browser's device (window size, DPR, deviceMemory). */
export function currentDevice(): DeviceInfo {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : null;
  return {
    w: typeof innerWidth === 'number' ? innerWidth : 1600,
    h: typeof innerHeight === 'number' ? innerHeight : 1000,
    dpr: typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1,
    deviceMemory: nav?.deviceMemory ?? null,
  };
}

export const lowerTier = (t: MoneyTier): MoneyTier => (t === 'high' ? 'mid' : 'low');
const rank = (t: MoneyTier): number => MONEY_TIERS.indexOf(t);

/** Settings → 연출 해상도 / 3D 연출. */
export type MoneyResPref = 'auto' | 'high' | 'low';
export type Money3dPref = 'auto' | 'on' | 'off';

export interface MoneyRender {
  tier: MoneyTier;
  /** Render scale of the stage's layers (1 = device resolution). */
  scale: number;
  /** Hero tilts back in 3D. */
  tilt: boolean;
  /** The board pulls back (and tilts with `tilt`) under the cut-in. */
  camera: boolean;
  budgetMB: number;
  /** Why: 'auto', 'setting', 'dev', or the safety net's step. */
  source: string;
}

/**
 * What the stage renders with: the auto tier (lowered by the safety net), unless a setting or a dev
 * override picks one. The 3D setting overrides the tier's default.
 */
export function resolveRender(o: { auto: MoneyTier; pixels?: number; stepDown?: number; res?: MoneyResPref; fx3d?: Money3dPref; dev?: MoneyTier | null }): MoneyRender {
  let tier: MoneyTier;
  let source: string;
  if (o.dev) {
    tier = o.dev;
    source = 'dev';
  } else if (o.res === 'high' || o.res === 'low') {
    tier = o.res;
    source = 'setting';
  } else {
    tier = o.auto;
    for (let k = 0; k < (o.stepDown ?? 0); k++) tier = lowerTier(tier);
    source = o.stepDown ? `auto −${o.stepDown}` : 'auto';
  }
  const tilt = o.fx3d === 'on' ? true : o.fx3d === 'off' ? false : tier3d(tier, o.pixels ?? 0);
  // Mid keeps the hero tilt but not the board camera: the tilted board under a 3D cut-in added the
  // overlap layer that made 21 at the cut-in's first frame (gate ≤ 20, docs/PERFORMANCE.md "라운드 2").
  const camera = tilt && tier !== 'mid';
  return { tier, scale: TIER_SCALE[tier], tilt, camera, budgetMB: TIER_BUDGET_MB[tier], source };
}

// ------------------------------------------------------------------------------------ safety net

export interface HealthOptions {
  /** p95 of the scene clock's JS per step above this → a bad cut-in (ms). */
  stepMs: number;
  /** A step later than this after the previous one is late (30 Hz = 33.3 ms) … */
  gapMs: number;
  /** … and more than this share of late steps makes the cut-in bad. */
  lateShare: number;
  /** Bad cut-ins in a row before stepping down. */
  downScenes: number;
  /** Healthy cut-ins in a row before stepping back up. */
  upScenes: number;
  /** Fewer samples than this: the cut-in is not judged (skipped, paused, too short). */
  minSamples: number;
}

export const HEALTH_DEFAULTS: HealthOptions = { stepMs: 8, gapMs: 50, lateShare: 0.25, downScenes: 2, upScenes: 4, minSamples: 15 };

/**
 * Per-cut-in frame health (the AdaptiveQuality idea of fx/vfx/director.ts, judged per cut-in).
 * `stepDown` is how many tiers below the auto tier the stage renders (0 … 2).
 */
export class MoneyHealth {
  stepDown = 0;
  private steps: number[] = [];
  private gaps: number[] = [];
  private bad = 0;
  private good = 0;
  /** Last verdicts (dev): 'ok' / 'bad' / 'skip'. */
  readonly history: string[] = [];

  constructor(readonly o: HealthOptions = HEALTH_DEFAULTS) {}

  /** A cut-in starts. */
  begin(): void {
    this.steps = [];
    this.gaps = [];
  }

  /** One scene-clock step: its JS cost and the real time since the previous step (ms). */
  sample(stepMs: number, gapMs: number): void {
    this.steps.push(stepMs);
    this.gaps.push(gapMs);
  }

  /**
   * A cut-in ended. `maxDown`: how far below the auto tier the stage can go (low = 0 steps left).
   * Returns the change (+1 = one tier down, −1 = one tier up) with its reason, or null.
   */
  end(maxDown: number): { change: 1 | -1; reason: string } | null {
    const n = this.steps.length;
    if (n < this.o.minSamples) {
      this.history.push('skip');
      return null;
    }
    const p95 = [...this.steps].sort((a, b) => a - b)[Math.floor(n * 0.95)]!;
    const late = this.gaps.filter((g) => g > this.o.gapMs).length;
    const isBad = p95 > this.o.stepMs || late > this.o.lateShare * n;
    this.history.push(isBad ? 'bad' : 'ok');
    if (this.history.length > 20) this.history.shift();
    if (isBad) {
      this.good = 0;
      if (++this.bad < this.o.downScenes || this.stepDown >= maxDown) return null;
      this.bad = 0;
      this.stepDown++;
      return { change: 1, reason: `${this.o.downScenes} cut-ins with bad frames: step p95 ${p95.toFixed(1)} ms, ${late}/${n} steps late` };
    }
    this.bad = 0;
    if (this.stepDown > 0 && ++this.good >= this.o.upScenes) {
      this.good = 0;
      this.stepDown--;
      return { change: -1, reason: `${this.o.upScenes} healthy cut-ins` };
    }
    return null;
  }
}

/** How many tiers below `t` the stage can still step (low: 0). */
export function stepsBelow(t: MoneyTier): number {
  return MONEY_TIERS.length - 1 - rank(t);
}
