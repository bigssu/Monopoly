/**
 * "연출 미리보기" (dev only: `npm run dev` → `/?dev=1&fxdemo=1`). A panel over the REAL game that
 * replays synthetic engine events through the real sequencer (`playEvents`) on the live board:
 * the same presets, cue-deferred state swaps, stamps, close-up card, spotlight, floats and sounds
 * as in play. Pick the acting seat, press a moment; "원래대로" re-renders the game's real state.
 * Only imported behind `import.meta.env.DEV` (absent from production builds).
 */
import { citiesInGroup, deepClone, groupOf, type GameEvent, type GameState, type Level, type PlayerId } from '@/engine';
import { playEvents } from '@/ui/fx/animate';
import { animSpeed, setAnimSpeed, skip, endSkip } from '@/ui/fx/time';
import type { GameView } from './view';

interface Moment {
  label: string;
  /** Build the events for actor `a` (and set up the "before" state in `vs`); `next` = state after. */
  make(a: PlayerId, vs: GameState, next: GameState): GameEvent[];
}

/** The actor's showcase city per seat index (last city of a colour group). */
const CITY = [31, 22, 12, 7];

const other = (vs: GameState, a: PlayerId): PlayerId => ((a + 1) % vs.players.length) as PlayerId;
const own = (s: GameState, i: number, owner: PlayerId | null, level = 0): void => {
  s.properties[i] = { owner, level: level as Level };
};
const money = (pid: PlayerId, delta: number, reason: 'purchase' | 'build' | 'toll' | 'takeover' | 'card', s: GameState): GameEvent => {
  s.players[pid]!.cash += delta;
  return { type: 'MoneyChanged', playerId: pid, delta, balance: s.players[pid]!.cash, reason, counterpart: 'bank' };
};

function city(vs: GameState, a: PlayerId): number {
  return CITY[vs.players[a]!.seat === 'S' ? 0 : vs.players[a]!.seat === 'E' ? 1 : vs.players[a]!.seat === 'N' ? 2 : 3]!;
}

function build(level: 1 | 2 | 3 | 4, free = false): Moment {
  return {
    label: free ? `무료 업그레이드 L${level}` : level === 4 ? '명소 완성 L4' : `건설 L${level}`,
    make: (a, vs, next) => {
      const c = city(vs, a);
      own(vs, c, a, level - 1);
      own(next, c, a, level);
      const ev: GameEvent[] = free ? [] : [money(a, -200 * level, 'build', next)];
      return [...ev, { type: 'Built', playerId: a, spaceIndex: c, level, cost: 200 * level, free }];
    },
  };
}

function toll(label: string, amount: number, o: { festival?: boolean; waived?: boolean; multiplier?: number } = {}): Moment {
  return {
    label,
    make: (a, vs, next) => {
      const b = other(vs, a);
      const c = city(vs, b);
      own(vs, c, b, 3);
      own(next, c, b, 3);
      const ev: GameEvent[] = [
        { type: 'TollPaid', payerId: a, ownerId: b, spaceIndex: c, amount: o.waived ? 0 : amount, baseToll: amount, festival: !!o.festival, multiplier: o.multiplier ?? 1, waived: !!o.waived },
      ];
      if (!o.waived) ev.push(money(a, -amount, 'toll', next), money(b, amount, 'toll', next));
      return ev;
    },
  };
}

const MOMENTS: Moment[] = [
  {
    label: '구매',
    make: (a, vs, next) => {
      const c = city(vs, a);
      own(vs, c, null);
      own(next, c, a);
      return [money(a, -500, 'purchase', next), { type: 'PropertyBought', playerId: a, spaceIndex: c, price: 500, via: 'buy' }];
    },
  },
  {
    label: '구매 → 그룹 독점',
    make: (a, vs, next) => {
      const c = city(vs, a);
      for (const i of citiesInGroup(groupOf(c)!)) {
        own(vs, i, i === c ? null : a);
        own(next, i, a);
      }
      return [money(a, -1000, 'purchase', next), { type: 'PropertyBought', playerId: a, spaceIndex: c, price: 1000, via: 'buy' }];
    },
  },
  build(1),
  build(2),
  build(3),
  build(4),
  build(2, true),
  build(4, true),
  toll('통행료 소', 150),
  toll('통행료 중', 600),
  toll('통행료 대', 1500),
  toll('통행료 특대', 3200),
  toll('통행료 축제', 800, { festival: true }),
  toll('통행료 면제권', 800, { waived: true }),
  {
    label: '인수 → 그룹 독점',
    make: (a, vs, next) => {
      const b = other(vs, a);
      const c = city(vs, a);
      for (const i of citiesInGroup(groupOf(c)!)) {
        own(vs, i, i === c ? b : a, i === c ? 2 : 0);
        own(next, i, a, i === c ? 2 : 0);
      }
      return [{ type: 'TakenOver', buyerId: a, sellerId: b, spaceIndex: c, price: 1600 }, money(a, -1600, 'takeover', next)];
    },
  },
  { label: '출발 통과', make: (a) => [{ type: 'PassedStart', playerId: a, salary: 300, landed: false }] },
  { label: '출발 도착 (팟)', make: (a) => [{ type: 'PassedStart', playerId: a, salary: 300, landed: true }] },
  { label: '더블', make: (a) => [{ type: 'DiceRolled', playerId: a, dice: [4, 4], total: 8, isDouble: true, consecutiveDoubles: 1, express: false, steps: 0, context: 'normal' }] },
  {
    label: '3연속 더블 → 무인도',
    make: (a) => [
      { type: 'DiceRolled', playerId: a, dice: [2, 2], total: 4, isDouble: true, consecutiveDoubles: 3, express: false, steps: 0, context: 'normal' },
      { type: 'SentToIsland', playerId: a, cause: 'doubles' },
    ],
  },
  {
    label: '이동 8칸',
    make: (a, vs, next) => {
      const from = vs.players[a]!.position;
      const path = Array.from({ length: 8 }, (_, k) => (from + k + 1) % 32);
      next.players[a]!.position = path[7]!;
      return [{ type: 'TokenMoved', playerId: a, from, to: path[7]!, path, direction: 'forward', mode: 'walk', passedStart: false, cause: 'roll' }];
    },
  },
  {
    label: '무인도로 점프',
    make: (a, vs, next) => {
      next.players[a]!.position = 8;
      return [
        { type: 'TokenMoved', playerId: a, from: vs.players[a]!.position, to: 8, path: [8], direction: 'forward', mode: 'jump', passedStart: false, cause: 'card' },
        { type: 'SentToIsland', playerId: a, cause: 'card' },
      ];
    },
  },
  { label: '카드: 좋음', make: (a) => [{ type: 'CardDrawn', playerId: a, cardId: 'lottery' }] },
  { label: '카드: 나쁨', make: (a) => [{ type: 'CardDrawn', playerId: a, cardId: 'fine' }] },
  {
    label: '축제 개최',
    make: (a, vs, next) => {
      const c = city(vs, a);
      own(vs, c, a, 1);
      own(next, c, a, 1);
      next.festival = c;
      return [{ type: 'FestivalSet', playerId: a, spaceIndex: c, previous: 12 === c ? 22 : 12 }];
    },
  },
  { label: '여행권', make: (a) => [{ type: 'TravelGranted', playerId: a }] },
  {
    label: '한 칸 남음',
    make: (a, vs) => {
      const c = city(vs, a);
      for (const i of citiesInGroup(groupOf(c)!)) own(vs, i, i === c ? null : a);
      return [{ type: 'OneAway', playerId: a, kind: 'group', id: groupOf(c)!, missing: c }];
    },
  },
  {
    label: '태풍',
    make: (a, vs, next) => {
      const b = other(vs, a);
      const c = city(vs, b);
      own(vs, c, b, 2);
      own(next, c, b, 1);
      return [{ type: 'Demolished', spaceIndex: c, ownerId: b, level: 1, cause: 'typhoon' }];
    },
  },
  {
    label: '파산',
    make: (a, _vs, next) => {
      next.players[a]!.bankrupt = true;
      return [{ type: 'Bankrupt', playerId: a, creditorId: null, round: 5 }];
    },
  },
  ...(['hubs', 'triple', 'line', 'bankruptcy', 'roundLimit'] as const).map(
    (kind): Moment => ({
      label: `승리: ${kind}`,
      make: (a) => [
        {
          type: 'GameOver',
          result: { winnerId: a, victory: kind, round: 9, ranking: [], ...(kind === 'triple' ? { groups: ['brown', 'red', 'blue'] } : {}), ...(kind === 'line' ? { side: 'D' } : {}) },
        },
      ],
    }),
  ),
];

const CSS = `
.fxd{position:fixed;left:8px;top:56px;z-index:200;width:236px;max-height:calc(100vh - 70px);overflow:auto;background:rgba(14,20,28,.92);color:#E8EDF5;border-radius:12px;padding:8px;font:600 12px system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)}
.fxd h3{margin:0 0 6px;font-size:13px}
.fxd .row{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px}
.fxd button{font:600 11px system-ui,sans-serif;padding:4px 7px;border-radius:7px;border:0;background:#33445c;color:#fff;cursor:pointer}
.fxd button.on{background:#F2B633;color:#1B2430}
.fxd button:disabled{opacity:.45}
.fxd.is-folded>:not(h3){display:none}
.fxd small{display:block;color:#9FB0C8;font-weight:500;margin-top:4px}
`;

/** Mount the panel; returns the unmount function. */
export function mountFxDemo(view: GameView, realState: () => GameState): () => void {
  const style = document.createElement('style');
  style.textContent = CSS;
  const panel = document.createElement('div');
  panel.className = 'fxd';
  panel.innerHTML = '<h3>연출 미리보기 <button class="fxd-fold">접기</button></h3>';
  panel.querySelector('.fxd-fold')!.addEventListener('click', (e) => {
    e.stopPropagation();
    const folded = panel.classList.toggle('is-folded');
    (e.target as HTMLElement).textContent = folded ? '펼치기' : '접기';
  });
  const seats = document.createElement('div');
  seats.className = 'row';
  const speeds = document.createElement('div');
  speeds.className = 'row';
  const list = document.createElement('div');
  list.className = 'row';
  const tools = document.createElement('div');
  tools.className = 'row';
  const note = document.createElement('small');
  panel.append(seats, speeds, list, tools, note);
  document.head.append(style);
  document.body.append(panel);

  let actor: PlayerId = realState().current;
  let busy = false;
  let alive = true;
  const btn = (row: HTMLElement, text: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = text;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
    row.append(b);
    return b;
  };
  const seatBtns = realState().players.map((p) =>
    btn(seats, `${p.seat} ${p.name}`, () => {
      actor = p.id;
      seatBtns.forEach((b, k) => b.classList.toggle('on', k === actor));
    }),
  );
  seatBtns[actor]?.classList.add('on');
  const speedBtns = [1, 0.5, 0.25].map((x) =>
    btn(speeds, `×${x}`, () => {
      setAnimSpeed(x);
      speedBtns.forEach((b) => b.classList.toggle('on', b.textContent === `×${x}`));
    }),
  );
  speedBtns.find((b) => b.textContent === `×${animSpeed()}`)?.classList.add('on');
  const buttons = MOMENTS.map((m) =>
    btn(list, m.label, () => {
      if (busy) return;
      busy = true;
      buttons.forEach((b) => (b.disabled = true));
      const vs = deepClone(view.renderedState());
      vs.players.forEach((p) => (p.cash = Math.max(p.cash, 5000)));
      const next = deepClone(vs);
      const events = m.make(actor, vs, next);
      view.stage.clearPrompt();
      view.render(vs);
      note.textContent = m.label;
      // Like a real turn: the stage faces the acting seat first.
      void view.stage
        .rotateTo(vs.players[actor]!.seat)
        .then(() => playEvents(view, vs, events, next, () => alive))
        .finally(() => {
        endSkip();
        busy = false;
        buttons.forEach((b) => (b.disabled = false));
      });
    }),
  );
  btn(tools, '건너뛰기', () => {
    skip();
    view.vfx.skip();
  });
  btn(tools, '원래대로', () => {
    view.stopFx();
    view.render(realState());
  });
  note.textContent = '좌석을 고르고 순간을 누르세요 (게임 상태는 바뀌지 않음).';
  return () => {
    alive = false;
    panel.remove();
    style.remove();
  };
}
