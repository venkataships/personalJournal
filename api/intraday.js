/* global process */
// api/intraday.js — Vercel serverless function: today's regular-session 15-minute bars from Public.
//
//   GET /api/intraday?symbols=MU,OKLO     (up to 9 — the focus list)
//   -> { MU: [{ t: '2026-11-02T14:30:00.000Z', o, h, l, c, v }, ...oldest→newest], OKLO: [...] }
//
// Same Public endpoint the bot uses (bars v2, WEEK / FIFTEEN_MINUTES, regular hours), filtered to the
// latest New York session. Used by the Sectors focus list to compute "Undercut ✓" in the browser.

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

const toDate = (ts) => {
  const n = Number(ts);
  const d = Number.isFinite(n) && /^\d+$/.test(String(ts)) ? new Date(n > 1e11 ? n : n * 1000) : new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
};
const etDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
const etMins = (d) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  return Number(p.find((x) => x.type === 'hour').value) * 60 + Number(p.find((x) => x.type === 'minute').value);
};

export function parseToday(js, now = new Date()) {
  const out = [];
  for (const b of js?.regularMarket?.bars || []) {
    const d = toDate(b.timestamp);
    const o = parseFloat(b.open); const h = parseFloat(b.high); const l = parseFloat(b.low); const c = parseFloat(b.close);
    if (!d || ![o, h, l, c].every(Number.isFinite)) continue;
    const m = etMins(d);
    if (m < 570 || m >= 960) continue;                 // 9:30–16:00 ET
    out.push({ t: d.toISOString(), day: etDay(d), o, h, l, c, v: parseFloat(b.volume) || 0 });
  }
  out.sort((a, b) => a.t.localeCompare(b.t));
  const today = etDay(now);
  const last = out.length ? out[out.length - 1].day : null;
  const day = out.some((b) => b.day === today) ? today : last;   // after hours / weekend: the latest session
  return out.filter((b) => b.day === day).map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
}

async function fetchToday(sym, tok) {
  const url = `${BASE}/userapigateway/historicdata/EQUITY/${encodeURIComponent(sym)}/WEEK/FIFTEEN_MINUTES?tradingSessionToggle=REGULAR_HOURS`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) {
    if (r.status === 401) _token = null;
    return { error: `Public ${r.status}` };
  }
  return parseToday(await r.json());
}

export default async function handler(req, res) {
  const secret = process.env.PUBLIC_API_SECRET;
  if (!secret) return res.status(500).json({ error: 'PUBLIC_API_SECRET not configured' });
  const syms = [...new Set(String(req.query.symbols || '').split(',')
    .map((s) => s.trim().toUpperCase().replace(/^\$/, '')).filter((s) => /^[A-Z.]{1,6}$/.test(s)))].slice(0, 9);
  if (!syms.length) return res.status(400).json({ error: 'symbols param required' });
  try {
    const tok = await token(secret);
    const out = {};
    await Promise.all(syms.map(async (s) => { out[s] = await fetchToday(s, tok); }));
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=10');
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Failed' });
  }
}
