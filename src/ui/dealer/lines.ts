/**
 * Dealer line catalog — the single source of truth for what the host says (docs/superpowers/specs/
 * 2026-10-04-dealer-voice-design.md). The app (director/Dealer) and the generators
 * (scripts/dealer/gen-voice.mjs) both read it. Each situation has 1+ takes; a take's id is
 * `${situation}.${n}` (1-based) and its voice file is `voice/<id>.ogg`.
 *
 * Tone: a warm, playful Pixar-style host. Never names (players type them) and never amounts.
 */

/** Which voice setting first includes the line (each level includes the ones before: min, normal, full). */
export type DealerLevel = 'min' | 'normal' | 'full';

export type DealerExpr =
  | 'idle'
  | 'point'
  | 'cheer'
  | 'surprised'
  | 'sad'
  | 'thinking'
  | 'nervous'
  | 'laugh'
  | 'dice'
  | 'present'
  | 'trophy';

/** Sprites shipped in public/dealer/<expr>.webp, plus the two talking frames. */
export const DEALER_SPRITES = ['idle', 'talk-a', 'talk-b', 'point', 'cheer', 'surprised', 'sad', 'thinking', 'nervous', 'laugh', 'dice', 'present', 'trophy'] as const;

interface Situation {
  level: DealerLevel;
  /** Higher interrupts lower; equal or lower is dropped while one plays. */
  priority: number;
  expr: DealerExpr;
  /** [ko, en] per take. */
  takes: readonly (readonly [string, string])[];
}

const P = { quip: 1, info: 2, advice: 3, event: 4, big: 5, end: 6 } as const;

const COLORS: Record<string, readonly [string, string]> = {
  red: ['빨간', 'Red'],
  blue: ['파란', 'Blue'],
  green: ['초록', 'Green'],
  yellow: ['노란', 'Yellow'],
  purple: ['보라', 'Purple'],
  orange: ['주황', 'Orange'],
  teal: ['청록', 'Teal'],
  pink: ['분홍', 'Pink'],
};

const turnLines = Object.fromEntries(
  Object.entries(COLORS).map(([id, [ko, en]]) => [
    `turn.${id}`,
    {
      level: 'full',
      priority: P.info,
      expr: 'dice',
      takes: [
        [`${ko} 말 차례예요! 주사위를 힘차게 굴려 볼까요?`, `${en}'s turn! Give those dice a good roll!`],
        [`자, 이번엔 ${ko} 말! 행운을 빌어요!`, `${en}, you're up! Good luck!`],
        [`${ko} 말, 준비됐나요? 멋진 한 수 기대할게요!`, `${en}, ready? Show us a great move!`],
      ],
    } satisfies Situation,
  ]),
);

export const SITUATIONS: Record<string, Situation> = {
  // --- Game flow -------------------------------------------------------------------------------
  'game.start': {
    level: 'min',
    priority: P.end,
    expr: 'cheer',
    takes: [
      ['랜드폴리에 오신 걸 환영해요! 오늘의 부자는 과연 누가 될까요?', 'Welcome to Land Poly! Who will be the richest today?'],
      ['자, 신나는 땅따먹기 여행을 시작해 볼까요? 다들 준비됐죠?', "Let's start our land-grabbing trip! Everyone ready?"],
      ['안녕하세요! 오늘 진행을 맡은 딜러예요. 재밌게 놀아 봐요!', "Hi! I'm your dealer today. Let's have fun!"],
    ],
  },
  ...turnLines,
  'roll.nudge': {
    level: 'full',
    priority: P.quip,
    expr: 'dice',
    takes: [
      ['버튼을 꾹 누르면 주사위를 흔들 수 있어요!', 'Press and hold to shake the dice!'],
      ['두근두근, 어떤 숫자가 나올까요?', 'Ooh, what number will it be?'],
      ['손에 힘을 빼고, 가볍게 휙!', 'Relax your hand and toss!'],
      ['좋은 숫자가 나오길 기도해 볼까요?', "Let's hope for a good number!"],
      ['주사위야, 오늘 기분 좋게 굴러 줘!', 'Come on dice, roll nicely today!'],
    ],
  },
  doubles: {
    level: 'min',
    priority: P.event,
    expr: 'laugh',
    takes: [
      ['더블! 한 번 더 굴릴 수 있어요!', 'Doubles! Roll again!'],
      ['와아, 똑같은 숫자! 한 번 더!', 'Same numbers! One more time!'],
      ['더블이에요! 오늘 운이 좋은데요?', "Doubles! You're lucky today!"],
      ['짝짝짝! 더블 보너스, 한 번 더 굴려요!', 'Clap clap! Doubles bonus, roll again!'],
      ['럭키! 주사위가 또 기회를 줬어요!', 'Lucky! The dice give you another go!'],
      ['또 더블! 주사위가 당신을 좋아하나 봐요!', 'Doubles again! The dice must like you!'],
    ],
  },
  'doubles.three': {
    level: 'min',
    priority: P.big,
    expr: 'surprised',
    takes: [
      ['앗! 세 번 연속 더블이라니! 아쉽지만 무인도로 가야 해요!', 'Whoa, three doubles in a row! Sorry, off to the island!'],
      ['너무 운이 좋았나 봐요… 세 번째 더블은 무인도행이에요!', 'Too lucky! A third double sends you to the island!'],
    ],
  },
  'pass.start': {
    level: 'normal',
    priority: P.info,
    expr: 'cheer',
    takes: [
      ['출발 칸을 지나서 월급이 들어와요! 짤랑짤랑~', 'You passed Start — payday! Ka-ching!'],
      ['한 바퀴 완주! 월급 받아 가세요!', 'Lap complete! Collect your salary!'],
      ['월급날이에요! 지갑이 두둑해졌어요!', "It's payday! Your wallet got fatter!"],
      ['출발선 통과! 수고했어요, 보너스예요!', 'Through Start! Nice work, here is your pay!'],
      ['또 한 바퀴! 부지런한 여행자에게 월급을 드려요!', 'Another lap! Pay for a busy traveler!'],
      ['짤랑! 통장에 월급이 쏙 들어왔어요!', 'Ka-ching! Salary in the bank!'],
    ],
  },
  'pass.start.landed': {
    level: 'normal',
    priority: P.event,
    expr: 'cheer',
    takes: [
      ['출발 칸에 딱 멈췄어요! 보너스까지 챙겨 가세요!', 'Right on Start! Grab the bonus too!'],
      ['정확히 출발 칸! 기부함 적립금도 모두 당신 거예요!', "Exactly on Start! The donation pot is yours too!"],
    ],
  },

  // --- Buying ----------------------------------------------------------------------------------
  'buy.advice.yes': {
    level: 'normal',
    priority: P.advice,
    expr: 'point',
    takes: [
      ['여기 좋은데요? 저라면 사겠어요!', 'Nice spot! I would buy it!'],
      ['이 도시, 놓치기 아까워요! 사 두는 걸 추천해요!', "Don't let this city go! I'd buy it."],
      ['좋은 투자처예요. 저라면 바로 사요!', "Great investment. I'd buy right away!"],
      ['오, 이 땅 탐나는데요? 구매를 추천해요!', 'Ooh, I like this one. Buy it!'],
      ['여기 사 두면 나중에 효자 노릇 할 거예요!', 'Buy it — it will pay you back later!'],
      ['주인 없는 땅이에요! 지금이 기회예요!', 'No owner yet! This is your chance!'],
    ],
  },
  'buy.advice.no': {
    level: 'normal',
    priority: P.advice,
    expr: 'thinking',
    takes: [
      ['음… 지금은 현금을 아껴 두는 게 좋겠어요.', 'Hmm… better keep your cash for now.'],
      ['저라면 이번엔 그냥 지나가겠어요. 다음 기회를 노려요!', "I'd pass this time. Wait for a better chance!"],
      ['조금 비싸네요. 통행료 낼 돈은 남겨 둬야죠!', 'A bit pricey. Keep some money for tolls!'],
      ['지갑이 얇아지면 위험해요. 이번엔 쉬어 가요!', 'A thin wallet is risky. Skip this one!'],
    ],
  },
  'buy.cant': {
    level: 'normal',
    priority: P.info,
    expr: 'sad',
    takes: [
      ['아쉽게도 돈이 조금 모자라요.', "Oh no, you're a little short."],
      ['이번엔 지갑이 허락하지 않네요. 다음에 꼭 사요!', "Your wallet says no this time. Next time!"],
    ],
  },
  'buy.done': {
    level: 'min',
    priority: P.event,
    expr: 'cheer',
    takes: [
      ['축하합니다! 이 도시는 이제 당신 거예요!', 'Congratulations! This city is yours now!'],
      ['좋은 선택이에요! 깃발을 꽂았어요!', 'Great choice! Flag planted!'],
      ['구매 완료! 땅 부자의 길이 열리고 있어요!', 'Bought! The road to riches begins!'],
      ['와아, 새 땅이 생겼어요! 벌써 든든한데요?', 'A new plot! Feeling secure already!'],
      ['이제 여기 오는 친구들은 통행료를 내야겠죠?', 'Now anyone who lands here pays you!'],
      ['찜! 이 도시는 당신 차지예요!', 'Claimed! This city is yours!'],
      ['부동산 왕의 탄생인가요? 멋진 구매예요!', 'Is a property king being born? Nice buy!'],
      ['이 도시에 당신의 깃발이 펄럭여요!', 'Your flag waves over this city!'],
    ],
  },
  'monopoly.done': {
    level: 'min',
    priority: P.big,
    expr: 'cheer',
    takes: [
      ['같은 색을 전부 모았어요! 독점 완성!', 'You own the whole color set! Monopoly!'],
      ['대단해요! 한 지역을 통째로 손에 넣었어요!', 'Amazing! You own the whole region!'],
    ],
  },
  'one.away': {
    level: 'normal',
    priority: P.event,
    expr: 'nervous',
    takes: [
      ['조심하세요! 독점 승리까지 딱 한 칸 남았어요!', 'Careful! Just one more property to win!'],
      ['어머나, 승리가 코앞이에요! 다들 저 칸을 막아야 해요!', 'Victory is close! Everyone, block that space!'],
      ['긴장하세요! 이제 한 칸만 더 가지면 끝나요!', 'Heads up! One more and the game is over!'],
      ['비상, 비상! 독점 직전이에요!', 'Alert, alert! A monopoly is about to happen!'],
    ],
  },

  // --- Building --------------------------------------------------------------------------------
  'build.advice.yes': {
    level: 'normal',
    priority: P.advice,
    expr: 'thinking',
    takes: [
      ['저라면 업그레이드를 고려하겠어요. 통행료가 쑥쑥 오를 거예요!', "I'd upgrade. The toll will shoot up!"],
      ['지금이 건물을 올릴 때예요! 저라면 지어요!', 'Now is the time to build! I would.'],
      ['한 층 더 올리면 손님들이 깜짝 놀랄걸요?', 'One more floor and visitors will be shocked!'],
      ['여긴 사람들이 자주 지나가요. 건물을 올릴 만해요!', 'People pass here often. Worth building!'],
      ['투자는 타이밍! 지금 지으면 좋겠어요!', 'Investing is timing. Build now!'],
    ],
  },
  'build.advice.no': {
    level: 'normal',
    priority: P.advice,
    expr: 'thinking',
    takes: [
      ['지금은 참는 게 좋겠어요. 현금이 너무 줄어들어요.', "Hold off for now. You'd run low on cash."],
      ['건물은 다음에 올려도 늦지 않아요. 이번엔 패스!', "You can build later. Pass this time!"],
    ],
  },
  'build.done': {
    level: 'min',
    priority: P.event,
    expr: 'cheer',
    takes: [
      ['뚝딱뚝딱! 멋진 건물이 올라갔어요!', 'Bang bang! A fine new building!'],
      ['우와, 건물이 한층 근사해졌어요!', 'Wow, the building looks even better!'],
      ['공사 완료! 통행료가 껑충 뛰었어요!', 'Construction done! The toll just jumped!'],
      ['반짝반짝 새 건물! 이제 이 도시가 더 무서워졌어요!', 'Shiny new building! This city is scarier now!'],
      ['업그레이드 성공! 투자 감각이 대단한데요?', 'Upgrade done! You have a great eye!'],
      ['으쓱! 도시가 한층 더 멋있어졌어요!', 'Ta-da! The city looks even cooler!'],
      ['건물이 쑥쑥 자라요! 통행료도 쑥쑥!', 'The building grows, and so does the toll!'],
    ],
  },
  'landmark.done': {
    level: 'min',
    priority: P.big,
    expr: 'cheer',
    takes: [
      ['와아! 랜드마크 완성! 이제 아무도 이 땅을 빼앗을 수 없어요!', 'Landmark complete! Nobody can take this land now!'],
      ['드디어 랜드마크! 이 도시의 자랑이 탄생했어요!', 'A landmark at last! The pride of the city!'],
    ],
  },

  // --- Tolls & takeovers -----------------------------------------------------------------------
  'toll.small': {
    level: 'normal',
    priority: P.info,
    expr: 'present',
    takes: [
      ['남의 땅에 왔으니 통행료를 내야 해요.', "It's someone else's land — time to pay the toll."],
      ['통행료 납부! 이 정도는 괜찮죠?', "Toll paid! That's not too bad, right?"],
      ['잠깐 쉬어 가는 값이에요. 통행료 내고 가요!', 'A small fee for the stop. Pay and go!'],
      ['주인님께 통행료를 드릴 시간이에요!', 'Time to pay the owner!'],
      ['통행료는 여행의 일부죠! 쿨하게 내요!', 'Tolls are part of travel! Pay it cool!'],
      ['아쉽지만 남의 땅이에요. 통행료 내고 갈게요!', "Sorry, someone else's land. Pay and go!"],
    ],
  },
  'toll.big': {
    level: 'min',
    priority: P.big,
    expr: 'surprised',
    takes: [
      ['으악! 통행료가 어마어마해요!', 'Yikes! That toll is huge!'],
      ['헉, 지갑이 텅 비어 가요! 큰돈이 나가네요!', 'Oof, your wallet is emptying fast!'],
      ['아이고, 비싼 동네에 들어왔어요!', 'Ouch, this is an expensive neighborhood!'],
      ['이건 정말 아프겠는데요… 통행료 폭탄이에요!', "That one hurts… a toll bomb!"],
      ['세상에! 이 정도면 집 한 채 값이에요!', "Goodness! That's the price of a house!"],
    ],
  },
  'toll.waived': {
    level: 'min',
    priority: P.event,
    expr: 'laugh',
    takes: [
      ['통행료 면제권 등장! 오늘은 공짜예요!', 'Toll pass! Free today!'],
      ['면제권 덕분에 한 푼도 안 냈어요! 휴~', 'Thanks to the pass, not a penny! Phew!'],
    ],
  },
  'takeover.advice.yes': {
    level: 'normal',
    priority: P.advice,
    expr: 'point',
    takes: [
      ['이 땅, 인수할 수 있어요! 저라면 빼앗아 오겠어요!', "You can take over this land! I'd grab it!"],
      ['기회예요! 인수하면 상대의 수입을 막을 수 있어요!', 'Chance! Take it over and cut their income!'],
    ],
  },
  'takeover.advice.no': {
    level: 'normal',
    priority: P.advice,
    expr: 'thinking',
    takes: [
      ['인수는 비싸요. 이번엔 참아 볼까요?', "Takeovers are pricey. Maybe hold back?"],
      ['저라면 이번엔 넘기겠어요. 현금이 더 중요해요.', "I'd pass. Cash matters more right now."],
    ],
  },
  'takeover.shield': {
    level: 'normal',
    priority: P.advice,
    expr: 'nervous',
    takes: [['잠깐! 주인이 수호 방패를 갖고 있어요. 인수가 막힐 거예요!', 'Wait! The owner has a Guard Shield. It will be blocked!']],
  },
  'takeover.done': {
    level: 'min',
    priority: P.big,
    expr: 'surprised',
    takes: [
      ['인수 성공! 이 땅의 주인이 바뀌었어요!', 'Takeover! This land has a new owner!'],
      ['쾅! 땅을 통째로 사 버렸어요!', 'Boom! Bought the whole plot!'],
      ['이런 반전이! 주인이 바뀌었어요!', 'What a twist! A new owner!'],
    ],
  },
  'takeover.blocked': {
    level: 'min',
    priority: P.big,
    expr: 'laugh',
    takes: [
      ['방패가 막아냈어요! 인수 실패!', 'The shield blocked it! Takeover failed!'],
      ['딩! 수호 방패 발동! 이 땅은 안전해요!', 'Ding! Guard Shield! This land is safe!'],
    ],
  },

  // --- Cards -----------------------------------------------------------------------------------
  'card.draw': {
    level: 'normal',
    priority: P.info,
    expr: 'present',
    takes: [
      ['이벤트 카드를 뽑았어요! 과연 무엇일까요?', 'An event card! What could it be?'],
      ['두근두근, 카드를 뒤집어 볼게요!', "Let's flip the card!"],
      ['행운일까요, 불운일까요? 카드 오픈!', 'Lucky or unlucky? Card reveal!'],
      ['짜잔! 어떤 이야기가 기다리고 있을까요?', 'Ta-da! What story awaits?'],
      ['카드 한 장에 운명이 걸렸어요!', 'Fate rides on one card!'],
    ],
  },
  'card.to-start': { level: 'normal', priority: P.event, expr: 'cheer', takes: [['출발지로 슝! 월급 받으러 가요!', 'Zoom to Start! Go get paid!']] },
  'card.to-island': { level: 'normal', priority: P.event, expr: 'sad', takes: [['이런, 무인도로 직행이에요!', 'Oh no, straight to the island!']] },
  'card.to-travel': { level: 'normal', priority: P.event, expr: 'present', takes: [['자유여행 칸으로 가요! 다음 턴엔 어디든 갈 수 있어요!', 'Off to Travel! Next turn, go anywhere!']] },
  'card.to-festival': { level: 'normal', priority: P.event, expr: 'cheer', takes: [['축제 칸으로 출발! 내 도시에서 축제를 열어요!', 'To the Festival! Throw a party in your city!']] },
  'card.bank-dividend': { level: 'normal', priority: P.event, expr: 'cheer', takes: [['은행에서 배당금이 들어왔어요!', 'The bank paid a dividend!']] },
  'card.lottery': { level: 'normal', priority: P.event, expr: 'laugh', takes: [['복권 당첨! 오늘 대박이에요!', 'Lottery win! Jackpot day!']] },
  'card.fine': { level: 'normal', priority: P.event, expr: 'sad', takes: [['벌금이에요… 다음부턴 조심해요!', 'A fine… be careful next time!']] },
  'card.repairs': { level: 'normal', priority: P.event, expr: 'nervous', takes: [['건물 수리비가 나왔어요. 건물이 많을수록 비싸요!', 'Repair bill! More buildings, more cost!']] },
  'card.birthday': { level: 'normal', priority: P.event, expr: 'cheer', takes: [['생일 축하해요! 모두에게 선물을 받아요!', 'Happy birthday! Gifts from everyone!']] },
  'card.charity': { level: 'normal', priority: P.event, expr: 'present', takes: [['마음 따뜻한 기부! 모두에게 조금씩 나눠 줘요.', 'A kind donation! Share a little with everyone.']] },
  'card.back-three': { level: 'normal', priority: P.event, expr: 'surprised', takes: [['어이쿠, 세 칸 뒤로!', 'Oops, three steps back!']] },
  'card.nearest-hub': { level: 'normal', priority: P.event, expr: 'nervous', takes: [['가장 가까운 허브로! 주인이 있으면 통행료가 두 배예요!', 'To the nearest hub! Double toll if owned!']] },
  'card.escape': { level: 'normal', priority: P.event, expr: 'point', takes: [['탈출권 획득! 무인도에 가면 꺼내 써요!', 'Escape Pass! Use it on the island!']] },
  'card.toll-pass': { level: 'normal', priority: P.event, expr: 'point', takes: [['통행료 면제권! 다음 통행료는 공짜예요!', 'Toll Pass! Your next toll is free!']] },
  'card.shield': { level: 'normal', priority: P.event, expr: 'point', takes: [['수호 방패! 인수 시도를 한 번 막아 줘요!', 'Guard Shield! Blocks one takeover!']] },
  'card.welfare': { level: 'normal', priority: P.event, expr: 'laugh', takes: [['복지기금 당첨! 기부함이 통째로 당신 거예요!', 'Welfare fund! The whole pot is yours!']] },
  'card.express': { level: 'normal', priority: P.event, expr: 'laugh', takes: [['급행 열차 탑승! 다음 이동은 두 배예요!', 'Express! Your next move is doubled!']] },
  'card.random-jump': { level: 'normal', priority: P.event, expr: 'surprised', takes: [['랜덤 점프! 어디로 떨어질지 아무도 몰라요!', 'Random jump! Nobody knows where you land!']] },
  'card.tax-refund': { level: 'normal', priority: P.event, expr: 'cheer', takes: [['세금 환급! 돈이 돌아왔어요!', 'Tax refund! Money back!']] },
  'card.leader-tax': { level: 'normal', priority: P.event, expr: 'present', takes: [['부자세! 1등이 꼴찌에게 용돈을 줘요!', 'Rich tax! The leader pays the last place!']] },
  'card.free-upgrade': { level: 'normal', priority: P.event, expr: 'cheer', takes: [['건물 보너스! 내 도시 하나를 공짜로 올려요!', 'Building bonus! Upgrade one city for free!']] },
  'card.typhoon': { level: 'normal', priority: P.event, expr: 'surprised', takes: [['태풍이 몰려와요! 누군가의 건물이 낮아져요!', "A typhoon! Someone's building shrinks!"]] },
  'card.festival-invite': { level: 'normal', priority: P.event, expr: 'cheer', takes: [['축제 초대장! 축제가 내 도시로 옮겨와요!', 'Festival invite! The festival moves to your city!']] },
  'card.hub-bonus': { level: 'normal', priority: P.event, expr: 'cheer', takes: [['세계 일주 보너스! 허브가 많을수록 더 받아요!', 'World tour bonus! More hubs, more money!']] },
  express: { level: 'normal', priority: P.info, expr: 'laugh', takes: [['급행 발동! 두 배로 달려요!', 'Express on! Double the distance!']] },

  // --- Corners & special spaces ----------------------------------------------------------------
  'island.enter': {
    level: 'normal',
    priority: P.event,
    expr: 'sad',
    takes: [
      ['무인도에 도착했어요… 잠깐 쉬어 가요.', 'Stranded on the island… take a little rest.'],
      ['야자수 아래서 휴가 중! 더블이 나오면 탈출할 수 있어요.', 'Vacation under the palms! Roll doubles to escape.'],
      ['파도 소리 들리나요? 무인도에 갇혔어요!', 'Hear the waves? Stuck on the island!'],
    ],
  },
  'island.advice': {
    level: 'normal',
    priority: P.advice,
    expr: 'thinking',
    takes: [
      ['더블이 나오면 탈출! 급하면 보석금을 내도 돼요.', 'Doubles to escape! Or pay bail if you are in a hurry.'],
      ['저라면 더블을 노려 보겠어요. 행운을 빌어요!', "I'd go for doubles. Good luck!"],
    ],
  },
  'island.escape': {
    level: 'normal',
    priority: P.event,
    expr: 'cheer',
    takes: [
      ['탈출 성공! 다시 여행을 떠나요!', 'Escaped! Back on the road!'],
      ['드디어 섬을 떠나요! 안녕, 야자수야!', 'Finally leaving! Bye-bye, palm trees!'],
    ],
  },
  'festival.prompt': {
    level: 'normal',
    priority: P.advice,
    expr: 'present',
    takes: [
      ['축제를 열 도시를 골라 주세요! 통행료가 두 배가 돼요!', 'Pick a city for the festival! Its toll doubles!'],
      ['신나는 축제 시간! 가장 비싼 도시에 열면 좋겠죠?', 'Festival time! Your priciest city is a good pick!'],
    ],
  },
  'festival.set': {
    level: 'normal',
    priority: P.event,
    expr: 'cheer',
    takes: [
      ['빵빠레! 축제가 시작됐어요! 이 도시는 통행료 두 배!', 'Fanfare! The festival begins — double toll here!'],
      ['폭죽이 팡팡! 축제 도시가 정해졌어요!', 'Fireworks! The festival city is set!'],
    ],
  },
  'travel.granted': {
    level: 'normal',
    priority: P.event,
    expr: 'present',
    takes: [
      ['자유여행 당첨! 다음 턴엔 원하는 칸으로 떠날 수 있어요!', 'Free travel! Next turn, go anywhere you like!'],
      ['여행 가방을 챙겨요! 다음 턴은 순간이동이에요!', 'Pack your bags! Teleport next turn!'],
    ],
  },
  'travel.prompt': {
    level: 'normal',
    priority: P.advice,
    expr: 'point',
    takes: [
      ['어디든 갈 수 있어요! 어디로 떠날까요?', 'You can go anywhere! Where to?'],
      ['저라면 아직 주인 없는 좋은 땅으로 가겠어요!', "I'd fly to a good unowned plot!"],
    ],
  },
  'tax.pay': { level: 'normal', priority: P.info, expr: 'sad', takes: [['세무서예요. 세금은 피할 수 없죠!', "Tax office. You can't escape taxes!"]] },
  'donation.pay': { level: 'normal', priority: P.info, expr: 'present', takes: [['기부함에 쏙! 나중에 누군가 받아 가요.', 'Into the donation box! Someone will collect it later.']] },

  // --- Auctions, debt, bankruptcy -------------------------------------------------------------
  'auction.start': {
    level: 'normal',
    priority: P.event,
    expr: 'present',
    takes: [
      ['경매가 시작됐어요! 가장 높게 부르는 사람이 주인이에요!', 'Auction time! Highest bid wins!'],
      ['자, 경매 개시! 누가 이 땅을 가져갈까요?', 'The auction opens! Who will take this land?'],
    ],
  },
  'auction.end': {
    level: 'normal',
    priority: P.event,
    expr: 'cheer',
    takes: [
      ['땅땅땅! 낙찰되었습니다!', 'Going, going, gone! Sold!'],
      ['경매 종료! 새 주인을 축하해요!', 'Auction over! Congrats to the new owner!'],
    ],
  },
  'debt.start': {
    level: 'min',
    priority: P.big,
    expr: 'nervous',
    takes: [
      ['돈이 모자라요! 건물이나 땅을 팔아서 갚아야 해요.', "Not enough cash! Sell buildings or land to pay."],
      ['위기예요! 팔 수 있는 걸 골라 주세요.', 'Trouble! Choose something to sell.'],
    ],
  },
  'sell.done': { level: 'normal', priority: P.info, expr: 'sad', takes: [['아까운 자산을 팔았어요… 힘내요!', 'Sold a precious asset… hang in there!']] },
  bankrupt: {
    level: 'min',
    priority: P.end,
    expr: 'sad',
    takes: [
      ['아이고… 파산이에요. 정말 아쉬운 승부였어요.', 'Oh no… bankrupt. What a close game.'],
      ['여기까지예요. 그래도 멋진 도전이었어요!', 'That is the end of the road. Still, a great try!'],
      ['파산이에요… 그래도 끝까지 웃는 모습이 멋졌어요!', 'Bankrupt… but you kept smiling to the end!'],
    ],
  },

  // --- Time pressure -----------------------------------------------------------------------------
  'round.final': {
    level: 'min',
    priority: P.big,
    expr: 'nervous',
    takes: [
      ['이제 시간이 얼마 남지 않았어요! 마지막 세 라운드예요!', 'Time is running out! Final three rounds!'],
      ['막판 스퍼트! 세 라운드 안에 승부가 갈려요!', 'Final stretch! Three rounds to decide it!'],
    ],
  },
  'round.last': {
    level: 'min',
    priority: P.big,
    expr: 'nervous',
    takes: [
      ['마지막 라운드예요! 마지막 기회를 잡으세요!', 'Last round! Seize your final chance!'],
      ['드디어 마지막 라운드! 끝까지 방심은 금물이에요!', 'The very last round! Stay sharp to the end!'],
    ],
  },
  'timer.urgent': {
    level: 'min',
    priority: P.event,
    expr: 'nervous',
    takes: [
      ['서둘러요! 시간이 얼마 남지 않았어요!', 'Hurry! Time is almost up!'],
      ['삼, 이, 일… 빨리 골라요!', 'Three, two, one… pick quickly!'],
      ['째깍째깍! 고민할 시간이 거의 없어요!', 'Tick tock! Almost no time left!'],
      ['얼른요, 얼른! 시간이 도망가요!', 'Quick, quick! Time is running away!'],
    ],
  },
  'timer.auto': { level: 'normal', priority: P.info, expr: 'present', takes: [['시간이 다 돼서 제가 안전한 쪽으로 골랐어요.', 'Time is up, so I picked the safe choice.']] },
  'cpu.thinking': {
    level: 'full',
    priority: P.quip,
    expr: 'thinking',
    takes: [
      ['AI가 곰곰이 생각 중이에요…', 'The AI is thinking hard…'],
      ['음, AI는 무슨 수를 쓸까요?', 'Hmm, what will the AI do?'],
      ['AI의 계산기가 바쁘게 돌아가요!', "The AI's calculator is spinning!"],
      ['AI도 긴장했나 봐요. 고민이 길어요!', 'Even the AI is nervous. Long think!'],
      ['AI가 작전을 짜고 있어요. 두근두근!', 'The AI is planning. Exciting!'],
    ],
  },

  // --- Extra moments -----------------------------------------------------------------------------
  'toll.receive': {
    level: 'normal',
    priority: P.info,
    expr: 'laugh',
    takes: [
      ['통행료 수입! 짤랑짤랑, 기분 좋은 소리예요!', 'Toll income! Ka-ching, what a lovely sound!'],
      ['손님이 왔어요! 통행료 잘 받았습니다!', 'A visitor! Toll received, thank you!'],
      ['땅을 사 둔 보람이 있네요! 수입 들어와요!', 'Owning land pays off! Money coming in!'],
    ],
  },
  'streak.toll': {
    level: 'min',
    priority: P.big,
    expr: 'laugh',
    takes: [
      ['통행료 연속 수입! 돈이 굴러 들어와요!', 'Toll after toll! The money keeps rolling in!'],
      ['또 받았어요! 오늘 완전 대박 행진이에요!', 'Another one! What a winning streak!'],
    ],
  },
  'land.own': {
    level: 'full',
    priority: P.quip,
    expr: 'idle',
    takes: [
      ['내 땅에 돌아왔어요! 편하게 쉬어 가요.', 'Back on your own land! Relax.'],
      ['집이 최고죠! 여긴 통행료가 없어요.', "There's no place like home! No toll here."],
    ],
  },
  'cash.low': {
    level: 'normal',
    priority: P.event,
    expr: 'nervous',
    takes: [
      ['현금이 바닥나고 있어요! 다음 통행료가 걱정돼요.', 'Cash is running low! Watch out for the next toll.'],
      ['지갑이 가벼워졌어요. 조심조심 다녀요!', 'Your wallet is light. Tread carefully!'],
    ],
  },
  'leader.change': {
    level: 'normal',
    priority: P.event,
    expr: 'surprised',
    takes: [
      ['선두가 바뀌었어요! 승부가 점점 재밌어져요!', 'A new leader! This is getting exciting!'],
      ['역전이에요! 순위표가 뒤집혔어요!', 'A comeback! The rankings flipped!'],
      ['새로운 1등 등장! 아직 끝날 때까지 끝난 게 아니에요!', "A new number one! It's not over till it's over!"],
    ],
  },
  'round.start': {
    level: 'full',
    priority: P.quip,
    expr: 'present',
    takes: [
      ['새 라운드 시작! 이번엔 누가 웃을까요?', 'A new round! Who will smile this time?'],
      ['다음 라운드로 가 볼까요? 판이 점점 뜨거워져요!', 'On to the next round! Things are heating up!'],
    ],
  },
  'card.used': {
    level: 'normal',
    priority: P.event,
    expr: 'point',
    takes: [
      ['아껴 둔 카드를 꺼냈어요! 현명한 선택이에요!', 'Played a saved card! Smart move!'],
      ['짠! 보관 카드 사용! 이럴 때 쓰려고 모아 뒀죠!', 'Ta-da! Saved card used — that is what it was for!'],
    ],
  },

  // --- Rule levels (보통 / 고급) -------------------------------------------------------------------
  'late.toll': {
    level: 'min',
    priority: P.big,
    expr: 'nervous',
    takes: [
      ['이제부터 막판이에요! 통행료가 라운드마다 쑥쑥 올라요!', 'The final stretch! Tolls climb every round now!'],
      ['긴장하세요! 지금부터 통행료가 점점 비싸져요!', 'Brace yourselves! Tolls get pricier from here!'],
    ],
  },
  'card.choice': {
    level: 'normal',
    priority: P.advice,
    expr: 'present',
    takes: [
      ['카드 두 장 중에 하나를 골라요! 어떤 게 좋을까요?', 'Two cards — pick one! Which will it be?'],
      ['운명은 당신 손에! 마음에 드는 카드를 골라 보세요!', 'Fate is in your hands! Pick the card you like!'],
    ],
  },
  'use.pass.yes': {
    level: 'normal',
    priority: P.advice,
    expr: 'point',
    takes: [['지금이 면제권을 쓸 때예요! 통행료가 꽤 비싸거든요!', 'Now is the time for your Toll Pass — this one is pricey!']],
  },
  'use.pass.no': {
    level: 'normal',
    priority: P.advice,
    expr: 'thinking',
    takes: [['이 정도는 그냥 내고, 면제권은 비싼 곳에 아껴 둬요!', 'Just pay this one and save the pass for a big toll!']],
  },
  'use.shield': {
    level: 'normal',
    priority: P.big,
    expr: 'nervous',
    takes: [
      ['인수 위기! 수호 방패로 막을 수 있어요!', 'Takeover alert! Your Guard Shield can stop it!'],
      ['누가 땅을 노려요! 방패를 쓸까요?', "Someone's after your land! Raise the shield?"],
    ],
  },
  'olympics.up': {
    level: 'min',
    priority: P.big,
    expr: 'cheer',
    takes: [
      ['올림픽급 축제! 통행료가 더 크게 뛰었어요!', 'An Olympic-sized festival! The toll leaps higher!'],
      ['축제가 또 열렸어요! 이 도시는 이제 무시무시해요!', 'Another festival here! This city is fearsome now!'],
    ],
  },
  'hub.grow': {
    level: 'normal',
    priority: P.info,
    expr: 'surprised',
    takes: [['허브가 인기 폭발! 다음 통행료는 더 비싸져요!', 'The hub is booming! Its next toll goes up!']],
  },
  'doubleup.offer': {
    level: 'normal',
    priority: P.big,
    expr: 'dice',
    takes: [
      ['보너스 게임! 홀일까요, 짝일까요? 맞히면 두 배예요!', 'Bonus game! Odd or even? Guess right to double it!'],
      ['출발 칸 보너스! 용기 있게 도전해 볼까요?', 'Start bonus! Feeling brave?'],
    ],
  },
  'doubleup.win': {
    level: 'min',
    priority: P.big,
    expr: 'cheer',
    takes: [
      ['맞혔어요! 두 배로 껑충!', 'You got it! Doubled!'],
      ['대단해요! 감이 좋은데요? 계속할까요?', 'Amazing instinct! Keep going?'],
    ],
  },
  'doubleup.lose': {
    level: 'min',
    priority: P.big,
    expr: 'sad',
    takes: [
      ['아이고, 아쉬워요! 이번엔 틀렸어요.', 'Oh no, so close! Wrong this time.'],
      ['아깝다! 다음엔 꼭 맞힐 거예요!', "So close! You'll get it next time!"],
    ],
  },
  'gauge.hint': {
    level: 'full',
    priority: P.quip,
    expr: 'dice',
    takes: [['게이지를 보고, 원하는 순간에 손을 떼 보세요!', 'Watch the gauge and let go when you like!']],
  },

  // --- Rule explanations (first landing on a kind) ---------------------------------------------
  'explain.start': { level: 'full', priority: P.info, expr: 'present', takes: [['출발 칸이에요! 지나갈 때마다 월급을 받아요.', 'This is Start! Collect a salary each time you pass.']] },
  'explain.city': { level: 'full', priority: P.info, expr: 'present', takes: [['도시는 사서 건물을 올릴 수 있어요. 다른 사람이 오면 통행료를 받아요!', 'Buy cities and build. Others pay you tolls!']] },
  'explain.hub': { level: 'full', priority: P.info, expr: 'present', takes: [['여행 허브예요! 허브를 모두 모으면 바로 승리해요!', 'A travel hub! Own them all to win instantly!']] },
  'explain.event': { level: 'full', priority: P.info, expr: 'present', takes: [['이벤트 칸에선 카드를 한 장 뽑아요. 행운도 불운도 있어요!', 'Event spaces draw a card — good or bad!']] },
  'explain.island': { level: 'full', priority: P.info, expr: 'present', takes: [['무인도에선 최대 세 턴 쉬어요. 더블, 보석금, 탈출권으로 나갈 수 있어요.', 'Up to three turns on the island. Escape with doubles, bail or a pass.']] },
  'explain.donation': { level: 'full', priority: P.info, expr: 'present', takes: [['기부함 칸이에요. 모인 돈은 출발 칸에 딱 멈춘 사람이 가져가요!', 'The donation box. Landing exactly on Start takes the pot!']] },
  'explain.tax': { level: 'full', priority: P.info, expr: 'present', takes: [['세무서예요. 가진 현금에 따라 세금을 내요.', 'The tax office. You pay based on your cash.']] },
  'explain.festival': { level: 'full', priority: P.info, expr: 'present', takes: [['축제 칸이에요! 내 도시 하나에 축제를 열면 통행료가 두 배가 돼요.', 'Festival! Pick one of your cities to double its toll.']] },
  'explain.travel': { level: 'full', priority: P.info, expr: 'present', takes: [['자유여행 칸이에요! 다음 턴에 원하는 칸으로 바로 날아가요.', 'Travel! Next turn, fly straight to any space.']] },
  'explain.takeover': { level: 'full', priority: P.info, expr: 'present', takes: [['통행료를 낸 뒤엔 그 땅을 웃돈 주고 인수할 수 있어요. 랜드마크는 안 돼요!', 'After paying a toll you may buy the land at a premium — except landmarks!']] },

  // --- Endings -------------------------------------------------------------------------------------
  'win.triple': { level: 'min', priority: P.end, expr: 'trophy', takes: [['트리플 독점 승리! 세 지역을 모두 차지했어요! 축하합니다!', 'Triple monopoly win! Three regions! Congratulations!']] },
  'win.line': { level: 'min', priority: P.end, expr: 'trophy', takes: [['라인 독점 승리! 한 줄을 통째로 가졌어요! 대단해요!', 'Line monopoly win! A whole side! Amazing!']] },
  'win.hubs': { level: 'min', priority: P.end, expr: 'trophy', takes: [['허브 독점 승리! 세계의 길이 모두 당신 거예요!', 'Hub monopoly win! Every route is yours!']] },
  'win.assets': {
    level: 'min',
    priority: P.end,
    expr: 'trophy',
    takes: [
      ['게임 끝! 가장 부자가 된 우승자, 축하합니다!', 'Game over! Congratulations to the richest player!'],
      ['우승을 축하해요! 정말 대단한 승부였어요!', 'Congratulations on the win! What a game!'],
    ],
  },
  'win.lastStanding': { level: 'min', priority: P.end, expr: 'trophy', takes: [['마지막까지 살아남은 진정한 승자! 축하합니다!', 'The last one standing — a true champion!']] },
};

export interface DealerLine {
  id: string;
  situation: string;
  level: DealerLevel;
  priority: number;
  expr: DealerExpr;
  ko: string;
  en: string;
}

/** Every take as a flat list (generators, integrity tests). */
export const DEALER_LINES: readonly DealerLine[] = Object.entries(SITUATIONS).flatMap(([situation, s]) =>
  s.takes.map(([ko, en], k) => ({ id: `${situation}.${k + 1}`, situation, level: s.level, priority: s.priority, expr: s.expr, ko, en })),
);

const LEVEL_RANK: Record<DealerLevel, number> = { min: 0, normal: 1, full: 2 };

/** Does a voice setting include lines of `level`? */
export function levelIncludes(setting: DealerLevel, level: DealerLevel): boolean {
  return LEVEL_RANK[level] <= LEVEL_RANK[setting];
}
