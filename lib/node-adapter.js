'use strict';
// Runs the api/*.js handlers on a plain Node http server.
//
// The handlers are written against the Vercel signature — `req.query`,
// `res.status(n).json(body)` — so this adapter supplies those two things on top
// of Node's IncomingMessage/ServerResponse. The production server (server.js)
// and the Vite dev server both mount this, so a route that works in dev works
// in prod.

const ROUTES = {
  '/api/fees': () => require('../api/fees.js'),
  '/api/earnings': () => require('../api/earnings.js'),
  '/api/timeline': () => require('../api/timeline.js'),
  '/api/xid': () => require('../api/xid.js'),
};

function enhance(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  req.query = Object.fromEntries(url.searchParams);

  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    if (!res.headersSent) res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
    return res;
  };

  return url;
}

// Returns a connect-style middleware: handles /api/* and calls next() for
// anything else (static assets in prod, the Vite pipeline in dev).
function createApiMiddleware() {
  return async (req, res, next) => {
    const url = enhance(req, res);
    const load = ROUTES[url.pathname];

    if (!load) {
      if (url.pathname.startsWith('/api/')) {
        res.status(404).json({ error: `no such endpoint: ${url.pathname}` });
        return;
      }
      next();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('allow', 'GET, HEAD');
      res.status(405).json({ error: `${req.method} not allowed on ${url.pathname}` });
      return;
    }

    try {
      await load()(req, res);
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return;
      }
      res.status(500).json({ error: err?.message || String(err) });
    }
  };
}

module.exports = { createApiMiddleware, ROUTES };
