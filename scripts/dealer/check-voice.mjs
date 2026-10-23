#!/usr/bin/env node
/**
 * Listen to every recorded dealer take (docs/research/12-dealer-acting.md §5): ElevenLabs speech-to-text
 * on each raw take in scripts/dealer/.cache/voice/ (Korean) and .cache/voice/en/ (English), compared with
 * what the bubble says. A take that says other words, drops words or reads an audio tag aloud
 * ("excited…") scores low. Prints the low ones and the command that re-records them; writes the
 * full report to scripts/dealer/.cache/voice/check.json.
 *
 *   ELEVENLABS_API_KEY=… node scripts/dealer/check-voice.mjs [--min 0.75]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'scripts', 'dealer', '.cache', 'voice');
const key = process.env.ELEVENLABS_API_KEY;
if (!key) throw new Error('ELEVENLABS_API_KEY is not set');
const minAt = process.argv.indexOf('--min');
const MIN = minAt > 0 ? Number(process.argv[minAt + 1]) : 0.75;
const CONCURRENCY = 4;

const json = execFileSync(process.execPath, ['--import', 'tsx', '-e', "import('./src/ui/dealer/lines.ts').then((m) => process.stdout.write(JSON.stringify(m.DEALER_LINES)))"], { cwd: ROOT, encoding: 'utf8' });
/** @type {{ id: string, ko: string, en: string }[]} */
const lines = JSON.parse(json);

/** Letters and digits only, lower case: punctuation, spacing and case do not count. */
const norm = (s) => s.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '');

/** 1 − edit distance / longer length. */
function similarity(a, b) {
  const x = [...norm(a)];
  const y = [...norm(b)];
  if (!x.length && !y.length) return 1;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

async function transcribe(file, lang) {
  for (let attempt = 1; ; attempt++) {
    const fd = new FormData();
    fd.append('model_id', 'scribe_v1');
    fd.append('language_code', lang);
    fd.append('tag_audio_events', 'false');
    fd.append('file', new Blob([readFileSync(file)], { type: 'audio/mpeg' }), 'take.mp3');
    const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: fd });
    if (r.ok) return (await r.json()).text ?? '';
    if (r.status === 401 || r.status === 403 || attempt >= 3) throw new Error(`${file}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 3000 * attempt));
  }
}

const jobs = [];
for (const l of lines)
  for (const lang of ['ko', 'en']) {
    const file = join(lang === 'ko' ? CACHE : join(CACHE, 'en'), `${l.id}.mp3`);
    if (existsSync(file)) jobs.push({ id: l.id, lang, file, want: l[lang] });
  }

const report = [];
let done = 0;
const queue = [...jobs];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let j = queue.shift(); j; j = queue.shift()) {
      const heard = await transcribe(j.file, j.lang);
      report.push({ id: j.id, lang: j.lang, score: Math.round(similarity(heard, j.want) * 100) / 100, want: j.want, heard });
      process.stdout.write(`\rchecked ${++done}/${jobs.length}`);
    }
  }),
);
process.stdout.write('\n');
report.sort((a, b) => a.score - b.score);
writeFileSync(join(CACHE, 'check.json'), `${JSON.stringify(report, null, 1)}\n`);

const low = report.filter((r) => r.score < MIN);
for (const r of low) console.log(`${r.score.toFixed(2)} [${r.lang}] ${r.id}\n   want:  ${r.want}\n   heard: ${r.heard}`);
const mean = report.reduce((a, r) => a + r.score, 0) / Math.max(1, report.length);
console.log(`${report.length} takes, mean ${mean.toFixed(3)}, ${low.length} below ${MIN}.`);
if (low.length) console.log(`Re-record: node scripts/dealer/gen-voice.mjs --only ${[...new Set(low.map((r) => r.id))].join(',')}`);
