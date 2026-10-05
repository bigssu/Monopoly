# Dealer: voiced mascot host — design

Date: 2026-10-04 · Status: approved design, pending spec review

## Goal

Make the table game livelier and easier to follow: the launcher's traveler boy becomes an on-stage
**dealer/host** who reacts to every important moment with a facial expression, a speech bubble and
(in Korean) an expressive Pixar-style voice, and who gives dealer-style advice on decisions
("저라면 업그레이드를 고려하겠어요"). Players choose how much he talks.

Success: a player who has never read the rules can follow a game from the dealer alone at the
"전체" level; a veteran at "최소" hears only the big moments; nothing he says ever blocks play.

## Decisions (agreed with the owner)

| Topic | Decision |
|---|---|
| Character | The traveler boy from `docs/assets/play-icon-512.png` (teal cap, orange neckerchief, blue jacket, backpack). |
| Sprites | ~12 expressions + 2 talking frames, generated with Gemini `gemini-3-pro-image` from the icon as reference, on flat magenta, keyed to alpha, 320 px WebP (~16 KB each; probe verified). |
| Voice | ElevenLabs voice **Krys** (`1W00IGEmNmwmsDeYy7ag`), model `eleven_v4`, Korean. Bright, excited, Pixar-like delivery. |
| Placement | Inside the board-centre Stage next to the prompt card; rotates with the Stage toward the acting seat. |
| Levels | Setting "딜러 음성": 끔 / 최소 / 적당 (default) / 전체. |
| Language | Voice only when the UI language is Korean. English UI shows English subtitles in the bubble, no voice. |
| Sound off | Voice follows the existing sound switch and volume. |
| Shipping | Only compressed assets in the app: Opus mono ~20 kbps `.ogg` voice, WebP sprites. Raw generations are cached outside git. |

## Architecture

```
engine events / PromptOpened ──► dealer/director.ts ──► Dealer.say(line)
                                   (level filter,            │
                                    cooldown, variant,       ├─ sprite: expression → talk frames → expression
                                    advice via chooseAction) ├─ bubble: ko text / en subtitle
                                                             └─ audio/voice.ts: fetch + decode + play .ogg (ko only)
```

### Units

| File | Purpose | Depends on |
|---|---|---|
| `src/ui/dealer/lines.ts` | **Line catalog, single source of truth**: `id`, `level` (`min` / `normal` / `full`), `priority`, `expr`, `ko`, `en`. Situations with several takes use ids `buy.done.1..n`. Read by the app and the generators. | — |
| `src/ui/dealer/director.ts` | Pure-ish mapping: `(prev state, events, next state, level) → Line[]`; prompts → advice. Cooldown (same situation not twice within N turns), random variant. UI only: never touches engine RNG or state. | `lines.ts`, engine types, `@/engine` `chooseAction` for advice |
| `src/ui/dealer/Dealer.ts` | DOM component on the Stage: `<img>` sprite + speech bubble. `say(line)` → expression → talk-frame flap while the voice plays (or for a reading time when silent) → back to the expression. Interrupts only for higher priority; lower priority while busy is dropped. (2026-10-06: the bubble lives on its own small layer; after a line the sprite keeps that expression until the next line, game event or input, then idle — zero idle paint, `docs/PERFORMANCE.md` "라운드 2".) | `voice.ts`, `fx/time` (`gamePace`) |
| `src/ui/audio/voice.ts` | Lazy `fetch` + `decodeAudioData` of `voice/<id>.ogg`, small LRU cache, play/stop, returns duration; ducks SFX/BGM gain while speaking. Shares the existing AudioContext/master volume. | `synth.ts` context |
| `src/ui/shell/prefs.ts` | `dealerVoice: 'off' \| 'min' \| 'normal' \| 'full'` (default `normal`). | — |
| `src/ui/screens/SettingsScreen.ts` | Segmented row "딜러 음성". | prefs |
| `scripts/dealer/gen-voice.mjs` | Reads the catalog, calls ElevenLabs (`mp3_44100_128` raw into `scripts/dealer/.cache/`), skips ids whose text hash is unchanged, transcodes with ffmpeg to `public/voice/<id>.ogg` (libopus, mono, 20 kbps, 24 kHz, trimmed silence), writes `public/voice/manifest.json` (id → duration ms). | ElevenLabs key `ELEVENLABS_API_KEY`, ffmpeg |
| `scripts/dealer/gen-sprites.mjs` | Gemini generation per expression prompt (raw into `.cache/`), ffmpeg `colorkey=0xFF00FF:0.30:0.10`, 320 px WebP q80 to `public/dealer/<expr>.webp`. | `GOOGLE_API_KEY` (header `x-goog-api-key`), ffmpeg |

### Expressions (sprites)

`idle` (smile) · `talk-a`, `talk-b` (mouth open / half, for lip flap) · `point` (wink + point, the
icon pose: advice) · `cheer` (both arms up: celebrations) · `surprised` (big toll, takeover) ·
`sad` (bankrupt, island) · `thinking` (hand on chin: "저라면…") · `nervous` (sweat: timer, debt,
final rounds) · `laugh` (doubles, lucky card) · `dice` (holding dice up: roll turn) · `present`
(open palms: event card, auction, explanations) · `trophy` (winner).

### Triggers and levels

| Situation (event / prompt) | 최소 | 적당 | 전체 |
|---|:-:|:-:|:-:|
| Game start greeting, winner (`GameOver`) | ● | ● | ● |
| Doubles / triple doubles to island | ● | ● | ● |
| Bought / built / landmark / takeover done / blocked | ● | ● | ● |
| Big toll paid (≥ 30 % of payer cash) , toll waived | ● | ● | ● |
| Bankrupt, debt started | ● | ● | ● |
| Final rounds (`round ≥ limit − 2`), last round, prompt timer 3 s left | ● | ● | ● |
| Decision advice on `buy` / `build` / `takeover` / `island` / `festival` / `travel` / `auction` prompts (the AI's choice → "저라면 …") | | ● | ● |
| Card drawn: card title line (24 cards) | | ● | ● |
| Island enter/escape, festival set, travel granted, pass start, one-away warning, auction start/end, cannot afford | | ● | ● |
| Every turn start ("○○ 차례예요" → colour-based, no names), roll prompt nudge | | | ● |
| Rule explanations: each space kind on first landing, each card's effect, prompt explanations | | | ● |
| CPU quips while thinking | | | ● |

Names are typed by players, so lines never say them; turn lines refer to the seat colour
("빨간 말 차례예요!"), one take per player colour (8 colours). Money is described, not read
("큰돈이 나가네요!").

### Timing

- The dealer never blocks the event sequencer or prompts.
- One line at a time. A new line interrupts only when its priority is higher (e.g. bankrupt over a
  quip); otherwise it is dropped if one is playing, or queued for ≤ 1.5 s if it is advice for the
  prompt now open.
- Silent mode (English or sound off) shows the bubble for `max(1.2 s, 70 ms × chars) × gamePace`.
- Talking frames alternate every ~110 ms on the shared 30 Hz clock (`onFrame`), no extra rAF.

### Size budget

~300 voice files × ~2.5 s × 2.5 KB/s ≈ 1.9 MB; 14 sprites × ~16 KB ≈ 0.25 MB. Total ≈ 2.2 MB on
a ~4.9 MB web bundle. Voices load lazily on first use and are cached; sprites preload with the game.

## Error handling

- Missing / undecodable voice file → bubble only (silent timing), log once in dev.
- AudioContext locked (no gesture yet) → silent timing until `sfx.unlock()`.
- Generators: retry 3× with backoff on 429/5xx; stop on 401/403 with the API message; never write
  partial files (write to temp, rename).

## Testing

- `director.test.ts`: per level, the right line ids for representative event batches; cooldown;
  advice equals the AI's choice; English → no voice flag.
- `lines.test.ts` (integrity): unique ids; every id has `public/voice/<id>.ogg` and a manifest
  duration; every `expr` has `public/dealer/<expr>.webp`; ko/en non-empty.
- `voice.test.ts`: LRU + missing-file fallback with a stubbed fetch/AudioContext.
- e2e: bubble appears on a scripted buy at "적당"; nothing at "끔"; English shows subtitle; game
  still reaches idle at the same speed.

## Docs

`docs/THIRD_PARTY_LICENSES.md`: ElevenLabs voice (paid plan, commercial use) and Gemini sprites
derived from the owner-supplied icon (rights still unresolved, same as the icon).
`docs/DESIGN.md` §2.4 Feel: the dealer. `docs/PERFORMANCE.md`: bundle size after assets.

## Out of scope (next sub-project)

Replacing the 24 synthesized SFX with generated Pixar-style sounds and adding background music
(ElevenLabs sound-effects and music APIs). The voice module's ducking hook is the only coupling.
