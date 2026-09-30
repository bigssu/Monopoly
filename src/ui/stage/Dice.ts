/**
 * Two dice (an orthographically projected cube drawn with 2D transforms, see `cubeFaces`). `roll(a, b)` tumbles them (~900 ms) onto the given faces;
 * `shake(on)` jitters them while the player holds the roll button.
 */
import { sfx } from '@/ui/audio/sfx';
import { haptic } from '@/ui/audio/haptics';
import { anim, D, instant, isSkipping, onFrame } from '@/ui/fx/time';
import { cubicBezier } from '@/ui/fx/quantize';
import { h, svg } from '@/ui/game/util';

const PIPS: Record<number, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [
    [28, 28],
    [72, 72],
  ],
  3: [
    [26, 26],
    [50, 50],
    [74, 74],
  ],
  4: [
    [28, 28],
    [72, 28],
    [28, 72],
    [72, 72],
  ],
  5: [
    [27, 27],
    [73, 27],
    [50, 50],
    [27, 73],
    [73, 73],
  ],
  6: [
    [28, 24],
    [72, 24],
    [28, 50],
    [72, 50],
    [28, 76],
    [72, 76],
  ],
};

function faceSvg(n: number): string {
  const r = n === 1 ? 11 : 9;
  const fill = n === 1 ? '#EF5B5B' : '#2B3245';
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${PIPS[n]!.map(
    ([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`,
  ).join('')}</svg>`;
}

/** Cube rotation [rx, ry] that shows face n to the viewer. */
const FINAL: Record<number, [number, number]> = {
  1: [0, 0],
  6: [0, 180],
  3: [0, -90],
  4: [0, 90],
  5: [-90, 0],
  2: [90, 0],
};

// --- Orthographic cube projection -------------------------------------------------------------
// At rest the cube is drawn with 2D `matrix()` transforms on its six faces (hidden when facing
// away) instead of CSS preserve-3d: a 3D-rendering context composites every face into its own GPU
// layer (16 layers for two dice, docs/PERFORMANCE.md) while 2D transforms are plain paint. While
// rolling, the same projection is drawn into a temporary canvas on the shared 30 Hz clock.

type M3 = [number, number, number, number, number, number, number, number, number];
const RAD = Math.PI / 180;
/** CSS rotateX / rotateY as row-major 3×3 matrices. */
function rotX(deg: number): M3 {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
function rotY(deg: number): M3 {
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
function mul(a: M3, b: M3): M3 {
  const o = new Array(9).fill(0) as M3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] = o[r * 3 + c]! + a[r * 3 + k]! * b[k * 3 + c]!;
  return o;
}
/** Each face's own orientation on the cube (same as the former CSS face transforms). */
const FACE_ROT: Record<number, M3> = {
  1: rotY(0),
  6: rotY(180),
  3: rotY(90),
  4: rotY(-90),
  5: rotX(90),
  2: rotX(-90),
};
const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;

interface FacePose {
  n: number;
  visible: boolean;
  /** 2D linear part (CSS matrix a, b, c, d) and face-centre offset in die sizes. */
  m: [number, number, number, number];
  tx: number;
  ty: number;
  shade: number;
}

/** Orthographic pose of every face for the cube orientation (rx, ry) in degrees. */
function facePoses(rx: number, ry: number): FacePose[] {
  const cube = mul(rotX(rx), rotY(ry));
  return [1, 2, 3, 4, 5, 6].map((n) => {
    const a = mul(cube, FACE_ROT[n]!);
    const nz = a[8];
    return {
      n,
      visible: nz > 0.02,
      m: [a[0], a[3], a[1], a[4]],
      // Face centre = A · (0, 0, size/2).
      tx: a[2] / 2,
      ty: a[5] / 2,
      shade: Math.max(0, Math.min(1, 1 - nz)) * 0.14,
    };
  });
}

/** 2D transform + visibility + shading of every face for the cube orientation (rx, ry). */
export function cubeFaces(rx: number, ry: number): { n: number; visible: boolean; transform: string; shade: number }[] {
  return facePoses(rx, ry).map((f) => ({
    n: f.n,
    visible: f.visible,
    transform: `translate(calc(var(--ds) * ${r4(f.tx)}), calc(var(--ds) * ${r4(f.ty)})) matrix(${f.m.map(r4).join(', ')}, 0, 0)`,
    shade: r4(f.shade),
  }));
}

/**
 * Pre-rendered pieces of a die (same look as the DOM faces: rounded gradient face, rim, pips; a
 * dark mask for the side shading; the contact shadow), at `k` canvas px per CSS px. Drawing a
 * tumble frame is then a few affine `drawImage` calls instead of re-building gradients and paths
 * (the canvas is a software one: its cost is main-thread time).
 */
interface Sprites {
  ds: number;
  k: number;
  faces: HTMLCanvasElement[];
  mask: HTMLCanvasElement;
  shadow: HTMLCanvasElement;
}
let spriteCache: Sprites | null = null;

function sprites(ds: number, k: number): Sprites {
  if (spriteCache && spriteCache.ds === ds && spriteCache.k === k) return spriteCache;
  const px = Math.ceil(ds * k);
  const half = ds / 2;
  const rad = ds * 0.22;
  const rim = Math.max(1.5, ds * 0.018);
  const make = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    return [c, ctx];
  };
  // 160deg CSS gradient line through the face centre.
  const dx = Math.sin((160 * Math.PI) / 180);
  const dy = -Math.cos((160 * Math.PI) / 180);
  const len = ds * (Math.abs(dx) + Math.abs(dy));
  const faces = [1, 2, 3, 4, 5, 6].map((n) => {
    const [c, ctx] = make(px, px);
    ctx.setTransform(k, 0, 0, k, (px) / 2, (px) / 2);
    const g = ctx.createLinearGradient((-dx * len) / 2, (-dy * len) / 2, (dx * len) / 2, (dy * len) / 2);
    g.addColorStop(0, '#FFFFFF');
    g.addColorStop(0.7, '#F3F5FA');
    g.addColorStop(1, '#E3E8F1');
    ctx.beginPath();
    ctx.roundRect(-half, -half, ds, ds, rad);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = rim;
    ctx.strokeStyle = '#D5DCE8';
    ctx.beginPath();
    ctx.roundRect(-half + rim / 2, -half + rim / 2, ds - rim, ds - rim, Math.max(0, rad - rim / 2));
    ctx.stroke();
    const pr = ((n === 1 ? 11 : 9) / 100) * ds;
    ctx.fillStyle = n === 1 ? '#EF5B5B' : '#2B3245';
    for (const [x, y] of PIPS[n]!) {
      ctx.beginPath();
      ctx.arc((x / 100) * ds - half, (y / 100) * ds - half, pr, 0, Math.PI * 2);
      ctx.fill();
    }
    return c;
  });
  const [mask, mctx] = make(px, px);
  mctx.setTransform(k, 0, 0, k, px / 2, px / 2);
  mctx.fillStyle = '#2B3245';
  mctx.beginPath();
  mctx.roundRect(-half, -half, ds, ds, rad);
  mctx.fill();
  const [shadow, sctx] = make(Math.ceil(0.84 * ds * k), Math.ceil(0.2 * ds * k));
  sctx.setTransform(1, 0, 0, 0.2 / 0.84, shadow.width / 2, shadow.height / 2);
  const sg = sctx.createRadialGradient(0, 0, 0, 0, 0, shadow.width / 2);
  sg.addColorStop(0, 'rgba(60, 40, 20, 0.28)');
  sg.addColorStop(1, 'rgba(60, 40, 20, 0)');
  sctx.fillStyle = sg;
  sctx.fillRect(-shadow.width / 2, -shadow.width / 2, shadow.width, shadow.width);
  spriteCache = { ds, k, faces, mask, shadow };
  return spriteCache;
}

/**
 * Draw one die (tumble pose rx/ry, centre cx/cy and squash sx/sy in CSS px) from its sprites.
 * Returns the canvas-px box it may have touched (for dirty-rect clearing).
 */
function drawCube(ctx: CanvasRenderingContext2D, sp: Sprites, rx: number, ry: number, cx: number, cy: number, sx: number, sy: number): [number, number, number, number] {
  const { ds, k } = sp;
  const px = sp.faces[0]!.width;
  // Contact shadow (the DOM die's ::after), squashed with the die.
  ctx.globalAlpha = 1;
  ctx.setTransform(k * sx, 0, 0, k * sy, cx * k, cy * k);
  ctx.drawImage(sp.shadow, -0.42 * ds, 0.48 * ds, 0.84 * ds, 0.2 * ds);
  for (const f of facePoses(rx, ry)) {
    if (!f.visible) continue;
    const [a, b, c, d] = f.m;
    // Sprite px → face-local CSS px (1/k), then the face's affine pose.
    ctx.setTransform(a * sx, b * sy, c * sx, d * sy, (cx + f.tx * ds * sx) * k, (cy + f.ty * ds * sy) * k);
    ctx.drawImage(sp.faces[f.n - 1]!, -px / 2, -px / 2);
    if (f.shade > 0.001) {
      ctx.globalAlpha = f.shade;
      ctx.drawImage(sp.mask, -px / 2, -px / 2);
      ctx.globalAlpha = 1;
    }
  }
  const r = ds * 0.9 * Math.max(sx, sy) * k;
  return [cx * k - r, cy * k - r, 2 * r, 2 * r + ds * 0.3 * k];
}

const ROLL_EASE = cubicBezier(0.18, 0.7, 0.3, 1);

/** One die's tumble: cube rotation from (x0, y0) to (x1, y1) degrees, starting `delay` ms late. */
interface Spin {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  delay: number;
}

/** The landing bounce (formerly a Web Animation on the die): [offset, translateY (die sizes), sx, sy]. */
const BOUNCE: [number, number, number, number][] = [
  [0, -1.1, 1.15, 1.15],
  [0.55, 0.08, 1.04, 0.94],
  [0.72, -0.14, 1, 1],
  [1, 0, 1, 1],
];
const BOUNCE_EASE = cubicBezier(0.3, 0.6, 0.4, 1);
function bounceAt(t: number): [number, number, number] {
  const p = BOUNCE_EASE(Math.min(1, Math.max(0, t)));
  let i = 0;
  while (i < BOUNCE.length - 2 && p > BOUNCE[i + 1]![0]) i++;
  const a = BOUNCE[i]!;
  const b = BOUNCE[i + 1]!;
  const u = (p - a[0]) / (b[0] - a[0]);
  return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
}

class Die {
  readonly el: HTMLElement;
  private cube: HTMLElement;
  private faces: HTMLElement[] = [];
  private rx = 0;
  private ry = 0;
  value = 1;

  constructor() {
    this.cube = h('div', { class: 'cube' });
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const f = h('div', { class: `face f${n}`, html: faceSvg(n) });
      this.faces.push(f);
      this.cube.append(f);
    }
    this.el = h('div', { class: 'die' }, this.cube);
    this.set(1);
  }

  /** Draw the DOM cube at rotation (x, y) in degrees. */
  private pose(x: number, y: number): void {
    for (const f of cubeFaces(x, y)) {
      const el = this.faces[f.n - 1]!;
      el.style.visibility = f.visible ? '' : 'hidden';
      if (!f.visible) continue;
      el.style.transform = f.transform;
      el.style.setProperty('--shade', String(f.shade));
    }
  }

  set(n: number): void {
    this.value = n;
    [this.rx, this.ry] = FINAL[n]!;
    this.pose(this.rx - 18, this.ry + 24);
  }

  /** Plan a roll onto face n (the DOM cube already shows the final pose, hidden while rolling). */
  plan(n: number, delay: number, dir: number): Spin {
    const [fx, fy] = FINAL[n]!;
    const spinsX = 360 * (2 + Math.floor(Math.random() * 2)) * dir;
    const spinsY = 360 * (1 + Math.floor(Math.random() * 2)) * -dir;
    const spin = { x0: this.rx - 18, y0: this.ry + 24, x1: fx - 18 + spinsX, y1: fy + 24 + spinsY, delay };
    this.set(n);
    return spin;
  }
}

export class Dice {
  readonly el: HTMLElement;
  private dice: [Die, Die];
  private readout: HTMLElement;
  private shakeTimer = 0;
  private pair: HTMLElement;
  private stopTumble: (() => void) | null = null;

  constructor() {
    this.dice = [new Die(), new Die()];
    this.readout = h('div', { class: 'dice-readout' });
    this.pair = h('div', { class: 'dice-pair' }, this.dice[0].el, this.dice[1].el);
    this.el = h('div', { class: 'dice' }, this.pair, this.readout);
  }

  show(values: [number, number] | null): void {
    this.stopTumble?.();
    const [a, b] = values ?? [5, 2];
    this.dice[0].set(a);
    this.dice[1].set(b);
    this.readout.innerHTML = '';
    this.el.classList.remove('is-doubles');
  }

  shake(on: boolean): void {
    this.el.classList.toggle('is-shaking', on);
    window.clearInterval(this.shakeTimer);
    if (on) {
      sfx.play('dice-shake');
      haptic('tick');
      this.shakeTimer = window.setInterval(() => {
        haptic('tick');
        sfx.play('dice-shake', { gain: 0.6 });
      }, 180);
    }
  }

  async roll(a: number, b: number, total: number, doubles: boolean): Promise<void> {
    this.shake(false);
    this.readout.innerHTML = '';
    this.el.classList.remove('is-doubles');
    sfx.play('dice-shake');
    await this.tumble([this.dice[0].plan(a, 0, 1), this.dice[1].plan(b, 60, -1)]);
    sfx.play('dice-land');
    haptic('light');
    this.readout.innerHTML =
      `<span class="dr-face">${svg(`dice-face-${a}`)}</span><span class="dr-face">${svg(`dice-face-${b}`)}</span>` +
      `<b class="dr-total">${total}</b>`;
    if (doubles) {
      this.el.classList.add('is-doubles');
      sfx.play('doubles');
      haptic('success');
    }
    void anim(this.readout, [{ transform: 'scale(.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], {
      duration: 260,
      easing: 'cubic-bezier(.34,1.56,.64,1)',
    });
  }

  /**
   * Both dice tumble and bounce in ONE temporary canvas over the pair, stepped on the shared
   * 30 Hz clock: a single GPU layer while rolling and no document paints (the DOM dice would
   * repaint every frame, and each bouncing die was a layer plus overlap layers). The DOM dice,
   * already showing the final faces, reappear when the canvas goes away.
   */
  private tumble(spins: [Spin, Spin]): Promise<void> {
    this.stopTumble?.();
    if (instant() || typeof document === 'undefined') return Promise.resolve();
    // Sizes from the layout variables (--ds = max(38px, 3.3 --u), gap 1.3 --u, --u = --board / 32)
    // so a roll never forces a synchronous layout.
    const board = parseFloat(document.documentElement.style.getPropertyValue('--board')) || 0;
    const u = board / 32;
    const ds = Math.max(38, u * 3.3);
    const gap = u * 1.3;
    // Tumbling dice render at 1 canvas px per CSS px: motion hides the softness, the landed dice
    // are the crisp DOM ones again, and a software canvas costs per pixel (draw + upload).
    const k = 1;
    const padX = ds * 0.6;
    const padTop = ds * 1.9;
    const padBottom = ds * 0.8;
    const w = ds * 2 + gap + padX * 2;
    const hgt = ds + padTop + padBottom;
    const canvas = document.createElement('canvas');
    canvas.className = 'dice-canvas';
    canvas.width = Math.ceil(w * k);
    canvas.height = Math.ceil(hgt * k);
    canvas.style.left = `${-padX}px`;
    canvas.style.top = `${-padTop}px`;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${hgt}px`;
    // A software canvas (willReadFrequently): an accelerated one in a headless / GPU-less
    // WebView made every commit wait on the canvas upload (15-50 ms at 4x CPU throttle).
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || typeof ctx.roundRect !== 'function') return Promise.resolve();
    const sp = sprites(ds, k);
    let dirty: [number, number, number, number][] = [];
    const duration = D(900);
    const centres = [0, 1].map((i) => padX + ds / 2 + i * (ds + gap));
    const cy = padTop + ds / 2;
    let elapsed = 0;
    let last = -1;
    const draw = (): boolean => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      // Clear only what the previous frame drew.
      for (const [x, y, w, h] of dirty) ctx.clearRect(x, y, w, h);
      dirty = [];
      let running = false;
      spins.forEach((spin, i) => {
        const t = Math.min(1, Math.max(0, (elapsed - D(spin.delay)) / duration));
        if (t < 1) running = true;
        const e = ROLL_EASE(t);
        const [ty, sx, sy] = bounceAt(t);
        dirty.push(drawCube(ctx, sp, spin.x0 + (spin.x1 - spin.x0) * e, spin.y0 + (spin.y1 - spin.y0) * e, centres[i]!, cy + ty * ds, sx, sy));
      });
      return running;
    };
    draw();
    this.pair.append(canvas);
    this.el.classList.add('is-rolling');
    return new Promise((resolve) => {
      const done = (): void => {
        this.stopTumble = null;
        canvas.remove();
        this.el.classList.remove('is-rolling');
        resolve();
      };
      const stopTick = onFrame((now) => {
        if (last >= 0) elapsed += (now - last) * (isSkipping() ? 5 : 1);
        last = now;
        if (!canvas.isConnected || !draw()) {
          done();
          return false;
        }
        return true;
      });
      this.stopTumble = () => {
        stopTick();
        done();
      };
    });
  }

  dispose(): void {
    window.clearInterval(this.shakeTimer);
    this.stopTumble?.();
  }
}
