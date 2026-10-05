/**
 * GameView: composes the table (board + stage + seat panels + fx layer) and lays it out.
 * Rendering is stateless (`render(state)`), diffed inside each component.
 */
import { getBoard, type GameState, type PlayerId, type Seat, type SpacesPerSide } from '@/engine';
import { loc, t } from '@/i18n';
import { Board } from '@/ui/board/Board';
import { INNER, VB } from '@/ui/board/geometry';
import { Stage } from '@/ui/stage/Stage';
import { CpuHand } from '@/ui/stage/CpuHand';
import { spaceInfo } from '@/ui/stage/prompts';
import { PlayerPanel } from '@/ui/panels/PlayerPanel';
import { createFx, type FxHandle, type HighlightTarget } from '@/ui/fx/vfx';
import { fxPolicy, PitchLadder } from '@/ui/fx/vfx/director';
import { shakeAll } from '@/ui/fx/shake';
import { sfx, type SfxName } from '@/ui/audio/sfx';
import { haptic } from '@/ui/audio/haptics';
import { playerColor } from '@/content/palette';
import { computeLayout, placeRect, placeSeat, setBoardVar, watchViewport, type GameLayout } from '@/ui/layout';
import { h, iconEl, isDevHook, prepareGameIcons } from './util';
import { disposeIconAtlas } from './iconAtlas';
import { fxQualityOn, prefs } from '@/ui/shell/prefs';
import { isNative } from '@/ui/shell/capacitor';
import { Dealer } from '@/ui/dealer/Dealer';
import { MoneyStage, type Rect as MoneyRect } from '@/ui/fx/money';
import { groupColor, spaceIcon } from './util';
import { DealerDirector } from '@/ui/dealer/director';

/** Dev A/B knob `?dev=1&fxpool=6.12` (canvas size classes, present.ts SLOT_CLASSES). */
function devPool(): number[] | null {
  const v = isDevHook() ? new URLSearchParams(location.search).get('fxpool') : null;
  return v ? v.split('.').map(Number) : null;
}

/** Dev A/B knobs (`?dev=1&fxs=0.75&fxe=2`): crisp backing-scale cap, draw every n-th FX tick. */
function devTune(): { sMax?: number; drawEvery?: number } {
  const q = new URLSearchParams(location.search);
  const o: { sMax?: number; drawEvery?: number } = {};
  if (q.get('fxs')) o.sMax = Number(q.get('fxs'));
  if (q.get('fxe')) o.drawEvery = Number(q.get('fxe'));
  return o;
}

export class GameView {
  readonly root: HTMLElement;
  /** Shakeable wrapper around board + panels. */
  readonly table: HTMLElement;
  readonly board: Board;
  readonly stage: Stage;
  /** The CPU's pointing hand (presses the control a CPU decision picks). */
  readonly hand: CpuHand;
  readonly dealer: Dealer;
  readonly director: DealerDirector;
  readonly panels = new Map<PlayerId, PlayerPanel>();
  /** `.fx-layer` (z 40, pointer-events none): the VFX canvas. */
  readonly fx: HTMLElement;
  /** Canvas sprite/particle engine (docs/VFX.md, wiring: docs/VFX-WIRING.md). */
  readonly vfx: FxHandle;
  private ladder = new PitchLadder();
  readonly menuSlot: HTMLElement;
  /**
   * Full-screen money cut-ins (docs/MONEY-EVENTS.md §10–§11): one layer for the screen's life,
   * parked off-screen by a transform while idle (no layer, no timer).
   */
  readonly money: MoneyStage;
  readonly seats: Seat[];
  layout: GameLayout | null = null;
  /** Called when the device flips between portrait and landscape. */
  onPortraitChange: ((portrait: boolean) => void) | null = null;
  private rotateOverlay: HTMLElement;
  private stopWatch: () => void = () => {};
  private stopPrefs: () => void = () => {};
  private state: GameState;

  constructor(state: GameState) {
    this.state = state;
    this.seats = state.players.map((p) => p.seat);
    this.root = h('div', { class: 'game' });
    this.table = h('div', { class: 'table' });
    const spacesPerSide = (state.settings.spacesPerSide ?? 7) as SpacesPerSide;
    this.board = new Board(state.players, (i) => this.showInfo(i), spacesPerSide);
    this.stage = new Stage();
    this.board.stageHost.append(this.stage.el);
    this.hand = new CpuHand(this.board, this.stage);
    this.dealer = new Dealer(() => prefs.get().sound);
    this.stage.mountDealer(this.dealer.el);
    this.director = new DealerDirector(this.dealer, () => prefs.get().dealer);
    this.table.append(this.board.el);
    for (const p of state.players) {
      const panel = new PlayerPanel(p, spacesPerSide);
      panel.onSetsTap = () => {
        if (!this.director.explainSets()) void this.stage.toast(t('g.panel.setsHelp'), 2200, 'info');
      };
      this.panels.set(p.id, panel);
      this.table.append(panel.el);
    }
    this.fx = h('div', { class: 'fx-layer' });
    this.vfx = createFx({
      layer: this.fx,
      // Client rects are cached until the next relayout (applyLayout): reading them right after the
      // sequencer's render forced a synchronous style + layout (20-33 ms at 4x) inside the 30 Hz tick
      // at every turn change / buy (docs/VFX.md §15.3). The layout only moves on a viewport change.
      getLayerRect: () => this.rect('layer', () => this.fx.getBoundingClientRect()),
      getBoardRect: () => this.rect('board', () => this.board.el.getBoundingClientRect()),
      getSpaceRect: (i) => this.board.spaceRect(i, this.rect('board', () => this.board.el.getBoundingClientRect())),
      getPanelRect: (id) => (this.panels.has(id) ? this.rect(`p${id}`, () => this.panels.get(id)!.clientRect()) : null),
      getSeat: (id) => this.state.players[id]?.seat ?? 'S',
      getStageRect: () => this.rect('stage', () => this.stage.el.getBoundingClientRect()),
      getPlayerColor: (id) => this.colorOf(id),
      sfx: (name, o) => this.playSfx(name, o),
      haptic: (k) => haptic(k),
      // Camera shake of the effect layer only: shaking the table or the board would promote it to a
      // ~27-33 MB GPU layer at the moments the canvas is largest (layer-memory gate, docs/VFX.md §14).
      shake: (px, ms) => void shakeAll([this.fx], px, ms),
      highlight: (target, ms) => this.staticHighlight(target, ms),
      dom: isDevHook() && new URLSearchParams(location.search).get('fxdom') === '0' ? {} : {
        pop: (i, o) => this.board.popIcon(i, o),
        zoomPunch: (i, k) => this.board.zoomPunch(i, k),
        dim: (i, on) => this.board.dimIcon(i, on),
        closeUp: (_i, pid, level, phase) => this.stage.closeUp(this.colorOf(pid), level, phase),
        // The "spotlight" is a static veil in the stage around the close-up card (no extra layer).
        spotlight: (on) => this.stage.spotlight(on),
        floatText: (pid, text) => this.panels.get(pid)?.floatText(text),
        panelBump: (pid) => void this.panels.get(pid)?.bump(),
      },
      policy: fxPolicy,
      serializeBig: true,
      // Idle: park the canvas off the layer and keep its backing store (no Paint to park / unpark, no
      // first-draw allocation; no frame callback or timer while idle) — docs/VFX.md §15.3.
      retainBacking: true,
      // Dev A/B knobs for devices (VFX.md §10.4, §15.4): ?dev=1&fxsw=0 (GPU canvas), fxk / fxpool / fxs / fxe / fxdom.
      // ONE canvas (a 400×400 backing, upgraded once to 960×600 if the effects outgrow it), painted
      // by the FX worker: each extra shown canvas is a GPU layer and every show/hide is a Paint on
      // the main thread, while a larger backing only costs the worker a larger copy (docs/VFX.md §15).
      pool: devPool() ?? [6, 12],
      maxCanvases: Number((isDevHook() && new URLSearchParams(location.search).get('fxk')) || 1),
      frameBudget: 0.5e6,
      ...(isDevHook() ? { tune: devTune() } : {}),
      softwareCanvas: !(isDevHook() && new URLSearchParams(location.search).get('fxsw') === '0'),
      // Android app: paint on the main thread, like the dice canvas (no OffscreenCanvas placeholder).
      ...(isNative() ? { worker: false } : {}),
      dev: isDevHook(),
    });
    // Effects quality (Settings, docs/VFX.md §15.4), applied live; dev A/B override ?dev=1&fxq=auto|high|low|off.
    const q = isDevHook() ? new URLSearchParams(location.search).get('fxq') : null;
    const devQ = q === 'auto' || q === 'high' || q === 'low' || q === 'off' ? q : null;
    const native = isNative();
    this.vfx.setQuality(devQ ?? fxQualityOn(prefs.get(), native));
    if (!devQ) this.stopPrefs = prefs.onChange((n, prev) => fxQualityOn(n, native) !== fxQualityOn(prev, native) && this.vfx.setQuality(fxQualityOn(n, native)));
    this.menuSlot = h('div', { class: 'menu-slot' });
    this.rotateOverlay = h(
      'div',
      { class: 'rotate-overlay' },
      h('div', { class: 'ro-inner' }, iconEl('rotate', 'ico ro-ico'), h('div', { class: 'ro-text', text: t('g.rotate') })),
    );
    this.root.append(this.table, this.fx, this.menuSlot, this.rotateOverlay);
    this.money = this.createMoneyStage(spacesPerSide);
  }

  /** The money stage with its rect providers (cached layout rects) and the board camera. */
  private createMoneyStage(spacesPerSide: SpacesPerSide): MoneyStage {
    const defs = getBoard(spacesPerSide);
    const toRect = (r: { x: number; y: number; width: number; height: number }): MoneyRect => ({ x: r.x, y: r.y, w: r.width, h: r.height });
    const boardRect = (): DOMRect => this.rect('board', () => this.board.el.getBoundingClientRect());
    // Camera (§2): 2D by default — the board pulls back a little under the vignette (transform on
    // the board, written on the scene clock; a static 2D scale makes no layer). `?dev=1&mcam=3d`
    // tilts it back in 3D as well (+3–4 compositor layers measured, docs/MONEY-EVENTS.md §11).
    const cam3d = isDevHook() && new URLSearchParams(location.search).get('mcam') === '3d';
    const camOff = isDevHook() && new URLSearchParams(location.search).get('mcam') === 'off';
    const stage: MoneyStage = new MoneyStage({
      parent: this.root,
      boardRect: () => {
        const r = boardRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      },
      seatRect: (seat) => {
        const p = this.state.players.find((q) => q.seat === seat);
        const r = p ? this.rects.get(`p${p.id}`) : undefined;
        return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
      },
      tileRect: (i) => (defs[i] ? toRect(this.board.spaceRect(i, boardRect())) : null),
      space: (i) => {
        const sp = defs[i];
        return sp ? { icon: spaceIcon(sp), name: loc(sp.short), color: groupColor(sp) ?? undefined } : null;
      },
      camera: camOff
        ? undefined
        : (state, _tier, ms) => {
            const el = this.board.el;
            void stage.tween(ms, (u) => {
              const k = state === 'in' ? u * u * (3 - 2 * u) : 1 - u * u * (3 - 2 * u);
              el.style.transform = k <= 0.001
                ? ''
                : cam3d
                  ? `perspective(1400px) rotateX(${(9 * k).toFixed(2)}deg) scale(${(1 - 0.08 * k).toFixed(4)})`
                  : `scale(${(1 - 0.08 * k).toFixed(4)})`;
            });
          },
    });
    return stage;
  }

  mount(parent: HTMLElement): void {
    parent.append(this.root);
    this.stopWatch = watchViewport((W, H) => this.applyLayout(W, H));
  }

  /** Layout rects for the FX coordinates, valid until the next `applyLayout`. */
  private rects = new Map<string, DOMRect>();
  private rect(key: string, read: () => DOMRect): DOMRect {
    let r = this.rects.get(key);
    if (!r) {
      r = read();
      this.rects.set(key, r);
    }
    return r;
  }

  private applyLayout(W: number, H: number): void {
    // Effects hold client positions: drop them on resize / rotation (they last ~1-2 s).
    this.stopFx();
    this.rects.clear();
    const L = computeLayout(W, H, new Set(this.seats));
    // These viewport-relative boxes are already known from the layout. Reading them back from
    // the DOM during the first turn's FX forces the freshly mounted board through layout again.
    const b = L.board;
    const inset = (b.w * INNER.x) / VB;
    const inner = (b.w * INNER.size) / VB;
    this.rects.set('layer', new DOMRect(0, 0, W, H));
    this.rects.set('board', new DOMRect(b.x, b.y, b.w, b.h));
    this.rects.set('stage', new DOMRect(b.x + inset, b.y + inset, inner, inner));
    const was = this.layout?.portrait ?? false;
    this.layout = L;
    this.root.classList.toggle('is-portrait', L.portrait);
    if (was !== L.portrait) this.onPortraitChange?.(L.portrait);
    setBoardVar(L.board.w);
    placeRect(this.board.el, L.board);
    this.board.setSize(L.board.w);
    // Reuse the game's fixed 1K icon atlas across viewport and DPR changes.
    void prepareGameIcons(this.state.players, (L.board.w / 32) * 2.8, getBoard((this.state.settings.spacesPerSide ?? 7) as SpacesPerSide));
    for (const p of this.state.players) {
      const box = L.seats[p.seat];
      const panel = this.panels.get(p.id)!;
      if (box) {
        this.rects.set(`p${p.id}`, new DOMRect(box.x, box.y, box.w, box.h));
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
    // A cut-in measured the old layout: take it down (its scenes resolve; state is applied).
    if (this.money.live) {
      this.money.park();
      this.board.el.style.transform = '';
    }
    this.stage.dropCloseUp();
  }

  /** Reduced motion (docs/VFX.md §8.3): a static colour frame on the space / panel, no animation. */
  staticHighlight(target: HighlightTarget, ms: number): void {
    const gold = '#F2B633';
    if ('space' in target) this.board.highlight(target.space, gold, ms);
    else if ('spaces' in target) for (const i of target.spaces) this.board.highlight(i, gold, ms);
    else if ('panel' in target) this.panels.get(target.panel)?.highlight(this.colorOf(target.panel), ms);
  }

  dispose(): void {
    this.money.destroy();
    this.board.el.style.transform = '';
    this.dealer.dispose();
    this.stopPrefs();
    this.vfx.dispose();
    this.stage.dropCloseUp();
    this.stopWatch();
    this.board.dispose();
    this.hand.dispose();
    this.stage.dispose();
    for (const p of this.panels.values()) p.dispose();
    disposeIconAtlas();
  }
}
