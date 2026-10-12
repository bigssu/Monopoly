#!/usr/bin/env node
/**
 * Dealer voice (docs/superpowers/specs/2026-10-04-dealer-voice-design.md, runbook docs/VOICE-WEEKEND.md):
 * lines of src/ui/dealer/lines.ts → ElevenLabs (eleven_v4) → trimmed, loudness-matched Opus mono .ogg.
 * Korean (voice Krys) goes to public/voice/<id>.ogg, English (voice Liam) to public/voice/en/<id>.ogg;
 * each language has its own recorded-text file and cache folder. Both languages run every time.
 *
 *   node scripts/dealer/gen-voice.mjs --dry                 # what would be recorded, no key needed
 *   ELEVENLABS_API_KEY=… node scripts/dealer/gen-voice.mjs  # record it
 *   ELEVENLABS_API_KEY=… node scripts/dealer/gen-voice.mjs --all   # re-record every line (all credits)
 *
 * What gets recorded, per language: every line in VOICE_PENDING, every voiced line whose text no
 * longer matches scripts/dealer/voice-texts.json / voice-texts-en.json (the text each shipped file
 * actually says), and every voiced line whose .ogg is missing. Nothing else is touched, so a machine without the raw cache
 * only pays for those lines. Afterwards the script records the new texts in voice-texts.json,
 * empties VOICE_PENDING in lines.ts for what it recorded, and drops files for lines that no
 * longer exist. Raw MP3s are cached in scripts/dealer/.cache/voice/ (gitignored) with the text they
 * were made from; a cached take with the same text is reused instead of paying again.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LINES_TS = join(ROOT, 'src', 'ui', 'dealer', 'lines.ts');
const LANGS = [
  // Krys — bright, excited Korean male
  { lang: 'ko', voice: '1W00IGEmNmwmsDeYy7ag', out: join(ROOT, 'public', 'voice'), texts: join(ROOT, 'scripts', 'dealer', 'voice-texts.json'), cache: join(ROOT, 'scripts', 'dealer', '.cache', 'voice') },
  // Liam — energetic young American male (Krys is verified for Korean only)
  { lang: 'en', voice: 'TX3LPaxmHKxFdv7VOQHJ', out: join(ROOT, 'public', 'voice', 'en'), texts: join(ROOT, 'scripts', 'dealer', 'voice-texts-en.json'), cache: join(ROOT, 'scripts', 'dealer', '.cache', 'voice', 'en') },
];
const MODEL = 'eleven_v4';
const SETTINGS = { stability: 0.35, similarity_boost: 0.8, style: 0.6, use_speaker_boost: true };
const CONCURRENCY = 4;

const all = process.argv.includes('--all') || process.argv.includes('--force');
const dry = process.argv.includes('--dry');
const key = process.env.ELEVENLABS_API_KEY;

// The catalog is TypeScript: load it through tsx (a dev dependency of the project).
const json = execFileSync(process.execPath, ['--import', 'tsx', '-e', "import('./src/ui/dealer/lines.ts').then((m) => process.stdout.write(JSON.stringify(m.DEALER_LINES)))"], {
  cwd: ROOT,
  encoding: 'utf8',
});
/** @type {{ id: string, ko: string, en: string, voice: boolean }[]} */
const lines = JSON.parse(json);
const ids = new Set(lines.map((l) => l.id));
console.log(`${lines.length} lines in the catalog.`);

/** Record what one language is missing; returns the ids it wrote. */
async function record({ lang, voice, out, texts: TEXTS, cache: CACHE }) {
  const text = (l) => l[lang];
  const recorded = existsSync(TEXTS) ? JSON.parse(readFileSync(TEXTS, 'utf8')) : {};
  const reason = (l) =>
    all ? 'all' : !l.voice ? 'pending' : recorded[l.id] !== text(l) ? 'text changed' : !existsSync(join(out, `${l.id}.ogg`)) ? 'file missing' : null;
  const todo = lines.filter((l) => reason(l));
  const chars = todo.reduce((a, l) => a + text(l).length, 0);
  console.log(`[${lang}] ${todo.length} to record (${chars} characters).`);
  for (const l of todo) console.log(`  ${l.id.padEnd(26)} [${reason(l)}] ${text(l)}`);
  if (dry || !todo.length) return new Set();
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set (run with --dry to only list the lines).');
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    throw new Error('ffmpeg is not on PATH');
  }
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(out, { recursive: true });

  const cachedText = (id) => {
    const f = join(CACHE, `${id}.txt`);
    return existsSync(f) ? readFileSync(f, 'utf8') : null;
  };

  async function tts(line) {
    for (let attempt = 1; ; attempt++) {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'xi-api-key': key },
        body: JSON.stringify({ text: text(line), model_id: MODEL, language_code: lang, voice_settings: SETTINGS }),
      });
      if (r.ok) {
        const mp3 = join(CACHE, `${line.id}.mp3`);
        writeFileSync(`${mp3}.tmp`, Buffer.from(await r.arrayBuffer()));
        renameSync(`${mp3}.tmp`, mp3);
        writeFileSync(join(CACHE, `${line.id}.txt`), text(line));
        return;
      }
      const body = await r.text();
      if (r.status === 401 || r.status === 403 || attempt >= 3) throw new Error(`${line.id}: ${r.status} ${body.slice(0, 300)}`);
      await new Promise((res) => setTimeout(res, 3000 * attempt));
    }
  }

  // 1. Fetch (a cached raw take of the same text is reused, unless --all).
  const fetchList = todo.filter((l) => all || !existsSync(join(CACHE, `${l.id}.mp3`)) || cachedText(l.id) !== text(l));
  let fetched = 0;
  const queue = [...fetchList];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let line = queue.shift(); line; line = queue.shift()) {
        await tts(line);
        process.stdout.write(`\r[${lang}] recorded ${++fetched}/${fetchList.length}`);
      }
    }),
  );
  if (fetchList.length) process.stdout.write('\n');

  // 2. Trim leading/trailing silence, even out loudness, encode small Opus.
  const fresh = new Set();
  for (const l of todo) {
    const file = join(out, `${l.id}.ogg`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(CACHE, `${l.id}.mp3`), '-af', TRIM, ...ENCODE, ...EXACT, `${file}.tmp.ogg`]);
    renameSync(`${file}.tmp.ogg`, file);
    fresh.add(l.id);
    recorded[l.id] = text(l);
  }

  // 3. Texts in catalog order, only for lines whose file ships; drop files for lines that no longer exist.
  const texts = {};
  for (const l of lines) if (recorded[l.id] !== undefined && existsSync(join(out, `${l.id}.ogg`))) texts[l.id] = recorded[l.id];
  for (const f of readdirSync(out)) if (f.endsWith('.ogg') && !ids.has(f.slice(0, -4))) rmSync(join(out, f));
  writeFileSync(TEXTS, `${JSON.stringify(texts, null, 1)}\n`);

  const kb = todo.reduce((a, l) => a + readFileSync(join(out, `${l.id}.ogg`)).length, 0) / 1024;
  console.log(`[${lang}] wrote ${todo.length} files (${kb.toFixed(0)} KB).`);
  return fresh;
}

const TRIM = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse,loudnorm=I=-18:TP=-1.5:LRA=11';
const ENCODE = ['-ac', '1', '-ar', '24000', '-c:a', 'libopus', '-b:a', '20k', '-application', 'voip'];
// Byte-identical output for identical input: no encoder/version metadata, no random stream serial.
const EXACT = ['-fflags', '+bitexact', '-flags:a', '+bitexact', '-map_metadata', '-1', '-serial_offset', '1'];

// A pending line is recorded in every language, so whatever every language wrote leaves VOICE_PENDING.
const written = [];
for (const l of LANGS) written.push(await record(l));
if (dry) process.exit(0);
const fresh = new Set([...ids].filter((id) => written.every((w) => w.has(id))));

// 4. Everything recorded leaves VOICE_PENDING.
const src = readFileSync(LINES_TS, 'utf8');
const block = /(export const VOICE_PENDING: ReadonlySet<string> = new Set\(\[)([\s\S]*?)(\]\);)/;
const m = src.match(block);
if (!m) throw new Error('VOICE_PENDING block not found in lines.ts: remove the recorded ids by hand');
const left = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]).filter((id) => ids.has(id) && !fresh.has(id));
const body = left.length ? `\n  ${left.map((id) => `'${id}'`).join(', ')},\n` : '';
writeFileSync(LINES_TS, src.replace(block, `$1${body}$3`));

console.log(`${left.length} still pending.`);
console.log('Next: npx vitest run src/ui/dealer, listen to a few files in public/voice/ and public/voice/en/, then commit public/voice, scripts/dealer/voice-texts*.json and src/ui/dealer/lines.ts.');
