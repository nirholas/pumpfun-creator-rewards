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

const GATED_WALLETS = new Set([
  '71zpR8ZGSo4tEgWf8AmyuPcx3fzYjqwTDSAuhwQxBmSd', // nirholas github vault
]);
const GATED_NAMES = new Set(['nirholas', 'nichxbt']);
const PASSWORD = "What's the password?";
let unlockedSession = false;

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

function render(data) {
  const { resolved, totals, totalsForCoin, coins } = data;
  const isMint = resolved.type === 'mint';

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

  let html = `
    <div class="card">
      ${head}
      ${recipientBanner}
      <p class="section-h">creator-fee earnings ${scope}</p>
      ${renderTotals(totals)}
    </div>
  `;

  // Coin count note
  if (totals?.mintCount > 0) {
    html = html.replace('</div>\n  ', `<p style="margin:12px 0 0;font-size:12px;color:var(--muted)">across ${totals.mintCount} coin${totals.mintCount === 1 ? '' : 's'}</p>\n</div>\n  `);
  }

  // Coin list (always show if available).
  if (coins && coins.length) {
    html += `
      <div class="card">
        <p class="section-h">coins earning fees</p>
        <div class="coin-list">
          ${coins.map(coinRow).join('')}
        </div>
      </div>
    `;
  } else if (!isMint) {
    html += `<div class="empty">no coins are currently sharing fees with this account.</div>`;
  }

  result.innerHTML = html;
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

function coinRow(c) {
  const href = `?q=${encodeURIComponent(c.mint)}`;
  const sym = c.symbol ? c.symbol.toUpperCase() : '';
  const mc = typeof c.marketCapUsd === 'number' && c.marketCapUsd > 0
    ? `mcap $${formatUsd(c.marketCapUsd, 0)}`
    : '';
  const share = typeof c.sharePct === 'number' ? `${c.sharePct}% share` : '';
  return `
    <a class="coin-row" href="${href}">
      ${c.image ? `<img src="${escapeAttr(c.image)}" alt="" onerror="this.style.display='none'">` : '<div style="width:32px;height:32px;border-radius:6px;background:var(--bg)"></div>'}
      <div>
        <p class="name">${escapeHtml(c.name || short(c.mint))} <span style="color:var(--muted)">${escapeHtml(sym)}</span></p>
        <p class="meta">${escapeHtml(short(c.mint))}</p>
      </div>
      <div class="right">
        ${share ? `<strong>${share}</strong><br>` : ''}
        ${mc}
      </div>
    </a>
  `;
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
