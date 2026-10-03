/**
 * VFX demo page (dev only, not part of the build): a fake board + four seat panels + one
 * `.fx-layer`, and a button per preset scenario. `vfx-demo.html` (repo root, Vite dev server)
 * mounts it. A manual-step clock makes captures deterministic:
 *
 *   window.__vfxDemo.manual(true); __vfxDemo.run('build3'); __vfxDemo.step(2); …
 *
 * The DOM hooks (tile pop / dim / zoom punch, close-up card, spotlight, floats, panel bump,
 * shake) are implemented on the same clock, so filmstrips include them.
 */
import type { PlayerId, Seat } from '@/engine';
import { BOARD, GROUP_COLORS, HUB_COLOR } from '@/content/board';
import { PLAYER_COLORS } from '@/content/palette';
import { GEOM, VB } from '@/ui/board/geometry';
import '@/styles/vfx.css';
import { gameClock, ManualClock, type FrameFn, type FxClock } from './clock';
import { createFx, type FxHandle, type FxPlay } from './engine';
import { outBack, outQuad, inOutQuad } from './ease';
import type { PresetName, PresetParams } from './presets';
import type { FxDom, HighlightTarget } from './timeline';

const SEATS: Seat[] = ['S', 'E', 'N', 'W'];
const PLAYERS = SEATS.map((seat, id) => ({ id, seat, color: PLAYER_COLORS[id]!.hex, name: PLAYER_COLORS[id]!.en }));

/** Clock that can switch between the game's 30 Hz clock and a manual one (only while idle). */
class DemoClock implements FxClock {
  hand = new ManualClock();
  useManual = false;
  private get c(): FxClock {
    return this.useManual ? this.hand : gameClock;
  }
  onFrame(fn: FrameFn): () => void {
    return this.c.onFrame(fn);
  }
  speed(): number {
    return this.c.speed();
  }
  skipping(): boolean {
    return this.c.skipping();
  }
  instant(): boolean {
    return this.c.instant();
  }
  reducedMotion(): boolean {
    return this.useManual ? this.hand.reduced : gameClock.reducedMotion();
  }
  manual(): boolean {
    return this.useManual;
  }
}

const CSS = `
html,body{margin:0;height:100%;background:#16202D;font-family:system-ui,sans-serif;overflow:hidden}
.vd-root{position:absolute;inset:0}
.vd-table{position:absolute;inset:0}
.vd-board{position:absolute;background:#E9DDC6;border-radius:1.2%;box-shadow:0 10px 40px rgba(0,0,0,.45)}
.vd-sp{position:absolute;box-sizing:border-box;border:1px solid #D8C9AC;background:#F4EBD8;display:grid;place-items:center;font:700 11px system-ui;color:#51493c}
.vd-band{position:absolute;left:0;right:0;top:0;height:22%}
.vd-ic{width:46%;height:46%;border-radius:18%;display:grid;place-items:center;font:800 12px system-ui;color:#fff;background:#B8AE9C;transform-origin:50% 50%}
.vd-sp.own{border:3px solid var(--oc)}
.vd-sp.lv4 .vd-ic{background:#F2B633;box-shadow:0 0 0 3px #fff8}
.vd-inner{position:absolute;display:grid;place-items:center;color:#8B7D63;font:800 22px system-ui;letter-spacing:.1em}
.vd-pp{position:absolute;border-radius:14px;background:#243246;border:3px solid var(--pc);color:#fff;display:grid;place-items:center;font:700 15px system-ui;box-sizing:border-box}
.vd-float{position:absolute;font:900 22px system-ui;color:#FFD45C;text-shadow:0 2px 0 #0008;pointer-events:none;white-space:nowrap}
.fx-layer{position:absolute;inset:0;pointer-events:none;z-index:40;overflow:hidden}
.fx-spot{position:absolute;inset:0;pointer-events:none;background:rgba(8,12,20,.25);opacity:0}
.fx-spot[hidden]{display:none}
.vd-ui{position:absolute;left:6px;top:6px;z-index:60;display:flex;flex-wrap:wrap;gap:4px;max-width:260px}
.vd-ui button{font:600 11px system-ui;padding:3px 6px;border-radius:6px;border:0;background:#33445c;color:#fff;cursor:pointer}
.vd-ui .vd-stats{font:11px ui-monospace,monospace;color:#9fb0c8;white-space:pre;width:100%}
`;

export interface DemoApi {
  scenarios: string[];
  run(name: string): FxPlay[];
  manual(on: boolean): void;
  step(n?: number): void;
  reduced(on: boolean): void;
  skip(): void;
  stats(): ReturnType<FxHandle['stats']>;
  /** Board rect (client px) and full layer size, for screenshot clips. */
  rects(): { board: DOMRect; layer: DOMRect; stage: DOMRect };
  /** Stop everything and clear the demo board (`soft`: keep running effects / retained canvas). */
  reset(soft?: boolean): void;
  fx: FxHandle;
  log: string[];
}

export function mountVfxDemo(root: HTMLElement, o: { size?: number } = {}): DemoApi {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  root.classList.add('vd-root');
  const W = root.clientWidth || innerWidth;
  const H = root.clientHeight || innerHeight;
  const size = o.size ?? Math.round(Math.min(W - 280, H - 180));
  const bx = Math.round((W - size) / 2 + 60);
  const by = Math.round((H - size) / 2);
  const table = el('div', 'vd-table');
  const board = el('div', 'vd-board');
  Object.assign(board.style, { left: `${bx}px`, top: `${by}px`, width: `${size}px`, height: `${size}px` });
  board.style.setProperty('--u', `${size / 32}px`);
  const k = size / VB;
  const tiles: HTMLElement[] = [];
  const icons: HTMLElement[] = [];
  const levels: number[] = BOARD.map(() => 0);
  const owners: Array<number | null> = BOARD.map(() => null);
  for (const g of GEOM) {
    const sp = BOARD[g.index]!;
    const t = el('div', 'vd-sp');
    Object.assign(t.style, { left: `${g.x * k}px`, top: `${g.y * k}px`, width: `${g.w * k}px`, height: `${g.h * k}px` });
    const col = sp.kind === 'hub' ? HUB_COLOR : sp.group ? GROUP_COLORS[sp.group] : null;
    if (col) {
      const band = el('div', 'vd-band');
      band.style.background = col;
      t.append(band);
    }
    const ic = el('div', 'vd-ic');
    ic.textContent = g.corner ? sp.kind.slice(0, 3).toUpperCase() : '';
    t.append(ic);
    board.append(t);
    tiles.push(t);
    icons.push(ic);
  }
  const inner = el('div', 'vd-inner');
  const d = 460 * k;
  Object.assign(inner.style, { left: `${d}px`, top: `${d}px`, width: `${size - 2 * d}px`, height: `${size - 2 * d}px` });
  inner.textContent = 'LAND POLY';
  board.append(inner);
  table.append(board);
  const panels = new Map<PlayerId, HTMLElement>();
  const pw = size * 0.46;
  const ph = Math.min(78, by - 12);
  for (const p of PLAYERS) {
    const e = el('div', 'vd-pp');
    e.style.setProperty('--pc', p.color);
    e.textContent = `${p.name} (${p.seat})`;
    const side = Math.min(88, bx - 250);
    const box =
      p.seat === 'S'
        ? { x: bx + (size - pw) / 2, y: by + size + 8, w: pw, h: ph }
        : p.seat === 'N'
          ? { x: bx + (size - pw) / 2, y: by - ph - 8, w: pw, h: ph }
          : p.seat === 'E'
            ? { x: bx + size + 8, y: by + (size - pw) / 2, w: side, h: pw }
            : { x: bx - side - 8, y: by + (size - pw) / 2, w: side, h: pw };
    Object.assign(e.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    table.append(e);
    panels.set(p.id, e);
  }
  const spot = el('div', 'fx-spot');
  spot.hidden = true;
  const layer = el('div', 'fx-layer');
  const closeUp = el('div', 'fx-closeup');
  closeUp.hidden = true;
  closeUp.style.setProperty('--u', `${size / 32}px`);
  const cuIcon = el('div', 'vd-ic');
  closeUp.append(cuIcon);
  inner.append(closeUp);
  const ui = el('div', 'vd-ui');
  const statsEl = el('div', 'vd-stats');
  root.append(table, spot, layer, ui);

  const clock = new DemoClock();
  const log: string[] = [];

  // Clock-driven tweens for the DOM hooks (so manual stepping captures them too).
  const tween = (frames: number, fn: (t: number) => void): void => {
    let f = 0;
    fn(0);
    clock.onFrame(() => {
      f += clock.skipping() ? 5 : 1;
      const t = Math.min(1, f / frames);
      fn(t);
      return t < 1;
    });
  };
  const setLevel = (i: number, lv: number, owner: number | null): void => {
    levels[i] = lv;
    owners[i] = owner;
    const t = tiles[i]!;
    t.classList.toggle('own', owner !== null);
    t.classList.toggle('lv4', lv === 4);
    if (owner !== null) t.style.setProperty('--oc', PLAYERS[owner]!.color);
    icons[i]!.textContent = lv ? (lv === 4 ? 'LM' : `L${lv}`) : GEOM[i]!.corner ? BOARD[i]!.kind.slice(0, 3).toUpperCase() : '';
    icons[i]!.style.background = owner !== null ? PLAYERS[owner]!.color : '';
  };
  const domHooks: FxDom = {
    pop(space, p) {
      const ic = icons[space]!;
      tween(p.frames, (t) => {
        const s = p.from + (1 - p.from) * outBack(t, p.c1);
        ic.style.transform = `scale(${s.toFixed(3)})`;
      });
      log.push(`pop ${space}`);
    },
    zoomPunch(space, kk) {
      const t = tiles[space]!;
      t.style.zIndex = '2';
      tween(12, (x) => {
        const s = x < 5 / 12 ? 1 + (kk - 1) * outQuad(x / (5 / 12)) : kk - (kk - 1) * inOutQuad((x - 5 / 12) / (7 / 12));
        t.style.transform = `scale(${s.toFixed(3)})`;
        if (x >= 1) t.style.zIndex = '';
      });
    },
    dim(space, on) {
      const ic = icons[space]!;
      ic.style.opacity = on ? '0.6' : '1';
      if (on) ic.style.transform = 'scale(0.94)';
    },
    closeUp(space, player, level, phase) {
      log.push(`closeUp ${phase}`);
      if (phase === 'in') {
        closeUp.hidden = false;
        closeUp.style.setProperty('--pc', PLAYERS[player]!.color);
        cuIcon.textContent = `L${Math.max(0, level - 1)}`;
        cuIcon.style.background = PLAYERS[player]!.color;
        tween(4, (t) => {
          closeUp.style.opacity = String(t);
          closeUp.style.transform = `translateY(${(1 - t) * 8}%) scale(${0.7 + 0.3 * outBack(t)})`;
        });
      } else if (phase === 'pop') {
        cuIcon.textContent = 'LM';
        tween(10, (t) => (cuIcon.style.transform = `scale(${0.5 + 0.5 * outBack(t, 2.17)})`));
      } else {
        tween(8, (t) => {
          closeUp.style.opacity = String(1 - t);
          closeUp.style.transform = `scale(${1 - 0.08 * t})`;
          if (t >= 1) closeUp.hidden = true;
        });
      }
      void space;
    },
    spotlight(on) {
      spot.hidden = false;
      tween(on ? 6 : 8, (t) => {
        spot.style.opacity = String(on ? t : 1 - t);
        if (!on && t >= 1) spot.hidden = true;
      });
    },
    floatText(player, text) {
      const r = panels.get(player)!.getBoundingClientRect();
      const f = el('div', 'vd-float');
      f.textContent = text;
      Object.assign(f.style, { left: `${r.left + r.width / 2 - 30}px`, top: `${r.top - 10}px` });
      root.append(f);
      tween(24, (t) => {
        f.style.transform = `translateY(${-30 * outQuad(t)}px)`;
        f.style.opacity = String(t < 0.7 ? 1 : (1 - t) / 0.3);
        if (t >= 1) f.remove();
      });
    },
    panelBump(player) {
      const pe = panels.get(player)!;
      tween(8, (t) => (pe.style.transform = `scale(${1 + 0.06 * Math.sin(Math.PI * t)})`));
    },
  };
  const fx = createFx({
    layer,
    clock,
    dev: true,
    retainBacking: new URLSearchParams(location.search).has('retain'),
    getLayerRect: () => layer.getBoundingClientRect(),
    getBoardRect: () => board.getBoundingClientRect(),
    getSpaceRect: (i) => tiles[i]!.getBoundingClientRect(),
    getPanelRect: (id) => panels.get(id)?.getBoundingClientRect() ?? null,
    getSeat: (id) => PLAYERS[id]!.seat,
    getStageRect: () => inner.getBoundingClientRect(),
    getPlayerColor: (id) => PLAYERS[id]!.color,
    sfx: (name, s) => log.push(`sfx ${name}${s.pitch ? ` p${s.pitch.toFixed(2)}` : ''}`),
    haptic: (kind) => log.push(`haptic ${kind}`),
    shake(px, ms) {
      const frames = Math.max(2, Math.round(ms / 33.3));
      tween(frames, (t) => {
        const a = px * Math.exp(-3 * t) * (t >= 1 ? 0 : 1);
        const x = Math.sin(t * 22) * a;
        const y = Math.cos(t * 17) * a * 0.4;
        const tr = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        table.style.transform = tr;
        layer.style.transform = tr;
      });
    },
    dom: domHooks,
    highlight(target: HighlightTarget, ms) {
      log.push(`highlight ${JSON.stringify(target)} ${ms}`);
      const els: HTMLElement[] =
        'space' in target ? [tiles[target.space]!] : 'spaces' in target ? target.spaces.map((i) => tiles[i]!) : 'panel' in target ? [panels.get(target.panel)!] : [inner];
      for (const e of els) e.classList.add('fx-hl');
      setTimeout(() => els.forEach((e) => e.classList.remove('fx-hl')), ms);
    },
  });

  const play = <N extends PresetName>(name: N, params: PresetParams<N>): FxPlay => fx.play(name, params, { seed: 7 });
  const at = (i: number): { x: number; y: number } => {
    const r = tiles[i]!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const stageC = (): { x: number; y: number } => {
    const r = inner.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const build = (space: number, player: number, level: 1 | 2 | 3 | 4, free = false): FxPlay[] => {
    setLevel(space, level - 1, player);
    const h = play('buildSeq', { space, player, level, free, from: stageC() });
    void h.cue('swap').then(() => setLevel(space, level, player));
    return [h];
  };
  const S: Record<string, () => FxPlay[]> = {
    plot150: () => {
      setLevel(1, 0, null);
      const h = play('plotClaim', { space: 1, player: 0, price: 100 });
      void h.cue('frame').then(() => setLevel(1, 0, 0));
      return [h];
    },
    plot450: () => {
      const h = play('plotClaim', { space: 19, player: 2, price: 420 });
      void h.cue('frame').then(() => setLevel(19, 0, 2));
      return [h];
    },
    plot650: () => {
      const h = play('plotClaim', { space: 28, player: 1, price: 600 });
      void h.cue('frame').then(() => setLevel(28, 0, 1));
      return [h];
    },
    plotHub: () => {
      const h = play('plotClaim', { space: 13, player: 3, price: 500, hub: true });
      void h.cue('frame').then(() => setLevel(13, 0, 3));
      return [h];
    },
    plot1000: () => {
      const h = play('plotClaim', { space: 31, player: 1, price: 1000 });
      void h.cue('frame').then(() => setLevel(31, 0, 1));
      return [h];
    },
    build1: () => build(6, 0, 1),
    build2: () => build(6, 0, 2),
    build3: () => build(6, 0, 3),
    build4: () => build(4, 0, 4),
    build4N: () => build(20, 2, 4),
    build3E: () => build(26, 1, 3),
    free1: () => build(2, 0, 1, true),
    free3: () => build(2, 0, 3, true),
    free4: () => build(2, 0, 4, true),
    takeover: () => {
      setLevel(22, 2, 2);
      const h = play('takeoverStamp', { space: 22, buyer: 0, seller: 2 });
      void h.cue('frame').then(() => setLevel(22, 2, 0));
      return [h];
    },
    group: () => {
      for (const i of [19, 20, 22]) setLevel(i, 1, 2);
      return [play('groupChain', { spaces: [19, 20, 22], player: 2, color: GROUP_COLORS.red })];
    },
    groupFinale: () => [play('groupFinale', { spaces: [9, 10, 12], player: 3, color: GROUP_COLORS.pink })],
    landmarkMonopoly: () => {
      setLevel(31, 3, 1);
      setLevel(30, 2, 1);
      const h = fx.play('landmarkReveal', { space: 31, player: 1, group: { spaces: [30, 31], color: GROUP_COLORS.blue } }, { seed: 7 });
      void h.cue('swap').then(() => setLevel(31, 4, 1));
      return [h];
    },
    tollS: () => [play('tollPay', { payer: 0, receiver: 1, amount: 150 })],
    tollM: () => [play('tollPay', { payer: 0, receiver: 2, amount: 600 })],
    tollL: () => [play('tollPay', { payer: 3, receiver: 1, amount: 1500 })],
    tollXL: () => [play('tollPay', { payer: 0, receiver: 2, amount: 3200 })],
    tollFestival: () => [play('tollPay', { payer: 1, receiver: 3, amount: 400, festival: true, space: 16 })],
    tollHub: () => [play('tollPay', { payer: 2, receiver: 0, amount: 400, multiplier: 2 })],
    tollWaived: () => [play('tollPay', { payer: 0, receiver: 1, amount: 400, waived: true, space: 10 })],
    passStart: () => [play('passStart', { player: 0 })],
    passStartLanded: () => [play('passStart', { player: 1, landed: true })],
    cardGood: () => [play('cardReveal', { tone: 'good', at: stageC() })],
    cardBad: () => [play('cardReveal', { tone: 'bad', at: stageC() })],
    island: () => [play('islandSiren', { space: 8, player: 0, cause: 'space' })],
    islandDoubles: () => [play('islandSiren', { space: 8, player: 0, cause: 'doubles' })],
    festival: () => [play('festivalBurst', { space: 20, player: 2, previous: 12 })],
    bankruptcy: () => [play('bankruptcy', { player: 1 })],
    victoryTriple: () => [play('victory', { winner: 0, kind: 'triple', spaces: [2, 15, 20], colors: [GROUP_COLORS.brown, GROUP_COLORS.orange, GROUP_COLORS.red] })],
    victoryLine: () => [play('victory', { winner: 2, kind: 'line', spaces: [25, 26, 27, 28, 29, 30, 31] })],
    victoryHubs: () => [play('victory', { winner: 0, kind: 'hubs', spaces: [5, 13, 21, 29] })],
    victoryBankrupt: () => [play('victory', { winner: 3, kind: 'bankruptcy' })],
    victoryRounds: () => [play('victory', { winner: 1, kind: 'roundLimit' })],
    oneAway: () => [play('oneAway', { space: 4, player: 0 })],
    doubles: () => [play('doublesFlash', {})],
    tripleDoubles: () => [play('doublesFlash', { triple: true })],
    diceLand: () => {
      const c = stageC();
      return [play('diceLand', { points: [{ x: c.x - 40, y: c.y }, { x: c.x + 40, y: c.y }] })];
    },
    hop: () => [play('hopDust', { space: 3, long: true, dir: 180 })],
    tap: () => [play('tap', { ...at(7), player: 0 })],
    coinIn: () => [play('coinIn', { from: { panel: 3 }, to: { space: 11 }, n: 6 })],
    frameSwap: () => [play('frameSwap', { space: 15, from: 3, to: 1 })],
    pulse: () => [play('ringPulse', { at: { space: 8 }, color: '#6EC6F0', double: true, sparkles: 4 })],
    demolish: () => [play('puff', { at: { space: 14 }, smoke: 2, bricks: 8 })],
    jump: () => [play('cometJump', { from: 3, to: 8, player: 0 })],
    billRain: () => [play('billRain', { player: 3 })],
    stress: () => [
      ...S.landmarkMonopoly!(),
      play('victory', { winner: 0, kind: 'hubs', spaces: [5, 13, 21, 29] }),
      play('tollPay', { payer: 3, receiver: 2, amount: 3200 }),
    ],
  };

  for (const name of Object.keys(S)) {
    const b = el('button', '');
    b.textContent = name;
    b.onclick = () => void api.run(name);
    ui.append(b);
  }
  ui.append(statsEl);
  setInterval(() => {
    const s = fx.stats();
    statsEl.textContent = `live ${s.live} peak ${s.peak} fx ${s.effects.join(',')}\ncanvas ${s.canvas ? `${s.canvas.hidden ? 'hidden' : `${Math.round(s.canvas.w)}x${Math.round(s.canvas.h)} @${s.canvas.scale.toFixed(2)}`}` : '-'}\ntick ${s.tick.last.toFixed(2)} max ${s.tick.max.toFixed(2)} ms`;
  }, 250);

  const api: DemoApi = {
    scenarios: Object.keys(S),
    run: (name) => {
      log.length = 0;
      return S[name]?.() ?? [];
    },
    manual(on) {
      clock.useManual = on;
    },
    step(n = 1) {
      clock.hand.step(n);
    },
    reduced(on) {
      clock.hand.reduced = on;
    },
    skip: () => fx.skip(),
    stats: () => fx.stats(),
    rects: () => ({ board: board.getBoundingClientRect(), layer: layer.getBoundingClientRect(), stage: inner.getBoundingClientRect() }),
    reset(soft = false) {
      if (!soft) fx.stopAll();
      fx.resetStats();
      for (let i = 0; i < BOARD.length; i++) setLevel(i, 0, null);
      for (const ic of icons) ic.style.transform = '';
    },
    fx,
    log,
  };
  (window as unknown as { __vfxDemo: DemoApi }).__vfxDemo = api;
  return api;
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
