---
name: creator-rewards-lookup
description: Look up how much a Pump.fun creator earned in fee-sharing rewards, in total and per coin, from a coin mint, a wallet address or a username. Use when asked what a coin or creator has earned, claimed or left unclaimed.
---

# Pump.fun creator rewards lookup

The repo `nirholas/pumpfun-creator-rewards` runs a small JSON API over Pump.fun's public fee-sharing endpoints. A hosted instance is documented in the README:

    https://pumpfun-creator-rewards-lp642k3kpa-uc.a.run.app

No API key and no environment variables are needed. Use `curl` and parse the JSON.

## Endpoints

All are `GET`. `q` accepts a coin mint, a wallet address or a username (the API resolves which).

- `/api/fees?q=<mint|wallet|username>`: fast summary. Returns `resolved` (type, wallet, mint, username), `totals` (`shareholderClaimed`, `shareholderUnclaimed`, `shareholderTotalEarned`, each with `lamports`, `sol`, `usd`, plus `mintCount`), `solPriceUsd` and `coins` (every coin sharing fees with the wallet, with `bps` and `sharePct`).
- `/api/earnings?q=<mint|wallet|username>`: the same plus what each coin actually paid. Adds `coins[].earned`, `earnedLast30d`, `shareOfEarningsPct`, `distributions`, `firstEarnedAt`, `lastEarnedAt`, an `insights` block and a `reconciliation` block. Heavier than `/api/fees` (a few seconds cold for a large creator).
- `/api/timeline?q=<mint>&cursor=<cursor>`: a coin's raw event feed (creation, fee-sharing config changes, every distribution with its transaction signature). Paginated 50 at a time.
- `/api/xid?username=<x_handle>`: resolves an X handle to the numeric user ID that Pump.fun social vaults are keyed by.

Errors come back as `{"error": "..."}` with 400 (missing parameter), 404 (not found) or 502 (upstream failure).

## How to read the numbers

- Per-coin earnings are amounts distributed (paid out). Pump.fun reports unclaimed fees only at wallet level, so unclaimed cannot be split per coin.
- When `q` is a mint, the headline is what that coin paid (`coinEarnings`); `totals` are the creator's lifetime totals across all coins.
- `reconciliation.deltaPct` shows how close the summed per-coin distributions are to the API's claimed figure. Report it if it is not near zero.
- A pooled withdrawal from a shared fee account carries no mint. Do not assign it to a coin; label it unresolved.

## Worked example

```bash
BASE=https://pumpfun-creator-rewards-lp642k3kpa-uc.a.run.app
curl -s "$BASE/api/earnings?q=<mint>" | jq '{wallet: .resolved.wallet, coin: .coinEarnings, top: .insights.topCoin, last30d: .insights.last30d}'
```

Summarise: the resolved wallet, what this coin paid in SOL and USD, its share of the creator's total, and the last 30 days.

## Running your own copy

Clone the repo and run `npm install` then `npm run serve` (builds, then `node server.js` on port 8080, or `PORT`). Use `http://localhost:8080` as `BASE`. The data is live from Pump.fun, which does not document these endpoints, so they can change.
