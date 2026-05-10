'use strict';
const SWAP_API = 'https://swap-api.pump.fun';
const FRONTEND = 'https://frontend-api-v3.pump.fun';
const HEADERS  = { 'User-Agent': 'pumpfun-creator-fees/0.1', 'Origin': 'https://pump.fun', 'Accept': 'application/json' };

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

module.exports = async function handler(req, res) {
  const { q, cursor } = req.query;
  if (!q) { res.status(400).json({ error: 'missing mint address' }); return; }

  try {
    const [coin, timelineData] = await Promise.all([
      getJson(`${FRONTEND}/coins-v2/${encodeURIComponent(q)}`),
      getJson(`${SWAP_API}/v1/coins/${encodeURIComponent(q)}/timeline?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`),
    ]);

    if (!coin) { res.status(404).json({ error: 'coin not found' }); return; }

    res.setHeader('cache-control', 'public, s-maxage=30, stale-while-revalidate=120');
    res.status(200).json({
      coin: {
        mint:            coin.mint,
        name:            coin.name,
        symbol:          coin.symbol,
        image:           coin.image_uri,
        description:     coin.description,
        marketCapUsd:    coin.usd_market_cap,
        athMarketCapUsd: coin.ath_market_cap,
        createdTimestamp: coin.created_timestamp,
        twitter:         coin.twitter,
        website:         coin.website,
        creator:         coin.creator,
        complete:        coin.complete,
      },
      items:      timelineData?.items ?? [],
      pagination: timelineData?.pagination ?? { hasMore: false },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
