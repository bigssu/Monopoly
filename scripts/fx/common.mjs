// Shared helpers for the Node scripts: Chromium, a `vite preview` server, the FX sprite bundle.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT_DIR = resolve(ROOT, 'public/fx');

/** Chromium for Playwright: `CHROMIUM_PATH`, else /opt/pw-browsers/chromium when present, else Playwright's own. */
export async function launchChromium() {
  const { chromium } = await import('@playwright/test');
  const executablePath =
    process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  return chromium.launch({ executablePath, args: ['--no-sandbox'] });
}

/**
 * `vite preview` of `root`/dist on `port`, in its own process group (npx forks the real server, which a
 * plain kill() would leave running) that dies with this process. Resolves with the base URL once
 * the server answers.
 */
export async function serve(port, root = ROOT) {
  const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
  process.on('exit', () => {
    try {
      process.kill(-server.pid);
    } catch {
      /* gone */
    }
  });
  process.on('SIGINT', () => process.exit(130));
  process.on('SIGTERM', () => process.exit(143));
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + '/')).ok) return base;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`preview server did not start on ${base} (run \`npx vite build\` first)`);
}

/** Bundle the TypeScript sprite generators with esbuild (a direct devDependency) and import them. */
export async function loadSprites(entry = 'src/content/fx/sprites.ts') {
  const require = createRequire(import.meta.url);
  const esbuild = require('esbuild');
  const res = await esbuild.build({
    entryPoints: [resolve(ROOT, entry)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'error',
  });
  const code = res.outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}
