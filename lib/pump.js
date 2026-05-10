'use strict';
// Pump.fun resolver + creator-fee fetcher.
const { createHash } = require('node:crypto');

const FRONTEND = 'https://frontend-api-v3.pump.fun';
const SWAP_API = 'https://swap-api.pump.fun';
const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

// pfee program — social vault PDA seeds: ["social-fee-pda", numeric_id_str, [platform_byte]]
// Platform enum: Pump=0, X=1, GitHub=2, Google=3, Discord=4, Reddit=5,
//   TikTok=6, YouTube=7, Twitch=8, LinkedIn=9, Facebook=10, Instagram=11, Telegram=13
const PFEE_PROGRAM = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
const PLATFORM = { pump: 0, x: 1, twitter: 1, github: 2, google: 3, discord: 4, reddit: 5, tiktok: 6, youtube: 7, twitch: 8, linkedin: 9, facebook: 10, instagram: 11, snapchat: 12, telegram: 13 };

// Bonding-curve account: sharing-config PDA at byte 49.
// Sharing-config: disc(8) + ?(32) + admin(32) + flags(4) + vec_len(4) + shares(n×36)
const BC_CONFIG_OFFSET = 49;

const HEADERS = {
  'User-Agent': 'pumpfun-creator-fees/0.1',
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

function b58dec(s) {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(B58_ALPHA.indexOf(c));
  const b = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) { b[i] = Number(n & 0xffn); n >>= 8n; }
  return b;
}

// ── Solana PDA derivation (pure Node:crypto + BigInt) ────────────────────────
const ED25519_P = (1n << 255n) - 19n;
const ED25519_D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;

function modP(x) { return ((x % ED25519_P) + ED25519_P) % ED25519_P; }
function powModP(b, e) {
  let r = 1n; b = modP(b);
  while (e > 0n) { if (e & 1n) r = r * b % ED25519_P; b = b * b % ED25519_P; e >>= 1n; }
  return r;
}

function isOnEd25519Curve(bytes) {
  let y = 0n;
  for (let i = 0; i < 32; i++) y |= BigInt(bytes[i]) << BigInt(8 * i);
  y &= (1n << 255n) - 1n;
  const y2 = y * y % ED25519_P;
  const u = modP(y2 - 1n);
  const v = modP(ED25519_D * y2 + 1n);
  const x2 = u * powModP(v, ED25519_P - 2n) % ED25519_P;
  if (x2 === 0n) return true;
  return powModP(x2, (ED25519_P - 1n) / 2n) === 1n;
}

function findPDA(seeds, programIdStr) {
  const progBytes = Buffer.from(b58dec(programIdStr));
  const suffix = Buffer.from('ProgramDerivedAddress');
  for (let bump = 255; bump >= 0; bump--) {
    const data = Buffer.concat([...seeds, Buffer.from([bump]), progBytes, suffix]);
    const hash = createHash('sha256').update(data).digest();
    if (!isOnEd25519Curve(hash)) return b58enc(hash);
  }
  throw new Error('could not find PDA');
}

function socialVaultAddress(platformId, userId) {
  return findPDA(
    [Buffer.from('social-fee-pda'), Buffer.from(String(userId)), Buffer.from([platformId])],
    PFEE_PROGRAM
  );
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
  if (!text) { if (allowEmpty) return null; throw new Error(`empty response from ${url}`); }
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
  return { owner: result.value.owner, lamports: result.value.lamports, data: Buffer.from(result.value.data[0], 'base64') };
}

// ── Platform ID resolvers ─────────────────────────────────────────────────────

async function resolveGitHubId(username) {
  const res = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}`, {
    headers: { 'User-Agent': 'pumpfun-creator-fees/0.1', 'Accept': 'application/vnd.github+json' },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.id ? String(data.id) : null;
}

async function resolveXId(username) {
  // Scrape id_str from the public X profile page — no API key needed.
  const res = await fetch(`https://x.com/${encodeURIComponent(username)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(/"id_str":"(\d+)"/);
  return m ? m[1] : null;
}

// ── Input parsing ─────────────────────────────────────────────────────────────

function parsePlatformPrefix(q) {
  const prefixMap = { github: 'github', gh: 'github', x: 'x', twitter: 'x', tiktok: 'tiktok', tt: 'tiktok', discord: 'discord', reddit: 'reddit', youtube: 'youtube', yt: 'youtube', twitch: 'twitch', pump: 'pump' };
  const m = q.match(/^([a-z]+):(.+)$/i);
  if (m) {
    const platform = prefixMap[m[1].toLowerCase()];
    if (platform) return { platform, username: m[2].trim() };
  }
  return null;
}

// ── Pump.fun API ──────────────────────────────────────────────────────────────

async function fetchCoin(mint) {
  return getJson(`${FRONTEND}/coins-v2/${encodeURIComponent(mint)}`, { allow404: true, allowEmpty: true });
}

async function fetchUserByUsernameOrAddress(value) {
  return getJson(`${FRONTEND}/users/${encodeURIComponent(value)}`, { allow404: true, allowEmpty: true });
}

async function fetchTotals(wallet, { mint } = {}) {
  const url = new URL(`${SWAP_API}/v1/fee-sharing/account/${encodeURIComponent(wallet)}/totals`);
  if (mint) url.searchParams.set('mint', mint);
  return getJson(url.toString());
}

async function fetchShares(wallet, { limit = 20 } = {}) {
  const url = new URL(`${SWAP_API}/v1/fee-sharing/account/${encodeURIComponent(wallet)}/shares`);
  url.searchParams.set('limit', String(limit));
  return getJson(url.toString());
}

// ── On-chain sharing-config resolution ───────────────────────────────────────

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
    if (BASE58_RE.test(pubkey) && bps > 0) recipients.push({ wallet: pubkey, bps, sharePct: bps / 100 });
  }
  return recipients.length ? { configAddress, recipients } : null;
}

// ── Social vault resolution ───────────────────────────────────────────────────

async function resolveSocialVault(platform, username) {
  const platformId = PLATFORM[platform];
  if (platformId === undefined) throw new Error(`unsupported platform: ${platform}`);

  if (platform === 'pump') {
    const user = await fetchUserByUsernameOrAddress(username);
    if (!user?.address) throw new Error(`pump.fun username "${username}" not found`);
    return { type: 'username', wallet: user.address, username: user.username || username, platform: 'pump', userMeta: user };
  }

  let numericId;
  if (platform === 'github') {
    numericId = await resolveGitHubId(username);
    if (!numericId) throw new Error(`GitHub user "${username}" not found`);
  } else if (platform === 'x') {
    numericId = await resolveXId(username);
    if (!numericId) throw new Error(`X user "@${username}" not found or profile is private.`);
  } else if (/^\d+$/.test(username)) {
    numericId = username;
  } else {
    throw new Error(`For ${platform}, provide the numeric user ID (e.g. ${platform}:12345678) — username lookup isn't available for this platform yet.`);
  }

  const vaultAddress = socialVaultAddress(platformId, numericId);
  const account = await solanaGetAccount(vaultAddress).catch(() => null);
  if (!account || account.owner !== PFEE_PROGRAM) {
    throw new Error(`No pump.fun creator vault found for ${platform} user "${username}". They may not have linked their ${platform} account on pump.fun yet.`);
  }

  return { type: 'social', wallet: vaultAddress, platform, username, numericId };
}

// ── Input resolution ──────────────────────────────────────────────────────────

async function resolveInput(raw) {
  const q = String(raw || '').trim().replace(/^@/, '');
  if (!q) throw new Error('empty input');

  const prefixed = parsePlatformPrefix(q);
  if (prefixed) return resolveSocialVault(prefixed.platform, prefixed.username);

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
    return { type: 'wallet', wallet: q, username: user?.username || null, userMeta: user || null };
  }

  const user = await fetchUserByUsernameOrAddress(q);
  if (user?.address) return { type: 'username', wallet: user.address, username: user.username || q, userMeta: user };

  // Fallback: try as GitHub username
  const ghResult = await resolveSocialVault('github', q).catch(() => null);
  if (ghResult) return ghResult;

  throw new Error(`"${q}" not found. Try: github:username · x:numeric_id · tiktok:numeric_id · coin mint · wallet address · pump.fun username`);
}

function coinMetaFrom(coin) {
  return { mint: coin.mint, name: coin.name, symbol: coin.symbol, image: coin.image_uri || null, marketCapUsd: coin.usd_market_cap ?? null, creator: coin.creator, createdTimestamp: coin.created_timestamp ?? null, twitter: coin.twitter || null, website: coin.website || null };
}

// ── Top-level entry ───────────────────────────────────────────────────────────

async function getCreatorFees(query) {
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
    return { mint: s.mint, bps: s.bps, sharePct: typeof s.bps === 'number' ? s.bps / 100 : null, isAdmin: !!s.isAdmin, name: meta?.name || null, symbol: meta?.symbol || null, image: meta?.image_uri || null, marketCapUsd: meta?.usd_market_cap ?? null, createdTimestamp: meta?.created_timestamp ?? null };
  });

  return {
    query: String(query),
    resolved: {
      type, wallet,
      mint: mint || null,
      platform: resolved.platform || null,
      username: resolved.username || null,
      numericId: resolved.numericId || null,
      coinMeta: resolved.coinMeta || null,
      sharingConfigAddress: resolved.sharingConfigAddress || null,
      onChainRecipients: resolved.onChainRecipients || null,
      profile: resolved.userMeta ? { username: resolved.userMeta.username || null, bio: resolved.userMeta.bio || null, profileImage: resolved.userMeta.profile_image || null, followers: resolved.userMeta.followers ?? null } : null,
    },
    totals: totalsAll,
    totalsForCoin,
    coins,
    sharesPagination: sharesResp?.pagination || null,
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { getCreatorFees, fetchCoin, fetchTotals, fetchShares, resolveInput };
