// api/quotes.js — Vercel serverless function
// Public.com two-step auth for live prices.
// Pre/post-market: uses (bid+ask)/2 midpoint vs Yahoo prev close.
// Market hours: uses last trade price vs Yahoo prev close fallback.

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

async function fetchPrevClose(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=5d&interval=1d`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) return null;
    const json = await resp.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (!closes) return null;
    const valid = closes.filter((c) => c != null);
    return valid.length >= 2 ? valid[valid.length - 2] : valid[valid.length - 1] ?? null;
  } catch {
    return null;
  }
}

// Detect if a quote is stale (pre/post-market).
// lastTimestamp is "2026-05-16T13:45:22Z" — compare to NYSE market hours in ET.
function isMarketHours(lastTimestamp) {
  if (!lastTimestamp) return false;
  const now = new Date();
  // NYSE: 09:30–16:00 ET. Use UTC offsets: ET = UTC-4 (EDT) or UTC-5 (EST)
  // Simple check: if last trade was within the last 15 minutes, treat as live.
  const lastTrade = new Date(lastTimestamp);
  const msSinceTrade = now - lastTrade;
  return msSinceTrade < 15 * 60 * 1000; // within 15 min = market hours active
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
    const token = await getAccessToken(secret);

    const publicResp = await fetch(
      `${BASE}/userapigateway/marketdata/${accountId}/quotes`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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

    // Determine which tickers need prev close from Yahoo.
    // We need it when Public doesn't return oneDayChange AND
    // when we're in pre/post market (to compute midpoint vs prev close).
    const needPrevClose = [];
    for (const q of quotes) {
      if (q.outcome !== 'SUCCESS') continue;
      const hasPct   = q.oneDayChange?.percentChange != null;
      const hasPrev  = q.previousClose != null;
      const isLive   = isMarketHours(q.lastTimestamp);
      const hasMid   = parseFloat(q.bid) > 0 && parseFloat(q.ask) > 0;
      // Need Yahoo prev close if: no Public pct AND (no prev close OR in pre-market with mid)
      if (!hasPct && (!hasPrev || (!isLive && hasMid))) {
        needPrevClose.push(q.instrument?.symbol);
      }
    }

    // Fetch prev closes in parallel, capped at 20 concurrent
    const prevCloseMap = {};
    for (let i = 0; i < needPrevClose.length; i += 20) {
      const chunk = needPrevClose.slice(i, i + 20);
      const results = await Promise.all(chunk.map(async (t) => [t, await fetchPrevClose(t)]));
      for (const [ticker, close] of results) {
        if (close != null) prevCloseMap[ticker] = close;
      }
    }

    // Build normalized response
    const result = {};
    for (const q of quotes) {
      if (q.outcome !== 'SUCCESS') continue;
      const symbol = q.instrument?.symbol;
      if (!symbol) continue;

      const last = parseFloat(q.last);
      const bid  = parseFloat(q.bid)  || null;
      const ask  = parseFloat(q.ask)  || null;
      const mid  = (bid && ask) ? (bid + ask) / 2 : null;
      const isLive = isMarketHours(q.lastTimestamp);

      // Price: during market hours use last trade; pre/post use midpoint if available
      const price = (!isLive && mid) ? mid : (Number.isFinite(last) ? last : mid);
      if (!price) continue;

      // changePct resolution order:
      // 1. Public's own oneDayChange.percentChange (most accurate when available)
      // 2. Compute from Public's previousClose
      // 3. Compute from Yahoo prev close
      // Pre-market: always use midpoint vs prev close (last trade is yesterday)
      let changePct = null;

      if (!isLive && mid) {
        // Pre/post market — compute from midpoint vs prev close
        const prev = q.previousClose
          ? parseFloat(q.previousClose)
          : prevCloseMap[symbol];
        if (prev && prev > 0) {
          changePct = ((mid - prev) / prev) * 100;
        }
      } else if (q.oneDayChange?.percentChange != null) {
        changePct = parseFloat(q.oneDayChange.percentChange);
      } else {
        const prev = q.previousClose
          ? parseFloat(q.previousClose)
          : prevCloseMap[symbol];
        if (prev && prev > 0) {
          changePct = ((price - prev) / prev) * 100;
        }
      }

      result[symbol] = {
        price:     parseFloat(price.toFixed(4)),
        changePct: changePct != null ? parseFloat(changePct.toFixed(2)) : null,
        bid,
        ask,
        mid:       mid ? parseFloat(mid.toFixed(4)) : null,
        isPreMarket: !isLive && mid != null,
        volume:    q.volume    || null,
        timestamp: q.lastTimestamp || null,
      };
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    // Shorter cache in pre-market since bid/ask update frequently
    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=10');
    return res.status(200).json(result);

  } catch (e) {
    return res.status(502).json({ error: e.message || 'Failed' });
  }
}
