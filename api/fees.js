'use strict';
const { getCreatorFees } = require('../lib/pump.js');

module.exports = async function handler(req, res) {
  const q = req.query?.q;
  if (!q || typeof q !== 'string') {
    res.status(400).json({ error: 'missing query param `q`' });
    return;
  }
  try {
    const data = await getCreatorFees(q);
    res.setHeader('cache-control', 'public, s-maxage=15, stale-while-revalidate=60');
    res.status(200).json(data);
  } catch (err) {
    const msg = err?.message || String(err);
    const status = /not found/i.test(msg) ? 404 : 502;
    res.status(status).json({ error: msg });
  }
};
