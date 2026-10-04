# UI/UX release audit — 2026-10-04

Scope: Title, Setup, Rules, Settings, Game/board/Stage, Result, dialogs, Korean/English, 800×450 and 1600×1000 browser captures. Sources: `src/ui/`, `src/styles/`, `e2e/__screenshots__/`, `docs/DESIGN.md`, and root `DESIGN.md`. This is a browser/source audit; the reported Android WebView white rectangles have not been checked on a connected tablet.

| Priority | Finding and user impact | Resolution / release check |
| --- | --- | --- |
| P0 | Reported white overlays can cover decisions during play on Android. Browser screenshots do not reproduce the device compositor. | Compare normal and software-WebView APKs on the affected tablet through several turns, cards, menus, and prompts. Ship only a renderer that stays clean at acceptable frame rate. |
| P0 | User-supplied launcher art has no documented commercial-use provenance; store resemblance review is open. | Owner confirms rights and store review before upload; see `docs/RELEASE.md` and `docs/THIRD_PARTY_LICENSES.md`. |
| P1 | Board spaces lacked keyboard names/activation, and their detail card lacked a keyboard close path. | **Fixed:** named/focusable spaces, distinct pick/inspect labels, Enter/Space, Close/Escape, and focus return. The detail card is a non-modal popover; obscured Stage actions are inert while it is open. |
| P1 | Inactive Rules pages could still receive keyboard focus; dot tabs and Left/Right behavior were incomplete. | **Fixed:** hidden pages inert, complete tab keyboard pattern, scoped arrows; Playwright controls test passes. |
| P1 | Global viewport disabled pinch zoom; custom radio controls had incomplete keyboard behavior and rerenders could lose focus. | **Fixed:** zoom enabled, roving radio focus, and focus continuity; Playwright controls/focus tests pass. |
| P1 | Setup Start advertised itself as disabled even though it accepted activation and showed a validation toast. | **Fixed:** native disabled state with persistent status explanation. |
| P2 | Winner-facing Result can initially appear upside-down to another seat; the always-upright Rotate button provides a way to turn it. | Retain winner-facing tabletop behavior; verify that Rotate remains visible at 800×450. |

Existing strengths: a clear primary action on Title/Setup/Stage, large touch targets, deliberate seat-oriented player information, native landscape setup, shell-dialog focus trapping, reduced-motion support, low-FX default, and independently scrollable Settings. Existing 800×450 screenshots show no shell clipping; this does not substitute for Android tablet testing.

Release acceptance: complete the P1 regression checks, typecheck/unit/browser/build checks, verify the P0 device and art gates, then capture final store screenshots from the actual release candidate. A debug APK alone is not a signed store release.
