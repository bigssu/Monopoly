/**
 * Particles (confetti, coin showers, coin arcs) drawn into ONE temporary <canvas> per effect,
 * stepped on the shared 30 Hz animation clock (`onFrame`, docs/PERFORMANCE.md).
 *
 * The former version animated up to 80 DOM nodes with Web Animations: every particle became its
 * own GPU layer (a coin arc alone added 8 layers, confetti 76). A canvas is a single layer and
 * its redraws never trigger a document paint. The canvas covers only the effect's bounding box
 * and is removed when the last particle lands, so an idle table carries nothing.
 */
import { animSpeed, instant, isSkipping, onFrame } from './time';
import { cubicBezier, type Ease } from './quantize';
import { svgArt } from '@/ui/game/util';

const CONFETTI = ['#E8564F', '#4A6CF7', '#3DBB6E', '#F2B633', '#9B6BF2', '#F5844A', '#2EC4B6', '#F272A8'];

/** One keyframe of a particle path (effect progress `o` in 0..1). */
interface Key {
  o: number;
  x: number;
  y: number;
  /** Rotation (deg) in the screen plane. */
  rot: number;
  /** Rotation around the vertical axis (deg), drawn as a horizontal squash (confetti flip). */
  flip: number;
  s: number;
  a: number;
}

interface Particle {
  kind: 'coin' | 'confetti';
  w: number;
  h: number;
  color: string;
  delay: number;
  dur: number;
  ease: Ease;
  keys: Key[];
}

const key = (o: number, x: number, y: number, a: number, s = 1, rot = 0, flip = 0): Key => ({ o, x, y, rot, flip, s, a });

function at(keys: Key[], p: number): Key {
  let i = 0;
  while (i < keys.length - 2 && p > keys[i + 1]!.o) i++;
  const k0 = keys[i]!;
  const k1 = keys[i + 1]!;
  const t = (p - k0.o) / (k1.o - k0.o || 1);
  const l = (a: number, b: number): number => a + (b - a) * t;
  return { o: p, x: l(k0.x, k1.x), y: l(k0.y, k1.y), rot: l(k0.rot, k1.rot), flip: l(k0.flip, k1.flip), s: l(k0.s, k1.s), a: l(k0.a, k1.a) };
}

/** The coin icon rasterized once (per pixel size) for drawImage. */
let coinSrc: HTMLImageElement | null = null;
const coinCache = new Map<number, HTMLCanvasElement>();
function coinBitmap(px: number): CanvasImageSource | null {
  if (typeof Image === 'undefined') return null;
  if (!coinSrc) {
    let markup = svgArt('coin');
    if (!markup.includes('xmlns=')) markup = markup.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    markup = markup.replace('<svg', '<svg width="64" height="64"');
    coinSrc = new Image();
    coinSrc.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  }
  if (!coinSrc.complete || !coinSrc.naturalWidth) return null;
  const size = Math.max(8, Math.ceil(px / 8) * 8);
  let c = coinCache.get(size);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d')?.drawImage(coinSrc, 0, 0, size, size);
    coinCache.set(size, c);
  }
  return c;
}

export class Particles {
  constructor(private host: HTMLElement) {
    // Start decoding the coin early so the first burst has it.
    coinBitmap(32);
  }

  /**
   * Run `parts` inside a canvas covering the CSS-px box (x, y, w, h) of the host; resolves when
   * every particle is done (or the host left the document).
   */
  private run(box: { x: number; y: number; w: number; h: number }, parts: Particle[]): Promise<void> {
    if (!parts.length || typeof document === 'undefined') return Promise.resolve();
    const canvas = document.createElement('canvas');
    canvas.className = 'pt-canvas';
    // 1 canvas px per CSS px: particles are small and fast; a software canvas (see below) costs
    // main-thread time per pixel drawn and uploaded.
    const scale = 1;

    canvas.width = Math.max(1, Math.round(box.w * scale));
    canvas.height = Math.max(1, Math.round(box.h * scale));
    canvas.style.left = `${box.x}px`;
    canvas.style.top = `${box.y}px`;
    canvas.style.width = `${box.w}px`;
    canvas.style.height = `${box.h}px`;
    // Software canvas (willReadFrequently): an accelerated canvas made each commit wait on its
    // upload in GPU-less WebViews (15-50 ms at 4x CPU throttle, docs/PERFORMANCE.md).
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return Promise.resolve();
    this.host.append(canvas);
    const speed = animSpeed() || 1;
    let elapsed = 0;
    let last = -1;
    return new Promise((resolve) => {
      const finish = (): void => {
        canvas.remove();
        resolve();
      };
      onFrame((now) => {
        if (!canvas.isConnected) {
          resolve();
          return false;
        }
        if (last >= 0) elapsed += (now - last) * speed * (isSkipping() ? 5 : 1);
        last = now;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let alive = 0;
        for (const p of parts) {
          const t = (elapsed - p.delay) / p.dur;
          if (t >= 1) continue;
          alive++;
          if (t < 0) continue;
          const k = at(p.keys, p.ease(t));
          if (k.a <= 0.01) continue;
          ctx.globalAlpha = Math.min(1, k.a);
          const flip = Math.cos(k.flip * (Math.PI / 180));
          const r = k.rot * (Math.PI / 180);
          const c = Math.cos(r) * k.s * scale;
          const s = Math.sin(r) * k.s * scale;
          ctx.setTransform(c * flip, s * flip, -s, c, (k.x - box.x) * scale, (k.y - box.y) * scale);
          if (p.kind === 'coin') {
            const img = coinBitmap(p.w * k.s * scale);
            if (img) ctx.drawImage(img, -p.w / 2, -p.h / 2, p.w, p.h);
            else {
              ctx.fillStyle = '#F2B633';
              ctx.beginPath();
              ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
              ctx.fill();
            }
          } else {
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          }
        }
        if (alive) return true;
        finish();
        return false;
      });
    });
  }

  /** Confetti rain over the whole host. */
  async confetti(count = 70): Promise<void> {
    if (instant()) return;
    const W = this.host.clientWidth || window.innerWidth;
    const H = this.host.clientHeight || window.innerHeight;
    const ease = cubicBezier(0.3, 0.1, 0.6, 1);
    const parts: Particle[] = [];
    for (let i = 0; i < Math.min(count, 120); i++) {
      const x = Math.random() * W;
      const drift = (Math.random() - 0.5) * W * 0.25;
      const rot = (Math.random() - 0.5) * 1440;
      parts.push({
        kind: 'confetti',
        w: 6 + Math.random() * 8,
        h: 10 + Math.random() * 10,
        color: CONFETTI[i % CONFETTI.length]!,
        delay: Math.random() * 700,
        dur: 1800 + Math.random() * 1400,
        ease,
        keys: [key(0, x, -30, 1), key(0.6, x + drift * 0.6, H * 0.55, 1, 1, rot * 0.6, 540), key(1, x + drift, H + 30, 0.8, 1, rot, 900)],
      });
    }
    await this.run({ x: 0, y: 0, w: W, h: H }, parts);
  }

  /** Coins burst up from a point and fall (passing Start). */
  async coinShower(x: number, y: number, count = 14): Promise<void> {
    if (instant()) return;
    const ease = cubicBezier(0.2, 0.7, 0.4, 1);
    const parts: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const s = 18 + Math.random() * 12;
      const dx = (Math.random() - 0.5) * 220;
      const up = 80 + Math.random() * 120;
      parts.push({
        kind: 'coin',
        w: s,
        h: s,
        color: '',
        delay: i * 25,
        dur: 900,
        ease,
        keys: [key(0, x + s / 2, y + s / 2, 0, 0.4), key(0.4, x + dx * 0.5 + s / 2, y - up + s / 2, 1, 1), key(1, x + dx + s / 2, y + 40 + s / 2, 0, 0.9)],
      });
    }
    // Bounding box of every path (+ the largest coin, scaled up to 1).
    await this.run({ x: x - 150, y: y - 240, w: 330, h: 320 }, parts);
  }

  /** Coins fly along an arc from one point to another (toll payment). */
  async coinArc(from: { x: number; y: number }, to: { x: number; y: number }, count = 7): Promise<void> {
    if (instant()) return;
    const mx = (from.x + to.x) / 2;
    const my = Math.min(from.y, to.y) - Math.max(80, Math.abs(from.x - to.x) * 0.25);
    const ease = cubicBezier(0.4, 0, 0.3, 1);
    const parts: Particle[] = [];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < count; i++) {
      const keys: Key[] = [];
      for (let k = 0; k <= 8; k++) {
        const s = k / 8;
        const x = (1 - s) * (1 - s) * from.x + 2 * (1 - s) * s * mx + s * s * to.x;
        const y = (1 - s) * (1 - s) * from.y + 2 * (1 - s) * s * my + s * s * to.y;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
        keys.push(key(s, x, y, k === 0 ? 0 : k === 8 ? 0.2 : 1, 0.7 + Math.sin(s * Math.PI) * 0.5));
      }
      parts.push({ kind: 'coin', w: 26, h: 26, color: '', delay: i * 55, dur: 720, ease, keys });
    }
    const pad = 26;
    await this.run({ x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 }, parts);
  }
}
