# pumpfun-creator-fees

Look up Pump.fun creator-reward earnings by **coin mint**, **wallet address**, or **username**.

Single-page web app with a JSON API. Live data, no mocks. Ships as one container on Google Cloud Run.

## What it shows

Given any of the three inputs:

- **Lifetime totals** for the resolved wallet: total earned, claimed, and unclaimed (SOL + USD)
- **Per-coin earnings** — exactly how much *each individual coin* has paid this wallet, with the payout count, when it last paid, and what share of the creator's total income it represents
- **Breakdown stats** — how many coins have ever actually paid out, how concentrated the income is (e.g. "2 coins make up 90% of earnings"), and the last 30 days of earnings
- **Distribution timeline** for a coin: every fee-sharing config change and every payout, with transaction links

When the input is a coin mint, the headline figure is **what that coin paid**, with the creator's all-coin lifetime totals shown separately underneath as context.

### How per-coin earnings are derived

This is the part worth understanding, because pump.fun does not hand it to you.

The wallet totals endpoint accepts a `mint` query param, but **ignores it**: filtering by mint returns byte-identical numbers to the unfiltered call, even for a mint the wallet has no share in. Anything that presents `totals?mint=X` as "what coin X earned" is really showing the creator's lifetime total across every coin.

The real per-coin figure comes from each coin's **distribution timeline**. Every `distribution` event lists the exact lamports paid to each recipient, so summing the entries addressed to the wallet gives what that coin actually paid it. Across a 53-coin creator, those per-coin sums add up to within **0.0004%** of the wallet's reported lifetime `shareholderClaimed`, which is the check that says the method is sound. Every response includes a `reconciliation` block reporting that delta, so drift is visible rather than silent.

One honest limitation: pump.fun reports **unclaimed** fees only at the wallet level, so unclaimed cannot be attributed per coin. Per-coin numbers are therefore amounts *distributed* (paid out), and they reconcile against `shareholderClaimed`, not `shareholderTotalEarned`. The UI says so.

## API

### `GET /api/fees?q=<mint|wallet|username>`

Fast summary: the resolved identity, lifetime totals, and every coin sharing fees with the wallet (fully paginated — a creator with 53 coins returns 53, not the first page).

```jsonc
{
  "query": "...",
  "resolved": {
    "type": "mint" | "wallet" | "username" | "social",
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
    "mintCount": 53
  },
  "solPriceUsd": 76.29,    // derived from the API's own SOL/USD pair, not an oracle
  "coins": [
    { "mint": "...", "name": "...", "symbol": "...", "image": "...",
      "bps": 10000, "sharePct": 100, "isAdmin": true,
      "marketCapUsd": 0, "createdTimestamp": 0 }
  ],
  "coinsTruncated": false, // true only if the creator has more coins than we can page
  "fetchedAt": "..."
}
```

### `GET /api/earnings?q=<mint|wallet|username>`

The intelligence view. Same shape, plus what each coin actually paid. Walks one timeline per coin (concurrency-capped and cached), so it is heavier than `/api/fees` — around 1.7s cold for a 53-coin creator, and the UI renders the summary first and fills this in when it lands.

```jsonc
{
  "resolved": { ... },
  "totals":   { ... },
  "solPriceUsd": 76.29,
  "coinEarnings": { ... },  // present when type=mint: THIS coin's entry from `coins`
  "coins": [                // sorted by earnings, descending
    {
      "mint": "...", "name": "...", "symbol": "...", "image": "...",
      "bps": 10000, "sharePct": 100, "marketCapUsd": 0,
      "earned":        { "lamports": "2856250...", "sol": 2856.25, "usd": 217899.1 },
      "earnedLast30d": { "lamports": "...", "sol": 0, "usd": 0 },
      "shareOfEarningsPct": 89.4,   // this coin's cut of everything the wallet was paid
      "distributions": 127,          // number of payouts
      "firstEarnedAt": "2026-06-08T20:50:01.000Z",
      "lastEarnedAt":  "2026-07-12T09:14:03.000Z"
    }
  ],
  "insights": {
    "coinCount": 53,
    "earningCoinCount": 37,
    "silentCoinCount": 16,        // share fees but have never paid a lamport
    "distributed": { "sol": 3193.96, "usd": 243662.4 },
    "unclaimed":   { "sol": "86.73", "usd": "6626.76" },
    "last30d":     { "sol": 939.69, "usd": 71688.2 },
    "lastEarnedAt": "2026-07-12T09:14:03.000Z",
    "topCoin": { "mint": "...", "name": "...", "earned": { ... } },
    "topCoinSharePct": 89.4,
    "coinsFor90Pct": 2            // coins needed to account for 90% of all earnings
  },
  "reconciliation": {             // summed distributions vs the API's own claimed figure
    "summedDistributions": { "sol": 3193.956, ... },
    "apiClaimed":          { "sol": "3193.967815798", ... },
    "deltaSol": -0.0119,
    "deltaPct": -0.0004
  },
  "fetchedAt": "..."
}
```

### `GET /api/timeline?q=<mint>&cursor=<cursor>`

A coin's raw event feed: creation, fee-sharing config changes, and every distribution with its transaction signature. Paginated.

### `GET /api/xid?username=<x_handle>`

Resolves an X/Twitter handle to the numeric user ID that pump.fun's social vaults are keyed by.

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

All rights reserved. See [LICENSE](LICENSE).
