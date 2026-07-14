# pumpfun-creator-fees

Look up Pump.fun creator-reward earnings by **coin mint**, **wallet address**, or **username**.

Single-page web app with a JSON API. Live data, no mocks. Ships as one container on Google Cloud Run.

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
npm run dev          # vite on :3000, all three /api routes served by middleware
```

Open <http://localhost:3000> and try a mint, wallet, or username.

To run the production server (built assets + API, exactly what the container runs):

```bash
npm run serve        # build, then node server.js on :8080
```

## Architecture

One container serves everything:

- `server.js` — Node HTTP server. Static UI from `dist/` (hashed assets cached forever, `index.html` revalidated), `/api/*` routed to the handlers, `/health` for the platform probe.
- `lib/node-adapter.js` — maps the `api/*.js` handlers (written against the Vercel `req.query` / `res.status().json()` signature) onto plain Node request and response objects. Both `server.js` and the Vite dev server mount it, so a route that works in dev works in production.
- `api/*.js` — the three endpoints. No database, no secrets, no state: every response is derived live from the pump.fun APIs and a Solana RPC call.

## Deploy (Google Cloud Run)

```bash
gcloud auth login              # once, if your token has expired
npm run deploy
```

`npm run deploy` submits `cloudbuild.yaml` to Cloud Build, which builds the image with BuildKit inline caching (an unchanged `package-lock.json` skips `npm ci`), pushes it to Artifact Registry, and deploys it to the `pumpfun-creator-rewards` Cloud Run service in `us-central1`.

The service scales to zero, so it costs nothing when idle. Both the build and runtime service accounts are pinned in `cloudbuild.yaml` on purpose: the project's default compute service account was deleted, and a build that falls back to it fails.

Nothing needs to be configured for the app to run. There are no environment variables and no secrets.

## License

MIT
