# Third-party licenses

## Fonts (vendored in `public/fonts/`)

Both fonts are licensed under the SIL Open Font License, Version 1.1 (OFL). They are
self-hosted (no runtime requests to Google) and are used unmodified as WOFF2 subsets
downloaded from Google Fonts. The full license text ships next to each font.

| Font | Copyright | License text | Files |
|------|-----------|--------------|-------|
| Noto Sans KR (weights 400/500/700/900, variable) | Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source' | `public/fonts/noto-sans-kr/OFL.txt` | `public/fonts/noto-sans-kr/*.woff2` |
| Jua | Copyright 2018 The Jua Project Authors | `public/fonts/jua/OFL.txt` | `public/fonts/jua/*.woff2` |

`public/fonts/fonts.css` reproduces the Google Fonts `@font-face` rules (including
`unicode-range` subsetting) with local relative URLs.

The OFL permits bundling and redistribution with software and use in commercial products;
the fonts must not be sold on their own, and the Reserved Font Names may not be used for
modified versions.

## Icons, illustrations, logo and audio

In-game icons (`src/content/icons/`), the title emblem and the contact sheet are original works
created for this project. The runtime Web Audio synthesizer (`src/ui/audio/synth.ts`) remains as a
fallback for any sound effect sample that is missing.

Sound effects (`public/sfx/*.ogg`) and background music (`public/music/*.ogg`) were generated with
ElevenLabs (`eleven_text_to_sound_v2`, `music_v1`; `scripts/sound/gen-sound.mjs`) on a paid plan
that permits commercial use; confirm the plan is active when publishing.

The launcher icon (`docs/assets/launcher-mark-256.png`) was derived from an image supplied
by the project owner; its third-party rights and overall resemblance have not been cleared for store publication.
Landmark icons are generic, stylized depictions of public architecture and cultural motifs
and do not reproduce any protected design.

The dealer host (`public/dealer/*.webp`) was generated with Google Gemini (`gemini-3-pro-image`,
`scripts/dealer/gen-sprites.mjs`) using that launcher image as the character reference, so it
inherits the launcher image's unresolved rights. Its sob frames (`public/dealer/sad-sob.webp`) were
baked from `public/dealer/sad.webp` with sprite-gen (https://github.com/aldegad/sprite-gen, Apache-2.0,
commit f7cb0db; `scripts/dealer/bake-sob.py`), a deterministic offline tool used only to bake the
asset: none of its code ships in the app, and the frames have the same status as the still they come
from. The dealer's Korean voice lines
(`public/voice/*.ogg`, `scripts/dealer/gen-voice.mjs`) were generated with ElevenLabs (voice
"Krys", model `eleven_v4`) on a paid plan that permits commercial use; confirm the plan is active
when publishing.

## npm dependencies

Runtime and build dependencies are listed in `package.json` / `package-lock.json`; their
licenses can be listed with `npx license-checker --production` (not vendored here).
