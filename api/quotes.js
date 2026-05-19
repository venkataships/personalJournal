// api/quotes.js — Vercel serverless function
// Mirrors portfolio-agent/public_client.py exactly:
// - Price = last (market hours) or (bid+ask)/2 midpoint (extended hours)
// - Change % = (price - prevClose) / prevClose * 100
// - prevClose fetched from Yahoo Finance /v8/finance/chart

const BASE = 'https://api.public.com';

// ── Auth token cache ────────────────────────────────────────────────────────
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

// ── NYSE market hours — UTC-based, no getTimezoneOffset() ──────────────────
function isNYSEOpen(now = new Date()) {
  const year = now.getUTCFullYear();

  // Second Sunday of March → EDT starts (UTC-4)
  const edtStart = new Date(Date.UTC(year, 2, 1));
  let suns = 0;
  while (suns < 2) {
    if (edtStart.getUTCDay() === 0) suns++;
    if (suns < 2) edtStart.setUTCDate(edtStart.getUTCDate() + 1);
  }
  edtStart.setUTCHours(7, 0, 0, 0); // 2 AM ET = 7 AM UTC

  // First Sunday of November → EST resumes (UTC-5)
  const estStart = new Date(Date.UTC(year, 10, 1));
  while (estStart.getUTCDay() !== 0) estStart.setUTCDate(estStart.getUTCDate() + 1);
  estStart.setUTCHours(6, 0, 0, 0); // 2 AM ET = 6 AM UTC (still EDT at that moment)

  const etOffset = (now >= edtStart && now < estStart) ? -4 : -5;
  const etHour   = now.getUTCHours() + etOffset + now.getUTCMinutes() / 60;
  const etDay    = (now.getUTCDay() + (now.getUTCHours() + etOffset < 0 ? -1 : 0) + 7) % 7;

  if (etDay === 0 || etDay === 6) return false;
  return etHour >= 9.5 && etHour < 16;
}

// ── Yahoo Finance prev close ────────────────────────────────────────────────
// Returns the most recent completed session's closing price.
// During market hours: second-to-last bar (last bar is today's partial).
// Extended hours: last bar (most recent completed session).
async function fetchPrevClose(ticker, marketOpen) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!resp.ok) return null;
    const json = await resp.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const valid  = closes.filter((c) => c != null && Number.isFinite(c));
    if (!valid.length) return null;
    // Market open: today's partial bar is last → prev close is second-to-last
    // Extended: last bar IS the most recent close
    return marketOpen && valid.length >= 2
      ? valid[valid.length - 2]
      : valid[valid.length - 1];
  } catch {
    return null;
  }
}

// ── Main handler ───────────────────────────────────────────────────────────
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
  const marketOpen = isNYSEOpen();

  try {
    // Step 1: Get Public access token
    const token = await getAccessToken(secret);

    // Step 2: Fetch live quotes from Public (one request, all tickers)
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
    const pubData  = await pubResp.json();
    const quotes   = pubData?.quotes ?? [];

    // Step 3: Fetch prev close from Yahoo for all tickers in parallel
    // (Public never returns prev_close reliably — mirror what the bot does)
    const prevCloses = Object.fromEntries(
      await Promise.all(
        tickers.map(async (t) => [t, await fetchPrevClose(t, marketOpen)])
      )
    );

    // Step 4: Build response — mirror bot's public_client.py field names
    const result = {};
    for (const q of quotes) {
      if (q.outcome !== 'SUCCESS') continue;
      const sym = q.instrument?.symbol?.toUpperCase();
      if (!sym) continue;

      const last = parseFloat(q.last);
      const bid  = parseFloat(q.bid)  || null;
      const ask  = parseFloat(q.ask)  || null;
      const mid  = (bid && ask) ? parseFloat(((bid + ask) / 2).toFixed(4)) : null;

      // Price: last during market hours (matches bot), midpoint in extended
      const price = (!marketOpen && mid) ? mid : (Number.isFinite(last) ? last : mid);
      if (!price) continue;

      const prevClose = prevCloses[sym] ?? null;

      // Change %: always (price - prevClose) / prevClose — same as bot
      const sessionChangePct = (prevClose && prevClose > 0)
        ? parseFloat(((last - prevClose) / prevClose * 100).toFixed(2))
        : null;

      // Extended hours change: (mid - last) / last
      // Only meaningful when market is closed and we have both mid and last trade
      const extendedChangePct = (!marketOpen && mid && Number.isFinite(last) && last > 0)
        ? parseFloat(((mid - last) / last * 100).toFixed(2))
        : null;

      result[sym] = {
        price,                                    // display price
        last:              Number.isFinite(last) ? last : null,
        bid,
        ask,
        mid,
        prevClose,
        sessionChangePct,                         // (last - prevClose) / prevClose
        extendedChangePct,                        // (mid - last) / last, extended only
        isExtendedHours:   !marketOpen,
        volume:            q.volume ?? null,
        timestamp:         q.lastTimestamp ?? null,
      };
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');
    return res.status(200).json(result);

  } catch (e) {
    return res.status(502).json({ error: e.message ?? 'Failed' });
  }
}
