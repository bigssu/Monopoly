/**
 * The dealer on the Stage (docs/superpowers/specs/2026-10-04-dealer-voice-design.md): the launcher
 * boy as a sprite + speech bubble. `say(line)` shows the line's expression, plays the voice in the app's
 * language (Korean `voice/<id>.ogg`, English `voice/en/<id>.ogg`; the mouth follows the voice, cadence.ts) or, silent, holds the bubble for a reading time, then goes
 * back to idle. One line at a time: a higher priority interrupts, anything else is dropped.
 *
 * Acting (docs/research/12-dealer-acting.md): a line starts with the body's take for its expression
 * (acting.ts: anticipation → action → follow-through, sized by the line's priority); the voice and
 * the bubble come in on the action, ANTICIPATION_MS later, so the pose reads before the sound.
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
import { bodyTake } from './acting';
import { lipTrack, MOUTH_HZ } from './cadence';
import { DEALER_SPRITES, type DealerExpr, type DealerLine } from './lines';

/** The body's anticipation before the voice and bubble come in (the dip of every take, acting.ts). */
const ANTICIPATION_MS = 120;
/** How long the expression holds after the voice stops. */
const TAIL_MS = 700;

/**
 * Every sprite comes from one atlas (scripts/dealer/pack-atlas.py: a 4 × 4 grid in DEALER_SPRITES
 * order): one file and one decode instead of 13, so an expression swap can never flash.
 */
export const DEALER_ATLAS = 'dealer/atlas.webp';
const ATLAS_COLS = 4;
const cellOf = (name: string): string => {
  const i = Math.max(0, (DEALER_SPRITES as readonly string[]).indexOf(name));
  const pos = (n: number): string => `${((n * 100) / (ATLAS_COLS - 1)).toFixed(4)}%`;
  return `${pos(i % ATLAS_COLS)} ${pos(Math.floor(i / ATLAS_COLS))}`;
};

export class Dealer {
  readonly el: HTMLElement;
  private img: HTMLElement;
  /** The sprite's own layer: the body takes move it (transform only). */
  private body: HTMLElement;
  private bubble: HTMLElement;
  private text: HTMLElement;
  private current: DealerLine | null = null;
  private token = 0;
  private stopFlap: (() => void) | null = null;
  private hideTimer = 0;
  private popTimer = 0;
  /** True while a line is being spoken (or read, when silent); the bubble may linger after. */
  private speaking = false;
  private quietWaiters: Array<() => void> = [];
  /** The line ended; the sprite goes back to idle with the next activity (see top). */
  private idleDue = false;
  private readonly onInput = (): void => this.relax();

  constructor(private readonly voiceOn: () => boolean) {
    this.img = h('div', { class: 'dealer-img', 'aria-hidden': 'true' });
    this.img.style.backgroundImage = `url(${DEALER_ATLAS})`;
    this.setSprite('idle');
    this.text = h('span', { class: 'dealer-text' });
    this.bubble = h('div', { class: 'dealer-bubble', role: 'status', 'aria-live': 'polite' }, this.text);
    this.body = h('div', { class: 'dealer-body' }, this.img);
    this.el = h('div', { class: 'dealer' }, this.bubble, this.body);
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
    const take = bodyTake(line.expr, line.priority);
    void anim(this.body, take.keyframes, { duration: take.ms, easing: 'linear' });
    // Overlapping action: the bubble comes in on the action beat, after the body's anticipation.
    const shown = this.bubble.classList.contains('is-in');
    const pop = (): void => {
      if (token !== this.token) return;
      this.bubble.classList.remove('is-out');
      this.bubble.classList.add('is-in');
      // Pop in: a Web Animation on the shared 30 Hz clock, gone when it ends (the bubble's layer stays).
      if (!shown) void anim(this.bubble, [{ opacity: 0, transform: 'scale(0.85)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE.overshoot });
    };
    if (shown || reducedMotion()) pop();
    else this.popTimer = window.setTimeout(pop, ANTICIPATION_MS);

    const finish = (): void => {
      if (token !== this.token) return;
      this.setSpeaking(false);
      this.stopFlap?.();
      this.stopFlap = null;
      this.setSprite(line.expr);
      this.hideTimer = window.setTimeout(() => token === this.token && this.end(), TAIL_MS * gamePace());
    };

    // A line without a recorded voice yet (lines.ts VOICE_PENDING) is shown as text only.
    if (this.voiceOn() && line.voice) {
      void playVoice(getLang() === 'ko' ? line.id : `en/${line.id}`, finish, ANTICIPATION_MS).then((v) => {
        if (token !== this.token) return;
        if (v === null) this.silent(line, token);
        else this.lipSync(line.expr, v.mouth, v.startAt, token);
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

  /**
   * The expression until the voice starts, then the mouth follows the voice frame by frame and the
   * expression comes back on the pauses between phrases (cadence.ts lipTrack).
   */
  private lipSync(expr: DealerExpr, mouth: Uint8Array, startAt: number, token: number): void {
    if (reducedMotion()) return; // a still expression; the bubble carries the line
    const track = lipTrack(mouth, expr);
    // The frame clock's time (manual in tests) and performance.now() may differ: align once.
    let start = NaN;
    this.stopFlap = onFrame((now) => {
      if (token !== this.token) return false;
      if (Number.isNaN(start)) start = startAt + (now - performance.now());
      const k = Math.floor(((now - start) * MOUTH_HZ) / 1000);
      if (k < 0) return true;
      this.setSprite(track[k] ?? expr);
      return k < track.length;
    });
  }

  private setSprite(name: string): void {
    if (this.img.dataset.sprite === name) return;
    this.img.dataset.sprite = name;
    this.img.style.backgroundPosition = cellOf(name);
  }

  private clear(): void {
    stopVoice();
    this.stopFlap?.();
    this.stopFlap = null;
    clearTimeout(this.hideTimer);
    clearTimeout(this.popTimer);
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
