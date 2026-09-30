/**
 * Fixed-size particle store (struct of typed arrays, VFX.md §3.7): 300 slots allocated once, no
 * per-frame allocation. The budgeter decides how many of a requested batch may spawn and, when the
 * pool is full, recycles the oldest particle of the lowest priority below the requester's.
 */
export const POOL_CAP = 300;

/** Particle flag bits. */
export const PF = {
  Alive: 1,
  Loop: 2,
  /** Play the animation's frames exactly once over the particle's life. */
  Fit: 4,
  /** Position on a quadratic Bézier path (x0,y0)→(cx,cy)→(x1,y1) instead of ballistic motion. */
  Path: 8,
  /** Rotate along the direction of motion. */
  Align: 16,
  /** Hammer swing behaviour (params hp0..hp2). */
  Hammer: 32,
} as const;

/** Effect priorities (high → low), VFX.md §3.7. */
export const PRIORITY = {
  victory: 12,
  bankrupt: 11,
  landmark: 10,
  takeover: 9,
  monopoly: 8,
  toll: 7,
  start: 6,
  festival: 5,
  buy: 4,
  build: 3,
  card: 2,
  island: 1,
  misc: 0,
} as const;

export class ParticlePool {
  readonly cap: number;
  // Motion
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly ax: Float32Array;
  readonly ay: Float32Array;
  readonly drag: Float32Array;
  // Bézier path
  readonly x0: Float32Array;
  readonly y0: Float32Array;
  readonly cx: Float32Array;
  readonly cy: Float32Array;
  readonly x1: Float32Array;
  readonly y1: Float32Array;
  readonly pe: Uint8Array;
  /** Path duration in frames (≤ life; the particle rests at the end afterwards). */
  readonly pl: Float32Array;
  // Rotation / flip
  readonly rot: Float32Array;
  readonly vrot: Float32Array;
  readonly swA: Float32Array;
  readonly swF: Float32Array;
  readonly flip: Float32Array;
  readonly vflip: Float32Array;
  // Scale curve: s0 → s1 (ease se1, until fraction sT) → s2 (ease se2)
  readonly s0: Float32Array;
  readonly s1: Float32Array;
  readonly s2: Float32Array;
  readonly sT: Float32Array;
  readonly se1: Uint8Array;
  readonly se2: Uint8Array;
  readonly sc1: Float32Array;
  /** Non-uniform scale (e.g. streaks), multiplies x only. */
  readonly sxK: Float32Array;
  // Squash at age sqAt: (sqX, sqY) for 2 f, then popBack to (1, 1) in 5 f.
  readonly sqAt: Float32Array;
  readonly sqX: Float32Array;
  readonly sqY: Float32Array;
  // Alpha
  readonly amax: Float32Array;
  readonly fin: Float32Array;
  readonly fout: Float32Array;
  // Time
  /** Age in frames (negative while delayed). */
  readonly age: Float32Array;
  readonly life: Float32Array;
  // Sprite
  readonly anim: Uint8Array;
  readonly frame0: Float32Array;
  readonly fps: Float32Array;
  readonly anchorX: Float32Array;
  readonly anchorY: Float32Array;
  readonly tint: Uint16Array;
  readonly blend: Uint8Array;
  readonly layer: Uint8Array;
  readonly flags: Uint8Array;
  // Behaviour params
  readonly hp0: Float32Array;
  readonly hp1: Float32Array;
  readonly hp2: Float32Array;
  // Bookkeeping
  readonly prio: Uint8Array;
  readonly effect: Int32Array;
  readonly serial: Float64Array;

  private live = 0;
  private nextSerial = 1;
  /** Highest live count seen since the last `resetStats()`. */
  peak = 0;
  /** Particles refused by the budgeter (requested − granted). */
  dropped = 0;
  /** Particles recycled for a higher-priority effect. */
  reclaimed = 0;
  /** Particles spawned since the last `resetStats()`. */
  spawned = 0;

  /** Tint colours (index 0 = no tint). */
  private readonly tintIds = new Map<string, number>();
  readonly tints: string[] = [''];

  constructor(cap = POOL_CAP) {
    this.cap = cap;
    const f = (): Float32Array => new Float32Array(cap);
    const b = (): Uint8Array => new Uint8Array(cap);
    this.x = f();
    this.y = f();
    this.vx = f();
    this.vy = f();
    this.ax = f();
    this.ay = f();
    this.drag = f();
    this.x0 = f();
    this.y0 = f();
    this.cx = f();
    this.cy = f();
    this.x1 = f();
    this.y1 = f();
    this.pe = b();
    this.pl = f();
    this.rot = f();
    this.vrot = f();
    this.swA = f();
    this.swF = f();
    this.flip = f();
    this.vflip = f();
    this.s0 = f();
    this.s1 = f();
    this.s2 = f();
    this.sT = f();
    this.se1 = b();
    this.se2 = b();
    this.sc1 = f();
    this.sxK = f();
    this.sqAt = f();
    this.sqX = f();
    this.sqY = f();
    this.amax = f();
    this.fin = f();
    this.fout = f();
    this.age = f();
    this.life = f();
    this.anim = b();
    this.frame0 = f();
    this.fps = f();
    this.anchorX = f();
    this.anchorY = f();
    this.tint = new Uint16Array(cap);
    this.blend = b();
    this.layer = b();
    this.flags = b();
    this.hp0 = f();
    this.hp1 = f();
    this.hp2 = f();
    this.prio = b();
    this.effect = new Int32Array(cap);
    this.serial = new Float64Array(cap);
  }

  get liveCount(): number {
    return this.live;
  }

  isAlive(i: number): boolean {
    return (this.flags[i]! & PF.Alive) !== 0;
  }

  /** Index of a tint colour (registered on first use). */
  tintId(color: string | undefined): number {
    if (!color) return 0;
    let id = this.tintIds.get(color);
    if (id === undefined) {
      id = this.tints.length;
      this.tints.push(color);
      this.tintIds.set(color, id);
    }
    return id;
  }

  /** Number of live particles strictly below `priority` (recyclable for it). */
  private recyclable(priority: number): number {
    let n = 0;
    for (let i = 0; i < this.cap; i++) if (this.flags[i]! & PF.Alive && this.prio[i]! < priority) n++;
    return n;
  }

  /**
   * How many of `n` requested particles may spawn at `priority` (VFX.md §3.7): all of them when
   * there is room; otherwise max(ceil(n × 0.25), free slots), limited to free slots + particles of a
   * lower priority (which `alloc` will recycle).
   */
  request(n: number, priority: number): number {
    if (n <= 0) return 0;
    const free = this.cap - this.live;
    if (n <= free) return n;
    const want = Math.max(Math.ceil(n * 0.25), free);
    const got = Math.min(want, free + (want > free ? this.recyclable(priority) : 0));
    this.dropped += n - got;
    return got;
  }

  /** A free slot for one particle, recycling the oldest lowest-priority one below `priority`; −1 if none. */
  alloc(priority: number, effect: number): number {
    let slot = -1;
    if (this.live < this.cap) {
      for (let i = 0; i < this.cap; i++)
        if (!(this.flags[i]! & PF.Alive)) {
          slot = i;
          break;
        }
    } else {
      let bestP = priority;
      let bestS = Infinity;
      for (let i = 0; i < this.cap; i++) {
        const p = this.prio[i]!;
        if (p < bestP || (p === bestP && slot >= 0 && p < priority && this.serial[i]! < bestS)) {
          bestP = p;
          bestS = this.serial[i]!;
          slot = i;
        }
      }
      if (slot < 0) {
        this.dropped++;
        return -1;
      }
      this.flags[slot] = 0;
      this.live--;
      this.reclaimed++;
    }
    this.reset(slot);
    this.flags[slot] = PF.Alive;
    this.prio[slot] = priority;
    this.effect[slot] = effect;
    this.serial[slot] = this.nextSerial++;
    this.live++;
    this.spawned++;
    if (this.live > this.peak) this.peak = this.live;
    return slot;
  }

  free(i: number): void {
    if (!(this.flags[i]! & PF.Alive)) return;
    this.flags[i] = 0;
    this.live--;
  }

  /** Free every particle of one effect (or all with −1). */
  clear(effect = -1): void {
    for (let i = 0; i < this.cap; i++) if (this.flags[i]! & PF.Alive && (effect < 0 || this.effect[i] === effect)) this.free(i);
  }

  /** Live particles owned by `effect`. */
  countOf(effect: number): number {
    let n = 0;
    for (let i = 0; i < this.cap; i++) if (this.flags[i]! & PF.Alive && this.effect[i] === effect) n++;
    return n;
  }

  resetStats(): void {
    this.peak = this.live;
    this.dropped = 0;
    this.reclaimed = 0;
    this.spawned = 0;
  }

  private reset(i: number): void {
    this.x[i] = this.y[i] = this.vx[i] = this.vy[i] = this.ax[i] = this.ay[i] = 0;
    this.drag[i] = 1;
    this.x0[i] = this.y0[i] = this.cx[i] = this.cy[i] = this.x1[i] = this.y1[i] = 0;
    this.pe[i] = 0;
    this.pl[i] = 0;
    this.rot[i] = this.vrot[i] = this.swA[i] = this.swF[i] = this.flip[i] = this.vflip[i] = 0;
    this.s0[i] = this.s1[i] = this.s2[i] = 1;
    this.sT[i] = 1;
    this.se1[i] = this.se2[i] = 0;
    this.sc1[i] = 1.70158;
    this.sxK[i] = 1;
    this.sqAt[i] = -1;
    this.sqX[i] = this.sqY[i] = 1;
    this.amax[i] = 1;
    this.fin[i] = this.fout[i] = 0;
    this.age[i] = 0;
    this.life[i] = 1;
    this.anim[i] = 0;
    this.frame0[i] = 0;
    this.fps[i] = 0;
    this.anchorX[i] = this.anchorY[i] = 0.5;
    this.tint[i] = 0;
    this.blend[i] = 0;
    this.layer[i] = 1;
    this.hp0[i] = this.hp1[i] = this.hp2[i] = 0;
  }
}
