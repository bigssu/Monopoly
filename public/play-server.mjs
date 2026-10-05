// Serve this folder over http and open the game (browsers block the game's scripts on file://).
// Started by play.cmd; zero dependencies. A fixed local port (saved games are kept per address);
// the next port if it is taken.
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.txt': 'text/plain',
};

const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  let file = join(root, path);
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    statSync(file);
  } catch {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

function listen(port) {
  server.once('error', (e) => (e.code === 'EADDRINUSE' ? listen(port + 1) : console.error(e)));
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`Money Poly: ${url}  (close this window to stop)`);
    exec(process.platform === 'win32' ? `start "" ${url}` : `open ${url}`);
  });
}
listen(5317);
