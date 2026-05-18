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

// Returns { prevClose, todayClose } from Yahoo Finance 5-day chart.
// prevClose = the day before the most recent session (for session % change).
// todayClose = the most recent completed session close (for ext hours % base).
async function fetchCloses(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=5d&interval=1d`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) return null;
    const json = await resp.json();
    const closes    = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    const timestamps = json?.chart?.result?.[0]?.timestamp;
    if (!closes || !timestamps) return null;

    const pairs = closes
      .map((c, i) => ({ close: c, ts: timestamps[i] }))
      .filter((p) => p.close != null);

    if (!pairs.length) return null;

    const marketOpen = isNYSEMarketHours();

    if (marketOpen) {
      // During market hours: last bar is today's partial, second-to-last is prev close
      const todayClose  = null; // market still open, no today close yet
      const prevClose   = pairs.length >= 2 ? pairs[pairs.length - 2].close : pairs[pairs.length - 1].close;
      return { prevClose, todayClose };
    } else {
      // Extended hours / weekend:
      // todayClose = most recent completed session (what session % is based on)
      // prevClose  = the session before that (day before today's session)
      const todayClose = pairs[pairs.length - 1].close;
      const prevClose  = pairs.length >= 2 ? pairs[pairs.length - 2].close : null;
      return { prevClose, todayClose };
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
    const isLive = isNYSEMarketHours();

    // Fetch Yahoo closes for ALL tickers — we need both prevClose and todayClose
    // to compute session % AND extended hours % correctly.
    // Run all in parallel, capped at 20 concurrent.
    const closesMap = {}; // symbol → { prevClose, todayClose }
    for (let i = 0; i < tickerList.length; i += 20) {
      const chunk = tickerList.slice(i, i + 20);
      const results = await Promise.all(
        chunk.map(async (t) => [t, await fetchCloses(t)])
      );
      for (const [ticker, closes] of results) {
        if (closes) closesMap[ticker] = closes;
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

      if (!Number.isFinite(last) && !mid) continue;

      const yahooCloses = closesMap[symbol] || {};
      // todayClose = most recent session close (ext hours base)
      // prevClose  = session before that (session % base)
      const todayClose = yahooCloses.todayClose ?? null;
      const prevClose  = q.previousClose
        ? parseFloat(q.previousClose)
        : yahooCloses.prevClose ?? null;

      // ── Session change: today's close vs previous day's close ─────────────
      // Public's oneDayChange is most accurate when available.
      // Otherwise: (last - prevClose) / prevClose
      let sessionChangePct = null;
      if (q.oneDayChange?.percentChange != null) {
        sessionChangePct = parseFloat(q.oneDayChange.percentChange);
      } else if (Number.isFinite(last) && prevClose && prevClose > 0) {
        sessionChangePct = ((last - prevClose) / prevClose) * 100;
      } else if (todayClose && prevClose && prevClose > 0) {
        // Use Yahoo's own close values if Public's last is unreliable
        sessionChangePct = ((todayClose - prevClose) / prevClose) * 100;
      }

      // ── Extended hours change: current mid vs today's close ───────────────
      // (mid - todayClose) / todayClose — what's moving NOW vs where it ended
      let extendedChangePct = null;
      if (!isLive && mid) {
        const base = todayClose ?? (Number.isFinite(last) ? last : null);
        if (base && base > 0) {
          extendedChangePct = ((mid - base) / base) * 100;
        }
      }

      // ── Display price ─────────────────────────────────────────────────────
      const displayPrice = (!isLive && mid) ? mid : (Number.isFinite(last) ? last : mid);
      if (!displayPrice) continue;

      result[symbol] = {
        price:             parseFloat(displayPrice.toFixed(4)),
        closePrice:        todayClose ? parseFloat(todayClose.toFixed(4)) : (Number.isFinite(last) ? parseFloat(last.toFixed(4)) : null),
        prevClose:         prevClose  ? parseFloat(prevClose.toFixed(4))  : null,
        sessionChangePct:  sessionChangePct  != null ? parseFloat(sessionChangePct.toFixed(2))  : null,
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
