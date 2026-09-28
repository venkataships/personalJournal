import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, AlertCircle, AlertTriangle, BookText, Check, ChevronDown, ChevronUp, Plus, Radar,
  RefreshCw, Settings, ShieldAlert, X,
} from 'lucide-react';
import { supabase, authReady } from '../../lib/supabase';
import { usePortfolio } from '../../hooks/usePortfolio';
import {
  SETUPS, MISTAKES, STATES, DEFAULT_LIMITS, setupLabel, mistakeLabel, positionValue, computePnl,
  riskAmount, rMultiple, closeStatus, positionCap, tradeValue, isClosed, riskCheck, pulseContext,
  journalStats, usd, signedUsd, todayET, daysAgoET, CHECKLIST, prefillChecklist, checklistScore,
} from '../../lib/journal';

// Log every trade (here or /log in Telegram), close it, review it. Risk rules
// are checked at log time; breaking one needs a reason, which is kept.

const input = 'w-full rounded border border-neutral-800 bg-transparent px-2.5 py-2 text-[13px] text-neutral-100 placeholder:text-neutral-700 focus:border-emerald-500/50 focus:outline-none';
const label = 'mb-1 block text-[10px] uppercase tracking-[0.16em] text-neutral-500';

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
}
const pnlClass = (v) => (v == null ? 'text-neutral-500' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-neutral-400');
const daysSince = (iso) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000)) : null);
const needsReason = (f) => !f.reason || f.reason.startsWith('(logged from Telegram');

// Insert/update that still works before migration 007 (checklist column) is run.
async function writeTrade(row, id) {
  const run = (r) => (id ? supabase.from('trade_journal').update(r).eq('id', id) : supabase.from('trade_journal').insert(r));
  let { error } = await run(row);
  if (error && 'checklist' in row && /checklist/i.test(error.message || '')) {
    const rest = { ...row };
    delete rest.checklist;
    ({ error } = await run(rest));
    if (!error) return 'Saved without the checklist — run migration 007_journal_checklist.sql in Supabase.';
  }
  if (error) throw error;
  return null;
}

async function fetchQuotes(tickers) {
  const out = new Map();
  const uniq = [...new Set(tickers)];
  for (let i = 0; i < uniq.length; i += 50) {
    try {
      const res = await fetch(`/api/quotes?symbols=${uniq.slice(i, i + 50).join(',')}`);
      if (!res.ok) continue;
      const data = await res.json();
      for (const [s, q] of Object.entries(data)) if (q?.price != null) out.set(s.toUpperCase(), q.price);
    } catch { /* live prices are optional */ }
  }
  return out;
}

// ---------------------------------------------------------------------------

export default function Journal() {
  const portfolio = usePortfolio();
  const [params] = useSearchParams();
  const [state, setState] = useState({ loading: true, error: null, trades: [], limits: DEFAULT_LIMITS, snapshot: null });
  const [quotes, setQuotes] = useState(new Map());
  const [toast, setToast] = useState(null);
  const [showForm, setShowForm] = useState(() => params.has('ticker'));

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      await authReady();
      const [tr, lim, snap] = await Promise.all([
        supabase.from('trade_journal').select('*').order('date', { ascending: false }).limit(500),
        supabase.from('risk_limits').select('*').eq('id', 1).maybeSingle(),
        supabase.from('market_pulse').select('as_of, session, groups, setups, risk').order('as_of', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (tr.error) throw tr.error;
      setState({
        loading: false, error: null, trades: tr.data || [],
        limits: lim.data ? { ...DEFAULT_LIMITS, ...lim.data } : DEFAULT_LIMITS,
        limitsMissing: !!lim.error,
        // market gate is stored in market_pulse.risk
        snapshot: snap.data ? { ...snap.data, market: snap.data.risk?.state !== undefined ? snap.data.risk : null } : null,
      });
      const openStocks = (tr.data || []).filter((t) => t.status === 'open' && (t.instrument || 'stock') === 'stock').map((t) => t.ticker);
      if (openStocks.length) fetchQuotes(openStocks).then(setQuotes);
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e.message || 'Failed to load the journal.' }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 4000); };
  const after = async (msg) => { flash(msg); await load(); portfolio.refresh(); };

  const { trades, limits, snapshot } = state;
  const acct = portfolio.loading ? null : portfolio.value;
  const today = todayET();
  const open = useMemo(() => trades.filter((t) => t.status === 'open'), [trades]);
  const closed = useMemo(() => trades.filter(isClosed).sort((a, b) => (b.exit_date || b.date || '').localeCompare(a.exit_date || a.date || '')), [trades]);
  const closedToday = useMemo(() => closed.filter((t) => t.exit_date === today), [closed, today]);
  const realizedToday = closedToday.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
  const optionsOpen = open.filter((t) => t.instrument === 'option').reduce((s, t) => s + tradeValue(t), 0);
  const cap = positionCap(limits, acct);
  const halted = realizedToday <= -Number(limits.max_daily_loss_usd);

  const attention = useMemo(() => {
    const items = [];
    const noStop = open.filter((t) => t.stop_loss == null).length;
    const noWhy = open.filter((t) => !(t.thesis || '').trim()).length;
    const reasons = open.filter((t) => (t.risk_flags || []).some(needsReason)).length;
    const review = closed.filter((t) => t.followed_plan == null).length;
    if (noStop) items.push(`${noStop} open trade${noStop > 1 ? 's' : ''} without a stop`);
    if (reasons) items.push(`${reasons} trade${reasons > 1 ? 's' : ''} with rule breaks need${reasons > 1 ? '' : 's'} a reason`);
    if (noWhy) items.push(`${noWhy} open trade${noWhy > 1 ? 's' : ''} missing the why`);
    if (review) items.push(`${review} closed trade${review > 1 ? 's' : ''} to review`);
    return items;
  }, [open, closed]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 font-sans antialiased selection:bg-emerald-500/30">
      <div className="relative mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
        <header className="mb-6">
          <Link to="/trading" className="mb-3 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] text-neutral-500 hover:text-emerald-400">
            <ArrowLeft className="h-3 w-3" strokeWidth={2} /> Trading
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2.5 text-3xl font-light tracking-tight text-neutral-100">
                <BookText className="h-7 w-7 text-emerald-400" strokeWidth={1.5} /> Journal
              </h1>
              <p className="mt-1 text-[13px] text-neutral-500">Log every trade. Close it. Review it. The numbers keep you honest.</p>
            </div>
            <div className="flex items-center gap-2">
              <Link to="/sectors" className="inline-flex items-center gap-1.5 rounded border border-neutral-800 px-3 py-2 text-[12px] text-neutral-400 hover:border-emerald-500/40 hover:text-emerald-300">
                <Radar className="h-3.5 w-3.5" /> Sector Pulse
              </Link>
              <button onClick={load} aria-label="Refresh" className="rounded border border-neutral-800 p-2 text-neutral-400 hover:text-emerald-400">
                <RefreshCw className={`h-4 w-4 ${state.loading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
              </button>
            </div>
          </div>
          {state.error && <Banner tone="error">{state.error.includes('column') ? `${state.error} — run migrations/006_journal_revamp.sql in Supabase.` : state.error}</Banner>}
          {state.limitsMissing && <Banner tone="warn">Using default limits — run migrations/006_journal_revamp.sql to save your own.</Banner>}
          {halted && (
            <Banner tone="halt">
              Daily stop hit: {signedUsd(realizedToday)} realized today against a {usd(Number(limits.max_daily_loss_usd))} limit.
              Stop trading for today. Anything you log now is recorded as a rule break.
            </Banner>
          )}
          {toast && <Banner tone="ok">{toast}</Banner>}
        </header>

        <RiskStrip
          acct={acct} cap={cap} limits={limits} realizedToday={realizedToday}
          optionsOpen={optionsOpen} openCount={open.length}
        />

        {attention.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" /> Needs you:
            {attention.map((a) => <span key={a} className="rounded border border-amber-500/30 px-1.5 py-0.5">{a}</span>)}
          </div>
        )}

        <section className="mb-6">
          {!showForm ? (
            <button onClick={() => setShowForm(true)}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-5 py-3.5 text-[13px] font-medium uppercase tracking-[0.15em] text-emerald-200 hover:bg-emerald-500/15">
              <Plus className="h-4 w-4" strokeWidth={2.5} /> Log a trade
            </button>
          ) : (
            <LogForm
              params={params} limits={limits} acct={acct} open={open} closedToday={closedToday}
              snapshot={snapshot} onCancel={() => setShowForm(false)}
              onSaved={(msg) => { setShowForm(false); after(msg); }}
            />
          )}
          <p className="mt-2 text-center text-[11px] text-neutral-600">
            Or from Telegram: <span className="font-mono">/log buy NVDA 20 @ 224.5 stop 219 pdh why …</span> · <span className="font-mono">/close NVDA @ 231</span>
          </p>
        </section>

        <OpenTrades trades={open} quotes={quotes} onDone={after} />
        <ClosedTrades trades={closed} onDone={after} />
        <Stats trades={trades} />
        <LimitsEditor limits={limits} acct={acct} portfolio={portfolio} onSaved={after} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Banner({ tone, children }) {
  const cls = {
    error: 'border-rose-500/30 bg-rose-500/5 text-rose-300',
    halt: 'border-rose-500/60 bg-rose-500/15 text-rose-100 font-medium',
    warn: 'border-amber-500/30 bg-amber-500/5 text-amber-200',
    ok: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200',
  }[tone];
  const Icon = tone === 'ok' ? Check : tone === 'halt' ? ShieldAlert : AlertCircle;
  return (
    <div className={`mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] ${cls}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} /><span>{children}</span>
    </div>
  );
}

function Meter({ value, max, tone }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const color = tone === 'bad' ? 'bg-rose-500' : pct >= 90 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-900" aria-hidden>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function RiskStrip({ acct, cap, limits, realizedToday, optionsOpen, openCount }) {
  const maxLoss = Number(limits.max_daily_loss_usd);
  const maxOpt = Number(limits.max_options_usd);
  const lossUsed = Math.max(0, -realizedToday);
  const tile = 'rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-3';
  return (
    <section className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
      <div className={tile}>
        <div className={label}>Today realized</div>
        <div className={`font-mono text-lg tabular-nums ${pnlClass(realizedToday)}`}>{signedUsd(realizedToday)}</div>
        <div className="font-mono text-[10px] text-neutral-600">stop at -{usd(maxLoss)} · {usd(Math.max(0, maxLoss - lossUsed))} left</div>
        <Meter value={lossUsed} max={maxLoss} tone={lossUsed >= maxLoss ? 'bad' : undefined} />
      </div>
      <div className={tile}>
        <div className={label}>Options open</div>
        <div className="font-mono text-lg tabular-nums text-neutral-100">{usd(optionsOpen)}</div>
        <div className="font-mono text-[10px] text-neutral-600">of {usd(maxOpt)} · {usd(Math.max(0, maxOpt - optionsOpen))} left</div>
        <Meter value={optionsOpen} max={maxOpt} tone={optionsOpen > maxOpt ? 'bad' : undefined} />
      </div>
      <div className={tile}>
        <div className={label}>Per-ticker cap</div>
        <div className="font-mono text-lg tabular-nums text-neutral-100">{usd(cap)}</div>
        <div className="font-mono text-[10px] text-neutral-600">{usd(Number(limits.max_position_usd))} or {limits.max_position_pct}% of account</div>
      </div>
      <div className={tile}>
        <div className={label}>Account (journal)</div>
        <div className="font-mono text-lg tabular-nums text-neutral-100">{acct == null ? '—' : usd(acct)}</div>
        <div className="font-mono text-[10px] text-neutral-600">{openCount} open trade{openCount === 1 ? '' : 's'}</div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Log form
// ---------------------------------------------------------------------------

function Toggle({ value, options, onChange }) {
  return (
    <div className="flex rounded border border-neutral-800 p-0.5">
      {options.map(([id, lbl]) => (
        <button key={id} type="button" onClick={() => onChange(id)}
          className={`flex-1 rounded px-3 py-1.5 text-[12px] transition-colors ${value === id ? 'bg-emerald-500/15 text-emerald-200' : 'text-neutral-500 hover:text-neutral-300'}`}>
          {lbl}
        </button>
      ))}
    </div>
  );
}

function Chips({ options, value, onChange, multi }) {
  const on = (id) => (multi ? (value || []).includes(id) : value === id);
  const click = (id) => {
    if (!multi) return onChange(value === id ? null : id);
    const cur = value || [];
    onChange(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => click(o.id)}
          className={`rounded border px-2 py-1 text-[11px] transition-colors ${on(o.id) ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200' : 'border-neutral-800 text-neutral-400 hover:border-neutral-600'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PulseRead({ ctx }) {
  if (!ctx) return <div className="text-[12px] text-neutral-600">No Sector Pulse snapshot yet.</div>;
  if (!ctx.top_setup && !ctx.phase && !ctx.qualified) return <div className="text-[12px] text-neutral-500">Not in your pulse groups or today’s Top Setups — this one is your own call.</div>;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
      {ctx.top_setup && (
        <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-200">
          Top Setup #{ctx.setup_rank} · {ctx.setup_score}/100 · invalid below {ctx.invalid_below}
        </span>
      )}
      {ctx.qualified && !ctx.top_setup && (
        <span className="rounded border border-emerald-500/25 px-1.5 py-0.5 text-emerald-300/90">Qualified setup · {ctx.setup_score}/100 · invalid below {ctx.invalid_below}</span>
      )}
      {ctx.retest && <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-200">Retest held at {ctx.retest_level}</span>}
      {ctx.market_state && <span className={`rounded border px-1.5 py-0.5 ${ctx.market_state === 'green' ? 'border-emerald-500/30 text-emerald-300' : ctx.market_state === 'red' ? 'border-rose-500/40 text-rose-300' : 'border-amber-500/40 text-amber-300'}`}>market {ctx.market_state === 'red' ? 'says wait' : ctx.market_state}</span>}
      {ctx.phase && <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300">{ctx.phase} vs SPY</span>}
      {ctx.ema_trend && <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300">8/21 {ctx.ema_trend}</span>}
      {ctx.pd_event && <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300">{ctx.pd_event.replace('_', ' ')}</span>}
      {ctx.sector_etf && <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-300">sector {ctx.sector_etf} {ctx.sector_phase?.toLowerCase()}</span>}
    </div>
  );
}

const CL_NEXT = { null: true, true: false, false: null };

// Tap to cycle: ✓ yes → ✗ no → ? not sure. "auto" = filled from the pulse snapshot.
function Checklist({ value, auto, onChange }) {
  const n = checklistScore(value);
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className={label}>Checklist — market → sector → leader → level → break → retest → 8/21</span>
        <span className={`font-mono text-[12px] tabular-nums ${n === 7 ? 'text-emerald-300' : n >= 5 ? 'text-neutral-200' : 'text-amber-300'}`}>{n}/7</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
        {CHECKLIST.map((c) => {
          const v = value[c.id];
          const isAuto = auto && auto[c.id] !== null && auto[c.id] === v;
          return (
            <button key={c.id} type="button" title={`${c.hint}${isAuto ? ' (from Sector Pulse — tap to change)' : ''}`}
              onClick={() => onChange({ ...value, [c.id]: CL_NEXT[String(v)] })}
              className={`rounded border px-1.5 py-1.5 text-center text-[11px] transition-colors ${v === true ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200' : v === false ? 'border-rose-500/40 bg-rose-500/5 text-rose-300' : 'border-neutral-800 text-neutral-500'}`}>
              <span className="mr-1 font-mono">{v === true ? '✓' : v === false ? '✗' : '?'}</span>{c.label}
              {isAuto && <span className="block text-[9px] uppercase tracking-wider opacity-50">auto</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChecklistChip({ cl }) {
  const n = checklistScore(cl);
  if (n == null) return null;
  const tip = CHECKLIST.map((c) => `${cl[c.id] === true ? '✓' : cl[c.id] === false ? '✗' : '?'} ${c.label}`).join('  ');
  return (
    <span title={tip} className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${n === 7 ? 'border-emerald-500/40 text-emerald-300' : n >= 5 ? 'border-neutral-700 text-neutral-300' : 'border-amber-500/40 text-amber-300'}`}>
      {n}/7{cl.retest === true ? ' retest' : ''}
    </span>
  );
}

function LogForm({ params, limits, acct, open, closedToday, snapshot, onCancel, onSaved }) {
  const [f, setF] = useState(() => ({
    direction: params.get('dir') === 'short' ? 'short' : 'long',
    instrument: 'stock',
    ticker: (params.get('ticker') || '').toUpperCase(),
    option_desc: '',
    quantity: '',
    entry: params.get('price') || '',
    stop: params.get('stop') || '',
    setup: params.get('setup') || null,
    why: '',
    state: null,
  }));
  const [reasons, setReasons] = useState({});
  const [clEdits, setClEdits] = useState({}); // user taps override the auto-fill
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));

  const ticker = f.ticker.trim().toUpperCase();
  const qty = num(f.quantity);
  const entry = num(f.entry);
  const stop = num(f.stop);
  const value = entry && qty ? positionValue(entry, qty, f.instrument) : null;
  const risk = entry && qty ? riskAmount(entry, stop, qty, f.instrument) : null;
  const cap = positionCap(limits, acct);
  const ctx = useMemo(() => (ticker ? pulseContext(snapshot, ticker) : null), [snapshot, ticker]);
  const clAuto = prefillChecklist(ticker ? ctx : null, stop, f.direction);
  const checklist = { ...clAuto, ...clEdits };
  const flags = riskCheck(limits, acct, open, closedToday,
    { ticker, instrument: f.instrument, entry_price: entry, quantity: qty, stop_loss: stop });
  const missingReason = flags.filter((fl) => (reasons[fl.rule] || '').trim().length < 3);
  const canSave = ticker && qty > 0 && entry > 0 && (f.instrument === 'stock' || f.option_desc.trim()) && missingReason.length === 0 && !saving;

  async function prefillPrice() {
    if (!ticker || f.entry || f.instrument !== 'stock') return;
    const q = await fetchQuotes([ticker]);
    if (q.get(ticker)) setF((s) => (s.entry ? s : { ...s, entry: String(q.get(ticker)) }));
  }

  async function save() {
    setSaving(true); setErr(null);
    try {
      await authReady();
      const now = new Date();
      const row = {
        date: todayET(), ticker, direction: f.direction, instrument: f.instrument,
        option_desc: f.instrument === 'option' ? f.option_desc.trim().toUpperCase() : null,
        quantity: qty, entry_price: entry, position_size: value, stop_loss: stop,
        stop_loss_pct: stop ? Math.round((Math.abs(entry - stop) / entry) * 10000) / 100 : null,
        setup: f.setup || 'other', thesis: f.why.trim() || null, emotional_state: f.state,
        trade_type: f.setup === 'discord' ? 'discord_alert' : 'independent',
        status: 'open', source: 'dashboard', pulse_context: ctx,
        risk_flags: flags.map((fl) => ({ ...fl, reason: reasons[fl.rule].trim() })),
        opened_at: now.toISOString(), checklist,
      };
      const warn = await writeTrade(row);
      onSaved(`Logged ${f.direction} ${ticker} — ${usd(value)}, checklist ${checklistScore(checklist)}/7${flags.length ? `, ${flags.length} rule break${flags.length > 1 ? 's' : ''} on record` : ''}.${warn ? ` ${warn}` : ''}`);
    } catch (e) {
      setErr(e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-emerald-500/30 bg-neutral-950/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-[0.22em] text-emerald-300">Log a trade</div>
        <button onClick={onCancel} aria-label="Cancel" className="text-neutral-500 hover:text-neutral-200"><X className="h-4 w-4" /></button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div><span className={label}>Direction</span><Toggle value={f.direction} onChange={set('direction')} options={[['long', 'Long'], ['short', 'Short']]} /></div>
        <div><span className={label}>Instrument</span><Toggle value={f.instrument} onChange={set('instrument')} options={[['stock', 'Stock'], ['option', 'Option']]} /></div>
        <div>
          <label className={label} htmlFor="j-ticker">Ticker</label>
          <input id="j-ticker" className={`${input} font-mono uppercase`} value={f.ticker} placeholder="NVDA"
            onChange={(e) => set('ticker')(e.target.value)} onBlur={prefillPrice} />
        </div>
        {f.instrument === 'option' ? (
          <div>
            <label className={label} htmlFor="j-opt">Contract</label>
            <input id="j-opt" className={`${input} font-mono uppercase`} value={f.option_desc} placeholder="250C 10/17" onChange={(e) => set('option_desc')(e.target.value)} />
          </div>
        ) : <div className="hidden sm:block" />}
        <div>
          <label className={label} htmlFor="j-qty">{f.instrument === 'option' ? 'Contracts' : 'Shares'}</label>
          <input id="j-qty" inputMode="decimal" className={`${input} font-mono`} value={f.quantity} placeholder="20" onChange={(e) => set('quantity')(e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="j-entry">{f.instrument === 'option' ? 'Premium / contract' : 'Entry price'}</label>
          <input id="j-entry" inputMode="decimal" className={`${input} font-mono`} value={f.entry} placeholder="224.50" onChange={(e) => set('entry')(e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="j-stop">Stop / invalidation</label>
          <input id="j-stop" inputMode="decimal" className={`${input} font-mono`} value={f.stop} placeholder="219.00" onChange={(e) => set('stop')(e.target.value)} />
        </div>
        <div className="flex flex-col justify-end rounded border border-neutral-900 bg-neutral-900/40 px-2.5 py-1.5 font-mono text-[11px] tabular-nums text-neutral-400">
          <div>size <span className={value > cap ? 'text-rose-300' : 'text-neutral-200'}>{value == null ? '—' : usd(value)}</span> <span className="text-neutral-600">/ {usd(cap)}</span></div>
          <div>risk to stop <span className="text-neutral-200">{risk == null ? '—' : usd(risk)}</span></div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div><span className={label}>Setup</span><Chips options={SETUPS} value={f.setup} onChange={set('setup')} /></div>
        <div><span className={label}>State of mind (optional)</span><Chips options={STATES} value={f.state} onChange={set('state')} /></div>
      </div>
      <div className="mt-3">
        <label className={label} htmlFor="j-why">Why (one line)</label>
        <input id="j-why" className={input} value={f.why} placeholder="Reclaimed PDH on 2x volume, sector leading" onChange={(e) => set('why')(e.target.value)} />
      </div>

      <div className="mt-3 rounded border border-neutral-900 bg-neutral-900/30 px-3 py-2">
        <div className={label}>What the system says</div>
        <PulseRead ctx={ticker ? ctx : null} />
      </div>

      <div className="mt-3">
        <Checklist value={checklist} auto={clAuto} onChange={(next) => setClEdits(
          Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== clAuto[k])),
        )} />
      </div>

      {flags.length > 0 && (
        <div className="mt-3 space-y-2 rounded border border-rose-500/40 bg-rose-500/5 p-3">
          <div className="flex items-center gap-1.5 text-[12px] font-medium text-rose-200"><ShieldAlert className="h-4 w-4" /> This trade breaks {flags.length} rule{flags.length > 1 ? 's' : ''}. Say why — it stays on the record.</div>
          {flags.map((fl) => (
            <div key={fl.rule}>
              <div className="text-[12px] text-rose-300">{fl.message}</div>
              <input className={`${input} mt-1`} placeholder="Reason for overriding" value={reasons[fl.rule] || ''}
                onChange={(e) => setReasons((r) => ({ ...r, [fl.rule]: e.target.value }))} />
            </div>
          ))}
        </div>
      )}

      {err && <Banner tone="error">{err}</Banner>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded border border-neutral-800 px-4 py-2 text-[12px] text-neutral-400 hover:text-neutral-200">Cancel</button>
        <button onClick={save} disabled={!canSave}
          className={`rounded border px-4 py-2 text-[12px] font-medium uppercase tracking-[0.12em] disabled:opacity-40 ${flags.length ? 'border-rose-500/50 bg-rose-500/10 text-rose-200' : 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'}`}>
          {saving ? 'Saving…' : flags.length ? `Log with ${flags.length} override${flags.length > 1 ? 's' : ''}` : 'Log trade'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Open trades
// ---------------------------------------------------------------------------

function SetupChip({ id }) {
  return <span className="rounded border border-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">{setupLabel(id)}</span>;
}

function OpenTrades({ trades, quotes, onDone }) {
  const [panel, setPanel] = useState(null); // { id, kind: 'close' | 'edit' }
  return (
    <section className="mb-6">
      <SectionTitle title={`Open trades (${trades.length})`} hint="Live P&L for stocks. Close a trade the same day you exit it." />
      {trades.length === 0 ? (
        <Empty>No open trades.</Empty>
      ) : (
        <div className="overflow-hidden rounded-md border border-neutral-800">
          {trades.map((t) => {
            const inst = t.instrument || 'stock';
            const qty = Number(t.quantity) || (t.position_size && t.entry_price ? Number(t.position_size) / Number(t.entry_price) / (inst === 'option' ? 100 : 1) : 0);
            const px = inst === 'stock' ? quotes.get(t.ticker) : null;
            const upnl = px != null && qty ? computePnl(Number(t.entry_price), px, qty, t.direction || 'long', inst) : null;
            const risk = riskAmount(Number(t.entry_price), t.stop_loss != null ? Number(t.stop_loss) : null, qty, inst);
            const flags = t.risk_flags || [];
            const isOpen = panel?.id === t.id;
            return (
              <div key={t.id} className="border-b border-neutral-900 last:border-0">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-[9rem]">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[14px] font-semibold text-neutral-100">{t.ticker}</span>
                      {t.option_desc && <span className="font-mono text-[11px] text-neutral-400">{t.option_desc}</span>}
                      {t.direction === 'short' && <span className="text-[10px] uppercase text-amber-300">short</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1"><SetupChip id={t.setup} /><ChecklistChip cl={t.checklist} />
                      {t.pulse_context?.top_setup && t.setup !== 'top_setup' && <span className="rounded border border-emerald-500/30 px-1.5 py-0.5 text-[10px] text-emerald-300">Top Setup</span>}
                      {flags.length > 0 && <span title={flags.map((x) => `${x.message} — ${x.reason || 'no reason'}`).join('\n')} className="rounded border border-rose-500/40 px-1.5 py-0.5 text-[10px] text-rose-300">{flags.length} rule break{flags.length > 1 ? 's' : ''}</span>}
                    </div>
                  </div>
                  <Stat k="Qty" v={qty ? qty.toLocaleString() : '—'} />
                  <Stat k="Entry" v={t.entry_price} />
                  <Stat k="Stop" v={t.stop_loss ?? <span className="text-amber-300">none</span>} />
                  <Stat k="Now" v={px ?? '—'} />
                  <Stat k="P&L" v={<span className={pnlClass(upnl)}>{upnl == null ? '—' : signedUsd(upnl)}</span>} />
                  <Stat k="R" v={upnl != null && risk ? `${(upnl / risk).toFixed(2)}R` : '—'} />
                  <Stat k="Held" v={`${daysSince(t.opened_at || t.date) ?? '—'}d`} />
                  <div className="ml-auto flex gap-1.5">
                    <button onClick={() => setPanel(isOpen && panel.kind === 'edit' ? null : { id: t.id, kind: 'edit' })}
                      className="rounded border border-neutral-800 px-2.5 py-1.5 text-[11px] text-neutral-400 hover:text-neutral-200">Details</button>
                    <button onClick={() => setPanel(isOpen && panel.kind === 'close' ? null : { id: t.id, kind: 'close' })}
                      className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-200">Close</button>
                  </div>
                </div>
                {isOpen && panel.kind === 'close' && <ClosePanel t={t} qty={qty} livePx={px} onDone={(m) => { setPanel(null); onDone(m); }} />}
                {isOpen && panel.kind === 'edit' && <EditPanel t={t} onDone={(m) => { setPanel(null); onDone(m); }} />}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Stat({ k, v }) {
  return (
    <div className="min-w-[3.5rem]">
      <div className="text-[9px] uppercase tracking-wider text-neutral-600">{k}</div>
      <div className="font-mono text-[12px] tabular-nums text-neutral-200">{v}</div>
    </div>
  );
}

function ReviewFields({ r, setR }) {
  return (
    <>
      <div>
        <span className={label}>Followed your plan?</span>
        <Toggle value={r.followed} onChange={(v) => setR((s) => ({ ...s, followed: v }))} options={[['yes', 'Yes'], ['no', 'No']]} />
      </div>
      <div className="sm:col-span-2">
        <span className={label}>Mistakes (if any)</span>
        <Chips multi options={MISTAKES} value={r.mistakes} onChange={(v) => setR((s) => ({ ...s, mistakes: v }))} />
      </div>
      <div className="sm:col-span-3">
        <label className={label}>One lesson</label>
        <input className={input} value={r.lesson} placeholder="What would you do differently?" onChange={(e) => setR((s) => ({ ...s, lesson: e.target.value }))} />
      </div>
    </>
  );
}

function ClosePanel({ t, qty, livePx, onDone }) {
  const [exit, setExit] = useState(livePx != null ? String(livePx) : '');
  const [date, setDate] = useState(todayET());
  const [r, setR] = useState({ followed: null, mistakes: [], lesson: '' });
  const [err, setErr] = useState(null);
  const inst = t.instrument || 'stock';
  const x = num(exit);
  const pnl = x != null && qty ? computePnl(Number(t.entry_price), x, qty, t.direction || 'long', inst) : null;
  const risk = riskAmount(Number(t.entry_price), t.stop_loss != null ? Number(t.stop_loss) : null, qty, inst);
  async function save() {
    setErr(null);
    try {
      await authReady();
      const upd = {
        exit_price: x, exit_date: date, pnl, r_multiple: rMultiple(pnl, risk),
        status: closeStatus(t.direction || 'long', x, t.stop_loss != null ? Number(t.stop_loss) : null),
        closed_at: new Date().toISOString(),
        followed_plan: r.followed == null ? null : r.followed === 'yes', mistakes: r.mistakes, lesson: r.lesson.trim() || null,
      };
      if (!t.quantity && qty) upd.quantity = qty;
      const { error } = await supabase.from('trade_journal').update(upd).eq('id', t.id);
      if (error) throw error;
      onDone(`Closed ${t.ticker}: ${signedUsd(pnl, 2)}${upd.r_multiple != null ? ` (${upd.r_multiple}R)` : ''}.`);
    } catch (e) { setErr(e.message || 'Close failed.'); }
  }
  return (
    <div className="border-t border-neutral-900 bg-neutral-900/30 px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label className={label}>Exit {inst === 'option' ? 'premium' : 'price'}</label>
          <input inputMode="decimal" className={`${input} font-mono`} value={exit} onChange={(e) => setExit(e.target.value)} /></div>
        <div><label className={label}>Exit date</label>
          <input type="date" className={`${input} font-mono`} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="flex flex-col justify-end font-mono text-[13px] tabular-nums">
          <span className={pnlClass(pnl)}>{pnl == null ? '—' : signedUsd(pnl, 2)}</span>
          <span className="text-[11px] text-neutral-500">{pnl != null && risk ? `${(pnl / risk).toFixed(2)}R` : 'no stop → no R'}</span>
        </div>
        <ReviewFields r={r} setR={setR} />
      </div>
      {err && <Banner tone="error">{err}</Banner>}
      <div className="mt-3 flex justify-end">
        <button disabled={x == null || x < 0} onClick={save}
          className="rounded border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-[12px] font-medium uppercase tracking-[0.12em] text-emerald-200 disabled:opacity-40">Close trade</button>
      </div>
    </div>
  );
}

function EditPanel({ t, onDone }) {
  const [stop, setStop] = useState(t.stop_loss ?? '');
  const [why, setWhy] = useState(t.thesis || '');
  const [flags, setFlags] = useState(t.risk_flags || []);
  const [cl, setCl] = useState(() => t.checklist || prefillChecklist(t.pulse_context, t.stop_loss, t.direction));
  const [err, setErr] = useState(null);
  async function save() {
    setErr(null);
    try {
      await authReady();
      const s = num(stop);
      const warn = await writeTrade({
        stop_loss: s, thesis: why.trim() || null, risk_flags: flags, checklist: cl,
        stop_loss_pct: s && t.entry_price ? Math.round((Math.abs(t.entry_price - s) / t.entry_price) * 10000) / 100 : null,
      }, t.id);
      onDone(`Updated ${t.ticker}.${warn ? ` ${warn}` : ''}`);
    } catch (e) { setErr(e.message || 'Save failed.'); }
  }
  return (
    <div className="border-t border-neutral-900 bg-neutral-900/30 px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label className={label}>Stop / invalidation</label>
          <input inputMode="decimal" className={`${input} font-mono`} value={stop} onChange={(e) => setStop(e.target.value)} /></div>
        <div className="sm:col-span-2"><label className={label}>Why</label>
          <input className={input} value={why} onChange={(e) => setWhy(e.target.value)} /></div>
      </div>
      {t.pulse_context && <div className="mt-3"><span className={label}>System read when logged</span><PulseRead ctx={t.pulse_context} /></div>}
      <div className="mt-3"><Checklist value={cl} auto={t.checklist ? null : cl} onChange={setCl} /></div>
      {flags.length > 0 && (
        <div className="mt-3 space-y-2">
          <span className={label}>Rule breaks at entry</span>
          {flags.map((f, i) => (
            <div key={f.rule}>
              <div className="text-[12px] text-rose-300">{f.message}</div>
              <input className={`${input} mt-1`} value={needsReason(f) ? '' : f.reason} placeholder="Reason for overriding"
                onChange={(e) => setFlags((fs) => fs.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)))} />
            </div>
          ))}
        </div>
      )}
      {err && <Banner tone="error">{err}</Banner>}
      <div className="mt-3 flex justify-end">
        <button onClick={save} className="rounded border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-[12px] font-medium uppercase tracking-[0.12em] text-emerald-200">Save</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Closed trades + review
// ---------------------------------------------------------------------------

function ClosedTrades({ trades, onDone }) {
  const [reviewing, setReviewing] = useState(null);
  const [limit, setLimit] = useState(15);
  return (
    <section className="mb-6">
      <SectionTitle title="Closed trades" hint="Review each one: did you follow the plan, and what went wrong?" />
      {trades.length === 0 ? <Empty>No closed trades yet.</Empty> : (
        <div className="overflow-hidden rounded-md border border-neutral-800">
          {trades.slice(0, limit).map((t) => (
            <div key={t.id} className="border-b border-neutral-900 last:border-0">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-[12px]">
                <span className="w-20 font-mono text-neutral-500">{t.exit_date || t.date}</span>
                <span className="w-28 font-mono font-semibold text-neutral-100">{t.ticker}{t.option_desc ? <span className="ml-1 font-normal text-neutral-500">{t.option_desc}</span> : null}</span>
                <span className={`w-24 font-mono tabular-nums ${pnlClass(Number(t.pnl))}`}>{signedUsd(Number(t.pnl), 0)}</span>
                <span className="w-14 font-mono tabular-nums text-neutral-400">{t.r_multiple != null ? `${Number(t.r_multiple).toFixed(1)}R` : '—'}</span>
                <SetupChip id={t.setup} />
                <ChecklistChip cl={t.checklist} />
                {t.status === 'stopped_out' && <span className="text-[10px] uppercase text-neutral-500">stopped</span>}
                {t.followed_plan === true && <span className="text-emerald-400" title="Followed plan">✓ plan</span>}
                {t.followed_plan === false && <span className="text-rose-400" title="Broke plan">✗ plan</span>}
                {(t.mistakes || []).map((m) => <span key={m} className="rounded border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-amber-300">{mistakeLabel(m)}</span>)}
                {t.followed_plan == null && (
                  <button onClick={() => setReviewing(reviewing === t.id ? null : t.id)} className="ml-auto rounded border border-amber-500/40 px-2 py-1 text-[11px] text-amber-200">Review</button>
                )}
              </div>
              {t.lesson && <div className="px-4 pb-2 text-[12px] italic text-neutral-500">“{t.lesson}”</div>}
              {reviewing === t.id && <ReviewPanel t={t} onDone={(m) => { setReviewing(null); onDone(m); }} />}
            </div>
          ))}
          {trades.length > limit && (
            <button onClick={() => setLimit((l) => l + 25)} className="w-full py-2 text-[12px] text-neutral-500 hover:text-neutral-300">Show more</button>
          )}
        </div>
      )}
    </section>
  );
}

function ReviewPanel({ t, onDone }) {
  const [r, setR] = useState({ followed: null, mistakes: t.mistakes || [], lesson: t.lesson || '' });
  const [err, setErr] = useState(null);
  async function save() {
    try {
      await authReady();
      const { error } = await supabase.from('trade_journal').update({
        followed_plan: r.followed === 'yes', mistakes: r.mistakes, lesson: r.lesson.trim() || null,
      }).eq('id', t.id);
      if (error) throw error;
      onDone(`Reviewed ${t.ticker}.`);
    } catch (e) { setErr(e.message || 'Save failed.'); }
  }
  return (
    <div className="border-t border-neutral-900 bg-neutral-900/30 px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-3"><ReviewFields r={r} setR={setR} /></div>
      {err && <Banner tone="error">{err}</Banner>}
      <div className="mt-3 flex justify-end">
        <button disabled={r.followed == null} onClick={save} className="rounded border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-[12px] font-medium uppercase tracking-[0.12em] text-emerald-200 disabled:opacity-40">Save review</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function SectionTitle({ title, hint }) {
  return (
    <div className="mb-2">
      <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-400">{title}</div>
      {hint && <div className="mt-0.5 text-[12px] text-neutral-600">{hint}</div>}
    </div>
  );
}

function Empty({ children }) {
  return <div className="rounded-md border border-dashed border-neutral-800 px-4 py-5 text-center text-[13px] text-neutral-500">{children}</div>;
}

function StatTable({ title, rows, labelFn = (k) => k, note }) {
  if (!rows.length) return null;
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/40">
      <div className="border-b border-neutral-900 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-neutral-400">{title}</div>
      <table className="w-full text-[12px]">
        <thead><tr className="text-left text-[9px] uppercase tracking-wider text-neutral-600">
          <th className="px-3 py-1.5 font-normal"> </th><th className="px-2 py-1.5 text-right font-normal">Trades</th>
          <th className="px-2 py-1.5 text-right font-normal">Win %</th><th className="px-2 py-1.5 text-right font-normal">Avg R</th>
          <th className="px-3 py-1.5 text-right font-normal">P&L</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-neutral-900">
              <td className="px-3 py-1.5 text-neutral-300">{labelFn(r.key)}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums text-neutral-400">{r.n}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums text-neutral-300">{r.winRate ?? '—'}{r.winRate != null && '%'}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums text-neutral-300">{r.avgR != null ? r.avgR.toFixed(2) : '—'}</td>
              <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${pnlClass(r.pnl)}`}>{signedUsd(r.pnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {note && <div className="border-t border-neutral-900 px-3 py-1.5 text-[11px] text-neutral-600">{note}</div>}
    </div>
  );
}

function Stats({ trades }) {
  const [period, setPeriod] = useState('30');
  const since = useMemo(() => (period === 'all' ? null : daysAgoET(Number(period))), [period]);
  const s = useMemo(() => journalStats(trades, since), [trades, since]);
  const o = s.overall;
  const d = s.discipline;
  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <SectionTitle title="What’s working" hint="Your real trades — by setup, by whether the system agreed, by rule breaks and mistakes." />
        <div className="flex rounded border border-neutral-800 p-0.5 text-[11px]">
          {[['30', '30d'], ['90', '90d'], ['all', 'All']].map(([k, l]) => (
            <button key={k} onClick={() => setPeriod(k)} className={`rounded px-3 py-1 ${period === k ? 'bg-emerald-500/15 text-emerald-300' : 'text-neutral-500'}`}>{l}</button>
          ))}
        </div>
      </div>
      {o.n === 0 ? <Empty>No closed trades in this period yet — stats appear as you close trades.</Empty> : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[['Closed trades', o.n], ['Win rate', `${o.winRate}%`], ['P&L', <span key="p" className={pnlClass(o.pnl)}>{signedUsd(o.pnl)}</span>], ['Avg R', o.avgR != null ? o.avgR.toFixed(2) : '—']].map(([k, v]) => (
              <div key={k} className="rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2.5">
                <div className={label}>{k}</div><div className="font-mono text-lg tabular-nums text-neutral-100">{v}</div>
              </div>
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <StatTable title="Checklist followed?" rows={s.byChecklist} note="Market → sector → leader → level → break → retest → 8/21, ticked at entry." />
            <StatTable title="Retest vs break entries" rows={s.byEntry} note="Waiting for the retest misses some runners — this shows whether it pays for you." />
            <StatTable title="Did the system agree?" rows={s.bySystem} note="Sector Pulse read saved when each trade was logged." />
            <StatTable title="Risk rules at entry" rows={s.byRules} />
            <StatTable title="By setup" rows={s.bySetup} labelFn={setupLabel} />
            <StatTable title="Plan followed?" rows={s.byPlan} />
            {s.mistakes.length > 0 && (
              <div className="rounded-md border border-neutral-800 bg-neutral-950/40">
                <div className="border-b border-neutral-900 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-neutral-400">What mistakes cost</div>
                {s.mistakes.map((m) => (
                  <div key={m.key} className="flex justify-between border-t border-neutral-900 px-3 py-1.5 text-[12px] first:border-0">
                    <span className="text-neutral-300">{mistakeLabel(m.key)} <span className="text-neutral-600">×{m.n}</span></span>
                    <span className={`font-mono tabular-nums ${pnlClass(m.pnl)}`}>{signedUsd(m.pnl)}</span>
                  </div>
                ))}
              </div>
            )}
            <StatTable title="State of mind" rows={s.byState} labelFn={(k) => STATES.find((x) => x.id === k)?.label ?? k} />
          </div>
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 rounded-md border border-neutral-900 px-3 py-2 font-mono text-[11px] text-neutral-500">
        <span>logged {d.logged}</span>
        <span>with a stop {d.withStop ?? '—'}%</span>
        <span>with a why {d.withWhy ?? '—'}%</span>
        <span>closed & reviewed {d.reviewed ?? '—'}%</span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

function LimitsEditor({ limits, acct, portfolio, onSaved }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(null);
  const [err, setErr] = useState(null);
  const cur = v || {
    max_position_usd: limits.max_position_usd, max_position_pct: limits.max_position_pct,
    max_options_usd: limits.max_options_usd, max_daily_loss_usd: limits.max_daily_loss_usd,
    no_trade: (limits.no_trade || []).join(', '),
  };
  async function save() {
    setErr(null);
    try {
      await authReady();
      const { error } = await supabase.from('risk_limits').update({
        max_position_usd: num(cur.max_position_usd), max_position_pct: num(cur.max_position_pct),
        max_options_usd: num(cur.max_options_usd), max_daily_loss_usd: num(cur.max_daily_loss_usd),
        no_trade: String(cur.no_trade).split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean),
        updated_at: new Date().toISOString(),
      }).eq('id', 1);
      if (error) throw error;
      setV(null); setOpen(false);
      onSaved('Limits saved.');
    } catch (e) { setErr(e.message || 'Save failed.'); }
  }
  const field = (k, lbl) => (
    <div key={k}><label className={label}>{lbl}</label>
      <input className={`${input} font-mono`} value={cur[k]} onChange={(e) => setV({ ...cur, [k]: e.target.value })} /></div>
  );
  return (
    <section>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between rounded-md border border-neutral-800 px-4 py-3 text-left hover:border-neutral-700">
        <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-neutral-400"><Settings className="h-3.5 w-3.5" /> Risk limits</span>
        {open ? <ChevronUp className="h-4 w-4 text-neutral-500" /> : <ChevronDown className="h-4 w-4 text-neutral-500" />}
      </button>
      {open && (
        <div className="mt-2 rounded-md border border-neutral-800 p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {field('max_position_usd', 'Max per ticker $')}
            {field('max_position_pct', 'Max per ticker %')}
            {field('max_options_usd', 'Max options $')}
            {field('max_daily_loss_usd', 'Daily stop $')}
          </div>
          <div className="mt-3">{field('no_trade', 'No-trade list')}</div>
          <p className="mt-3 text-[11px] text-neutral-600">
            Account value {acct == null ? '—' : usd(acct)} = starting capital {usd(portfolio.startingCapital)} + realized journal P&L {signedUsd(portfolio.realizedPnl)}.
            It’s only as accurate as the journal is complete — every closed trade counts.
          </p>
          {err && <Banner tone="error">{err}</Banner>}
          <div className="mt-3 flex justify-end">
            <button onClick={save} className="rounded border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-[12px] font-medium uppercase tracking-[0.12em] text-emerald-200">Save limits</button>
          </div>
        </div>
      )}
    </section>
  );
}
