// Gated lookups — must be declared before any lookup() call
const GATED_WALLETS = new Set([
  '71zpR8ZGSo4tEgWf8AmyuPcx3fzYjqwTDSAuhwQxBmSd',
]);
const GATED_NAMES = new Set(['nirholas', 'nichxbt']);
const PASSWORD = "What's the password?";
let unlockedSession = false;

const form = document.getElementById('search');
const input = document.getElementById('q');
const result = document.getElementById('result');
const button = form.querySelector('button');

// Tab switching
let activePrefix = '';
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    activePrefix = tab.dataset.prefix;
    input.placeholder = tab.dataset.placeholder;
    // Strip any existing prefix from the current input value
    const bare = input.value.replace(/^[a-z]+:/i, '');
    input.value = activePrefix && activePrefix !== 'wallet' && activePrefix !== 'mint' ? bare : bare;
    input.focus();
  });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = input.value.trim();
  if (!raw) return;

  const hasPrefix = /^[a-z]+:/i.test(raw);
  const shouldPrefix = activePrefix && activePrefix !== 'wallet' && activePrefix !== 'mint';
  let q = (shouldPrefix && !hasPrefix) ? activePrefix + raw : raw;

  // For X tab with a non-numeric username, resolve to numeric ID first
  if (q.startsWith('x:') && !/^x:\d+$/.test(q)) {
    const xUsername = q.slice(2).trim();
    button.disabled = true;
    result.hidden = false;
    result.innerHTML = '<div class="loading">resolving @' + escapeHtml(xUsername) + '</div>';
    try {
      const r = await fetch(`/api/xid?username=${encodeURIComponent(xUsername)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'not found');
      q = `x:${d.id}`;
      window._xUsernameHint = { id: d.id, username: xUsername };
    } catch (err) {
      result.innerHTML = `<div class="err">error: couldn't resolve @${escapeHtml(xUsername)} — ${escapeHtml(err.message)}</div>`;
      button.disabled = false;
      return;
    }
    button.disabled = false;
  }

  lookup(q);
});

// Pick up ?q= from URL on load.
const initialQ = new URL(location.href).searchParams.get('q');
if (initialQ) {
  input.value = initialQ;
  lookup(initialQ);
}

function isGated(q, data) {
  if (unlockedSession) return false;
  const lq = q.toLowerCase().replace(/^(github:|gh:|x:|pump:)/, '');
  if (GATED_NAMES.has(lq)) return true;
  if (data?.resolved?.wallet && GATED_WALLETS.has(data.resolved.wallet)) return true;
  return false;
}

function promptPassword(onSuccess) {
  result.hidden = false;
  result.innerHTML = `
    <div class="card" id="pw-gate">
      <p class="section-h">restricted lookup</p>
      <p style="font-size:14px;color:var(--muted);margin:0 0 16px">This creator has password-protected their stats.</p>
      <form id="pw-form" style="display:flex;gap:8px">
        <input id="pw-input" type="password" placeholder="enter password" autocomplete="off"
          style="flex:1;background:var(--panel-2);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:10px 12px;font:inherit;font-size:14px;outline:none" />
        <button type="submit" style="background:var(--accent);color:#06170d;border:0;border-radius:8px;padding:0 16px;font:inherit;font-size:14px;font-weight:600;cursor:pointer">unlock</button>
      </form>
      <p id="pw-err" style="font-size:12px;color:var(--danger);margin:8px 0 0;min-height:16px"></p>
    </div>
  `;
  const pwForm = document.getElementById('pw-form');
  const pwInput = document.getElementById('pw-input');
  const pwErr = document.getElementById('pw-err');
  pwInput.focus();
  pwForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (pwInput.value === PASSWORD) {
      unlockedSession = true;
      onSuccess();
    } else {
      pwErr.textContent = 'wrong password.';
      pwInput.value = '';
      pwInput.focus();
    }
  });
}

async function lookup(q) {
  result.hidden = false;
  result.innerHTML = '<div class="loading">looking up</div>';
  button.disabled = true;
  history.replaceState(null, '', `?q=${encodeURIComponent(q)}`);

  try {
    // Quick gated-name check before fetching
    if (!unlockedSession && isGated(q, null)) {
      button.disabled = false;
      promptPassword(() => lookup(q));
      return;
    }

    const res = await fetch(`/api/fees?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!res.ok) {
      let msg = data?.error || `request failed (${res.status})`;
      // Replace numeric X ID in error with original username
      const hint = window._xUsernameHint;
      if (hint) msg = msg.replace(hint.id, '@' + hint.username).replace(/"(\d+)"/, `"@${hint.username}"`);
      throw new Error(msg);
    }

    // Gated wallet check after resolving
    if (isGated(q, data)) {
      button.disabled = false;
      promptPassword(() => lookup(q));
      return;
    }

    render(data);
  } catch (err) {
    result.innerHTML = `<div class="err">error: ${escapeHtml(err.message || String(err))}</div>`;
  } finally {
    button.disabled = false;
  }
}

// Earnings breakdown for the current lookup, once /api/earnings lands.
let earningsData = null;
let coinSort = 'earned';

function render(data) {
  const { resolved, totals, coins, coinsTruncated } = data;
  const isMint = resolved.type === 'mint';
  earningsData = null;

  // Header card varies by input type.
  let head;
  if (isMint && resolved.coinMeta) {
    const c = resolved.coinMeta;
    head = `
      <div class="card-head">
        ${c.image ? `<img src="${escapeAttr(c.image)}" alt="" onerror="this.style.display='none'">` : ''}
        <div>
          <p class="title">${escapeHtml(c.name || 'unknown')} <span style="color:var(--muted);font-weight:400">${escapeHtml(c.symbol || '')}</span></p>
          <p class="sub">creator: <a href="?q=${encodeURIComponent(resolved.wallet)}">${escapeHtml(short(resolved.wallet))}</a> · <a href="https://pump.fun/coin/${encodeURIComponent(resolved.mint)}" target="_blank" rel="noopener">view on pump.fun</a></p>
        </div>
      </div>`;
  } else {
    const p = resolved.profile;
    const label = p?.username ? `@${p.username}` : short(resolved.wallet);
    head = `
      <div class="card-head">
        ${p?.profileImage ? `<img src="${escapeAttr(p.profileImage)}" alt="" onerror="this.style.display='none'">` : ''}
        <div>
          <p class="title">${escapeHtml(label)}</p>
          <p class="sub">${escapeHtml(resolved.wallet)} · <a href="https://pump.fun/profile/${encodeURIComponent(resolved.wallet)}" target="_blank" rel="noopener">view on pump.fun</a></p>
        </div>
      </div>`;
  }

  // For mint lookups: resolved.onChainRecipients tells us the actual fee recipient vault(s).
  const recipients = resolved.onChainRecipients;
  const recipientLabel = recipients?.length === 1
    ? `<span class="scope-tag">${recipients[0].sharePct}% vault</span>`
    : '';
  const scope = isMint && recipients
    ? recipientLabel
    : isMint ? `<span class="scope-tag">creator</span>` : '';

  // Recipient info banner for mint lookups with vault resolution.
  let recipientBanner = '';
  if (isMint && recipients?.length) {
    recipientBanner = `
      <div class="recipient-row">
        <span class="recipient-label">fee recipient</span>
        <a href="?q=${encodeURIComponent(recipients[0].wallet)}" class="recipient-addr">${escapeHtml(short(recipients[0].wallet))}</a>
        <span class="recipient-pct">${recipients[0].sharePct}%</span>
        <a href="https://solscan.io/account/${encodeURIComponent(recipients[0].wallet)}" target="_blank" rel="noopener" class="recipient-ext">solscan</a>
      </div>
    `;
  }

  // A mint lookup asks "what did THIS coin earn?" — so lead with that, and keep
  // the creator's lifetime figure as clearly-labelled context underneath. (The
  // page used to answer that question with the creator's all-coin total.)
  const coinEarnedBlock = isMint
    ? `
      <p class="section-h">this coin paid ${scope}</p>
      <div id="coin-earned">${skeletonTotals()}</div>
      <p class="section-h" style="margin-top:22px">the creator's lifetime earnings, all coins</p>
      ${renderTotals(totals)}
      ${coinCountNote(totals)}
    `
    : `
      <p class="section-h">creator-fee earnings ${scope}</p>
      ${renderTotals(totals)}
      ${coinCountNote(totals)}
    `;

  let html = `
    <div class="card">
      ${head}
      ${recipientBanner}
      ${coinEarnedBlock}
    </div>
    <div id="insights"></div>
  `;

  if (coins && coins.length) {
    html += `
      <div class="card">
        <div class="list-head">
          <p class="section-h" style="margin:0">coins sharing fees <span class="count">${coins.length}</span></p>
          <label class="sort">
            <span class="sr-only">sort coins by</span>
            <select id="coin-sort">
              <option value="earned">most earned</option>
              <option value="recent">last paid</option>
              <option value="mcap">market cap</option>
              <option value="share">share %</option>
            </select>
          </label>
        </div>
        ${coinsTruncated ? `<p class="note">showing the first ${coins.length} coins — this creator has more than we can page through.</p>` : ''}
        <div class="coin-list" id="coin-list">
          ${coins.map((c) => coinRow(c, null)).join('')}
        </div>
      </div>
    `;
  } else if (!isMint) {
    html += `<div class="empty">no coins are currently sharing fees with this account.</div>`;
  }

  result.innerHTML = html;

  const sortEl = document.getElementById('coin-sort');
  if (sortEl) {
    // The sort preference survives a new lookup, so the control has to show the
    // sort that is actually in effect — not silently snap back to its default.
    sortEl.value = coinSort;
    sortEl.addEventListener('change', (e) => {
      coinSort = e.target.value;
      redrawCoinList();
    });
  }

  if (isMint && resolved.mint) loadTimeline(resolved.mint);

  // The breakdown walks a timeline per coin, so it lands a beat after the
  // summary. Everything above stays usable while it does.
  loadEarnings(data.query);
}

function coinCountNote(totals) {
  if (!(totals?.mintCount > 0)) return '';
  return `<p class="across">across ${totals.mintCount} coin${totals.mintCount === 1 ? '' : 's'}</p>`;
}

async function loadEarnings(q) {
  const insights = document.getElementById('insights');
  if (insights) insights.innerHTML = `<div class="card insights-loading">crunching per-coin earnings</div>`;

  try {
    const res = await fetch(`/api/earnings?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);

    earningsData = data;
    if (insights) insights.innerHTML = renderInsights(data);
    redrawCoinList();

    const slot = document.getElementById('coin-earned');
    if (slot) slot.innerHTML = renderCoinEarned(data);
  } catch (err) {
    // The summary above is still correct and useful — degrade, don't blank it.
    if (insights) {
      insights.innerHTML = `<div class="card insights-err">per-coin breakdown unavailable: ${escapeHtml(err.message || String(err))}</div>`;
    }
    const slot = document.getElementById('coin-earned');
    if (slot) slot.innerHTML = `<p class="empty" style="border:0;padding:0">per-coin earnings unavailable</p>`;
  }
}

// A coin's own payout record, for mint lookups.
function renderCoinEarned(data) {
  const c = data.coinEarnings;
  if (!c) {
    return `<p class="empty" style="border:0;padding:0">this coin has never paid this wallet. it shares fees, but no distribution has been made.</p>`;
  }
  const pct = c.shareOfEarningsPct;
  return `
    <div class="totals">
      <div class="stat stat--hero">
        <p class="label">Paid to this wallet</p>
        <p class="sol">${formatSol(c.earned.sol)} SOL</p>
        <p class="usd">$${formatUsd(c.earned.usd)}</p>
      </div>
      <div class="stat">
        <p class="label">Distributions</p>
        <p class="sol">${c.distributions}</p>
        <p class="usd">${c.lastEarnedAt ? `last ${fmtAgo(c.lastEarnedAt)}` : 'never paid'}</p>
      </div>
      <div class="stat">
        <p class="label">Of creator's total</p>
        <p class="sol">${pct < 0.1 && pct > 0 ? '<0.1' : pct.toFixed(1)}%</p>
        <p class="usd">${c.earnedLast30d.sol > 0 ? `${formatSol(c.earnedLast30d.sol)} SOL in 30d` : 'nothing in 30d'}</p>
      </div>
    </div>
  `;
}

function renderInsights(data) {
  const i = data.insights;
  if (!i || !i.coinCount) return '';

  const top = i.topCoin;
  const cards = [
    {
      label: 'earning coins',
      value: `${i.earningCoinCount} <span class="of">of ${i.coinCount}</span>`,
      sub: i.silentCoinCount ? `${i.silentCoinCount} never paid out` : 'every coin has paid',
    },
    {
      label: 'top coin',
      value: `${i.topCoinSharePct.toFixed(1)}%`,
      sub: top ? `${escapeHtml(top.name || short(top.mint))} · ${formatSol(top.earned.sol)} SOL` : '',
    },
    {
      label: 'earned last 30d',
      value: `${formatSol(i.last30d.sol)} <span class="of">SOL</span>`,
      sub: `$${formatUsd(i.last30d.usd, 0)}`,
    },
    {
      label: 'concentration',
      value: `${i.coinsFor90Pct} <span class="of">coin${i.coinsFor90Pct === 1 ? '' : 's'}</span>`,
      sub: 'make up 90% of earnings',
    },
  ];

  return `
    <div class="card">
      <p class="section-h">breakdown</p>
      <div class="insights">
        ${cards.map((c) => `
          <div class="insight">
            <p class="label">${c.label}</p>
            <p class="value">${c.value}</p>
            <p class="sub">${c.sub}</p>
          </div>
        `).join('')}
      </div>
      <p class="note">
        per-coin figures are amounts actually distributed to this wallet, summed from each coin's
        on-chain distribution events. pump.fun only reports unclaimed fees at the wallet level
        (${formatSol(i.unclaimed?.sol ?? 0)} SOL still unclaimed), so it isn't attributed per coin.
      </p>
    </div>
  `;
}

function sortedCoins() {
  const coins = earningsData?.coins;
  if (!coins) return null;
  const by = {
    earned: (a, b) => b.earned.sol - a.earned.sol,
    recent: (a, b) => String(b.lastEarnedAt || '').localeCompare(String(a.lastEarnedAt || '')),
    mcap: (a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0),
    share: (a, b) => (b.sharePct ?? 0) - (a.sharePct ?? 0),
  };
  return [...coins].sort(by[coinSort] || by.earned);
}

function redrawCoinList() {
  const list = document.getElementById('coin-list');
  const coins = sortedCoins();
  if (!list || !coins) return;
  const max = Math.max(...coins.map((c) => c.earned.sol), 0);
  list.innerHTML = coins.map((c) => coinRow(c, max)).join('');
}

async function loadTimeline(mint, cursor = null) {
  const containerId = 'timeline-section';
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    result.appendChild(container);
  }
  if (!cursor) container.innerHTML = '<div class="loading" style="padding:16px 0">loading timeline</div>';

  try {
    const url = `/api/timeline?q=${encodeURIComponent(mint)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const { items, pagination } = data;
    const distributions = (items || []).filter(e => e.eventType === 'distribution' && Number(e.totalDistributed) > 0);
    const others = (items || []).filter(e => e.eventType !== 'distribution');

    if (!cursor) {
      // Build full timeline section
      const allEvents = [...others, ...distributions].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      if (!allEvents.length && !pagination?.hasMore) {
        container.innerHTML = '';
        return;
      }
      container.innerHTML = `
        <div class="card" id="timeline-card">
          <p class="section-h">distribution timeline</p>
          <div class="timeline" id="timeline-events">
            ${renderTimelineEvents(distributions, others)}
          </div>
          ${pagination?.hasMore ? `<button class="load-more" data-mint="${escapeAttr(mint)}" data-cursor="${escapeAttr(pagination.nextCursor)}">load more</button>` : ''}
        </div>
      `;
      document.querySelector('.load-more')?.addEventListener('click', function () {
        this.disabled = true;
        this.textContent = 'loading...';
        loadTimeline(mint, this.dataset.cursor);
      });
    } else {
      // Append more events
      const eventsEl = document.getElementById('timeline-events');
      if (eventsEl) eventsEl.insertAdjacentHTML('beforeend', renderTimelineEvents(distributions, others));
      const btn = document.querySelector('.load-more');
      if (btn) {
        if (pagination?.hasMore) {
          btn.dataset.cursor = pagination.nextCursor;
          btn.disabled = false;
          btn.textContent = 'load more';
        } else {
          btn.remove();
        }
      }
    }
  } catch (err) {
    if (!cursor) container.innerHTML = '';
  }
}

function renderTimelineEvents(distributions, configEvents) {
  let html = '';

  // Config-change events (create/update/lock)
  for (const e of configEvents) {
    const label = { coin_created: 'coin created', create: 'fee sharing created', update: 'fee sharing updated', lock: 'fee sharing locked' }[e.eventType] || e.eventType;
    const shares = e.shareholders?.map(s => `${short(s.address)} ${s.shareBps / 100}%`).join(', ') || '';
    html += `
      <div class="tl-event tl-config">
        <div class="tl-dot tl-dot--config"></div>
        <div class="tl-body">
          <span class="tl-label">${escapeHtml(label)}</span>
          <span class="tl-meta">${fmtDate(e.timestamp)}</span>
          ${shares ? `<span class="tl-shares">${escapeHtml(shares)}</span>` : ''}
          ${e.tx ? `<a class="tl-tx" href="https://solscan.io/tx/${encodeURIComponent(e.tx)}" target="_blank" rel="noopener">tx</a>` : ''}
        </div>
      </div>
    `;
  }

  // Distribution events
  for (const e of distributions) {
    const lamports = Number(e.totalDistributed);
    const sol = (lamports / 1e9).toFixed(4);
    html += `
      <div class="tl-event tl-distrib">
        <div class="tl-dot tl-dot--distrib"></div>
        <div class="tl-body">
          <span class="tl-label">distribution</span>
          <span class="tl-meta">${fmtDate(e.timestamp)}</span>
          <span class="tl-amount">${sol} SOL</span>
          ${e.tx ? `<a class="tl-tx" href="https://solscan.io/tx/${encodeURIComponent(e.tx)}" target="_blank" rel="noopener">tx</a>` : ''}
        </div>
      </div>
    `;
  }
  return html;
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderTotals(t) {
  if (!t) return `<p class="empty" style="border:0;padding:0">no data</p>`;
  return `
    <div class="totals">
      ${stat('Total earned', t.shareholderTotalEarned)}
      ${stat('Claimed', t.shareholderClaimed)}
      ${stat('Unclaimed', t.shareholderUnclaimed)}
    </div>
  `;
}

function stat(label, v) {
  const sol = v?.sol ?? '0';
  const usd = v?.usd ?? '0';
  return `
    <div class="stat">
      <p class="label">${label}</p>
      <p class="sol">${formatSol(sol)} SOL</p>
      <p class="usd">$${formatUsd(usd)}</p>
    </div>
  `;
}

// `max` is the top earner's SOL, used to scale the bar. Pass null before the
// earnings breakdown has landed — the row then shows a placeholder instead.
function coinRow(c, max) {
  const href = `?q=${encodeURIComponent(c.mint)}`;
  const sym = c.symbol ? c.symbol.toUpperCase() : '';
  const share = typeof c.sharePct === 'number' ? `${c.sharePct}% share` : '';
  const mc = typeof c.marketCapUsd === 'number' && c.marketCapUsd > 0
    ? `mcap $${formatUsd(c.marketCapUsd, 0)}`
    : '';

  const img = c.image
    ? `<img src="${escapeAttr(c.image)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : '<div class="coin-noimg"></div>';

  let right;
  if (!c.earned) {
    right = `<div class="right"><span class="earn-skel"></span></div>`;
  } else if (c.earned.sol > 0) {
    const pctOfMax = max > 0 ? (c.earned.sol / max) * 100 : 0;
    right = `
      <div class="right">
        <p class="earn">${formatSol(c.earned.sol)} <span class="unit">SOL</span></p>
        <p class="earn-usd">$${formatUsd(c.earned.usd, 0)}</p>
        <div class="bar" role="img" aria-label="${c.shareOfEarningsPct.toFixed(1)}% of all earnings">
          <span style="width:${Math.max(pctOfMax, 1.5)}%"></span>
        </div>
        <p class="earn-meta">${c.distributions} payout${c.distributions === 1 ? '' : 's'} · ${c.lastEarnedAt ? fmtAgo(c.lastEarnedAt) : ''}</p>
      </div>
    `;
  } else {
    right = `
      <div class="right">
        <p class="earn earn--zero">never paid</p>
        <p class="earn-meta">${escapeHtml(share)}</p>
      </div>
    `;
  }

  return `
    <a class="coin-row" href="${href}">
      ${img}
      <div class="coin-id">
        <p class="name">${escapeHtml(c.name || short(c.mint))} <span class="sym">${escapeHtml(sym)}</span></p>
        <p class="meta">${escapeHtml(short(c.mint))}${share ? ` · ${escapeHtml(share)}` : ''}${mc ? ` · ${mc}` : ''}</p>
      </div>
      ${right}
    </a>
  `;
}

function skeletonTotals() {
  return `
    <div class="totals">
      ${['', '', ''].map(() => `
        <div class="stat">
          <p class="label"><span class="skel skel--sm"></span></p>
          <p class="sol"><span class="skel"></span></p>
        </div>
      `).join('')}
    </div>
  `;
}

// "3d ago", "5mo ago" — a payout's recency is the signal, not its wall-clock date.
function fmtAgo(ts) {
  const then = new Date(ts).getTime();
  if (!Number.isFinite(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function formatSol(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return '0';
  if (n === 0) return '0';
  if (n < 0.001) return n.toExponential(2);
  if (n < 1) return n.toFixed(4);
  if (n < 1000) return n.toFixed(3);
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function formatUsd(s, maxFrac = 2) {
  const n = Number(s);
  if (!Number.isFinite(n)) return '0';
  if (n === 0) return '0';
  if (n < 0.01) return n.toFixed(4);
  return n.toLocaleString('en-US', { minimumFractionDigits: maxFrac > 0 ? 2 : 0, maximumFractionDigits: maxFrac });
}

function short(addr) {
  if (!addr || addr.length < 12) return addr || '';
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function escapeAttr(s) {
  return escapeHtml(s);
}
