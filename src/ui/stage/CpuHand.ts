/**
 * The CPU hand: before a CPU decision is dispatched, a white glove (icon `cpu-hand`, cuff in the
 * CPU player's color) reaches in from the CPU's seat edge, lands on the control it chose (the
 * prompt button, the roll pad, or the board space for board picks), presses it — the control shows the same
 * pressed state a finger gives it, with a ripple ring, and a board space is outlined — and the
 * controller dispatches at the release. The lift and exit play on under the decision's own
 * animation. A roll presses the dice on the roll pad, holds them while they rattle and flicks a
 * short stroke toward the board centre: the throw follows the stroke (`Dice.aim`), at a medium
 * strength picked per turn (`cpuFlick`: seeded by the game and the turn, so some CPU throws reach
 * the screen's edges and some stay short). In strategy mode (the skill throw) the hand acts out
 * exactly the engine AI's `Roll { stride, aim, accuracy }`: it switches to one die if the AI chose
 * stride 1 (the reachable spaces light up), presses (the ring runs), lets the needle reach the
 * phase of its accuracy, drags the arrow into the zone of its aim, and releases. Which control
 * each action maps to: `handTarget.ts`. Timings: `HAND` in fx/motion.ts.
 *
 * Coordinates: the hand lives in a board-sized layer rotated to the CPU's drawn seat (SEAT_ANGLE
 * of `HandPress.seat`, about the board centre = the Stage centre), so "up" points into the board
 * from that seat and the hand's bottom edge is the seat's edge. The target's client rect is read
 * once (after the Stage has stopped turning and the prompt has come in) and mapped into that
 * frame; after that only transform / opacity animate. The mapping only assumes the target is
 * axis-aligned on screen, so it holds both when the Stage has turned to the same seat (table
 * model) and when it stays upright for S while the hand comes from another edge (fixed view,
 * src/ui/orientation.ts): the target's size in the layer frame swaps by the LAYER's angle. Plain DOM, no canvas (the Android WebView draws
 * effect canvases as white boxes, docs/HANDOFF.md).
 *
 * Time policy (fx/time.ts): tweens through `anim` (speed, skip ×5, pause freezes them, reduced
 * motion holds them still: the hand then appears on the control), beats through `sleep` (× game
 * pace). Headless (speed 0): nothing is shown and no time passes. No timer or frame callback runs
 * when no hand is out; the layer exists only while a hand is.
 */
import type { Action, GameState, Seat } from '@/engine';
import { anim, D, frame, gamePace, headless, isHeld, noMotion, onFrame, sleep } from '@/ui/fx/time';
import { EASE, HAND } from '@/ui/fx/motion';
import { smoothstep } from '@/ui/fx/vfx/ease';
import { h, isDevHook, SEAT_ANGLE, svgNode } from '@/ui/game/util';
import type { Board } from '@/ui/board/Board';
import type { Stage } from './Stage';
import { cpuHandTarget, type HandTarget } from './handTarget';
import { cpuFlick, flickStrength } from './throw';
import { zoneLength } from './skill';

/** Fingertip in the 64×64 art (scripts/icons-src/buildings.mjs, 'cpu-hand'), as fractions. */
const TIP_X = 23.5 / 64;
const TIP_Y = 4 / 64;
/** Resting lean of the hand (deg): the finger tilts a little, like a real reach. */
const TILT = -10;

/** Dev/test record of one press (e2e/cpu-hand.spec.ts reads `window.__lotAndRoll.cpuHand()`). */
export interface HandRecord {
  phase: string;
  action: string;
  seat: Seat;
  target: HandTarget['kind'];
  /** The action, as JSON. */
  act: string;
  /** The control / space was found on screen. */
  found: boolean;
  /** What was pressed: the control's `data-action[:data-space]`, or `space:<i>` for a board space. */
  pressed: string | null;
  /** At the press, the measured fingertip lay inside the target's rect. */
  tipInside: boolean | null;
  /** The decision was still pending at the press (not dispatched yet). */
  pending: boolean;
  /** Fingertip and target centre (client px) at the press. */
  tip: { x: number; y: number } | null;
  at: { x: number; y: number; w: number; h: number } | null;
}

interface HandDev {
  log: HandRecord[];
  /** Hold every hand at its press until `release()` (screenshots). */
  freeze: boolean;
  release: (() => void) | null;
}

/** Dev only (`?dev=1`): press log + freeze switch; null in production. */
export const handDev: HandDev | null = typeof window !== 'undefined' && isDevHook() ? { log: [], freeze: false, release: null } : null;

interface HandPress {
  state: GameState;
  action: Action;
  /** The CPU's drawn seat (src/ui/orientation.ts): the edge the hand comes from. */
  seat: Seat;
  /** The CPU player's color (cuff, ring, board outline). */
  color: string;
  /** False once the decision is stale (state moved on, screen gone): the hand withdraws. */
  alive: () => boolean;
}

export class CpuHand {
  private layer: HTMLElement | null = null;
  private cleanup: (() => void) | null = null;

  constructor(
    private readonly board: Board,
    private readonly stage: Stage,
  ) {}

  /**
   * Show the hand pressing the control for `o.action`. Resolves at the release (dispatch now), or
   * early when there is nothing to press / the decision went stale. Never throws.
   */
  async press(o: HandPress): Promise<void> {
    try {
      await this.run(o);
    } catch (e) {
      console.error('[cpu-hand]', e);
      this.drop();
    }
  }

  private async run(o: HandPress): Promise<void> {
    if (headless()) return;
    const target = cpuHandTarget(o.state, o.action);
    const rec: HandRecord | null = handDev
      ? { phase: o.state.phase.kind, action: o.action.type, act: JSON.stringify(o.action), seat: o.seat, target: target.kind, found: false, pressed: null, tipInside: null, pending: true, tip: null, at: null }
      : null;
    if (rec) handDev!.log.push(rec);
    if (target.kind === 'none') return;
    await this.stage.whenSettled();
    if (!o.alive()) return;

    // The control (the prompt goes up on the frame after the CPU's turn starts: allow a few).
    let el: HTMLElement | null = null;
    const isPad = target.kind === 'pad';
    if (target.selector) {
      for (let k = 0; k < 4 && !el; k++) {
        el = isPad ? this.stage.rollPad : (this.stage.promptCard?.querySelector<HTMLElement>(target.selector) ?? null);
        if (!el) {
          await frame();
          if (!o.alive()) return;
        }
      }
    }
    if ((target.kind === 'control' || isPad) && !el) return;
    // A card that only just went up is still sliding in: read its rect once it has landed.
    await this.stage.whenSettled();
    if (!o.alive()) return;
    if (rec) {
      rec.found = true;
      rec.pressed = target.kind === 'space' ? `space:${target.space}` : `${el!.dataset.action}${el!.dataset.space ? `:${el!.dataset.space}` : ''}`;
    }

    // One read of the geometry, then transforms only.
    const bRect = this.board.el.getBoundingClientRect();
    if (!bRect.width) return;
    const S = this.board.el.offsetWidth || bRect.width;
    const k = S / bRect.width;
    // The pad: the hand presses the dice themselves (the pair, in the middle of the pad).
    const r = target.kind === 'space' ? this.board.spaceRect(target.space, bRect) : isPad ? this.stage.dice.pairRect() : el!.getBoundingClientRect();
    const radius = target.kind === 'space' || isPad ? '24%' : getComputedStyle(el!).borderRadius;
    const angle = SEAT_ANGLE[o.seat];
    const rad = (-angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const px = (r.x + r.width / 2 - bRect.left) * k - S / 2;
    const py = (r.y + r.height / 2 - bRect.top) * k - S / 2;
    // Target centre in the seat's frame (the layer is rotated by `angle` about the board centre).
    const cx = S / 2 + px * cos - py * sin;
    const cy = S / 2 + px * sin + py * cos;
    const sideways = Math.abs(angle) % 180 === 90;
    const tw = (sideways ? r.height : r.width) * k;
    const th = (sideways ? r.width : r.height) * k;
    // The fingertip lands right of and below the middle of a button (the hand then lies below and
    // right of it, toward the seat), so the label and price stay readable; a space: its middle.
    const qx = cx + (target.kind === 'control' && tw > th * 1.5 ? tw * 0.24 : 0);
    const qy = cy + (target.kind === 'control' ? th * 0.2 : 0);
    if (rec) rec.at = { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };

    const H = Math.round(Math.min(104, Math.max(44, S * 0.105)));
    const at = (x: number, y: number, rot: number, s: number): string =>
      `translate(${(x - TIP_X * H).toFixed(1)}px, ${(y - TIP_Y * H).toFixed(1)}px) rotate(${rot}deg) scale(${s})`;
    // From the seat's edge (inside the board: the hand never overlaps the seat panels' layers),
    // a little toward the middle, below the target.
    const sx = qx + (S / 2 - qx) * 0.3 + H * 0.25;
    const sy = Math.max(S - H * 0.95, qy + H * 0.8);

    this.drop();
    const layer = h('div', { class: 'cpu-hand-layer', 'aria-hidden': 'true' });
    layer.style.transform = `rotate(${angle}deg)`;
    const hand = h('div', { class: 'cpu-hand' });
    hand.append(svgNode('cpu-hand'));
    hand.style.width = `${H}px`;
    hand.style.height = `${H}px`;
    hand.style.color = o.color;
    const tipEl = rec ? h('i', { class: 'cpu-hand-tip' }) : null;
    if (tipEl) hand.append(tipEl);
    layer.append(hand);
    this.board.el.append(layer);
    this.layer = layer;

    const card = this.stage.promptCard;
    const pick = (on: boolean): void => {
      card?.classList.toggle('has-cpu-pick', on);
      card?.style.setProperty('--cpu-hand', o.color);
      el?.classList.toggle('is-cpu-pick', on);
    };
    const isRoll = isPad || (target.kind === 'control' && target.hold);
    const rollBtn = isPad || el?.classList.contains('roll-btn') ? el : null;
    const space = target.kind === 'pad' ? null : target.space;
    let unmark: (() => void) | null = null;
    let stopShake: (() => void) | null = null;
    const unpress = (): void => {
      el?.classList.remove('is-pressed');
      rollBtn?.classList.remove('is-held');
      stopShake?.();
      stopShake = null;
    };
    this.cleanup = () => {
      unpress();
      pick(false);
      unmark?.();
      unmark = null;
    };

    // 1. Reach: seat edge → control, ease-out with a small overshoot; fades in on the way.
    const reach = HAND.reachBase + HAND.reachPerPace * gamePace();
    hand.style.transform = at(qx, qy, TILT, 1);
    void anim(hand, [{ opacity: 0 }, { opacity: 1 }], { duration: Math.min(120, reach * 0.5), easing: 'linear' });
    await anim(hand, [{ transform: at(sx, sy, TILT - 14, 1) }, { transform: at(qx, qy, TILT, 1) }], { duration: reach, easing: EASE.reach });
    if (!o.alive()) return this.drop();

    // 2. Hover: the chosen control reads at full strength.
    pick(true);
    await sleep(HAND.hover);
    if (!o.alive()) return this.drop();

    // 3. Press: the hand squashes onto it; the control shows its pressed state, a ring ripples
    //    out of it, a board space is outlined in the CPU's color; a roll shakes the dice.
    // Strategy mode: the AI's roll, acted out on the skill pad.
    const roll = isPad && o.action.type === 'Roll' ? o.action : null;
    const skill = roll && typeof roll.accuracy === 'number' ? this.stage.skill : null;
    if (skill && roll!.stride === 1 && skill.stride !== 1) skill.setStride(1, true);
    if (rollBtn) rollBtn.classList.add('is-held');
    else el?.classList.add('is-pressed');
    if (isRoll) stopShake = this.shakeDice();
    if (space !== null) unmark = this.board.highlight(space, o.color, 60_000);
    this.ring(layer, hand, cx, cy, tw, th, radius, o.color);
    const up = at(qx, qy, TILT, 1);
    const down = at(qx, qy + H * 0.03, TILT, 0.86);
    hand.style.transform = down;
    await anim(hand, [{ transform: up }, { transform: down }], { duration: HAND.press, easing: EASE.settle });
    if (rec && tipEl) {
      const t = tipEl.getBoundingClientRect();
      rec.tip = { x: t.x, y: t.y };
      rec.tipInside = t.x >= r.x - 2 && t.x <= r.x + r.width + 2 && t.y >= r.y - 2 && t.y <= r.y + r.height + 2;
      rec.pending = o.alive();
    }
    if (skill) {
      // The needle runs, and stops where the AI's accuracy is (before or after the top, by turn).
      await skill.cpuRun(roll!.accuracy!, HAND.ringLead, o.state.turn % 2 ? 1 : -1);
    } else await sleep(isRoll ? HAND.holdRoll : HAND.hold);
    if (handDev?.freeze) {
      await new Promise<void>((res) => (handDev!.release = res));
      handDev.release = null;
    }
    if (!o.alive()) return this.drop();

    // 3b. A roll: a short stroke toward the board centre ("up" from the seat), the dice still in
    //     hand; the throw goes the way of the stroke (a little variety in its angle).
    let lifted = down;
    let rest = up;
    // The throw's seeded look for this turn (a roll again after doubles throws another way).
    const st = o.state;
    const look = cpuFlick(st.seed, st.turn, st.phase.kind === 'preRoll' && st.phase.rollAgain ? (st.lastDice?.[0] ?? 0) * 7 + (st.lastDice?.[1] ?? 0) : 0);
    if (skill) {
      // Drag the arrow into the aim's zone, toward the board centre (a seeded few degrees off).
      const L = zoneLength(roll!.aim) * this.stage.dice.sizes().ds;
      const pa = (look.angle * Math.PI) / 180;
      // In the hand's (seat) frame "up" is (0, -1); on the screen that is turned by the seat's angle.
      const hx = Math.sin(pa) * L;
      const hy = -Math.cos(pa) * L;
      const a = rad * -1 + pa;
      const u = this.stage.toLocal({ x: Math.sin(a), y: -Math.cos(a) });
      const ul = Math.hypot(u.x, u.y) || 1;
      const vx = (u.x / ul) * L;
      const vy = (u.y / ul) * L;
      const dur = D(HAND.drag);
      await new Promise<void>((done) => {
        let el = 0;
        let last = -1;
        onFrame((now) => {
          if (last >= 0 && !isHeld()) el += now - last;
          last = now;
          const k = dur > 0 ? Math.min(1, el / dur) : 1;
          const e = smoothstep(k);
          hand.style.transform = at(qx + hx * e, qy + hy * e, TILT + 4 * e, 0.86);
          skill.drag({ x: vx * e, y: vy * e });
          if (k >= 1 || !o.alive()) {
            done();
            return false;
          }
          return true;
        });
      });
      if (!o.alive()) return this.drop();
      const r = skill.release();
      this.stage.dice.aim(r.throwAim);
      lifted = at(qx + hx, qy + hy, TILT + 4, 0.86);
      rest = at(qx + hx, qy + hy - H * 0.2, TILT + 4, 1);
    } else if (isPad) {
      const flick = at(qx, qy - H * 0.55, TILT + 6, 0.9);
      hand.style.transform = flick;
      await anim(hand, [{ transform: down }, { transform: flick }], { duration: HAND.flick, easing: EASE.anticipate });
      if (!o.alive()) return this.drop();
      const a = rad * -1 + (look.angle * Math.PI) / 180;
      // Layer "up" (0, -1) on screen: the layer is rotated by `angle` about the board centre.
      const v = this.stage.toLocal({ x: Math.sin(a), y: -Math.cos(a) });
      this.stage.dice.aim({ ...v, strength: flickStrength(look.speed) });
      lifted = flick;
      rest = at(qx, qy - H * 0.7, TILT + 4, 1);
    }

    // 4. Release = dispatch (the caller dispatches when this resolves). Lift and leave meanwhile.
    unpress();
    this.leaving = this.leave(hand, layer, lifted, rest, at(sx, sy, TILT - 8, 1));
  }

  private leaving: Promise<void> = Promise.resolve();

  /**
   * Resolves when the last hand has lifted off and left (its layer is gone). A full-screen money
   * cut-in waits for it, so the hand is seen leaving and does not linger under the vignette.
   */
  whenGone(): Promise<void> {
    return this.layer ? this.leaving : Promise.resolve();
  }

  /** Lift off the control and slide back to the seat edge, fading; then remove everything. */
  private async leave(hand: HTMLElement, layer: HTMLElement, down: string, up: string, away: string): Promise<void> {
    try {
      hand.style.transform = up;
      await anim(hand, [{ transform: down }, { transform: up }], { duration: HAND.lift, easing: EASE.overshoot });
      if (this.layer !== layer) return;
      hand.style.transform = away;
      hand.style.opacity = '0';
      await anim(hand, [{ transform: up, opacity: 1 }, { transform: away, opacity: 0 }], { duration: HAND.exit, easing: EASE.anticipate });
    } finally {
      if (this.layer === layer) this.drop();
      else layer.remove();
    }
  }

  /**
   * Rattle the dice while the hand holds the roll button. The dice's own rattle is a plain timer
   * (sound + haptic ticks), outside the game clock, so it follows the pause here on the 30 Hz
   * clock: silent while the game is held, rattling again on resume, until the returned stop.
   */
  private shakeDice(): () => void {
    const dice = this.stage.dice;
    let on = false;
    const set = (v: boolean): void => {
      if (v === on) return;
      on = v;
      dice.shake(v);
    };
    set(!isHeld());
    const stop = onFrame(() => {
      set(!isHeld());
      return true;
    });
    return () => {
      stop();
      set(false);
    };
  }

  /** A ring rippling out of the pressed control (pure decoration: skipped without motion). */
  private ring(layer: HTMLElement, hand: HTMLElement, x: number, y: number, w: number, hgt: number, radius: string, color: string): void {
    if (noMotion()) return;
    const ring = h('div', { class: 'cpu-hand-ring' });
    ring.style.left = `${(x - w / 2).toFixed(1)}px`;
    ring.style.top = `${(y - hgt / 2).toFixed(1)}px`;
    ring.style.width = `${w.toFixed(1)}px`;
    ring.style.height = `${hgt.toFixed(1)}px`;
    ring.style.borderRadius = radius;
    ring.style.color = color;
    layer.insertBefore(ring, hand);
    void anim(ring, [{ transform: 'scale(.94)', opacity: 1 }, { transform: 'scale(1.18)', opacity: 0 }], { duration: HAND.ring, easing: EASE.settle }).then(() => ring.remove());
  }

  /** Remove the hand now and undo the control's pick / pressed state. */
  drop(): void {
    this.cleanup?.();
    this.cleanup = null;
    this.layer?.remove();
    this.layer = null;
  }

  dispose(): void {
    this.drop();
    if (handDev?.release) handDev.release();
  }
}
