# Rule levels (쉬움 / 보통 / 고급) — design

Date: 2026-10-04 · Status: design approved by the owner (default level 보통)

## Goal

More meaningful decisions per turn and a tense ending, without overwhelming new players: the
owner picks the rule level when setting up a game. Research basis: Modoo Marble (late-game toll
escalation, olympics stacking, tourist-spot growth, double-up bonus game, dice gauge), Brandon
Rollins "choice on top of randomness" (card choice), catch-up without blue shells.

## Levels

| Level | Rules on |
|---|---|
| 쉬움 `easy` | today's rules, unchanged (old saves load as `easy`) |
| 보통 `normal` (default) | B1 late toll · B2 card choice · B3 manual keep-cards · B4 olympics |
| 고급 `advanced` | 보통 + B5 hub growth · B6 double-up · B7 dice gauge |

`Settings.rules?: 'easy' | 'normal' | 'advanced'` (missing ⇒ `easy`); `ruleFlags(settings)`
derives one boolean per rule so the engine never compares level names.

## Rules

**B1 Late toll.** With a round limit, the last five rounds raise every toll: remaining rounds
4,3,2,1,0 → ×1.25, ×1.5, ×1.75, ×2, ×2.25 (`lateTollMultiplier(state)`, applied in `tollOf`).
The first draft's ×1.5 … ×3.5 ended 76–80 % of simulated games in a late bankruptcy (sim, 500
seeds); the gentler ramp keeps a real final stretch without turning it into a bust race. A
"막판!" banner + dealer line on the first escalated round. Unlimited games: off.

**B2 Card choice.** An event space draws two different cards; the player picks one
(phase `cardChoice { options: [CardId, CardId] }`, action `ChooseCard { cardId }`). CPU: static
card value table (money in > keep-cards > neutral moves > money out).

**B3 Manual keep-cards.** Toll Pass: when a toll is due and the payer holds one, phase
`useCard { card: 'toll-pass' }` (UseCard / Pass) instead of auto-use — no wasting it on a 10 toll.
Guard Shield: when a takeover hits a shield holder, the *owner* decides (`useCard { card:
'shield' }`). Escape Pass is already manual. CPU: use the pass if toll ≥ 25 % of cash; always
shield.

**B4 Olympics.** Holding the festival again on the city that already has it raises its level:
×2 → ×3 → ×5 (`state.festivalLevel` 1..3); moving the festival resets to ×2.

**B5 Hub growth.** Each landing on an owned hub raises that hub's toll step ×1 → ×2 → ×3 → ×4
(`state.hubVisits[index]`, capped), reset when the hub changes owner.

**B6 Double-up.** Landing exactly on Start offers a bonus game on that salary: guess odd/even of
a die; right → stake doubles (up to ×8, three wins), wrong → the stake is lost; stop any time
(phase `doubleUp { stake, wins }`, actions `DoubleUpGuess { parity }` / `DoubleUpStop`). Seeded
RNG. CPU stops after one win.

**B7 Dice gauge.** Holding Roll fills a gauge; where it is released (0..1) biases the roll a
little: with probability `0.35 × |g − 0.5| × 2` the engine draws a second roll and keeps the one
closer to the low (g < 0.5) or high (g > 0.5) end. `Roll { gauge? }`; seeded, deterministic;
the odds are shown next to the gauge. CPU rolls neutral.

## Engine, saves, AI

- New state: `festivalLevel`, `hubVisits` (both optional, default when absent). New phases as
  above, each validated in `save.ts`. Additive and optional like the earlier `spacesPerSide`:
  `SAVE_VERSION` stays 1 and `migrate()` fills `rules: 'easy'` into older saves. Reducers stay
  pure; every random draw goes through the seeded RNG.
- `chooseAction` handles every new phase; `defaultAction` (timer) picks the safe choice
  (keep card for later, stop double-up, first card option).
- Balance: `npm run sim` per level (victory mix, seat advantage, game length) before/after,
  numbers recorded in `docs/BALANCE.md`; tune constants in `economy.ts` only.

## UI

- Setup: segmented "규칙 난이도" (쉬움/보통/고급) with the rule list of the chosen level.
- Prompts: card choice (two cards side by side), use-card yes/no, double-up odd/even/stop.
- Board: festival level badge (×2/×3/×5), hub step pips; late-toll banner on the round strip.
- Dice gauge on the Roll button (breathing fill, release to roll; motion tokens).
- Dealer: new situations (late toll, card choice, use pass/shield advice, olympics up, hub grow,
  double-up guess/win/lose/stop, gauge hint) generated with `scripts/dealer/gen-voice.mjs`.

## Testing

Engine unit tests per rule (multipliers, phase flow, CPU choice, determinism with a fixed seed,
v1 save migration), save round-trip for every new phase, AI legality fuzz (sim with all rules on),
UI e2e for card choice and use-card prompts at 보통.

## Order

B1 + B4 + B5 (toll math) → B2 + B3 (new phases) → B6 + B7 (mini-game, gauge) → Setup UI +
dealer lines → balance pass.
