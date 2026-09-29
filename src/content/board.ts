/**
 * Board content — the 32-space table from docs/DESIGN.md §3.
 *
 * Index 0 = Start, spaces run clockwise. Corners at 0, 8, 16, 24.
 * This file is pure data (no logic); engine helpers live in `src/engine/board.ts`.
 * Prices are in the game currency unit `만` (integers).
 */

export type SpaceKind =
  | 'start'
  | 'city'
  | 'hub'
  | 'event'
  | 'island'
  | 'donation'
  | 'tax'
  | 'festival'
  | 'travel';

export type GroupId = 'brown' | 'sky' | 'pink' | 'orange' | 'red' | 'yellow' | 'blue';

/** Board side for the line rule (라인 독점). Corners have no side. */
export type SideId = 'A' | 'B' | 'C' | 'D';

export interface LocalizedName {
  readonly ko: string;
  readonly en: string;
}

export interface SpaceDef {
  readonly index: number;
  readonly kind: SpaceKind;
  /** Full display name. */
  readonly name: LocalizedName;
  /** Short label that fits on a board tile. */
  readonly short: LocalizedName;
  /** Color group (cities only). */
  readonly group: GroupId | null;
  /** Purchase price (cities and hubs only). */
  readonly price: number | null;
  /** Board side (every non-corner space has one; only cities count for 라인 독점). */
  readonly side: SideId | null;
  /** Icon id (key into the icon registry under `src/content/icons`). */
  readonly iconId: string;
}

export const GROUP_IDS: readonly GroupId[] = [
  'brown',
  'sky',
  'pink',
  'orange',
  'red',
  'yellow',
  'blue',
];

export const SIDE_IDS: readonly SideId[] = ['A', 'B', 'C', 'D'];

/** Design-token colors for groups (DESIGN §3). */
export const GROUP_COLORS: Readonly<Record<GroupId, string>> = {
  brown: '#A0715B',
  sky: '#6EC1E4',
  pink: '#F28AB2',
  orange: '#F5A25D',
  red: '#E8564F',
  yellow: '#F2C94C',
  blue: '#4A6CF7',
};

export const HUB_COLOR = '#7B8AA3';

export const GROUP_NAMES: Readonly<Record<GroupId, LocalizedName>> = {
  brown: { ko: '갈색', en: 'Brown' },
  sky: { ko: '하늘색', en: 'Sky' },
  pink: { ko: '분홍색', en: 'Pink' },
  orange: { ko: '주황색', en: 'Orange' },
  red: { ko: '빨간색', en: 'Red' },
  yellow: { ko: '노란색', en: 'Yellow' },
  blue: { ko: '파란색', en: 'Blue' },
};

/** Building level labels. Engine level ids: 0 land … 4 `landmark` (Korean label 명소). */
export type BuildingLevelId = 'land' | 'villa' | 'building' | 'hotel' | 'landmark';

export const BUILDING_LEVEL_IDS: readonly BuildingLevelId[] = [
  'land',
  'villa',
  'building',
  'hotel',
  'landmark',
];

export const BUILDING_LEVEL_NAMES: Readonly<Record<BuildingLevelId, LocalizedName>> = {
  land: { ko: '땅', en: 'Land' },
  villa: { ko: '별장', en: 'Villa' },
  building: { ko: '빌딩', en: 'Building' },
  hotel: { ko: '호텔', en: 'Hotel' },
  landmark: { ko: '명소', en: 'Landmark' },
};

function city(
  index: number,
  ko: string,
  en: string,
  group: GroupId,
  price: number,
  side: SideId,
  iconId: string,
  shortKo = ko,
  shortEn = en,
): SpaceDef {
  return {
    index,
    kind: 'city',
    name: { ko, en },
    short: { ko: shortKo, en: shortEn },
    group,
    price,
    side,
    iconId,
  };
}

function hub(index: number, ko: string, en: string, side: SideId, iconId: string, shortKo = ko, shortEn = en): SpaceDef {
  return {
    index,
    kind: 'hub',
    name: { ko, en },
    short: { ko: shortKo, en: shortEn },
    group: null,
    price: 250,
    side,
    iconId,
  };
}

function special(
  index: number,
  kind: Exclude<SpaceKind, 'city' | 'hub'>,
  ko: string,
  en: string,
  side: SideId | null,
  iconId: string,
): SpaceDef {
  return {
    index,
    kind,
    name: { ko, en },
    short: { ko, en },
    group: null,
    price: null,
    side,
    iconId,
  };
}

export const BOARD: readonly SpaceDef[] = [
  special(0, 'start', '출발', 'START', null, 'corner-start'),
  city(1, '마닐라', 'Manila', 'brown', 100, 'A', 'city-manila'),
  city(2, '하노이', 'Hanoi', 'brown', 120, 'A', 'city-hanoi'),
  special(3, 'event', '이벤트', 'EVENT', 'A', 'space-event'),
  city(4, '카이로', 'Cairo', 'sky', 160, 'A', 'city-cairo'),
  hub(5, '크루즈 항구', 'Cruise Port', 'A', 'hub-port', '크루즈항', 'Port'),
  city(6, '나이로비', 'Nairobi', 'sky', 180, 'A', 'city-nairobi'),
  city(7, '케이프타운', 'Cape Town', 'sky', 200, 'A', 'city-capetown', '케이프타운', 'Cape Town'),
  special(8, 'island', '무인도', 'ISLAND', null, 'corner-island'),
  city(9, '리마', 'Lima', 'pink', 240, 'B', 'city-lima'),
  city(10, '멕시코시티', 'Mexico City', 'pink', 260, 'B', 'city-mexicocity', '멕시코시티', 'Mexico C.'),
  special(11, 'donation', '기부함', 'DONATION', 'B', 'space-donation'),
  city(12, '부에노스아이레스', 'Buenos Aires', 'pink', 280, 'B', 'city-buenosaires', '부에노스', 'B. Aires'),
  hub(13, '국제공항', 'Intl Airport', 'B', 'hub-airport', '공항', 'Airport'),
  city(14, '이스탄불', 'Istanbul', 'orange', 320, 'B', 'city-istanbul'),
  city(15, '아테네', 'Athens', 'orange', 340, 'B', 'city-athens'),
  special(16, 'festival', '축제', 'FESTIVAL', null, 'corner-festival'),
  city(17, '마드리드', 'Madrid', 'orange', 360, 'C', 'city-madrid'),
  special(18, 'event', '이벤트', 'EVENT', 'C', 'space-event'),
  city(19, '베를린', 'Berlin', 'red', 420, 'C', 'city-berlin'),
  city(20, '로마', 'Rome', 'red', 440, 'C', 'city-rome'),
  hub(21, '고속열차역', 'Express Rail', 'C', 'hub-rail', '열차역', 'Rail'),
  city(22, '런던', 'London', 'red', 480, 'C', 'city-london'),
  special(23, 'tax', '세무서', 'TAX OFFICE', 'C', 'space-tax'),
  special(24, 'travel', '자유여행', 'TRAVEL', null, 'corner-tour'),
  city(25, '두바이', 'Dubai', 'yellow', 540, 'D', 'city-dubai'),
  city(26, '싱가포르', 'Singapore', 'yellow', 560, 'D', 'city-singapore'),
  special(27, 'event', '이벤트', 'EVENT', 'D', 'space-event'),
  city(28, '도쿄', 'Tokyo', 'yellow', 600, 'D', 'city-tokyo'),
  hub(29, '우주정거장', 'Space Station', 'D', 'hub-space', '우주정거장', 'Station'),
  city(30, '뉴욕', 'New York', 'blue', 800, 'D', 'city-newyork'),
  city(31, '서울', 'Seoul', 'blue', 1000, 'D', 'city-seoul'),
];

export const BOARD_SIZE = BOARD.length; // 32

/** Well-known indexes. */
export const START_INDEX = 0;
export const ISLAND_INDEX = 8;
export const FESTIVAL_INDEX = 16;
export const TRAVEL_INDEX = 24;
