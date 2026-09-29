/**
 * Event cards — the 24 cards from docs/DESIGN.md §4.
 * Drawn uniformly at random with replacement when a player lands on an EVENT space.
 *
 * Each card carries a typed effect descriptor that the engine interprets
 * (`src/engine/reducer.ts` → `applyCard`). Amounts are part of the content so they
 * can be tuned here; see docs/BALANCE.md.
 */
import type { LocalizedName } from './board';

/** Cards a player can keep in hand. */
export type KeepableCardId = 'escape' | 'toll-pass' | 'shield';

export type CardEffect =
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
  | { readonly kind: 'leaderTax'; readonly amount: number };

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
  | 'hub-bonus';

export interface CardDef {
  readonly id: CardId;
  /** 1-based number from DESIGN §4. */
  readonly number: number;
  readonly title: LocalizedName;
  readonly description: LocalizedName;
  readonly effect: CardEffect;
  /** Icon id hint for the UI (generic card art). */
  readonly iconId: string;
}

export const CARDS: readonly CardDef[] = [
  {
    id: 'to-start',
    number: 1,
    title: { ko: '출발지로 이동', en: 'Back to Start' },
    description: {
      ko: '출발 칸으로 이동해 월급을 받습니다. 기부함 적립금도 함께!',
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
      ko: '곧장 무인도로 이동합니다. 출발 칸을 지나도 월급은 없습니다.',
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
      ko: '자유여행 칸으로 이동합니다. 다음 턴에 원하는 칸으로 떠날 수 있어요.',
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
      ko: '축제 칸으로 이동해 내 도시 하나에 축제를 엽니다.',
      en: 'Head to FESTIVAL and host it in one of your cities.',
    },
    effect: { kind: 'moveTo', target: 16 },
    iconId: 'card-move',
  },
  {
    id: 'bank-dividend',
    number: 5,
    title: { ko: '은행 배당', en: 'Bank Dividend' },
    description: { ko: '은행에서 200을 받습니다.', en: 'The bank pays you 200.' },
    effect: { kind: 'money', amount: 200 },
    iconId: 'card-coin',
  },
  {
    id: 'lottery',
    number: 6,
    title: { ko: '복권 당첨', en: 'Lottery Win' },
    description: { ko: '복권에 당첨! 500을 받습니다.', en: 'You won the lottery! Collect 500.' },
    effect: { kind: 'money', amount: 500 },
    iconId: 'card-coin',
  },
  {
    id: 'fine',
    number: 7,
    title: { ko: '벌금', en: 'Speeding Fine' },
    description: { ko: '벌금 150을 냅니다.', en: 'Pay a fine of 150.' },
    effect: { kind: 'money', amount: -150 },
    iconId: 'card-pay',
  },
  {
    id: 'repairs',
    number: 8,
    title: { ko: '건물 수리비', en: 'Repairs' },
    description: {
      ko: '내 건물 레벨 1당 30을 냅니다. (명소는 4레벨)',
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
      ko: '모든 플레이어에게 100씩 받습니다.',
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
      ko: '모든 플레이어에게 50씩 줍니다.',
      en: 'Give 50 to every other player.',
    },
    effect: { kind: 'payEach', amount: 50 },
    iconId: 'card-pay',
  },
  {
    id: 'back-three',
    number: 11,
    title: { ko: '3칸 뒤로', en: 'Three Steps Back' },
    description: { ko: '3칸 뒤로 이동합니다.', en: 'Move back three spaces.' },
    effect: { kind: 'moveBack', steps: 3 },
    iconId: 'card-move',
  },
  {
    id: 'nearest-hub',
    number: 12,
    title: { ko: '가장 가까운 허브로', en: 'Next Hub' },
    description: {
      ko: '앞으로 가장 가까운 허브로 이동합니다. 주인이 있으면 통행료 2배!',
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
      ko: '보관했다가 무인도에서 바로 탈출할 때 사용합니다.',
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
      ko: '보관했다가 다음 통행료를 낼 때 자동으로 사용됩니다.',
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
      ko: '보관했다가 내 땅에 대한 인수 시도를 한 번 막아냅니다.',
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
      ko: '기부함에 모인 적립금을 모두 받습니다.',
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
      ko: '다음 주사위 이동 칸 수가 2배가 됩니다.',
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
      ko: '무작위 도시로 이동합니다.',
      en: 'Jump ahead to a random city.',
    },
    effect: { kind: 'randomCity' },
    iconId: 'card-move',
  },
  {
    id: 'tax-refund',
    number: 19,
    title: { ko: '세금 환급', en: 'Tax Refund' },
    description: { ko: '세금 100을 돌려받습니다.', en: 'Collect a 100 tax refund.' },
    effect: { kind: 'money', amount: 100 },
    iconId: 'card-coin',
  },
  {
    id: 'leader-tax',
    number: 20,
    title: { ko: '부자세', en: 'Wealth Tax' },
    description: {
      ko: '총자산 1위 플레이어가 최하위 플레이어에게 200을 줍니다.',
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
      ko: '내 도시 한 곳을 골라 무료로 1레벨 업그레이드합니다.',
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
      ko: '무작위 상대 도시 한 곳의 건물이 1레벨 낮아집니다. (명소는 안전)',
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
      ko: '축제가 내 도시 중 한 곳으로 옮겨집니다.',
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
      ko: '내가 가진 허브 1곳당 100을 받습니다.',
      en: 'Collect 100 for each hub you own.',
    },
    effect: { kind: 'perHub', amount: 100 },
    iconId: 'card-coin',
  },
];

const CARD_BY_ID: ReadonlyMap<CardId, CardDef> = new Map(CARDS.map((c) => [c.id, c]));

export function getCard(id: CardId): CardDef {
  const c = CARD_BY_ID.get(id);
  if (!c) throw new Error(`Unknown card id: ${id}`);
  return c;
}

export const KEEPABLE_CARD_IDS: readonly KeepableCardId[] = ['escape', 'toll-pass', 'shield'];
