import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Crosshair, X, Plus, AlertCircle, RefreshCw } from 'lucide-react';
import { undercut } from '../../lib/undercut';
import { supabase, authReady } from '../../lib/supabase';
import HelpLink from '../../components/HelpLink';

// Your focus list: up to 9 names you pick, tracked intraday for the "Undercut ✓" pattern (bot: focus.py).
// The list lives in Supabase focus_picks; each pulse writes every name's state into market_pulse.focus.

const MAX = 9;
const PRICES_FROM = 8 * 60;        // live quotes from 8:00 ET on weekdays (pre-market mid, then last trade)
const PRICES_UNTIL = 20 * 60;
const UNDERCUT_FROM = 9 * 60 + 30;
const RATES = [['off', 'Off'], ['60', '1 min'], ['15', '15 s']];
const RATE_KEY = 'focus.refresh';
function readRate() {
  try { const v = window.localStorage.getItem(RATE_KEY); return RATES.some(([k]) => k === v) ? v : '60'; } catch { return '60'; }
}

// Weekday and minutes since midnight in New York.
function etClock(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const get = (t) => parts.find((x) => x.type === t)?.value;
  return { weekday: !['Sat', 'Sun'].includes(get('weekday')), mins: Number(get('hour')) * 60 + Number(get('minute')) };
}
const pctText = (v) => (v == null ? '' : `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}%`);
const pctTone = (v) => (v == null ? 'text-neutral-500' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-neutral-400');
const STATUS = {
  undercut_ok: { label: 'Undercut ✓', cls: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' },
  watching: { label: 'Watching', cls: 'border-sky-500/40 bg-sky-500/10 text-sky-300' },
  forming: { label: 'Opening range', cls: 'border-neutral-700 bg-neutral-800/40 text-neutral-300' },
  held_open: { label: 'Held the open', cls: 'border-neutral-700 bg-neutral-800/40 text-neutral-300' },
  broke_low: { label: 'Broke morning low', cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300' },
  failed: { label: 'Lost the low', cls: 'border-rose-500/50 bg-rose-500/10 text-rose-300' },
  no_data: { label: 'No bars', cls: 'border-neutral-800 text-neutral-500' },
};

function explain(f) {
  switch (f.status) {
    case 'undercut_ok': return `Reclaimed ${f.reclaim_level} at ${f.reclaim_at}${f.reclaim_vol_x ? ` on ${f.reclaim_vol_x}x volume` : ''}. Invalidation: the morning low.`;
    case 'watching': return 'Flushed below the open; waiting for a close above the open or VWAP on rising volume.';
    case 'forming': return `Inside the first ${f.or_minutes || 30} minutes — the morning low isn’t set yet.`;
    case 'held_open': return 'Never traded below the open in the opening range — no undercut today.';
    case 'broke_low': return `Took out the morning low at ${f.broke_at} before reclaiming — no setup.`;
    case 'failed': return `Reclaimed at ${f.reclaim_at}, then lost the morning low at ${f.failed_at} — invalidated.`;
    default: return f.error ? `No 15-min bars (${f.error}).` : 'No 15-min bars yet.';
  }
}

export default function FocusList({ focus, session }) {
  const [picks, setPicks] = useState({ loaded: false, rows: [], error: null });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(() => etClock());
  const [quotes, setQuotes] = useState({});

  const load = useCallback(async () => {
    try {
      await authReady();
      const { data, error } = await supabase.from('focus_picks').select('id,ticker,note').eq('active', true).order('created_at');
      if (error) throw error;
      setPicks({ loaded: true, rows: data || [], error: null });
    } catch (e) {
      setPicks({ loaded: true, rows: [], error: /focus_picks/.test(e.message || '') ? 'Run migrations/015_focus.sql in Supabase to turn on the focus list.' : e.message });
    }
  }, []);
  useEffect(() => {
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [load]);

  const add = async (e) => {
    e.preventDefault();
    const tickers = input.toUpperCase().split(/[\s,]+/).map((t) => t.replace(/^\$/, '')).filter((t) => /^[A-Z.]{1,6}$/.test(t));
    const fresh = tickers.filter((t) => !picks.rows.some((r) => r.ticker === t)).slice(0, MAX - picks.rows.length);
    if (!fresh.length) return;
    setBusy(true);
    try {
      for (const t of fresh) {
        const { error } = await supabase.from('focus_picks').upsert({ ticker: t, active: true }, { onConflict: 'ticker' });
        if (error) throw error;
      }
      setInput('');
      await load();
    } catch (err) {
      setPicks((p) => ({ ...p, error: err.message }));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    setBusy(true);
    try {
      const { error } = await supabase.from('focus_picks').update({ active: false }).eq('id', id);
      if (error) throw error;
      await load();
    } catch (err) {
      setPicks((p) => ({ ...p, error: err.message }));
    } finally {
      setBusy(false);
    }
  };

  // Live quotes (8:00–20:00 ET) and today's 15-min bars (9:30–16:15 ET) on weekdays, at the chosen rate.
  // The Undercut status is computed here from the bars (same rule as the bot), so it doesn't wait for the
  // 15-minute pulse; the pulse's value is the fallback.
  const tickerKey = picks.rows.map((r) => r.ticker).sort().join(',');
  const live = clock.weekday && clock.mins >= PRICES_FROM && clock.mins < PRICES_UNTIL;
  const beforeOpen = clock.mins < UNDERCUT_FROM;   // before 9:30 the latest 15-min bars are yesterday's
  const [rate, setRateState] = useState(readRate);
  const [calc, setCalc] = useState({});
  const [updatedAt, setUpdatedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const setRate = (v) => {
    setRateState(v);
    try { window.localStorage.setItem(RATE_KEY, v); } catch { /* ignore */ }
  };
  useEffect(() => {
    const id = setInterval(() => setClock(etClock()), 30000);
    return () => clearInterval(id);
  }, []);
  const refresh = useCallback(async (withBars) => {
    if (!tickerKey) return;
    setRefreshing(true);
    try {
      const [q, b] = await Promise.all([
        fetch(`/api/quotes?symbols=${tickerKey}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        withBars ? fetch(`/api/intraday?symbols=${tickerKey}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null,
      ]);
      if (q) setQuotes(q);
      if (b) {
        const next = {};
        for (const [t, v] of Object.entries(b)) {
          const bars = Array.isArray(v) ? v : v?.bars;
          let row = {};
          if (withBars === 'today') {
            // regular hours: today's bars -> Undercut; the session before -> PDH / PDL
            if (bars?.length) row = undercut(bars);
            if (v?.prev) Object.assign(row, { pdh: v.prev.h, pdl: v.prev.l });
          } else if (bars?.length) {
            // before the open: the latest bars ARE the previous session -> PDH / PDL only
            row = { pdh: Math.max(...bars.map((x) => x.h)), pdl: Math.min(...bars.map((x) => x.l)) };
          }
          if (Object.keys(row).length) next[t] = row;
        }
        setCalc(next);
      }
      setUpdatedAt(new Date());
    } finally {
      setRefreshing(false);
    }
  }, [tickerKey]);
  useEffect(() => {
    if (!tickerKey || !live) return undefined;
    const mode = beforeOpen ? 'prev' : 'today';
    const first = setTimeout(() => refresh(mode), 0);
    if (rate === 'off') return () => clearTimeout(first);
    const id = setInterval(() => refresh(mode), Number(rate) * 1000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [tickerKey, live, beforeOpen, rate, refresh]);
  const preOpen = clock.weekday && clock.mins >= PRICES_FROM && clock.mins < UNDERCUT_FROM;

  const byTicker = new Map((focus || []).map((f) => [f.ticker, { ...f, ...(calc[f.ticker] || {}) }]));
  for (const [t, c] of Object.entries(calc)) if (!byTicker.has(t)) byTicker.set(t, { ticker: t, ...c });
  const full = picks.rows.length >= MAX;

  return (
    <section className="mb-5 rounded-md border border-neutral-800 bg-neutral-950/50">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-neutral-400">
          <Crosshair className="h-3.5 w-3.5 text-emerald-400" strokeWidth={1.75} /> Focus list
          <span className="font-mono normal-case tracking-normal text-neutral-500">{picks.rows.length}/{MAX}</span>
          <HelpLink to="focus" />
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-neutral-500">
          <span className="flex rounded border border-neutral-800 p-0.5" role="group" aria-label="Auto refresh">
            {RATES.map(([k, l]) => (
              <button key={k} type="button" onClick={() => setRate(k)} aria-pressed={rate === k}
                className={`rounded px-1.5 py-0.5 ${rate === k ? 'bg-emerald-500/15 text-emerald-300' : 'text-neutral-500 hover:text-neutral-300'}`}>{l}</button>
            ))}
          </span>
          <button type="button" onClick={() => refresh(beforeOpen ? 'prev' : 'today')} disabled={refreshing || !tickerKey}
            aria-label="Refresh now" title="Refresh now" className="rounded border border-neutral-800 p-1 hover:text-emerald-300 disabled:opacity-40">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          {updatedAt && <span className="font-mono tabular-nums">{updatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>}
        </span>
        <form onSubmit={add} className="flex items-center gap-1.5">
          <input value={input} onChange={(e) => setInput(e.target.value)} disabled={busy || full || !!picks.error && !picks.rows.length && /migration/.test(picks.error)}
            placeholder={full ? 'List full (9)' : 'Add tickers, e.g. NVDA MU'} aria-label="Add focus tickers"
            className="w-40 rounded border border-neutral-800 bg-transparent px-2 py-1 font-mono text-[12px] uppercase text-neutral-100 placeholder:normal-case placeholder:text-neutral-600 focus:border-emerald-500/50 focus:outline-none sm:w-52" />
          <button type="submit" disabled={busy || full || !input.trim()}
            className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[12px] text-emerald-200 disabled:opacity-40">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </form>
      </div>
      {picks.error && (
        <div className="mx-3 mb-2 flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-[12px] text-amber-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {picks.error}
        </div>
      )}
      {picks.loaded && picks.rows.length === 0 && !picks.error && (
        <div className="border-t border-neutral-900 px-3 py-2.5 text-[12px] text-neutral-600">
          Add 7–9 names you’re watching. During market hours each one shows its opening print, morning low (first 30 min), VWAP, and an “Undercut ✓” tag when it reclaims the open or VWAP on rising volume.
        </div>
      )}
      {picks.rows.length > 0 && (
        <div className="grid gap-px border-t border-neutral-900 bg-neutral-900 sm:grid-cols-2 lg:grid-cols-3">
          {picks.rows.map((p) => {
            const f = byTicker.get(p.ticker);
            const st = f?.status ? STATUS[f.status] || STATUS.no_data : null;
            const q = quotes[p.ticker];
            const px = q?.price ?? f?.price;
            const sessTag = q?.session === 'premarket' ? 'pre' : q?.session === 'afterhours' ? 'after hrs' : null;
            return (
              <div key={p.id} className={`bg-[#0b0b0b] px-3 py-2.5 ${f?.status === 'undercut_ok' ? 'ring-1 ring-inset ring-emerald-500/30' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-baseline gap-2">
                    <Link to={`/lookup/${p.ticker}`} className="font-mono text-[14px] font-semibold text-neutral-100 hover:text-emerald-300">{p.ticker}</Link>
                    {px != null && <span className="font-mono text-[12px] tabular-nums text-neutral-300">{Number(px).toFixed(2)}</span>}
                    {q?.changePct != null && <span className={`font-mono text-[11px] tabular-nums ${pctTone(q.changePct)}`}>{pctText(q.changePct)}</span>}
                    {sessTag && <span className="text-[10px] uppercase tracking-wider text-neutral-600">{sessTag}</span>}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {st && <span className={`rounded border px-1.5 py-0.5 text-[10px] ${st.cls}`}>{st.label}</span>}
                    <button type="button" onClick={() => remove(p.id)} disabled={busy} aria-label={`Remove ${p.ticker}`}
                      className="rounded p-0.5 text-neutral-600 hover:text-rose-300"><X className="h-3.5 w-3.5" /></button>
                  </span>
                </div>
                {f?.pdh != null && f?.pdl != null && (
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-3 font-mono text-[11px] tabular-nums">
                    <span><span className="text-neutral-600">PDH</span> <span className="text-neutral-300">{Number(f.pdh).toFixed(2)}</span></span>
                    <span><span className="text-neutral-600">PDL</span> <span className="text-neutral-300">{Number(f.pdl).toFixed(2)}</span></span>
                    {px != null && (
                      <span className={`font-sans text-[10px] ${px > f.pdh ? 'text-emerald-300' : px < f.pdl ? 'text-rose-300' : 'text-neutral-500'}`}>
                        {px > f.pdh ? 'above PDH' : px < f.pdl ? 'below PDL' : 'inside yesterday’s range'}
                      </span>
                    )}
                  </div>
                )}
                {f && f.status && f.status !== 'no_data' ? (
                  <>
                    <div className="mt-1 grid grid-cols-3 gap-1 font-mono text-[11px] tabular-nums">
                      <span><span className="text-neutral-600">open</span> <span className="text-neutral-300">{f.open}</span></span>
                      <span><span className="text-neutral-600">low</span> <span className="text-rose-300">{f.morning_low}</span></span>
                      <span><span className="text-neutral-600">vwap</span> <span className="text-neutral-300">{f.vwap ?? '—'}</span></span>
                    </div>
                    <div className="mt-1 text-[11px] leading-snug text-neutral-500">{explain(f)}</div>
                    {f.status === 'undercut_ok' && f.risk_pct != null && (
                      <div className="mt-0.5 text-[11px] text-neutral-400">Stop under {f.morning_low} = {f.risk_pct}% from price.</div>
                    )}
                  </>
                ) : (
                  <div className="mt-1 text-[11px] text-neutral-600">
                    {(session === 'regular' || session === 'afterhours') && f?.status ? explain(f)
                      : preOpen ? 'Pre-market price, vs yesterday’s close. Undercut tracking starts at 9:30 ET.'
                        : 'Prices from 8:00 ET on weekdays; Undercut tracking from 9:30.'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
