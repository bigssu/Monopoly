/**
 * The skill throw's on-screen parts (strategy mode; docs/DESIGN.md "Skill throw", the rules in
 * `skill.ts`): the stride chips, the timing ring around the dice with its live accuracy, and the
 * aim arrow.
 *
 * - Stride chips (`chipsEl`, in the roll card): 하나 1–6 / 둘 2–12. A switch shows one die or two
 *   and lights the reachable spaces on the board for a moment (Board.highlight: static outlines,
 *   removed after `SKILL.reachMs` × pace).
 * - Ring (SVG in the dice pair, so it turns with the Stage toward the acting seat): a static track
 *   with the green band at the top while the roll is up; while pressed, a needle runs one lap per
 *   `ringPeriod` from the bottom, clockwise, the lap so far filled, and the accuracy reads beside it
 *   (`.skill-acc`). The needle and the readout are stepped on the shared 30 Hz clock ONLY while
 *   pressed; nothing runs at rest. Reduced motion (the app setting): no ring; the readout alone
 *   cycles on the same timing (text only).
 * - Arrow (SVG + a label, in a top-level layer `.skill-aim-layer` created at the drag and removed
 *   at the release, its frame turned and scaled like the Stage so the label reads upright for the
 *   acting seat and a long arrow may reach over the board): from the ring's edge in the drag's
 *   direction, as long as the drag; the guide behind it shows the three zones (blue 작게, grey
 *   보통, orange 크게) with ticks at the thresholds; the tip label names the aim and its band.
 *
 * The human's pointer handling is in prompts.ts (`rollPrompt`); the CPU hand drives the same pad
 * (`cpuRun`, `drag`, `release`) so a CPU's throw is seen made by the same rules.
 */
import { SKILL_BANDS } from '@/engine';
import { t } from '@/i18n';
import { sfx } from '@/ui/audio/sfx';
import { haptic } from '@/ui/audio/haptics';
import { anim, animSpeed, DEFAULT_PACE, gamePace, gridTimeout, isHeld, isSkipping, onFrame, reducedMotion } from '@/ui/fx/time';
import { h, isDevHook, svgEl } from '@/ui/game/util';
import type { Board } from '@/ui/board/Board';
import type { Dice } from './Dice';
import type { Stage } from './Stage';
import { accuracyAt, aimOf, deadZone, dragStrength, pct, phaseFor, ringPeriod, ringPhase, SKILL, strideRange, strideReach, zoneOf, type Aim, type Stride, type Zone } from './skill';
import type { ThrowAim, Vec } from './throw';


/** What a release throws: the zone, the aim (none for 보통 / a tap), the accuracy, the throw itself. */
export interface SkillResult {
  zone: Zone;
  aim?: Aim;
  accuracy: number;
  stride: Stride;
  /** Direction (stage px) + strength (the arrow's length); null = a tap (a weak toss). */
  throwAim: ThrowAim | null;
}

/** Dev only (`?dev=1`): every skill roll the pad sent (e2e reads `__lotAndRoll.skill()`). */
export const skillDev: { rolls: SkillResult[] } | null = typeof window !== 'undefined' && isDevHook() ? { rolls: [] } : null;

/** Zone colours (on the dark stage: ≥ 4.5:1 for the label ink #0B2230 on each). */
export const ZONE_COLOR: Record<Exclude<Zone, 'tap'>, string> = { low: '#5BB2FF', mid: '#C3CDD6', high: '#FF9A3D' };

/** A chevron (down = 작게, up = 크게) as an inline SVG string. */
export function chevron(dir: 'up' | 'down'): string {
  const pts = dir === 'up' ? '8,3 14.5,12.5 1.5,12.5' : '1.5,3.5 14.5,3.5 8,13';
  return `<svg class="skill-chev" viewBox="0 0 16 16" aria-hidden="true"><polygon points="${pts}" fill="currentColor"/></svg>`;
}

/** The label of a zone for a stride: `작게 2–5`, `보통`, `크게 9–12` (one die: 1–2 / 5–6). */
export function zoneText(zone: Exclude<Zone, 'tap'>, stride: Stride): string {
  const aim = aimOf(zone);
  if (!aim) return t('g.aim.mid');
  const [lo, hi] = SKILL_BANDS[stride][aim];
  return `${t(`g.aim.${aim}`)} ${lo}–${hi}`;
}

export class SkillPad {
  /** The stride chips (the roll card puts them above its hint). */
  readonly chipsEl: HTMLElement;
  private chipBtns: HTMLButtonElement[] = [];
  private ring: SVGSVGElement;
  private paths: { fill: SVGPathElement; needle: SVGPathElement; needleRim: SVGPathElement; all: SVGPathElement[] };
  private readout: HTMLElement;
  stride: Stride = 2;
  private ds = 0;
  private unmark: (() => void)[] = [];
  // Press state.
  private pressed = false;
  private stopTick: (() => void) | null = null;
  private elapsed = 0;
  private last = -1;
  private period: number = SKILL.periodMs;
  private phase = 0;
  private acc = 0;
  private locked = false;
  private v: Vec = { x: 0, y: 0 };
  private dirty = false;
  private target: { at: number; phase: number; done: () => void } | null = null;
  // Arrow.
  private aimLayer: HTMLElement | null = null;
  private aimParts: { g: SVGGElement; shaft: SVGLineElement; head: SVGPolygonElement; segs: SVGLineElement[]; ticks: SVGLineElement[]; label: HTMLElement } | null = null;
  private ringRx = 0;
  private ringRy = 0;
  /** The arrow layer's box and the frame's origin / turn / scale (client px), to keep the label on screen. */
  private view = { w: 0, h: 0, cx: 0, cy: 0, angle: 0, s: 1 };

  constructor(
    private readonly o: { stage: Stage; dice: Dice; board: Board; position: number; boardSize: number; express: boolean; color: string; cpu: boolean; strideChoice: boolean },
  ) {
    this.chipsEl = h('div', { class: 'stride-chips', role: 'group', 'aria-label': t('g.stride.label') });
    if (o.strideChoice) {
      for (const n of [1, 2] as const) {
        const [lo, hi] = strideRange(n);
        const b = h('button', { class: 'stride-chip', type: 'button', 'data-stride': n, 'aria-pressed': n === 2 ? 'true' : 'false' }) as HTMLButtonElement;
        b.append(h('b', { text: t(`g.stride.${n}`) }), h('span', { class: 'num', text: t('g.stride.range', { lo, hi }) }));
        if (o.cpu) b.disabled = true;
        else
          b.addEventListener('click', () => {
            if (this.pressed || n === this.stride) return;
            sfx.play('tap');
            haptic('light');
            this.setStride(n, true);
          });
        this.chipBtns.push(b);
        this.chipsEl.append(b);
      }
    }
    // The ring: every part is the same stadium path (pathLength 100: 0 = bottom, clockwise, 50 = top).
    this.ring = svgEl('svg', { class: 'skill-ring', 'aria-hidden': 'true' });
    const mk = (cls: string): SVGPathElement => svgEl('path', { class: cls, pathLength: 100 });
    const track = mk('sr-track');
    const glow = mk('sr-band-glow');
    const band = mk('sr-band');
    const mark = mk('sr-mark');
    const fill = mk('sr-fill');
    const needleRim = mk('sr-needle-rim');
    const needle = mk('sr-needle');
    const B = SKILL.band * 100;
    for (const p of [glow, band]) {
      p.setAttribute('stroke-dasharray', `${2 * B} ${100 - 2 * B}`);
      p.setAttribute('stroke-dashoffset', String(-(50 - B)));
    }
    mark.setAttribute('stroke-dasharray', '0.6 99.4');
    mark.setAttribute('stroke-dashoffset', '-49.7');
    this.ring.append(track, glow, band, mark, fill, needleRim, needle);
    this.paths = { fill, needle, needleRim, all: [track, glow, band, mark, fill, needleRim, needle] };
    this.readout = h('div', { class: 'skill-acc', 'aria-hidden': 'true' });
    this.o.dice.pair.append(this.ring, this.readout);
    this.layout();
    this.drawNeedle(0, false);
  }

  /** One die or two; `light`: show the reachable spaces for a moment (a stride switch). */
  setStride(n: Stride, light: boolean): void {
    this.stride = n;
    for (const b of this.chipBtns) b.setAttribute('aria-pressed', String(Number(b.dataset.stride) === n));
    this.o.dice.setCount(n);
    this.layout();
    if (light) this.lightReach();
  }

  /**
   * Light the spaces this stride can reach for a moment: the board's picking look (the others
   * dimmed, the reachable ones outlined; nothing tappable), plus an outline in the player's colour.
   */
  private lightReach(): void {
    for (const u of this.unmark) u();
    this.unmark = [];
    const ms = (SKILL.reachMs * gamePace()) / DEFAULT_PACE;
    const reach = strideReach(this.o.position, this.stride, this.o.boardSize, this.o.express);
    const board = this.o.board;
    board.setPicking(reach);
    for (const i of reach) this.unmark.push(board.highlight(i, this.o.color, ms));
    let on = true;
    const off = (): void => {
      if (!on) return;
      on = false;
      board.setPicking(null);
    };
    const stop = gridTimeout(off, ms);
    this.unmark.push(() => {
      stop();
      off();
    });
  }

  /** Size the ring around the dice in play (pair px: it scales and turns with the Stage). */
  private layout(): void {
    const { ds, gap } = this.o.dice.sizes();
    this.ds = ds;
    const pairW = this.stride * ds + (this.stride - 1) * gap;
    const m = ds * 0.42;
    const W = pairW + 2 * m;
    const H = ds + 2 * m;
    const r = H / 2;
    const d = `M ${W / 2} ${H} H ${r} A ${r} ${r} 0 0 1 ${r} 0 H ${W - r} A ${r} ${r} 0 0 1 ${W - r} ${H} Z`;
    this.ring.setAttribute('viewBox', `0 0 ${W.toFixed(1)} ${H.toFixed(1)}`);
    Object.assign(this.ring.style, { left: `${-m}px`, top: `${-m}px`, width: `${W}px`, height: `${H}px` });
    this.ring.style.setProperty('--sw', `${(ds * 0.15).toFixed(2)}px`);
    for (const p of this.paths.all) p.setAttribute('d', d);
    this.readout.style.left = `${(pairW + m + ds * 0.14).toFixed(1)}px`;
    this.readout.style.top = `${(-m).toFixed(1)}px`;
  }

  /** The needle at phase `u` (and the lap so far filled); `live`: the readout too. */
  private drawNeedle(u: number, live: boolean): void {
    const k = (u * 100).toFixed(2);
    this.paths.fill.setAttribute('stroke-dasharray', `${k} 100`);
    for (const p of [this.paths.needle, this.paths.needleRim]) {
      p.setAttribute('stroke-dasharray', '0.01 99.99');
      p.setAttribute('stroke-dashoffset', `-${k}`);
    }
    this.ring.dataset.phase = u.toFixed(3);
    if (!live) return;
    const a = accuracyAt(u);
    this.ring.dataset.acc = a.toFixed(3);
    this.readout.textContent = t('g.skill.acc', { n: pct(a) });
    this.readout.dataset.tier = a >= 0.75 ? 'hi' : a >= 0.35 ? 'mid' : a > 0 ? 'lo' : 'off';
  }

  /** Accuracy at the moment (the locked one once the drag started). */
  get accuracy(): number {
    return this.acc;
  }

  /** Press: the needle starts at the bottom and runs; the readout shows the live accuracy. */
  press(): void {
    if (this.pressed) return;
    this.pressed = true;
    this.locked = false;
    this.elapsed = 0;
    this.last = -1;
    this.phase = 0;
    this.acc = 0;
    this.v = { x: 0, y: 0 };
    this.period = ringPeriod(gamePace(), DEFAULT_PACE);
    for (const b of this.chipBtns) b.disabled = true;
    const rm = reducedMotion();
    this.ring.classList.toggle('is-rm', rm);
    this.readout.classList.toggle('is-rm', rm);
    this.ring.classList.add('is-live');
    this.readout.classList.add('is-on');
    this.drawNeedle(0, true);
    this.stopTick = onFrame((now) => this.tick(now));
  }

  private tick(now: number): boolean {
    if (!this.locked) {
      if (this.last >= 0 && !isHeld()) this.elapsed += (now - this.last) * animSpeed() * (isSkipping() ? 5 : 1);
      this.last = now;
      const tg = this.target;
      if (tg && this.elapsed >= tg.at) {
        // A CPU stops the ring exactly where its accuracy is.
        this.phase = tg.phase;
        this.drawNeedle(this.phase, true);
        this.lock(accuracyAt(tg.phase));
        this.target = null;
        tg.done();
      } else {
        this.phase = ringPhase(this.elapsed, this.period);
        this.acc = accuracyAt(this.phase);
        this.drawNeedle(this.phase, true);
      }
    }
    if (this.dirty) {
      this.dirty = false;
      this.drawArrow();
    }
    return true;
  }

  /** Freeze the accuracy (the drag started; a CPU's chosen moment). */
  private lock(acc = this.acc): void {
    if (this.locked) return;
    this.locked = true;
    this.acc = acc;
    this.ring.classList.add('is-locked');
    this.readout.classList.add('is-locked');
    haptic('tick');
  }

  /** The drag so far (stage px from the press point). The arrow is drawn on the next clock frame. */
  drag(v: Vec): void {
    if (!this.pressed) return;
    this.v = v;
    if (zoneOf(Math.hypot(v.x, v.y) / this.dsOf(), this.dsOf()) !== 'tap') this.lock();
    this.dirty = true;
  }

  private dsOf(): number {
    return this.ds || 100;
  }

  /** The zone of the drag so far. */
  get zone(): Zone {
    return zoneOf(Math.hypot(this.v.x, this.v.y) / this.dsOf(), this.dsOf());
  }

  /**
   * A CPU's press: the ring runs until it reaches the phase of `accuracy` (at least `minMs` after
   * the press, so the needle is seen running), stops there and locks. Resolves then.
   */
  cpuRun(accuracy: number, minMs: number, side: -1 | 1 = -1): Promise<void> {
    this.press();
    const ph = phaseFor(accuracy, side);
    const P = this.period;
    let at = ph * P;
    while (at < minMs) at += P;
    return new Promise((resolve) => {
      this.target = { at, phase: ph, done: resolve };
    });
  }

  /** Release: what to throw. The visuals go (the ring with the dice' flight; the arrow at once). */
  release(): SkillResult {
    const zone = this.zone;
    const acc = this.locked ? this.acc : accuracyAt(this.phase);
    const L = Math.hypot(this.v.x, this.v.y) / this.dsOf();
    const res: SkillResult = {
      zone,
      aim: aimOf(zone),
      accuracy: Math.round(acc * 1000) / 1000,
      stride: this.stride,
      throwAim: zone === 'tap' ? null : { x: this.v.x, y: this.v.y, strength: dragStrength(L, this.dsOf()) },
    };
    // The arrow stays a moment as the dice leave along it, then fades (the CPU's is seen too).
    const layer = this.aimLayer;
    this.aimLayer = null;
    if (layer) void anim(layer, [{ opacity: 1 }, { opacity: 0 }], { duration: 320 }).then(() => layer.remove());
    this.end();
    this.ring.classList.add('is-gone');
    this.readout.classList.add('is-gone');
    skillDev?.rolls.push(res);
    return res;
  }

  /** A cancelled press: back to rest (no throw). */
  cancel(): void {
    this.end();
    this.drawNeedle(0, false);
    this.readout.classList.remove('is-on', 'is-locked');
    this.ring.classList.remove('is-live', 'is-locked');
    for (const b of this.chipBtns) b.disabled = this.o.cpu;
  }

  private end(): void {
    this.pressed = false;
    this.stopTick?.();
    this.stopTick = null;
    if (this.target) {
      const done = this.target.done;
      this.target = null;
      done();
    }
    this.aimLayer?.remove();
    this.aimLayer = null;
    this.aimParts = null;
  }

  // --- Arrow ------------------------------------------------------------------------------------

  /** The arrow's layer: over the game, its frame at the dice's centre, turned and scaled like the Stage. */
  private openArrow(): boolean {
    const root = this.o.dice.el.closest('.game') ?? document.body;
    const f = this.o.stage.diceFrame();
    if (!f) return false;
    const layer = h('div', { class: 'skill-aim-layer', 'aria-hidden': 'true' });
    root.append(layer);
    const lr = layer.getBoundingClientRect();
    const frame = h('div', { class: 'skill-aim-frame' });
    this.view = { w: lr.width, h: lr.height, cx: f.cx - lr.left, cy: f.cy - lr.top, angle: f.angle, s: f.s };
    frame.style.transform = `translate(${(f.cx - lr.left).toFixed(1)}px, ${(f.cy - lr.top).toFixed(1)}px) rotate(${f.angle}deg) scale(${f.s.toFixed(4)})`;
    layer.append(frame);
    // The ring's half-axes and the die, in the Stage's px (the dice area may be scaled under the card).
    const rr = this.ring.getBoundingClientRect();
    const side = Math.abs(f.angle) % 180 === 90;
    this.ringRx = (side ? rr.height : rr.width) / f.s / 2;
    this.ringRy = (side ? rr.width : rr.height) / f.s / 2;
    const ds = this.dsOf();
    const svg = svgEl('svg', { class: 'skill-aim', width: 1, height: 1 });
    const g = svgEl('g');
    const segs = (['low', 'mid', 'high'] as const).map((z) => svgEl('line', { class: `sa-seg is-${z}`, stroke: ZONE_COLOR[z], 'stroke-width': ds * 0.16, y1: 0, y2: 0 }));
    const ticks = [0, 1].map(() => svgEl('line', { class: 'sa-tick', 'stroke-width': ds * 0.05 }));
    const shaft = svgEl('line', { class: 'sa-shaft', 'stroke-width': ds * 0.2, y1: 0, y2: 0 });
    const head = svgEl('polygon', { class: 'sa-head' });
    g.append(...segs, ...ticks, shaft, head);
    svg.append(g);
    const label = h('div', { class: 'skill-aim-label' });
    frame.append(svg, label);
    this.aimLayer = layer;
    this.aimParts = { g, shaft, head, segs, ticks, label };
    return true;
  }

  /** Draw the arrow for the drag so far (on the clock frame). */
  private drawArrow(): void {
    const zone = this.zone;
    if (zone === 'tap') {
      if (this.aimLayer) this.aimLayer.style.visibility = 'hidden';
      return;
    }
    if (!this.aimLayer && !this.openArrow()) return;
    this.aimLayer!.style.visibility = '';
    const p = this.aimParts!;
    const ds = this.dsOf();
    const { x, y } = this.v;
    const th = Math.atan2(y, x);
    // The ring's edge in that direction (an ellipse through the stadium's ends and sides).
    const a = this.ringRx;
    const b = this.ringRy;
    const e = (a * b) / Math.hypot(b * Math.cos(th), a * Math.sin(th)) + ds * 0.06;
    const L = Math.min(SKILL.max, Math.hypot(x, y) / ds);
    const tip = e + L * ds;
    const dz = deadZone(ds);
    const at = (k: number): number => e + k * ds;
    const spans: [number, number][] = [
      [at(dz), at(SKILL.short)],
      [at(SKILL.short), at(SKILL.long)],
      [at(SKILL.long), at(SKILL.max)],
    ];
    p.segs.forEach((s, i) => {
      s.setAttribute('x1', (spans[i]![0] + ds * 0.04).toFixed(1));
      s.setAttribute('x2', (spans[i]![1] - ds * 0.04).toFixed(1));
    });
    [SKILL.short, SKILL.long].forEach((k, i) => {
      const tk = p.ticks[i]!;
      tk.setAttribute('x1', at(k).toFixed(1));
      tk.setAttribute('x2', at(k).toFixed(1));
      tk.setAttribute('y1', (-ds * 0.24).toFixed(1));
      tk.setAttribute('y2', (ds * 0.24).toFixed(1));
    });
    const hl = ds * 0.42;
    const hw = ds * 0.3;
    const color = ZONE_COLOR[zone];
    p.shaft.setAttribute('x1', e.toFixed(1));
    p.shaft.setAttribute('x2', Math.max(e, tip - hl * 0.8).toFixed(1));
    p.shaft.setAttribute('stroke', color);
    p.head.setAttribute('points', `${tip.toFixed(1)},0 ${(tip - hl).toFixed(1)},${(-hw).toFixed(1)} ${(tip - hl).toFixed(1)},${hw.toFixed(1)}`);
    p.head.setAttribute('fill', color);
    p.g.setAttribute('transform', `rotate(${((th * 180) / Math.PI).toFixed(2)})`);
    // The label beyond the tip, upright for the acting seat (the frame is the Stage's), kept on
    // the screen: pulled back along the arrow when the tip nears an edge.
    const r = Math.min(tip + ds * 0.85, this.roomFor(th, ds));
    p.label.style.transform = `translate(${(Math.cos(th) * r).toFixed(1)}px, ${(Math.sin(th) * r).toFixed(1)}px) translate(-50%, -50%)`;
    if (p.label.dataset.zone !== zone || p.label.dataset.stride !== String(this.stride)) {
      p.label.dataset.zone = zone;
      p.label.dataset.stride = String(this.stride);
      p.label.style.setProperty('--zc', color);
      const aim = aimOf(zone);
      p.label.innerHTML = `${aim ? chevron(aim === 'low' ? 'down' : 'up') : ''}<span></span>`;
      p.label.lastElementChild!.textContent = zoneText(zone, this.stride);
      if (aim) haptic('tick');
    }
  }

  /** How far (frame px) the label's centre may go from the dice in direction `th` and stay on screen. */
  private roomFor(th: number, ds: number): number {
    const v = this.view;
    const a = th + (v.angle * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    // The label's half extent on the screen (about four characters wide, one line high).
    const hx = ds * 1.5 * v.s;
    const hy = ds * 0.45 * v.s;
    let t = Infinity;
    if (dx > 1e-6) t = Math.min(t, (v.w - hx - v.cx) / dx);
    if (dx < -1e-6) t = Math.min(t, (hx - v.cx) / dx);
    if (dy > 1e-6) t = Math.min(t, (v.h - hy - v.cy) / dy);
    if (dy < -1e-6) t = Math.min(t, (hy - v.cy) / dy);
    return Math.max(0, t / v.s);
  }

  dispose(): void {
    this.end();
    for (const u of this.unmark) u();
    this.unmark = [];
    this.ring.remove();
    this.readout.remove();
  }
}
