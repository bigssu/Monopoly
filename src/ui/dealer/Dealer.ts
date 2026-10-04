/**
 * The dealer on the Stage (docs/superpowers/specs/2026-10-04-dealer-voice-design.md): the launcher
 * boy as a sprite + speech bubble. `say(line)` shows the line's expression, plays the Korean voice
 * (talking frames flap while it plays) or, silent, holds the bubble for a reading time, then goes
 * back to idle. One line at a time: a higher priority interrupts, anything else is dropped.
 */
import { getLang } from '@/i18n';
import { playVoice, stopVoice } from '@/ui/audio/voice';
import { gamePace, instant, onFrame } from '@/ui/fx/time';
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
  }

  /** Is a line showing right now? */
  get busy(): boolean {
    return this.current !== null;
  }

  say(line: DealerLine): void {
    if (instant()) return;
    if (this.current && line.priority <= this.current.priority) return;
    const token = ++this.token;
    this.clear();
    this.current = line;
    this.setSprite(line.expr);
    this.text.textContent = getLang() === 'ko' ? line.ko : line.en;
    this.el.classList.add('is-talking');
    this.bubble.classList.remove('is-out');
    this.bubble.classList.add('is-in');

    const finish = (): void => {
      if (token !== this.token) return;
      this.stopFlap?.();
      this.stopFlap = null;
      this.setSprite(line.expr);
      this.hideTimer = window.setTimeout(() => token === this.token && this.end(), TAIL_MS * gamePace());
    };

    if (getLang() === 'ko' && this.voiceOn()) {
      void playVoice(line.id, finish).then((ms) => {
        if (token !== this.token) return;
        if (ms === null) this.silent(line, token);
        else this.flapAfter(line.expr, token);
      });
    } else this.silent(line, token);
  }

  /** Stop talking now (game screen leaving, menu, game over cleanup). */
  hush(): void {
    this.token++;
    this.clear();
    this.end();
  }

  dispose(): void {
    this.hush();
    this.preload.length = 0;
  }

  private silent(line: DealerLine, token: number): void {
    const text = getLang() === 'ko' ? line.ko : line.en;
    const ms = Math.max(1400, text.length * 75) * gamePace();
    this.hideTimer = window.setTimeout(() => token === this.token && this.end(), ms);
  }

  /** Expression first, then the mouth flaps (talk-a / talk-b) until the voice ends. */
  private flapAfter(expr: DealerExpr, token: number): void {
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
    this.current = null;
    this.el.classList.remove('is-talking');
    this.bubble.classList.remove('is-in');
    this.bubble.classList.add('is-out');
    this.setSprite('idle');
  }
}
