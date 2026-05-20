// api/quotes.js — Vercel serverless function
// Returns mid = (bid + ask) / 2 as the price.
// If bid/ask unavailable, falls back to last trade price.
// No change % calculation — just the price.

const BASE = 'https://api.public.com';

let _cachedToken = null;
let _tokenExpiresAt = 0;

async function getAccessToken(secret) {
  if (_cachedToken && Date.now() < _tokenExpiresAt) return _cachedToken;
  const resp = await fetch(`${BASE}/userapiauthservice/personal/access-tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ validityInMinutes: 60, secret }),
  });
  if (!resp.ok) throw new Error(`Auth failed HTTP ${resp.status}`);
  const data = await resp.json();
  _cachedToken = data.accessToken;
  _tokenExpiresAt = Date.now() + 55 * 60 * 1000;
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

  const tickers = [...new Set(
    symbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  )];

  try {
    const token = await getAccessToken(secret);

    const pubResp = await fetch(
      `${BASE}/userapigateway/marketdata/${accountId}/quotes`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruments: tickers.map((s) => ({ symbol: s, type: 'EQUITY' })),
        }),
      }
    );

    if (!pubResp.ok) {
      if (pubResp.status === 401) _cachedToken = null;
      const txt = await pubResp.text();
      return res.status(pubResp.status).json({ error: `Public ${pubResp.status}`, detail: txt.slice(0, 200) });
    }

    const pubData = await pubResp.json();
    const quotes  = pubData?.quotes ?? [];

    const result = {};
    for (const q of quotes) {
      if (q.outcome !== 'SUCCESS') continue;
      const sym = q.instrument?.symbol?.toUpperCase();
      if (!sym) continue;

      const bid  = parseFloat(q.bid)  || null;
      const ask  = parseFloat(q.ask)  || null;
      const last = parseFloat(q.last) || null;

      // Mid = (bid + ask) / 2 — primary price per quote.py logic
      // Fall back to last if bid/ask unavailable
      const mid   = (bid && ask) ? parseFloat(((bid + ask) / 2).toFixed(2)) : null;
      const price = mid ?? last;

      if (!price) continue;

      result[sym] = {
        price,   // mid if available, last otherwise
        mid,
        last,
        bid,
        ask,
        volume:    q.volume ?? null,
        timestamp: q.lastTimestamp ?? null,
      };
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');
    return res.status(200).json(result);

  } catch (e) {
    return res.status(502).json({ error: e.message ?? 'Failed' });
  }
}
