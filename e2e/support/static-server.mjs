// Tiny production server for the Angular build: serves frontend/dist/frontend/browser with SPA fallback
// and proxies /api (incl. SSE) and /uploads to the backend.
//   node support/static-server.mjs <port> <backendUrl> <rootDir>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import httpProxy from 'http-proxy';

const port = Number(process.argv[2] || 4300);
const backend = process.argv[3] || 'http://127.0.0.1:3100';
const root = path.resolve(process.argv[4] || '../frontend/dist/frontend/browser');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const proxy = httpProxy.createProxyServer({ target: backend, changeOrigin: true, xfwd: true });
proxy.on('error', (err, _req, res) => {
  if (res && 'writeHead' in res && !res.headersSent) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ statusCode: 502, message: String(err.message) }));
  } else if (res && 'end' in res) {
    res.end();
  }
});

function sendFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  const stream = fs.createReadStream(file);
  // a file can vanish between the existence check and the read (e.g. the Angular build is being rewritten): answer
  // 503 instead of crashing the server
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(503, { 'content-type': 'text/plain', 'retry-after': '1' });
    res.end('build in progress');
  });
  stream.on('open', () => {
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    stream.pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = req.url || '/';
  if (url.startsWith('/api') || url.startsWith('/uploads')) {
    proxy.web(req, res);
    return;
  }
  const pathname = decodeURIComponent(url.split('?')[0]);
  const file = path.normalize(path.join(root, pathname));
  let isFile = false;
  try {
    isFile = file.startsWith(root) && fs.statSync(file).isFile();
  } catch {
    isFile = false;
  }
  if (isFile) {
    sendFile(res, file);
    return;
  }
  // SPA fallback (only for non-asset paths)
  if (path.extname(pathname)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  sendFile(res, path.join(root, 'index.html'));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[static] http://127.0.0.1:${port} → ${root} (proxy /api,/uploads → ${backend})`);
});
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
