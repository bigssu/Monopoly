import { describe, expect, it } from 'vitest';
import { BOARD } from '@/content/board';
import { KEEPABLE_CARD_IDS } from '@/content/cards';
import { STRING_TABLES as TABLES, t } from '@/i18n';
import '@/i18n/game';
import '@/i18n/shell';

describe('game strings', () => {
  it('has a string for every key the game screen builds dynamically', () => {
    const keys = new Set<string>();
    for (const sp of BOARD) {
      if (!sp.group) keys.add(`g.kind.${sp.kind}`); // space info kicker (hubs included)
      if (sp.kind !== 'city' && sp.kind !== 'hub') keys.add(`g.info.${sp.kind}`);
    }
    for (const c of KEEPABLE_CARD_IDS) keys.add(`g.cardUsed.${c}`);
    for (const v of ['lastStanding', 'bankruptcy', 'triple', 'line', 'hubs', 'roundLimit']) {
      keys.add(`r.victory.${v}`);
      keys.add(`r.victory.${v}.detail`);
    }
    // t() returns the key itself when it is missing.
    expect([...keys].filter((k) => t(k) === k)).toEqual([]);
  });

  it('uses no name from the reference games in any ko / en string (docs/research/02 §2)', () => {
    const banned = /올림픽|Olympic|랜드마크|Monopoly|Chance|찬스|황금열쇠|우주여행|사회복지기금|세계여행|마블|Community Chest/;
    for (const l of ['ko', 'en'] as const) for (const [k, v] of Object.entries(TABLES[l])) expect(v, `${l} ${k}`).not.toMatch(banned);
  });
});
