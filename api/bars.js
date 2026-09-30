/* global process */
// api/bars.js — Vercel serverless function: ~1 year of daily bars from Public.
//
//   GET /api/bars?symbols=NVDA,SPY
//   -> { NVDA: [{ d: '2026-09-25', o, h, l, c, v }, ...oldest→newest], SPY: [...] }
//
// One Public request per symbol (bars v2, YEAR / ONE_DAY, regular hours).
// Used by the Lookup page; the technicals are computed in the browser.

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

const etDate = (ts) => {
  const n = Number(ts);
  const d = Number.isFinite(n) && String(ts).match(/^\d+$/) ? new Date(n > 1e11 ? n : n * 1000) : new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
};

export function parseDaily(js) {
  const sections = ['regularMarket', 'preMarket', 'afterMarket'];
  const raw = (js?.regularMarket?.bars?.length ? js.regularMarket.bars
    : sections.flatMap((s) => js?.[s]?.bars || []));
  const byDay = new Map();
  for (const b of raw) {
    const d = etDate(b.timestamp);
    const o = parseFloat(b.open); const h = parseFloat(b.high);
    const l = parseFloat(b.low); const c = parseFloat(b.close);
    if (!d || ![o, h, l, c].every(Number.isFinite)) continue;
    byDay.set(d, { d, o, h, l, c, v: parseFloat(b.volume) || 0 }); // last one per date wins
  }
  return [...byDay.values()].sort((a, b) => a.d.localeCompare(b.d));
}

async function fetchBars(sym, tok) {
  const url = `${BASE}/userapigateway/historicdata/EQUITY/${encodeURIComponent(sym)}/YEAR/ONE_DAY?tradingSessionToggle=REGULAR_HOURS`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) {
    if (r.status === 401) _token = null;
    return { error: `Public ${r.status}`, detail: (await r.text()).slice(0, 160) };
  }
  return parseDaily(await r.json());
}

export default async function handler(req, res) {
  const secret = process.env.PUBLIC_API_SECRET;
  if (!secret) return res.status(500).json({ error: 'PUBLIC_API_SECRET not configured' });
  const syms = [...new Set(String(req.query.symbols || '').split(',')
    .map((s) => s.trim().toUpperCase().replace(/^\$/, '')).filter((s) => /^[A-Z.]{1,6}$/.test(s)))].slice(0, 4);
  if (!syms.length) return res.status(400).json({ error: 'symbols param required' });
  try {
    const tok = await token(secret);
    const out = {};
    await Promise.all(syms.map(async (s) => { out[s] = await fetchBars(s, tok); }));
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120');
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Failed' });
  }
}
