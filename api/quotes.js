// api/quotes.js — Vercel serverless function
// Price = (bid+ask)/2 mid from Public API
// Change % = (mid - prevClose) / prevClose * 100
// prevClose from Yahoo Finance — mirrors yfinance logic exactly

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

function isNYSEOpen(now = new Date()) {
  const year = now.getUTCFullYear();
  const edtStart = new Date(Date.UTC(year, 2, 1));
  let suns = 0;
  while (suns < 2) {
    if (edtStart.getUTCDay() === 0) suns++;
    if (suns < 2) edtStart.setUTCDate(edtStart.getUTCDate() + 1);
  }
  edtStart.setUTCHours(7, 0, 0, 0);
  const estStart = new Date(Date.UTC(year, 10, 1));
  while (estStart.getUTCDay() !== 0) estStart.setUTCDate(estStart.getUTCDate() + 1);
  estStart.setUTCHours(6, 0, 0, 0);
  const etOffset = (now >= edtStart && now < estStart) ? -4 : -5;
  const etHour   = now.getUTCHours() + etOffset + now.getUTCMinutes() / 60;
  const etDay    = (now.getUTCDay() + (now.getUTCHours() + etOffset < 0 ? -1 : 0) + 7) % 7;
  if (etDay === 0 || etDay === 6) return false;
  return etHour >= 9.5 && etHour < 16;
}

// Mirrors: yf.download(ticker, period='5d', interval='1d')['Close'].iloc[-2]
// Market open: today partial bar exists → prev close = second-to-last
// Extended: today bar not started → prev close = last
async function fetchPrevClose(ticker, marketOpen) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d&includePrePost=false`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } });
    if (!resp.ok) return null;
    const json = await resp.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter((c) => c != null && Number.isFinite(c));
    if (!valid.length) return null;
    return marketOpen
      ? (valid.length >= 2 ? valid[valid.length - 2] : valid[valid.length - 1])
      : valid[valid.length - 1];
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols param required' });

  const secret    = process.env.PUBLIC_API_SECRET;
  const accountId = process.env.PUBLIC_ACCOUNT_ID;
  if (!secret || !accountId) {
    return res.status(500).json({ error: 'PUBLIC_API_SECRET or PUBLIC_ACCOUNT_ID not configured' });
  }

  const tickers    = [...new Set(symbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const marketOpen = isNYSEOpen();

  try {
    const token = await getAccessToken(secret);

    const pubResp = await fetch(
      `${BASE}/userapigateway/marketdata/${accountId}/quotes`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruments: tickers.map((s) => ({ symbol: s, type: 'EQUITY' })) }),
      }
    );
    if (!pubResp.ok) {
      if (pubResp.status === 401) _cachedToken = null;
      const txt = await pubResp.text();
      return res.status(pubResp.status).json({ error: `Public ${pubResp.status}`, detail: txt.slice(0, 200) });
    }
    const quotes = (await pubResp.json())?.quotes ?? [];

    // Fetch all prev closes in parallel — same as yfinance batch
    const prevCloses = Object.fromEntries(
      await Promise.all(tickers.map(async (t) => [t, await fetchPrevClose(t, marketOpen)]))
    );

    const result = {};
    for (const q of quotes) {
      if (q.outcome !== 'SUCCESS') continue;
      const sym = q.instrument?.symbol?.toUpperCase();
      if (!sym) continue;

      const bid  = parseFloat(q.bid)  || null;
      const ask  = parseFloat(q.ask)  || null;
      const last = parseFloat(q.last) || null;
      const mid  = (bid && ask) ? parseFloat(((bid + ask) / 2).toFixed(2)) : null;
      const price = mid ?? last;
      if (!price) continue;

      const prevClose = prevCloses[sym] ?? null;
      const changePct = (prevClose && prevClose > 0)
        ? parseFloat(((price - prevClose) / prevClose * 100).toFixed(2))
        : null;

      result[sym] = { price, changePct, prevClose, mid, last, bid, ask,
        volume: q.volume ?? null, timestamp: q.lastTimestamp ?? null };
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    return res.status(200).json(result);

  } catch (e) {
    return res.status(502).json({ error: e.message ?? 'Failed' });
  }
}
