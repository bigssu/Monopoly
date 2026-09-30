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
// The cube is drawn with 2D `matrix()` transforms on its six faces (hidden when facing away)
// instead of CSS preserve-3d: a 3D-rendering context composites every face into its own GPU
// layer (14 layers for two dice, docs/PERFORMANCE.md) while 2D transforms are plain paint.
// While rolling, the orientation is stepped on the shared 30 Hz animation clock.

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

/** 2D transform + visibility + shading of every face for the cube orientation (rx, ry). */
export function cubeFaces(rx: number, ry: number): { n: number; visible: boolean; transform: string; shade: number }[] {
  const cube = mul(rotX(rx), rotY(ry));
  return [1, 2, 3, 4, 5, 6].map((n) => {
    const a = mul(cube, FACE_ROT[n]!);
    const nz = a[8];
    // Face centre = A · (0, 0, size/2); expressed in units of the die size (--ds).
    const tx = r4(a[2] / 2);
    const ty = r4(a[5] / 2);
    return {
      n,
      visible: nz > 0.02,
      transform: `translate(calc(var(--ds) * ${tx}), calc(var(--ds) * ${ty})) matrix(${r4(a[0])}, ${r4(a[3])}, ${r4(a[1])}, ${r4(a[4])}, 0, 0)`,
      shade: r4(Math.max(0, Math.min(1, 1 - nz)) * 0.14),
    };
  });
}

const ROLL_EASE = cubicBezier(0.18, 0.7, 0.3, 1);

class Die {
  readonly el: HTMLElement;
  private cube: HTMLElement;
  private faces: HTMLElement[] = [];
  private rx = 0;
  private ry = 0;
  private stopTween: (() => void) | null = null;
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

  /** Draw the cube at rotation (x, y) in degrees. */
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
    this.stop();
    this.value = n;
    [this.rx, this.ry] = FINAL[n]!;
    this.pose(this.rx - 18, this.ry + 24);
  }

  stop(): void {
    this.stopTween?.();
    this.stopTween = null;
  }

  async roll(n: number, delay: number, dir: number): Promise<void> {
    this.stop();
    const [fx, fy] = FINAL[n]!;
    const spinsX = 360 * (2 + Math.floor(Math.random() * 2)) * dir;
    const spinsY = 360 * (1 + Math.floor(Math.random() * 2)) * -dir;
    const x0 = this.rx - 18;
    const y0 = this.ry + 24;
    const x1 = fx - 18 + spinsX;
    const y1 = fy + 24 + spinsY;
    this.value = n;
    this.rx = fx;
    this.ry = fy;
    if (instant()) {
      this.pose(fx - 18, fy + 24);
      return;
    }
    const duration = D(900);
    let elapsed = -D(delay);
    let last = -1;
    const spin = new Promise<void>((resolve) => {
      const done = (): void => {
        this.stopTween = null;
        resolve();
      };
      const stopTick = onFrame((now) => {
        if (last >= 0) elapsed += (now - last) * (isSkipping() ? 5 : 1);
        last = now;
        const t = Math.min(1, Math.max(0, elapsed / duration));
        const e = ROLL_EASE(t);
        this.pose(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e);
        if (t < 1) return true;
        this.pose(fx - 18, fy + 24);
        done();
        return false;
      });
      this.stopTween = () => {
        stopTick();
        this.pose(fx - 18, fy + 24);
        done();
      };
    });
    await Promise.all([
      spin,
      anim(
        this.el,
        [
          { transform: 'translate(0, -110%) scale(1.15)' },
          { transform: 'translate(0, 8%) scale(1.04, .94)', offset: 0.55 },
          { transform: 'translate(0, -14%) scale(1)', offset: 0.72 },
          { transform: 'translate(0, 0) scale(1)' },
        ],
        { duration: 900, delay, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'backwards' },
      ),
    ]);
  }
}

export class Dice {
  readonly el: HTMLElement;
  private dice: [Die, Die];
  private readout: HTMLElement;
  private shakeTimer = 0;

  constructor() {
    this.dice = [new Die(), new Die()];
    this.readout = h('div', { class: 'dice-readout' });
    this.el = h('div', { class: 'dice' }, h('div', { class: 'dice-pair' }, this.dice[0].el, this.dice[1].el), this.readout);
  }

  show(values: [number, number] | null): void {
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
    await Promise.all([this.dice[0].roll(a, 0, 1), this.dice[1].roll(b, 60, -1)]);
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

  dispose(): void {
    window.clearInterval(this.shakeTimer);
    for (const d of this.dice) d.stop();
  }
}
