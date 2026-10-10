/* global process */
// api/options.js — Vercel serverless function: option chain for swing-trade expiries, from Public.
//
//   GET /api/options?symbol=NVDA
//   -> { symbol, expirations: [...all], picked: ['2026-11-20', '2026-12-18'],
//        chains: { '2026-11-20': { calls: [{ strike, bid, ask, mid, last, iv, delta, gamma, theta, vega, oi, volume, osi }], puts: [...] } } }
//
// Picks up to two expirations sized for 2-10 day holds: the first one 21+ days out (theta is
// still slow) and the first one 45+ days out. 1 + 2 Public requests per lookup.

const BASE = 'https://api.public.com';
let _token = null;
let _tokenExp = 0;

async function token(secret) {
  if (_token && Date.now() < _tokenExp) return _token;
  const r = await fetch(`${BASE}/userapiauthservice/personal/access-tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ validityInMinutes: 60, secret }),
  });
  if (!r.ok) throw new Error(`Auth failed HTTP ${r.status}`);
  _token = (await r.json()).accessToken;
  _tokenExp = Date.now() + 55 * 60 * 1000;
  return _token;
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const etToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
export const dte = (exp, today = etToday()) => Math.round((Date.parse(`${exp}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);

export function pickExpirations(exps, today = etToday()) {
  const sorted = [...new Set(exps)].filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e)).sort();
  const a = sorted.find((e) => dte(e, today) >= 21);
  const b = sorted.find((e) => dte(e, today) >= 45 && e !== a);
  return [a, b].filter(Boolean);
}

export function normContract(c) {
  const det = c.optionDetails || {};
  const g = det.greeks || {};
  const bid = num(c.bid); const ask = num(c.ask); const last = num(c.last);
  const mid = num(det.midPrice) ?? (bid != null && ask != null ? (bid + ask) / 2 : null);
  const iv = num(g.impliedVolatility);
  return {
    strike: num(det.strikePrice),
    bid, ask, last, mid: mid != null ? Math.round(mid * 100) / 100 : null,
    iv: iv != null ? Math.round(iv * 1000) / 10 : null,       // percent
    delta: num(g.delta), gamma: num(g.gamma), theta: num(g.theta), vega: num(g.vega),
    oi: num(c.openInterest), volume: num(c.volume),
    osi: c.instrument?.symbol || c.symbol || null,
  };
}

async function post(path, body, tok) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    if (r.status === 401) _token = null;
    throw new Error(`Public ${r.status}: ${(await r.text()).slice(0, 160)}`);
  }
  return r.json();
}

export default async function handler(req, res) {
  const secret = process.env.PUBLIC_API_SECRET;
  const accountId = process.env.PUBLIC_ACCOUNT_ID;
  if (!secret || !accountId) return res.status(500).json({ error: 'PUBLIC_API_SECRET / PUBLIC_ACCOUNT_ID not configured' });
  const symbol = String(req.query.symbol || '').trim().toUpperCase().replace(/^\$/, '');
  if (!/^[A-Z.]{1,6}$/.test(symbol)) return res.status(400).json({ error: 'symbol param required' });
  try {
    const tok = await token(secret);
    const instrument = { symbol, type: 'EQUITY' };
    const ex = await post(`/userapigateway/marketdata/${accountId}/option-expirations`, { instrument }, tok);
    const expirations = ex.expirations || [];
    const picked = pickExpirations(expirations);
    const chains = {};
    await Promise.all(picked.map(async (exp) => {
      const js = await post(`/userapigateway/marketdata/${accountId}/option-chain`, { instrument, expirationDate: exp }, tok);
      chains[exp] = {
        calls: (js.calls || []).map(normContract).filter((c) => c.strike != null),
        puts: (js.puts || []).map(normContract).filter((c) => c.strike != null),
      };
    }));
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=60');
    return res.status(200).json({ symbol, expirations, picked, chains });
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Failed' });
  }
}
