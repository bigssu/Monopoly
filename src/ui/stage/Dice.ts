/**
 * Two CSS-3D dice. `roll(a, b)` tumbles them (~900 ms) onto the given faces;
 * `shake(on)` jitters them while the player holds the roll button.
 */
import { sfx } from '@/ui/audio/sfx';
import { haptic } from '@/ui/audio/haptics';
import { anim, instant } from '@/ui/fx/time';
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

class Die {
  readonly el: HTMLElement;
  private cube: HTMLElement;
  private rx = 0;
  private ry = 0;
  value = 1;

  constructor() {
    this.cube = h('div', { class: 'cube' });
    for (const n of [1, 2, 3, 4, 5, 6]) this.cube.append(h('div', { class: `face f${n}`, html: faceSvg(n) }));
    this.el = h('div', { class: 'die' }, this.cube);
    this.set(1);
  }

  set(n: number): void {
    this.value = n;
    [this.rx, this.ry] = FINAL[n]!;
    this.cube.style.transform = `rotateX(${this.rx - 18}deg) rotateY(${this.ry + 24}deg)`;
  }

  async roll(n: number, delay: number, dir: number): Promise<void> {
    const [fx, fy] = FINAL[n]!;
    const spinsX = 360 * (2 + Math.floor(Math.random() * 2)) * dir;
    const spinsY = 360 * (1 + Math.floor(Math.random() * 2)) * -dir;
    const from = `rotateX(${this.rx - 18}deg) rotateY(${this.ry + 24}deg)`;
    const to = `rotateX(${fx - 18}deg) rotateY(${fy + 24}deg)`;
    const mid = `rotateX(${fx - 18 + spinsX}deg) rotateY(${fy + 24 + spinsY}deg)`;
    this.value = n;
    this.rx = fx;
    this.ry = fy;
    this.cube.style.transform = to;
    if (instant()) return;
    await Promise.all([
      anim(this.cube, [{ transform: from }, { transform: mid }], {
        duration: 900,
        delay,
        easing: 'cubic-bezier(.18,.7,.3,1)',
        fill: 'backwards',
      }),
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
  }
}
