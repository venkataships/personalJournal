// Technicals for one ticker from daily bars (oldest -> newest).
// Same definitions as the bot where they overlap (8/21 trend, phase vs SPY,
// PDH/PDL, HH/HL streak), so the Lookup page and the Sectors page agree.

import { deterioration } from './deterioration';

const r2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);
const pct = (a, b) => (a != null && b ? r2((a / b - 1) * 100) : null);

export function emaSeries(vals, span) {
  const out = new Array(vals.length).fill(null);
  if (vals.length < span) return out;
  const k = 2 / (span + 1);
  let e = vals.slice(0, span).reduce((s, v) => s + v, 0) / span;
  out[span - 1] = e;
  for (let i = span; i < vals.length; i++) { e = vals[i] * k + e * (1 - k); out[i] = e; }
  return out;
}

export function smaSeries(vals, n) {
  const out = new Array(vals.length).fill(null);
  let s = 0;
  for (let i = 0; i < vals.length; i++) {
    s += vals[i];
    if (i >= n) s -= vals[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

// Wilder's RSI
export function rsi(closes, n = 14) {
  if (closes.length <= n) return null;
  let g = 0; let l = 0;
  for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  return l === 0 ? 100 : r2(100 - 100 / (1 + g / l));
}

// Wilder's ATR
export function atr(bars, n = 14) {
  if (bars.length <= n) return null;
  const tr = bars.slice(1).map((b, i) => Math.max(b.h - b.l, Math.abs(b.h - bars[i].c), Math.abs(b.l - bars[i].c)));
  let a = tr.slice(0, n).reduce((s, v) => s + v, 0) / n;
  for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return a;
}

export function emaTrend(price, e8, e21) {
  if (price == null || !e8 || !e21) return null;
  if (e8 > e21 && price > e21) return 'up';
  if (e8 < e21 && price < e21) return 'down';
  return 'mixed';
}

// Same phase rule as the pulse (sector_pulse._PHASE_MAP; dead zone ±0.5 pts 5d, ±1 pt 20d).
const PHASE_MAP = {
  '1,1': 'Leading', '1,0': 'Improving', '1,-1': 'Improving',
  '0,1': 'Weakening', '0,0': 'In line', '0,-1': 'Lagging',
  '-1,1': 'Weakening', '-1,0': 'Weakening', '-1,-1': 'Lagging',
};
export function phase(rs5, rs20) {
  if (rs5 == null || rs20 == null) return null;
  const sgn = (v, dz) => (v > dz ? 1 : v < -dz ? -1 : 0);
  return PHASE_MAP[`${sgn(rs5, 0.5)},${sgn(rs20, 1.0)}`];
}

export function hhhlStreak(bars) {
  const n = bars.length;
  if (n < 2) return 0;
  const up = (i) => bars[i].h > bars[i - 1].h && bars[i].l > bars[i - 1].l;
  const dn = (i) => bars[i].h < bars[i - 1].h && bars[i].l < bars[i - 1].l;
  const dir = up(n - 1) ? 1 : dn(n - 1) ? -1 : 0;
  if (!dir) return 0;
  let c = 0;
  for (let i = n - 1; i > 0 && (dir > 0 ? up(i) : dn(i)); i--) c++;
  return dir * c;
}

// Swing pivots: a high/low with `k` lower highs / higher lows on each side.
export function swings(bars, k = 3, lookback = 90) {
  const start = Math.max(k, bars.length - lookback);
  const highs = []; const lows = [];
  for (let i = start; i < bars.length - k; i++) {
    const win = bars.slice(i - k, i + k + 1);
    if (win.every((b) => b.h <= bars[i].h)) highs.push({ d: bars[i].d, p: r2(bars[i].h) });
    if (win.every((b) => b.l >= bars[i].l)) lows.push({ d: bars[i].d, p: r2(bars[i].l) });
  }
  return { highs, lows };
}

function periodReturn(closes, n) {
  return closes.length > n ? pct(closes.at(-1), closes.at(-1 - n)) : null;
}

export function analyze(bars, spyBars = [], lookbackN = 20, opts = {}) {
  const onePrice = !!opts.onePrice;   // today = a single live price (pre-market): no real high/low yet
  const provisional = !!opts.provisional;   // today's bar is still forming (live quote merged in)
  if (!bars || bars.length < 25) return null;
  const closes = bars.map((b) => b.c);
  const last = bars.at(-1); const prev = bars.at(-2);
  const price = last.c;

  const e8 = emaSeries(closes, 8); const e21 = emaSeries(closes, 21);
  const s50 = smaSeries(closes, 50); const s200 = smaSeries(closes, 200);
  const ema8 = e8.at(-1); const ema21 = e21.at(-1);
  const sma50 = s50.at(-1); const sma200 = s200.at(-1);
  const ema21Slope = e21.length > 6 && e21.at(-6) ? pct(ema21, e21.at(-6)) : null;

  const yr = bars.slice(-252);
  const hi52 = yr.reduce((a, b) => (b.h > a.h ? b : a));
  const lo52 = yr.reduce((a, b) => (b.l < a.l ? b : a));

  const prior = bars.slice(-1 - lookbackN, -1);            // N sessions before today
  const nHigh = Math.max(...prior.map((b) => b.h));
  const nLow = Math.min(...prior.map((b) => b.l));

  const a14 = atr(bars, 14);
  const rangeBars = onePrice ? bars.slice(-21, -1) : bars.slice(-20);
  const adr = r2(rangeBars.reduce((s, b) => s + (b.h / b.l - 1), 0) / rangeBars.length * 100);
  const vols = bars.slice(-21, -1).map((b) => b.v).filter(Boolean);
  const avgVol = vols.length ? vols.reduce((s, v) => s + v, 0) / vols.length : null;
  const rvol = avgVol && last.v ? r2(last.v / avgVol) : null;
  const upVol = bars.slice(-20).reduce((s, b, i, arr) => s + ((i ? b.c > arr[i - 1].c : b.c > b.o) ? b.v : 0), 0);
  const dnVol = bars.slice(-20).reduce((s, b, i, arr) => s + ((i ? b.c < arr[i - 1].c : b.c < b.o) ? b.v : 0), 0);

  const ret = { r1: pct(price, prev.c), r5: periodReturn(closes, 5), r20: periodReturn(closes, 20), r60: periodReturn(closes, 60) };
  let rel = null;
  if (spyBars?.length > 25) {
    const byDate = new Map(spyBars.map((b) => [b.d, b.c]));
    const aligned = bars.filter((b) => byDate.has(b.d));
    const sc = aligned.map((b) => byDate.get(b.d)); const tc = aligned.map((b) => b.c);
    const sr = (n) => periodReturn(sc, n); const tr = (n) => periodReturn(tc, n);
    const d = (n) => (tr(n) != null && sr(n) != null ? r2(tr(n) - sr(n)) : null);
    rel = { rs5: d(5), rs20: d(20), rs60: d(60), spy5: sr(5), spy20: sr(20) };
    rel.phase = phase(rel.rs5, rel.rs20);
  }

  // Yesterday's range and what today did with it (same states as the pulse).
  const pdh = prev.h; const pdl = prev.l;
  const pdState = price > pdh ? 'above' : price < pdl ? 'below' : 'inside';
  const tookH = last.h > pdh; const tookL = last.l < pdl;
  const pdEvent = onePrice ? (pdState === 'above' ? 'gap_above' : pdState === 'below' ? 'gap_below' : 'inside_open')
    : tookH && tookL ? (pdState === 'above' ? 'breakout' : pdState === 'below' ? 'breakdown' : 'outside_day')
    : tookH ? (pdState === 'above' ? 'breakout' : 'failed_breakout')
      : tookL ? (pdState === 'below' ? 'breakdown' : 'reclaim') : 'inside_day';

  // EMA pullback read: today's low tagged the 8 or 21 EMA and it closed back above.
  const touched = (e) => e && last.l <= e * 1.005 && price > e;
  const pullback = onePrice ? null : touched(ema8) ? '8' : touched(ema21) ? '21' : null;

  const sw = swings(bars);
  const resistance = sw.highs.filter((s) => s.p > price).sort((a, b) => a.p - b.p)[0] || null;
  const support = sw.lows.filter((s) => s.p < price).sort((a, b) => b.p - a.p)[0] || null;

  // Same inputs as the bot: completed sessions + the live price while today's bar is forming.
  const done = provisional ? bars.slice(0, -1) : bars;
  const det = deterioration(done.map((b) => ({ close: b.c, high: b.h, low: b.l, volume: b.v })), price);

  const out = {
    date: last.d, det, price: r2(price), ...ret, rel,
    ema8: r2(ema8), ema21: r2(ema21), sma50: r2(sma50), sma200: r2(sma200),
    dist8: pct(price, ema8), dist21: pct(price, ema21), dist50: pct(price, sma50), dist200: pct(price, sma200),
    trend: emaTrend(price, ema8, ema21), ema21Slope, golden: sma50 && sma200 ? sma50 > sma200 : null,
    hi52: r2(hi52.h), hi52d: hi52.d, lo52: r2(lo52.l), lo52d: lo52.d, from52h: pct(price, hi52.h), from52l: pct(price, lo52.l),
    rangePos52: hi52.h > lo52.l ? Math.round((price - lo52.l) / (hi52.h - lo52.l) * 100) : null,
    lookbackN, nHigh: r2(nHigh), nLow: r2(nLow), aboveNHigh: price > nHigh, belowNLow: price < nLow,
    fromNHigh: pct(price, nHigh), fromNLow: pct(price, nLow),
    pdh: r2(pdh), pdl: r2(pdl), pdState, pdEvent, dayH: r2(last.h), dayL: r2(last.l),
    atr: r2(a14), atrPct: a14 ? r2(a14 / price * 100) : null, adr,
    ext21Atr: a14 && ema21 ? r2((price - ema21) / a14) : null,
    rsi: rsi(closes, 14), rvol, upDownVol: dnVol ? r2(upVol / dnVol) : null,
    streak: hhhlStreak(onePrice ? bars.slice(0, -1) : bars), pullback, onePrice, resistance, support,
    swingHighs: sw.highs.slice(-6), swingLows: sw.lows.slice(-6),
    shortHistory: bars.length < 200,
    series: { e8, e21, s50 },
  };
  out.notes = verdict(out);
  return out;
}

const DET_SHORT = {
  lower_highs_lows: 'lower highs & lows', declining_emas: 'declining 8/21', failed_ema_bounce: 'failed EMA bounce',
  low_volume_bounces: 'low-volume bounces', resistance_defended: 'sellers at resistance',
};

// Plain-English read, one line per question a swing trader asks.
export function verdict(t) {
  const n = [];
  const trend = {
    up: `Trend: up on the daily 8/21 — 8 EMA ${t.ema8} over 21 EMA ${t.ema21}, price ${t.dist21}% above the 21.`,
    down: `Trend: down — 8 EMA ${t.ema8} under 21 EMA ${t.ema21}, price ${Math.abs(t.dist21)}% below the 21.`,
    mixed: t.ema8 > t.ema21
      ? `Trend: pulling back — 8 still over 21, but price is ${Math.abs(t.dist21)}% under the 21 EMA.`
      : `Trend: trying to turn — price back above the 21, 8 still under it (not confirmed).`,
  }[t.trend];
  if (trend) n.push({ k: 'trend', tone: t.trend === 'up' ? 'good' : t.trend === 'down' ? 'bad' : 'warn', text: trend });
  if (t.sma200 != null) {
    n.push({ k: 'long', tone: t.price > t.sma200 ? 'good' : 'bad',
      text: `Long term: ${t.price > t.sma200 ? 'above' : 'below'} the 200-day (${t.sma200}, ${t.dist200}%)${t.golden != null ? `; 50-day ${t.golden ? 'above' : 'below'} the 200-day` : ''}.` });
  }
  if (t.rel) {
    n.push({ k: 'rs', tone: ['Leading', 'Improving'].includes(t.rel.phase) ? 'good' : t.rel.phase === 'In line' ? 'neutral' : 'bad',
      text: `Vs SPY: ${t.rel.phase} — ${t.rel.rs5 > 0 ? '+' : ''}${t.rel.rs5} pts over 5 days, ${t.rel.rs20 > 0 ? '+' : ''}${t.rel.rs20} over 20.` });
  }
  const ext = t.ext21Atr;
  if (ext != null) {
    n.push({ k: 'ext', tone: ext > 3 ? 'warn' : ext < -2 ? 'warn' : 'neutral',
      text: ext > 3 ? `Extended: ${ext} ATRs above the 21 EMA — chasing here means a wide stop.`
        : ext < -2 ? `Stretched down: ${Math.abs(ext)} ATRs below the 21 EMA.`
          : `Not extended: ${ext} ATRs from the 21 EMA.` });
  }
  if (t.rsi != null) {
    n.push({ k: 'rsi', tone: t.rsi >= 70 || t.rsi <= 30 ? 'warn' : 'neutral',
      text: `RSI ${t.rsi}${t.rsi >= 70 ? ' — overbought; strong trends can stay here, but entries get worse' : t.rsi <= 30 ? ' — oversold' : ''}.` });
  }
  if (t.aboveNHigh) n.push({ k: 'level', tone: 'good', text: `Above its ${t.lookbackN}-day high (${t.nHigh}) — a range breakout.` });
  else if (t.fromNHigh != null && t.fromNHigh > -3) n.push({ k: 'level', tone: 'neutral', text: `${Math.abs(t.fromNHigh)}% under its ${t.lookbackN}-day high (${t.nHigh}) — the level to break.` });
  if (t.belowNLow) n.push({ k: 'level', tone: 'bad', text: `Below its ${t.lookbackN}-day low (${t.nLow}) — range breakdown.` });
  if (t.det) {
    const names = t.det.signs.map((s) => DET_SHORT[s]).join(', ');
    n.push({ k: 'det', tone: t.det.score >= 3 ? 'bad' : t.det.score === 2 ? 'warn' : 'good',
      text: t.det.score >= 3 ? `Deterioration ${t.det.score}/5 — the right side is failing (${names}). Strength is no longer the reason to hold.`
        : t.det.score === 2 ? `Deterioration 2/5 — watch: ${names}. One more sign makes it a failing chart.`
          : `Deterioration ${t.det.score}/5 — structure intact${names ? ` (only: ${names})` : ''}. Don't fade it for looking stretched.` });
  }
  if (t.pullback) n.push({ k: 'pb', tone: 'good', text: `Pullback: today's low tagged the ${t.pullback} EMA and it closed back above — the EMA-pullback entry.` });
  if (t.from52h != null && t.from52h > -5) n.push({ k: '52', tone: 'good', text: `Within ${Math.abs(t.from52h)}% of its 52-week high (${t.hi52}).` });
  if (t.atr) {
    const stop21 = t.ema21 && t.price > t.ema21 ? t.ema21 : null;
    n.push({ k: 'risk', tone: 'neutral',
      text: `Risk: ATR ${t.atr} (${t.atrPct}% a day)${stop21 ? `; a stop under the 21 EMA (~${stop21}) is ${r2((t.price - stop21) / t.atr)} ATRs away` : ''}${t.support ? `; nearest swing low ${t.support.p}` : ''}.` });
  }
  return n;
}

// Fold a live quote (from /api/quotes) into daily bars as a provisional
// "today" bar, so pre-market / intraday lookups use the current price.
//   premarket / regular: today's bar = existing partial bar extended by the
//     live price, or a new one-price bar if Public has none yet.
//   closed: only append if the bars stop at the session before the quote's
//     (quote.prevClose matches the last bar) — weekend/holiday-safe.
export function mergeLive(bars, q, todayISO) {
  if (!bars?.length || !q?.price) return { bars, live: null };
  const last = bars.at(-1);
  const p = q.price;
  const live = { price: p, changePct: q.changePct ?? null, session: q.session, prevClose: q.prevClose ?? null };
  if (q.session === 'premarket' || q.session === 'regular') {
    if (last.d === todayISO) {
      const bar = { ...last, c: p, h: Math.max(last.h, p), l: Math.min(last.l, p), v: Math.max(last.v || 0, q.volume || 0) };
      return { bars: [...bars.slice(0, -1), bar], live: { ...live, provisional: true } };
    }
    if (last.d < todayISO) {
      const bar = { d: todayISO, o: p, h: p, l: p, c: p, v: q.session === 'regular' ? (q.volume || 0) : 0 };
      return { bars: [...bars, bar], live: { ...live, provisional: true, onePrice: true } };
    }
    return { bars, live };
  }
  // closed: bars already include the latest session?
  if (q.prevClose && Math.abs(q.prevClose / last.c - 1) < 0.002 && Math.abs(p / last.c - 1) > 1e-6 && last.d < todayISO) {
    return { bars: [...bars, { d: todayISO, o: p, h: p, l: p, c: p, v: q.volume || 0 }], live: { ...live, provisional: true, onePrice: true } };
  }
  return { bars, live };
}
