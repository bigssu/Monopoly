# Balance notes — Lot & Roll engine

Owner: engine. Source of truth for numbers: `src/engine/economy.ts` (money rules),
`src/content/board.ts` (prices), `src/content/cards.ts` (card amounts).
Reproduce everything below with `npm run sim` (500 seeds, 4 × normal CPU, default settings);
flags: `--seeds N --players 2|3|4 --rounds 10|15|20|30|inf --level easy|normal --cash N --auction --elimination --no-takeover --build-anywhere --strict`.

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
