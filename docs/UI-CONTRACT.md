# UI implementation contract (two agents in parallel)

Shared foundation (already written, do not rewrite — extend only):
- `src/styles/tokens.css` — design tokens (colors, type, radii, motion, `--board`/`--u`).
- `src/content/palette.ts` — 8 player colors + 12 token ids.
- `src/i18n/index.ts` — `registerStrings`, `t`, `loc`, `fmtMoney`, `setLang`.
- `src/ui/router.ts` — `registerScreen` / `showScreen` with typed props.
- `src/ui/audio/sfx.ts`, `src/ui/audio/haptics.ts` — facades (`sfx.play`, `haptic`). The shell agent
  implements them via `installSfx` / `installHaptics`; the game agent only calls them.

## Ownership

| Agent | Owns (create/edit freely) | Must not edit |
|---|---|---|
| **GAME** (core game screen) | `src/ui/game/**`, `src/ui/board/**`, `src/ui/stage/**`, `src/ui/panels/**`, `src/ui/fx/**`, `src/ui/layout.ts`, `src/styles/board.css`, `src/styles/stage.css`, `src/styles/panels.css`, `src/styles/game.css`, `src/i18n/game.ts` (strings for the game screen, registered by that module), `e2e/game.spec.ts`, `src/ui/screens/Game.ts`, `src/ui/screens/Result.ts` | shell files, `src/engine/**` (may add a tiny helper *with a test* if truly needed; say so in the report) |
| **SHELL** (app shell) | `src/main.ts`, `index.html`, `src/ui/screens/Title.ts`, `Setup.ts`, `Rules.ts`, `SettingsScreen.ts`, `src/ui/shell/**` (persistence, save/resume, app lifecycle, Capacitor bridges), `src/ui/audio/**` implementations, `src/styles/base.css`, `src/styles/screens.css`, `src/i18n/shell.ts`, `e2e/shell.spec.ts`, `playwright.config.ts`, e2e npm scripts | game files above |

Both: `src/styles/index.css` is written by SHELL and imports `tokens.css`, `base.css`, `screens.css`,
`board.css`, `stage.css`, `panels.css`, `game.css` (GAME creates those four; SHELL imports them even
if they don't exist yet at the time — create empty placeholders if needed to keep the build green).

## Handshake

- SHELL calls `showScreen('game', { settings, seed })` or `showScreen('game', { resume: state })`.
- GAME's `Game.ts` registers itself with `registerScreen('game', …)` when imported; SHELL imports
  `@/ui/screens/Game` and `@/ui/screens/Result` in `main.ts` for their side effects.
- GAME calls `showScreen('result', { state })` on game over and `showScreen('title', {})` when the
  user quits from the in-game menu. GAME persists the running game by calling
  `import { saveGame, clearSavedGame } from '@/ui/shell/persist'` after every reduced action
  (SHELL provides that module: `saveGame(state: GameState): void`, `loadSavedGame(): GameState | null`,
  `clearSavedGame(): void`, `hasSavedGame(): boolean`).
- SHELL provides `import { prefs } from '@/ui/shell/prefs'` with `prefs.get()` →
  `{ lang, sound, haptics, volume, promptTimer }` and `prefs.set(partial)`, `prefs.onChange(fn)`.
- Until SHELL's modules exist, GAME may create **stub** files at those paths marked
  `// STUB – shell agent replaces` with the exact signatures above; SHELL overwrites them.

## Rules for both
- Vanilla TS + DOM/SVG only. No frameworks. Inline SVG from `@/content/icons`.
- Every user-visible string via `t()`; Korean first, English second; no hard-coded Korean in TS.
- Animations: CSS transforms/opacity only; `prefers-reduced-motion` respected via tokens.
- Touch targets ≥ 48 CSS px. Fonts from `public/fonts/fonts.css` (SHELL links it in index.html).
- No use of the forbidden words (마블, Monopoly, 황금열쇠, 찬스, 올림픽, 세계여행, 랜드마크 as ko label).
