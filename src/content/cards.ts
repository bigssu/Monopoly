/**
 * Event cards — the 24 cards from docs/DESIGN.md §4, plus the comeback cards of rules version 2
 * (docs/research/08-fun-analysis.md), which only join the deck when that rule is on (`requires`).
 * Drawn uniformly at random with replacement when a player lands on an EVENT space.
 *
 * Each card carries a typed effect descriptor that the engine interprets
 * (`src/engine/reducer.ts` → `applyCard`). Amounts are part of the content so they
 * can be tuned here; see docs/BALANCE.md.
 */
import type { LocalizedName } from './board';

/** Cards a player can keep in hand. */
export type KeepableCardId = 'escape' | 'toll-pass' | 'shield';

type CardEffect =
  /** Walk forward to a space (passing Start pays salary) and resolve the landing. */
  | { readonly kind: 'moveTo'; readonly target: number }
  /** Jump straight to the Island (no salary). */
  | { readonly kind: 'goToIsland' }
  /** Receive (positive) or pay (negative) the bank. */
  | { readonly kind: 'money'; readonly amount: number }
  /** Pay the bank `amount` per building level owned (landmark = 4 levels). */
  | { readonly kind: 'perBuildingLevel'; readonly amount: number }
  /** Every other solvent player pays you `amount` (or all their cash if less). */
  | { readonly kind: 'collectFromEach'; readonly amount: number }
  /** You pay `amount` to every other solvent player. */
  | { readonly kind: 'payEach'; readonly amount: number }
  /** Walk backwards `steps` spaces (no salary) and resolve the landing. */
  | { readonly kind: 'moveBack'; readonly steps: number }
  /** Walk forward to the nearest hub; if owned by an opponent the toll is multiplied. */
  | { readonly kind: 'nearestHub'; readonly tollMultiplier: number }
  /** Keep this card in hand. */
  | { readonly kind: 'keep'; readonly card: KeepableCardId }
  /** Receive the whole donation pot. */
  | { readonly kind: 'receivePot' }
  /** Your next movement roll is doubled. */
  | { readonly kind: 'express' }
  /** Walk forward to a uniformly random city and resolve the landing. */
  | { readonly kind: 'randomCity' }
  /** Choose one of your cities to upgrade one level for free. */
  | { readonly kind: 'freeUpgrade' }
  /** A random opponent city (levels 1–3; landmarks immune) loses one building level. */
  | { readonly kind: 'typhoon' }
  /** The festival marker moves to a random city of yours. */
  | { readonly kind: 'festivalInvite' }
  /** Receive `amount` × number of hubs you own. */
  | { readonly kind: 'perHub'; readonly amount: number }
  /** The richest player (total assets) pays `amount` to the poorest. No-op on ties. */
  | { readonly kind: 'leaderTax'; readonly amount: number }
  /** Choose an opponent's city (not a landmark): it becomes yours, your cheapest non-landmark city theirs. */
  | { readonly kind: 'swap' }
  /** The richest other player pays you `rate` of their cash (no effect if you are the richest). */
  | { readonly kind: 'raid'; readonly rate: number };

export type CardId =
  | 'to-start'
  | 'to-island'
  | 'to-travel'
  | 'to-festival'
  | 'bank-dividend'
  | 'lottery'
  | 'fine'
  | 'repairs'
  | 'birthday'
  | 'charity'
  | 'back-three'
  | 'nearest-hub'
  | 'escape'
  | 'toll-pass'
  | 'shield'
  | 'welfare'
  | 'express'
  | 'random-jump'
  | 'tax-refund'
  | 'leader-tax'
  | 'free-upgrade'
  | 'typhoon'
  | 'festival-invite'
  | 'hub-bonus'
  | 'swap'
  | 'raid';

export interface CardDef {
  readonly id: CardId;
  /** 1-based number from DESIGN §4. */
  readonly number: number;
  readonly title: LocalizedName;
  readonly description: LocalizedName;
  readonly effect: CardEffect;
  /** Icon id hint for the UI (generic card art). */
  readonly iconId: string;
  /** Only in the deck when this rule flag is on (`RuleFlags` key; engine `deckFor`). */
  readonly requires?: 'comebackCards';
}

export const CARDS: readonly CardDef[] = [
  {
    id: 'to-start',
    number: 1,
    title: { ko: '출발지로 이동', en: 'Back to Start' },
    description: {
      ko: '출발 칸으로 가서 월급을 받아요. 기부함 적립금도 함께!',
      en: 'Head back to START: collect your salary plus the donation pot.',
    },
    effect: { kind: 'moveTo', target: 0 },
    iconId: 'card-move',
  },
  {
    id: 'to-island',
    number: 2,
    title: { ko: '무인도로 이동', en: 'Stranded!' },
    description: {
      ko: '곧장 무인도로 가요. 출발 칸을 지나도 월급은 없어요.',
      en: 'Whisked away to the ISLAND. No salary on the way.',
    },
    effect: { kind: 'goToIsland' },
    iconId: 'card-island',
  },
  {
    id: 'to-travel',
    number: 3,
    title: { ko: '자유여행으로 이동', en: 'Pack Your Bags' },
    description: {
      ko: '자유여행 칸으로 가요. 다음 턴에 원하는 칸으로 떠날 수 있어요.',
      en: 'Head to TRAVEL. On your next turn you may fly to any space.',
    },
    effect: { kind: 'moveTo', target: 24 },
    iconId: 'card-move',
  },
  {
    id: 'to-festival',
    number: 4,
    title: { ko: '축제로 이동', en: 'Festival Time' },
    description: {
      ko: '축제 칸으로 가서 내 도시 하나에 축제를 열어요.',
      en: 'Head to FESTIVAL and host it in one of your cities.',
    },
    effect: { kind: 'moveTo', target: 16 },
    iconId: 'card-move',
  },
  {
    id: 'bank-dividend',
    number: 5,
    title: { ko: '은행 배당', en: 'Bank Dividend' },
    description: { ko: '은행에서 200을 받아요.', en: 'The bank pays you 200.' },
    effect: { kind: 'money', amount: 200 },
    iconId: 'card-coin',
  },
  {
    id: 'lottery',
    number: 6,
    title: { ko: '복권 당첨', en: 'Lottery Win' },
    description: { ko: '복권에 당첨! 500을 받아요.', en: 'You won the lottery! Collect 500.' },
    effect: { kind: 'money', amount: 500 },
    iconId: 'card-coin',
  },
  {
    id: 'fine',
    number: 7,
    title: { ko: '벌금', en: 'Speeding Fine' },
    description: { ko: '벌금 150을 내요.', en: 'Pay a fine of 150.' },
    effect: { kind: 'money', amount: -150 },
    iconId: 'card-pay',
  },
  {
    id: 'repairs',
    number: 8,
    title: { ko: '건물 수리비', en: 'Repairs' },
    description: {
      ko: '내 건물 레벨 1당 30을 내요. (명소는 4레벨)',
      en: 'Pay 30 for each building level you own (a landmark counts as 4).',
    },
    effect: { kind: 'perBuildingLevel', amount: 30 },
    iconId: 'card-pay',
  },
  {
    id: 'birthday',
    number: 9,
    title: { ko: '생일 축하!', en: 'Happy Birthday!' },
    description: {
      ko: '모든 플레이어에게 100씩 받아요.',
      en: 'Every other player gives you 100.',
    },
    effect: { kind: 'collectFromEach', amount: 100 },
    iconId: 'card-gift',
  },
  {
    id: 'charity',
    number: 10,
    title: { ko: '기부', en: 'Generosity' },
    description: {
      ko: '모든 플레이어에게 50씩 줘요.',
      en: 'Give 50 to every other player.',
    },
    effect: { kind: 'payEach', amount: 50 },
    iconId: 'card-pay',
  },
  {
    id: 'back-three',
    number: 11,
    title: { ko: '3칸 뒤로', en: 'Three Steps Back' },
    description: { ko: '3칸 뒤로 가요.', en: 'Move back three spaces.' },
    effect: { kind: 'moveBack', steps: 3 },
    iconId: 'card-move',
  },
  {
    id: 'nearest-hub',
    number: 12,
    title: { ko: '가장 가까운 허브로', en: 'Next Hub' },
    description: {
      ko: '앞쪽 가장 가까운 허브로 가요. 주인이 있으면 통행료 2배!',
      en: 'Head to the next hub ahead. If an opponent owns it, pay double toll.',
    },
    effect: { kind: 'nearestHub', tollMultiplier: 2 },
    iconId: 'card-move',
  },
  {
    id: 'escape',
    number: 13,
    title: { ko: '탈출권', en: 'Escape Pass' },
    description: {
      ko: '보관했다가 무인도에서 바로 탈출할 때 써요.',
      en: 'Keep this card. Use it to leave the ISLAND immediately.',
    },
    effect: { kind: 'keep', card: 'escape' },
    iconId: 'card-escape',
  },
  {
    id: 'toll-pass',
    number: 14,
    title: { ko: '통행료 면제권', en: 'Toll Pass' },
    description: {
      ko: '보관했다가 다음 통행료를 낼 때 써요.',
      en: 'Keep this card. It is used automatically on your next toll.',
    },
    effect: { kind: 'keep', card: 'toll-pass' },
    iconId: 'card-ticket',
  },
  {
    id: 'shield',
    number: 15,
    title: { ko: '수호 방패', en: 'Guard Shield' },
    description: {
      ko: '보관했다가 내 땅을 노리는 인수를 한 번 막아요.',
      en: 'Keep this card. It blocks one takeover attempt on your property.',
    },
    effect: { kind: 'keep', card: 'shield' },
    iconId: 'card-shield',
  },
  {
    id: 'welfare',
    number: 16,
    title: { ko: '복지기금 지급', en: 'Welfare Payout' },
    description: {
      ko: '기부함에 모인 적립금을 모두 받아요.',
      en: 'Collect everything in the donation pot.',
    },
    effect: { kind: 'receivePot' },
    iconId: 'card-heart',
  },
  {
    id: 'express',
    number: 17,
    title: { ko: '급행', en: 'Express' },
    description: {
      ko: '다음 주사위 이동 칸 수가 2배가 돼요.',
      en: 'Your next dice roll moves you double the distance.',
    },
    effect: { kind: 'express' },
    iconId: 'card-express',
  },
  {
    id: 'random-jump',
    number: 18,
    title: { ko: '랜덤 점프', en: 'Random Jump' },
    description: {
      ko: '무작위 도시로 순간이동해요.',
      en: 'Jump ahead to a random city.',
    },
    effect: { kind: 'randomCity' },
    iconId: 'card-move',
  },
  {
    id: 'tax-refund',
    number: 19,
    title: { ko: '세금 환급', en: 'Tax Refund' },
    description: { ko: '세금 100을 돌려받아요.', en: 'Collect a 100 tax refund.' },
    effect: { kind: 'money', amount: 100 },
    iconId: 'card-coin',
  },
  {
    id: 'leader-tax',
    number: 20,
    title: { ko: '부자세', en: 'Wealth Tax' },
    description: {
      ko: '총자산 1위가 꼴찌에게 200을 줘요.',
      en: 'The richest player (total assets) pays 200 to the poorest.',
    },
    effect: { kind: 'leaderTax', amount: 200 },
    iconId: 'card-scale',
  },
  {
    id: 'free-upgrade',
    number: 21,
    title: { ko: '건물 보너스', en: 'Free Upgrade' },
    description: {
      ko: '내 도시 한 곳을 골라 공짜로 1레벨 올려요.',
      en: 'Choose one of your cities and upgrade it one level for free.',
    },
    effect: { kind: 'freeUpgrade' },
    iconId: 'card-build',
  },
  {
    id: 'typhoon',
    number: 22,
    title: { ko: '태풍', en: 'Typhoon' },
    description: {
      ko: '상대 도시 한 곳의 건물이 1레벨 낮아져요. (명소는 안전)',
      en: "A random opponent's city loses one building level (landmarks are safe).",
    },
    effect: { kind: 'typhoon' },
    iconId: 'card-storm',
  },
  {
    id: 'festival-invite',
    number: 23,
    title: { ko: '축제 초대', en: 'Festival Invitation' },
    description: {
      ko: '축제가 내 도시 중 한 곳으로 옮겨와요.',
      en: 'The festival moves to one of your cities at random.',
    },
    effect: { kind: 'festivalInvite' },
    iconId: 'card-festival',
  },
  {
    id: 'hub-bonus',
    number: 24,
    title: { ko: '세계 일주 완료 보너스', en: 'Round-the-World Bonus' },
    description: {
      ko: '내가 가진 허브 1곳당 100을 받아요.',
      en: 'Collect 100 for each hub you own.',
    },
    effect: { kind: 'perHub', amount: 100 },
    iconId: 'card-coin',
  },
  // --- Comeback cards (rules version 2; appended so the original deck order never changes) ---
  {
    id: 'swap',
    number: 25,
    title: { ko: '땅 맞교환', en: 'Land Swap' },
    description: {
      ko: '상대 도시 하나를 골라 내 가장 싼 도시와 바꿔요. 건물도 그대로! (명소는 안 돼요)',
      en: "Pick an opponent's city and trade your cheapest city for it, buildings and all (not landmarks).",
    },
    effect: { kind: 'swap' },
    iconId: 'card-swap',
    requires: 'comebackCards',
  },
  {
    id: 'raid',
    number: 26,
    title: { ko: '선두 습격', en: 'Leader Raid' },
    description: {
      ko: '총자산 1위가 현금의 20%를 나에게 줘요. 내가 1위면 효과 없어요.',
      en: 'The richest player hands you 20% of their cash. No effect if that is you.',
    },
    effect: { kind: 'raid', rate: 0.2 },
    iconId: 'card-raid',
    requires: 'comebackCards',
  },
];

/** Cards a comeback offer draws from (the last player's first card, rules version 2). */
export const COMEBACK_CARD_IDS: readonly CardId[] = ['swap', 'raid', 'welfare', 'free-upgrade', 'lottery'];

const CARD_BY_ID: ReadonlyMap<CardId, CardDef> = new Map(CARDS.map((c) => [c.id, c]));

export function getCard(id: CardId): CardDef {
  const c = CARD_BY_ID.get(id);
  if (!c) throw new Error(`Unknown card id: ${id}`);
  return c;
}

export const KEEPABLE_CARD_IDS: readonly KeepableCardId[] = ['escape', 'toll-pass', 'shield'];
