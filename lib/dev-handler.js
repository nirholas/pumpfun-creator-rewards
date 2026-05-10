// Vite dev middleware shim that mirrors the Vercel function signature.
import { getCreatorFees } from './pump.js';

export function createApiHandler() {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const q = url.searchParams.get('q');
      if (!q) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'missing query param `q`' }));
        return;
      }
      const data = await getCreatorFees(q);
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.setHeader('cache-control', 'public, max-age=15');
      res.end(JSON.stringify(data));
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    }
  };
}
