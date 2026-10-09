/**
 * Two dice (an orthographically projected cube drawn with 2D transforms, see `cubeFaces`).
 * `roll(a, b)` throws them onto the given faces: a flick (`aim`) sends them across the SCREEN in
 * its direction, as fast and as far as the finger pushed, off the screen's edges and back home
 * (`throw.ts`); a press without a swipe is a weak toss forward inside the dice area. Reduced
 * motion: the in-place tumble (~1 s). `shake(on)` jitters them while the player holds the dice;
 * `invite()` wobbles them (with a soft rattle, and blinks the hint) at a human's turn ("throw me").
 *
 * Rendering (docs/DESIGN.md "Dice throw"): the DOM cubes themselves, posed and moved on the 30 Hz
 * clock (`fly`), one layer per die while they roll; no canvas (some Android WebViews draw canvases
 * as white boxes). A flick flies in a top-level layer (`.dice-fly`, over the board and the panels,
 * created for the throw and removed at the landing; its frame is the Stage's, so the dice keep
 * their turn toward the seat); a toss and the in-place roll stay in the pair.
 */
import { sfx } from '@/ui/audio/sfx';
import { haptic } from '@/ui/audio/haptics';
import { anim, D, headless, isHeld, isSkipping, noMotion, onFrame, reducedMotion } from '@/ui/fx/time';
import { cubicBezier } from '@/ui/fx/quantize';
import { keyAt, smoothstep } from '@/ui/fx/vfx/ease';
import { h, isDevHook } from '@/ui/game/util';
import { rolledFaces } from './skill';
import { bounceAt, frameFrom, frameFromOne, planThrow, rollMode, samplePair, screenWalls, throwBounds, throwTravel, toScreen, type Box, type Frame, type Hit, type ThrowAim, type Vec } from './throw';

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
// rolling, the cube is re-posed on the shared 30 Hz clock.

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

/** 2D transform + visibility + shading of every face for the cube orientation (rx, ry) in degrees. */
function cubeFaces(rx: number, ry: number): { n: number; visible: boolean; transform: string; shade: number }[] {
  const cube = mul(rotX(rx), rotY(ry));
  return [1, 2, 3, 4, 5, 6].map((n) => {
    const a = mul(cube, FACE_ROT[n]!);
    const nz = a[8];
    // 2D linear part (CSS matrix a, b, c, d); the face centre A · (0, 0, size/2) in die sizes.
    return {
      n,
      visible: nz > 0.02,
      transform: `translate(calc(var(--ds) * ${r4(a[2] / 2)}), calc(var(--ds) * ${r4(a[5] / 2)})) matrix(${[a[0], a[3], a[1], a[4]].map(r4).join(', ')}, 0, 0)`,
      shade: r4(Math.max(0, Math.min(1, 1 - nz)) * 0.14),
    };
  });
}

const ROLL_EASE = cubicBezier(0.18, 0.7, 0.3, 1);
/** The in-place roll's tumble per die (ms at speed 1). */
const TUMBLE_MS = 1000;

/** One die's tumble: cube rotation from (x0, y0) to (x1, y1) degrees, starting `delay` ms late. */
interface Spin {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  delay: number;
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
  pose(x: number, y: number): void {
    for (const f of cubeFaces(x, y)) {
      const el = this.faces[f.n - 1]!;
      el.style.visibility = f.visible ? '' : 'hidden';
      if (!f.visible) continue;
      el.style.transform = f.transform;
      el.style.setProperty('--shade', String(f.shade));
      // Only the rolled face stays white; the visible sides go grey so the result reads first.
      el.classList.toggle('is-side', f.n !== this.value);
    }
  }

  /** One rolling frame: the cube at rotation (rx, ry), moved by (dx, dy) px and squashed (sx, sy). */
  move(dx: number, dy: number, sx: number, sy: number, rx: number, ry: number): void {
    this.el.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
    this.pose(rx, ry);
  }

  set(n: number): void {
    this.value = n;
    [this.rx, this.ry] = FINAL[n]!;
    this.pose(...this.restPose());
  }

  /** The resting pose shown now (its face, tilted toward the viewer): a roll starts from it. */
  restPose(): [number, number] {
    return [this.rx - 18, this.ry + 24];
  }

  /** Show face n (the DOM cube at its final pose) and return that pose. */
  land(n: number): [number, number] {
    this.set(n);
    return this.restPose();
  }

  /** Plan a roll onto face n (the DOM cube already shows the final pose, hidden while rolling). */
  plan(n: number, delay: number, dir: number): Spin {
    const [fx, fy] = FINAL[n]!;
    const spinsX = 360 * (2 + Math.floor(Math.random() * 2)) * dir;
    const spinsY = 360 * (1 + Math.floor(Math.random() * 2)) * -dir;
    const [x0, y0] = this.restPose();
    const spin = { x0, y0, x1: fx - 18 + spinsX, y1: fy + 24 + spinsY, delay };
    this.set(n);
    return spin;
  }
}

/** Dev/test record of one roll (e2e/dice-throw.spec.ts reads `window.__lotAndRoll.dice()`). */
export interface ThrowRecord {
  mode: 'instant' | 'inplace' | 'throw';
  kind: 'flick' | 'toss' | null;
  /** The aim the throw was thrown with (direction in stage px + strength 0..1), if any. */
  aim: ThrowAim | null;
  /** The faces shown: one for stride 1, else two. */
  faces: number[];
  /** Planned length (ms at speed 1) and the measured start / end (performance.now). */
  planMs: number;
  startedAt: number;
  endedAt: number | null;
  bounces: number[];
  clacks: number;
  /** Farthest a die got from its home (px). */
  travel: number;
  /** Walls (die centres) and the throw's bounding box (die centres), in the pair's px. */
  box: Box | null;
  bounds: Box | null;
  /** A flick's: the walls' screen box (the viewport inside the safe area, less the margin), and
   * the throw's bounding box of die centres on the screen (client px); null for a toss. */
  view: Box | null;
  screen: Box | null;
  /** A flick's: the dice's homes on the screen (client px), where they land. */
  homes: Vec[] | null;
  /** Launch speed (px/s, pair frame) and the free roll's path (px). */
  speed: number;
  pathLen: number;
}

/** A flick's flight: the top-level layer, its frame (pair px → layer px) and the screen walls. */
interface Flight {
  layer: HTMLElement;
  frame: HTMLElement;
  f: Frame;
  /** Client px of the layer's origin. */
  at: Vec;
  walls: Box;
  view: Box;
}

/** Dev only (`?dev=1`): every roll's record, and when each "throw me" rattle played; null in production. */
export const diceDev: { log: ThrowRecord[]; rattles: number[] } | null = typeof window !== 'undefined' && isDevHook() ? { log: [], rattles: [] } : null;

/** The hint's "throw me" blink: three opacity pulses (Dice.invite). */
const BLINK: Keyframe[] = [1, 0.25, 1, 0.25, 1, 0.25, 1].map((opacity, i) => ({ opacity, offset: i / 6 }));

/**
 * "Throw me" wobble at `x` wobbles in (0..n): a lean, a counter-lean, a small settle per 400 ms
 * wobble, eased between the poses (degrees, and a small lift in die-pair %).
 */
const WOBBLE: [number, number, number][] = [
  [0, 0, 0],
  [0.22, -7, -4],
  [0.5, 6, -2],
  [0.75, -3, 0],
  [1, 0, 0],
];
function wobbleAt(x: number): string {
  const [deg, lift] = keyAt(WOBBLE, x - Math.floor(x), smoothstep) as [number, number];
  return `translateY(${lift.toFixed(2)}%) rotate(${deg.toFixed(2)}deg)`;
}

export class Dice {
  readonly el: HTMLElement;
  private dice: [Die, Die];
  private shakeTimer = 0;
  /** The pair element (the Stage measures the dice area relative to it; the skill ring sits in it). */
  readonly pair: HTMLElement;
  private stopTumble: (() => void) | null = null;
  private aimV: ThrowAim | null = null;
  /** Dice in play: 1 (stride 1, the second die hidden, the first centred) or 2. */
  private count: 1 | 2 = 2;
  private inviteStop: (() => void) | null = null;
  /**
   * Set by the Stage: the dice area's walls (die edges) in the pair's own px, measured when a throw
   * starts (one layout read). Null: the in-place roll.
   */
  arena: (() => Box | null) | null = null;

  constructor() {
    this.dice = [new Die(), new Die()];
    this.pair = h('div', { class: 'dice-pair' }, this.dice[0].el, this.dice[1].el);
    this.el = h('div', { class: 'dice' }, this.pair);
  }

  show(values: [number, number] | null): void {
    this.stopTumble?.();
    // A one-die roll (rules v3, stride 1) is `[die, 0]`: one die shows, centred.
    const faces = rolledFaces(values ?? [5, 2]);
    this.setCount(faces.length === 1 ? 1 : 2);
    faces.forEach((n, i) => this.dice[i]!.set(n));
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

  /** The next roll is thrown with this aim (direction in stage px + strength); null = a weak toss forward. */
  aim(a: ThrowAim | null): void {
    this.aimV = a;
  }

  /**
   * One die or two (strategy mode's stride chips; a one-die roll). One: the second die is hidden
   * (`.is-single`) and the first stands centred where the pair stood.
   */
  setCount(n: 1 | 2): void {
    if (n === this.count) return;
    this.count = n;
    this.el.classList.toggle('is-single', n === 1);
  }

  /** The dice in play (the hidden second die is not thrown). */
  private get live(): Die[] {
    return this.dice.slice(0, this.count);
  }

  /** The Stage's turn (degrees): a one-die throw's frame (one point carries no turn). Set by the Stage. */
  turn: (() => number) | null = null;

  /**
   * A human's turn: the pair wobbles three times (~1.2 s), each lean with a soft rattle, and the
   * hint (`hint`, the roll card's "press, hold and flick" strip) blinks three times with it; then
   * everything holds still. Still waiting after 5 s: one more wobble and rattle, three more
   * blinks; then nothing (no idle load). The wobble is transform only, on the 30 Hz clock; the
   * pair is its own layer while invited, so the wobbles never repaint. The blink is an opacity
   * Web Animation on the hint's own layer (`.roll-hint.is-blink`): compositor-only. Reduced motion:
   * no wobble and no blink (the hint stays fully visible), the rattles still play at the same
   * times. A press stops all of it at once (`stopInvite`).
   */
  invite(hint: HTMLElement | null = null): void {
    this.stopInvite();
    if (headless()) return;
    const motion = !noMotion();
    if (motion) this.el.classList.add('is-inviting');
    // Stepped on the shared 30 Hz clock (not a Web Animation): a running transform animation makes
    // Chromium assume it overlaps everything painted above the dice, promoting (and re-rastering)
    // those layers when it starts and ends — the second wobble would break gate B's
    // compositor-only window. A style change on the pair's own layer is compositor-only.
    let stopW: (() => void) | null = null;
    const unblink = (): void => {
      for (const a of hint?.getAnimations() ?? []) a.cancel();
    };
    const wobble = (n: number): void => {
      stopW?.();
      const dur = D(400 * n);
      if (dur <= 0) return;
      let elapsed = 0;
      let last = -1;
      let rattles = 0;
      stopW = onFrame((now) => {
        if (last < 0 && motion && hint?.isConnected) {
          // Three pulses, ~1.2 s, starting with the wobble (the card is up by this first frame).
          unblink();
          void anim(hint, BLINK, { duration: 1200, easing: 'linear' });
        }
        if (last >= 0 && !isHeld()) elapsed += now - last;
        last = now;
        // A soft rattle at the start of each lean.
        while (rattles < n && elapsed >= (rattles * dur) / n) {
          rattles++;
          sfx.play('dice-shake', { gain: 0.45 });
          diceDev?.rattles.push(performance.now());
        }
        if (elapsed >= dur) {
          this.pair.style.transform = '';
          stopW = null;
          return false;
        }
        if (motion) this.pair.style.transform = wobbleAt((elapsed / dur) * n);
        return true;
      });
    };
    wobble(3);
    // A plain timer: a grid timeout set while a test's hand-driven clock runs would wait in manual
    // time after it stops.
    const id = window.setTimeout(() => wobble(1), 5000);
    this.inviteStop = () => {
      window.clearTimeout(id);
      stopW?.();
      stopW = null;
      unblink();
      this.pair.style.transform = '';
      this.el.classList.remove('is-inviting');
    };
  }

  stopInvite(): void {
    this.inviteStop?.();
    this.inviteStop = null;
  }

  /** Throw the dice in play onto `faces` (one face for one die, else two). */
  async roll(faces: readonly number[], doubles: boolean): Promise<void> {
    this.setCount(faces.length === 1 ? 1 : 2);
    const fs = faces.slice(0, this.count);
    this.shake(false);
    this.stopInvite();
    this.el.classList.remove('is-doubles');
    sfx.play('dice-shake');
    const aim = this.aimV;
    this.aimV = null;
    // Headless: nothing to show; reduced motion: the in-place roll (no trajectory, same time).
    const live = !headless() && typeof document !== 'undefined';
    const edges = live && !reducedMotion() ? (this.arena?.() ?? null) : null;
    const mode = rollMode({ headless: !live, reduced: reducedMotion(), measured: !!edges });
    const rec: ThrowRecord | null = diceDev
      ? { mode, kind: null, aim, faces: [...fs], planMs: 0, startedAt: performance.now(), endedAt: null, bounces: [], clacks: 0, travel: 0, box: null, bounds: null, view: null, screen: null, homes: null, speed: 0, pathLen: 0 }
      : null;
    if (rec) diceDev!.log.push(rec);
    if (mode === 'throw') await this.throwDice(fs, aim, edges!, rec);
    else await this.tumble(fs.map((n, i) => this.dice[i]!.plan(n, i * 60, i ? -1 : 1)));
    if (rec) rec.endedAt = performance.now();
    sfx.play('dice-land');
    haptic('light');
    // No total readout (owner, 2026-10-07): the faces are the number, and the token's walk shows it.
    if (doubles) {
      this.el.classList.add('is-doubles');
      sfx.play('doubles');
      haptic('success');
    }
  }

  /**
   * Die size and gap (layout px; also the skill ring's geometry) from the layout variables
   * (--ds = max(38px, 3.3 --u), gap 1.3 --u, --u = --board / 32), so they never force a layout.
   */
  sizes(): { ds: number; gap: number } {
    const board = parseFloat(document.documentElement.style.getPropertyValue('--board')) || 0;
    const u = board / 32;
    return { ds: Math.max(38, u * 3.3), gap: u * 1.3 };
  }

  /**
   * Throw the dice in play (throw.ts) onto `faces`: a flick off the screen's edges (in a flight
   * layer, `openFlight`), a toss inside `edges` (the dice area's die-edge walls, pair px).
   */
  private throwDice(faces: readonly number[], aim: ThrowAim | null, edges: Box, rec: ThrowRecord | null): Promise<void> {
    this.stopTumble?.();
    const { ds, gap } = this.sizes();
    // One die stands alone in the pair (the second is hidden): its home is the pair's only place.
    const homes: Vec[] = faces.map((_, i) => ({ x: ds / 2 + i * (ds + gap), y: ds / 2 }));
    // A toss's walls for the die CENTRES: half a die in, a little more at the top (the landing
    // bounce's lift stays under the round line) and the bottom (the contact shadow).
    const tossBox: Box = { left: edges.left + ds / 2, right: edges.right - ds / 2, top: edges.top + ds * 0.75, bottom: edges.bottom - ds * 0.7 };
    const poses = faces.map((n, i) => {
      const from = this.dice[i]!.restPose();
      return { from, to: this.dice[i]!.land(n) };
    });
    const flight = aim ? this.openFlight(homes, ds) : null;
    const plan = planThrow({ box: flight?.walls ?? tossBox, tossBox, homes, ds, aim, poses });
    if (rec) {
      rec.kind = plan.kind;
      rec.planMs = plan.total;
      rec.bounces = plan.dice.map((d) => d.bounces);
      rec.box = plan.box;
      rec.bounds = throwBounds(plan);
      rec.travel = throwTravel(plan);
      rec.speed = plan.speed;
      rec.pathLen = plan.path;
      if (flight) {
        const o = flight.at;
        const shift = (q: Box): Box => ({ left: q.left + o.x, right: q.right + o.x, top: q.top + o.y, bottom: q.bottom + o.y });
        rec.view = shift(flight.view);
        const c = [toScreen(flight.f, { x: rec.bounds.left, y: rec.bounds.top }), toScreen(flight.f, { x: rec.bounds.right, y: rec.bounds.bottom })];
        rec.screen = shift({ left: Math.min(c[0]!.x, c[1]!.x), right: Math.max(c[0]!.x, c[1]!.x), top: Math.min(c[0]!.y, c[1]!.y), bottom: Math.max(c[0]!.y, c[1]!.y) });
        rec.homes = homes.map((p) => {
          const q = toScreen(flight.f, p);
          return { x: q.x + o.x, y: q.y + o.y };
        });
      }
    }
    // A flick: the cubes move up into the flight layer (at their homes in its frame); an invisible
    // stand-in of the same size keeps each one's place in the pair.
    const live = this.live;
    const moved: [HTMLElement, HTMLElement][] = [];
    if (flight) {
      live.forEach((d, i) => {
        const ph = h('div', { class: 'die die-ph' });
        d.el.replaceWith(ph);
        d.el.style.left = `${(homes[i]!.x - ds / 2).toFixed(2)}px`;
        d.el.style.top = `${(homes[i]!.y - ds / 2).toFixed(2)}px`;
        flight.frame.append(d.el);
        moved.push([d.el, ph]);
      });
    }
    const draw = (t: number): void => samplePair(plan, t).forEach((s, i) => live[i]!.move(s.x - homes[i]!.x, s.y - homes[i]!.y + s.ty * ds, s.sx, s.sy, s.rx, s.ry));
    return this.fly(plan.total, plan.hits, draw, rec, () => {
      for (const [el, ph] of moved) {
        ph.replaceWith(el);
        el.style.left = '';
        el.style.top = '';
      }
      flight?.layer.remove();
    });
  }

  /**
   * A flick's flight layer: one top-level element over the game (above the board and the panels,
   * under the effects layer and the money stage; pointer-transparent; inside the safe area) with a
   * frame turned and scaled like the Stage, so the dice keep drawing in their own pair px and
   * keep their turn toward the seat. The frame is measured from where the two dice stand (one
   * layout read when the throw starts); the screen walls are the layer's box less a small margin.
   * Removed at the landing.
   */
  private openFlight(homes: Vec[], ds: number): Flight | null {
    const root = this.el.closest('.game') ?? document.body;
    const layer = h('div', { class: 'dice-fly', 'aria-hidden': 'true' });
    const frame = h('div', { class: 'dice-fly-frame' });
    layer.append(frame);
    root.append(layer);
    const lr = layer.getBoundingClientRect();
    const rects = this.live.map((d) => d.el.getBoundingClientRect());
    const centres = rects.map((r) => ({ x: r.left + r.width / 2 - lr.left, y: r.top + r.height / 2 - lr.top }));
    // Two dice give the turn and the scale; one die gives the scale, the Stage the turn.
    const f = homes.length > 1 ? frameFrom([homes[0]!, homes[1]!], [centres[0]!, centres[1]!]) : frameFromOne(homes[0]!, centres[0]!, this.turn?.() ?? 0, rects[0]!.width / ds);
    if (!(lr.width > ds && lr.height > ds && f.s > 0 && Number.isFinite(f.s + f.ox + f.oy))) {
      layer.remove();
      return null;
    }
    const m = Math.max(6, Math.min(lr.width, lr.height) * 0.012);
    const view: Box = { left: m, top: m, right: lr.width - m, bottom: lr.height - m };
    frame.style.transform = `translate(${f.ox.toFixed(2)}px, ${f.oy.toFixed(2)}px) rotate(${f.a}deg) scale(${f.s.toFixed(5)})`;
    return { layer, frame, f, at: { x: lr.left, y: lr.top }, walls: screenWalls(f, view, ds), view };
  }

  /**
   * Roll the dice in play on the shared 30 Hz clock for `total` ms (at speed 1): `draw(t)` poses
   * them each frame (t in those ms) and the wall `hits` clack on the way; one layer per die
   * meanwhile. At the end (`end` first) they rest on their faces, untransformed.
   */
  private fly(total: number, hits: readonly Hit[], draw: (t: number) => void, rec: ThrowRecord | null, end?: () => void): Promise<void> {
    const live = this.live;
    const duration = D(total);
    let elapsed = 0;
    let last = -1;
    let clack = 0;
    this.el.classList.add('is-rolling', 'is-flying');
    draw(0);
    return new Promise((resolve) => {
      const done = (): void => {
        this.stopTumble = null;
        end?.();
        for (const d of live) {
          d.el.style.transform = '';
          d.set(d.value);
        }
        this.el.classList.remove('is-rolling', 'is-flying');
        resolve();
      };
      const stopTick = onFrame((now) => {
        if (last >= 0) elapsed += (now - last) * (isSkipping() ? 5 : 1);
        last = now;
        const t = duration > 0 ? (elapsed / duration) * total : total;
        while (clack < hits.length && hits[clack]!.t <= t) {
          const hit = hits[clack++]!;
          sfx.play('dice-clack', { gain: 0.3 + 0.7 * hit.strength, pitch: 0.92 + 0.16 * hit.strength });
          haptic('tick');
          if (rec) rec.clacks++;
        }
        if (t >= total || !this.el.isConnected) {
          done();
          return false;
        }
        draw(t);
        return true;
      });
      this.stopTumble = () => {
        stopTick();
        done();
      };
    });
  }

  /**
   * The in-place roll (reduced motion, or no measured dice area): the dice tumble and bounce where
   * they stand (~1 s: `fly` without a path or a wall). It also plays under reduced motion: the
   * roll is the game's key reveal (time.ts policy).
   */
  private tumble(spins: Spin[]): Promise<void> {
    this.stopTumble?.();
    if (headless() || typeof document === 'undefined') return Promise.resolve();
    const { ds } = this.sizes();
    const live = this.live;
    const draw = (t: number): void =>
      spins.forEach((spin, i) => {
        const u = Math.min(1, Math.max(0, (t - spin.delay) / TUMBLE_MS));
        const e = ROLL_EASE(u);
        const [ty, sx, sy] = bounceAt(u);
        live[i]!.move(0, ty * ds, sx, sy, spin.x0 + (spin.x1 - spin.x0) * e, spin.y0 + (spin.y1 - spin.y0) * e);
      });
    return this.fly(TUMBLE_MS + Math.max(...spins.map((s) => s.delay)), [], draw, null);
  }

  /** Client centres of the two dice (fx `diceLand`); one layout read, only at the landing. */
  clientCenters(): { x: number; y: number }[] {
    return this.live.map((d) => {
      const r = d.el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
  }

  /** Client rect of the pair (the CPU hand presses the dice). */
  pairRect(): DOMRect {
    return this.pair.getBoundingClientRect();
  }

  dispose(): void {
    window.clearInterval(this.shakeTimer);
    this.stopInvite();
    this.stopTumble?.();
  }
}
