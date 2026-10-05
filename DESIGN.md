# Design

## Source of truth

**Status: Active (2026-10-04).** This file governs Money Poly's product UI and accessibility. `docs/DESIGN.md` remains the rules/content specification; `docs/UI-CONTRACT.md` documents implementation boundaries. Evidence: `README.md`, `docs/RELEASE.md`, `docs/PLAY_LISTING.md`, `src/ui/screens/`, `src/ui/board/`, `src/ui/stage/`, `src/styles/`, and Playwright screenshots at 1600×1000 and 800×450. Physical Android rendering is unverified because no target tablet is connected.

## Brand

Playful, readable tabletop travel game. Use **Money Poly / 머니폴리** consistently, with original city and travel imagery. Trust comes from clear offline/no-ads messaging, visible rules, save controls, and honest prompts. Avoid references or visual mimicry of other board-game brands. Verify rights to the owner-supplied launcher image before store submission.

## Product goals

Let 2–4 people start or resume a game, understand whose turn it is, make each purchase/build decision, and finish a match on one shared tablet. Success means each action is legible from the acting seat and works at 800×450 CSS px. Do not add accounts, network features, or complex onboarding.

## Personas and jobs

Primary: families and friends around one landscape Android tablet, including first-time players and people using entry-level devices. They need quick setup, discoverable rules, unambiguous turn ownership, and recoverable saved games. AI occupies an ordinary seat when fewer humans are present.

## Information architecture

Title → Setup → Game → Result; Title also opens Rules and Settings. Game menu opens rules/settings and save/quit; its board ring surrounds the acting player's rotating Stage. Prioritize current decision, then turn/round and funds, then other players' status. Rules are six pages; Settings exposes language, sound, vibration, timer, battery saver, effects, save, and licenses.

## Design principles

Face actionable text toward the acting seat; keep the board ring spatially stable. Give one clear primary action per state and explain unavailable actions. Favor readable contrast and stable surfaces over decorative motion on low-end Android WebViews. Preserve player data on navigation and interrupted sessions.

## Visual language

`src/styles/tokens.css` owns colors, fonts, radii, and timing. Dark navy felt surrounds warm paper cards; the Stage uses dark teal with light text and gold primary actions. Jua is display type, Noto Sans KR body type; English uses the same fallback stack. Keep 48 CSS px touch areas where space permits, clear focus outlines, restrained depth, and short motion that honors reduced motion. Use existing inline SVG iconography and small atlases; never enlarge source textures without evidence.

## Components

Reuse `btn`, `seg`, `switch`, `tchip`, `paper`, dialog/toast, seat cards, board spaces, player panels, and Stage prompts. Required states: default, focused, selected, disabled, busy, error, and completed where relevant. CSS tokens remain the visual source; `src/ui/shell/widgets.ts` owns shared control behavior. Do not create a second component or token system.

## Accessibility

Target WCAG 2.2 AA where the tabletop game model allows. Keep browser zoom enabled, visible keyboard focus, semantic controls, named board spaces, keyboard dismissal/focus return for overlays, and equivalent text alongside color or sound. Aim for 4.5:1 normal text and 3:1 large text/non-text controls; check rendered contrast on real devices. Respect reduced motion and expose game status in text.

## Responsive behavior

Landscape tablet is primary (roughly 4:3–16:10); 800×450 and 640×360 CSS px are constrained cases. Shell pages may scroll vertically; primary actions stay reachable. Game board stays square while seat panels use side columns; recalculate on viewport changes and safe-area changes. Touch must work without hover; keyboard is an additional input path. Native orientation is landscape-locked.

## Interaction states

Show a boot splash only while loading, then Title or a recoverable error. Setup states show seat count and explain invalid starts. Stage always shows current player and either a Roll action, a decision prompt, a short CPU-thinking state, or resolution feedback. A CPU decision is never made invisibly: the CPU's hand (cuff in its color) comes in from its seat and presses the chosen button or board space before the action happens, in the same rotated frame as the Stage. Every purchase, payment and income is a full-screen money cut-in (`docs/MONEY-EVENTS.md` §11): the bought building or city big in the middle, each involved player's gold/silver/bronze coin pile at their own seat edge facing them, coins flying between the real seats, a plaque with the amount facing the acting seat, drain/stack coin sounds; the board and panels change when the cut-in hands back, and the next prompt waits for it. Pause freezes it, a tap plays it ×5, and the app's reduced-motion setting keeps its time and numbers without flying coins. Timed prompts choose the documented safe default. Save/load failure must be visible; offline play remains fully functional.

## Content voice

Use short, direct Korean first and complete English translations through `src/i18n/`. Name actions for outcomes (buy, pass, build, resume), include amounts/timer where they change a choice, and avoid ambiguous icon-only actions. Keep store copy and in-app name aligned.

## Implementation constraints

Vanilla TypeScript + Vite + Capacitor 8, local assets, no new runtime dependencies. The target is an entry-level Android tablet: default 30 fps battery saver, low effects, 1K preferred textures and at most limited 2K exceptions. Validate typecheck, unit tests, relevant Playwright flows at 800×450 and 1600×1000, and an Android debug build. Store readiness additionally requires a **real-device** white-box rendering check, accessibility/manual touch pass, release signing, and launcher-art rights clearance; a browser screenshot cannot prove these.

## Open questions

- [ ] **Owner / release:** Is the supplied launcher image fully licensed for commercial store use? Blocks store art submission.
- [ ] **Owner / QA:** Which low-end tablet and WebView version reproduce the white boxes, and which renderer build behaves correctly? Blocks device visual sign-off.
- [ ] **Owner / release:** Which signing key and Play Console account will publish the first release? Blocks upload, not local debug testing.
