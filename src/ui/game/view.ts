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
import { Particles } from '@/ui/fx/particles';
import { computeLayout, placeRect, placeSeat, setBoardVar, watchViewport, type GameLayout } from '@/ui/layout';
import { h, iconEl } from './util';

export class GameView {
  readonly root: HTMLElement;
  /** Shakeable wrapper around board + panels. */
  readonly table: HTMLElement;
  readonly board: Board;
  readonly stage: Stage;
  readonly panels = new Map<PlayerId, PlayerPanel>();
  readonly fx: HTMLElement;
  readonly particles: Particles;
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
    this.particles = new Particles(this.fx);
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
    const L = computeLayout(W, H, new Set(this.seats));
    const was = this.layout?.portrait ?? false;
    this.layout = L;
    this.root.classList.toggle('is-portrait', L.portrait);
    if (was !== L.portrait) this.onPortraitChange?.(L.portrait);
    setBoardVar(L.board.w);
    placeRect(this.board.el, L.board);
    this.board.setSize(L.board.w);
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

  showInfo(i: number): void {
    this.stage.showInfo(spaceInfo(this.state, i));
  }

  panel(pid: PlayerId): PlayerPanel | undefined {
    return this.panels.get(pid);
  }

  dispose(): void {
    this.stopWatch();
    this.stage.dispose();
    for (const p of this.panels.values()) p.dispose();
  }
}
