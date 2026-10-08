# Balance notes — Lot & Roll engine

Owner: engine. Source of truth for numbers: `src/engine/economy.ts` (money rules),
`src/content/board.ts` (prices), `src/content/cards.ts` (card amounts).
Reproduce everything below with `npm run sim` (500 seeds, 4 × normal CPU, default settings);
flags: `--seeds N --players 2|3|4 --rounds 10|15|20|30|inf --level easy|normal --cash N --auction --elimination --no-takeover --strict`.

## Targets (DESIGN §8, as updated)

With the default 15-round cap and 4 CPU players:

* ≥ 35 % of games end **before** the cap (독점 set or bankruptcy);
* < 5 % of games have any bankruptcy before round 5;
* every game terminates.

## Result with the settled numbers

```
Lot & Roll balance report — 500 games, 4 × normal CPU, cash 3000, round limit 15,
takeover on, auction off, first bankruptcy ends game

Rounds: median 15, mean 13.58, min 4, max 15
Turns (all players): mean 53.7
Ended before the round cap: 41.2%  (206/500)
Victory types:
  bankruptcy       34.8%  (174)
  lastStanding      0.0%  (0)
  triple            0.8%  (4)
  line              1.6%  (8)
  hubs              4.0%  (20)
  roundLimit       58.8%  (294)

Bankruptcies: 180 total, 0.36 per game
  games with any bankruptcy:        36.0%
  games with bankruptcy < round 5:  0.2%
  games with bankruptcy < round 8:  1.8%

Per seat (turn order):
  P1 (S): wins  29.4%, avg final assets   4055, avg cash   1313, bankrupt 7.2%
  P2 (E): wins  29.0%, avg final assets   3886, avg cash   1245, bankrupt 8.0%
  P3 (N): wins  23.2%, avg final assets   3623, avg cash   1179, bankrupt 10.6%
  P4 (W): wins  18.4%, avg final assets   3155, avg cash    978, bankrupt 10.2%
```

All three targets are met. The median game still reaches the cap (the median of a distribution
where 59 % of games hit round 15 is 15); the mean is 13.6 rounds.

Note the first-player advantage (29 % vs 18 % wins for the 4th seat, mostly from the opening
land grab). The UI may want to randomise the starting player (reorder `settings.players`).

## What changed vs DESIGN §4, and why

| Rule | §4 | Engine | Why |
|---|---|---|---|
| City toll rates (× price) L0 / L1 / L2 / L3 / L4 | 0.10 / 0.35 / 0.90 / 1.60 / 3.00 | **0.10 / 1.00 / 2.00 / 3.00 / 4.00** | With §4 rates a villa charges 35 % of price while a lap pays 300; cash never runs out, 0.03 bankruptcies per game, 9 % of games end before round 15. |
| First level on purchase | not specified | **allowed** (`buildOnPurchase: true`) | Still "one level per visit". Without it, cities sit at L0 for most of a 15-round game (before-cap rate 41 % → 11 %). The same applies after a takeover (`buildAfterTakeover`). |
| What a bankruptcy does | player leaves, last one standing wins | **new setting `endOnFirstBankruptcy`, default ON**: the first bankruptcy ends the game; ranking by total assets (tie → cash → cities → seat). Off = §4 elimination rules. | See below. |

Everything else is exactly §4: start cash 3,000, salary 300 (+pot on exact landing), build costs
0.5/0.6/0.7/1.0 × P, value = P + Σ build costs, takeover 2 × value, hub toll 100 × hubs, tax
10 % of cash, donation 100, bail 200, 3 island turns, 3rd double → island, card amounts.

### Why "first bankruptcy ends the game"

독점 sets alone cannot end a 15-round game often enough on this board. Only ~15/24 properties
are owned by round 8 and a player lands on an opponent's property ~22 times per *game*, so sets
rarely come together; even a CPU that takes over at every opportunity ends only ~5 % of games by
a 독점 set before the cap. Last-player-standing needs three bankruptcies inside 15 rounds, which
only happens with tolls so large that bankruptcies before round 5 exceed the 5 % limit.

With the tuned tolls a first bankruptcy happens in about 36 % of games by round 15 and almost
never before round 8, which is exactly the "end early but not too early" window. Ending the game
there also avoids a knocked-out player watching the other three for half the session (the
research doc §7.1 #13 recommends the same). Groups that want the classic elimination game can
switch the setting off:

| Variant (500 seeds, 4 normal CPU) | ended before cap | bankruptcy < R5 | notes |
|---|---:|---:|---|
| **Default** (tuned tolls, first bankruptcy ends) | **41.2 %** | 0.2 % | |
| Tuned tolls, elimination (`--elimination`) | 10.2 % | 0.2 % | hub 5.8 %, line 2.8 %, triple 1.4 % |
| §4 tolls, first bankruptcy ends | 9.0 % | 0.0 % | |
| §4 tolls, elimination, no build on purchase (spec-literal) | 6.6 % | 0.0 % | hub/line sets only |
| Default but `buildOnPurchase: false` | 11.2 % | 0.0 % | |
| Default but takeover × 1.5 | 39.0 % | 0.2 % | takeover price barely matters |
| Default but salary 200 | 50.4 % | 0.2 % | lever if games feel long |

Other settings with the default economy:

| Setting | ended before cap | bankruptcy < R5 |
|---|---:|---:|
| 3 players | 27.4 % | 0.0 % |
| 2 players (bankruptcy = last standing) | 11.4 % | 0.0 % |
| 10-round cap | 13.4 % | 0.2 % |
| 30-round cap (median 17 rounds) | 95.8 % | 0.2 % |
| easy CPUs | 20.6 % | 0.0 % |
| start cash 2,000 | 45.2 % | 0.4 % |
| start cash 5,000 | 25.8 % | 0.0 % |
| auction on | 42.6 % | 0.2 % |

## Toll table (tuned)

Tolls round to the nearest 10. L0 doubles when the owner holds the whole color group; the
festival marker doubles everything on its city (one marker on the board). Hubs: 100 × hubs owned.

| idx | city | P | L0 | L1 | L2 | L3 | L4 | build L1/L2/L3/L4 | value at L4 |
|---:|---|---:|---:|---:|---:|---:|---:|---|---:|
| 1 | Manila | 100 | 10 | 100 | 200 | 300 | 400 | 50 / 60 / 70 / 100 | 380 |
| 2 | Hanoi | 120 | 10 | 120 | 240 | 360 | 480 | 60 / 70 / 80 / 120 | 450 |
| 4 | Cairo | 160 | 20 | 160 | 320 | 480 | 640 | 80 / 100 / 110 / 160 | 610 |
| 6 | Nairobi | 180 | 20 | 180 | 360 | 540 | 720 | 90 / 110 / 130 / 180 | 690 |
| 7 | Cape Town | 200 | 20 | 200 | 400 | 600 | 800 | 100 / 120 / 140 / 200 | 760 |
| 9 | Lima | 240 | 20 | 240 | 480 | 720 | 960 | 120 / 140 / 170 / 240 | 910 |
| 10 | Mexico City | 260 | 30 | 260 | 520 | 780 | 1040 | 130 / 160 / 180 / 260 | 990 |
| 12 | Buenos Aires | 280 | 30 | 280 | 560 | 840 | 1120 | 140 / 170 / 200 / 280 | 1070 |
| 14 | Istanbul | 320 | 30 | 320 | 640 | 960 | 1280 | 160 / 190 / 220 / 320 | 1210 |
| 15 | Athens | 340 | 30 | 340 | 680 | 1020 | 1360 | 170 / 200 / 240 / 340 | 1290 |
| 17 | Madrid | 360 | 40 | 360 | 720 | 1080 | 1440 | 180 / 220 / 250 / 360 | 1370 |
| 19 | Berlin | 420 | 40 | 420 | 840 | 1260 | 1680 | 210 / 250 / 290 / 420 | 1590 |
| 20 | Rome | 440 | 40 | 440 | 880 | 1320 | 1760 | 220 / 260 / 310 / 440 | 1670 |
| 22 | London | 480 | 50 | 480 | 960 | 1440 | 1920 | 240 / 290 / 340 / 480 | 1830 |
| 25 | Dubai | 540 | 50 | 540 | 1080 | 1620 | 2160 | 270 / 320 / 380 / 540 | 2050 |
| 26 | Singapore | 560 | 60 | 560 | 1120 | 1680 | 2240 | 280 / 340 / 390 / 560 | 2130 |
| 28 | Tokyo | 600 | 60 | 600 | 1200 | 1800 | 2400 | 300 / 360 / 420 / 600 | 2280 |
| 30 | New York | 800 | 80 | 800 | 1600 | 2400 | 3200 | 400 / 480 / 560 / 800 | 3040 |
| 31 | Seoul | 1000 | 100 | 1000 | 2000 | 3000 | 4000 | 500 / 600 / 700 / 1000 | 3800 |

## Rule interpretations used by the engine

Where DESIGN §4 is silent or ambiguous, the engine does the following (the Rules screen should
say the same):

* The §3 table has **19** cities (the prose says 20). 19 cities + 4 hubs + 3 events + tax +
  donation + 4 corners = 32.
* Landing on Start by any move (forward, backward card, travel) pays salary + pot once; passing
  it forward pays salary only. Backward moves never pay salary for passing.
* Card moves (to Start / Travel / Festival / nearest hub / random city) walk **forward** and
  resolve the landing normally (salary when passing Start). "Go to island" jumps, no salary.
* Landing on TRAVEL (or on the island) ends your turn even after doubles; the travel choice
  happens at the start of your next turn and replaces the roll. You may pick any space except
  the Island and TRAVEL itself; declining means you roll normally.
* Island: arriving sets 3 island turns. Each island turn: roll (doubles = escape and move, no
  extra roll), pay 200 bail to the bank, or use an escape card; after bail/card you roll
  normally (doubles do grant an extra roll then). After the 3rd failed roll you are free and
  roll normally on your next turn.
* Bail, fines, repairs and purchases go to the bank; only tax and donation feed the pot.
* A prompt is only opened when it has a real choice (e.g. no build prompt if you cannot afford
  the next level; no takeover prompt if you cannot afford it). `CannotAfford` is emitted when a
  buy is unaffordable (and the auction starts if enabled).
* Takeover (cities below landmark, and hubs) is offered after the toll is paid, including when
  the toll was waived by a toll pass. The 수호 방패 shield is public: the prompt says
  `ownerHasShield`; attempting consumes the shield and nothing else happens.
* Free upgrade (card 21) and typhoon change levels directly; property value is always derived
  from the current level (P + Σ build costs), so a free level adds value.
* Birthday / leader-tax never force another player into debt: they pay what they have, up to the
  amount. Leader-tax is a no-op if the richest or the poorest is tied.
* Charity (pay 50 to each) is one debt with several payees. If it bankrupts you, remaining cash is
  split evenly among them and properties return to the bank.
* Selling: a building level sells for 50 % of its build cost (levels 1–3); a whole property
  (any level, landmarks only this way) sells for 50 % of its value. Bankruptcy is immediate when
  cash + half of all property values < debt.
* Auction (setting): opening bid 50 % of price, increments 10 % of price, bidders in seat order
  after the decliner; players who cannot afford the current bid drop out automatically.
* Round limit: the game ends after the last solvent player's turn of the final round.

## Rule levels (2026-10-04)

`npm run sim -- --rules easy|normal|advanced` (500 seeds, 4 normal CPUs, cash 3000, 15 rounds,
first bankruptcy ends). Spec: `docs/superpowers/specs/2026-10-04-rule-levels-design.md`.

| | easy | normal | advanced |
|---|---|---|---|
| Ended before the round cap | 41.2 % | 69.6 % | 72.6 % |
| Victory: bankruptcy / roundLimit | 34.8 / 58.8 % | 62.8 / 30.4 % | 65.0 / 27.4 % |
| Victory: triple / line / hubs | 0.8 / 1.6 / 4.0 % | 0.2 / 1.4 / 5.2 % | 0.2 / 2.2 / 5.2 % |
| Mean rounds | 13.58 | 13.06 | 12.98 |
| Seat wins P1 / P4 | 29.4 / 18.4 % | 28.2 / 20.0 % | 32.2 / 18.2 % |
| Bankrupt before round 5 | 0.2 % | 0.0 % | 0.0 % |

Late toll was first ×1.5 … ×3.5 (step 0.5): 76.0 % (normal) / 80.0 % (advanced) of games ended
in a late bankruptcy and only 14–18 % reached the round cap — a bust race rather than a final
stretch. Step 0.25 (×1.25 … ×2.25) keeps roughly a third of games going to the cap. Seat
advantage is unchanged versus easy; the UI's random start order still applies.

## Fun rules (rules version 2, 2026-10-06)

Why and what: `docs/research/08-fun-analysis.md`; rules: `docs/DESIGN.md` §4.2. "Before" is the same
code with `--rules-version 1` (it replays the old rules exactly: same numbers as the build before).
Fun metrics: `npm run fun` (`scripts/fun.ts`, 1,000 seeds per row, CPU normal, start cash 3,000,
**30 rounds** — the setup default). Easy rules are unchanged (identical rows).

| players · rules | rounds before → after | decisions/turn | interactions/game (non-toll) | event kinds/game | lead changes | comeback R10 | last at R10 wins | dull turns | turns with a 500+ swing |
|---|---|---|---|---|---|---|---|---|---|
| **2 · normal** (owner's default) | 24.71 → 24.45 (−1 %) | 1.26 → 1.59 | 10.4 (1.7) → 14.4 (5.2) | 17.5 → 20.7 | 3.2 → 4.2 | 34.5 → 42.1 % | 34.1 → 42.0 % | 15.8 → 9.8 % | 12.0 → 22.3 % |
| 2 · advanced | 24.88 → 24.31 (−2 %) | 1.33 → 1.70 | 10.5 (1.8) → 14.7 (5.3) | 19.2 → 22.4 | 3.3 → 4.1 | 32.9 → 36.8 % | 32.0 → 36.8 % | 14.3 → 9.1 % | 12.5 → 22.8 % |
| 3 · normal | 20.97 → 22.40 (+7 %) | 1.28 → 1.57 | 23.4 (4.9) → 32.2 (11.1) | 20.1 → 23.7 | 4.8 → 6.7 | 43.2 → 51.0 % | 13.9 → 20.4 % | 12.7 → 8.8 % | 19.0 → 28.7 % |
| 3 · advanced | 20.90 → 22.34 (+7 %) | 1.34 → 1.66 | 23.3 (4.9) → 32.6 (11.5) | 21.9 → 25.4 | 5.0 → 6.8 | 42.6 → 51.9 % | 14.1 → 19.5 % | 11.2 → 8.4 % | 19.8 → 29.4 % |
| 4 · normal | 17.29 → 19.63 (+13.5 %) | 1.30 → 1.56 | 34.0 (8.7) → 47.0 (17.0) | 20.6 → 24.8 | 6.1 → 8.4 | 44.8 → 58.5 % | 6.7 → 12.5 % | 10.7 → 8.0 % | 25.3 → 33.3 % |
| 4 · advanced | 17.33 → 19.49 (+12.5 %) | 1.36 → 1.65 | 34.4 (8.9) → 47.2 (17.2) | 22.4 → 26.5 | 6.3 → 8.2 | 45.6 → 57.4 % | 8.7 → 11.1 % | 9.3 → 7.5 % | 26.3 → 34.2 % |

"Comeback R10" = the leader by total assets at the start of round 10 does not win; "last at R10 wins" = the
player in last place then does (fair: 50 % / 33 % / 25 %). 2 players, normal, per game: cards drawn
4.9 → 12.9 (distinct 4.3 → 9.1), pot collected 1.28 × 207 → 3.51 × 856, city swaps 0.87, raids and
other card payments between players 0.44 → 1.62, takeovers 0.72 → 1.85.

Seat fairness (1,000 seeds, normal, 30 rounds), seat 1 … last: 2p 49.1 / 50.9 → 51.9 / 48.1 %; 3p
34.9 / 35.1 / 30.0 → 34.4 / 34.0 / 31.6 %; 4p 27.4 / 25.2 / 24.6 / 22.8 → 25.6 / 28.2 / 25.3 / 20.9 %.
CPU normal vs easy at one table (2 + 2, seats alternate): normal wins 63.7 → 65.9 % (normal rules),
59.3 → 63.0 % (advanced), 59.8 % (easy, unchanged).

`npm run sim` (500 seeds, 4 × normal, normal rules), before → after:

| | 15 rounds (engine default) | 30 rounds (setup default) | 30 rounds, 2 players |
|---|---|---|---|
| Mean rounds | 13.07 → 13.70 | 17.03 → 19.81 | 24.73 → 24.53 |
| Ended before the cap | 66.6 → 53.0 % | 97.8 → 94.0 % | 62.4 → 63.6 % |
| Victory: bankruptcy (2p: last standing) | 57.8 → 43.8 % | 83.2 → 68.8 % | 34.4 → 16.4 % |
| Victory: triple / line / hubs | 0.2 / 1.8 / 6.6 → 0.8 / 2.6 / 5.8 % | 0.8 / 3.8 / 10.0 → 3.8 / 8.6 / 12.8 % | 3.0 / 10.2 / 14.8 → 5.8 / 23.8 / 17.6 % |
| Bankruptcy before round 5 / 8 | 0.0 / 1.4 → 0.0 / 1.2 % | 0.0 / 1.4 → 0.0 / 1.2 % | 0 / 0 → 0 / 0 % |

What moves the length (4 players, normal, 30 rounds, 600 seeds, one rule off at a time vs 19.6 with
all on): lucky vault off 18.5, comeback cards off 18.8, doubles card off 19.0, news off 19.3, all or
nothing off 19.8. Every rule adds a little money or a little defence, so the first bankruptcy comes
later; a vault seed of 50 instead of 100 only saves 0.2 rounds and halves the jackpot (624 → 473), so
it stays 100.

Watch item: in 2-player games more money means more instant set wins (line 10 → 24 %). A city swap
that would complete a winning set for either side is not offered (before that rule: line 26 %); the
rest comes from players simply affording more cities. If 2-player games end on a line too often at
the table, the lever is the line rule (count hubs on the side, or require a built side).

## Rules version 3 — strategy mode (2026-10-08)

Why: `docs/research/10-strategy-depth.md` (the diagnosis and the package), `docs/research/11-skill-throw.md`
(the throw). Rules: `docs/DESIGN.md` §4.3. The setup screen now offers **캐주얼** (= `normal`, unchanged:
every casual row below is identical to version 2, same seeds, same numbers) and **전략** (= `advanced` +
version 3). Measured with `npm run skill` (`scripts/skill.ts`, the research scripts cleaned up):
`table` (normal CPU vs normal CPU), `matchups` (one normal CPU in a rotating seat vs others), `expert`
(a search player). 2,000 seeds per row, 30 rounds, start cash 3,000, seeds 1…2,000.

### Before (version 2) and after (strategy mode) vs the research-10 targets

"v2 normal" is the old default table (now casual), "v2 adv" the old advanced level; v3 = strategy mode.

| metric (2 players) | v2 normal | v2 adv | **v3** | target | hit? |
|---|---:|---:|---:|---|---|
| normal CPU vs "always yes" | 65.2 % | 67.9 % | **83.0 %** | ≥ 75 % | yes |
| normal CPU vs easy CPU | 60.5 % | 58.2 % | **63.6 %** | ≥ 65 % | no (−1.4 pp) |
| normal CPU vs the same CPU ignoring the new choices ("plain") | – | – | **70.1 %** | ≥ 58 % | yes |
| search player vs normal CPU (K=32 rollouts, 3 moves, switch at +3 wins, 200 games) | 55.0 % (110 / 200) | – | **50.0 % (100 / 200)** | ≥ 55 % | no (±6.9 pp either way) |
| set ("instant") wins | 46.4 % | 47.8 % | **20.8 %** | 20–30 % | yes |
| set win round min / p10 / median | 4 / 12 / 21 | 4 / 12 / 21 | 7 / 12 / 22 | p10 ≥ 15 | no |
| set win before round 10 (share of games) | 2.0 % | 2.2 % | **0.5 %** | ≤ 0.5 % | yes |
| mean rounds | 24.38 | 24.09 | **26.80 (+9.9 %)** | ±15 % | yes |
| last at R10 wins | 40.5 % | 39.0 % | **38.8 %** | 33–40 % | yes |
| leader at R5 / R10 / R15 wins | 53.4 / 59.5 / 65.3 % | 54.6 / 61.0 / 66.5 % | 52.9 / **61.2** / 64.8 % | R10 60–67 % | yes |
| lead changes / game | 4.16 | 4.05 | 3.89 | – | |
| seat 1 / seat 2 wins | 51.0 / 49.0 % | 53.2 / 46.8 % | 51.5 / 48.5 % | 47–53 % | yes |
| decisions / turn | 1.60 | 1.70 | **2.77** (1.70 without the roll) | ≤ 2.4 | no (the roll is a choice now) |
| dull turns | 9.8 % | 9.4 % | **0.4 %** | ≤ 10 % | yes |
| takeovers / game, leader : trailer | 1.18 : 0.62 | 1.25 : 0.70 | **0.61 : 0.51** | trailer ≥ leader | no (1.9 : 1 → 1.2 : 1) |
| vault paid out / game | 2,999 | 3,064 | **981** | ≤ 1,000 | yes |
| "paid less toll" wins | 78.9 % | 80.7 % | 81.5 % | ≤ 70 % | no |

3 and 4 players (no research targets; fair shares 33 / 25 %):

| metric | 3p v2 normal → v3 | 4p v2 normal → v3 |
|---|---|---|
| normal CPU vs "always yes" | 50.1 → **66.9 %** | 37.6 → **53.9 %** |
| normal CPU vs easy | 47.4 → 46.4 % | 41.2 → 36.4 % |
| normal CPU vs "plain" | – → **51.5 %** | – → **39.6 %** |
| set wins | 39.8 → 14.1 % | 22.9 → 5.2 % |
| mean rounds | 22.38 → 24.39 (+9.0 %) | 19.66 → 20.68 (+5.2 %) |
| last at R10 wins | 19.9 → 19.9 % | 11.6 → 10.0 % |
| leader at R10 wins | 49.1 → 49.5 % | 42.6 → 45.6 % |
| lead changes / game | 6.55 → 5.76 | 8.36 → 7.20 |
| seat wins | 36.5 / 32.9 / 30.6 → 33.7 / 34.0 / 32.3 % | 25.6 / 28.4 / 25.1 / 20.9 → 27.9 / 25.0 / 24.3 / 22.8 % |
| takeovers leader : trailer | 3.01 : 1.94 → 1.49 : 1.31 | 4.88 : 3.60 → 2.69 : 2.36 |
| decisions / turn · dull turns | 1.58 · 8.8 % → 2.70 · 0.2 % | 1.56 · 8.2 % → 2.67 · 0.1 % |
| vault / game | 3,309 → 1,235 | 3,367 → 1,351 |

What the strategy mode does at the table (2p, normal CPUs): 34.7 % of rolls use one die, 88.4 % aim
(29.0 % of rolls are decided by the assist), 3.3 start investments per game, 0.48 set alerts per game of
which 53.6 % are broken (499 of 515 breaks by a block-buy; 0.25 block-buys per game, + 0.03 stopped by a
shield). Set wins now come mostly from buying the last piece (342 of 416), not after a travel move (5 %;
was 56 %).

### Ablation (2 players, strategy mode, one flag off, 2,000 seeds)

| off | rounds | set wins | last at R10 wins | vault / game | takeovers L : T | vs "always yes" | vs "plain" |
|---|---:|---:|---:|---:|---|---:|---:|
| (all on) | 26.80 | 20.8 % | 38.8 % | 981 | 0.61 : 0.51 | 83.0 % | 70.1 % |
| strideChoice | 25.46 | 19.5 % | 37.1 % | 1,020 | 0.58 : 0.53 | 78.7 % | 63.9 % |
| skillThrow | 26.22 | 19.8 % | 37.6 % | 951 | 0.60 : 0.54 | 76.0 % | 58.8 % |
| startInvest | 27.08 | 27.1 % | 38.1 % | 978 | 0.90 : 0.72 | 83.3 % | 68.1 % |
| monopolyNotice | 24.94 | 36.0 % | 39.3 % | 904 | 0.39 : 0.33 | 82.1 % | 68.1 % |
| chaseTakeover | 26.67 | 22.4 % | 37.1 % | 971 | 0.62 : **0.37** | 83.5 % | 71.0 % |
| newsForecast | 26.60 | 24.1 % | 39.3 % | 960 | 0.55 : 0.48 | 81.0 % | 69.2 % |
| vaultCap | 26.58 | 23.4 % | 41.0 % | **3,256** | 0.95 : 0.71 | 80.9 % | 70.2 % |

Reading it: the stride and the aimed throw carry most of the skill gain (vs "always yes" −4.3 / −7.0 pp
without them); the set alert is what halves the set wins (36.0 → 20.8 %); start investment makes cities
dearer to take (takeovers 1.62 → 1.12 per game) and so also lowers set wins; the chase multiplier is the
one that moves takeovers toward the trailer (0.37 → 0.51 per game, +38 %); the vault cap is the vault.

### SKILL_CAP (2 players, strategy mode, 2,000 seeds)

| SKILL_CAP | rolls the assist decides | vs "always yes" | vs "plain" | vs easy | set wins | rounds | leader at R10 wins |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 (stride only) | 0 % | 76.0 % | 58.8 % | 52.3 % | 19.8 % | 26.22 | 62.4 % |
| 0.4 | 19.1 % | 79.0 % | 65.7 % | 59.3 % | 22.3 % | 26.52 | 62.8 % |
| **0.6** | 29.0 % | 83.0 % | 70.1 % | 63.6 % | 20.8 % | 26.80 | 61.2 % |
| 0.72 | 35.3 % | 84.8 % | 71.4 % | 66.3 % | 23.4 % | 26.64 | 59.9 % |

**0.6 stays the default.** Each step up adds skill gap, but 0.4 → 0.6 is worth +4.0 pp against
"always yes" and 0.6 → 0.72 only +1.8 pp, while the assist then decides a third of all rolls (a perfect
two-dice low throw lands 2–5 about 80 % of the time instead of 71 %): the dice would stop being the
drama the research wanted to keep. Length, set wins and comebacks do not move with the cap (within
noise), so the choice is skill gain against dice control, and 0.6 is the knee.

### Tuned constants (`src/engine/economy.ts`, CPU knobs `AI_TUNING` in `src/engine/ai.ts`)

| constant | value | how it was chosen |
|---|---|---|
| `SKILL_CAP` | 0.6 | table above |
| `blockSurcharge` | 2 (× value, paid to the owner) | 2p set wins with block-buy at the takeover price only: 10–13 %; + 1 × value 13–19 %, + 2 × 20.8 %, + 2.5 × 22.3 % (owner-paid). 2 is the smallest that reaches the 20 % floor. |
| `blockHubFee` | 0 | hub wins stay 5.4 % of 2p games without a fee (v2: 17.7 %); a 500 fee only added 1.6 pp of hub wins — not needed |
| `chaseBase` / `chaseRange` / `chaseSpan` | 2 / 0.5 / 2 | the 1.5–2.5 × range is the research's; span 1.5 or 4 changed takeovers by < 0.03 per game, so the round "half / twice the assets" scale stays |
| `chaseSaleRate` | 0.75 | keeps the sale headline's 1.5 × at equal assets |
| `investMaxLevel` | 3 (hotel) | the research's rule; villa-only (1) raised set wins (10.1 → 16.3 % before the surcharge was tuned) but left a nearly empty choice (1.9 invests a game) |
| `vaultCap` / `vaultSeedCapped` | 500 / 20 | cap 800 + 50 → 1,445 a game; 500 + 30 → 1,111; 500 + 20 → 981; 400 + 0 → 614 |
| `AI_TUNING.investFactor` / `investReserve` | 3 / 2 | the CPU invests only with 3 × the cost in hand and 2 × its toll reserve left: 3.3 invests a game instead of 10.7, and as strong (49.3 % head to head against the eager CPU, 2,000 seeds) while leaving cities cheap enough to take (set wins 13.0 → 19.1 % at a 1 × surcharge) |
| `AI_TUNING.chaseTake` | 1.9 | the CPU takes over a built city for its value when the chase multiplier is ≤ 1.9 × (trailer takeovers 0.41 → 0.52; strength unchanged, 49.5 %) |
| `AI_TUNING.doublesValue` | 60 | value of rolling doubles in the stride choice |

### Not reached, and why

* **vs easy ≥ 65 %** (63.6 %): the easy CPU uses the stride too (only for a clear gain) and aims with
  accuracy 0.25; the gap is +3.1 pp over v2 normal. Making easy weaker would reach it, but the target is
  about the normal CPU's skill, not about weakening the opponent.
* **Set win p10 ≥ round 15** (12): sets are still completed early when the dice line up; the alert now
  gives the opponents a turn, and only 0.5 % of games end on a set before round 10.
* **Decisions per turn ≤ 2.4** (2.77): every roll is a choice now (stride × aim); without the roll the
  rate is 1.70, and dull turns fell from 9.8 to 0.4 %.
* **Takeovers by the trailer ≥ the leader** (0.51 vs 0.61): the trailer has less cash; the chase price
  and the CPU's chase takeovers moved the ratio from 1.9 : 1 to 1.2 : 1.
* **"Paid less toll" wins ≤ 70 %** (81.5 %): dodging tolls with the stride is now a skill, so paying
  less toll is partly the better player's doing — it predicts the winner as much as before.
* **3 and 4 players**: set wins fall to 14 % / 5 % (from 40 / 23 %): with two or three opponents each
  allowed a block-buy, few alerts survive. No target was set for them; a per-player-count surcharge is
  the lever if tables find sets too hard to win.
* **Search player ≥ 55 %** (50.0 % ± 6.9 over 200 games; version 2: 55.0 % ± 6.9, the research's run
  50.5 %): a search on top of the CPU still finds no clear headroom. It changed the CPU's move on 13.8 % of
  decisions (version 2: 7.3 %) and won no more. What the new choices reward is measured instead by the
  "plain" CPU, the same CPU blind to them: 70.1 % (2p), 51.5 % (3p, fair 33 %), 39.6 % (4p, fair 25 %).
  Two pitfalls found on the way: (1) reducing a tried move with the game's own seed lets the search see
  the roll each stride / aim is about to get (85.6 % with that peek) — the script now reseeds every tried
  move; (2) a noisy search (12 rollouts, switch at +1 win) plays strategy mode worse than the CPU (≈ 31 %
  over the first ~210 games, version 2 at the same settings 52.8 % / 400): six roll options a turn with
  close values turn noise into wrong strides. Only the 32-rollout, +3-wins search is reported.

### Reproduce

```sh
npm run skill -- table --players 2 --seeds 2000                         # strategy mode (advanced, v3)
npm run skill -- table --players 2 --seeds 2000 --rules normal --rules-version 2   # the old default
npm run skill -- matchups --players 2 --seeds 2000 --policies yes,plain,easy,normal
npm run skill -- table --off startInvest                                  # ablation
npm run skill -- matchups --cap 0.72 --policies yes,plain,easy            # SKILL_CAP sweep
npm run skill -- expert --seeds 200 --k 32 --cands 3 --margin 3             # search player
```
