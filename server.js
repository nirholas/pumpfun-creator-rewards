'use strict';
// Production server: static UI from dist/ + the /api/* handlers.
// One container, no CDN in front, so it also owns the cache headers.

const http = require('node:http');
const path = require('node:path');
const sirv = require('sirv');
const { createApiMiddleware } = require('./lib/node-adapter.js');

const PORT = Number(process.env.PORT) || 8080;
const DIST = path.join(__dirname, 'dist');

const api = createApiMiddleware();

const assets = sirv(DIST, {
  etag: true,
  gzip: true,
  brotli: true,
  // Unknown path → index.html. The UI is a single page; deep links land on it.
  single: true,
  setHeaders(res, pathname) {
    // Vite emits content-hashed files under /assets/ — safe to pin forever.
    // Everything else (index.html) must revalidate or deploys go unseen.
    res.setHeader(
      'cache-control',
      pathname.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate'
    );
  },
});

const server = http.createServer((req, res) => {
  // Not /healthz: Google's frontend reserves that path on Cloud Run and 404s
  // it before the request reaches the container.
  if (req.url === '/health') {
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end('ok');
    return;
  }
  api(req, res, () => assets(req, res));
});

server.listen(PORT, () => {
  console.log(`pumpfun-creator-fees listening on :${PORT}`);
});

// Cloud Run sends SIGTERM before reclaiming an instance; drain in-flight
// requests instead of dropping them.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
