import { describe, expect, it } from 'vitest';
import { BOARD } from '@/content/board';
import { KEEPABLE_CARD_IDS } from '@/content/cards';
import { t } from '@/i18n';
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
});
