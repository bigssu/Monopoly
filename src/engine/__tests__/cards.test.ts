import { describe, expect, it } from 'vitest';
import type { CardId } from '../../content/cards';
import { ECONOMY } from '../economy';
import { reduce } from '../reducer';
import type { GameState } from '../types';
import { act, edit, game, ofType, own, queueDice, queuePicks, roll } from './helpers';

/** P0 at `from`, rolls to the event space `event`, drawing `card`. */
function drawAt(card: CardId, event = 3, setup: (st: GameState) => void = () => {}, dice: [number, number] = [1, 2]) {
  const s = edit(game({ n: 3 }), (st) => {
    st.players[0]!.position = event - (dice[0] + dice[1]);
    queueDice(st, dice);
    st.testHooks!.cardQueue = [card];
    setup(st);
  });
  const r = act(s, roll(0));
  expect(ofType(r.events, 'CardDrawn')[0]).toMatchObject({ playerId: 0, cardId: card });
  return r;
}

describe('event cards', () => {
  it('1 출발지로 이동: walk to Start, salary + pot', () => {
    const r = drawAt('to-start', 3, (st) => (st.pot = 120));
    const mv = ofType(r.events, 'TokenMoved').at(-1)!;
    expect(mv).toMatchObject({ cause: 'card', to: 0, passedStart: true });
    expect(mv.path).toHaveLength(29);
    expect(r.state.players[0]!.cash).toBe(3000 + ECONOMY.salary + 120);
  });

  it('2 무인도로 이동: jump to the island, no salary, turn ends even after doubles', () => {
    const r = drawAt('to-island', 3, () => {}, [1, 1]);
    expect(ofType(r.events, 'TokenMoved').at(-1)).toMatchObject({ mode: 'jump', to: 8, passedStart: false });
    expect(ofType(r.events, 'SentToIsland')[0]).toMatchObject({ cause: 'card' });
    expect(r.state.players[0]!.islandTurns).toBe(3);
    expect(r.state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
  });

  it('3 자유여행으로 이동: travel next turn', () => {
    const r = drawAt('to-travel', 18);
    expect(r.state.players[0]!).toMatchObject({ position: 24, travelPending: true });
  });

  it('4 축제로 이동: festival prompt', () => {
    const r = drawAt('to-festival', 3, (st) => own(st, 1, 0));
    expect(r.state.phase).toMatchObject({ kind: 'festival', options: [1] });
  });

  it.each([
    ['bank-dividend', 200],
    ['lottery', 500],
    ['tax-refund', 100],
    ['fine', -150],
  ] as const)('%s changes cash by %i', (card, delta) => {
    const r = drawAt(card);
    expect(r.state.players[0]!.cash).toBe(3000 + delta);
  });

  it('8 건물 수리비: 30 per building level', () => {
    const r = drawAt('repairs', 3, (st) => {
      own(st, 10, 0, 2);
      own(st, 12, 0, 1);
      own(st, 5, 0);
    });
    expect(r.state.players[0]!.cash).toBe(3000 - 90);
  });

  it('9 생일: every other player pays 100 (or all they have)', () => {
    const r = drawAt('birthday', 3, (st) => (st.players[2]!.cash = 40));
    expect(r.state.players[0]!.cash).toBe(3140);
    expect(r.state.players[1]!.cash).toBe(2900);
    expect(r.state.players[2]!.cash).toBe(0);
  });

  it('10 기부: pay 50 to every other player', () => {
    const r = drawAt('charity');
    expect(r.state.players.map((p) => p.cash)).toEqual([2900, 3050, 3050]);
  });

  it('11 3칸 뒤로: walk back and resolve (landing on Start pays salary + pot)', () => {
    let r = drawAt('back-three', 18);
    expect(ofType(r.events, 'TokenMoved').at(-1)).toMatchObject({ direction: 'backward', path: [17, 16, 15], to: 15 });
    expect(r.state.phase).toMatchObject({ kind: 'buy', spaceIndex: 15 });
    r = drawAt('back-three', 3, (st) => (st.pot = 70));
    expect(r.state.players[0]!.position).toBe(0);
    expect(r.state.players[0]!.cash).toBe(3000 + ECONOMY.salary + 70);
  });

  it('12 가장 가까운 허브: owner charges double toll', () => {
    const r = drawAt('nearest-hub', 3, (st) => {
      own(st, 5, 1);
      own(st, 13, 1);
    });
    expect(ofType(r.events, 'TollPaid')[0]).toMatchObject({ spaceIndex: 5, amount: 400, baseToll: 200, multiplier: 2 });
  });

  it('12 가장 가까운 허브: unowned → buy prompt; wraps past Start from 27', () => {
    expect(drawAt('nearest-hub').state.phase).toMatchObject({ kind: 'buy', spaceIndex: 5 });
    const r = drawAt('nearest-hub', 27);
    expect(r.state.phase).toMatchObject({ kind: 'buy', spaceIndex: 29 });
  });

  it.each(['escape', 'toll-pass', 'shield'] as const)('keepable card %s goes to hand', (card) => {
    const r = drawAt(card);
    expect(r.state.players[0]!.cards).toEqual([card]);
    expect(ofType(r.events, 'CardKept')[0]).toMatchObject({ card });
  });

  it('16 복지기금: receive the pot', () => {
    const r = drawAt('welfare', 3, (st) => (st.pot = 330));
    expect(r.state.players[0]!.cash).toBe(3330);
    expect(r.state.pot).toBe(0);
  });

  it('17 급행: next roll moves double', () => {
    let r = drawAt('express');
    expect(r.state.players[0]!.expressPending).toBe(true);
    const s = edit(r.state, (st) => {
      st.current = 0;
      st.phase = { kind: 'preRoll', playerId: 0, rollAgain: false };
      queueDice(st, [1, 3]);
    });
    r = act(s, roll(0));
    expect(ofType(r.events, 'DiceRolled')[0]).toMatchObject({ total: 4, steps: 8, express: true });
    expect(r.state.players[0]!.position).toBe(11);
    expect(r.state.players[0]!.expressPending).toBe(false);
  });

  it('18 랜덤 점프: walk to a random city', () => {
    const r = drawAt('random-jump', 3, (st) => queuePicks(st, 0));
    expect(r.state.players[0]!.position).toBe(1);
    expect(ofType(r.events, 'TokenMoved').at(-1)).toMatchObject({ passedStart: true });
    const r2 = drawAt('random-jump', 18);
    expect(r2.state.players[0]!.position).not.toBe(18);
  });

  it('20 부자세: richest pays 200 to poorest; no-op on ties', () => {
    const r = drawAt('leader-tax', 3, (st) => {
      st.players[1]!.cash = 5000;
      st.players[2]!.cash = 1000;
    });
    expect(r.state.players.map((p) => p.cash)).toEqual([3000, 4800, 1200]);
    const tie = drawAt('leader-tax');
    expect(ofType(tie.events, 'CardNoEffect')).toHaveLength(1);
  });

  it('21 건물 보너스: choose a city for a free upgrade', () => {
    let r = drawAt('free-upgrade', 3, (st) => {
      own(st, 10, 0, 1);
      own(st, 12, 0, 4);
    });
    expect(r.state.phase).toMatchObject({ kind: 'freeUpgrade', options: [10] });
    r = act(r.state, { type: 'FreeUpgrade', playerId: 0, spaceIndex: 10 });
    expect(r.state.properties[10]!.level).toBe(2);
    expect(r.state.players[0]!.cash).toBe(3000);
    expect(ofType(r.events, 'Built')[0]).toMatchObject({ free: true, cost: 0 });
    expect(ofType(drawAt('free-upgrade').events, 'CardNoEffect')).toHaveLength(1);
  });

  it('22 태풍: an opponent city loses one level; landmarks immune', () => {
    let r = drawAt('typhoon', 3, (st) => {
      own(st, 10, 1, 2);
      own(st, 12, 2, 4);
      own(st, 9, 0, 3);
    });
    expect(r.state.properties[10]!.level).toBe(1);
    expect(r.state.properties[12]!.level).toBe(4);
    expect(r.state.properties[9]!.level).toBe(3);
    r = drawAt('typhoon', 3, (st) => own(st, 12, 2, 4));
    expect(ofType(r.events, 'CardNoEffect')).toHaveLength(1);
  });

  it('23 축제 초대: the marker moves to one of your cities', () => {
    const r = drawAt('festival-invite', 3, (st) => {
      own(st, 10, 0);
      own(st, 31, 1);
      st.festival = 31;
    });
    expect(r.state.festival).toBe(10);
    expect(ofType(drawAt('festival-invite').events, 'CardNoEffect')).toHaveLength(1);
  });

  it('24 세계 일주 보너스: 100 per hub', () => {
    const r = drawAt('hub-bonus', 3, (st) => {
      own(st, 5, 0);
      own(st, 13, 0);
    });
    expect(r.state.players[0]!.cash).toBe(3200);
  });

  it('a card that bankrupts you pays the bank', () => {
    const r = drawAt('fine', 3, (st) => {
      st.players[0]!.cash = 100;
      st.settings.endOnFirstBankruptcy = false;
    });
    expect(ofType(r.events, 'Bankrupt')[0]).toMatchObject({ creditorId: null });
  });

  it('a card fine you can cover by selling opens the debt phase', () => {
    const r = drawAt('fine', 3, (st) => {
      st.players[0]!.cash = 100;
      own(st, 10, 0);
    });
    expect(r.state.phase).toMatchObject({ kind: 'debt', amount: 150, reason: 'card' });
    const r2 = act(r.state, { type: 'SellProperty', playerId: 0, spaceIndex: 10 });
    expect(r2.state.players[0]!.cash).toBe(100 + 130 - 150);
    expect(r2.state.phase).toMatchObject({ kind: 'preRoll', playerId: 1 });
  });

  it('random cards are drawn uniformly-ish from all 24', () => {
    const seen = new Set<string>();
    let s = game({ n: 2, seed: 5 });
    for (let i = 0; i < 400; i++) {
      s = edit(s, (st) => {
        st.players[0]!.position = 0;
        st.players[0]!.islandTurns = 0;
        st.players[0]!.cash = 3000;
        st.current = 0;
        st.phase = { kind: 'preRoll', playerId: 0, rollAgain: false };
        queueDice(st, [1, 2]);
      });
      const r = reduce(s, roll(0));
      for (const e of ofType(r.events, 'CardDrawn')) seen.add(e.cardId);
      s = r.state;
    }
    expect(seen.size).toBe(24);
  });
});
