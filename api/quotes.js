// api/quotes.js — Vercel serverless function
// Public.com two-step auth for live prices.
// Yahoo Finance for previous close (Public returns null during market hours).
// Browser calls GET /api/quotes?symbols=AAPL,MSFT

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

// Fetch previous close for a single ticker from Yahoo Finance.
// Uses the chart endpoint which is CORS-accessible from servers.
async function fetchPrevClose(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=5d&interval=1d`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (!closes || closes.length < 2) return null;
    // Second-to-last close = yesterday's close
    const validCloses = closes.filter((c) => c != null);
    return validCloses.length >= 2 ? validCloses[validCloses.length - 2] : null;
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

  const tickerList = symbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

  try {
    // Step 1: Get access token
    const token = await getAccessToken(secret);

    // Step 2: Fetch live prices from Public (all tickers, one request)
    const publicResp = await fetch(
      `${BASE}/userapigateway/marketdata/${accountId}/quotes`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instruments: tickerList.map((s) => ({ symbol: s, type: 'EQUITY' })),
        }),
      }
    );

    if (!publicResp.ok) {
      if (publicResp.status === 401) _cachedToken = null;
      const text = await publicResp.text();
      return res.status(publicResp.status).json({ error: `Public API ${publicResp.status}`, detail: text.slice(0, 200) });
    }

    const publicData = await publicResp.json();
    const quotes = publicData?.quotes || [];

    // Step 3: For tickers where Public returned no changePct, fetch prev close from Yahoo.
    // Only fetch what we need — skip tickers with working changePct.
    const needPrevClose = [];
    for (const q of quotes) {
      if (q.outcome !== 'SUCCESS') continue;
      const hasPct = q.oneDayChange?.percentChange != null;
      const hasPrev = q.previousClose != null;
      if (!hasPct && !hasPrev) needPrevClose.push(q.instrument?.symbol);
    }

    // Fetch prev closes in parallel (capped at 20 concurrent to avoid hammering Yahoo)
    const prevCloseMap = {};
    const chunks = [];
    for (let i = 0; i < needPrevClose.length; i += 20) {
      chunks.push(needPrevClose.slice(i, i + 20));
    }
    for (const chunk of chunks) {
      const results = await Promise.all(chunk.map(async (t) => [t, await fetchPrevClose(t)]));
      for (const [ticker, close] of results) {
        if (close != null) prevCloseMap[ticker] = close;
      }
    }

    // Step 4: Build normalized response
    const result = {};
    for (const q of quotes) {
      if (q.outcome !== 'SUCCESS') continue;
      const symbol = q.instrument?.symbol;
      if (!symbol) continue;

      const last = parseFloat(q.last);
      if (!Number.isFinite(last)) continue;

      // Compute changePct: prefer Public's own value, fall back to Yahoo prev close
      let changePct = null;
      if (q.oneDayChange?.percentChange != null) {
        changePct = parseFloat(q.oneDayChange.percentChange);
      } else {
        const prev = q.previousClose ? parseFloat(q.previousClose) : prevCloseMap[symbol];
        if (prev && prev > 0) {
          changePct = ((last - prev) / prev) * 100;
        }
      }

      result[symbol] = {
        price:     last,
        changePct: changePct != null ? parseFloat(changePct.toFixed(2)) : null,
        bid:       parseFloat(q.bid)  || null,
        ask:       parseFloat(q.ask)  || null,
        volume:    q.volume           || null,
        timestamp: q.lastTimestamp    || null,
      };
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');
    return res.status(200).json(result);

  } catch (e) {
    return res.status(502).json({ error: e.message || 'Failed' });
  }
}
