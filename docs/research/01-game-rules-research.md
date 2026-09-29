# 01 - Game Rules Research: Monopoly, 부루마블 (Blue Marble), 모두의마블 (Modu Marble)

Purpose: ground the design of an original 20-30 minute, 4-player, single-tablet property-trading game for casual players.
Scope: rules, numbers, "fun factor" mechanics, UX patterns, pacing tricks. No code.
Research date: 2026-09-29.

---

## 0. Method and confidence (read this first)

- `WebSearch` worked and returned summaries with URLs. `WebFetch` was blocked by the network egress proxy for every domain tried (Fandom, Wikipedia, namu.wiki, thewiki.kr, Netmarble, geekyhobbies, officialgamerules, diceanddeeds and others). No full-page reads were possible.
- Every figure is therefore tagged with one of three confidence levels:
  - **[S]** = appeared in a search-result summary (source URL given in Section 8).
  - **[K]** = from the researcher's background knowledge of the standard published rules. Widely documented and stable, but not re-verified live. Applies mainly to the Monopoly tables.
  - **[?]** = uncertain, or reconstructed. Verify against the primary source before hard-coding.
- The Korean wikis (namu.wiki, thewiki.kr) are the best sources for Blue Marble and Modu Marble numbers. They could not be opened, so the exact price/toll tables for those two games are **incomplete**. Where a number is missing, that is stated, not invented.
- The design conclusions (Section 6 and Section 7) depend on mechanics, not on exact Blue Marble or Modu Marble prices. The missing tables do not block them.

---

## 1. Monopoly (Hasbro) - classic rules

### 1.1 Core loop and equipment
- 2-8 players, 2 dice, tokens, 32 houses, 12 hotels, Title Deed cards, Chance and Community Chest decks, bank money. [S][K]
- Start with **$1,500**. Salary for passing or landing on Go is **$200**. [K]
- Turn: roll 2d6, move clockwise, resolve the space. If unowned, buy it at list price or the bank auctions it. If owned by another player, pay rent per the deed. Before or after rolling, a player may build, mortgage or trade. [S][K]
- Goal: last player solvent. Every other player is bankrupt (elimination game). [K]

### 1.2 Board layout (40 spaces, US Atlantic City edition) [K]

| # | Space | # | Space |
|---|-------|---|-------|
| 0 | **GO** (collect $200) | 20 | **Free Parking** (nothing in official rules) |
| 1 | Mediterranean Ave (brown) | 21 | Kentucky Ave (red) |
| 2 | Community Chest | 22 | Chance |
| 3 | Baltic Ave (brown) | 23 | Indiana Ave (red) |
| 4 | **Income Tax** ($200) | 24 | Illinois Ave (red) |
| 5 | Reading Railroad | 25 | B&O Railroad |
| 6 | Oriental Ave (light blue) | 26 | Atlantic Ave (yellow) |
| 7 | Chance | 27 | Ventnor Ave (yellow) |
| 8 | Vermont Ave (light blue) | 28 | Water Works (utility) |
| 9 | Connecticut Ave (light blue) | 29 | Marvin Gardens (yellow) |
| 10 | **Jail / Just Visiting** | 30 | **Go To Jail** |
| 11 | St. Charles Place (pink) | 31 | Pacific Ave (green) |
| 12 | Electric Company (utility) | 32 | North Carolina Ave (green) |
| 13 | States Ave (pink) | 33 | Community Chest |
| 14 | Virginia Ave (pink) | 34 | Pennsylvania Ave (green) |
| 15 | Pennsylvania Railroad | 35 | Short Line Railroad |
| 16 | St. James Place (orange) | 36 | Chance |
| 17 | Community Chest | 37 | Park Place (dark blue) |
| 18 | Tennessee Ave (orange) | 38 | **Luxury Tax** ($100) |
| 19 | New York Ave (orange) | 39 | Boardwalk (dark blue) |

Counts: 22 colored streets (8 groups), 4 railroads, 2 utilities = 28 buyable spaces. 3 Community Chest, 3 Chance, 2 tax, 4 corners. [S][K]

### 1.3 Price, rent, house cost table [K, spot-checked [S]]

Spot-check [S]: Mediterranean is $60 with rents 2/10/30/90/160/250. Boardwalk is $400 with rents 50/200/600/1400/1700/2000. Railroad rent is 25/50/100/200 for 1-4 owned. Mortgage value is half the price.

Columns: Base = rent with no houses. Rents are 0 houses, 1, 2, 3, 4 houses, hotel.

| Group | Property | Price | Base | 1H | 2H | 3H | 4H | Hotel | House/Hotel cost |
|---|---|---|---|---|---|---|---|---|---|
| Brown | Mediterranean | 60 | 2 | 10 | 30 | 90 | 160 | 250 | 50 |
| Brown | Baltic | 60 | 4 | 20 | 60 | 180 | 320 | 450 | 50 |
| Light blue | Oriental | 100 | 6 | 30 | 90 | 270 | 400 | 550 | 50 |
| Light blue | Vermont | 100 | 6 | 30 | 90 | 270 | 400 | 550 | 50 |
| Light blue | Connecticut | 120 | 8 | 40 | 100 | 300 | 450 | 600 | 50 |
| Pink | St. Charles | 140 | 10 | 50 | 150 | 450 | 625 | 750 | 100 |
| Pink | States | 140 | 10 | 50 | 150 | 450 | 625 | 750 | 100 |
| Pink | Virginia | 160 | 12 | 60 | 180 | 500 | 700 | 900 | 100 |
| Orange | St. James | 180 | 14 | 70 | 200 | 550 | 750 | 950 | 100 |
| Orange | Tennessee | 180 | 14 | 70 | 200 | 550 | 750 | 950 | 100 |
| Orange | New York | 200 | 16 | 80 | 220 | 600 | 800 | 1000 | 100 |
| Red | Kentucky | 220 | 18 | 90 | 250 | 700 | 875 | 1050 | 150 |
| Red | Indiana | 220 | 18 | 90 | 250 | 700 | 875 | 1050 | 150 |
| Red | Illinois | 240 | 20 | 100 | 300 | 750 | 925 | 1100 | 150 |
| Yellow | Atlantic | 260 | 22 | 110 | 330 | 800 | 975 | 1150 | 150 |
| Yellow | Ventnor | 260 | 22 | 110 | 330 | 800 | 975 | 1150 | 150 |
| Yellow | Marvin Gardens | 280 | 24 | 120 | 360 | 850 | 1025 | 1200 | 150 |
| Green | Pacific | 300 | 26 | 130 | 390 | 900 | 1100 | 1275 | 200 |
| Green | North Carolina | 300 | 26 | 130 | 390 | 900 | 1100 | 1275 | 200 |
| Green | Pennsylvania | 320 | 28 | 150 | 450 | 1000 | 1200 | 1400 | 200 |
| Dark blue | Park Place | 350 | 35 | 175 | 500 | 1100 | 1300 | 1500 | 200 |
| Dark blue | Boardwalk | 400 | 50 | 200 | 600 | 1400 | 1700 | 2000 | 200 |

- **Railroads** (4, $200 each): rent 25 / 50 / 100 / 200 for 1 / 2 / 3 / 4 owned. [S]
- **Utilities** (2, $150 each): rent is 4x the dice roll if one is owned, 10x if both. [K]
- **Monopoly bonus**: owning the whole color group doubles rent on unimproved lots in it. [S]
- **Mortgage**: value is half the price. Lifting it costs the mortgage value plus 10%. Mortgaged property collects no rent. Unimproved properties only. Buildings must be sold back at half price first. [S][K]

Design observation: rent jumps are steep. Hotel rent is about 2-12x the 1-house rent. Rent is roughly 3-5% of price with no houses, and about 60-70% of price at the hotel level for the better groups. Orange and red are statistically the strongest groups because of jail-exit landing patterns. This is a well-known result. [K]

### 1.4 Building rules [S][K]
- Houses may only be built on a **complete color group**, evenly. No property may be more than one house ahead of the others in its group.
- Up to 4 houses, then trade 4 houses plus cost for a hotel.
- Bank supply is finite: 32 houses, 12 hotels. When houses run out, players cannot build. This is a deliberate strategic weapon ("housing shortage"), sometimes used to block opponents.
- Selling buildings back: half price.

### 1.5 Auctions [S]
- If a player declines to buy an unowned property they landed on, the bank auctions it immediately. Any player, including the decliner, may bid, starting from any amount (even $1).
- Widely cited as one of the most-skipped and most-important rules. When it is skipped, properties stay unowned and the game gets much longer. [S]

### 1.6 Doubles and Jail [S][K]
- Roll doubles: move, resolve, then roll again.
- Third consecutive doubles: **go directly to Jail** without moving.
- Ways into Jail: land on "Go To Jail" (space 30), draw a Go To Jail card, or roll three doubles.
- Ways out: (1) pay **$50** before rolling, (2) use a Get Out of Jail Free card, or (3) roll doubles within 3 tries. After the third failed try, pay $50 and move by that roll.
- While in Jail you still collect rent, may build, trade and mortgage. Jail stops movement, not commerce. [S]
- Rolling doubles to exit Jail moves you but does not grant an extra roll (official).

### 1.7 Chance and Community Chest examples [S][K]
Chance (16 cards) has these effects: Advance to Go (collect $200), Advance to Boardwalk, Advance to Illinois Ave, Advance to St. Charles Place (collect $200 if you pass Go), advance to nearest railroad (pay double rent if owned), advance to nearest utility, bank pays you dividend of $50, Get Out of Jail Free, go back 3 spaces, go to Jail, "pay each player $50", general repairs ($25 per house, $100 per hotel), speeding fine $15, and a building-loan-matures card for $150.
Community Chest (16 cards) is mostly money: bank error in your favor ($200), doctor's fee (pay $50), from-sale-of-stock ($50), holiday fund matures ($100), income tax refund ($20), life insurance matures ($100), hospital fees ($100), school fees ($50), collect $25 consultancy fee, street repairs ($40 per house, $115 per hotel), beauty contest ($10), inherit $100, Get Out of Jail Free, and Advance to Go. Note that in Oct 2021 Hasbro rewrote the whole Community Chest deck with community-service-themed cards, e.g. "You volunteered at a blood donation - COLLECT $10". [S]

Fun-factor note: cards are the game's "surprise" source. They move players, swing cash by tens or hundreds, and occasionally punish the leader (pay each player). They are the main tool for keeping non-owning turns interesting.

### 1.8 Taxes, Free Parking, Bankruptcy [S][K]
- Income Tax: pay $200 (older editions offered "10% of net worth"; the flat version is current). Luxury Tax: pay $100.
- Free Parking: official rules = nothing happens. The "Free Parking jackpot" is a house rule (see 1.10) and it makes games longer. [S]
- Bankruptcy: if you owe more than you can raise (by selling buildings and mortgaging), you are out. Debts to another player transfer all your assets to that creditor. Debts to the bank return everything to the bank, and properties are then auctioned.
- Trading is free-form between players; no bank-imposed prices.

### 1.9 Length problems (why it feels long) [S]
- Publicised times vary widely. BoardGameGeek lists 180 minutes. One source says about 45 minutes when played by official rules. A commonly cited real 4-player range is 60-90 minutes; many households take 3+ hours. [S]
- Cited structural problems: (1) runaway leader, since once someone owns a monopoly the rest is a slow grind; (2) player elimination, where losers watch for an hour; (3) extended trade negotiation; (4) house rules that add money (Free Parking pot, skipped auctions) that prolong the middle game; (5) a long "land grab" phase with little decision-making. [S]

### 1.10 Popular shortening house rules and official variants [S][K]
- **Always auction** declined properties. This is the biggest single speed-up and is already in the official rules. [S]
- **No Free Parking jackpot.** [S]
- **Deal out properties at start** (each player gets 2-3 random deeds and pays list price). Skips the land-grab phase. [K]
- **Reduced starting cash** or a **shorter set of houses**, plus **build with 2 of 3** in a group. [K]
- **"Short Game" official rule**: end after a fixed time, or after a player goes bankrupt the richest player wins. Advertised as about 30 minutes. [S]
- **Speed Die** (Hasbro): a third die with three numbers, two "Mr. Monopoly" faces and a Bus. Mr. Monopoly moves you to the next unowned property, or the next owned one to pay rent. Bus lets you move a single die value, the sum, or to any chance-card square. Triples let you teleport to any space. [S]
- **Monopoly Deal** (2008, card game): win by completing 3 full color sets; about 15-30 minutes. **Monopoly Bid** 15-20 minutes. **Monopoly Madness** 5-10 minutes rounds. [S]

---

## 2. 부루마블 / 부루마불 (Blue Marble, Si-Yat-Sa, 1982)

Naming: the product is officially "부루마불" (Seed-Sa / 씨앗사). "부루마블" is the common spelling. Title refers to the Apollo 17 "Blue Marble" photograph. [S]

### 2.1 Overview [S]
- South Korea's classic Monopoly-style game, 2-4 players. Property is world cities rather than one city's streets. First published 1982. Currency is Korean won, in denominations about 1000x Monopoly's (the 1,000 won note maps to $1). [S]
- The Columbia space commemorates the Space Shuttle Columbia's first launch in 1981. [S]
- Game ends when all but one player is bankrupt. [S]

### 2.2 Money and salary [S][?]
- **Salary: 200,000 won (20만원)** for passing the start space. [S]
- Starting cash: reported as a set of notes per player (roughly four 500,000 notes, ten 100,000 notes, plus some 50,000 and smaller notes). Exact total not confirmed. Expect roughly 3,000,000 won. [S][?]

### 2.3 Board (40 spaces): layout reconstructed [?]
The four "sides" are grouped by rough national GNP order, poor to rich, at the time of design. [S]
- Side 1 (after 출발): 타이베이, 황금열쇠, 홍콩, 마닐라, 제주도 (tourist card), 싱가포르, 황금열쇠, 카이로, 이스탄불. Then the **무인도 (Deserted Island)** corner.
- Side 2: 아테네, 황금열쇠, 코펜하겐, 스톡홀름, 콩코드 여객기 (transport/tourism), 베른 (취리히 in some editions), 황금열쇠, 베를린, 오타와 (몬트리올 in some editions), 부에노스아이레스. Then the **사회복지기금 접수처 (Welfare Fund receipt)** corner.
- Side 3: 상파울루, 황금열쇠, 시드니, 부산 (later editions), 하와이, 리스본, 퀸엘리자베스호 (transport), 마드리드. Then the **우주여행 (Space Travel)** corner.
- Side 4: 도쿄, 컬럼비아호 (space shuttle, transport), 파리, 로마, 황금열쇠, 런던, 뉴욕, 사회복지기금 납부처 (pay the fund), **서울**.

The tourist spaces (제주도, 콩코드, 퀸엘리자베스호, 컬럼비아호) are treated like Monopoly railroads: the more you own, the higher the toll. They cannot be built on. [?]
Caution: the exact order of some side-2/side-3 cities and the edition-specific swaps (Bern vs Zurich, Ottawa vs Montreal, Busan) are from memory and the search summary (which grouped the cities by zone but omitted 홍콩 from zone 1 in the summary while another summary lists it). Verify before cloning.

### 2.4 Known prices and tolls [S]
Unit: 만원 = 10,000 won. Toll columns: land (대지료), villa (별장료), building (빌딩료), hotel (호텔료).

| City | Price | Land toll | Villa toll | Building toll | Hotel toll |
|---|---|---|---|---|---|
| 타이베이 | 5만 | 0.2만 (2,000) | 1만 | 9만 | 25만 |
| 홍콩 | 8만 | 0.4만 (4,000) | 2만 | 18만 | 45만 |
| 마닐라 | 8만 (same as Hong Kong) | 0.4만 | 2만 | 18만 | 45만 |
| 싱가포르 | 10만 | 0.6만 (6,000) | 3만 | 27만 | 55만 |
| 파리 | n/a | n/a | 15만 | 100만 | 140만 |
| 런던 | n/a | n/a | 17만 | 110만 | 150만 |
| 서울 | 100만 | (unbuilt toll is reported as **200만**) | - | - | - |

The remaining ~15 city prices were not retrievable. Approximate range is 5만 (Taipei) to 100만 (Seoul), rising by side. Seoul is a special case: it is very expensive and reported to bankrupt a player landing on it. [S]
Building costs (villa/building/hotel) are not in the retrieved summaries. In the physical game, buying land and building are separate purchases, and the deeds list the price per structure. [?]

### 2.5 Mechanics of note [S]
- **Toll & buy-out**: when landing on an opponent's city you pay the toll and then, by the classic rulebook, may **buy the city** from them by paying an amount. Alternative house rule: forced purchase at 2x (land value + building value). Players may also negotiate like Monopoly. [S]
- **Building**: three tiers: 별장 (villa; up to 2 villas), 빌딩 (building), 호텔 (hotel). The rulebook gives only four toll cases (villa x1, villa x2, building, hotel), with no formula. The number of buildings on a city is limited and structures are built on the owner's own turn. [S]
- **Selling**: at bankruptcy time you can sell buildings or transfer deeds to the creditor. [S]
- **무인도 (Deserted Island)**: landing there traps you for 3 turns (about 18 board spaces of travel time for others). Escape by rolling doubles, paying, or using a "무전기" (walkie-talkie) escape card, which can also be sold back to the bank for 20만원. Late-game fairness complaint: the island lets a player avoid tolls and building obligations. [S]
- **우주여행 (Space Travel)**: use the Columbia shuttle to go to the space station; per the retrieved text you go on to a destination of your choice next turn. [S][?]
- **사회복지기금 (Welfare Fund)**: money paid in (by cards and the pay-in space) accumulates. Landing on the receipt corner collects the pot. Full circuit from there earns the 20만 salary. [S]
- **황금열쇠 (Golden Key)**: draw a card and follow it immediately. Examples in the retrieved text: move back 2 spaces, move back 3 spaces (from the key in front of Taipei, back 3 lands on Seoul, which is why it is feared), go to the island, welfare-fund dividend, and the well-remembered **반액대매출 (half-price fire sale)** that forces you to sell your most expensive city to the bank at half price. There are also escape cards (무전기). [S]

### 2.6 What Koreans find fun vs frustrating [S]
Fun:
- Nostalgia; the world-cities "travel" theme; the physical thrill of buying Seoul; the golden-key surprises and swingy cards that everybody remembers by name.
- Everyone-owns-something feeling from the tourist spaces and the "rush to a color set" with kids.
Frustrating:
- **Seoul**: "the moment someone buys Seoul, the winner is decided", and the game becomes a race to see who goes bankrupt first. It is a balance-breaker. [S]
- **Long tail and elimination**, as in Monopoly.
- **Rule ambiguity** about buy-outs (players habitually house-rule them) and the island's toll-avoidance. [S]
- Rules cheating and slow banking with paper notes.

Design takeaway: Korean players love (1) named, iconic special spaces, (2) a single hideously expensive final space with a story, (3) golden-key swing cards, and they hate (1) unavoidable game-deciding luck, (2) elimination.

---

## 3. 모두의마블 (Modu Marble, Netmarble, mobile from 2013)

Modu Marble (the Kakao-platform mobile game) modernized Blue Marble. Board-game and online versions exist. The rule set below draws from search summaries of namu.wiki, thewiki.kr and Netmarble's own guide; the numeric tables were not retrievable. [S]

### 3.1 Board and victory conditions [S]
- Mobile board: **32 spaces**, on a square ring. Start corner, island corner (reported as the **8th space from start**), world-travel corner, and a corner with an Olympic space. The rest are cities (grouped by color, "line" and "area"), tourist sites (관광지), chance-card spaces, and the tax office. [S]
- **Victory in any of four ways** (this is the big design change):
  1. **Bankruptcy** of all opponents. The classic ending, now rare.
  2. **Turn or time limit**. Reported as **20 minutes** and **35 turns** in one summary, and the ~30-turn range in the brief. The richest player (by **total assets**) wins. Total assets = cash + property value. [S]
  3. **트리플 독점 (Triple Monopoly, 트독)**: own **all cities in 3 different color groups** (out of 8). Instant win, with the reward bonus doubled. [S]
  4. **라인 독점 (Line Monopoly, 라독)**: own **every city on one full side/line** (tourist sites included). Instant win, reward tripled. [S]
  5. (Also) **관광지 독점**: own all tourist sites (6 in the board game, 5 in the mobile game). [S]
- **Warning system**: when only one property is missing to complete a monopoly, the UI shows a warning banner to everyone. This creates table drama and lets opponents block. [S]

### 3.2 Building system [S]
- Buildings: **별장/villa -> 빌딩/building -> 호텔/hotel -> 랜드마크/landmark**.
- **Pacing gate**: on the world map you can build a villa on the first lap, a building on the second lap, and a hotel on the third lap. Each lap around raises the tier you may build by one. [S]
- **Landmark**: needs villa + building + hotel already on the city. Then you either land on the city again, or use a start-square bonus, to build it. Cannot be taken over by opponents. [S]
- **Toll** for a general city = sum of the tolls of the buildings on it. **Owning all cities of a color group doubles tolls** on those cities. [S]
- **Olympics (올림픽)**: the owner of the Olympic space (or the player who lands there) pays a fee to pick a city. That city's toll is **x2**, and repeated Olympics raise it to a max of **x5** (named stages: 엑스포, TV광고, 그랑프리, 페스티벌, 태양의 축복). Beginner channels cap the multiplier at x2, regular channels at x3. Olympic multipliers affect tolls only, not takeover prices. [S]
- **Festival (축제)**: at game start, **three random cities are festival cities** with a permanent x2 toll (online variant). [S]

### 3.3 Takeover (인수) [S]
- Landing on an opponent's city, you may pay to **take it over**. Cost = **2x the current build price** of that city. [S]
- **Blocked** if it has a landmark. [S]
- You can take over all built tiers at once, even if your own lap count has not unlocked them, and may then upgrade to a landmark. [S]
- Effect: no one is ever safe with a good property, which turns the mid-game into a constant tug of war. It is also the main comeback and kingmaking mechanism, since the loser can buy the leader's key city.

### 3.4 Special spaces [S]
- **무인도 (Island)**: landing there means **3 turns stuck**. Escape by rolling doubles, paying an escape fee, or using an escape chance card. When you roll doubles on the island you escape and move that number of spaces, **without an extra roll**. [S]
- **더블 (Doubles)**: after finishing the actions, roll again. **Three doubles in a row -> "double penalty" -> straight to the island.** [S]
- **세계여행 (World Tour)**: stop here, pay a fee, and fly to any city you choose. Used to complete or to block a monopoly. [S]
- **국세청 (Tax Office)**: a tax space. The exact tax rule was not retrievable. Reported in-game as a percentage-of-cash or property style tax. [?]
- **찬스 (Chance) cards**: random effects (move, bonus, penalty, escape card, free build/discount). Specific list not retrievable. [?]
- **Salary (월급)**: paid for passing the start space. Amount was not retrievable; a bonus item exists ("월급보너스"). [S][?]

### 3.5 Characters, items and dice control [S]
- Characters (many, gacha-obtained) with level stats and skills. E.g. bonuses to salary, to toll reduction, or to card outcomes. Skill lists not retrievable in detail. [S]
- Pre-game items ("행운 아이템"): 주사위 더블, 월급 보너스, 홀짝 (odd/even) helpers. [S]
- **Dice control gauge**: the player presses a moving gauge. The result is within **+/-3** of the pressed value, and with a supporting lucky item the result equals the pressed value exactly. [S]

### 3.6 UI/UX patterns (what could be confirmed) [S][K]
Confirmed by summaries: prep screen for item selection, dice-gauge input, warning banners for monopolies. The following are well-known features, listed from the researcher's background knowledge and therefore tagged [K] and not verified in this session:
- Dice roll: tap or hold a gauge, 3D dice tumble, then the token hops space by space with a bounce and a sound tick.
- Camera: follows the moving token, zooms to the destination city on landing, then pulls back. Top-down "map" with a slight tilt.
- Toll/takeover popups: a modal near the bottom shows "toll: X" with a coin-fly animation to the owner. For purchase: a bottom sheet with build options and price, with buttons Buy / Build / Skip / Takeover.
- Turn timer: a circular countdown around the current avatar. When it expires the game acts automatically (skips the build choice, auto-rolls).
- Player HUD: avatars along the edge with cash and rank; colored borders on owned tiles; monopoly indicators.

---

## 4. Side-by-side comparison

| Aspect | Monopoly | 부루마블 | 모두의마블 |
|---|---|---|---|
| Spaces | 40 | 40 | 32 |
| Players | 2-8 | 2-4 | 2-4 (online) |
| Start cash | $1,500 | ~300만 won [?] | not retrieved |
| Salary | $200 | 20만 won | varies (not retrieved) |
| Jail equivalent | Jail, up to 3 turns, $50 | 무인도, 3 turns, doubles/pay/card | 무인도, 3 turns, doubles/pay/card |
| Triple doubles | Jail | (not confirmed) | Island |
| Buy-out | Trade / auction only | Optional buy-out, often 2x house rule | **Takeover at 2x built price**, landmark-proof |
| Buildings | 4 houses + hotel, evenness rule | Villa (x2), building, hotel | Villa, building, hotel, **landmark**, lap-gated |
| Win condition | Last solvent | Last solvent | Bankruptcy, **turn/time limit by assets**, **triple/line/tourist monopoly** |
| Length | 45-180 min | long (1h+) | ~20 min / 35 turns cap |
| Special | Chance/Chest | 황금열쇠, 우주여행, welfare fund | Olympics, World Tour, Tax Office, Festival, dice control |

---

## 5. UX research: single tablet, four players, flat on a table

### 5.1 Findings [S]
- **Forbidden Island** iOS app supports "Pass-and-Play" and **"Tabletop" mode**. The only difference is that for seats on the far side, text is drawn upside down so it faces them. The app highlights the current player's screen sector and their pawn, plus the tiles they can move to. [S]
- The physical **Infinity Game Table** rotates the board to face the active player at each turn transition, and offers privacy via covers and second-screen phones. [S]
- **Jackbox**-style: a shared screen with phones as controllers is the other main pattern. Not applicable here, since the constraint is one tablet. [S]
- Many pass-and-play apps assume one hidden-info viewer at a time (hand-off screens); many tablet board apps assume everyone watches the same board. [S]

### 5.2 Patterns to use for this project [K, design inference]
1. **Public board, private-free rules.** Choose mechanics with no hidden info (no secret hands), so nobody needs a hand-off/blur screen. Then the entire game is "look at the same board".
2. **Per-seat control panels on the four edges.** Each panel rotated to face its seat (0, 90, 180, 270 degrees). Only the active player's panel is bright and interactive. Others are dimmed but readable (cash, owned tiles).
3. **Active-turn spotlight.** Color-coded glow and a large "YOUR TURN" banner on that player's edge. Avoids "whose turn is it?" confusion when the tablet is not being passed.
4. **Shared central board, never rotated.** Rotating the board every turn (Infinity Table style) disorients everybody else. Keep the board static, rotate only text and labels for events (popups can appear twice, once for each opposing side, or as an upright-agnostic icon-first design).
5. **Big touch targets** and a single main action button per panel, because fingers are reaching across a table and tablets are 10-13 inches. Minimum ~56 px targets for far-edge players.
6. **Icon-first, low-text UI** so rotated text is not a barrier. Numbers and icons read from any direction. Keep text short.
7. **Dice as a shared object.** One big "shake/tap to roll" dice zone in the center or in the panel of the active player, with sound. Avoid requiring cross-table reach.
8. **Turn hand-off is a light-touch handshake.** Since the tablet stays put, hand-off = a 1-second banner plus a chime. Optionally require an "I'm ready" tap only for the next player when the previous turn ended with a decision they must not miss.
9. **Anti-mistap guards.** Confirm buttons hold-to-confirm or two-step for irreversible purchases, as elbows and sleeves may touch the glass.
10. **Turn timer** visible on the active edge. Auto-play on expiry so a stalled player does not block three people.
11. **Undo window** of 2-3 seconds for the last purchase.
12. **Palm rejection / edge-safe zones**: keep interactive controls inset from the tablet bezel.

---

## 6. Pacing and game-length research

### 6.1 Targets [S]
- Casual/family games typically target under an hour. Casual party sets target 30-60 minutes. [S]
- Shorter games (15-30 minutes) have fewer decisions per game and burn out a regular group sooner, so replayability must come from variety (random events, different boards). [S]
- Official shortened Monopoly products: Monopoly Deal about 15 minutes (2 players) to 30 (4 players); Monopoly Bid 15-20; Monopoly Madness 5-10 per round. [S]
- Modu Marble's own limits: 20 minutes or 35 turns (one source), asset-based tiebreak. [S]

### 6.2 Pacing tricks catalog
| Trick | Effect | Source |
|---|---|---|
| Always auction declined properties | Land-grab ends fast | [S] |
| No Free Parking jackpot | No stalled middle game | [S] |
| Deal starting properties | Skips slow opening | [K] |
| Speed Die | Faster movement, teleport, guarantees purchases | [S] |
| **Hard turn cap with asset-based winner** | Guaranteed end | [S] (Modu Marble) |
| **Instant-win monopoly conditions** (triple/line) | Threat pressure, ends games early | [S] |
| **Lap-gated building tiers** | Prevents early runaway snowball, gives progression | [S] |
| **Takeover at 2x** | Comeback, keeps trades meaningful | [S] |
| Double salary / salary bonus | More cash flow, faster building, bigger swings | [K] |
| Escalating stakes (Olympic multiplier up to x5) | Late-game decisive swings | [S] |
| Island/jail limited to 3 turns, escape options | Removes worst dead time | [S] |
| End-game trigger by the leader | Incentive to finish | [S] |
| Timer per turn with auto-play | Removes analysis paralysis | [K] |
| No elimination (bankrupt player keeps a role or game ends on first bankruptcy) | Removes bored losers | [K] |
| Catch-up mechanics (cheap early tiers, takeover, comeback cards) | Keeps 2nd-4th place engaged | [S] |

### 6.3 Quantitative pacing model (design inference) [K]
For 20-30 minutes with 4 players: budget roughly 25-35 seconds per player turn (dice and hop animation about 8-10 s, landing resolution and one decision about 10-20 s). A 12-round game is 48 player turns, i.e. about 20-28 minutes. This is in line with Modu Marble's 20-minute / 35-turn cap. A **12-round limit** is a reasonable starting value; measure on a real tablet.

---

## 7. Recommendations for an original game

Goal: a 20-30 minute, 4-player, single-tablet, casual-friendly property-trading game. Original theme, original board, original names and art. Do not reuse Hasbro/Netmarble/Si-Yat-Sa names, layouts, city lists, card texts, or characters.

### 7.1 Combine these mechanics

**Board and flow**
1. **28-32 space loop** (Modu Marble scale). Fewer spaces means more landings per lap and more interaction. Suggested: 28 spaces = 4 corners + 24 others.
2. **Four colored "districts"** of 4-5 properties plus 1-2 "transit" spaces (railroad/tourist style) for a simple set bonus.
3. **Corners**: Start (salary), Timeout Island (3-turn skip, with cheap escape), Teleport (World Tour style: pay to jump anywhere), Jackpot/Festival (Olympic style: pick a property to multiply tolls).
4. **Two dice, doubles roll again, triple doubles go to the island.** Familiar, and gives comedic tension.

**Economy**
5. **Lap-gated building tiers** (Modu Marble): tier 1 on lap 1, tier 2 on lap 2, tier 3 (landmark-style) on lap 3. Slows early snowballing and gives a visible arc.
6. **Simple three-level upgrade** (small / medium / landmark), no house/hotel counts, no even-building rule. Toll = sum of upgrade levels. Keep 6 numbers per property, not 22 rent tables.
7. **Color-set bonus x2** (Modu Marble), plus a **warning banner** when a player is one property from a set.
8. **Takeover at 2x built price, landmark-proof** (Modu Marble). This is the fun engine: it makes every landing a decision and provides catch-up. Cap: only one takeover per turn, and a just-taken property cannot be retaken for one round.
9. **No auctions, no trading, no mortgages.** These are the main time sinks and are awkward on one shared tablet. Replace auctions with "buy at list price or it stays open".
10. **Olympic/Festival multiplier** on a chosen property (x2 up to x3-x5), applied to tolls only.

**Winning and pacing**
11. **Round cap of about 12 rounds**, winner by **total assets** (cash + property values). Show a live "assets leaderboard" so the endgame is legible.
12. **Instant-win conditions**: a **triple color set** or a **full side ("line")**, with the one-away warning banner. Gives a dramatic early finish and an active reason to block.
13. **No elimination.** If a player cannot pay, they sell upgrades and properties to the bank at half price, and if still short they pay all they have and stay in the game at zero. (Alternatively: the first bankruptcy ends the game and assets decide.) Keeps four players engaged to the end.
14. **Salary bump**: salary large relative to prices (approx 15-20% of an average property price), so cash does not run out before the lap-gated tiers open.
15. **Expensive final space with a story** (the Seoul/Boardwalk effect) but **capped** to avoid the "instant winner" flaw: e.g. toll is high but no more than about 60% of the average starting cash.

**Chance and surprise**
16. **One "surprise card" deck** (Golden Key style): 12-16 cards, mostly positive or lightly humorous, a few dramatic swaps (e.g. "swap one upgrade", "free teleport", "escape pass"). Include a **leader-tax** card (the richest player pays the poorest) as a cheap catch-up.
17. **A tax space** (Tax Office): a small percentage, so it is not a game-ender.

**Optional flavor**
18. **Character-flavored passive** (very light): 4 selectable characters with one tiny passive each (e.g. +10% salary, 1 free escape, -1 toll once per lap). Original names and art. Do not add gacha or levels.
19. **Dice "power gauge"** (tap to stop a moving bar) as a purely optional skill flourish that biases the result by +/-1-2, not full control.

### 7.2 Tablet UX must-haves
- Four rotated player panels (one per edge) with active-turn spotlight, the board static in the center, and icon-first labels. [Section 5]
- No hidden information at all, so no hand-off blur screens.
- Big dice, auto-play timer of about 20-30 s, hold-to-confirm for purchases, short undo window, and audible tick per space hopped.
- Toll and takeover popups near the affected player's edge, plus a short generic center toast readable from any side.
- Pre-game screen: pick color/character, pick round limit (8 / 12 / 16), then a start button.

### 7.3 Things to avoid
- Long trading phases; elimination; mortgage systems; even-building rules; 22-line rent tables; per-seat privacy screens; anything that needs text to be read upside down; mechanics that require reaching across the tablet.
- Copying protected content (Hasbro's Monopoly trade dress, board names, cards; Netmarble characters and UI; Si-Yat-Sa layout and card wording). Mechanics such as "lap-gated upgrades", "takeover at 2x", "round cap" are not protected, but names, art and card text are.

### 7.4 Open questions for the next research step
- Exact Blue Marble price/toll table and card list (requires namu.wiki or the physical rule sheet).
- Exact Modu Marble salary, tax-office rate, chance-card list and toll tables (requires namu.wiki / Netmarble guide).
- Playtest timing: measure seconds per turn on a real tablet to set the round cap.

---

## 8. Sources

Search-result sources (search summaries used; the pages themselves were not fetched because WebFetch was blocked):

Monopoly
- https://monopoly.fandom.com/wiki/Official_Rules
- https://monopoly.fandom.com/wiki/Monopoly_Rules
- https://monopoly.fandom.com/wiki/House_Rules
- https://monopoly.fandom.com/wiki/Speed_Die
- https://monopoly.fandom.com/wiki/Hotels
- https://monopoly.fandom.com/wiki/Mediterranean_Avenue
- https://monopoly.fandom.com/wiki/Boardwalk
- https://officialgamerules.org/game-rules/monopoly/
- https://www.geekyhobbies.com/monopoly-rules/
- https://diceanddeeds.com/monopoly/
- https://diceanddeeds.com/monopoly-rules-jail/
- https://diceanddeeds.com/monopoly-property-colors-guide/
- https://www.monopolyland.com/monopoly-properties-list-with-prices/
- https://www.monopolyland.com/list-monopoly-chance-community-chest-cards/
- https://www.monopolyland.com/how-long-does-monopoly-take/
- https://www.monopolyland.com/how-to-play-monopoly-faster/
- https://www.monopolyland.com/monopoly-card-games/
- https://www.falstad.com/monopoly.html
- https://www.jdawiseman.com/papers/trivia/monopoly-rents.html
- https://www.hasbro.com/common/instruct/00009.pdf
- https://en.wikibooks.org/wiki/Monopoly/House_Rules
- https://en.wikibooks.org/wiki/Monopoly/The_Speed_Die
- https://www.belloflostsouls.net/2024/04/monopoly-is-pretty-short-to-play-if-you-actually-play-by-the-rules.html
- https://www.fairgamestore.com/blogs/articles/learn-how-to-play-monopoly-in-under-an-hour/
- https://en.wikipedia.org/wiki/Monopoly_Deal
- https://en.wikipedia.org/wiki/Monopoly_Junior
- https://en.wikipedia.org/wiki/Monopoly:_The_Mega_Edition
- https://defector.com/monopoly-chance-and-community-chest-cards-ranked
- https://thethoughtfulgamer.com/2017/03/28/catch-up-mechanisms/
- https://www.buzzfeed.com/tomchivers/monopoly-sucks
- https://boardgamegeek.com/blog/11772/blogpost/146023/thoughts-on-the-runaway-leader-problem

부루마블 / Blue Marble
- https://en.wikipedia.org/wiki/Blue_Marble_Game
- https://boardgamegeek.com/boardgame/10506/blue-marble
- https://boardgameguys.com/blue-marble-game/
- https://namu.wiki/w/%EB%B6%80%EB%A3%A8%EB%A7%88%EB%B6%88
- https://namu.wiki/w/%EB%B6%80%EB%A3%A8%EB%A7%88%EB%B6%88/%EA%B2%8C%EC%9E%84%20%EB%B0%A9%EB%B2%95
- https://namu.wiki/w/%EB%B6%80%EB%A3%A8%EB%A7%88%EB%B6%88/%EC%A3%BC%EC%9A%94%20%EC%B9%B4%EB%93%9C
- https://namu.wiki/w/%EB%B6%80%EB%A3%A8%EB%A7%88%EB%B6%88/%EC%8B%9C%EB%A6%AC%EC%A6%88
- https://thewiki.kr/w/%EB%B6%80%EB%A3%A8%EB%A7%88%EB%B6%88%2F%EA%B2%8C%EC%9E%84%20%EB%B0%A9%EB%B2%95
- https://ko.wikipedia.org/wiki/%EB%B6%80%EB%A3%A8%EB%A7%88%EB%B6%88
- https://www.wingboardgame.com/2022/01/blog-post_28.html
- https://gogreenandred.com/%EB%B6%80%EB%A3%A8%EB%A7%88%EB%B8%94%EB%B3%B4%EB%93%9C%EA%B2%8C%EC%9E%84-%ED%95%98%EB%8A%94-%EB%B2%95%EA%B7%9C%EC%B9%99-%EC%84%A4%EB%AA%85%EC%84%9C/
- https://medium.com/michinsaekgi/%EB%B6%80%EB%A3%A8%EB%A7%88%EB%B8%94-%EA%B2%8C%EC%9E%84-%EC%86%8D-%EB%8F%84%EC%8B%9C%EB%93%A4%EC%9D%80-%EC%A7%84%ED%99%94%ED%95%9C%EB%8B%A4-32866ffec8c2

모두의마블 / Modu Marble
- https://modoo.netmarble.net/guide/Contents.asp?depth1=324&depth2=1501&depth3=3079&id=gmm&title=
- https://namu.wiki/w/%EB%AA%A8%EB%91%90%EC%9D%98%EB%A7%88%EB%B8%94%20for%20kakao/%EA%B7%9C%EC%B9%99
- https://namu.wiki/w/%EB%AA%A8%EB%91%90%EC%9D%98%EB%A7%88%EB%B8%94%20%EC%98%A8%EB%9D%BC%EC%9D%B8/%EA%B7%9C%EC%B9%99
- https://thewiki.kr/w/%EB%AA%A8%EB%91%90%EC%9D%98%EB%A7%88%EB%B8%94/%EC%84%B8%EB%B6%80%EC%A0%81%EC%9D%B8%20%EB%A3%B0
- https://boardlife.co.kr/bbs_detail.php?tb=board_community&bbs_num=47374
- https://www.wingboardgame.com/2023/01/blog-post_18.html
- https://namu.wiki/w/%EB%AA%A8%EB%91%90%EC%9D%98%EB%A7%88%EB%B8%94%20for%20kakao/%ED%96%89%EC%9A%B4%EC%95%84%EC%9D%B4%ED%85%9C/%EC%A3%BC%EC%82%AC%EC%9C%84%20%EC%BB%A8%ED%8A%B8%EB%A1%A4%20%EA%B4%80%EB%A0%A8
- https://namu.wiki/w/%EB%AA%A8%EB%91%90%EC%9D%98%EB%A7%88%EB%B8%94%20for%20kakao/%EC%BA%90%EB%A6%AD%ED%84%B0%20%EB%8A%A5%EB%A0%A5%EC%B9%98
- https://playentry.org/project/66dc497752c1c7ed52a5acfa (a fan-made toll/build-cost calculator, useful as a numeric reference)
- https://wiki.gamess.co.kr/index.php/%EB%AA%A8%EB%91%90%EC%9D%98_%EB%A7%88%EB%B8%94

Tablet UX and pacing
- https://apps.apple.com/in/app/forbidden-island/id427419772
- https://forbidden-island-series.fandom.com/wiki/Forbidden_Island_App
- https://geekdad.com/2011/11/forbidden-island-ipad/
- https://gizmodo.com/this-touchscreen-digital-board-game-table-is-rage-flip-1845357668
- https://geekdad.com/2022/12/blur-the-line-between-video-games-and-board-games-with-the-infinity-game-table/
- https://en.wikipedia.org/wiki/Digital_tabletop_game
- https://gamedesigning.org/gaming/pass-and-play-games/
- https://www.gamesprecipice.com/game-length-time-value/
- https://www.gamesprecipice.com/endings/
- https://boardgamegeek.com/blogpost/30453/game-length-maximizing-time-value-game-design
- https://brandonthegamedev.com/board-game-pacing-keeping-your-game-interesting/
- https://streamlinedgaming.com/how-long-should-i-make-my-board-game/
