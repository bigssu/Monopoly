/**
 * Game store + loop.
 *
 *  dispatch(action) → isLegal? → reduce → saveGame → play events (sequencer) → advance()
 *  advance(): game over → onGameOver; CPU → wait 600–1100 ms (scaled) → chooseAction;
 *             human → prompt card for `state.phase` (with the soft timer → defaultAction).
 */
import {
  chooseAction,
  defaultAction,
  initialEvents,
  isLegal,
  reduce,
  type Action,
  type GameEvent,
  type GameState,
} from '@/engine';
import { t } from '@/i18n';
import { sfx } from '@/ui/audio/sfx';
import { playEvents } from '@/ui/fx/animate';
import { animSpeed, D, endSkip, frame, instant, onFrame, skip } from '@/ui/fx/time';
import { buildPromptFor } from '@/ui/stage/prompts';
import { saveGame } from '@/ui/shell/persist';
import { prefs } from '@/ui/shell/prefs';
import type { GameView } from './view';
import { isDevHook } from './util';

type PromptStat = { kind: string; cpu: boolean; els: number; ms: number };
/** Dev only: per-prompt build stats, `window.__lrPromptStats` (null in production). */
const PROMPT_STATS: PromptStat[] | null =
  typeof window !== 'undefined' && isDevHook()
    ? (((window as unknown as { __lrPromptStats?: PromptStat[] }).__lrPromptStats ??= []))
    : null;

export interface ControllerOpts {
  view: GameView;
  state: GameState;
  onGameOver: (state: GameState) => void;
}

export class GameController {
  state: GameState;
  readonly view: GameView;
  private busy = false;
  private disposed = false;
  private paused = false;
  /** Cancels the pending CPU move (a plain timeout; its animation starts on the next grid frame). */
  private cancelCpu: () => void = () => {};
  /** Pending deferred prompt (see advance). */
  private cancelPrompt: (() => void) | null = null;
  private promptSeq = 0;
  private onGameOver: (s: GameState) => void;
  private gameOverFired = false;
  /** Dev/test override for the prompt timer (seconds; null = prefs). */
  timerOverride: number | null = null;
  private idleWaiters: Array<() => void> = [];

  constructor(opts: ControllerOpts) {
    this.state = opts.state;
    this.view = opts.view;
    this.onGameOver = opts.onGameOver;
    // Tap during playback = fast-forward (the menu sits above and stays usable).
    this.view.table.addEventListener('pointerdown', () => {
      if (this.busy) {
        skip();
        // Pending fx cues (state swaps) fire now; running effects finish ×5.
        this.view.vfx.skip();
        this.view.stage.hurry();
      }
    });
  }

  /** Start: `fresh` plays the opening events (turn banner), otherwise just renders (resume). */
  async start(fresh: boolean): Promise<void> {
    const s = this.state;
    this.view.render(s);
    const cur = s.players[s.current]!;
    this.view.stage.setTurn(cur, s);
    this.view.stage.dice.show(s.lastDice);
    this.view.board.setActiveToken(s.current);
    // Busy while the opening plays: no prompt is up yet, so nothing may act (dev hook too).
    this.busy = true;
    try {
      if (fresh) await this.play(s, initialEvents(s), s);
      else await this.view.stage.rotateTo(this.actingSeat());
    } finally {
      this.busy = false;
    }
    if (!this.disposed) this.advance();
  }

  isBusy(): boolean {
    return this.busy;
  }

  private actingSeat() {
    const ph = this.state.phase;
    const pid = ph.kind === 'gameOver' ? ph.result.winnerId : ph.playerId;
    return this.state.players[pid]!.seat;
  }

  private async play(prev: GameState, events: GameEvent[], next: GameState): Promise<void> {
    this.view.root.classList.add('is-playing');
    await playEvents(this.view, prev, events, next, () => !this.disposed);
    endSkip();
    this.view.root.classList.remove('is-playing');
  }

  /** Validate, reduce, persist, animate, continue. Resolves when the animations are done. */
  async dispatch(action: Action, opts: { deferPlay?: boolean } = {}): Promise<boolean> {
    if (this.busy || this.disposed) return false;
    if (!isLegal(this.state, action)) {
      sfx.play('error');
      return false;
    }
    this.busy = true;
    this.cancelCpu();
    this.clearPromptUi();
    const prev = this.state;
    let result;
    try {
      result = reduce(prev, action);
    } catch (e) {
      console.error('[game] reduce failed', e);
      this.busy = false;
      this.advance();
      return false;
    }
    this.state = result.state;
    try {
      saveGame(result.state);
    } catch (e) {
      console.warn('[game] save failed', e);
    }
    // CPU turns: the decision, `reduce` and the save ran in a plain task; the animation starts on
    // the next 30 Hz frame, so that frame carries only the first event's DOM work.
    if (opts.deferPlay && !instant()) await frame();
    await this.play(prev, result.events, result.state);
    this.busy = false;
    if (!this.disposed) this.advance();
    return true;
  }

  private clearPromptUi(): void {
    const { stage, board } = this.view;
    this.promptSeq++;
    this.cancelPrompt?.();
    this.cancelPrompt = null;
    stage.clearPrompt();
    stage.hideInfo();
    stage.setThinking(false);
    board.setPicking(null);
    board.setFocus(null);
  }

  private timerSeconds(): number {
    if (this.timerOverride !== null) return this.timerOverride;
    const ph = this.state.phase;
    let sec: number;
    try {
      sec = prefs.get().promptTimer;
    } catch {
      sec = this.state.settings.promptTimer;
    }
    if (ph.kind === 'auction') return 10;
    return sec;
  }

  private advance(): void {
    if (this.disposed || this.busy) return;
    const s = this.state;
    if (s.phase.kind === 'gameOver') {
      this.clearPromptUi();
      if (!this.gameOverFired) {
        this.gameOverFired = true;
        this.onGameOver(s);
      }
      this.flushIdle();
      return;
    }
    if (this.paused) return;
    const pid = s.phase.playerId;
    const p = s.players[pid]!;
    const { stage } = this.view;
    this.clearPromptUi();
    void stage.rotateTo(p.seat);
    // The new prompt goes in on the next 30 Hz frame, not in the frame that just took the last
    // event's DOM changes (landing token, board space, panels) and the old prompt's removal:
    // together they were one 35-60 ms frame at 4x CPU throttle (docs/PERFORMANCE.md).
    if (instant()) this.showPromptFor(s);
    else {
      const seq = ++this.promptSeq;
      this.cancelPrompt = onFrame(() => {
        this.cancelPrompt = null;
        if (seq === this.promptSeq && !this.disposed && !this.paused && this.state === s) this.showPromptFor(s);
        return false;
      });
    }
    if (p.isCpu) {
      stage.setThinking(s.phase.kind !== 'preRoll');
      const base = s.phase.kind === 'preRoll' ? 350 + Math.random() * 200 : 450 + Math.random() * 300;
      const delay = instant() || animSpeed() === 0 ? 0 : D(base);
      const snapshot = s;
      // A plain timeout, not a grid one: the CPU policy and `reduce` stay out of the animation
      // frame (dispatch's deferPlay puts the first DOM change on the next grid frame instead).
      const id = window.setTimeout(() => {
        if (this.disposed || this.paused || this.state !== snapshot) return;
        let a: Action;
        try {
          a = chooseAction(snapshot, pid);
        } catch (e) {
          console.error('[game] CPU failed; using default', e);
          a = defaultAction(snapshot)!;
        }
        void this.dispatch(a, { deferPlay: true });
      }, delay);
      this.cancelCpu = () => window.clearTimeout(id);
    }
  }

  private showPromptFor(s: GameState): void {
    if (s.phase.kind === 'gameOver') return;
    const p = s.players[s.phase.playerId]!;
    const { stage, board } = this.view;
    const t0 = PROMPT_STATS ? performance.now() : 0;
    const res = buildPromptFor({
      state: s,
      cpu: p.isCpu,
      act: (a) => void this.dispatch(a),
      board,
      dice: stage.dice,
    });
    if (PROMPT_STATS && res) {
      // Dev (?dev=1): prompt build cost for scripts/perf*.mjs and docs/PERFORMANCE.md.
      const t1 = performance.now();
      const els = res.el.querySelectorAll('*').length + 1;
      performance.measure('lr:prompt-build', { start: t0, end: t1, detail: { kind: s.phase.kind, els } });
      PROMPT_STATS.push({ kind: s.phase.kind, cpu: p.isCpu, els, ms: Math.round((t1 - t0) * 100) / 100 });
    }
    if (res) {
      const timer = p.isCpu ? 0 : this.timerSeconds();
      stage.showPrompt(res.el, {
        big: !!res.big,
        timer,
        onTimeout: () => {
          const a = defaultAction(this.state);
          if (!a) return;
          // Tell the table why the prompt vanished (the safe default was picked).
          void stage.notice(t('g.timer.auto'), 'timer');
          void this.dispatch(a);
        },
      });
      if (res.focus !== undefined) board.setFocus(res.focus);
    }
    if (!p.isCpu) this.flushIdle();
  }

  /** Pause CPU + prompt timers (menu open). */
  pause(): void {
    this.paused = true;
    this.cancelCpu();
    this.view.stage.clearTimer();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (!this.busy) this.advance();
  }

  /** Dev: act for whoever must act with the CPU policy. */
  async autoStep(): Promise<boolean> {
    const ph = this.state.phase;
    if (ph.kind === 'gameOver' || this.busy) return false;
    return this.dispatch(chooseAction(this.state, ph.playerId));
  }

  /** Resolves when a human prompt is showing or the game is over. */
  whenIdle(): Promise<void> {
    if (!this.busy && (this.state.phase.kind === 'gameOver' || !this.state.players[this.state.phase.playerId]!.isCpu)) {
      return Promise.resolve();
    }
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private flushIdle(): void {
    const w = this.idleWaiters;
    this.idleWaiters = [];
    w.forEach((f) => f());
  }

  dispose(): void {
    this.disposed = true;
    this.cancelCpu();
    this.flushIdle();
  }
}
