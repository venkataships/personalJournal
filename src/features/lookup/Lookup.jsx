import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Search, AlertCircle } from 'lucide-react';
import { supabase, authReady } from '../../lib/supabase';
import { analyze, mergeLive } from '../../lib/technicals';
import { rowToCatalyst, whenLabel, daysUntil } from '../../lib/catalysts';
import { todayET } from '../../lib/journal';

// Pick any ticker: trend, EMAs, 52-week and N-day range, volatility, momentum,
// strength vs SPY, swing levels, and what the pulse / catalysts / journal know.
// Bars come from Public via /api/bars (2 requests: ticker + SPY).

const LOOKBACKS = [5, 10, 20, 50, 100];
const RECENT_KEY = 'lookup.recent';
// Series colours: dataviz reference palette, dark steps (validated on #0a0a0a).
const C = { e8: '#3987e5', e21: '#d95926', s50: '#199e70', up: '#34d399', down: '#fb7185', grid: '#1f1f1f', ref: '#737373' };

const fmt = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d));
const sgn = (v, d = 2) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(d)}%`);
const tone = (v) => (v == null ? 'text-neutral-500' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-neutral-400');
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
const saveRecent = (list) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* optional */ } };

export default function Lookup() {
  const { symbol } = useParams();
  const nav = useNavigate();
  const sym = (symbol || '').toUpperCase();
  const [q, setQ] = useState(sym);
  const [n, setN] = useState(20);
  const [st, setSt] = useState({ for: null, error: null, bars: null, spy: null, ctx: null });
  const [recent, setRecent] = useState(readRecent);

  const load = useCallback(async (t) => {
    try {
      const [res, qres] = await Promise.all([
        fetch(`/api/bars?symbols=${t},SPY`),
        fetch(`/api/quotes?symbols=${t},SPY`).catch(() => null),
      ]);
      const js = await res.json().catch(() => ({}));
      const quotes = qres && qres.ok ? await qres.json().catch(() => ({})) : {};
      if (!res.ok) throw new Error(js.error || `HTTP ${res.status}`);
      const bars = js[t];
      if (!Array.isArray(bars)) throw new Error(bars?.error ? `${bars.error} — is ${t} a valid ticker?` : 'No data');
      if (bars.length < 25) throw new Error(`Only ${bars.length} days of history for ${t} — not enough to analyse.`);
      setSt({ for: t, error: null, bars, spy: Array.isArray(js.SPY) ? js.SPY : [], ctx: null, quotes });
      setRecent((r) => { const next = [t, ...r.filter((x) => x !== t)].slice(0, 8); saveRecent(next); return next; });
      // What the rest of the system knows about it (all optional).
      try {
        await authReady();
        const [snap, cats, trades] = await Promise.all([
          supabase.from('market_pulse').select('as_of, groups, setups').order('as_of', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('catalysts').select('*').eq('is_active', true),
          supabase.from('trade_journal').select('id, ticker, entry_price, stop_loss, quantity, status').eq('status', 'open').eq('ticker', t),
        ]);
        setSt((s) => (s.for !== t ? s : { ...s, ctx: { snap: snap.data, catalysts: (cats.data || []).map(rowToCatalyst), trades: trades.data || [] } }));
      } catch { /* context is a bonus */ }
    } catch (e) {
      setSt({ for: t, error: e.message || 'Failed to load', bars: null, spy: null, ctx: null });
    }
  }, []);

  // Live price every minute while the market is active (pre-market + regular).
  useEffect(() => {
    if (!sym || st.for !== sym) return undefined;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/quotes?symbols=${sym},SPY`);
        if (!r.ok) return;
        const quotes = await r.json();
        if (!['premarket', 'regular'].includes(quotes?.[sym]?.session)) return;
        setSt((s) => (s.for === sym ? { ...s, quotes } : s));
      } catch { /* keep the last price */ }
    }, 60 * 1000);
    return () => clearInterval(id);
  }, [sym, st.for]);

  useEffect(() => {
    if (!sym) return undefined;
    const id = setTimeout(() => load(sym), 0);   // async boundary: state updates happen in a callback
    return () => clearTimeout(id);
  }, [sym, load]);

  const loading = !!sym && st.for !== sym;
  const cur = loading ? {} : st;
  const today = todayET();
  const merged = useMemo(() => {
    if (!cur.bars) return null;
    const m = mergeLive(cur.bars, cur.quotes?.[sym], today);
    const s = mergeLive(cur.spy, cur.quotes?.SPY, today);
    return { bars: m.bars, spy: s.bars, live: m.live };
  }, [cur.bars, cur.spy, cur.quotes, sym, today]);
  const a = useMemo(() => (merged ? analyze(merged.bars, merged.spy, n, { onePrice: !!merged.live?.onePrice }) : null), [merged, n]);
  const go = (t) => { const x = (t || '').trim().toUpperCase().replace(/^\$/, ''); if (x) { setQ(x); nav(`/lookup/${x}`); } };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 antialiased">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2.5 text-3xl font-light tracking-tight text-neutral-100">
              <Search className="h-6 w-6 text-emerald-400" strokeWidth={1.5} /> Lookup
            </h1>
            <p className="mt-1 text-[13px] text-neutral-500">Any ticker — trend, levels, volatility, strength vs SPY, on daily bars.</p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); go(q); }} className="flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} placeholder="NVDA" aria-label="Ticker"
              className="w-32 rounded border border-neutral-800 bg-transparent px-3 py-2 font-mono text-[14px] uppercase text-neutral-100 placeholder:text-neutral-700 focus:border-emerald-500/50 focus:outline-none" />
            <button className="rounded border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-[12px] font-medium uppercase tracking-[0.12em] text-emerald-200">Analyse</button>
          </form>
        </header>

        {recent.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5 text-[11px]">
            <span className="text-neutral-600">Recent</span>
            {recent.map((t) => (
              <button key={t} onClick={() => go(t)} className={`rounded border px-2 py-0.5 font-mono ${t === sym ? 'border-emerald-500/40 text-emerald-300' : 'border-neutral-800 text-neutral-400 hover:text-neutral-200'}`}>{t}</button>
            ))}
          </div>
        )}

        {!sym && <Empty>Type a ticker to see its technicals.</Empty>}
        {loading && <Empty>Loading a year of daily bars for {sym}…</Empty>}
        {cur.error && (
          <div className="flex items-start gap-2 rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-[13px] text-rose-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {cur.error}
          </div>
        )}

        {a && (
          <>
            <Headline sym={sym} a={a} ctx={cur.ctx} live={merged?.live} />
            <Read notes={a.notes} />
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-400">Daily chart</div>
              <div className="flex items-center gap-1 text-[11px]">
                <span className="mr-1 text-neutral-500">N-day high/low:</span>
                {LOOKBACKS.map((x) => (
                  <button key={x} onClick={() => setN(x)} className={`rounded px-2 py-0.5 font-mono ${n === x ? 'bg-emerald-500/15 text-emerald-300' : 'text-neutral-500 hover:text-neutral-300'}`}>{x}</button>
                ))}
              </div>
            </div>
            <Chart bars={merged.bars} a={a} />
            <Stats a={a} />
            <Context sym={sym} a={a} ctx={cur.ctx} />
          </>
        )}
      </div>
    </div>
  );
}

function Empty({ children }) {
  return <div className="rounded-md border border-dashed border-neutral-800 px-4 py-8 text-center text-[13px] text-neutral-500">{children}</div>;
}

function Headline({ sym, a, ctx, live }) {
  const inTrade = ctx?.trades?.length > 0;
  return (
    <div className="mb-4 flex flex-wrap items-baseline gap-x-5 gap-y-2">
      <span className="font-mono text-2xl font-semibold text-neutral-100">{sym}</span>
      <span className="font-mono text-2xl tabular-nums text-neutral-100">{fmt(a.price)}</span>
      {[['1D', a.r1], ['5D', a.r5], ['20D', a.r20], ['60D', a.r60]].map(([k, v]) => (
        <span key={k} className="font-mono text-[13px] tabular-nums"><span className="text-neutral-600">{k} </span><span className={tone(v)}>{sgn(v)}</span></span>
      ))}
      {live?.provisional ? (
        <span className="rounded border border-amber-500/40 bg-amber-500/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-300"
          title={live.onePrice ? "Today's bar is just the live price (no high/low yet) — levels use yesterday's range" : "Today's bar is still forming — updates every minute"}>
          {live.session === 'premarket' ? 'Live · pre-market' : live.session === 'regular' ? 'Live · market open' : 'Latest close'}
        </span>
      ) : <span className="text-[11px] text-neutral-600">latest bar {a.date}</span>}
      {inTrade && <Link to="/journal" className="rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-sky-300">In trade</Link>}
    </div>
  );
}

const TONE = {
  good:    { mark: '✓', cls: 'text-emerald-300' },
  bad:     { mark: '✗', cls: 'text-rose-300' },
  warn:    { mark: '!', cls: 'text-amber-300' },
  neutral: { mark: '·', cls: 'text-neutral-400' },
};

function Read({ notes }) {
  return (
    <div className="mb-5 rounded-md border border-neutral-800 bg-neutral-950/50 px-4 py-3">
      <div className="mb-1.5 text-[11px] uppercase tracking-[0.22em] text-neutral-400">The read</div>
      <ul className="space-y-1 text-[13px] leading-snug">
        {notes.map((x) => (
          <li key={x.k + x.text} className="flex gap-2">
            <span className={`w-3 shrink-0 text-center font-mono ${TONE[x.tone].cls}`} aria-hidden>{TONE[x.tone].mark}</span>
            <span className="text-neutral-300">{x.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Candles + 8/21 EMA + 50-day, with the N-day high/low and 52-week high as reference lines.
function Chart({ bars, a }) {
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640;
  const view = narrow ? 80 : 126;                 // ~4 months on a phone, ~6 on desktop
  const off = Math.max(0, bars.length - view);
  const data = bars.slice(off);
  const s = { e8: a.series.e8.slice(off), e21: a.series.e21.slice(off), s50: a.series.s50.slice(off) };
  const W = narrow ? 420 : 900; const H = narrow ? 260 : 320; const pad = { l: 8, r: 64, t: 12, b: 22 };
  const lo = Math.min(...data.map((b) => b.l)); const hi = Math.max(...data.map((b) => b.h));
  // reference levels; same price -> one line, joined label
  const refs = [];
  for (const r of [
    { y: a.nHigh, label: `${a.lookbackN}d high` }, { y: a.nLow, label: `${a.lookbackN}d low` },
    ...(a.hi52 <= hi * 1.08 ? [{ y: a.hi52, label: '52w high' }] : []),
  ]) {
    const same = refs.find((x) => Math.abs(x.y - r.y) / r.y < 0.002);
    if (same) same.label = `${same.label} = ${r.label}`; else refs.push({ ...r });
  }
  const yMin = Math.min(lo, ...refs.map((r) => r.y)) * 0.99; const yMax = Math.max(hi, ...refs.map((r) => r.y)) * 1.01;
  const x = (i) => pad.l + (i + 0.5) * ((W - pad.l - pad.r) / data.length);
  const y = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);
  const bw = Math.max(1.5, ((W - pad.l - pad.r) / data.length) * 0.6);
  const path = (arr) => arr.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(' L');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + f * (yMax - yMin));
  const months = data.map((b, i) => ({ i, m: b.d.slice(5, 7), d: b.d })).filter((p, i, arr) => i === 0 || p.m !== arr[i - 1].m);

  // right-edge direct labels, nudged apart
  const endLabels = [['8 EMA', s.e8.at(-1), C.e8], ['21 EMA', s.e21.at(-1), C.e21], ['50-day', s.s50.at(-1), C.s50]]
    .filter(([, v]) => v != null).map(([t, v, c]) => ({ t, c, yy: y(v) })).sort((p, q) => p.yy - q.yy);
  for (let i = 1; i < endLabels.length; i++) if (endLabels[i].yy - endLabels[i - 1].yy < 11) endLabels[i].yy = endLabels[i - 1].yy + 11;

  const svgRef = useRef(null);
  const [hov, setHov] = useState(null);
  const onMove = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round((px - pad.l) / ((W - pad.l - pad.r) / data.length) - 0.5);
    setHov(i >= 0 && i < data.length ? i : null);
  };
  const hb = hov != null ? data[hov] : null;

  return (
    <div className="mb-5 rounded-md border border-neutral-800 bg-neutral-950/40 p-2">
      <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11px] text-neutral-400">
        {[['8 EMA', C.e8], ['21 EMA', C.e21], ['50-day avg', C.s50]].map(([t, c]) => (
          <span key={t} className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: c }} />{t}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t border-dashed" style={{ borderColor: C.ref }} />levels</span>
      </div>
      <div className="relative">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full touch-none" role="img"
          aria-label={`Daily candles for the last ${data.length} sessions with 8 and 21 EMA and 50-day average`}
          onPointerMove={onMove} onPointerLeave={() => setHov(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={C.grid} strokeWidth="1" />
              {!endLabels.some((l) => Math.abs(l.yy - y(t)) < 11) && (
                <text x={W - pad.r + 6} y={y(t) + 3} fontSize="10" fill="#737373" fontFamily="ui-monospace,monospace">{t.toFixed(t < 10 ? 2 : 0)}</text>
              )}
            </g>
          ))}
          {months.map((p) => (
            <text key={p.d} x={x(p.i)} y={H - 6} fontSize="10" fill="#737373">
              {new Date(`${p.d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}
            </text>
          ))}
          {refs.map((r) => (
            <g key={r.label}>
              <line x1={pad.l} x2={W - pad.r} y1={y(r.y)} y2={y(r.y)} stroke={C.ref} strokeWidth="1" strokeDasharray="4 4" />
              <text x={pad.l + 4} y={y(r.y) - 3} fontSize="10" fill="#a3a3a3" stroke="#0a0a0a" strokeWidth="3" paintOrder="stroke">{r.label} {fmt(r.y)}</text>
            </g>
          ))}
          {data.map((b, i) => {
            const up = b.c >= b.o;
            const col = up ? C.up : C.down;
            return (
              <g key={b.d} opacity={hov == null || hov === i ? 1 : 0.75}>
                <line x1={x(i)} x2={x(i)} y1={y(b.h)} y2={y(b.l)} stroke={col} strokeWidth="1" />
                <rect x={x(i) - bw / 2} width={bw} y={y(Math.max(b.o, b.c))} height={Math.max(1, Math.abs(y(b.o) - y(b.c)))}
                  fill={up ? 'none' : col} stroke={col} strokeWidth="1" rx="0.5" />
              </g>
            );
          })}
          <path d={`M${path(s.s50)}`} fill="none" stroke={C.s50} strokeWidth="2" strokeLinejoin="round" />
          <path d={`M${path(s.e21)}`} fill="none" stroke={C.e21} strokeWidth="2" strokeLinejoin="round" />
          <path d={`M${path(s.e8)}`} fill="none" stroke={C.e8} strokeWidth="2" strokeLinejoin="round" />
          {endLabels.map((l) => <text key={l.t} x={W - pad.r + 6} y={l.yy + 3} fontSize="10" fill="#d4d4d4">{l.t}</text>)}
          {hov != null && <line x1={x(hov)} x2={x(hov)} y1={pad.t} y2={H - pad.b} stroke="#a3a3a3" strokeWidth="1" />}
        </svg>
        {hb && (
          <div className="pointer-events-none absolute top-2 rounded border border-neutral-700 bg-neutral-950/95 px-2.5 py-1.5 font-mono text-[11px] tabular-nums shadow-lg"
            style={{ left: `${Math.min(70, Math.max(2, (x(hov) / W) * 100 - (hov > data.length / 2 ? 28 : -2)))}%` }}>
            <div className="text-neutral-400">{hb.d}</div>
            <div className="text-neutral-100">O {fmt(hb.o)} H {fmt(hb.h)} L {fmt(hb.l)} C {fmt(hb.c)}</div>
            {[['8 EMA', s.e8[hov], C.e8], ['21 EMA', s.e21[hov], C.e21], ['50-day', s.s50[hov], C.s50]].map(([t, v, c]) => v != null && (
              <div key={t} className="flex items-center gap-1.5"><span className="h-0.5 w-3" style={{ background: c }} /><span className="text-neutral-100">{fmt(v)}</span><span className="text-neutral-500">{t}</span></div>
            ))}
            <div className="text-neutral-500">vol {(hb.v / 1e6).toFixed(2)}M</div>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ title, rows, note }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/40">
      <div className="border-b border-neutral-900 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-neutral-400">{title}</div>
      <div className="divide-y divide-neutral-900">
        {rows.filter(Boolean).map(([k, v, sub]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-[12px]">
            <span className="text-neutral-500">{k}</span>
            <span className="text-right font-mono tabular-nums text-neutral-100">{v}{sub != null && <span className="ml-1.5 text-[11px]">{sub}</span>}</span>
          </div>
        ))}
      </div>
      {note && <div className="border-t border-neutral-900 px-3 py-1.5 text-[11px] text-neutral-600">{note}</div>}
    </div>
  );
}

const d = (v) => <span className={tone(v)}>{sgn(v)}</span>;
const PD = { gap_above: 'Pre-market: above PDH', gap_below: 'Pre-market: below PDL', inside_open: 'Pre-market: inside', breakout: 'Breakout', breakdown: 'Breakdown', failed_breakout: 'Failed breakout', reclaim: 'Reclaim', outside_day: 'Outside day', inside_day: 'Inside day' };

function Stats({ a }) {
  const trend = { up: '▲ up', down: '▼ down', mixed: '~ mixed' }[a.trend] || '—';
  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Card title="Moving averages" rows={[
        ['8/21 trend', trend],
        ['8 EMA', fmt(a.ema8), d(a.dist8)], ['21 EMA', fmt(a.ema21), d(a.dist21)],
        ['21 EMA slope (5d)', d(a.ema21Slope)],
        ['50-day avg', fmt(a.sma50), d(a.dist50)],
        ['200-day avg', a.sma200 != null ? fmt(a.sma200) : 'n/a', a.sma200 != null ? d(a.dist200) : null],
        a.golden != null && ['50 vs 200', a.golden ? 'above (golden)' : 'below (death)'],
      ]} note={a.shortHistory ? 'Under 200 days of data — 200-day average unavailable.' : '% = price vs each average.'} />
      <Card title="Range" rows={[
        ['52-week high', fmt(a.hi52), d(a.from52h)], ['   set on', a.hi52d],
        ['52-week low', fmt(a.lo52), d(a.from52l)],
        ['Position in 52w range', a.rangePos52 != null ? `${a.rangePos52}%` : '—'],
        [`${a.lookbackN}-day high`, fmt(a.nHigh), d(a.fromNHigh)], [`${a.lookbackN}-day low`, fmt(a.nLow), d(a.fromNLow)],
      ]} note={`N-day = the ${a.lookbackN} sessions before the latest bar. Change N above the chart.`} />
      <Card title="Yesterday's range" rows={[
        ['PDH', fmt(a.pdh)], ['PDL', fmt(a.pdl)],
        ['Latest bar', `${fmt(a.dayL)} – ${fmt(a.dayH)}`],
        ['What it did', PD[a.pdEvent] || '—'],
        ['Pullback to EMA', a.pullback ? `tagged the ${a.pullback} EMA, held` : 'no'],
      ]} />
      <Card title="Volatility" rows={[
        ['ATR (14)', fmt(a.atr), <span key="p" className="text-neutral-500">{fmt(a.atrPct)}%</span>],
        ['Avg daily range (20d)', `${fmt(a.adr)}%`],
        ['From 21 EMA', a.ext21Atr != null ? `${fmt(a.ext21Atr, 1)} ATR` : '—'],
      ]} note="ATR = typical daily move in $. >3 ATR above the 21 EMA = extended." />
      <Card title="Momentum & volume" rows={[
        ['RSI (14)', fmt(a.rsi, 1)],
        ['Higher highs/lows streak', a.streak > 0 ? `${a.streak} up` : a.streak < 0 ? `${-a.streak} down` : 'none'],
        ['Volume vs 20d avg', a.rvol != null ? `${fmt(a.rvol)}x` : '—'],
        ['Up/down volume (20d)', a.upDownVol != null ? `${fmt(a.upDownVol)}` : '—'],
      ]} note="Intraday, today's volume is partial — the ratio climbs through the day. Up/down >1 = more volume on up days." />
      <Card title="Vs SPY" rows={a.rel ? [
        ['Phase', a.rel.phase || '—'],
        ['5 days', <span key="5" className={tone(a.rel.rs5)}>{a.rel.rs5 > 0 ? '+' : ''}{fmt(a.rel.rs5)} pts</span>],
        ['20 days', <span key="20" className={tone(a.rel.rs20)}>{a.rel.rs20 > 0 ? '+' : ''}{fmt(a.rel.rs20)} pts</span>],
        ['60 days', <span key="60" className={tone(a.rel.rs60)}>{a.rel.rs60 > 0 ? '+' : ''}{fmt(a.rel.rs60)} pts</span>],
      ] : [['SPY data', 'unavailable']]} note="Stock % minus SPY % — same phase rule as Sector Pulse." />
      <Card title="Swing levels (last ~90 days)" rows={[
        ['Nearest resistance', a.resistance ? fmt(a.resistance.p) : 'none above', a.resistance ? <span key="r" className="text-neutral-500">{a.resistance.d.slice(5)}</span> : null],
        ['Nearest support', a.support ? fmt(a.support.p) : 'none below', a.support ? <span key="s" className="text-neutral-500">{a.support.d.slice(5)}</span> : null],
        ['Recent swing highs', a.swingHighs.map((x) => fmt(x.p)).join(' · ') || '—'],
        ['Recent swing lows', a.swingLows.map((x) => fmt(x.p)).join(' · ') || '—'],
      ]} note="Swing = a high/low with 3 lower highs / higher lows on each side." />
    </div>
  );
}

function Context({ sym, a, ctx }) {
  const today = todayET();
  const snap = ctx?.snap;
  let member = null; let group = null;
  for (const g of snap?.groups || []) {
    const m = (g.members || []).find((x) => x.ticker === sym);
    if (m) { member = m; group = g; break; }
  }
  const setups = snap?.setups || {};
  const rank = (setups.all || []).findIndex((r) => r.ticker === sym);
  const setup = rank >= 0 ? setups.all[rank] : null;
  const cats = (ctx?.catalysts || []).filter((c) => (c.tickers || []).includes(sym) && (daysUntil(c.event_end || c.event_start, today) ?? 0) >= 0);
  const stop = a.support && a.support.p < a.price ? a.support.p : a.ema21 < a.price ? a.ema21 : null;
  const logQ = new URLSearchParams({ ticker: sym, price: String(a.price), ...(stop ? { stop: String(stop) } : {}) });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2.5 text-[12px]">
        <div className="mb-1.5 text-[11px] uppercase tracking-[0.16em] text-neutral-400">In your system</div>
        {!snap && <div className="text-neutral-600">No Sector Pulse snapshot loaded.</div>}
        {snap && !member && !setup && <div className="text-neutral-500">Not in your pulse groups or today's qualified setups.</div>}
        {group && <div className="text-neutral-300">In <Link to="/sectors" className="text-emerald-300 hover:underline">{group.name}</Link> · {member.quadrant} vs SPY</div>}
        {setup && (
          <div className="mt-1 text-neutral-300">
            Qualified setup #{rank + 1} · {setup.score}/100 · {setup.entry_type === 'retest' ? 'retest' : 'break only'} · invalid below {setup.invalid_below}
          </div>
        )}
        {cats.map((c) => (
          <div key={c.id} className="mt-1 text-amber-200/90">⚡ {c.headline} <span className="text-neutral-500">({whenLabel(c, today)})</span></div>
        ))}
        {(ctx?.trades || []).map((t) => (
          <div key={t.id} className="mt-1 text-sky-300">Open trade: {t.quantity} @ {t.entry_price}{t.stop_loss != null ? `, stop ${t.stop_loss}` : ''}</div>
        ))}
      </div>
      <div className="flex flex-col justify-between gap-2 rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2.5 text-[12px]">
        <div className="text-neutral-500">
          Planning a trade? Log trade pre-fills the price{stop ? <> and a stop at <span className="font-mono text-neutral-300">{fmt(stop)}</span> ({a.support && a.support.p === stop ? 'nearest swing low' : '21 EMA'}) — change it if your level is different.</> : '.'}
        </div>
        <Link to={`/journal?${logQ}`} className="self-start rounded border border-neutral-700 px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-neutral-300 hover:border-emerald-500/40 hover:text-emerald-300">Log trade</Link>
      </div>
    </div>
  );
}
