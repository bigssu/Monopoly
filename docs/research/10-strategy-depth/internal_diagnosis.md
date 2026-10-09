# Internal diagnosis: Money Poly (머니폴리) rules v2, normal level, default table (2p = 1 human + 1 CPU normal, 30 rounds, 30 s timer, 32 spaces)

Scope and method. Read-only on the game. Everything below comes from the repo source/docs (cited by path) or from runs I executed on 2026-10-08 in the repo (cited as "Run: ..." with the command and seed count). The throwaway scripts behind the scratch runs (`skill.ts`, `diag/{mc,wins,comeback,money}.ts`) imported the engine unchanged. Unless noted: rules `normal`, `rulesVersion 2`, 30 rounds, start cash 3,000, seeds 1..N, CPU normal. The `npm run fun` and `npm run sim` outputs reproduce the tables in `docs/BALANCE.md` exactly for the same seeds (the engine is deterministic), so those doc numbers can be quoted as verified.

Run log (all succeeded unless stated):
- `npm run fun -- --help` — there is no help handler (added since); the flag is ignored and it starts the full default sweep (400 seeds x 9 configs). I killed it after 15 s. Flags are documented only in the header comment of `scripts/fun.ts` (`--seeds --rounds --players --rules --detail --mixed --rules-version --from`).
- `npm run fun -- --seeds 1000 --rules normal --detail` (2/3/4 players, v2) and the same with `--rules-version 1`; `npm run fun -- --seeds 1000 --rules easy --players 2 --detail`.
- `npm run sim -- --players 2 --rounds 30 --seeds 1000` (+ `--rules-version 1`), `--players 3 --rounds 30 --seeds 1000`, `--players 4 --rounds 30 --seeds 1000`, and the default `npm run sim -- --seeds 500` (4p, 15 rounds).
- Those scratch scripts have since been folded into `scripts/skill.ts`; the runs below are reproduced with `npm run skill -- matchups|table|expert` (`luck` and the `diag/*` counts → `table`, `diag/mc.ts expert` → `expert`; `gauge` and `diag/mc.ts impact` were not kept).
- Scratch experiments: `skill.ts matchups` (1,000 seeds per matchup; 2p v2, 2p v1, 4p v2, 2p easy rules, 2p advanced rules), `skill.ts luck 1000 2`, `skill.ts gauge` (2,000,000 simulated rolls per gauge setting), `diag/wins.ts` (2p 1,000 seeds; 4p 500 seeds), `diag/comeback.ts 2 1000`, `diag/money.ts 2 1000` (v2 and v1), `diag/mc.ts expert` (200 games, K=24 rollouts) and `diag/mc.ts impact` (40 games, K=64 rollouts, 2,917 decisions, 467 rolls).

---

## 1. What exactly are the rules today (rules v2, level "normal")?

### Takeaway
A 32-space, 2d6 roll-and-move game. A player's agency per turn is one or two yes/no prompts (buy / build one level / take over), all triggered by where the dice drop the token. Normal level has no movement control at all (the dice gauge is advanced-only). Four end conditions exist. Three of them (line, hub, triple) are instant wins that are cheap on the low-price side of the board. The v2 "fun rules" added random money and swing events (vault jackpot, news, doubles bonus card, comeback cards, all-or-nothing tax) rather than new choices.

### Cited Findings
**Default table**
- The setup screen defaults are 30 rounds and a 30 s prompt timer. Player 2 (seat N) is a CPU on normal by default ("one person against the CPU"). The engine's own `defaultSettings()` keeps 15 rounds / 15 s, and `npm run sim` is measured against that — [src/ui/shell/setupModel.ts L55-L80](../../../src/ui/shell/setupModel.ts); [src/engine/settings.ts](../../../src/engine/settings.ts).
- The starting seat is randomised by rotating the turn order by a random offset — [src/ui/shell/setupModel.ts `rotateStart`](../../../src/ui/shell/setupModel.ts); [docs/DESIGN.md §4.1](../../DESIGN.md).
- Defaults: `rules: 'normal'`, `rulesVersion: 2`, takeover on, auction off, `endOnFirstBankruptcy` on, `spacesPerSide 7` — [src/engine/settings.ts `defaultSettings`](../../../src/engine/settings.ts).

**Board (32 spaces)**
- Index 0 is Start. Corners: Island at 8, Festival at 16, Travel at 24. There are 19 cities in 7 colour groups (brown 2, sky 3, pink 3, orange 3, red 3, yellow 3, blue 2), 4 hubs at 250 each (5, 13, 21, 29), 3 event spaces (3, 18, 27), a donation box (11) and a tax office (23) — [src/content/board.ts](../../../src/content/board.ts); [docs/BALANCE.md "Rule interpretations"](../../BALANCE.md).
- City prices run from 100 (Manila) to 1,000 (Seoul). The cities on each side cost: side A (5 cities) 760 in total, side B (5) 1,440, side C (only 4 cities: Madrid, Berlin, Rome, London) 1,700, side D (5) 3,500. All four hubs together cost 1,000 — computed from [src/content/board.ts](../../../src/content/board.ts).

**Economy**
- Start cash 3,000 (options 2,000 / 3,000 / 5,000). Salary is 300 for passing Start; landing exactly on Start pays salary plus the whole donation pot — [src/engine/economy.ts](../../../src/engine/economy.ts); [docs/DESIGN.md §4](../../DESIGN.md).
- City toll is 0.10 / 1.00 / 2.00 / 3.00 / 4.00 x price for land, villa, building, hotel and landmark (tuned up from the §4 draft of 0.10 / 0.35 / 0.90 / 1.60 / 3.00). The land-only toll doubles with a complete colour group. A single festival marker multiplies one city's toll: x2, then x3 and x5 under the Grand Festival rule when it is held again on the same city — [src/engine/economy.ts](../../../src/engine/economy.ts); [src/engine/rules.ts `tollOf`](../../../src/engine/rules.ts).
- Build cost is 0.5 / 0.6 / 0.7 / 1.0 x price per level. A player builds **only when landing on their own city, one level per visit**, with one extra level allowed on the visit they buy (`buildOnPurchase`) or take over (`buildAfterTakeover`). There is no remote building ([docs/DESIGN.md §4](../../DESIGN.md); [src/engine/reducer.ts `offerBuild`, buy branch](../../../src/engine/reducer.ts)). A build prompt opens only if the player can afford the level — [docs/BALANCE.md](../../BALANCE.md).
- Takeover: after paying the toll on a non-landmark opponent property, the visitor may buy it for 2 x value (value = price + build costs). It costs 1.5 x during a "takeover sale" news round, and 1 x for a win-back, which is advanced-only — [src/engine/rules.ts `takeoverPrice`](../../../src/engine/rules.ts).
- Hub toll is 100 x the number of hubs the owner holds. Tax takes 10 % of cash; donation is 100. Bail is 200 and the island holds a player up to 3 turns. A third consecutive double sends the player to the island. Selling back pays 50 % — [src/engine/economy.ts](../../../src/engine/economy.ts).
- Late toll (normal and above, with a round limit): the last 5 rounds multiply tolls by x1.25 … x2.25 — [src/engine/rules.ts `lateTollMultiplier`](../../../src/engine/rules.ts).
- Seat bonus (normal and above): later seats start with +0 / +200 / +400 / +600 — [src/engine/economy.ts `seatBonus`](../../../src/engine/economy.ts).

**Dice**
- 2d6 (`rollDice`). Doubles roll again; the third double goes to the island without moving. On the island, rolling doubles escapes without an extra roll. The Express card doubles the next movement. There is no choice of die or direction — [src/engine/reducer.ts `doRoll`, `doIslandRoll`](../../../src/engine/reducer.ts).
- Dice gauge B7 exists only in **advanced** (`diceGauge: advanced`). At a full pull it gives a 35 % chance of a second roll and keeps the higher (or lower) of the two sums — [src/engine/settings.ts `ruleFlags`](../../../src/engine/settings.ts); [src/engine/reducer.ts `gaugeRoll`](../../../src/engine/reducer.ts); [src/engine/economy.ts `diceGaugeBias: 0.35`](../../../src/engine/economy.ts).
- Measured gauge bias (2,000,000 rolls each). At full high pull the mean sum goes from 7.000 to 7.476, P(sum ≥ 10) from 16.7 % to 21.5 % and P(sum ≤ 4) from 16.7 % to 11.8 %. P(sum = 7) stays at 16.7 %. At a 0.75 pull the mean is 7.239. The CPU never passes a gauge value, so CPU rolls are always plain — Run: `skill.ts gauge`; [src/engine/ai.ts `preRoll` → `{type:'Roll'}`](../../../src/engine/ai.ts).

**Cards**
- The deck is the 24 original cards plus 2 comeback cards (Land Swap, Leader Raid) when `comebackCards` is on (normal and above, v2), drawn uniformly with replacement — [src/content/cards.ts](../../../src/content/cards.ts); [src/engine/reducer.ts `deckFor`](../../../src/engine/reducer.ts).
- On normal level a card draw is a **choice between two different cards, one face-down** (`cardChoice` and `hiddenCard` are both normal-level flags). The CPU compares the known card with the deck average and does not peek — [src/engine/settings.ts](../../../src/engine/settings.ts); [src/engine/ai.ts `cardChoice`](../../../src/engine/ai.ts).
- Of the 26 cards, 4 need a further choice: Free Upgrade (pick a city), Typhoon (normal-level targeting), Swap (pick a target or pass), and the keepable Toll Pass (use or save). Shield and Escape are keepables used automatically or by prompt. The other 20 resolve immediately — [src/content/cards.ts](../../../src/content/cards.ts); [src/engine/ai.ts](../../../src/engine/ai.ts).
- **Doubles bonus card** (v2): every non-third double draws an event card before the extra roll — [docs/DESIGN.md §4.2](../../DESIGN.md).

**Victory**
- Last solvent player. Triple (3 complete colour groups). Line (every city on one side; hubs do not count). Hubs (all 4). Round limit (highest total assets). Set wins are checked after every action. With `endOnFirstBankruptcy` and normal's `finishRound`, a first bankruptcy ends the game when the round completes, and in 2p it becomes "lastStanding" — [src/engine/rules.ts `setVictory`, `findVictory`](../../../src/engine/rules.ts); [src/engine/reducer.ts `endTurn`](../../../src/engine/reducer.ts).
- One-away warnings (`OneAway` events) tell everyone when a player is one property short of a set — [src/engine/rules.ts `oneAwayWarnings`](../../../src/engine/rules.ts).

**Comeback and v2 rules (normal level)**
- Lucky vault: bail and card fines go into the pot, and the bank adds 100 per round. Landing exactly on Start, or drawing the Welfare card, takes the whole pot.
- News flash every 4 rounds (rounds 4, 8, …, 28, so 7 per 30-round game). Headlines: toll fever x2, quake (one colour group −1 level), build boom (costs ½), takeover sale (1.5x), share day (richest gives 10 % of cash to poorest), vault boom.
- Comeback cards: when the drawer is last and the leader has ≥ 1.25 x their assets, the first card offered comes from swap / raid / welfare / free upgrade / lottery.
- All-or-nothing tax: a die roll of 4–6 pays nothing, 1–3 pays double, with the same expected cost as paying.
- Win-back (1x value) is **advanced only** ([src/engine/settings.ts `winBack: v2 && advanced`](../../../src/engine/settings.ts)) — [docs/DESIGN.md §4.2](../../DESIGN.md); [src/engine/economy.ts](../../../src/engine/economy.ts); [src/engine/reducer.ts `isComebackDraw`, `newsFlash`](../../../src/engine/reducer.ts).

**Every decision point in a turn (normal level)**
- The reducer's phases are: `preRoll` (Roll only); `island` (Roll / PayBail / UseEscapeCard); `travel` (pick any space or Pass, only the turn after landing on corner 24); `buy` (Buy / Pass); `build` (Build one level / Pass, only on your own city); `takeover` (Takeover / Pass, after paying toll); `festival` (pick one of your cities); `freeUpgrade`; `cardChoice` (two cards, one face-down); `target` (typhoon or swap target); `gamble` (tax: pay or roll); `useCard` (toll pass, or shield when attacked); `debt` (choose what to sell). `doubleUp` exists only in advanced and `auction` only with the off-by-default setting — [src/engine/types.ts `Phase`](../../../src/engine/types.ts).
- A prompt opens only when there is a real choice (no build prompt if unaffordable, no takeover prompt if unaffordable) — [docs/BALANCE.md "Rule interpretations"](../../BALANCE.md).

### Inferences
- Every prompt except Travel is *reactive*: the dice choose the city, and the player only says yes or no to the one action tied to that square. There is no "where do I invest", "which way do I move" or "whom do I hit" decision outside the rare Travel, Swap and Typhoon moments.
- The cheapest instant-win sets are very cheap compared with the 3,000 start cash: side A costs 760 and the 4 hubs 1,000. That turns completing a set into a race decided mostly by landings.

### Gaps
- I did not read the UI to check how the face-down card and the 30 s timer behave for a human (the default action on timeout is "pass" per DESIGN §2.3, which says 15 s; the setup default is now 30 s).

---

## 2. Measurements with the existing tools (fun metrics and balance sim)

### Takeaway
On the default 2p table, v2 raised decisions per turn (1.26 → 1.59), interaction (10.4 → 14.4 per game) and the comeback rate (R10 34.5 → 42.1 %). It also nearly doubled instant set wins (28.3 % → 46.4 % of games) and made the donation-pot jackpot (≈3,000 per game, pure dice) almost as large as all salary paid. In 2p, the R10 leader still wins only 57.9 %, and the R5 leader 52.0 %, close to a coin flip. That reads as low persistence of advantage, not as strong comeback design.

### Cited Findings
**Fun metrics** (`npm run fun -- --seeds 1000 --rules normal --detail` vs `--rules-version 1`, 30 rounds, CPU normal; fair last-place win = 50 / 33 / 25 %) — Run; matches [docs/BALANCE.md "Fun rules"](../../BALANCE.md):

| metric | 2p v1 → v2 | 3p v1 → v2 | 4p v1 → v2 |
|---|---|---|---|
| rounds | 24.71 → 24.45 | 20.97 → 22.40 | 17.29 → 19.63 |
| decisions/turn | 1.26 → 1.59 | 1.28 → 1.57 | 1.30 → 1.56 |
| obvious-decision share | 34.6 → 39.2 % | 40.8 → 38.7 % | 45.5 → 39.1 % |
| forced actions/turn | 1.13 → 1.12 | 1.14 → 1.13 | 1.14 → 1.12 |
| interactions/game (non-toll) | 10.4 (1.7) → 14.4 (5.2) | 23.4 (4.9) → 32.2 (11.1) | 34.0 (8.7) → 47.0 (17.0) |
| lead changes/game | 3.2 → 4.2 | 4.8 → 6.7 | 6.1 → 8.4 |
| comeback R10 (R10 leader loses) | 34.5 → 42.1 % | 43.2 → 51.0 % | 44.8 → 58.5 % |
| comeback R20 | 22.0 → 29.3 % | 28.0 → 39.7 % | 26.6 → 41.5 % |
| last at R10 wins | 34.1 → 42.0 % | 13.9 → 20.4 % | 6.7 → 12.5 % |
| dull turns | 15.8 → 9.8 % | 12.7 → 8.8 % | 10.7 → 8.0 % |
| turns with a ≥500 swing | 12.0 → 22.3 % | 19.0 → 28.7 % | 25.3 → 33.3 % |
| cards/game (distinct) | 4.9 (4.3) → 12.9 (9.1) | 6.4 (5.4) → 18.1 (11.2) | 6.9 (5.7) → 20.8 (12.4) |
| pot wins/game x mean | 1.28 x 207 → 3.51 x 856 | 1.69 x 252 → 4.75 x 695 | 1.86 x 297 → 5.37 x 621 |
| seat wins (1st … last) | 49.1/50.9 → 51.9/48.1 % | 34.9/35.1/30.0 → 34.4/34.0/31.6 % | 27.4/25.2/24.6/22.8 → 25.6/28.2/25.3/20.9 % |

- 2p v2, decisions per game (both players, 75.6 in total): build 22.3, buy 20.6, card choice 12.9, takeover 5.6, debt 2.8, island 2.3, travel 2.2, festival 2.2, gamble 1.7, free upgrade 1.2, target 1.1, use card 0.7. That is about 37.8 decisions per player over about 23.8 turns. Interactions per game: toll 9.28, takeover 1.85, card P2P 1.62, city swap 0.87, toll waived 0.41, bankruptcy transfer 0.18, blocked 0.14, typhoon 0.11. Landings per game: city 33.1, hub 6.8, event 4.9, start 2.6, festival 2.3, travel 2.3, island 2.2. First bankruptcy at round 22.4 — Run: `npm run fun ... --detail`.
- Easy rules, 2p, 30 rounds: decisions/turn 1.13, obvious 35.9 %, R10 comeback 31.3 %, dull turns 16.3 %, seat 1 wins 56.5 % (no seat bonus at easy) — Run: `npm run fun -- --seeds 1000 --rules easy --players 2 --detail`.

**Victory types** (`npm run sim`, normal rules, 30 rounds) — Run:

| | 2p v1 (1,000) | **2p v2 (1,000)** | 3p v2 (1,000) | 4p v2 (1,000) | 4p v2, 15 rounds (500) |
|---|---|---|---|---|---|
| mean / median rounds | 24.71 / 28 | 24.45 / 27 | 22.40 / 23 | 19.63 / 19 | 13.70 / 15 |
| bankruptcy (2p: lastStanding) | 33.4 % | 17.5 % | 38.9 % (+0.6 lastStanding) | 69.8 % | 43.8 % |
| line | 11.0 % | **24.7 %** | 18.1 % | 8.8 % | 2.6 % |
| hubs | 14.8 % | **16.5 %** | 16.5 % | 12.2 % | 5.8 % |
| triple | 2.5 % | **5.2 %** | 6.1 % | 2.6 % | 0.8 % |
| instant set wins in total | 28.3 % | **46.4 %** | 40.7 % | 23.6 % | 9.2 % |
| round limit | 38.3 % | 36.1 % | 19.8 % | 6.6 % | 47.0 % |

- (`docs/BALANCE.md` lists 23.8 % line for 2p v2 at 500 seeds. My 1,000-seed run gives 24.7 %, and the v1 2p numbers match the doc exactly.) — [docs/BALANCE.md](../../BALANCE.md); Run.

**When instant wins happen** (2p v2, 1,000 seeds; counts by rounds 1–5 / 6–10 / 11–15 / 16–20 / 21–25 / 26–30) — Run: `skill.ts luck 1000 2`:
- line: 0 / 8 / 31 / 71 / 77 / 60 (median round 21, p10 13, p90 28);
- hubs: 0 / 15 / 35 / 36 / 39 / 40 (median 20, p10 11);
- triple: 0 / 0 / 0 / 10 / 22 / 20 (median 24);
- lastStanding: median 25 (p10 12).

**How instant wins are completed** (2p v2, 1,000 seeds, 464 set wins) — Run: `diag/wins.ts 2 1000`:
- 57.5 % (267) are completed after a **Travel-corner move**, 41.4 % (192) after a normal roll, about 1 % after a card move;
- 55.6 % (258) by buying the last piece, 44.4 % (206) by taking it over;
- line wins by side: A 86, C 91, B 60, D 10. The two cheap sides (A at 760; C, with only 4 cities, at 1,700) supply 72 % of line wins.

**Money flow and tolls** (2p v2, 1,000 seeds) — Run: `diag/money.ts 2 1000 2` and `... 1`, `diag/wins.ts`:
- Money received per game, summed over both players: toll 4,140, salary 3,731, **pot jackpot 3,003**, takeover proceeds 1,264, cards from the bank 794, sales 521, cards between players 430, news 176. In v1 the pot was 264 and bank cards 250.
- Toll sizes: median 320, p90 960, p99 2,160, max 5,880. There are 0.89 tolls ≥ 1,000 per game. 173 of 175 2p bankruptcies follow a toll.

**Snowball and persistence** (2p v2, normal vs normal, 1,000 seeds) — Run: `skill.ts luck 1000 2`:
- The leader in total assets at the start of round 5 wins 52.0 %, at round 10 57.9 %, at round 15 65.2 %.
- The player with more cities at round 6 wins 55.8 %. The player with more buy offers in rounds 1–6 wins 58.5 %.

**Seat advantage:** 2p seat 1 wins 51.9 % (seat 2 starts with +200); 4p seat 4 wins 20.9 % despite +600 — Run: `npm run sim` (2p and 4p, 30 rounds).

### Inferences
- The v2 jump in "comeback rate" partly measures *more noise*: random money (pot 3,003 per game, bank cards 794, swaps and raids) was added to a game where both players already follow the same policy. In 2p the advantage at R5 carries almost no information (52 %). For an equal-skill table that looks "fair"; for a player trying to plan, it reads as "nothing I did by round 5 mattered".
- Instant set wins are now the most common way a 2p game ends early (46 % of games). They are completed mostly by the dice (Travel-corner landings and plain landings) on the cheap side A, side C and the hub set. This is the clearest case of luck being *amplified* into a game-ending result.
- 4p games end by bankruptcy 70 % of the time, while 2p games end by an instant set or the round cap. The two player counts are effectively different games, and the default table is the 2p one.

### Gaps
- The fun metric "obvious decision" is a crude proxy (a buy or build that leaves ≥ 1,000 cash, or a single-option festival or free upgrade). It does not count card picks that are obvious, so it probably understates triviality; the MC impact analysis in §3 is the better measure.
- I did not measure human-observed timing (turn duration on a tablet); `08-fun-analysis.md` §7 also lists it as unmeasured.

---

## 3. How dice-dependent is it? (skill gap, decision impact vs dice impact)

### Takeaway
Policy quality does matter in aggregate. The normal AI beats a "buy and build everything" player 67.7 % of the time and the easy AI 60.6 % (2p, 1,000 seeds). Two reasonable players, though, are effectively flipping a coin. A one-ply Monte Carlo "expert" that re-plans every decision with 24 rollouts does **not** beat the normal AI (101/200 = 50.5 %). Most individual decisions (build, buy, tax gamble) move win probability by about 3–6 pp, at or below the measurement noise. Only the Travel destination (~20 pp) and attack/swap targeting (~14 pp) clearly matter, and they come up about 1.7 times per player per game.

### Cited Findings
**Skill gap matchups** (2p, normal rules v2, 30 rounds, 1,000 seeds; the "hero" is the normal AI, seat alternating; fair = 50 %) — Run: `skill.ts matchups 1000 2 normal 2`:

| opponent policy | hero win % (v2) | hero win % (v1 rules) | hero win % (easy rules) | hero win % (advanced rules) |
|---|---:|---:|---:|---:|
| normal AI (control) | 51.1 | 50.1 | 50.3 | 48.2 |
| easy AI (`cpuLevel: 'easy'`) | **60.6** | 55.4 | 53.5 | 58.7 |
| "always yes" (buy, build, take over, first option whenever legal) | **67.7** | 59.9 | 54.0 | 67.6 |
| uniform random over legal actions | 90.2 | 85.4 | 85.0 | 89.8 |
| "always pass" (never buy or build) | 98.9 | 99.7 | 99.7 | 98.5 |

- 4p (1 normal hero vs 3 copies of the policy, fair 25 %, 1,000 seeds): vs 3 normal 25.2 %, vs 3 easy 41.6 %, vs 3 always-yes 37.4 %, vs 3 random 77.9 %, vs 3 always-pass 100 % — Run: `skill.ts matchups 1000 4 normal 2`.
- The repo's own mixed-table number: CPU normal beats easy 65.9 % (2 normal + 2 easy, normal rules) — [docs/BALANCE.md](../../BALANCE.md).

**Search-based "expert" vs normal AI** (2p, v2, 200 games, seat alternating). At each of its decisions the expert evaluates the AI's move and up to 5 alternatives with 24 shared-seed rollouts (normal AI on both sides), and switches only if another move scores higher by more than 1/24. It deviated from the AI on 22.2 % of its 7,605 decisions and won **101/200 = 50.5 %** (95 % CI roughly ±7 pp) — Run: `diag/mc.ts expert 1 100 24` and `expert 1001 100 24`.

**Decision impact vs dice impact** (2p, v2, normal vs normal, 40 games, K=64 shared-seed rollouts per option; impact = best − worst win probability across the options at that decision). The noise column is the mean gap between two independent 64-rollout evaluations of the same move. Paired comparisons of different moves share seeds, so their noise is lower than that, but not zero — Run: `diag/mc.ts impact 1 20 64` and `impact 101 20 64`:

| decision | n | mean impact | median | share ≥ 10 pp | AI choice ≥ 10 pp below the best | noise reference |
|---|---:|---:|---:|---:|---:|---:|
| build | 874 | 3.7 pp | 3.1 | 5.8 % | 1.5 % | 6.1 pp |
| buy | 806 | 5.9 pp | 4.7 | 18.9 % | 4.5 % | 6.3 pp |
| card choice | 529 | 6.9 pp | 4.7 | 24.8 % | 8.1 % | 5.7 pp |
| takeover | 234 | 8.6 pp | 5.5 | 28.2 % | 13.2 % | 5.4 pp |
| island (roll / bail) | 107 | 7.5 pp | 4.7 | 29.9 % | 12.1 % | 6.6 pp |
| festival | 93 | 6.3 pp | 6.3 | 12.9 % | 2.2 % | 6.1 pp |
| **travel destination** | 85 | **19.7 pp** | 17.2 | 82.4 % | 21.2 % | 5.2 pp |
| gamble (tax) | 68 | 3.7 pp | 3.1 | 4.4 % | 4.4 % | 5.0 pp |
| **target (typhoon / swap)** | 49 | **14.2 pp** | 14.1 | 65.3 % | 10.2 % | 5.8 pp |
| free upgrade | 38 | 6.2 pp | 6.3 | 18.4 % | 0 % | 6.2 pp |
| use card | 34 | 5.6 pp | 6.3 | 8.8 % | 5.9 % | 5.0 pp |
| **all decisions** | 2,917 | 6.2 pp | 4.7 | 19.2 % (≥ 20 pp: 3.9 %) | | |

- Dice: at 467 sampled rolls, forcing 8 different 2d6 outcomes gave a mean max−min spread in win probability of 18.9 pp. The SD of P(win | roll) was 6.4 pp raw and **3.3 pp** after subtracting binomial noise (p(1−p)/K) — Run: `diag/mc.ts impact`.
- Luck-only features predict the 2p winner (normal vs normal, 1,000 games). The player who **paid less toll wins 78.5 %**, more salaries (laps) 68.5 %, more doubles 62.3 %, more cards drawn 61.9 % (cards are mostly doubles bonuses, see §5), more buy offers in rounds 1–6 58.5 %, fewer island visits 51.4 % — Run: `skill.ts luck 1000 2`.
- The tax gamble has the same expected cost by design ("기댓값 동일") — [docs/research/08-fun-analysis.md §5 #5](../08-fun-analysis.md). Its measured impact (3.7 pp) is at the noise floor — Run.

### Inferences
- **The headline skill number for the report.** Against a thoughtless "say yes to everything" player, a sensible policy wins about 2 in 3 games in 2p (67.7 %; 54.0 % on easy rules). Against another sensible policy it is a coin flip, and a search-based player could not find a better line than the shipped heuristic. The game rewards *avoiding blunders* (keep a cash reserve, do not overbuild), not *outplaying* an opponent. There is little room above "competent".
- One normal roll moves win probability by about 3 pp (SD) per roll over about 27 rolls per player. The typical buy or build decision moves it by a similar or smaller amount. Those decisions are also *offered by* the dice: which city, when, and whether you can afford it. So both the opportunities and their payoffs are dice-gated.
- The decisions that clearly matter (Travel ~20 pp, targeting ~14 pp) are rare. Travel follows a dice landing on corner 24 (2.2 per game for both players combined). Swap and typhoon follow a card. Together they are about 3.3 of 75.6 decisions per game (4 %).
- Because toll paid predicts the winner 78.5 % of the time and its main driver is where the dice drop you, the result is mostly a function of landing luck. Decisions shape it at the margin, through the cash reserve and the choice of what to build.
- v2 *increased* the skill gap (vs always-yes 59.9 → 67.7 %), probably because more money and more prompts reward reserve management. So "more decisions" did help a little, even though the luck volume went up too.

### Gaps
- The MC evaluation uses the normal AI as the rollout policy for both sides, so "impact" means impact *given that the rest of the game is played by the heuristic*. A stronger rollout policy could reveal larger impacts. With K=64 the per-option noise (~4–6 pp paired upper bound) is the same size as most measured impacts, so build, buy and gamble impacts cannot be told apart from roughly 0–4 pp. A larger K or more games would tighten this.
- There is no human playtest data. "Always yes" is my proxy for a casual human, and I did not validate it.
- I found no external benchmark of skill-vs-luck win rates for Monopoly-likes in this repo, and did not search the web (the scope was internal).

---

## 4. Decisions that do not matter, and choices a smart player would want but does not have

### Takeaway
Most prompts are dice-triggered binary accept/decline choices whose answer follows from cash on hand: build 22.3, buy 20.6 and gamble 1.7 per game is 59 % of decisions, each worth ≤ ~6 pp. The game offers no control over movement on normal level, where to invest, when to defend, or whom to pressure, except via rare Travel and card moments.

### Cited Findings
- Forced actions are about 1.12 per turn (the Roll, plus single-option prompts). The fun script counts 39.2 % of real decisions as "obvious" in 2p v2 — Run: `npm run fun ... --detail`.
- The normal AI's rules show how shallow the logic is: buy if cash after ≥ 1.5 x average toll exposure (or to complete or block a set); build if cash ≥ 2 x cost; take over only to complete or block a set; pay bail if cash ≥ 800; tax gamble if not leading and able to pay double. Yet a 24-rollout search player could not beat it (§3) — [src/engine/ai.ts](../../../src/engine/ai.ts); Run.
- Building happens only on landing on your own city, one level per visit (plus one level on purchase or takeover). A landmark (takeover-immune) needs L3 first, so it takes 3 more own-city landings after the purchase visit — [docs/DESIGN.md §4](../../DESIGN.md); [src/engine/reducer.ts `offerBuild`](../../../src/engine/reducer.ts).
- Movement: normal level has plain 2d6. The gauge is advanced-only and weak, raising P(sum ≥ 10) from 16.7 to 21.5 % at most. The Express card is automatic (it doubles the next roll, with no choice of when) — [src/engine/settings.ts](../../../src/engine/settings.ts); [src/content/cards.ts `express`](../../../src/content/cards.ts); Run: `skill.ts gauge`.
- Card choice is between two cards with **one face-down**, so roughly half the information is hidden. 12.9 cards per game in 2p, about 6.4 per player — [src/engine/settings.ts `hiddenCard`](../../../src/engine/settings.ts); Run.
- Shield use is automatic in practice: the AI always uses it, and `swapCities` blocks with the shield and no prompt ("nobody keeps a shield for later") — [src/engine/ai.ts `useCard`](../../../src/engine/ai.ts); [src/engine/reducer.ts `swapCities`](../../../src/engine/reducer.ts).
- Trading and auctions: none by default (auction is a setting, off). The earlier analysis lists "거래·경매 기본 켬" as not done because of time on one tablet — [docs/research/08-fun-analysis.md §5 #9, §7](../08-fun-analysis.md).
- Takeover is a reactive yes/no after a dice landing (5.6 per game in 2p). Players cannot target a specific opponent property except via Travel (2.2 per game) or the Swap card (0.87 swaps per game) — Run.

### Inferences
**Decisions that do not matter (forced or obvious):**
- Roll: always forced.
- Build when rich: 3.7 pp mean impact, at noise level.
- Buy on a cheap city with spare cash.
- Festival with one option, and Free Upgrade (AI never wrong by ≥ 10 pp).
- The tax gamble (same EV, 3.7 pp).
- Toll pass and shield use: near-automatic.
- Card choice when one card is face-down and the other is clearly good or bad.
- Debt sales: mostly dictated by the shortfall.

**Choices a smart player would want and does not have:**
1. *Movement and timing*: pick a die, or move 1–2 extra for a cost. Currently only advanced has a gauge, and it is 35 %-probabilistic.
2. *Where to invest*: build on any own city when passing Start, rather than only where you land. The 01 research describes this "start-bonus building" in Modu Marble ([docs/research/01-game-rules-research.md §3.2](../01-game-rules-research.md)).
3. *Saving vs spending*: nothing rewards holding cash except surviving tolls. No interest, no planned purchase, no reserve-based defence.
4. *Defending*: no way to protect a key city other than landing on it three more times to reach a landmark, or a lucky Shield draw. No "insurance" purchase and no blocking action when a OneAway warning fires (8.75 warnings per game in 2p) unless the dice bring you to the missing square.
5. *Targeting*: no way to choose an opponent property to pressure except Travel or Swap.
6. *Negotiation*: none.

In 2p, the OneAway warning (99.9 % of games see at least one) creates tension but offers no counter-play beyond hoping to land on the square.

### Gaps
- I did not measure how often a OneAway warning is answered by a successful block (for example, the opponent buying or taking over the missing square before it completes). That would directly quantify "warned but helpless".

---

## 5. Which mechanics mitigate luck, and which amplify it?

### Takeaway
v2 mostly added *luck-driven* swings: a ≈3,000-per-game pot jackpot from exact Start landings, 62 % of cards coming from rolling doubles, random news, and instant set wins half completed by Travel. The few luck *mitigators* (two-card choice, comeback offer to the last player, raid, share day, seat bonus) are themselves random-gated. Takeovers, nominally the comeback engine, are made twice as often by the leader as by the trailer in 2p.

### Cited Findings
**Amplifiers (2p v2, 1,000 seeds unless stated)**
- Lucky-vault pot: 3.51 pot wins per game, mean 856, about **3,003 per game**. That is 80 % of the salary paid (3,731), and it goes to whoever lands exactly on Start or draws Welfare. It was 264 per game in v1 — Run: `diag/money.ts`; [src/engine/reducer.ts `land` case `start`](../../../src/engine/reducer.ts).
- Doubles bonus card: 7.97 of 12.88 card offers per game (62 %) are doubles bonuses. Doubles happen on 16.6 % of rolls. The player with more doubles wins 62.3 % — Run: `diag/comeback.ts 2 1000`, `diag/money.ts`, `skill.ts luck`.
- Instant set wins: 46.4 % of 2p games, 57.5 % of them completed by a Travel-corner move. The cheap sides (A at 760; C, 4 cities, at 1,700) and the 1,000-cost hub set dominate — Run: `npm run sim`, `diag/wins.ts`.
- `08-fun-analysis` itself flags this: "2인 판에서 돈이 늘어 즉시 독점 승리(라인)가 10 → 24 %로 늘었다" ("in 2-player games, more money raised instant monopoly (line) wins from 10 to 24 %"). It suggests adjusting the line condition as the next lever — [docs/research/08-fun-analysis.md §6.1](../08-fun-analysis.md); [docs/BALANCE.md "Watch item"](../../BALANCE.md).
- Toll spikes: p99 toll 2,160 and max 5,880 against start cash 3,000. Grand Festival goes x2 → x3 → x5, toll-fever news is x2, late toll goes up to x2.25. 173 of 175 2p bankruptcies follow a toll — Run: `diag/wins.ts`; [src/engine/economy.ts](../../../src/engine/economy.ts).
- Takeovers in 2p: 1.21 per game by the player ahead in total assets vs 0.63 by the player behind. A 2 x value takeover needs cash, which the leader has — Run: `diag/comeback.ts`.
- News flash: 7 headlines per 30-round game, chosen at random, each about 0.95 per game. Toll fever and quake hit whoever happens to be exposed — Run: `diag/comeback.ts`; [src/engine/reducer.ts `newsFlash`](../../../src/engine/reducer.ts).
- First bankruptcy ends the game (2p: lastStanding 17.5 %, median round 25) — Run: `skill.ts luck`.

**Mitigators**
- Two-card choice: worth 6.9 pp mean per pick, but one card is face-down — Run: `diag/mc.ts impact`; [src/engine/settings.ts](../../../src/engine/settings.ts).
- Comeback offer to the last player (leader ≥ 1.25 x assets): 3.15 underdog offers per game. 1.23 players per game receive at least one, and they go on to win 37.5 % (vs 50 % fair) — Run: `diag/comeback.ts`.
- Raid (0.88 per game), Swap (1.03 drawn, 0.87 executed), Leader Tax (0.14), Share Day news (0.93 per game, richest pays 10 % of cash; MoneyReason `news` totals 176 per game) — Run: `diag/comeback.ts`, `diag/money.ts`.
- Seat bonus: +200 for seat 2 in 2p. 2p seat wins are 51.9 / 48.1 %, vs 56.5 / 43.5 % on easy rules, which have no seat bonus — Run: `npm run sim`, `npm run fun --rules easy`.
- Travel corner: the one strong agency moment (~20 pp per decision), but reached by dice — Run.
- OneAway warnings: 8.75 per 2p game — Run: `diag/wins.ts`.
- Takeover as blocking: the AI takes over to stop a set (`blocksOpponent`) — [src/engine/ai.ts](../../../src/engine/ai.ts).
- Win-back: advanced only, so not on the default table — [src/engine/settings.ts](../../../src/engine/settings.ts).
- Card choice and lead persistence: the R10 leader wins 57.9 % in 2p — Run: `skill.ts luck`.

### Inferences
- The comeback tools mostly hand the trailing player a *random* windfall: an exact Start landing, a card drawn on doubles, a swap the dice happen to offer. They do not give a *decision* that converts skill into recovery. That fits the owner's complaint: comebacks feel weak because the losing player cannot *do* anything, only hope.
- The strongest single luck amplifier on the default 2p table is cheap instant set wins, completed by whoever lands on the right square or the Travel corner. Next comes the exact-landing pot jackpot, which is now worth almost as much as all salaries combined.
- Takeovers favour the leader in 2p (about 2:1). As tuned, they act as a lead-extender, not the comeback engine that the Modu Marble reference describes ([docs/research/01-game-rules-research.md §3.3](../01-game-rules-research.md)).

### Gaps
- I did not decompose how much of the 3,003 pot comes from exact Start landings vs the Welfare card. Welfare is drawn 1.13 times per game, and its share of the pot money is unmeasured.
- 1 of 500 4p games recorded a line win immediately after a `CitySwapped` event, although `swapOptions` is meant to exclude swaps that complete a set (`diag/wins.ts 4 500`, "line side C via swap: 1"). This could be a misattribution in my script, for example a set completed by another event in the same reduce batch, or an edge case in the engine. I did not investigate it, so treat it as unverified.
