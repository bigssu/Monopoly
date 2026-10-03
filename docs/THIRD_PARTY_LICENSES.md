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

In-game icons (`src/content/icons/`), the title emblem, the contact sheet and every sound
effect (synthesized at runtime with the Web Audio API) are original works created for this
project. The launcher icon (`docs/assets/launcher-mark-256.png`) was derived from an image supplied
by the project owner; its third-party rights and overall resemblance have not been cleared for store publication.
Landmark icons are generic, stylized depictions of public architecture and cultural motifs
and do not reproduce any protected design.

## npm dependencies

Runtime and build dependencies are listed in `package.json` / `package-lock.json`; their
licenses can be listed with `npx license-checker --production` (not vendored here).
