# pumpfun-creator-fees

Look up Pump.fun creator-reward earnings by **coin mint**, **wallet address**, or **username**.

Single-page web app with a JSON API. Live data, no mocks. Deploys to Vercel.

## What it shows

Given any of the three inputs, returns:

- **Total earned** (lifetime, in SOL + USD)
- **Claimed** (already withdrawn by the creator)
- **Unclaimed** (sitting in the fee-sharing vault)
- **Per-coin breakdown** — every coin currently sharing fees with the resolved wallet, with image, market cap, and share basis points

When the input is a coin mint, it also shows the creator's all-coin totals for context.

## API

```
GET /api/fees?q=<mint|wallet|username>
```

Response:

```jsonc
{
  "query": "...",
  "resolved": {
    "type": "mint" | "wallet" | "username",
    "wallet": "...",
    "mint": "...",         // present when type=mint
    "username": "...",     // present when known
    "coinMeta": { ... },   // present when type=mint
    "profile": { ... }     // present when wallet has a pump profile
  },
  "totals": {
    "shareholderClaimed":     { "lamports": "...", "sol": "...", "usd": "..." },
    "shareholderUnclaimed":   { ... },
    "shareholderTotalEarned": { ... },
    "mintCount": 0
  },
  "totalsForCoin": { ... },  // present when type=mint
  "coins": [
    { "mint": "...", "name": "...", "symbol": "...", "image": "...",
      "bps": 10000, "sharePct": 100, "isAdmin": true,
      "marketCapUsd": 0, "createdTimestamp": 0 }
  ],
  "fetchedAt": "..."
}
```

## Data sources

This is a thin proxy over Pump.fun's own public-but-undocumented APIs:

- `https://swap-api.pump.fun/v1/fee-sharing/account/{wallet}/totals` — earnings (with optional `?mint=` filter)
- `https://swap-api.pump.fun/v1/fee-sharing/account/{wallet}/shares` — per-coin sharing config
- `https://frontend-api-v3.pump.fun/coins-v2/{mint}` — coin metadata + creator
- `https://frontend-api-v3.pump.fun/users/{username|wallet}` — username → wallet

These are the same endpoints the live pump.fun frontend calls. Not affiliated with Pump.fun.

## Local dev

```bash
npm install
npm run dev          # vite on :3000, with /api/fees served by middleware
```

Open <http://localhost:3000> and try a mint, wallet, or username.

## Deploy

```bash
vercel
```

The `api/fees.js` route runs as a Node 20 serverless function; the static UI ships from `dist/`.

## License

MIT
