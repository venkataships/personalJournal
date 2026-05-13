// api/quotes.js — Vercel serverless function
// Public.com two-step auth: secret → access token → quotes
// SECRET stays server-side. Browser only calls /api/quotes.

const BASE = 'https://api.public.com';

// Module-level token cache. Survives across warm lambda invocations.
let _cachedToken = null;
let _tokenExpiresAt = 0;

async function getAccessToken(secret) {
  if (_cachedToken && Date.now() < _tokenExpiresAt) {
    return _cachedToken;
  }
  const resp = await fetch(`${BASE}/userapiauthservice/personal/access-tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ validityInMinutes: 60, secret }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Auth failed HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  _cachedToken = data.accessToken;
  _tokenExpiresAt = Date.now() + 55 * 60 * 1000; // 55 min buffer
  return _cachedToken;
}

export default async function handler(req, res) {
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols param required' });

  const secret    = process.env.PUBLIC_API_SECRET;
  const accountId = process.env.PUBLIC_ACCOUNT_ID;
  if (!secret || !accountId) {
    return res.status(500).json({ error: 'PUBLIC_API_SECRET or PUBLIC_ACCOUNT_ID not configured' });
  }

  try {
    const token = await getAccessToken(secret);

    const instruments = symbols.split(',').map((s) => ({
      symbol: s.trim().toUpperCase(),
      type: 'EQUITY',
    }));

    const upstream = await fetch(
      `${BASE}/userapigateway/marketdata/${accountId}/quotes`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ instruments }),
      }
    );

    if (!upstream.ok) {
      // If 401, token may have expired mid-flight — clear cache and surface error
      if (upstream.status === 401) _cachedToken = null;
      const text = await upstream.text();
      return res.status(upstream.status).json({
        error: `Public API HTTP ${upstream.status}`,
        detail: text.slice(0, 200),
      });
    }

    const data = await upstream.json();
    console.log('SAMPLE QUOTE:', JSON.stringify(data?.quotes?.[0]));
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Upstream fetch failed' });
  }
}
