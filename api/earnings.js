'use strict';
const { getEarningsBreakdown } = require('../lib/pump.js');

module.exports = async function handler(req, res) {
  const q = req.query?.q;
  if (!q || typeof q !== 'string') {
    res.status(400).json({ error: 'missing query param `q`' });
    return;
  }
  try {
    const data = await getEarningsBreakdown(q);
    // Heavier than /api/fees (one timeline walk per coin) and the underlying
    // distributions are append-only, so it caches harder.
    res.setHeader('cache-control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.status(200).json(data);
  } catch (err) {
    const msg = err?.message || String(err);
    const status = /not found/i.test(msg) ? 404 : 502;
    res.status(status).json({ error: msg });
  }
};
