/**
 * Dealer catalog integrity (every line has its voice file, duration and sprite) and the director's
 * pure pickers (docs/superpowers/specs/2026-10-04-dealer-voice-design.md).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { chooseAction, createGame, defaultPlayers, defaultSettings, type GameEvent, type GameState } from '@/engine';
import { DEALER_LINES, DEALER_SPRITES, SITUATIONS } from '../lines';
import { DealerDirector, newMemo, pickLine, situationForEvent, situationForPrompt } from '../director';

const PUB = join(__dirname, '..', '..', '..', '..', 'public');

describe('dealer catalog', () => {
  it('has unique ids and non-empty Korean and English text', () => {
    expect(new Set(DEALER_LINES.map((l) => l.id)).size).toBe(DEALER_LINES.length);
    for (const l of DEALER_LINES) {
      expect(l.ko.trim(), l.id).not.toBe('');
      expect(l.en.trim(), l.id).not.toBe('');
    }
  });

  it('ships a voice file and a duration for every line', () => {
    const manifest = JSON.parse(readFileSync(join(PUB, 'voice', 'manifest.json'), 'utf8')) as Record<string, number>;
    for (const l of DEALER_LINES) {
      expect(existsSync(join(PUB, 'voice', `${l.id}.ogg`)), l.id).toBe(true);
      expect(manifest[l.id], l.id).toBeGreaterThan(500);
    }
  });

  it('ships every sprite, including each expression a line uses', () => {
    const used = new Set(Object.values(SITUATIONS).map((s) => s.expr));
    for (const e of used) expect(DEALER_SPRITES).toContain(e);
    for (const n of DEALER_SPRITES) expect(existsSync(join(PUB, 'dealer', `${n}.webp`)), n).toBe(true);
  });
});

describe('pickLine', () => {
  it('respects the setting level', () => {
    const last = new Map<string, string>();
    expect(pickLine('roll.nudge', 'normal', last)).toBeNull(); // full-only
    expect(pickLine('roll.nudge', 'full', last)?.situation).toBe('roll.nudge');
    expect(pickLine('buy.done', 'min', last)?.situation).toBe('buy.done');
    expect(pickLine('buy.done', 'off', last)).toBeNull();
  });

  it('does not repeat the previous take', () => {
    const last = new Map<string, string>();
    let prev = '';
    for (let k = 0; k < 20; k++) {
      const id = pickLine('buy.done', 'normal', last)!.id;
      expect(id).not.toBe(prev);
      prev = id;
    }
  });
});

function game(): GameState {
  return createGame(defaultSettings({ players: defaultPlayers(4, { cpu: false }) }), 1);
}

describe('situationForEvent', () => {
  it('greets once, then announces the turn by colour', () => {
    const s = game();
    const memo = newMemo();
    const ev = { type: 'TurnStarted', playerId: 0, round: 1, turn: 1 } as GameEvent;
    expect(situationForEvent(ev, s, memo, 'before')).toBe('game.start');
    expect(situationForEvent(ev, s, memo, 'before')).toBe(`turn.${s.players[0]!.colorId}`);
  });

  it('tells a big toll from a small one', () => {
    const s = game();
    s.players[1]!.cash = 3000;
    const toll = (amount: number) => ({ type: 'TollPaid', payerId: 1, ownerId: 0, spaceIndex: 1, amount, baseToll: amount, festival: false, multiplier: 1, waived: false }) as GameEvent;
    expect(situationForEvent(toll(100), s, newMemo(), 'after')).toBe('toll.small');
    expect(situationForEvent(toll(1200), s, newMemo(), 'after')).toBe('toll.big');
    // Results speak on the reaction beat, never before their animation.
    expect(situationForEvent(toll(1200), s, newMemo(), 'before')).toBeNull();
  });

  it('maps the victory kinds', () => {
    const s = game();
    const over = (victory: string) => ({ type: 'GameOver', result: { victory, winnerId: 0, round: 3, ranking: [] } }) as unknown as GameEvent;
    expect(situationForEvent(over('triple'), s, newMemo(), 'before')).toBe('win.triple');
    expect(situationForEvent(over('roundLimit'), s, newMemo(), 'before')).toBe('win.assets');
  });

  it('only names situations that exist in the catalog', () => {
    const s = game();
    const memo = newMemo();
    memo.greeted = true;
    const evs: [GameEvent, 'before' | 'after'][] = [
      [{ type: 'DiceRolled', playerId: 0, dice: [2, 2], total: 4, isDouble: true, consecutiveDoubles: 1, express: false, steps: 4, context: 'normal' } as GameEvent, 'after'],
      [{ type: 'CardDrawn', playerId: 0, cardId: 'typhoon' } as GameEvent, 'before'],
      [{ type: 'TurnStarted', playerId: 2, round: 1, turn: 3 } as GameEvent, 'before'],
      [{ type: 'Bankrupt', playerId: 1, creditorId: 0, round: 4 } as GameEvent, 'after'],
    ];
    for (const [ev, when] of evs) {
      const id = situationForEvent(ev, s, memo, when);
      expect(id && SITUATIONS[id], `${ev.type} → ${id}`).toBeTruthy();
    }
  });
});

describe('situationForPrompt', () => {
  it('advises what the CPU policy would do on a buy', () => {
    const s = game();
    s.phase = { kind: 'buy', playerId: 0, spaceIndex: 1, price: 100 };
    const advice = situationForPrompt(s);
    expect(advice).toBe(chooseAction(s, 0).type === 'Buy' ? 'buy.advice.yes' : 'buy.advice.no');
  });
});

describe('DealerDirector → idle pose (zero idle load, docs/PERFORMANCE.md "라운드 2")', () => {
  it('lets a finished line go back to idle on the next game event or decision, not on a timer', () => {
    vi.stubGlobal('window', { setTimeout: () => 0 });
    let relaxed = 0;
    const director = new DealerDirector({ say: () => {}, relax: () => relaxed++ }, () => 'off');
    const s = game();
    director.onEvent({ type: 'TurnStarted', playerId: 0, round: 1, turn: 1 } as GameEvent, s, 'before');
    expect(relaxed).toBe(1);
    director.onPrompt(s);
    expect(relaxed).toBe(2);
    vi.unstubAllGlobals();
  });
});
