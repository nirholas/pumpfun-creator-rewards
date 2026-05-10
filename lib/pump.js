// Pump.fun resolver + creator-fee fetcher.
// Endpoints reverse-engineered from the live pump.fun frontend bundle.
// On-chain sharing config structure discovered by decoding the pfee program accounts.

const FRONTEND = 'https://frontend-api-v3.pump.fun';
const SWAP_API = 'https://swap-api.pump.fun';
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

// Pump.fun fee-sharing program (pfee)
const PFEE_PROGRAM = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';

// Byte offsets where the sharing-config PDA address is stored:
//   - bonding-curve account (all coins, pre- and post-graduation): byte 49
//   - PumpSwap pool account (graduated coins only): byte 211
// Sharing-config account layout (1024 bytes, Anchor):
//   [0:8]   discriminator
//   [8:40]  field1 (internal)
//   [40:72] admin pubkey
//   [72:76] flags/nonce
//   [76:80] vec_len (number of shares)
//   [80 + i*36] share[i]: 32-byte recipient pubkey + 4-byte bps (u32 LE)
const BC_CONFIG_OFFSET = 49;

const HEADERS = {
  'User-Agent': 'pumpfun-creator-fees/0.1 (+https://github.com/)',
  'Accept': 'application/json',
  'Origin': 'https://pump.fun',
  'Referer': 'https://pump.fun/',
};

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const B58_ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function b58enc(buf) {
  let n = 0n;
  for (const b of buf) n = (n << 8n) | BigInt(b);
  if (!n) return '1';
  const r = [];
  while (n > 0n) { const rem = n % 58n; r.push(B58_ALPHA[Number(rem)]); n = (n - rem) / 58n; }
  return r.reverse().join('');
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function getJson(url, { allow404 = false, allowEmpty = false } = {}) {
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 404 && allow404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} for ${url}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
  const text = await res.text();
  if (!text) {
    if (allowEmpty) return null;
    throw new Error(`empty response from ${url}`);
  }
  return JSON.parse(text);
}

async function solanaGetAccount(address) {
  const res = await fetch(SOLANA_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [address, { encoding: 'base64' }] }),
  });
  const { result } = await res.json();
  if (!result?.value) return null;
  const raw = Buffer.from(result.value.data[0], 'base64');
  return { owner: result.value.owner, lamports: result.value.lamports, data: raw };
}

// ── Pump.fun API wrappers ─────────────────────────────────────────────────────

export async function fetchCoin(mint) {
  return getJson(`${FRONTEND}/coins-v2/${encodeURIComponent(mint)}`, { allow404: true, allowEmpty: true });
}

export async function fetchUserByUsernameOrAddress(value) {
  return getJson(`${FRONTEND}/users/${encodeURIComponent(value)}`, { allow404: true, allowEmpty: true });
}

export async function fetchTotals(wallet, { mint } = {}) {
  const url = new URL(`${SWAP_API}/v1/fee-sharing/account/${encodeURIComponent(wallet)}/totals`);
  if (mint) url.searchParams.set('mint', mint);
  return getJson(url.toString());
}

export async function fetchShares(wallet, { limit = 20, cursor = '' } = {}) {
  const url = new URL(`${SWAP_API}/v1/fee-sharing/account/${encodeURIComponent(wallet)}/shares`);
  url.searchParams.set('limit', String(limit));
  if (cursor) url.searchParams.set('cursor', cursor);
  return getJson(url.toString());
}

// ── On-chain sharing-config resolution ───────────────────────────────────────

// Given a coin's bonding_curve address, read the sharing-config PDA address embedded at byte 49,
// then decode the recipients from the sharing-config account.
// Returns null if the coin has no fee-sharing set up.
async function fetchOnChainRecipients(bondingCurve) {
  if (!bondingCurve) return null;
  const bcAccount = await solanaGetAccount(bondingCurve).catch(() => null);
  if (!bcAccount || bcAccount.data.length < BC_CONFIG_OFFSET + 32) return null;

  const configAddress = b58enc(bcAccount.data.slice(BC_CONFIG_OFFSET, BC_CONFIG_OFFSET + 32));
  if (!BASE58_RE.test(configAddress)) return null;

  const configAccount = await solanaGetAccount(configAddress).catch(() => null);
  if (!configAccount || configAccount.owner !== PFEE_PROGRAM) return null;

  const raw = configAccount.data;
  const vecLen = raw.readUInt32LE(76);
  if (vecLen === 0 || vecLen > 50) return null;

  const recipients = [];
  for (let i = 0; i < vecLen; i++) {
    const off = 80 + i * 36;
    if (off + 36 > raw.length) break;
    const pubkey = b58enc(raw.slice(off, off + 32));
    const bps = raw.readUInt32LE(off + 32);
    if (BASE58_RE.test(pubkey) && bps > 0) {
      recipients.push({ wallet: pubkey, bps, sharePct: bps / 100 });
    }
  }
  return recipients.length ? { configAddress, recipients } : null;
}

// ── Input resolution ──────────────────────────────────────────────────────────

export async function resolveInput(raw) {
  const q = String(raw || '').trim().replace(/^@/, '');
  if (!q) throw new Error('empty input');

  if (BASE58_RE.test(q)) {
    const coin = await fetchCoin(q);
    if (coin && coin.creator) {
      const onChain = await fetchOnChainRecipients(coin.bonding_curve).catch(() => null);
      return {
        type: 'mint',
        wallet: onChain?.recipients?.[0]?.wallet ?? coin.creator,
        mint: q,
        coinMeta: coinMetaFrom(coin),
        onChainRecipients: onChain?.recipients || null,
        sharingConfigAddress: onChain?.configAddress || null,
      };
    }
    const user = await fetchUserByUsernameOrAddress(q);
    return {
      type: 'wallet',
      wallet: q,
      username: user?.username || null,
      userMeta: user || null,
    };
  }

  const user = await fetchUserByUsernameOrAddress(q);
  if (!user || !user.address) {
    throw new Error(
      `"${q}" not found as a pump.fun username. GitHub-linked creators don't have pump.fun usernames — paste their wallet or vault address instead (visible on any of their coin pages under "Creator rewards").`
    );
  }
  return {
    type: 'username',
    wallet: user.address,
    username: user.username || q,
    userMeta: user,
  };
}

function coinMetaFrom(coin) {
  return {
    mint: coin.mint,
    name: coin.name,
    symbol: coin.symbol,
    image: coin.image_uri || null,
    marketCapUsd: coin.usd_market_cap ?? null,
    creator: coin.creator,
    createdTimestamp: coin.created_timestamp ?? null,
    twitter: coin.twitter || null,
    website: coin.website || null,
  };
}

// ── Top-level entry ───────────────────────────────────────────────────────────

export async function getCreatorFees(query) {
  const resolved = await resolveInput(query);
  const { wallet, type, mint } = resolved;

  const [totalsAll, totalsForCoin, sharesResp] = await Promise.all([
    fetchTotals(wallet),
    type === 'mint' ? fetchTotals(wallet, { mint }) : Promise.resolve(null),
    fetchShares(wallet, { limit: 20 }),
  ]);

  const shares = sharesResp?.items || [];
  const coinMetas = await Promise.all(shares.map((s) => fetchCoin(s.mint).catch(() => null)));

  const coins = shares.map((s, i) => {
    const meta = coinMetas[i];
    return {
      mint: s.mint,
      bps: s.bps,
      sharePct: typeof s.bps === 'number' ? s.bps / 100 : null,
      isAdmin: !!s.isAdmin,
      name: meta?.name || null,
      symbol: meta?.symbol || null,
      image: meta?.image_uri || null,
      marketCapUsd: meta?.usd_market_cap ?? null,
      createdTimestamp: meta?.created_timestamp ?? null,
    };
  });

  return {
    query: String(query),
    resolved: {
      type,
      wallet,
      mint: mint || null,
      username: resolved.username || null,
      coinMeta: resolved.coinMeta || null,
      sharingConfigAddress: resolved.sharingConfigAddress || null,
      onChainRecipients: resolved.onChainRecipients || null,
      profile: resolved.userMeta
        ? {
            username: resolved.userMeta.username || null,
            bio: resolved.userMeta.bio || null,
            profileImage: resolved.userMeta.profile_image || null,
            followers: resolved.userMeta.followers ?? null,
            xUsername: resolved.userMeta.x_username || null,
          }
        : null,
    },
    totals: totalsAll,
    totalsForCoin,
    coins,
    sharesPagination: sharesResp?.pagination || null,
    fetchedAt: new Date().toISOString(),
  };
}
