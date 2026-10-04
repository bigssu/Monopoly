#!/usr/bin/env node
/**
 * Dealer sprites (docs/superpowers/specs/2026-10-04-dealer-voice-design.md): Gemini image edits of
 * the launcher boy on flat magenta → ffmpeg colour key → 320 px WebP in public/dealer/.
 *
 *   GOOGLE_API_KEY=… node scripts/dealer/gen-sprites.mjs [expr …] [--force]
 *
 * Raw generations are cached in scripts/dealer/.cache/ (git-ignored); an existing raw is reused
 * unless --force. Talking frames are edits of the generated `idle` so the mouth flap lines up.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, 'scripts', 'dealer', '.cache', 'sprites');
const OUT = join(ROOT, 'public', 'dealer');
const REF = join(ROOT, 'docs', 'assets', 'play-icon-512.png');
const MODEL = 'gemini-3-pro-image';

const KEEP = `Use the boy from the reference image as the character. Keep him IDENTICAL: same face, hair, teal cap with the small mountain patch, orange neckerchief, blue jacket, white t-shirt, brown backpack straps, same soft 3D Pixar-style rendering and lighting.
Draw ONLY the character (no signs, board, coins, city or other props unless asked), upper body from the waist up, centered, facing the viewer, with a little margin around him.`;
const BG = 'Background: one flat solid pure magenta color (#FF00FF) everywhere behind him, no gradient, no shadow, no floor. Do not use magenta or pink anywhere on the character.';

const EXPRS = {
  idle: 'Pose and expression: friendly relaxed smile, mouth closed, arms relaxed at his sides, looking at the viewer.',
  point: 'Pose and expression: winking with one eye, big confident grin, pointing his index finger at the viewer like giving a tip.',
  cheer: 'Pose and expression: celebrating — both arms raised high in a cheer, eyes squeezed happily, big open-mouth joyful smile.',
  surprised: 'Pose and expression: shocked and amazed — eyes wide open, eyebrows raised high, mouth a round open "O", both hands up near his cheeks.',
  sad: 'Pose and expression: disappointed and sympathetic — eyebrows tilted, small frown, shoulders slumped, one hand on the back of his head.',
  thinking: 'Pose and expression: thinking — one hand on his chin, eyes looking up to the side, slight thoughtful smile, one eyebrow raised.',
  nervous: 'Pose and expression: nervous and in a hurry — a sweat drop on his forehead, worried grin showing teeth, both hands clenched in front of his chest.',
  laugh: 'Pose and expression: laughing out loud — eyes closed in joy, head tilted back slightly, wide open mouth, one hand on his belly.',
  dice: 'Pose and expression: excited, holding up one white dice with red and black pips in his raised right hand toward the viewer, big smile.',
  present: 'Pose and expression: presenting like a show host — both palms open and spread to the sides, warm welcoming smile.',
  trophy: 'Pose and expression: triumphant, holding a shiny golden trophy cup above his head with both hands, huge happy smile.',
};
const TALK = {
  'talk-a': 'Edit this exact image: keep everything identical (pose, lighting, framing, background) and change ONLY his mouth to wide open, as if saying "Ah!" mid-sentence.',
  'talk-b': 'Edit this exact image: keep everything identical (pose, lighting, framing, background) and change ONLY his mouth to half open, as if saying "Oh" mid-sentence.',
};

const key = process.env.GOOGLE_API_KEY;
if (!key) throw new Error('GOOGLE_API_KEY is not set');
const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT, { recursive: true });

async function generate(refPath, prompt, out) {
  const body = {
    contents: [{ parts: [{ inlineData: { mimeType: 'image/png', data: readFileSync(refPath).toString('base64') } }, { text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1' } },
  };
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (r.ok && part) {
      writeFileSync(`${out}.tmp`, Buffer.from(part.inlineData.data, 'base64'));
      renameSync(`${out}.tmp`, out);
      return;
    }
    if (r.status === 401 || r.status === 403 || attempt >= 3) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 300)}`);
    await new Promise((res) => setTimeout(res, 2000 * attempt));
  }
}

function toWebp(raw, name) {
  const out = join(OUT, `${name}.webp`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-vf', 'colorkey=0xFF00FF:0.30:0.10,scale=320:-1:flags=lanczos', '-c:v', 'libwebp', '-q:v', '80', '-pix_fmt', 'yuva420p', `${out}.tmp.webp`]);
  renameSync(`${out}.tmp.webp`, out);
  return out;
}

const want = (name) => only.length === 0 || only.includes(name);
const rawOf = (name) => join(CACHE, `${name}.png`);

for (const [name, pose] of Object.entries(EXPRS)) {
  if (!want(name)) continue;
  if (force || !existsSync(rawOf(name))) {
    process.stdout.write(`${name}… `);
    await generate(REF, `${KEEP}\n${pose}\n${BG}`, rawOf(name));
  }
  toWebp(rawOf(name), name);
  console.log(`${name} ok`);
}
for (const [name, edit] of Object.entries(TALK)) {
  if (!want(name)) continue;
  if (!existsSync(rawOf('idle'))) throw new Error('generate idle first');
  if (force || !existsSync(rawOf(name))) {
    process.stdout.write(`${name}… `);
    await generate(rawOf('idle'), `${edit}\n${BG}`, rawOf(name));
  }
  toWebp(rawOf(name), name);
  console.log(`${name} ok`);
}
