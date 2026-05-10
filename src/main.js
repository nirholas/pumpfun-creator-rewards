const form = document.getElementById('search');
const input = document.getElementById('q');
const result = document.getElementById('result');
const button = form.querySelector('button');

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  lookup(q);
});

document.querySelectorAll('.examples a[data-q]').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    input.value = a.dataset.q;
    lookup(a.dataset.q);
  });
});

// Pick up ?q= from URL on load.
const initialQ = new URL(location.href).searchParams.get('q');
if (initialQ) {
  input.value = initialQ;
  lookup(initialQ);
}

async function lookup(q) {
  result.hidden = false;
  result.innerHTML = '<div class="loading">looking up</div>';
  button.disabled = true;
  history.replaceState(null, '', `?q=${encodeURIComponent(q)}`);

  try {
    const res = await fetch(`/api/fees?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `request failed (${res.status})`);
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
