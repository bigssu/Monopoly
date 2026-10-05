// The release gate: a build is only "a build" when every step below passed, in this order, and the
// APK really contains the bundle that was just tested. Stops at the first failure (non-zero exit).
//
//   npm run release:check            typecheck → unit → e2e → build → cap sync → APK → bundle check
//   npm run release:check -- --web   stops after the web build (no Android toolchain needed)
//   npm run release:check -- --from "web build"   resume after fixing a later step (same tree only)
//
// Why it exists: steps run by hand were skipped or their failures hidden behind `| tail` (an
// unread e2e run, a `cap sync` that failed with EBUSY and an APK repackaged with the OLD bundle).
import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const webOnly = process.argv.includes('--web');
const env = { ...process.env };
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if (win && !env.PW_CHROMIUM_PATH && existsSync(chrome)) env.PW_CHROMIUM_PATH = chrome;

const from = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : null;
let skipping = !!from;
const done = [];
function step(name, cmd, cwd = root) {
  if (skipping && name !== from) return void done.push(`${name}: NOT RE-RUN (--from ${from})`);
  skipping = false;
  const t0 = Date.now();
  console.log(`\n=== ${name}: ${cmd}`);
  try {
    execSync(cmd, { cwd, env, stdio: 'inherit' });
  } catch {
    console.error(`\nRELEASE CHECK FAILED at "${name}". Nothing after it ran; do not ship this build.`);
    process.exit(1);
  }
  done.push(`${name} (${Math.round((Date.now() - t0) / 1000)} s)`);
}
function fail(msg) {
  console.error(`\nRELEASE CHECK FAILED: ${msg}`);
  process.exit(1);
}

step('typecheck', 'npm run typecheck');
step('unit tests', 'npm test');
step('browser tests', 'npx playwright test');
step('web build', 'npm run build');

const bundle = readdirSync(path.join(root, 'dist', 'assets')).find((f) => /^index-.*\.js$/.test(f));
if (!bundle) fail('dist/assets has no index-*.js');

if (!webOnly) {
  step('cap sync', 'npx cap sync android');
  step('apk', win ? '.\\gradlew.bat assembleDebug' : './gradlew assembleDebug', path.join(root, 'android'));
  const apk = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'LandPoly-debug.apk');
  if (!existsSync(apk)) fail(`${apk} was not produced`);
  // Windows ships bsdtar (reads zip); elsewhere unzip.
  const list = execSync(win ? `"${process.env.SystemRoot}\\System32\\tar.exe" -tf "${apk}"` : `unzip -Z1 "${apk}"`, { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (!list.includes(`assets/public/assets/${bundle}`)) fail(`the APK does not contain ${bundle}: it was packaged from a stale web build`);
  done.push(`apk contains ${bundle}`);
}

console.log(`\nRELEASE CHECK PASSED\n- ${done.join('\n- ')}`);
