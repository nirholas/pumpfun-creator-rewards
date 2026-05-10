'use strict';

module.exports = async function handler(req, res) {
  const { username } = req.query;
  if (!username || typeof username !== 'string') {
    res.status(400).json({ error: 'missing username' });
    return;
  }

  const id = await resolveXId(username.replace(/^@/, ''));
  if (!id) {
    res.status(404).json({ error: `X user @${username} not found` });
    return;
  }

  res.setHeader('cache-control', 'public, s-maxage=3600');
  res.status(200).json({ id, username });
};

async function resolveXId(username) {
  // Try multiple sources in order
  const attempts = [
    () => scrapeXPage(username),
    () => scrapeNitter(username),
  ];
  for (const attempt of attempts) {
    try {
      const id = await attempt();
      if (id) return id;
    } catch {}
  }
  return null;
}

async function scrapeXPage(username) {
  const res = await fetch(`https://x.com/${encodeURIComponent(username)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
  });
  if (!res.ok) return null;
  const html = await res.text();
  const m = html.match(/"id_str":"(\d+)"/);
  return m?.[1] || null;
}

async function scrapeNitter(username) {
  // Nitter is an open-source Twitter frontend that embeds user IDs
  const instances = [
    'https://nitter.privacyredirect.com',
    'https://nitter.poast.org',
    'https://nitter.tiekoetter.com',
  ];
  for (const base of instances) {
    try {
      const res = await fetch(`${base}/${encodeURIComponent(username)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      // Nitter embeds the user ID in RSS/profile links: /i/user/12345
      const m = html.match(/\/i\/user\/(\d+)/);
      if (m) return m[1];
    } catch {}
  }
  return null;
}
