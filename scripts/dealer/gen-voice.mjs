#!/usr/bin/env node
/**
 * Dealer voice (docs/superpowers/specs/2026-10-04-dealer-voice-design.md): every line of
 * src/ui/dealer/lines.ts → ElevenLabs (voice Krys, eleven_v4, Korean) → trimmed Opus mono .ogg in
 * public/voice/ + public/voice/manifest.json (id → duration ms).
 *
 *   ELEVENLABS_API_KEY=… node scripts/dealer/gen-voice.mjs [--force] [--dry]
 *
 * Raw MP3s are cached in scripts/dealer/.cache/voice/ with the text they were made from; a line is
 * only re-generated when its Korean text changed (or --force). Files no longer in the catalog are
 * removed from public/voice/.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'scripts', 'dealer', '.cache', 'voice');
const OUT = join(ROOT, 'public', 'voice');
const VOICE = '1W00IGEmNmwmsDeYy7ag'; // Krys — bright, excited Korean male
const MODEL = 'eleven_v4';
const SETTINGS = { stability: 0.35, similarity_boost: 0.8, style: 0.6, use_speaker_boost: true };
const CONCURRENCY = 4;

const force = process.argv.includes('--force');
const dry = process.argv.includes('--dry');
const key = process.env.ELEVENLABS_API_KEY;
if (!key && !dry) throw new Error('ELEVENLABS_API_KEY is not set');

// The catalog is TypeScript: load it through tsx (a dev dependency of the project).
const json = execFileSync(process.execPath, ['--import', 'tsx', '-e', "import('./src/ui/dealer/lines.ts').then((m) => process.stdout.write(JSON.stringify(m.DEALER_LINES)))"], {
  cwd: ROOT,
  encoding: 'utf8',
});
const lines = JSON.parse(json);
mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT, { recursive: true });

const todo = lines.filter((l) => force || !existsSync(join(CACHE, `${l.id}.mp3`)) || readFileSync(join(CACHE, `${l.id}.txt`), 'utf8') !== l.ko);
console.log(`${lines.length} lines, ${todo.length} to generate (${todo.reduce((a, l) => a + l.ko.length, 0)} chars)`);
if (dry) process.exit(0);

async function tts(line) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'xi-api-key': key },
      body: JSON.stringify({ text: line.ko, model_id: MODEL, language_code: 'ko', voice_settings: SETTINGS }),
    });
    if (r.ok) {
      const mp3 = join(CACHE, `${line.id}.mp3`);
      writeFileSync(`${mp3}.tmp`, Buffer.from(await r.arrayBuffer()));
      renameSync(`${mp3}.tmp`, mp3);
      writeFileSync(join(CACHE, `${line.id}.txt`), line.ko);
      return;
    }
    const body = await r.text();
    if (r.status === 401 || r.status === 403 || attempt >= 3) throw new Error(`${line.id}: ${r.status} ${body.slice(0, 300)}`);
    await new Promise((res) => setTimeout(res, 3000 * attempt));
  }
}

let done = 0;
const queue = [...todo];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let line = queue.shift(); line; line = queue.shift()) {
      await tts(line);
      process.stdout.write(`\r${++done}/${todo.length}`);
    }
  }),
);
if (todo.length) process.stdout.write('\n');

// Transcode every line (cheap) so encoder settings stay uniform; trim leading/trailing silence.
const TRIM = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse';
const manifest = {};
let bytes = 0;
for (const l of lines) {
  const out = join(OUT, `${l.id}.ogg`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(CACHE, `${l.id}.mp3`), '-af', TRIM, '-ac', '1', '-ar', '24000', '-c:a', 'libopus', '-b:a', '20k', '-application', 'voip', `${out}.tmp.ogg`]);
  renameSync(`${out}.tmp.ogg`, out);
  const sec = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).trim());
  manifest[l.id] = Math.round(sec * 1000);
  bytes += readFileSync(out).length;
}
const keep = new Set(lines.map((l) => `${l.id}.ogg`));
for (const f of readdirSync(OUT)) if (f.endsWith('.ogg') && !keep.has(f)) rmSync(join(OUT, f));
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
console.log(`wrote ${lines.length} files, ${(bytes / 1024).toFixed(0)} KB, avg ${(Object.values(manifest).reduce((a, b) => a + b, 0) / lines.length / 1000).toFixed(2)} s`);
