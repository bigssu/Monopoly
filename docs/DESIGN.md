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

Panel contents (always visible): avatar token + name, cash (big, animated count-up/down), total
assets with status badges (섬/island turns, cards held), the owned chips, a subtle "your turn"
glow ring.

**Player panel (owner review 2026-10-06: "show only what I bought", "far too long").** The card
lists **only the spaces that player owns**: one chip per city / hub (its landmark picture on the
group colour, hubs round), colour groups in board order with hubs last (`ownedChips`,
`src/ui/panels/owned.ts`), wrapping in rows. A complete colour (or every hub) gets a gold rim, a
landmark a thicker gold rim + ★, villa / building / hotel 1–3 white pips, the festival city a red
dot. Nothing is drawn for unowned or other players' spaces, and there is no legend; owning nothing
shows one muted line ("아직 땅이 없어요" / "No land yet"). The chips area is a button (tap: the
dealer, or a toast, explains it) labelled "소유한 땅 N곳" / "Land owned: N". The card is **only as
tall as its content**: the panel box (layout.ts, unchanged, so the board never moves) keeps its
size and the card stands on its seat edge (the box's pre-rotation bottom; fixed view N / E: the
top edge, `cardOnTop`); the rest of the box is empty and lets taps through. Chip size comes from
the box (`PlayerPanel.setBox`, `chipSize`): about half the token, shrinking only if the rows would
not fit. Effects keep their targets on the card: coins, wallets and floats use the card's rect,
which the view computes from the layout and `PlayerPanel.cardHeight()` (`cardRect`, no DOM read)
and recomputes when the chip rows change. 1600×1000: 479 → about 180 px tall (two chip rows about
225); 800×450: 216 → about 100 px. Comparison: `docs/assets/panel-simplify-before.png` / `-after.png`.

#### Fixed view (one human against CPUs)

When **exactly one** player is human and at least one is a CPU, the game is solo play on one
screen, so the screen is fixed to that human and **nothing turns**. Two or more humans, and
all-CPU demo games, keep the table-top model above unchanged. One policy decides this for every
surface: `src/ui/orientation.ts` (`orientationFor(players)` → `mode`, `seat()`, `face()`,
`readers()`); engine seats, turn order and saves are never changed — only what is drawn.

* **Seat remap.** The human is drawn at the bottom (S) wherever they sat in setup: the table is
  turned in quarter steps (k = the human's index in S, E, N, W; drawn seat =
  `CYCLE[(index(seat) − k) mod 4]`), so everyone keeps their place relative to the human and the
  turn order still runs S → E → N → W around the screen. Human at E: E→S, N→E, W→N, S→W;
  at N: N→S, W→E, S→N, E→W; at W: W→S, S→E, E→N, N→W.
* **Stage** stays at 0° for every turn (no rotation animation); prompt cards, the turn banner,
  toasts, the info popover, close-up cards and the dealer all live on it, so they face S.
* **Panels** keep their pinwheel boxes (layout.ts) but are all upright (0°): E / N / W lay out
  like S (narrow and tall), so 800×450 needs no extra room.
* **Board.** The top row would print upside-down for the reader at S, so it is printed upright
  (rot 0) and the two top corners lean like the bottom ones (±45°). The side columns keep reading
  along their edge (sideways, never upside-down). Same rects: hit areas, tokens, effects unchanged.
* **CPU hand** still enters from the CPU's *drawn* edge so it is clear who acts, and lands on the
  control on the upright Stage (its layer turns to the CPU's edge; the target mapping only assumes
  an axis-aligned control, see CpuHand.ts).
* **Money cut-ins** face S: one plaque at the front-centre under the hero (collect-from-all shows
  one total, not four), hero / stamp / hammer upright. Wallets stand upright on their seat's panel
  (where that player's cash is shown) and slide out past the nearer side; coins fly between those
  real positions. The "one away" toast is a single upright copy.
* **Result** faces S and has no ↻ rotate pill.

### 2.2 The Stage

The board occupies the center square. The board's **inner area** (inside the ring of spaces) is
the **Stage**. The Stage rotates (CSS transform, animated 400 ms) to face the seat of the player
who must act (fixed view, §2.1: it never rotates and always faces S). Everything interactive lives on the Stage: the dice (thrown with a press-hold-flick on the
Stage centre, §2.4 "Dice throw"; the "굴리기/Roll" button only when shown in Settings), the
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
reaches in from the CPU's seat edge, presses the control it chose — the dice on the throw pad (a
roll: held while they rattle, then a short flick toward the board centre that the throw follows),
a prompt button (buy, pass, build, bail, the island roll, sell, bid…) or, for board picks (travel, festival, free upgrade, typhoon
target), the board space — and the action is dispatched at the release
(`src/ui/stage/CpuHand.ts`; mapping in `handTarget.ts`; timings `HAND` in `src/ui/fx/motion.ts`).

### 2.4 Feel

* Dice: two big dice on the Stage; press-and-hold shakes them (haptic ticks), a flick throws them
  across the Stage (below), the landed faces are the crisp DOM dice, doubles get a golden flash +
  "더블!" burst.
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

#### Dice throw (owner request 2026-10-06; research `docs/research/07-dice-throw-research.md` §3)

Instead of a roll button, the human's turn invites a throw and the dice are thrown by hand.

* **Gesture.** When a human's roll comes up, the dice pair wobbles three times (~1.2 s,
  transform only, stepped on the 30 Hz clock — not a Web Animation, whose start and end would
  promote and re-raster every layer painted above the dice; the pair is its own layer while
  invited), and once more if nobody has thrown after 5 s; then nothing moves (zero idle load).
  Each lean plays a soft `dice-shake` rattle (gain 0.45: three with the first wobble, one with
  the second; the sfx module's mute applies; no haptic), and the hint strip blinks with each
  wobble: three opacity pulses in ~1.2 s (an `anim()` Web Animation, quantized to the 30 Hz grid,
  on the hint's own layer — `.roll-hint.is-blink { will-change: opacity }` while the human's roll
  card is up — so starting and ending a blink is compositor-only), then it rests fully visible.
  Never perpetual: gate B's calm window stays at zero. A press stops the wobble, the blink and
  any further rattle at once. Not for a CPU's roll. Reduced motion: no wobble, no blink, the
  rattles still play at the same times (sound is not motion). A
  transparent pad (`Stage.armPad`, a `<button>`, `aria-label` from i18n) covers the Stage
  centre: the dice area and the roll card's strip, below the banner / round line, under the
  prompt card and under the dice in paint order (the dice ignore pointers). Press anywhere
  on it: the dice shake (rattle + haptic; the B7 dice gauge swings as before). Release with a swipe
  (≥ 300 px/s over the last 80 ms before the finger last moved, released within 0.1 s of that): a
  **flick** in that direction, converted into the Stage's own frame (so it is right for every seat
  and in the fixed view). Release without one, or Enter / Space on the focused pad: a **weak
  toss** forward (toward the board centre, away from the acting seat). Leaving the pad before the
  release still throws (pointer capture); a cancelled pointer only stops the shake. The roll
  card keeps the tags and the gauge and shows a hint strip ("주사위를 꾹 누르고 밀어 던지세요" /
  "Press, hold and flick to throw") where the button stood.
* **The result is the engine's.** The same `Roll` (+ gauge) is dispatched however the dice were
  thrown; the seeded RNG has decided the faces, the throw only arrives on them (saves, replays and
  the balance simulation are unchanged).
* **Motion model** (`src/ui/stage/throw.ts`, pure, unit-tested): no physics library, no WebGL.
  Each die is a 2D point in the Stage's frame with planar friction (speed ∝ (1 − u)², stopping
  exactly at the end of its roll), reflection off four walls (restitution 0.55 on the normal off
  the dice area's walls, 0.7 off the screen's edges; 0.86 kept on the tangential), and a one-line
  circle separation between the two dice (pushed apart, part of the approaching velocity
  swapped). The spin is the cube rolling (angle = distance / radius × 0.8), so it is proportional
  to the speed and decays with the friction. The end pose is planned (the rolled distance is
  scaled, or a short roll blended, so each die arrives on the engine's face; the same resting
  tilt as before), the second half of each roll rolls it back into its place in the pair (baked
  into the path, so the cube turns on the way home; a flick blends with a smootherstep, zero
  speed and acceleration at the end, so a long way home lands without a jump), and the existing
  `BOUNCE` landing (lift and squash; lower near the top wall) plays over the roll. Up to four
  wall hits sound a `dice-clack` (synthesized, gain by impact). No dust puff: it would cost a
  layer. Time policy (`src/ui/fx/time.ts`): ÷ speed, ×5 on skip; reduced motion: no trajectory,
  the in-place roll (~1 s); headless: instant.
* **Strength = release speed** (owner request 2026-10-06: "the faster my finger pushes, the faster
  and farther the dice fly"). The launch speed and the roll length are monotonic (linear) in the
  release speed, clamped between a gentle minimum and a hard maximum (`flickLaunch`, `THROW.launch`
  / `flickRoll` / `flickMax`); the planner only picks the angles (the leading die within 8° of
  the flick and its spread, the trailing one a few degrees off and 4–8 % slower, 60 ms later) for
  the throw whose dice come to rest nearest home. A faster flick therefore always launches faster,
  runs a longer path, lasts longer and hits more walls; a slow one stays short. "Die/s" = die
  sizes per second (the die is ~100 layout px on a 1600×1000 screen, ×0.92 on screen under the
  roll card); travel and walls measured on that screen, seat S:

  | release (px/s) | strength | launch (die/s) | roll / whole throw (speed 1) | free path, walls (1600×1000, seat S) |
  |---|---|---|---|---|
  | < 300 (tap, Enter / Space) | toss | 4.5 | 1000 ms / **1.06 s** | ~1.5 dice forward, ≤ 1 soft touch, inside the dice area |
  | 300 | 0 | 8 | 1100 ms / 1.13 s | ~2.9 dice, no wall |
  | 600 | 0.11 | 10.9 | 1189 ms / 1.21 s | ~4.2 dice, no wall |
  | 1200 (medium) | 0.33 | 16.7 | 1367 ms / **1.39 s** | ~7 dice, 0–1 wall per die, 1–2 clacks |
  | 1800 | 0.56 | 22.4 | 1544 ms / 1.56 s | ~10 dice, reaches the screen's edge, 1 wall per die |
  | 2400 | 0.78 | 28.2 | 1722 ms / 1.73 s | ~13 dice, 1–2 walls per die |
  | ≥ 3000 (cap) | 1 | 34 (≈ 1.1 die per 30 Hz frame) | 1900 ms / **1.90 s** | 14–18 dice, edge to edge, ~2 walls per die, 2–3 clacks |

  The result is still only the engine's: direction and strength change the look, never the faces.
* **Walls = the screen's edges** (owner request 2026-10-06: "bounce off the outer edges of the
  screen"). A flick's walls are the VIEWPORT (inside the safe-area insets, less a margin of
  max(6 px, 1.2 % of the short side)), mapped into the Stage's frame (`screenWalls`) and inset so a
  whole die stays on screen (0.6 die at the sides, 0.75 at the frame's top for the hop, 0.7 at
  its bottom for the shadow). The frame (pair px → screen px: scale, turn, offset; `frameFrom`)
  is measured from the two dice where they stand when the throw starts (one layout read), so it
  holds the Stage's turn toward the seat and every scale on the way (the dice area's 0.92 under
  a prompt). The Stage turns in quarter steps, so "screen edge" is the physical screen edge for
  every seat: a flick is converted from screen to Stage space by the Stage's angle
  (`screenToStage`), the walls back the other way, and a stroke toward the right edge reaches the
  right edge whether the Stage faces S, E, N or W; in the fixed view the Stage stays at 0°. The
  dice fly over the board's tiles and the player panels, ricochet off the screen border and roll
  back home to the Stage centre. A toss keeps the dice area's walls (`tossBox`), unchanged.
* **Flight layer.** A flick flies in a top-level element created for the throw and removed at
  the landing (`Dice.openFlight`, `.dice-fly`): in `.game`, z-index 38 (over the board and the
  panels at 5, under the effects layer 40, the money stage 45 and the menu 50), inside the safe
  area, `pointer-events: none` (it never takes a tap, nor hides one from a prompt card under it),
  holding one `.dice-fly-frame` turned and scaled like the Stage (a static 2D transform: no layer
  of its own), so the dice keep drawing in their own pair px and keep facing the seat. A toss
  stays in the pair, as before.
* **Rendering paths**, chosen by the same switch as the canvas effects (`fxQualityOn`):
  * canvas effects on (the web build by default): one temporary software canvas in the flight
    frame, sized to the throw's bounding box (an axis-aligned box on the screen too, the turns
    being quarter turns; up to most of the screen for a strong flick), dirty-rect cleared,
    removed at the landing — one layer while flying, as the old tumble;
  * canvas effects off (the **Android app by default**: the owner's Samsung tablet drew canvases
    as white boxes): no canvas at all; the two DOM cubes move into the flight frame (an invisible
    `.die-ph` stand-in keeps each one's place in the pair), are posed (`pose`) and translated on
    the 30 Hz clock — one layer per die while flying — and go back to the pair at the landing.
  Either way the overlay exists only while the dice fly (peak layers as before: two dice, or one
  canvas), nothing runs after the landing (0 clock callbacks). Dev A/B: `?dev=1&dice=dom|canvas`.
  Reduced motion keeps the in-place tumble (a canvas over the pair, as before).
* **Setting** "굴리기 버튼 보이기 / Show roll button" (default off): the roll button and its "꾹
  누르면 주사위를 흔들어요" hint come back beside the pad and work exactly as before.
* **CPU.** The hand presses the dice on the pad, holds them while they rattle (`HAND.holdRoll`),
  flicks a short stroke toward the board centre (`HAND.flick`), and the throw follows the stroke
  at a medium strength picked per turn (`cpuFlick`: 900–2200 px/s and ±12°, from the game's seed
  and the turn — random-looking, the same on a replay): some CPU throws reach the screen's edges,
  some stay short, none is the maximum.
* Tests: `src/ui/stage/__tests__/throw.test.ts` (walls, faces, direction, the strength mapping and
  its monotonicity, the clamp, durations, the screen walls for every seat, the seat mapping, the
  toss unchanged, `cpuFlick`), `e2e/dice-throw.spec.ts` (flicks in four directions over the
  screen, slow vs fast on both render paths, turned seats reaching their screen edge, the toss,
  keyboard, cancel, canvas path, the setting, reduced motion, the wobble with its rattles and the
  hint's blink, a press stopping them). Filmstrip of a fast flick: `docs/assets/dice-flick-filmstrip.png`.

#### Skill throw (strategy mode; owner request 2026-10-08; research `docs/research/11-skill-throw.md`)

In a **strategy** game (`ruleFlags().skillThrow` / `strideChoice`: advanced rules, version 3) the throw
also carries the player's skill: the press is timing, the drag is the aim, the release throws. In a
**casual** game nothing below appears: the throw above stays exactly as it was (press, shake,
flick; the strength cosmetic). Code: `src/ui/stage/skill.ts` (pure rules), `SkillPad.ts` (the
ring, the readout, the arrow, the chips), `prompts.ts` `rollPrompt` (the pointer), `CpuHand.ts`
(the CPU acting it out), `skillGuide.ts` (the guide), `Stage.rollResult` (the result line).

* **Stride chips** `하나 1–6` / `둘 2–12` (default 둘) in the roll card, above the hint; a tap
  switches. One die: the second die hides and the first stands centred where the pair stood.
  A switch lights the reachable spaces (1–6 or 2–12 ahead; an express ticket doubles) for 1.2 s ×
  pace with the board's static highlight outline (`Board.highlight`, in the player's colour; gone
  after, no layer stays).
* **Press = timing.** A ring (SVG stadium around the dice in the pair, so it turns with the Stage)
  shows a track and a **green band at the top** at rest. While held, a needle runs one lap per
  **1.4 s × pace / 2** (1.4 s at the default pace "보통", 2.1 s at the slowest, never below 1 s),
  starting at the bottom, clockwise, the lap so far filled in gold. **Band = ±12 % of the lap**
  around the top (86° of the ring, ~336 ms of a 1.4 s lap); accuracy = 1 at the band's centre,
  falling linearly to 0 at its edges, 0 outside (`accuracyAt`). The live accuracy reads beside the
  ring (`정확 73%`, green ≥ 75 %, amber ≥ 35 %, red above 0). It **freezes** the moment the drag
  leaves the dead zone (or at the release of a tap): the needle stops there, the readout gets a
  gold rim. The value sent is the one shown (stepped on the 30 Hz clock).
* **Drag = aim.** An arrow from the ring's edge in the drag's direction, as long as the drag
  (stage px), in a top-level layer (`.skill-aim-layer`, z 38, created at the drag, faded out 0.32 s
  after the release; its frame turned and scaled like the Stage, so the label reads upright for
  the acting seat and a long arrow may reach over the board). Behind it the guide shows the three
  zones with ticks at the thresholds; the tip label names the aim and its band:

  | drag length (die sizes; the die ≈ 100 px at 1600×1000, ≈ 43 px at 800×450) | zone | colour | label | sends |
  |---|---|---|---|---|
  | < 0.35 (at least 16 px) | dead zone = a tap | — | — | no aim (a weak toss) |
  | 0.35 – 1.5 | 작게 | blue `#5BB2FF`, ▼ | `작게 2–5` (one die `작게 1–2`) | `aim: 'low'` |
  | 1.5 – 2.7 | 보통 | grey `#C3CDD6` | `보통` | no aim |
  | ≥ 2.7 (the arrow stops at 3.6) | 크게 | orange `#FF9A3D`, ▲ | `크게 9–12` (one die `크게 5–6`) | `aim: 'high'` |

  The label is kept on the screen (pulled back along the arrow near an edge).
* **Release = throw.** `Roll { playerId, stride, accuracy, aim? }` (no aim for 보통 or a tap). The
  throw goes the arrow's way; its **strength is the arrow's length** (`dragStrength`: linear from
  the dead zone to 3.6 die sizes → `launchOf`, the same launch table as a casual flick's), so
  작게 throws soft and short and 크게 hard and far, off the screen's edges. One die: one cube is
  thrown (`planThrow` takes one or two dice; the frame of a lone die takes the Stage's turn,
  `frameFromOne`) and lands on the engine's face (`DiceRolled.dice = [die, 0]`).
* **Result line** under the dice after the landing, from `DiceRolled { stride, aim, accuracy }`:
  `정확 92% · 작게 노림 → 성공 (4)` (green) / `… → 빗나감 (6)` (red); hit = the total is in the
  aimed band. Nothing for 보통, a tap, the island roll or casual mode. Read 1.5 s × pace / 2, then a
  0.2 s fade; UI feedback (no `EVENT_EXTEND`), nothing waits for it.
* **Keyboard** Enter / Space on the focused pad: 보통 with the chosen stride. The chips are buttons.
* **Reduced motion** (the app's setting): the ring does not run; the readout alone counts the
  accuracy as text on the same timing (bigger); the arrow and its label still show; the throw is
  the in-place roll.
* **First roll guide**: the first time a human rolls in a strategy game on this install (pref
  `skillGuideSeen`), a card on the Stage (facing that player): 누르기 → 초록에서 끌기 → 길이로 노리기,
  a small DOM/SVG picture each (no canvas), a line on the odds ("결과는 장담할 수 없어요"), 알겠어요.
  Settings → "손맛 던지기 안내 · 다시 보기" opens it; the rules screen has it as page 9.
* **CPU.** The engine's AI picks `stride`, `aim` and `accuracy`; the controller hands that action to
  the hand (`CpuHand.press`), which acts out exactly it: switches to one die if the AI chose it (the
  reachable spaces light), presses (the needle runs at least 0.45 s, then stops at the phase of the
  AI's accuracy, before or after the top by turn, `phaseFor`), drags the arrow to the middle of the
  AI's zone toward the board centre (0.38 s, `HAND.drag`), and releases; the result line shows as
  for a person. A strategy CPU roll takes ~0.5–1.9 s longer than a casual one (the needle's wait).
* **Zero idle.** At rest the ring is static SVG; the needle, the readout and the arrow step on the
  shared 30 Hz clock only while pressed; the arrow layer exists only while dragging.
* **B7 dice gauge** (advanced, versions 1–2) is not shown in strategy games (v3 ignores `gauge`);
  older saves keep it.
* Tests: `src/ui/stage/__tests__/skill.test.ts` (phase → accuracy, the band, `phaseFor`, the
  period and the pace, length → zone / strength (monotonic) / launch, the reach set, the bands,
  one-die faces, the result line, the mode switch), `throw.test.ts` (`launchOf`, a one-die throw,
  `frameFromOne`), `e2e/dice-throw.spec.ts` "skill throw (strategy mode)" (casual unchanged; press
  into the band + short drag → aim low ≥ 0.9 with the arrow, readout and result line; long → high;
  middle and tap → no aim; keyboard; one die; the guide once + Settings; reduced motion; the CPU
  acting out its AI roll; a 20-turn strategy CPU game). Screenshots `docs/assets/skill-throw-*.png`.

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
ordinary destinations are separate rounded cards, and group colors appear as a small badge rather
than continuous property bands. Corner indices and cell centers remain unchanged;
visible circular corners use matching circular hit regions. These changes reduce specific visual similarities;
they do not establish legal clearance for a store release.

### Ownership and buildings (owner feedback 2026-10-06: "fill the card with the owner's color, show the building outside the card")

* **Owner fill.** An owned city or hub card is filled with the owner's full player color
  (`palette.hex`). Its name and price use `inkOn(color)` (`src/content/palette.ts`): white where
  white reaches 4.5:1, else a deep shade of that color (in the current palette every color takes its
  deep shade, ≥ 5:1; the palette's `dark` is under 2:1 on its own color). A soft halo (paint-order
  stroke) sits behind the text. The city art stays on a white plate and the group badge keeps a white
  ring, so the color group still reads. The price stays visible on owned cards. Taking over a space
  re-renders the card in the new owner's color (the existing stamp animation plays). When a space
  goes back to the bank (sale, bankruptcy to the bank), the card returns to the empty look, which is
  the static base raster.
* **Pop-out buildings.** A built space shows ONE element for its current level: villa, building,
  hotel or landmark (`.bb` in `.board-bldgs`, `Board.renderBuilding`). The roof or accent is in the
  owner's color, with a white rim and a soft shadow; the landmark has a static glow. It stands on
  the card's inner edge (the edge facing the Stage). 30 % of the box is on the card and 70 % sticks
  out over the inner area. It is upright for that side's reader (the card text's rotation). In the
  fixed view (§2.1) the top row is printed upright for S, so its buildings hang below the card (0 %
  on the card, so the name stays clear) and are capped to the same reach. Box size is a share of the
  space width: villa 55 %, building 65 %, hotel 75 %, landmark 95 %, with a minimum of about 22 px.
  The price, badge and city art move down below the part that stands on the card, with a 6-unit gap
  measured to the price's full line box (Noto Sans KR ascent 1.16 em, not just the digits). The
  offset comes from the same `onCard` the building uses (`cardFace`, `src/ui/board/geometry.ts`),
  tested for every level, side, 7/8/9 per side, both views and the four tested viewports' minimum
  building sizes.
* **Corners.** When both spaces next to an inner corner are built, the one that sticks out further
  slides away from the corner along its edge until it clears the other's reach. Ties go to the
  space after the corner; in the fixed view the top row slides. Both shrink by the same factor if
  that is needed to keep the sliding one on its own space. Geometry: `buildingLayout`
  (`src/ui/board/geometry.ts`), tested for 7/8/9 per side in both views: inside the board, no two
  buildings overlap, reach ≤ `BLD_OUT_MAX` (66.5 % of a space width).
* **Layers.** ring (SVG + base raster) < Stage backdrop (`.board-stage-bg`, now drawn by the board)
  < buildings < highlight marks < Stage content < tokens < effects. Buildings never take taps
  (`pointer-events: none`). The Stage's bottom padding (the acting seat's edge) clears `--bld-out`
  (the deepest reach), so the dice, the roll control and the prompt buttons stay off that edge's
  buildings. The padding is constant, so nothing moves between prompts. The top keeps its small
  margin: padding both sides squeezed the 800×450 prompt cards (toll table cut off). So the turn
  banner can cover the middle of the far row's buildings, and a wide prompt card can cover
  side-column buildings while it is open.
* **Build cut-in.** The hero building flies to the pop-out building's box (`MoneyHost.buildingRect`),
  and the building pops as it lands (`Board.popIcon`: a stepped `scale`, no compositor layer).
* **Performance.** The fill is part of the live card SVG, which owned spaces already had (no
  re-raster). There is at most one element per built space, it is static at rest, and it creates no
  new layer (it paints under the Stage's own layer).

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
  when landing on their own city — like 모두의마블 — no remote building; the old `buildAnywhere` setting is
  ignored, kept only so saves load): L1 `0.50P`, L2 `0.60P`, L3 `0.70P`, L4 landmark `1.00P`. Landmark requires L3.
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

### 4.2 Rule levels and the fun rules (rules version 2, 2026-10-06)

Setup picks a rule level; the engine only reads flags (`ruleFlags(settings)` in
`src/engine/settings.ts`). Spec of the first levels: `docs/superpowers/specs/2026-10-04-rule-levels-design.md`.
Why the fun rules exist and how they were measured: `docs/research/08-fun-analysis.md`; numbers:
`docs/BALANCE.md` "Fun rules".

| Level | Rules |
|---|---|
| 쉬움 easy | §4 only (with §4.1). |
| 보통 normal (default) | late toll · card choice (one face down) · manual toll pass / shield · typhoon targeting · finish the round after a first bankruptcy + seat bonus · **대축제 Grand Festival** (the festival held again on the same city: ×2 → ×3 → ×5) · and the version-2 rules below marked N |
| 고급 advanced | normal + hub growth · double-up at Start · dice gauge · the version-2 rule marked A |

Rules version 2 (`Settings.rulesVersion = 2`, set by `defaultSettings()`; a game keeps the version it
started with, so saves from before play on with the old rules):

* **N 행운 금고 (lucky vault)** — bail, card fines (벌금, 수리비) and double-up losses go into the donation
  pot instead of the bank, and the bank adds **100** to the pot at the start of every round (from
  round 2). Landing exactly on Start (or the 복지기금 지급 card) still takes the whole pot.
* **N 뉴스 속보 (news flash)** — at the start of rounds 4, 8, 12, … one headline, for that round
  (no repeat until all six have run; one with nothing to hit is skipped):
  통행료 대목 (every toll ×2) · 지진 (one colour group with buildings: every building there −1 level,
  landmarks stand) · 건설 붐 (build costs ×½) · 인수 세일 (takeover price 1.5 × value) ·
  나눔의 날 (the richest gives 10 % of cash to the poorest; MoneyReason `news`) · 금고 대박 (the bank
  matches the pot, at least 200). The round line shows the active one (`통행료 ×2`, `건설비 ½`, `인수 1.5배`).
* **N 역전 카드 (comeback cards)** — two cards join the deck (appended, so the original deck order and
  every easy-rules outcome are unchanged): **땅 맞교환** (choose an opponent's non-landmark city; it
  becomes yours and your least valuable non-landmark city becomes theirs, buildings stay with the land;
  a shield blocks it; Pass keeps your city) and **선두 습격** (the richest other player pays you 20 % of
  their cash; no effect if you are the richest). When the drawer is last by total assets and the leader
  has ≥ 1.25 × their assets, the first (face-up) card offered comes from 맞교환 / 습격 / 복지기금 지급 /
  건물 보너스 / 복권.
* **N 더블 보너스 카드 (doubles bonus card)** — rolling doubles (not the third, which still sends you
  to the island) draws an event card after the landing resolves, then you roll again. One per roll.
* **N 모 아니면 도 (all or nothing)** — at the tax office: pay 10 % of cash, or roll one die: 4–6 pays
  nothing, 1–3 pays double (same expected cost). Either way the money goes to the pot.
* **A 되찾기 (win-back)** — after a takeover, the player who lost the city may take it back for
  **1 × value** (not 2 ×) when they land on it, while the taker still owns it. A win-back gives no new
  right; a shield still blocks it.

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
    fx/       animate.ts (event → promise-based animation sequencer), floats.ts, vfx/ (canvas
              effects engine), money/ (money cut-ins)
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
