// Shared helpers for the FX baker + contact sheet (Node only).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT_DIR = resolve(ROOT, 'public/fx');

export async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, '/opt/node22/lib/node_modules/playwright/index.mjs'].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return import(c);
  }
  try {
    return await import('playwright');
  } catch {
    try {
      return await import('@playwright/test');
    } catch {
      throw new Error('Playwright not found: set PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs');
    }
  }
}

export async function launchChromium() {
  const pw = await loadPlaywright();
  const chromium = pw.chromium ?? pw.default?.chromium;
  const executablePath =
    process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  return chromium.launch({ executablePath, args: ['--no-sandbox'] });
}

/** Bundle the TypeScript sprite generators with esbuild (already a Vite dependency) and import them. */
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
