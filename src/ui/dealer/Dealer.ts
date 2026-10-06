/**
 * The dealer on the Stage (docs/superpowers/specs/2026-10-04-dealer-voice-design.md): the launcher
 * boy as a sprite + speech bubble. `say(line)` shows the line's expression, plays the Korean voice
 * (talking frames flap while it plays) or, silent, holds the bubble for a reading time, then goes
 * back to idle. One line at a time: a higher priority interrupts, anything else is dropped.
 *
 * Zero idle load (docs/PERFORMANCE.md, gate B): when a line ends the bubble only fades (its own
 * small layer, compositor-only), and the sprite keeps the line's expression until the next thing
 * happens — the next line, game event (`relax()`, from the director) or the player's input — and
 * goes back to idle then, together with that frame's own repaint. Swapping the sprite on the
 * timer repainted the stage while a human was deciding and nothing else moved.
 */
import { getLang } from '@/i18n';
import { playVoice, stopVoice } from '@/ui/audio/voice';
import { EASE } from '@/ui/fx/motion';
import { anim, animSpeed, gamePace, onFrame, reducedMotion } from '@/ui/fx/time';
import { h } from '@/ui/game/util';
import { DEALER_SPRITES, type DealerExpr, type DealerLine } from './lines';

const FLAP_MS = 120;
/** How long the expression shows before the mouth starts moving, and after it stops. */
const LEAD_MS = 350;
const TAIL_MS = 700;

const src = (name: string): string => `dealer/${name}.webp`;

export class Dealer {
  readonly el: HTMLElement;
  private img: HTMLImageElement;
  private bubble: HTMLElement;
  private text: HTMLElement;
  private current: DealerLine | null = null;
  private token = 0;
  private stopFlap: (() => void) | null = null;
  private hideTimer = 0;
  private preload: HTMLImageElement[];
  /** True while a line is being spoken (or read, when silent); the bubble may linger after. */
  private speaking = false;
  private quietWaiters: Array<() => void> = [];
  /** The line ended; the sprite goes back to idle with the next activity (see top). */
  private idleDue = false;
  private readonly onInput = (): void => this.relax();

  constructor(private readonly voiceOn: () => boolean) {
    this.img = h('img', { class: 'dealer-img', alt: '', src: src('idle'), draggable: 'false' });
    this.text = h('span', { class: 'dealer-text' });
    this.bubble = h('div', { class: 'dealer-bubble', role: 'status', 'aria-live': 'polite' }, this.text);
    this.el = h('div', { class: 'dealer' }, this.bubble, this.img);
    // Decode every sprite up front so expression swaps never flash.
    this.preload = DEALER_SPRITES.map((n) => {
      const i = new Image();
      i.src = src(n);
      return i;
    });
    window.addEventListener('pointerdown', this.onInput, { capture: true, passive: true });
    window.addEventListener('keydown', this.onInput, { capture: true, passive: true });
  }

  /** Something else is happening now (a game event, an input): a finished line's pose goes idle. */
  relax(): void {
    if (!this.idleDue) return;
    this.idleDue = false;
    this.setSprite('idle');
  }

  /** Is a line showing right now? */
  get busy(): boolean {
    return this.current !== null;
  }

  /**
   * Resolves when the current line has been said (at once when quiet), or after `maxMs` so a
   * stuck voice can never hold the game. The sequencer waits on this before turning the stage.
   */
  whenQuiet(maxMs = 6000): Promise<void> {
    if (!this.speaking) return Promise.resolve();
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = window.setTimeout(() => {
        this.quietWaiters = this.quietWaiters.filter((w) => w !== done);
        resolve();
      }, maxMs);
      this.quietWaiters.push(done);
    });
  }

  private setSpeaking(on: boolean): void {
    this.speaking = on;
    this.el.dataset.speaking = on ? '1' : '0';
    if (!on) {
      const waiters = this.quietWaiters;
      this.quietWaiters = [];
      waiters.forEach((w) => w());
    }
  }

  say(line: DealerLine): void {
    if (animSpeed() === 0) return;
    if (this.current && line.priority <= this.current.priority) return;
    const token = ++this.token;
    this.clear();
    this.idleDue = false;
    this.current = line;
    this.setSprite(line.expr);
    this.text.textContent = getLang() === 'ko' ? line.ko : line.en;
    this.el.classList.add('is-talking');
    this.setSpeaking(true);
    const shown = this.bubble.classList.contains('is-in');
    this.bubble.classList.remove('is-out');
    this.bubble.classList.add('is-in');
    // Pop in: a Web Animation on the shared 30 Hz clock, gone when it ends (the bubble's layer stays).
    if (!shown) void anim(this.bubble, [{ opacity: 0, transform: 'scale(0.85)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE.overshoot });

    const finish = (): void => {
      if (token !== this.token) return;
      this.setSpeaking(false);
      this.stopFlap?.();
      this.stopFlap = null;
      this.setSprite(line.expr);
      this.hideTimer = window.setTimeout(() => token === this.token && this.end(), TAIL_MS * gamePace());
    };

    // A line without a recorded voice yet (lines.ts VOICE_PENDING) is shown as text only.
    if (getLang() === 'ko' && this.voiceOn() && line.voice) {
      void playVoice(line.id, finish).then((ms) => {
        if (token !== this.token) return;
        if (ms === null) this.silent(line, token);
        else this.flapAfter(line.expr, token);
      });
    } else this.silent(line, token);
  }

  /** A new decision opened: drop a lingering lower-priority reaction so it does not talk over it. */
  dropBelow(priority: number): void {
    if (this.current && this.current.priority < priority) this.hush();
  }

  /** Stop talking now (game screen leaving, menu, game over cleanup). */
  hush(): void {
    this.token++;
    this.clear();
    this.end();
    this.relax();
  }

  dispose(): void {
    this.hush();
    window.removeEventListener('pointerdown', this.onInput, { capture: true });
    window.removeEventListener('keydown', this.onInput, { capture: true });
    this.preload.length = 0;
  }

  private silent(line: DealerLine, token: number): void {
    const text = getLang() === 'ko' ? line.ko : line.en;
    const ms = Math.max(1400, text.length * 75) * gamePace();
    this.hideTimer = window.setTimeout(() => {
      if (token !== this.token) return;
      this.setSpeaking(false);
      this.end();
    }, ms);
  }

  /** Expression first, then the mouth flaps (talk-a / talk-b) until the voice ends. */
  private flapAfter(expr: DealerExpr, token: number): void {
    if (reducedMotion()) return; // a still expression; the bubble carries the line
    let start = -1;
    let frame = -1;
    this.stopFlap = onFrame((now) => {
      if (token !== this.token) return false;
      if (start < 0) start = now;
      const t = now - start - LEAD_MS;
      if (t < 0) return true;
      const f = Math.floor(t / FLAP_MS) % 3;
      if (f !== frame) {
        frame = f;
        this.setSprite(f === 0 ? 'talk-a' : f === 1 ? 'talk-b' : expr);
      }
      return true;
    });
  }

  private setSprite(name: string): void {
    const next = src(name);
    if (!this.img.src.endsWith(next)) this.img.src = next;
  }

  private clear(): void {
    stopVoice();
    this.stopFlap?.();
    this.stopFlap = null;
    clearTimeout(this.hideTimer);
  }

  private end(): void {
    this.setSpeaking(false);
    this.current = null;
    this.el.classList.remove('is-talking');
    this.bubble.classList.remove('is-in');
    this.bubble.classList.add('is-out');
    this.idleDue = true;
  }
}
