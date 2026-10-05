/**
 * Money-stage demo (dev only, not part of the build): a mock table (board ring + four seat panels
 * laid out by ui/layout.ts) with the money stage over it, and a button for every scene × seat.
 * `money-demo.html` (repo root, Vite dev server) mounts it. For deterministic filmstrips:
 *
 *   __moneyDemo.manual(true); __moneyDemo.run('toll', 'S'); __moneyDemo.step(2); …
 *
 * The board "camera" (pull back + tilt) is bound here the way the wiring will bind it in-game.
 */
import type { Seat } from '@/engine';
import { BOARD, GROUP_COLORS, HUB_COLOR } from '@/content/board';
import { PLAYER_COLORS } from '@/content/palette';
import { iconMarkup } from '@/content/icons';
import { GEOM, VB } from '@/ui/board/geometry';
import { computeLayout, type GameLayout } from '@/ui/layout';
import { loc } from '@/i18n';
import { iconId } from '@/ui/game/util';
import { activeFrameTicks, animSpeed, endSkip, isManualClock, setAnimSpeed, setManualClock, setPace, setReducedMotion, skip, stepClock } from '../time';
import { loadMoneyAtlas } from './atlas';
import { MoneyStage, SEATS, type Rect } from './stage';
import { SCENES, type MoneyPlay, type Party } from './scenes';
import { f } from './clock';

const CSS = `
html,body{margin:0;height:100%;background:#16202D;overflow:hidden;font-family:var(--font-body,system-ui)}
.md-root{position:absolute;inset:0;overflow:hidden}
.md-board{position:absolute;background:#E9DDC6;border-radius:1.2%;box-shadow:0 10px 40px rgba(0,0,0,.45);transform-origin:50% 50%}
.md-sp{position:absolute;box-sizing:border-box;border:1px solid #D8C9AC;background:#F4EBD8;overflow:hidden}
.md-sp.own{box-shadow:inset 0 0 0 3px var(--oc)}
.md-band{position:absolute;left:0;right:0;top:0;height:20%}
.md-ic{position:absolute;inset:24% 14% 6%}
.md-ic svg{width:100%;height:100%;display:block}
.md-inner{position:absolute;display:grid;place-items:center;color:#2E6E6A;background:#1F5257;border-radius:3%;font:400 calc(var(--u)*1.6) var(--font-display,system-ui);color:#CFE9E4;letter-spacing:.06em}
.md-pp{position:absolute;box-sizing:border-box;border-radius:14px;background:#243246;border:3px solid var(--pc);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font:700 15px system-ui}
.md-pp b{font:400 26px var(--font-display,system-ui);color:#FFE08A}
.md-ui{position:absolute;left:4px;top:4px;z-index:80;display:flex;flex-wrap:wrap;gap:3px;max-width:330px;background:#0E141Ccc;padding:4px;border-radius:8px}
.md-ui button{font:600 11px system-ui;padding:3px 6px;border-radius:6px;border:0;background:#33445c;color:#fff;cursor:pointer}
.md-ui button.on{background:#E9A92A;color:#1B2130}
.md-ui .md-stats{font:11px ui-monospace,monospace;color:#9fb0c8;white-space:pre;width:100%}
`;

const PLAYERS: Record<Seat, { color: string; name: string }> = {
  S: { color: PLAYER_COLORS[0]!.hex, name: '민지' },
  E: { color: PLAYER_COLORS[1]!.hex, name: '준호' },
  N: { color: PLAYER_COLORS[2]!.hex, name: '서연' },
  W: { color: PLAYER_COLORS[3]!.hex, name: 'AI' },
};
const START_CASH: Record<Seat, number> = { S: 3450, E: 2120, N: 5080, W: 760 };

export const SCENARIOS = [
  'purchase', 'build1', 'build2', 'build3', 'build4', 'toll', 'tollFestival', 'takeover', 'collect', 'collectXL',
  'payAll', 'salary', 'potBonus', 'tax', 'donation', 'bail', 'bankruptcy', 'fromBank',
] as const;
export type Scenario = (typeof SCENARIOS)[number];

export interface MoneyDemoApi {
  scenarios: readonly string[];
  stage: MoneyStage;
  run(name: Scenario, seat?: Seat): MoneyPlay;
  manual(on: boolean): void;
  step(n?: number): void;
  speed(x: number): void;
  reduced(on: boolean): void;
  skip(): void;
  reset(): void;
  stats(): Record<string, unknown>;
  layout(w?: number, h?: number): GameLayout;
  ui(on: boolean): void;
  preload(): Promise<boolean>;
}

declare global {
  interface Window {
    __moneyDemo?: MoneyDemoApi;
  }
}

export function mountMoneyDemo(host: HTMLElement): MoneyDemoApi {
  // The app's default game pace (Settings "게임 속도" = 2): scenes play at their written length.
  setPace(2);
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const root = document.createElement('div');
  root.className = 'md-root';
  host.append(root);

  let cash = { ...START_CASH };
  const owners: Array<Seat | null> = BOARD.map(() => null);
  owners[15] = 'E';
  owners[20] = 'N';
  owners[4] = 'W';
  owners[6] = 'W';
  owners[9] = 'W';

  let L!: GameLayout;
  let board!: HTMLElement;
  const tiles: HTMLElement[] = [];
  const panels = {} as Record<Seat, HTMLElement>;

  const draw = (): void => {
    root.querySelectorAll('.md-board,.md-pp').forEach((e) => e.remove());
    tiles.length = 0;
    L = computeLayout(innerWidth, innerHeight, new Set(SEATS));
    const size = L.board.w;
    board = document.createElement('div');
    board.className = 'md-board';
    Object.assign(board.style, { left: `${L.board.x}px`, top: `${L.board.y}px`, width: `${size}px`, height: `${size}px` });
    board.style.setProperty('--u', `${size / 32}px`);
    const k = size / VB;
    for (const g of GEOM) {
      const sp = BOARD[g.index]!;
      const t = document.createElement('div');
      t.className = 'md-sp';
      Object.assign(t.style, { left: `${g.x * k}px`, top: `${g.y * k}px`, width: `${g.w * k}px`, height: `${g.h * k}px` });
      const col = sp.kind === 'hub' ? HUB_COLOR : sp.group ? GROUP_COLORS[sp.group] : null;
      if (col) {
        const band = document.createElement('div');
        band.className = 'md-band';
        band.style.background = col;
        t.append(band);
      }
      const ic = document.createElement('div');
      ic.className = 'md-ic';
      ic.innerHTML = iconMarkup(iconId(sp.iconId));
      t.append(ic);
      const o = owners[g.index];
      if (o) {
        t.classList.add('own');
        t.style.setProperty('--oc', PLAYERS[o].color);
      }
      board.append(t);
      tiles.push(t);
    }
    const inner = document.createElement('div');
    inner.className = 'md-inner';
    const d = 460 * k;
    Object.assign(inner.style, { left: `${d}px`, top: `${d}px`, width: `${size - 2 * d}px`, height: `${size - 2 * d}px` });
    inner.textContent = 'MONEY POLY';
    board.append(inner);
    root.prepend(board);
    for (const s of SEATS) {
      const b = L.seats[s]!;
      const p = document.createElement('div');
      p.className = 'md-pp';
      p.style.setProperty('--pc', PLAYERS[s].color);
      Object.assign(p.style, { left: `${b.x + b.w / 2}px`, top: `${b.y + b.h / 2}px`, width: `${b.innerW}px`, height: `${b.innerH}px`, transform: `translate(-50%,-50%) rotate(${b.rot}deg)` });
      p.innerHTML = `<span>${PLAYERS[s].name} · ${s}</span><b>${cash[s].toLocaleString()}</b>`;
      root.append(p);
      panels[s] = p;
    }
  };
  draw();

  const rectOf = (e: Element): Rect => {
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };
  const stage: MoneyStage = new MoneyStage({
    parent: root,
    boardRect: () => rectOf(board),
    seatRect: (s) => (panels[s] ? rectOf(panels[s]) : null),
    tileRect: (i) => (tiles[i] ? rectOf(tiles[i]!) : null),
    space: (i) => {
      const sp = BOARD[i]!;
      return { icon: iconId(sp.iconId), name: loc(sp.short), color: sp.kind === 'hub' ? HUB_COLOR : sp.group ? GROUP_COLORS[sp.group] : undefined };
    },
    camera: (state, _tier, ms) => {
      // The in-game wiring does the same on the real board (transform only).
      void stage.tween(ms, (u) => {
        const k = state === 'in' ? u : 1 - u;
        board.style.transform = k ? `perspective(1400px) rotateX(${(9 * k).toFixed(2)}deg) scale(${(1 - 0.08 * k).toFixed(4)})` : '';
      });
    },
  });
  void loadMoneyAtlas();

  const party = (s: Seat, extra = 0): Party => ({ seat: s, cash: cash[s] + extra, color: PLAYERS[s].color });
  const next = (s: Seat, k = 1): Seat => SEATS[(SEATS.indexOf(s) + k) % 4]!;
  const others = (s: Seat): Seat[] => SEATS.filter((x) => x !== s);
  const refresh = (): void => {
    for (const s of SEATS) panels[s].querySelector('b')!.textContent = cash[s].toLocaleString();
  };
  const own = (i: number, s: Seat | null): void => {
    owners[i] = s;
    const t = tiles[i]!;
    t.classList.toggle('own', !!s);
    if (s) t.style.setProperty('--oc', PLAYERS[s].color);
  };

  const run = (name: Scenario, seat: Seat = 'S'): MoneyPlay => {
    const st = stage;
    const pay = (s: Seat, v: number): void => void (cash[s] = Math.max(0, cash[s] - v));
    const get = (s: Seat, v: number): void => void (cash[s] += v);
    let play: MoneyPlay;
    switch (name) {
      case 'purchase': {
        const i = 7;
        play = SCENES.purchase(st, { seat, cash: cash[seat], playerColor: PLAYERS[seat].color, spaceIndex: i, price: BOARD[i]!.price! });
        pay(seat, BOARD[i]!.price!);
        void play.then(() => own(i, seat));
        break;
      }
      case 'build1':
      case 'build2':
      case 'build3':
      case 'build4': {
        const level = Number(name.slice(5)) as 1 | 2 | 3 | 4;
        const cost = [0, 100, 150, 250, 500][level]!;
        play = SCENES.build(st, { seat, cash: cash[seat], playerColor: PLAYERS[seat].color, spaceIndex: 22, cost, level });
        pay(seat, cost);
        break;
      }
      case 'toll':
      case 'tollFestival': {
        const owner = next(seat, 2);
        const amount = name === 'toll' ? 340 : 1360;
        play = SCENES.toll(st, { payer: party(seat), owner: party(owner), spaceIndex: 20, amount, festival: name === 'tollFestival' });
        pay(seat, amount);
        get(owner, amount);
        break;
      }
      case 'takeover': {
        const seller = next(seat, 1);
        play = SCENES.takeover(st, { buyer: party(seat), seller: party(seller), spaceIndex: 15, price: 680 });
        pay(seat, 680);
        get(seller, 680);
        void play.then(() => own(15, seat));
        break;
      }
      case 'collect':
      case 'collectXL': {
        const amt = name === 'collect' ? 100 : 450;
        const payers = others(seat).map((s) => ({ ...party(s), amount: Math.min(cash[s], amt) }));
        play = SCENES.collectFromAll(st, { payers, receiver: party(seat), tier: name === 'collectXL' ? 'XL' : undefined });
        for (const p of payers) pay(p.seat, p.amount);
        get(seat, payers.reduce((s, p) => s + p.amount, 0));
        break;
      }
      case 'payAll': {
        const receivers = others(seat).map((s) => ({ ...party(s), amount: 50 }));
        play = SCENES.payAll(st, { payer: party(seat), receivers });
        pay(seat, 150);
        for (const r of receivers) get(r.seat, 50);
        break;
      }
      case 'salary':
        play = SCENES.receive(st, { seat, cash: cash[seat], playerColor: PLAYERS[seat].color, amount: 300, kind: 'salary' });
        get(seat, 300);
        break;
      case 'potBonus':
        play = SCENES.receive(st, { seat, cash: cash[seat], playerColor: PLAYERS[seat].color, amount: 850, kind: 'pot' });
        get(seat, 850);
        break;
      case 'tax':
      case 'donation':
      case 'bail': {
        const amount = name === 'tax' ? 240 : name === 'donation' ? 100 : 200;
        play = SCENES.pay(st, { seat, cash: cash[seat], playerColor: PLAYERS[seat].color, amount, kind: name });
        pay(seat, amount);
        break;
      }
      case 'bankruptcy': {
        const creditor = next(seat, 2);
        const props = owners.map((o, i) => (o ? i : -1)).filter((i) => i >= 0).slice(0, 5);
        play = SCENES.bankruptcy(st, { debtor: party(seat), creditor: party(creditor), properties: props.length ? props : [4, 6, 9] });
        get(creditor, cash[seat]);
        cash[seat] = 0;
        break;
      }
      case 'fromBank':
      default:
        play = SCENES.transfer(st, { from: 'bank', to: party(seat), amount: 500, title: '은행' });
        get(seat, 500);
        break;
    }
    void play.then(refresh);
    return play;
  };

  // ---- UI
  const ui = document.createElement('div');
  ui.className = 'md-ui';
  let seat: Seat = 'S';
  const seatBtns: HTMLButtonElement[] = [];
  for (const s of SEATS) {
    const b = document.createElement('button');
    b.textContent = s;
    b.onclick = () => {
      seat = s;
      seatBtns.forEach((x) => x.classList.toggle('on', x === b));
    };
    if (s === 'S') b.classList.add('on');
    seatBtns.push(b);
    ui.append(b);
  }
  for (const n of SCENARIOS) {
    const b = document.createElement('button');
    b.textContent = n;
    b.onclick = () => void run(n, seat);
    ui.append(b);
  }
  const extra: Array<[string, () => void]> = [
    ['skip ×5', () => skip()],
    ['speed ½', () => setAnimSpeed(animSpeed() === 1 ? 0.5 : 1)],
    ['reduced', () => setReducedMotion(!document.body.classList.toggle('md-red') ? false : true)],
    ['reset', () => api.reset()],
  ];
  for (const [label, fn] of extra) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = fn;
    ui.append(b);
  }
  const statsEl = document.createElement('div');
  statsEl.className = 'md-stats';
  ui.append(statsEl);
  root.append(ui);
  setInterval(() => {
    if (!isManualClock()) statsEl.textContent = JSON.stringify(api.stats());
  }, 500);

  const api: MoneyDemoApi = {
    scenarios: SCENARIOS,
    stage,
    run,
    manual: (on) => setManualClock(on),
    step: (n = 1) => stepClock(n),
    speed: (x) => setAnimSpeed(x),
    reduced: (on) => setReducedMotion(on),
    skip: () => skip(),
    reset: () => {
      endSkip();
      stage.park();
      stage.newTurn();
      cash = { ...START_CASH };
      refresh();
    },
    stats: () => ({
      live: stage.live,
      t: Math.round(stage.clock?.t ?? 0),
      frame: Math.round((stage.clock?.t ?? 0) / f(1)),
      flying: stage.coins.flying,
      nodesInUse: stage.coins.inUse,
      peakFlying: stage.coins.peakFlying,
      peakNodes: stage.coins.peakNodes,
      ticks: activeFrameTicks(),
      stageNodes: stage.root.querySelectorAll('*').length,
    }),
    layout: () => L,
    ui: (on) => void (ui.style.display = on ? '' : 'none'),
    preload: () => loadMoneyAtlas(),
  };
  addEventListener('resize', () => {
    draw();
  });
  window.__moneyDemo = api;
  return api;
}
