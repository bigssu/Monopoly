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
