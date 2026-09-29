/**
 * Pooled DOM particles (≤ 80 nodes, transform/opacity only): confetti, coin showers, coin arcs.
 */
import { anim, instant } from './time';
import { svg } from '@/ui/game/util';

const MAX = 80;
const CONFETTI = ['#E8564F', '#4A6CF7', '#3DBB6E', '#F2B633', '#9B6BF2', '#F5844A', '#2EC4B6', '#F272A8'];

export class Particles {
  private pool: HTMLElement[] = [];
  private free: HTMLElement[] = [];

  constructor(private host: HTMLElement) {}

  private take(kind: 'coin' | 'confetti'): HTMLElement | null {
    let el = this.free.pop();
    if (!el) {
      if (this.pool.length >= MAX) return null;
      el = document.createElement('div');
      el.className = 'pt';
      el.innerHTML = `<span class="pt-coin">${svg('coin')}</span>`;
      this.pool.push(el);
      this.host.append(el);
    }
    el.dataset.kind = kind;
    el.style.display = '';
    return el;
  }

  private give(el: HTMLElement): void {
    el.style.display = 'none';
    this.free.push(el);
  }

  /** Confetti rain over the whole host. */
  async confetti(count = 70): Promise<void> {
    if (instant()) return;
    const W = this.host.clientWidth || window.innerWidth;
    const H = this.host.clientHeight || window.innerHeight;
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < count; i++) {
      const el = this.take('confetti');
      if (!el) break;
      const c = CONFETTI[i % CONFETTI.length]!;
      el.style.setProperty('--c', c);
      el.style.width = `${6 + Math.random() * 8}px`;
      el.style.height = `${10 + Math.random() * 10}px`;
      const x = Math.random() * W;
      const drift = (Math.random() - 0.5) * W * 0.25;
      const rot = (Math.random() - 0.5) * 1440;
      const dur = 1800 + Math.random() * 1400;
      jobs.push(
        anim(
          el,
          [
            { transform: `translate(${x}px, ${-30}px) rotate(0deg) rotateY(0deg)`, opacity: 1 },
            { transform: `translate(${x + drift * 0.6}px, ${H * 0.55}px) rotate(${rot * 0.6}deg) rotateY(540deg)`, opacity: 1, offset: 0.6 },
            { transform: `translate(${x + drift}px, ${H + 30}px) rotate(${rot}deg) rotateY(900deg)`, opacity: 0.8 },
          ],
          { duration: dur, delay: Math.random() * 700, easing: 'cubic-bezier(.3,.1,.6,1)', fill: 'backwards' },
        ).then(() => this.give(el)),
      );
    }
    await Promise.all(jobs);
  }

  /** Coins burst up from a point and fall (passing Start). */
  async coinShower(x: number, y: number, count = 14): Promise<void> {
    if (instant()) return;
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < count; i++) {
      const el = this.take('coin');
      if (!el) break;
      const s = 18 + Math.random() * 12;
      el.style.width = `${s}px`;
      el.style.height = `${s}px`;
      const dx = (Math.random() - 0.5) * 220;
      const up = 80 + Math.random() * 120;
      jobs.push(
        anim(
          el,
          [
            { transform: `translate(${x}px, ${y}px) scale(.4)`, opacity: 0 },
            { transform: `translate(${x + dx * 0.5}px, ${y - up}px) scale(1)`, opacity: 1, offset: 0.4 },
            { transform: `translate(${x + dx}px, ${y + 40}px) scale(.9)`, opacity: 0 },
          ],
          { duration: 900, delay: i * 25, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'backwards' },
        ).then(() => this.give(el)),
      );
    }
    await Promise.all(jobs);
  }

  /** Coins fly along an arc from one point to another (toll payment). */
  async coinArc(from: { x: number; y: number }, to: { x: number; y: number }, count = 7): Promise<void> {
    if (instant()) return;
    const jobs: Promise<void>[] = [];
    const mx = (from.x + to.x) / 2;
    const my = Math.min(from.y, to.y) - Math.max(80, Math.abs(from.x - to.x) * 0.25);
    for (let i = 0; i < count; i++) {
      const el = this.take('coin');
      if (!el) break;
      el.style.width = '26px';
      el.style.height = '26px';
      const frames: Keyframe[] = [];
      for (let k = 0; k <= 8; k++) {
        const s = k / 8;
        const x = (1 - s) * (1 - s) * from.x + 2 * (1 - s) * s * mx + s * s * to.x;
        const y = (1 - s) * (1 - s) * from.y + 2 * (1 - s) * s * my + s * s * to.y;
        frames.push({
          transform: `translate(${x - 13}px, ${y - 13}px) scale(${0.7 + Math.sin(s * Math.PI) * 0.5})`,
          opacity: k === 0 ? 0 : k === 8 ? 0.2 : 1,
          offset: s,
        });
      }
      jobs.push(
        anim(el, frames, { duration: 720, delay: i * 55, easing: 'cubic-bezier(.4,0,.3,1)', fill: 'backwards' }).then(() => this.give(el)),
      );
    }
    await Promise.all(jobs);
  }
}
