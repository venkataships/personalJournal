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
    const closes    = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    const timestamps = json?.chart?.result?.[0]?.timestamp; // Unix seconds
    if (!closes || !timestamps) return null;

    const marketOpen = isNYSEMarketHours();

    // Build pairs of (timestamp, close), filter nulls
    const pairs = closes
      .map((c, i) => ({ close: c, ts: timestamps[i] }))
      .filter((p) => p.close != null);

    if (!pairs.length) return null;

    if (marketOpen) {
      // During market hours, the last bar may be today's partial session.
      // Prev close = second-to-last completed bar.
      return pairs.length >= 2
        ? pairs[pairs.length - 2].close
        : pairs[pairs.length - 1].close;
    } else {
      // Pre/post market or weekend — the last bar IS the most recent close.
      // On Monday pre-market this correctly returns Friday's close.
      return pairs[pairs.length - 1].close;
    }
  } catch {
    return null;
  }
}

// Detect market hours by checking actual NYSE schedule (9:30–16:00 ET).
// ET = UTC-4 during EDT (Mar–Nov), UTC-5 during EST (Nov–Mar).
function isNYSEMarketHours() {
  const now = new Date();
  // Determine ET offset: EDT is UTC-4, EST is UTC-5
  // Simple approximation: EDT runs second Sunday of March through first Sunday of November
  const jan = new Date(now.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(now.getFullYear(), 6, 1).getTimezoneOffset();
  const isDST = now.getTimezoneOffset() < Math.max(jan, jul);
  const etOffset = isDST ? -4 : -5; // hours from UTC

  const etHours = now.getUTCHours() + etOffset + now.getUTCMinutes() / 60;
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 6=Sat — adjust for ET midnight crossings
  // Adjust day if ET offset crosses midnight
  const etDay = (dayOfWeek + (now.getUTCHours() + etOffset < 0 ? -1 : 0) + 7) % 7;

  // Weekend: never market hours
  if (etDay === 0 || etDay === 6) return false;

  // Market hours: 9:30–16:00 ET
  return etHours >= 9.5 && etHours < 16;
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
      const isLive   = isNYSEMarketHours();
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

      const last = parseFloat(q.last);   // last regular-session trade price
      const bid  = parseFloat(q.bid)  || null;
      const ask  = parseFloat(q.ask)  || null;
      const mid  = (bid && ask) ? (bid + ask) / 2 : null;
      const isLive = isNYSEMarketHours();

      if (!Number.isFinite(last) && !mid) continue;

      const prevClose = q.previousClose
        ? parseFloat(q.previousClose)
        : prevCloseMap[symbol] ?? null;

      // ── Regular session change (close vs prev close) ──────────────────────
      // This is what happened 9:30–4pm — the "today" number on Public.
      let sessionChangePct = null;
      if (q.oneDayChange?.percentChange != null) {
        sessionChangePct = parseFloat(q.oneDayChange.percentChange);
      } else if (Number.isFinite(last) && prevClose && prevClose > 0) {
        sessionChangePct = ((last - prevClose) / prevClose) * 100;
      }

      // ── Extended hours change (mark vs close) ─────────────────────────────
      // Pre/post market: (mid - last) / last — what's happening right now vs close.
      // Null during regular market hours (no extended move to show yet).
      let extendedChangePct = null;
      if (!isLive && mid && Number.isFinite(last) && last > 0) {
        extendedChangePct = ((mid - last) / last) * 100;
      }

      // ── Display price ─────────────────────────────────────────────────────
      // Market hours: last trade. Extended: midpoint (current best estimate).
      const displayPrice = (!isLive && mid) ? mid : (Number.isFinite(last) ? last : mid);
      if (!displayPrice) continue;

      result[symbol] = {
        price:             parseFloat(displayPrice.toFixed(4)),
        closePrice:        Number.isFinite(last) ? parseFloat(last.toFixed(4)) : null,
        prevClose:         prevClose ? parseFloat(prevClose.toFixed(4)) : null,
        sessionChangePct:  sessionChangePct != null ? parseFloat(sessionChangePct.toFixed(2)) : null,
        extendedChangePct: extendedChangePct != null ? parseFloat(extendedChangePct.toFixed(2)) : null,
        isExtendedHours:   !isLive,
        bid,
        ask,
        mid:               mid ? parseFloat(mid.toFixed(4)) : null,
        volume:            q.volume || null,
        timestamp:         q.lastTimestamp || null,
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
