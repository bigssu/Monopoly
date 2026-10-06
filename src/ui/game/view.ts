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
import { h, iconEl, isDevHook, prepareGameIcons, primeIconTints } from './util';
import { disposeIconAtlas } from './iconAtlas';
import { fxQualityOn, prefs } from '@/ui/shell/prefs';
import { isNative } from '@/ui/shell/capacitor';
import { Dealer } from '@/ui/dealer/Dealer';
import { MoneyStage, type Rect as MoneyRect } from '@/ui/fx/money';
import { currentDevice, devicePixels, MoneyHealth, pickTier, resolveRender, stepsBelow, type MoneyRender, type MoneyTier } from '@/ui/fx/money/render';

/** Frame health of money cut-ins for the whole app session (the runtime safety net, render.ts). */
const moneyHealth = new MoneyHealth();
/** Tier changes the safety net made this session (dev hook). */
const MONEY_TIER_LOG: string[] = [];
import { groupColor, spaceIcon } from './util';
import { DealerDirector } from '@/ui/dealer/director';
import { orientationFor, type Orientation } from '@/ui/orientation';

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
  /** Canvas sprite/particle engine (docs/VFX.md §13–14). */
  readonly vfx: FxHandle;
  private ladder = new PitchLadder();
  readonly menuSlot: HTMLElement;
  /**
   * Full-screen money cut-ins (docs/MONEY-EVENTS.md §10–§11): one layer for the screen's life,
   * parked off-screen by a transform while idle (no layer, no timer).
   */
  readonly money: MoneyStage;
  /** Fixed view (one human vs CPUs) or the table-top model: src/ui/orientation.ts. */
  readonly orient: Orientation;
  /** Drawn seats of the players (engine seats remapped by `orient`). */
  /** What the money stage renders with now (tier, scale, 3D, budget; render.ts). */
  moneyRender: MoneyRender | null = null;
  private moneyAuto: MoneyTier = 'mid';
  private stopMoneyPrefs: () => void = () => {};
  readonly seats: Seat[];
  layout: GameLayout | null = null;
  /** Called when the device flips between portrait and landscape. */
  onPortraitChange: ((portrait: boolean) => void) | null = null;
  private rotateOverlay: HTMLElement;
  private stopWatch: () => void = () => {};
  private stopPrefs: () => void = () => {};
  private stopDicePrefs: () => void = () => {};
  private state: GameState;

  constructor(state: GameState) {
    // Before any of the game's DOM exists (see primeIconTints).
    primeIconTints();
    this.state = state;
    this.orient = orientationFor(state.players);
    this.seats = state.players.map((p) => this.orient.seat(p.seat));
    this.root = h('div', { class: 'game', 'data-view': this.orient.mode });
    this.table = h('div', { class: 'table' });
    const spacesPerSide = (state.settings.spacesPerSide ?? 7) as SpacesPerSide;
    this.board = new Board(state.players, (i) => this.showInfo(i), spacesPerSide, this.orient.fixed);
    this.stage = new Stage();
    this.board.stageHost.append(this.stage.el);
    this.hand = new CpuHand(this.board, this.stage);
    this.dealer = new Dealer(() => prefs.get().sound);
    this.stage.mountDealer(this.dealer.el);
    this.director = new DealerDirector(this.dealer, () => prefs.get().dealer);
    this.table.append(this.board.el);
    for (const p of state.players) {
      const panel = new PlayerPanel(p, spacesPerSide);
      panel.el.dataset.seat = this.orient.seat(p.seat);
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
      getSeat: (id) => this.seatOf(id),
      getFaceSeat: (id) => this.faceOf(id),
      getStageRect: () => this.rect('stage', () => this.stage.el.getBoundingClientRect()),
      getPlayerColor: (id) => this.colorOf(id),
      sfx: (name, o) => this.playSfx(name, o),
      haptic: (k) => haptic(k),
      // Camera shake of the effect layer only: shaking the table or the board would promote it to a
      // ~27-33 MB GPU layer at the moments the canvas is largest (layer-memory gate, docs/VFX.md §14).
      shake: (px, ms) => void shakeAll([this.fx], px, ms),
      highlight: (target, ms) => this.staticHighlight(target, ms),
      dom: {
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
      // ONE canvas (a 400×400 backing, upgraded once to 960×600 if the effects outgrow it), painted
      // by the FX worker: each extra shown canvas is a GPU layer and every show/hide is a Paint on
      // the main thread, while a larger backing only costs the worker a larger copy (docs/VFX.md §15).
      pool: [6, 12],
      maxCanvases: 1,
      frameBudget: 0.5e6,
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
    // How dice throws are drawn follows the same switch (docs/DESIGN.md "Dice throw"): canvas
    // effects on → one temporary canvas; off (the Android app's default) → the DOM dice themselves.
    // Dev A/B: ?dev=1&dice=dom|canvas.
    const devDice = isDevHook() ? new URLSearchParams(location.search).get('dice') : null;
    const dicePath = (): 'canvas' | 'dom' => (devDice === 'dom' || devDice === 'canvas' ? devDice : (devQ ?? fxQualityOn(prefs.get(), native)) === 'off' ? 'dom' : 'canvas');
    this.stage.dice.path = dicePath();
    this.stopDicePrefs = prefs.onChange(() => (this.stage.dice.path = dicePath()));
    this.menuSlot = h('div', { class: 'menu-slot' });
    this.rotateOverlay = h(
      'div',
      { class: 'rotate-overlay' },
      h('div', { class: 'ro-inner' }, iconEl('rotate', 'ico ro-ico'), h('div', { class: 'ro-text', text: t('g.rotate') })),
    );
    this.root.append(this.table, this.fx, this.menuSlot, this.rotateOverlay);
    this.money = this.createMoneyStage(spacesPerSide);
    this.moneyAuto = pickTier(currentDevice());
    this.updateMoneyRender();
    this.money.onCutInEnd = () => this.judgeCutIn();
    this.stopMoneyPrefs = prefs.onChange((n, prev) => {
      if (n.moneyRes !== prev.moneyRes || n.money3d !== prev.money3d) this.updateMoneyRender();
    });
  }

  /** Resolve the money stage's render tier (auto / safety net / settings / dev) and apply it. */
  updateMoneyRender(): void {
    const q = isDevHook() ? new URLSearchParams(location.search) : null;
    const devTier = q?.get('mres');
    const dev3d = q?.get('m3d');
    const p = prefs.get();
    const r = resolveRender({
      auto: this.moneyAuto,
      pixels: devicePixels(currentDevice()),
      stepDown: moneyHealth.stepDown,
      res: p.moneyRes,
      fx3d: dev3d === '1' ? 'on' : dev3d === '0' ? 'off' : p.money3d,
      dev: devTier === 'high' || devTier === 'mid' || devTier === 'low' ? devTier : null,
    });
    this.moneyRender = r;
    this.money.setRender(r);
    // The safety net judges cut-ins only while the tier is automatic.
    this.money.monitor = r.source.startsWith('auto') ? (a, b) => moneyHealth.sample(a, b) : null;
  }

  /** A cut-in went down: the runtime safety net may step the render tier (MONEY-EVENTS §12.4). */
  private judgeCutIn(): void {
    if (!this.money.monitor) return;
    const ch = moneyHealth.end(stepsBelow(this.moneyAuto));
    moneyHealth.begin();
    if (!ch) return;
    const from = this.moneyRender?.tier;
    this.updateMoneyRender();
    MONEY_TIER_LOG.push(`${from} → ${this.moneyRender?.tier}: ${ch.reason}`);
    if (isDevHook()) console.info(`[money] render tier ${from} → ${this.moneyRender?.tier} (${ch.reason})`);
  }

  /** Dev: the money stage's render state. */
  moneyInfo(): { tier: MoneyTier; scale: number; tilt: boolean; camera: boolean; source: string; budgetMB: number; auto: MoneyTier; health: string[]; log: string[] } | null {
    const r = this.moneyRender;
    return r ? { tier: r.tier, scale: r.scale, tilt: r.tilt, camera: r.camera, source: r.source, budgetMB: r.budgetMB, auto: this.moneyAuto, health: [...moneyHealth.history], log: [...MONEY_TIER_LOG] } : null;
  }

  /** The money stage with its rect providers (cached layout rects) and the board camera. */
  private createMoneyStage(spacesPerSide: SpacesPerSide): MoneyStage {
    const defs = getBoard(spacesPerSide);
    const toRect = (r: { x: number; y: number; width: number; height: number }): MoneyRect => ({ x: r.x, y: r.y, w: r.width, h: r.height });
    const boardRect = (): DOMRect => this.rect('board', () => this.board.el.getBoundingClientRect());
    // Camera (§2): the board pulls back (2D) or also tilts back (3D) under the cut-in — on when the
    // render tier allows it (render.ts, docs/MONEY-EVENTS.md §12). Dev override for measuring:
    // `?dev=1&mcam=off|2d|3d`. The mode chosen at 'in' is kept for that cut-in's 'out'.
    const mcam = isDevHook() ? new URLSearchParams(location.search).get('mcam') : null;
    let camMode: '2d' | '3d' | null = null;
    const stage: MoneyStage = new MoneyStage({
      parent: this.root,
      upright: this.orient.fixed,
      boardRect: () => {
        const r = boardRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      },
      seatRect: (seat) => {
        const p = this.state.players.find((q) => this.orient.seat(q.seat) === seat);
        const r = p ? this.rects.get(`p${p.id}`) : undefined;
        return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
      },
      tileRect: (i) => (defs[i] ? toRect(this.board.spaceRect(i, boardRect())) : null),
      buildingRect: (i, level) => {
        const r = defs[i] ? this.board.buildingRect(i, level, boardRect()) : null;
        return r ? toRect(r) : null;
      },
      space: (i) => {
        const sp = defs[i];
        return sp ? { icon: spaceIcon(sp), name: loc(sp.short), color: groupColor(sp) ?? undefined } : null;
      },
      camera: (state, _tier, ms) => {
        if (state === 'in') {
          const r = this.moneyRender;
          camMode = mcam === 'off' ? null : mcam === '2d' || mcam === '3d' ? mcam : r?.camera ? (r.tilt ? '3d' : '2d') : null;
        }
        const mode = camMode;
        if (!mode) return;
        if (state === 'out') camMode = null;
        const el = this.board.el;
        void stage.tween(ms, (u) => {
          const k = state === 'in' ? u * u * (3 - 2 * u) : 1 - u * u * (3 - 2 * u);
          el.style.transform = k <= 0.001
            ? ''
            : mode === '3d'
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
    // The device's pixels changed (resize / rotation): re-pick the money stage's render tier.
    const auto = pickTier(currentDevice());
    if (auto !== this.moneyAuto) {
      this.moneyAuto = auto;
      this.updateMoneyRender();
    }
    const L = computeLayout(W, H, new Set(this.seats), this.orient.fixed);
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
    const fill = (): void => {
      for (const p of this.panels.values()) p.fillIcons();
    };
    void prepareGameIcons(this.state.players, (L.board.w / 32) * 2.8, getBoard((this.state.settings.spacesPerSide ?? 7) as SpacesPerSide)).then(fill, fill);
    for (const p of this.state.players) {
      const box = L.seats[this.orient.seat(p.seat)];
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

  /** Where a player is drawn (their panel's edge; the CPU hand and coins come from there). */
  seatOf(pid: PlayerId): Seat {
    const p = this.state.players[pid];
    return p ? this.orient.seat(p.seat) : 'S';
  }

  /** The seat content for a player faces: their own (table) or S (fixed view). */
  faceOf(pid: PlayerId): Seat {
    const p = this.state.players[pid];
    return p ? this.orient.face(p.seat) : 'S';
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
    // A cut-in measured the old layout: cut it short. Its scene finishes at once without being shown
    // (MoneyStage.abort): 'settle' fires, the sequencer applies the state, the next scene plays.
    if (this.money.live) {
      this.money.abort();
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
    this.stopMoneyPrefs();
    this.money.destroy();
    this.board.el.style.transform = '';
    this.dealer.dispose();
    this.stopPrefs();
    this.stopDicePrefs();
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
