#!/usr/bin/env node
/**
 * Sound overhaul (docs/superpowers/specs/2026-10-04-sound-design.md): generated, Pixar-like SFX and
 * background music → loudness-matched Opus in public/sfx/ and public/music/.
 *
 *   ELEVENLABS_API_KEY=… node scripts/sound/gen-sound.mjs [sfx|music] [name …] [--force] [--dry]
 *
 * Raw MP3s are cached in scripts/sound/.cache/ next to the prompt they came from; only changed
 * prompts are regenerated. Loops (title/game/final) get their first 4 s crossfaded into the tail.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'scripts', 'sound', '.cache');
const STYLE = 'whimsical Pixar-style cartoon, warm and playful, clean, no voice';

/** [prompt, seconds, takes] per SfxName (src/ui/audio/sfx.ts). */
const SFX = {
  tap: ['soft cartoon UI tap, a tiny wooden bubble pop', 0.5, 3],
  'dice-shake': ['two dice rattling in a cupped hand, quick playful rattle', 1, 1],
  'dice-land': ['two wooden dice tumbling and landing on a felt table, short cartoon clatter', 0.8, 3],
  doubles: ['magical double sparkle chime, two bright bells ringing together, joyful', 1.2, 1],
  hop: ['tiny cartoon boing hop of a toy game piece with a soft wooden tap', 0.5, 3],
  'pass-start': ['cheerful short whimsical orchestral fanfare with a coin jingle, payday', 1.6, 1],
  'cash-in': ['cartoon coins jingling into a pouch, bright little ka-ching', 0.8, 3],
  'cash-out': ['coins sliding out and dropping, soft cartoon, gently descending', 0.8, 3],
  buy: ['a soft rubber stamp thump followed by a sparkle, cartoon purchase', 1, 1],
  build: ['cartoon hammer tap tap construction ending in a cheerful pop', 1.2, 1],
  landmark: ['grand whimsical orchestral reveal with chimes and sparkles, triumphant and short', 2.4, 1],
  toll: ['cartoon cash register drawer opening with a ding', 0.9, 1],
  takeover: ['dramatic cartoon whoosh then a big rubber stamp slam, comedic orchestral hit', 1.4, 1],
  card: ['a playing card flipping over with a magical shimmer', 0.8, 1],
  island: ['cartoon ocean waves and a seagull with a sad slide whistle going down', 1.6, 1],
  escape: ['cartoon jump whoosh with a happy slide whistle going up', 1, 1],
  festival: ['festive cartoon party horn and confetti pops, joyful', 1.6, 1],
  travel: ['cartoon airplane whoosh with a magical swish', 1.2, 1],
  warning: ['gentle two-tone xylophone warning, cartoon, not harsh', 1, 1],
  bankrupt: ['comedic sad trombone wah wah wah, cartoon', 2, 1],
  win: ['triumphant whimsical orchestral fanfare with cymbal and sparkles', 3, 1],
  turn: ['soft cartoon chime, two friendly notes, your turn', 0.6, 3],
  'timer-tick': ['a single cartoon wooden clock tick', 0.5, 1],
  error: ['soft gentle cartoon bonk, a little negative', 0.5, 1],
};

/** [prompt, seconds, loop] per music id. */
const MUSIC = {
  title: ['Whimsical Pixar-style orchestral main theme for a cheerful family board game title screen: pizzicato strings, celesta, light woodwinds, warm and inviting, medium tempo, instrumental, seamless loop', 64, true],
  game: ['Light bouncy background music for a family board game: pizzicato strings, marimba, soft clarinet, cheerful and unobtrusive, steady groove, instrumental, seamless loop', 94, true],
  final: ['Exciting, tense but playful final-rounds music for a cartoon board game: faster tempo, staccato strings, ticking percussion, brass stabs, instrumental, seamless loop', 64, true],
  win: ['Short triumphant Pixar-style victory fanfare: orchestral brass and strings, sparkling chimes, joyful ending, instrumental', 8, false],
};

const args = process.argv.slice(2);
const force = args.includes('--force');
const dry = args.includes('--dry');
const kinds = args.filter((a) => a === 'sfx' || a === 'music');
const only = args.filter((a) => !a.startsWith('--') && a !== 'sfx' && a !== 'music');
const doKind = (k) => kinds.length === 0 || kinds.includes(k);
const key = process.env.ELEVENLABS_API_KEY;
if (!key && !dry) throw new Error('ELEVENLABS_API_KEY is not set');

async function generate(url, body, out) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'xi-api-key': key }, body: JSON.stringify(body) });
    if (r.ok) {
      writeFileSync(`${out}.tmp`, Buffer.from(await r.arrayBuffer()));
      renameSync(`${out}.tmp`, out);
      return;
    }
    const text = await r.text();
    if (r.status === 401 || r.status === 403 || attempt >= 3) throw new Error(`${out}: ${r.status} ${text.slice(0, 300)}`);
    await new Promise((res) => setTimeout(res, 3000 * attempt));
  }
}

/** Generate (or reuse) the raw for `id` with `prompt`; returns its path. */
async function raw(dir, id, prompt, make) {
  mkdirSync(dir, { recursive: true });
  const mp3 = join(dir, `${id}.mp3`);
  const txt = join(dir, `${id}.txt`);
  if (!force && existsSync(mp3) && existsSync(txt) && readFileSync(txt, 'utf8') === prompt) return mp3;
  if (dry) {
    console.log(`would generate ${id}`);
    return null;
  }
  process.stdout.write(`${id}… `);
  for (let tries = 1; ; tries++) {
    await make(mp3);
    const peak = peakDb(mp3);
    if (peak > DUD_DB || tries >= 3) {
      console.log(peak > DUD_DB ? `ok (${peak} dB)` : `kept a quiet take (${peak} dB)`);
      break;
    }
    process.stdout.write(`dud ${peak} dB, again… `);
  }
  writeFileSync(txt, prompt);
  return mp3;
}

// Byte-identical output for identical input; write to a temp file, then rename (no partial files).
const EXACT = ['-fflags', '+bitexact', '-flags:a', '+bitexact', '-map_metadata', '-1', '-serial_offset', '1'];
const ffmpeg = (a) => {
  const dest = a[a.length - 1];
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...a.slice(0, -1), ...EXACT, `${dest}.tmp.ogg`]);
  renameSync(`${dest}.tmp.ogg`, dest);
};

/** Peak level of a file in dBFS (ffmpeg volumedetect reports on stderr). */
function peakDb(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(r.stderr ?? '');
  return m ? Number(m[1]) : -Infinity;
}
/** A generation this quiet is a dud (the model sometimes returns near-silence). */
const DUD_DB = -30;
const want = (name) => only.length === 0 || only.includes(name);

if (doKind('sfx')) {
  const out = join(ROOT, 'public', 'sfx');
  mkdirSync(out, { recursive: true });
  const manifest = {};
  for (const [name, [prompt, seconds, takes]] of Object.entries(SFX)) {
    manifest[name] = takes;
    for (let k = 1; k <= takes; k++) {
      const id = takes > 1 ? `${name}.${k}` : name;
      if (!want(name)) continue;
      const full = `${prompt}, ${STYLE}${takes > 1 ? `, variation ${k}` : ''}`;
      const mp3 = await raw(join(CACHE, 'sfx'), id, full, (dest) =>
        generate('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', { text: full, duration_seconds: seconds, prompt_influence: 0.5, model_id: 'eleven_text_to_sound_v2' }, dest),
      );
      if (!mp3) continue;
      // Peak-normalize first (short clips are too short for loudnorm), then trim the leading
      // silence before the anticipation; Opus mono.
      const gain = (-1.5 - peakDb(mp3)).toFixed(1);
      ffmpeg(['-i', mp3, '-af', `volume=${gain}dB,silenceremove=start_periods=1:start_threshold=-45dB`, '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '48k', join(out, `${id}.ogg`)]);
    }
  }
  if (!dry) writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
}

if (doKind('music')) {
  const out = join(ROOT, 'public', 'music');
  mkdirSync(out, { recursive: true });
  for (const [id, [prompt, seconds, loop]] of Object.entries(MUSIC)) {
    if (!want(id)) continue;
    const mp3 = await raw(join(CACHE, 'music'), id, prompt, (dest) =>
      generate('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', { prompt, music_length_ms: seconds * 1000, model_id: 'music_v1', force_instrumental: true }, dest),
    );
    if (!mp3) continue;
    const dest = join(out, `${id}.ogg`);
    const norm = 'loudnorm=I=-23:TP=-2:LRA=11';
    if (loop) {
      // Seamless loop: the body's last 4 s crossfade into the first 4 s (the file ends where it starts).
      ffmpeg(['-i', mp3, '-filter_complex', `[0]atrim=0:4,asetpts=PTS-STARTPTS[head];[0]atrim=4,asetpts=PTS-STARTPTS[body];[body][head]acrossfade=d=4:c1=tri:c2=tri,${norm}`, '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', '40k', dest]);
    } else {
      ffmpeg(['-i', mp3, '-af', norm, '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', '40k', dest]);
    }
    console.log(`music ${id} ok`);
  }
}
