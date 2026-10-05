# GAME DESIGN DOCUMENT — **MONEY POLY (머니폴리)**

> The project owner renamed the game Money Poly (머니폴리) on 2026-10-05 (previously Land Poly, chosen 2026-10-03). The existing Android app ID remains
> `com.bigssu.lotandroll` so installed games and saves retain their identity. Name and supplied
> launcher-art rights still need clearance before a store release.

> Status: v1 game rules and content specification. Root [`DESIGN.md`](../DESIGN.md) governs current
> UI/UX, accessibility, and responsive decisions. When either document conflicts with verified
> implementation, update the relevant contract and explain the change in the commit.

## 0. One-paragraph pitch

A fast (20–30 min), gorgeous, **pass-and-play** property-trading board game for **one tablet lying
flat on a table with 2–4 people sitting around it**. Original rules in the roll-and-move /
buy-and-build genre (Monopoly, 부루마블, 모두의마블 are inspirations, not sources). Everything on the
screen that matters to the *current* player is **rotated to face that player's edge of the
table**. In-game visuals are hand-authored SVG/CSS; the launcher image was supplied by the owner
with store rights still to verify. Audio is synthesized with Web Audio. Ships to Android through
Capacitor; also runs in any modern browser.

## 1. Hard constraints (non-negotiable)

| # | Constraint |
|---|-----------|
| C1 | Keep in-game names and art independent of Monopoly / 부루마블 / 모두의마블 (see `docs/research/02-ip-licensing-research.md`). The supplied launcher image now shows a traveler and an arrow-only start space, but its source rights and overall resemblance still need review before store submission. |
| C2 | 100% offline. No network calls, no analytics, no ads, no accounts. |
| C3 | Single device, landscape only, tablet-first (primary target 10–13" Android tablets, 4:3 to 16:10). Must still be usable on a 7" tablet and a phone in landscape (min 640×360 CSS px). |
| C4 | In-game art = inline SVG / CSS authored in this repo. The 256px launcher bitmap is owner-supplied with rights pending verification. Fonts = SIL OFL fonts vendored in `public/fonts`. Audio = synthesized at runtime. |
| C5 | Korean is the primary UI language, English is the second. All user-facing strings go through i18n (`src/i18n`). |
| C6 | Deterministic engine: `reduce(state, action, rng)` is pure. Same seed ⇒ same game. |
| C7 | Entry-level Android tablets: default 30 fps battery saver and low FX quality; optional 60 fps when battery saver is disabled. Game atlases ≤1024px POT, text-bearing board ≤2048px POT. Use CSS transforms/opacity, no layout thrash, no per-frame DOM creation. |

## 2. Table-top UX model (the most important section)

### 2.1 Seats

The screen is a table. There are four **seats**: `S` (bottom, "normal" orientation), `E` (right),
`N` (top), `W` (left). Each player is assigned a seat during setup (default: P1→S, P2→E, P3→N,
P4→W; 2 players → S/N; 3 players → S/E/W). AI players sit too (their panel shows "AI").
Setup exposes **Add AI player**, which fills the first free seat with normal AI, up to four players.
The seat editor switches between Human, AI Easy, and AI Normal.

Every seat has a **player panel** on its edge, **rotated to face the seat**:

* `S` panel: `rotate(0deg)` – bottom strip
* `N` panel: `rotate(180deg)` – top strip
* `E` panel: `rotate(-90deg)` – right column
* `W` panel: `rotate(90deg)` – left column

Panel contents (always visible): avatar token + name, cash (big, animated count-up/down), owned
property chips in group colors with building pips, status badges (섬/island turns, cards held),
a subtle "your turn" glow ring.

### 2.2 The Stage

The board occupies the center square. The board's **inner area** (inside the ring of spaces) is
the **Stage**. The Stage rotates (CSS transform, animated 400 ms) to face the seat of the player
who must act. Everything interactive lives on the Stage: the dice, the "굴리기/Roll" button, the
buy/build/takeover decision cards, card draws, the island escape choice, the festival target
picker, the travel destination prompt, the pay/sell flow, the turn banner.

Rule: **a player never has to read upside-down text to take their turn**. Non-acting players
only need to *notice* things (their own coin pile at their seat edge in a money cut-in, token animation on the board,
color flashes), and those are orientation-free (numbers/icons on their rotated panel).

The board ring itself does not rotate (tokens would be disorienting); space labels are short and
each space has a big landmark icon + color bar so it's readable from any side. City names are
also drawn *twice* on the two sides of the board that face away (small mirrored labels are
NOT required in v1 — keep it simple: names on spaces are oriented toward the outside edge of
each side, like a physical board).

### 2.3 Turn flow (state machine, see §5)

```
TurnStart ─► (island? ► IslandChoice) ─► Roll ─► MoveAnim ─► Land resolution
   ├─ Unowned property  ► BuyPrompt (buy / pass)   [auction is OFF by default; setting]
   ├─ Own property      ► BuildPrompt (upgrade one level / pass)
   ├─ Opponent property ► PayToll ► (TakeoverPrompt if allowed)
   ├─ Hub (여행 허브)     ► buy / pay hub toll
   ├─ Event card         ► CardReveal ► apply
   ├─ Tax               ► pay
   ├─ Donation          ► pay into pot
   ├─ Island            ► stuck
   ├─ Festival          ► pick one own city
   ├─ WorldTour         ► next turn: choose destination
   └─ Start             ► bonus
 ─► (doubles && !island) ► Roll again (max 3; 3rd doubles ► Island)
 ─► TurnEnd ► next player (skip bankrupt) ► check victory ► TurnStart
```

Every prompt has a **15-second soft timer** (setting: off/15/30 s) that auto-picks the safe default
(pass) so a distracted table keeps moving. CPU turns auto-play with short delays so humans can
follow. Every CPU decision is shown being made: a hand (white glove, cuff in the CPU's color)
reaches in from the CPU's seat edge, presses the control it chose — the prompt button (roll, buy,
pass, build, bail, sell, bid…) or, for board picks (travel, festival, free upgrade, typhoon
target, build-anywhere), the board space — and the action is dispatched at the release
(`src/ui/stage/CpuHand.ts`; mapping in `handTarget.ts`; timings `HAND` in `src/ui/fx/motion.ts`).

### 2.4 Feel

* Dice: two big dice on the Stage; tap-and-hold shakes them (haptic ticks), release rolls with a
  CSS 3D tumble (≈900 ms), result pips snap, doubles get a golden flash + "더블!" burst.
* Token movement: hop space-to-space (~180 ms/space, ease-out with squash & stretch), passing Start
  triggers the salary cut-in (coins fountain from the bank into that player's pile).
* Money (docs/MONEY-EVENTS.md §11): every purchase, payment and income is a full-screen cut-in —
  the hero (lot, building, city card, vault, bank) big in the middle, each party's gold/silver/
  bronze pile at its own seat edge, coins flying seat to seat (via the centre when collecting from
  everyone), the amount on a plaque facing the acting seat. Panel numbers tween and flash green/red
  when the cut-in hands back.
* Buildings: pop-in with bounce; landmark gets a sparkle loop.
* Takeover: short screen shake + stamp animation "인수!".
* Bankruptcy: panel desaturates + broken-piggy icon.
* Victory: confetti (CSS particles), winner's seat rotation, final asset bars.
* Haptics (Capacitor Haptics / `navigator.vibrate`): light tick per space hop, medium on toll,
  heavy on takeover/bankrupt.
* "One away" banner: when a player becomes one city short of a color group / line / hub set, a
  short toast on the board edge facing everyone (icon + color, no long text) warns the table.
* Live assets leaderboard: each panel shows total assets (small) next to cash; the Stage shows a
  compact ranking strip during the last 3 rounds.
* Sound (Web Audio, synthesized): dice shake (noise bursts), hop (short pitched blip that rises
  per hop), cash (coin ping arpeggio), buy (major chord), pay (descending), card flip (sweep),
  island (foghorn), festival (fanfare), win (arpeggio + shimmer). Master mute + volume in settings.

### 2.5 Screens

1. **Title** — logo, "새 게임", "이어하기"(if save exists), "게임 방법", "설정".
2. **Setup** — 2–4 player slots around a mini table preview; each slot: name (default 플레이어 1…),
   token (12 SVG tokens: 🚗-like car, rocket, cat, robot, crown, star, ufo, dino, whale, boot,
   camera, teapot — all our own SVG), color (8 palette), seat (drag or tap-cycle), human/CPU
   (CPU difficulty: easy/normal). Game options: round limit (10/15/20/30/∞ rounds, default 15), starting cash
   (2,000/3,000/5,000), takeover on/off, auction on/off, prompt timer.
3. **Game** — board + panels + stage + top-left small "≡" menu (rules, settings, save & quit).
4. **Rules** — illustrated, swipeable pages.
5. **Result** — ranking, asset breakdown bars, "다시 하기"/"타이틀로".

## 3. Board content (default 32 spaces, index 0 = Start, clockwise)

Setup selects **7, 8, or 9 non-corner spaces per side** (`settings.spacesPerSide`), producing 32, 36, or 40 total spaces.
The table below defines the unchanged seven-space default. Eight/nine insert one/two cities per side from `EXTRA_CITIES` in
`src/content/board.ts`, giving 19/23/27 cities. Existing SVG artwork is reused; no additional texture files are required.
`getBoard()` and `getBoardInfo()` supply each game's content, corners, groups, and bounds; `getBoardGeometry()` supplies both
the Setup preview and playable board. Card destinations, AI, movement, travel, and victory checks use that game profile.
The 3200-unit SVG canvas and CSS `board / 32` sizing unit remain unchanged.
Visually, the board is a navy/teal travel-map ring: four special stops are circular waypoints,
ordinary destinations are separate rounded cards, and group/owner colors appear as small badges
and seals rather than continuous property bands. Corner indices and cell centers remain unchanged;
visible circular corners use matching circular hit regions. These changes reduce specific visual similarities;
they do not establish legal clearance for a store release.

The option is optional in save version 1: an absent value means 7. Saves preserve their board size; unsupported values or
board-index/array mismatches are rejected. Immutable board profiles permit different-sized simulations to run independently.

Corners at 0, 8, 16, 24. Seven color groups (20 cities) + 4 hubs + 3 event + 1 tax + 1 donation.
Currency unit: `만` (displayed `1,500만`, engine uses integers).

| idx | type | name (ko / en) | group | price | notes |
|----:|------|----------------|-------|------:|-------|
| 0 | start | 출발 / START | | | +300 salary when passing, +pot when landing exactly |
| 1 | city | 마닐라 / Manila | G1 brown | 100 | |
| 2 | city | 하노이 / Hanoi | G1 brown | 120 | |
| 3 | event | 이벤트 / EVENT | | | draw card |
| 4 | city | 카이로 / Cairo | G2 sky | 160 | |
| 5 | hub | 크루즈 항구 / Cruise Port | HUB | 250 | |
| 6 | city | 나이로비 / Nairobi | G2 sky | 180 | |
| 7 | city | 케이프타운 / Cape Town | G2 sky | 200 | |
| 8 | island | 무인도 / ISLAND | | | stuck up to 3 turns |
| 9 | city | 리마 / Lima | G3 pink | 240 | |
| 10 | city | 멕시코시티 / Mexico City | G3 pink | 260 | |
| 11 | donation | 기부함 / DONATION | | | pay 100 to pot |
| 12 | city | 부에노스아이레스 / Buenos Aires | G3 pink | 280 | |
| 13 | hub | 국제공항 / Intl Airport | HUB | 250 | |
| 14 | city | 이스탄불 / Istanbul | G4 orange | 320 | |
| 15 | city | 아테네 / Athens | G4 orange | 340 | |
| 16 | festival | 축제 / FESTIVAL | | | pick own city: toll ×2 (moves marker) |
| 17 | city | 마드리드 / Madrid | G4 orange | 360 | |
| 18 | event | 이벤트 / EVENT | | | |
| 19 | city | 베를린 / Berlin | G5 red | 420 | |
| 20 | city | 로마 / Rome | G5 red | 440 | |
| 21 | hub | 고속열차역 / Express Rail | HUB | 250 | |
| 22 | city | 런던 / London | G5 red | 480 | |
| 23 | tax | 세무서 / TAX OFFICE | | | pay 10% of cash (rounded to 10) |
| 24 | travel | 자유여행 / TRAVEL | | | next turn choose any destination |
| 25 | city | 두바이 / Dubai | G6 yellow | 540 | |
| 26 | city | 싱가포르 / Singapore | G6 yellow | 560 | |
| 27 | event | 이벤트 / EVENT | | | |
| 28 | city | 도쿄 / Tokyo | G6 yellow | 600 | |
| 29 | hub | 우주정거장 / Space Station | HUB | 250 | |
| 30 | city | 뉴욕 / New York | G7 blue | 800 | |
| 31 | city | 서울 / Seoul | G7 blue | 1000 | |

Sides for **line monopoly**: side A = idx 1–7, side B = 9–15, side C = 17–23, side D = 25–31
(cities only count; hubs/events on the side are ignored).

Group colors (design tokens): brown `#A0715B`, sky `#6EC1E4`, pink `#F28AB2`, orange `#F5A25D`,
red `#E8564F`, yellow `#F2C94C`, blue `#4A6CF7`. Hub color: slate `#7B8AA3`.

Landmark icon per city (all original flat SVG, 64×64 viewBox): Manila (jeepney), Hanoi (lantern),
Cairo (pyramid), Nairobi (giraffe/acacia), Cape Town (table mountain), Lima (llama), Mexico City
(pyramid step temple), Buenos Aires (tango/obelisk), Istanbul (mosque domes), Athens (columns),
Madrid (bull/windmill), Berlin (gate), Rome (colosseum), London (clock tower), Dubai (tall spire),
Singapore (merlion-like fountain → use "lion fountain" generic), Tokyo (torii/tower), New York
(statue torch/skyline), Seoul (hanok gate/tower), hubs (ship, plane, train, rocket), corners
(flag, palm island, fireworks, globe-with-ticket), event (star/gift), tax (stamp), donation (heart box).

## 4. Economy & rules (exact numbers)

* Start cash: 3,000 (options 2,000 / 3,000 / 5,000). Salary passing Start: +300. Landing exactly
  on Start: +300 salary **plus** the donation pot.
* City toll by level (of price `P`, rounded to nearest 10):
  * L0 land: `0.10P` (×2 if owner holds the complete color group)
  * L1 별장/villa: `0.35P`
  * L2 빌딩/building: `0.90P`
  * L3 호텔/hotel: `1.60P`
  * L4 명소/landmark (engine id `landmark`; Korean UI label is 명소, never 랜드마크): `3.00P`
  * Festival marker on that city: toll ×2 (applies on top of everything; cap ×2 — only one
    festival marker exists on the board at a time).
* Build cost (per level, paid when upgrading, one level per landing/visit; owner may only build
  when landing on their own city — like 모두의마블 — no remote building; setting `buildAnywhere`
  off by default): L1 `0.50P`, L2 `0.60P`, L3 `0.70P`, L4 landmark `1.00P`. Landmark requires L3.
* Property value (for asset ranking / takeover) = `P + Σ build costs paid`.
* **Takeover (인수)**: after paying toll on an opponent's city that is **not** a landmark, the
  visitor may buy it for `2 × property value` (goes to the owner). Buildings stay. Setting on by
  default.
* Hubs: price 250 each, no buildings, toll = `100 × (number of hubs the owner holds)` ⇒
  100/200/300/400. Takeover allowed at `2 × 250`.
* Tax office: pay `10%` of current cash (rounded to 10, min 0) to the pot.
* Donation box: pay `100` to the pot (or all cash if less).
* Island: stay up to 3 turns; each turn choose: roll (escape on doubles), pay 200 bail (then roll),
  or use an 탈출권 card. After 3 failed turns you leave automatically (no fee) on the 4th turn.
  Landing on the island by 3 consecutive doubles or by card = same.
* Festival: choose one own city; the festival marker moves there (toll ×2). If no own city, nothing.
* Travel (자유여행): on your **next** turn, instead of rolling, pick any space (except Island) and move
  there directly (passing Start pays salary as normal, landing resolves normally). Can decline.
* Doubles: roll again after resolving. Third consecutive doubles ⇒ go to Island immediately
  (no move). Doubles do not grant another roll while escaping Island.
* Paying more than you have: you must **sell** (buildings at 50% of build cost, land at 50% of
  price; landmark city sells as a whole at 50% of value) via the sell modal until you can pay. If
  total sellable + cash < debt ⇒ **bankrupt**: all your properties go to the creditor (if the
  creditor is a player) or to the bank (unowned again), you leave the game.
* Auction (setting, off by default): if a player declines to buy an unowned city, an auction
  among remaining players starts at 50% of price, +10% bids, 10 s timer each.
* **Victory conditions** (checked after every action):
  1. Last solvent player standing.
  2. 트리플 독점 (Triple monopoly): own 3 complete color groups.
  3. 라인 독점 (Line monopoly): own every city on one side of the board.
  4. 허브 독점 (Hub monopoly): own all 4 hubs.
  5. Round limit reached (default 15 rounds; a round = every solvent player has taken a turn):
     highest total assets (cash + property values) wins; tie → more cash → more cities → earlier seat.
* Events (`src/content/cards.ts`, 24 cards, uniformly random with replacement):
  1. 출발지로 이동 (+300) 2. 무인도로 이동 3. 자유여행으로 이동 (get travel next turn)
  4. 축제로 이동 5. 은행 배당 +200 6. 복권 당첨 +500 7. 벌금 −150 8. 건물 수리비: 각 건물 레벨당 −30
  9. 생일: 모든 플레이어에게 100씩 받기 10. 기부: 모든 플레이어에게 50씩 주기
  11. 3칸 뒤로 12. 가장 가까운 허브로 이동 (buy or pay double toll)
  13. 탈출권 (keep) 14. 통행료 면제권 (keep; auto-used on next toll)
  15. 수호 방패 (keep; block one takeover attempt on your property)
  16. 복지기금 지급: receive the pot 17. 급행: 다음 턴 주사위 2배 (move double)
  18. 랜덤 점프: 무작위 도시로 이동 19. 세금 환급 +100 20. 부자세: 현재 총자산 1위 플레이어가 최하위 플레이어에게 200 지급 (drawer irrelevant; no-op if tie/2 players same)
  21. 건물 보너스: 모든 자기 도시 +? → replaced by: 보유 도시 1곳 무료 1레벨 업그레이드 (choose)
  22. 태풍: 무작위 상대 도시 1곳 건물 1레벨 다운 (landmark immune)
  23. 축제 초대: festival marker moves to a random own city (no-op if none)
  24. 세계 일주 완료 보너스: +100 × number of hubs you own

### 4.1 Accepted deviations after balancing (see `docs/BALANCE.md`)

* City toll rates are **0.10 / 1.00 / 2.00 / 3.00 / 4.00 × P** for L0–L4 (not the §4 draft numbers).
* `endOnFirstBankruptcy` (default **on**): the first bankruptcy ends the game; richest solvent player
  wins (victory kind `bankruptcy`). Off = classic elimination.
* `buildOnPurchase`: the first level may be built on the same visit as the purchase; one level per visit.
* The board has **19** cities (G2 has 3, G1/G7 have 2, others 3) — the §3 table is authoritative.
* The seat that starts is randomized by the UI (P1 has a measurable advantage in simulation).

## 5. Engine architecture (`src/engine`)

* `types.ts` — `GameState`, `Player`, `Space`, `Property`, `Phase` (discriminated union),
  `Action`, `GameEvent`, `Settings`.
* `board.ts` — space table (from `src/content/board.ts`), helpers (`groupOf`, `sideOf`, `distance`).
* `rng.ts` — seeded PRNG (mulberry32), `rollDice(rng)`.
* `reducer.ts` — `reduce(state, action): { state, events }`. Pure. Throws on illegal actions.
  `phase` tells the UI which prompt to show; `legalActions(state)` enumerates choices.
* `rules.ts` — toll/price/value/victory helpers.
* `ai.ts` — `chooseAction(state, playerId, rng): Action` heuristic CPU (buy if cash after ≥ 1.5×
  average toll exposure, prioritize completing groups, take over when it completes a group or
  blocks an opponent's group, build when cash ≥ 2× cost, sell cheapest first, bail if cash ≥ 800).
* `save.ts` — serialize/deserialize (versioned JSON).
* `sim.ts` — `simulateGame(settings, seed)` for balancing (used by `scripts/balance.ts`).

Events (`GameEvent`) drive the UI animation queue: `DiceRolled`, `TokenMoved` (path of indexes),
`PassedStart`, `MoneyChanged{playerId, delta, reason}`, `PropertyBought`, `Built`, `TollPaid`,
`TakenOver`, `CardDrawn`, `SentToIsland`, `Escaped`, `FestivalSet`, `TravelGranted`, `Bankrupt`,
`GameOver`, `TurnStarted`, `PromptOpened{phase}` etc. The UI must render *any* state statelessly
(for resume) and additionally animate events as they arrive.

## 6. UI architecture (`src/ui`)

Vanilla TypeScript + DOM/SVG, no framework (bundle small, full control over animations). A tiny
`store.ts` (state + subscribe). Structure:

```
src/
  main.ts                 boot, screen router, Capacitor init (orientation lock, fullscreen)
  engine/                 (pure, tested)
  content/                board.ts cards.ts tokens.ts icons/*.ts (SVG strings)
  i18n/                   ko.ts en.ts index.ts (t('key', params))
  ui/
    screens/  Title.ts Setup.ts Game.ts Rules.ts Result.ts
    board/    Board.ts (SVG ring, 32 spaces, ownership bars, buildings, tokens layer)
    stage/    Stage.ts (rotating center), Dice.ts, prompts/*.ts (Buy, Build, Toll, Takeover,
              Card, Island, Festival, Tour, Sell, Auction, TurnBanner)
    panels/   PlayerPanel.ts
    fx/       animate.ts (event → promise-based animation sequencer), particles.ts, floats.ts
    audio/    sfx.ts (WebAudio synth), haptics.ts
    settings/ settings.ts (localStorage)
  styles/    tokens.css base.css board.css stage.css panels.css screens.css
```

Layout math (`ui/layout.ts`): given viewport `W×H` (landscape), `board = min(H − 2·panelN, W − 2·panelEW)`
where `panelN/S` strips are `clamp(72px, 9vh, 120px)` tall and `panelE/W` columns are
`clamp(140px, 18vw, 260px)` wide; board is centered; everything scales with CSS custom property
`--u` (1/32 of board size) so text/icons scale with the board.

Chips: every pill label is `.chip` (base.css) with a `tone-neutral|gold|good|bad|info` color from the
`--tone-*` tokens (each ink ≥ 4.5:1 on its bg, guarded by `src/styles/__tests__/tokens.test.ts`) and an
optional variant: `is-toggle` (`toggleChip()`, `aria-pressed`), `is-player` (turn order), `is-card`
(held card). Status chips come from `chip()` in `ui/game/util.ts`; pass `label` when the visible text
alone doesn't say what the chip means (icon-only, a bare count). Geometry is em-based: the host sets
`font-size` (`.stage .chip`, `.pp-badges .chip`). Square group tiles on the Stage are `.gtile`, not chips.

## 7. Android packaging

* Capacitor (`android/` generated by `npx cap add android`, committed). App id
  `com.bigssu.lotandroll`, name "Money Poly" (ko: "머니폴리").
* `screenOrientation="sensorLandscape"`, immersive sticky fullscreen, keep-screen-on during play,
  hardware back = open menu (not exit) during game.
* `.github/workflows/android.yml`: on push → `npm ci && npm test && npm run build && npx cap sync
  && ./gradlew assembleDebug bundleRelease` (release signed only when secrets exist) and upload
  artifacts. Ubuntu runners have the Android SDK preinstalled.
* Play-ready docs: `docs/RELEASE.md` (keystore, versioning, Play Console listing text, data safety
  answers = no data collected, privacy policy text).

## 8. Quality bar / Definition of Done

* `npm test` (vitest) green, engine coverage of every rule in §4 (including victory conditions,
  bankruptcy cascade, island 3-turn rule, festival stacking cap, takeover blocks on landmark).
* `npm run sim` prints average rounds / bankruptcy rate for 4 CPU players over 500 seeds; with the
  default 15-round cap, ≥ 35% of games must end *before* the cap (monopoly/bankruptcy) and < 5% may
  have a bankruptcy before round 5. Rationale: ~30 s per human turn × 4 players × 15 rounds ≈ 30 min.
* `npm run e2e` (Playwright, Chromium at 1600×1000 and 2560×1600 and 1024×768 and 800×450):
  screenshots of Title, Setup, Game (mid-game seeded), Result stored in `e2e/__screenshots__/`;
  a full CPU-only game finishes without errors (seeded).
* `npm run build` produces `dist/` < 2 MB (fonts excluded), no console errors.
* Lighthouse-ish sanity: no layout shift on rotation; text ≥ 12 px on 800×450.
