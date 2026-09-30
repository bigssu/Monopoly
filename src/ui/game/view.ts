/**
 * GameView: composes the table (board + stage + seat panels + fx layer) and lays it out.
 * Rendering is stateless (`render(state)`), diffed inside each component.
 */
import type { GameState, PlayerId, Seat } from '@/engine';
import { t } from '@/i18n';
import { Board } from '@/ui/board/Board';
import { Stage } from '@/ui/stage/Stage';
import { spaceInfo } from '@/ui/stage/prompts';
import { PlayerPanel } from '@/ui/panels/PlayerPanel';
import { createFx, type FxHandle, type HighlightTarget } from '@/ui/fx/vfx';
import { fxPolicy, PitchLadder } from '@/ui/fx/vfx/director';
import { shakeAll } from '@/ui/fx/shake';
import { anim } from '@/ui/fx/time';
import { sfx, type SfxName } from '@/ui/audio/sfx';
import { haptic } from '@/ui/audio/haptics';
import { playerColor } from '@/content/palette';
import { computeLayout, placeRect, placeSeat, setBoardVar, watchViewport, type GameLayout } from '@/ui/layout';
import { h, iconEl, isDevHook, prepareGameIcons, SEAT_ANGLE } from './util';

export class GameView {
  readonly root: HTMLElement;
  /** Shakeable wrapper around board + panels. */
  readonly table: HTMLElement;
  readonly board: Board;
  readonly stage: Stage;
  readonly panels = new Map<PlayerId, PlayerPanel>();
  /** `.fx-layer` (z 40, pointer-events none): the VFX canvas + spotlight veil. */
  readonly fx: HTMLElement;
  /** Canvas sprite/particle engine (docs/VFX.md, wiring: docs/VFX-WIRING.md). */
  readonly vfx: FxHandle;
  private spot: HTMLElement;
  private spotOn = false;
  private ladder = new PitchLadder();
  readonly menuSlot: HTMLElement;
  readonly seats: Seat[];
  layout: GameLayout | null = null;
  /** Called when the device flips between portrait and landscape. */
  onPortraitChange: ((portrait: boolean) => void) | null = null;
  private rotateOverlay: HTMLElement;
  private stopWatch: () => void = () => {};
  private state: GameState;

  constructor(state: GameState) {
    this.state = state;
    this.seats = state.players.map((p) => p.seat);
    this.root = h('div', { class: 'game' });
    this.table = h('div', { class: 'table' });
    this.board = new Board(state.players, (i) => this.showInfo(i));
    this.stage = new Stage();
    this.board.stageHost.append(this.stage.el);
    this.table.append(this.board.el);
    for (const p of state.players) {
      const panel = new PlayerPanel(p);
      this.panels.set(p.id, panel);
      this.table.append(panel.el);
    }
    this.fx = h('div', { class: 'fx-layer' });
    this.spot = h('div', { class: 'fx-spot', 'aria-hidden': 'true' });
    this.spot.hidden = true;
    // Under the canvas (the canvas is appended on the first play()).
    this.fx.append(this.spot);
    this.vfx = createFx({
      layer: this.fx,
      getLayerRect: () => this.fx.getBoundingClientRect(),
      getBoardRect: () => this.board.el.getBoundingClientRect(),
      getSpaceRect: (i) => this.board.spaceRect(i),
      getPanelRect: (id) => this.panels.get(id)?.clientRect() ?? null,
      getSeat: (id) => this.state.players[id]?.seat ?? 'S',
      getStageRect: () => this.stage.el.getBoundingClientRect(),
      getPlayerColor: (id) => this.colorOf(id),
      sfx: (name, o) => this.playSfx(name, o),
      haptic: (k) => haptic(k),
      shake: (px, ms) => void shakeAll([this.table, this.fx], px, ms),
      highlight: (target, ms) => this.staticHighlight(target, ms),
      dom: {
        pop: (i, o) => this.board.popIcon(i, o),
        zoomPunch: (i, k) => this.board.zoomPunch(i, k),
        dim: (i, on) => this.board.dimIcon(i, on),
        closeUp: (i, pid, level, phase) => {
          if (phase === 'in') this.aimSpot(i);
          this.stage.closeUp(this.colorOf(pid), level, phase);
        },
        spotlight: (on) => this.spotlight(on),
        floatText: (pid, text) => this.panels.get(pid)?.floatText(text),
        panelBump: (pid) => void this.panels.get(pid)?.bump(),
      },
      policy: fxPolicy,
      serializeBig: true,
      // Keep the hidden canvas's backing store between effects (no first-draw allocation spike;
      // still no layer, frame callback or timer while idle) — docs/VFX.md §13.5.
      retainBacking: true,
      dev: isDevHook(),
    });
    this.menuSlot = h('div', { class: 'menu-slot' });
    this.rotateOverlay = h(
      'div',
      { class: 'rotate-overlay' },
      h('div', { class: 'ro-inner' }, iconEl('rotate', 'ico ro-ico'), h('div', { class: 'ro-text', text: t('g.rotate') })),
    );
    this.root.append(this.table, this.fx, this.menuSlot, this.rotateOverlay);
  }

  mount(parent: HTMLElement): void {
    parent.append(this.root);
    this.stopWatch = watchViewport((W, H) => this.applyLayout(W, H));
  }

  private applyLayout(W: number, H: number): void {
    // Effects hold client positions: drop them on resize / rotation (they last ~1-2 s).
    this.stopFx();
    const L = computeLayout(W, H, new Set(this.seats));
    const was = this.layout?.portrait ?? false;
    this.layout = L;
    this.root.classList.toggle('is-portrait', L.portrait);
    if (was !== L.portrait) this.onPortraitChange?.(L.portrait);
    setBoardVar(L.board.w);
    placeRect(this.board.el, L.board);
    this.board.setSize(L.board.w);
    // Icon bitmaps sized for the largest card icon (.pc-icon: 2.6 board units of board/32).
    void prepareGameIcons(this.state.players, (L.board.w / 32) * 2.8);
    for (const p of this.state.players) {
      const box = L.seats[p.seat];
      const panel = this.panels.get(p.id)!;
      if (box) {
        placeSeat(panel.el, box);
        panel.setBox(box.innerW, box.innerH);
      }
      panel.el.classList.toggle('is-narrow', !!box && box.innerW / box.innerH < 1.25);
      panel.el.classList.toggle('is-wide', !!box && box.innerW / box.innerH >= 1.25);
    }
    placeRect(this.menuSlot, L.menu);
    // The stage changed size: re-decide whether the dice still fit next to the prompt.
    this.stage.fitDice();
  }

  render(vs: GameState): void {
    this.state = vs;
    this.board.render(vs);
    const actor = vs.phase.kind === 'gameOver' ? -1 : vs.current;
    for (const [pid, panel] of this.panels) panel.update(vs, { isTurn: pid === actor });
  }

  /** The state the view last rendered (the sequencer's view state during playback). */
  renderedState(): GameState {
    return this.state;
  }

  showInfo(i: number): void {
    this.stage.showInfo(spaceInfo(this.state, i));
  }

  panel(pid: PlayerId): PlayerPanel | undefined {
    return this.panels.get(pid);
  }

  colorOf(pid: PlayerId): string {
    const p = this.state.players[pid];
    return p ? playerColor(p.colorId).hex : '#F2B633';
  }

  /** Sound with the cash pitch ladder (docs/VFX.md §6.2-2): every cash-in / cash-out goes through here. */
  playSfx(name: SfxName, o: { pitch?: number; gain?: number } = {}): void {
    const pitch = this.ladder.apply(name, o.pitch, performance.now());
    sfx.play(name, { ...o, ...(pitch !== undefined ? { pitch: Math.min(1.9, pitch) } : {}) });
  }

  /** Drop every running effect and its DOM helpers (resize, skip-to-end, screen exit). */
  stopFx(): void {
    this.vfx.stopAll();
    this.stage.dropCloseUp();
    this.spotlight(false, true);
  }

  /** Centre the spotlight's clear hole on a space (and the stage centre, where the close-up card is). */
  private aimSpot(i: number): void {
    const L = this.fx.getBoundingClientRect();
    const r = this.board.spaceRect(i);
    const b = this.board.el.getBoundingClientRect();
    const s = this.spot.style;
    s.setProperty('--sx', `${r.x + r.width / 2 - L.left}px`);
    s.setProperty('--sy', `${r.y + r.height / 2 - L.top}px`);
    s.setProperty('--sr', `${Math.max(r.width, r.height) * 0.9}px`);
    // The close-up card sits 4.2 u above the stage centre in the acting seat's frame (vfx.css).
    const u = b.width / 32;
    const a = (SEAT_ANGLE[this.stage.currentSeat] * Math.PI) / 180;
    const dx = 4.2 * u * Math.sin(a);
    const dy = -4.2 * u * Math.cos(a);
    s.setProperty('--cx', `${b.left + b.width / 2 + dx - L.left}px`);
    s.setProperty('--cy', `${b.top + b.height / 2 + dy - L.top}px`);
    s.setProperty('--cr', `${u * 3.9}px`);
  }

  /** Landmark spotlight: the table dims to 25 % around the space and the close-up card (fade 200 / 267 ms). */
  spotlight(on: boolean, now = false): void {
    if (on === this.spotOn && !now) return;
    this.spotOn = on;
    const el = this.spot;
    if (on) {
      el.hidden = false;
      void anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'forwards' });
    } else if (now) {
      el.getAnimations().forEach((a) => a.cancel());
      el.hidden = true;
    } else {
      void anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 267, fill: 'forwards' }).then(() => {
        if (this.spotOn) return;
        el.getAnimations().forEach((a) => a.cancel());
        el.hidden = true;
      });
    }
  }

  /** Reduced motion (docs/VFX.md §8.3): a static colour frame on the space / panel, no animation. */
  staticHighlight(target: HighlightTarget, ms: number): void {
    const gold = '#F2B633';
    if ('space' in target) this.board.highlight(target.space, gold, ms);
    else if ('spaces' in target) for (const i of target.spaces) this.board.highlight(i, gold, ms);
    else if ('panel' in target) this.panels.get(target.panel)?.highlight(this.colorOf(target.panel), ms);
  }

  dispose(): void {
    this.vfx.dispose();
    this.stage.dropCloseUp();
    this.stopWatch();
    this.board.dispose();
    this.stage.dispose();
    for (const p of this.panels.values()) p.dispose();
  }
}
