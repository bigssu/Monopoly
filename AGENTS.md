# Repository Guidelines

Picking the work up on another machine or in a cloud session? Read `docs/HANDOFF.md` first: the current state, what is verified, what the user is waiting on, and facts about the user's devices that the code does not show.

## Project Structure & Module Organization

Lot & Roll is an offline, pass-and-play board game built with framework-free TypeScript, Vite, and Capacitor for Android.

- `src/engine/`: deterministic game rules, reducer, seeded RNG, AI, and persistence logic. Keep reducers pure and input state immutable.
- `src/ui/`: screens, board, player panels, animation, audio, and native bridges.
- `src/content/`, `src/i18n/`, `src/styles/`: board/card data and SVG artwork, Korean/English strings, and CSS tokens.
- `public/`: bundled assets and fonts; `docs/`: design, release, performance, and licensing references.
- `scripts/`: balance simulation, asset generation, and performance tools; `android/`: existing native project.
- Unit tests live under `src/**/__tests__/`; browser tests live in `e2e/`.

## Build, Test, and Development Commands

Use Node.js 22.12+ and install locked dependencies with `npm ci`.

- `npm run dev`: start Vite; use `-- --port 5174` if port 5173 is occupied.
- `npm run typecheck`: check strict TypeScript types without emitting files.
- `npm test`: run Vitest once; `npm run test:watch` enables watch mode.
- `npm run build`: typecheck and generate production output in `dist/`.
- `npm run preview`: serve the production build locally.
- `npm run e2e`: run Chromium Playwright tests.
- `npm run sim`: run the CPU balance simulation.
- `npm run release:check`: the release gate (typecheck, unit, e2e, build, `cap sync`, APK, and a check that the APK holds the bundle just built). Hand a build to anyone only after it passes; `-- --web` stops after the web build.

## Coding Style & Naming Conventions

Follow `.editorconfig`: UTF-8, LF, final newline, two-space indentation; use four spaces for Java, Kotlin, and Gradle. Match existing TypeScript single quotes, semicolons, and explicit type imports. Use camelCase functions/variables, PascalCase types and screen modules (`Title.ts`), and uppercase constants. The `@/` alias resolves to `src/`. No ESLint or Prettier configuration is present.

## Testing Guidelines

Use Vitest `*.test.ts` files for logic and Playwright `e2e/*.spec.ts` files for browser flows. Add regression checks for changed behavior, especially seeded outcomes and save compatibility. No numeric coverage threshold is configured. Run typecheck, unit tests, and build before submitting; report browser results explicitly because CI treats e2e as nonblocking. Browser tests can overwrite tracked screenshots; review those changes. Timing rules live in one place, the policy table at the top of `src/ui/fx/time.ts`: reduced motion removes movement, never time, and is the app's setting (the device's `prefers-reduced-motion` is not read: Remote Desktop and battery saver turn it on). `e2e/pacing.spec.ts` checks what a player sees in each environment.

## Commit & Pull Request Guidelines

History uses area-prefixed subjects such as `engine:`, `ui:`, `fix:`, `docs:`, and `fx-perf:`. Keep commits focused. PRs should describe behavior changes, link relevant issues, list validation commands/results, and include screenshots for UI changes. Update affected design or release documentation.

## Configuration Tips

Playwright defaults to `/opt/pw-browsers`; on Windows, set `PW_CHROMIUM_PATH` to an installed Chrome executable. Android builds additionally require JDK 21 and SDK 36; follow `docs/RELEASE.md`. Never commit signing keys or local SDK configuration.
