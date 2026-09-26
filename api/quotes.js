// api/quotes.js — Vercel serverless function
//
// All numbers come from Public's quote response. No Yahoo.
//
//   prevClose  = Public previousClose (the last completed regular session)
//   Pre-market : price = (bid+ask)/2 mid, changePct vs prevClose
//   Regular    : price = last trade (mid fallback), changePct vs prevClose
//   After 4pm / weekends / overnight:
//                price = today's regular close = prevClose + oneDayChange.change
//                changePct = oneDayChange.percentChange (what the Public app shows)
//                extPrice = last print (after-hours / 24h session), for reference
//
// Why not Yahoo: Yahoo posts the day's daily bar late, so "second-to-last
// bar" silently became the day before yesterday. And after the close Public's
// bid/ask/last belong to its overnight session, not the day's close.

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

// premarket | regular | closed  (closed = after 4pm, overnight, weekends)
export function marketSession(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return 'closed';
  const mins = (Number(parts.hour) % 24) * 60 + Number(parts.minute);
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) return 'premarket';
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) return 'regular';
  return 'closed';
}

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
};
const round = (n, d = 2) => (n == null ? null : parseFloat(n.toFixed(d)));

export function buildQuote(q, session) {
  const bid  = num(q.bid);
  const ask  = num(q.ask);
  const last = num(q.last);
  const mid  = bid && ask ? round((bid + ask) / 2) : null;
  const prevClose = num(q.previousClose);
  const day = q.oneDayChange || {};
  const dayChange = Number.isFinite(parseFloat(day.change)) ? parseFloat(day.change) : null;
  const dayPct    = Number.isFinite(parseFloat(day.percentChange)) ? parseFloat(day.percentChange) : null;

  let price;
  let changePct;
  let extPrice = null;

  if (session === 'closed' && prevClose && dayChange != null) {
    price     = round(prevClose + dayChange);
    changePct = dayPct != null ? round(dayPct) : round(dayChange / prevClose * 100);
    extPrice  = last;
  } else {
    price = session === 'premarket' ? (mid ?? last) : (last ?? mid);
    changePct = price && prevClose ? round((price - prevClose) / prevClose * 100) : null;
  }
  if (!price) return null;

  return {
    price, changePct, prevClose, extPrice, session,
    mid, last, bid, ask,
    volume: q.volume ?? null,
    timestamp: q.lastTimestamp ?? null,
  };
}

export default async function handler(req, res) {
  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols param required' });

  const secret    = process.env.PUBLIC_API_SECRET;
  const accountId = process.env.PUBLIC_ACCOUNT_ID;
  if (!secret || !accountId) {
    return res.status(500).json({ error: 'PUBLIC_API_SECRET or PUBLIC_ACCOUNT_ID not configured' });
  }

  const tickers = [...new Set(symbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const session = marketSession();

  try {
    const token = await getAccessToken(secret);
    const pubResp = await fetch(`${BASE}/userapigateway/marketdata/${accountId}/quotes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruments: tickers.map((s) => ({ symbol: s, type: 'EQUITY' })) }),
    });
    if (!pubResp.ok) {
      if (pubResp.status === 401) _cachedToken = null;
      const txt = await pubResp.text();
      return res.status(pubResp.status).json({ error: `Public ${pubResp.status}`, detail: txt.slice(0, 200) });
    }
    const quotes = (await pubResp.json())?.quotes ?? [];

    const result = {};
    for (const q of quotes) {
      if (q.outcome !== 'SUCCESS') continue;
      const sym = q.instrument?.symbol?.toUpperCase();
      if (!sym) continue;
      const built = buildQuote(q, session);
      if (built) result[sym] = built;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    return res.status(200).json(result);
  } catch (e) {
    return res.status(502).json({ error: e.message ?? 'Failed' });
  }
}
