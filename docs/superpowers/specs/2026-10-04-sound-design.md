# Sound overhaul (A5) — design

Date: 2026-10-04 · Status: approved scope (owner: "replace every SFX with generated sound", ElevenLabs
for music and SFX, Pixar-like warmth)

## Goal

One warm, cartoony sound world that moves with the motion system: every sound effect is a
generated sample with an anticipation → hit → tail shape, and background music carries the mood
of each screen (title, play, the final stretch, victory). The dealer's voice sits on top.

## Assets (generated, compressed, shipped)

| Kind | Items | Source | Shipped as |
|---|---|---|---|
| SFX | the 24 `SfxName`s; 3 takes for the frequent ones (tap, hop, cash-in, cash-out, dice-land, turn) | ElevenLabs `/v1/sound-generation` (`eleven_text_to_sound_v2`) | `public/sfx/<name>[.n].ogg`, Opus mono 48 kbps |
| Music | `title` (≈60 s loop), `game` (≈90 s loop), `final` (≈60 s loop, tense), `win` (≈8 s jingle) | ElevenLabs `/v1/music` (`music_v1`, instrumental) | `public/music/<id>.ogg`, Opus stereo 40 kbps, loops crossfaded in ffmpeg |

Prompts share one style line: *"whimsical Pixar-style cartoon, warm, playful, soft orchestral /
foley, clean, no voice"*. Generator: `scripts/sound/gen-sound.mjs` (cache in
`scripts/sound/.cache/`, skips unchanged prompts, writes `public/sfx/manifest.json` with the takes
per name). Loops: the first 4 s are crossfaded into the tail (`acrossfade`) so the file loops
seamlessly.

## Runtime

- `audio/samples.ts` — `SampleSfx` implements the existing `Sfx` interface: decodes the shipped
  samples lazily (preloads the frequent ones at unlock), picks a random take, honours
  `pitch` (playbackRate) / `gain` / the per-name throttle, plays into the existing SFX bus (so the
  dealer still ducks it). A missing or undecodable sample falls back to the synthesizer, so sound
  never disappears.
- `audio/music.ts` — one looping track at a time on a music bus under the master; crossfade 1.2 s
  between tracks; ducks under the dealer like the SFX; follows the sound switch, the master
  volume and a new "배경음악" (music) on/off + level.
- Scenes: title/setup/settings → `title`; game → `game`, switching to `final` when the late-toll
  rounds (or the last three rounds) begin; result → `win` jingle, then `title`.

## Budget

SFX ≈ 40 files × ~6 KB ≈ 0.25 MB; music ≈ 4 × ~0.35 MB ≈ 1.3 MB. Total app growth ≈ 1.6 MB.

## Testing

Unit: every `SfxName` has at least one shipped sample and a manifest entry; music ids exist;
`SampleSfx` falls back to the synth on a missing buffer (stubbed AudioContext). e2e: sound off
mutes music and SFX (no AudioBufferSourceNode started). Manual: listen on a tablet.

## Docs

THIRD_PARTY_LICENSES (ElevenLabs SFX and music, paid plan), PERFORMANCE (bundle size), DESIGN §2.4.
