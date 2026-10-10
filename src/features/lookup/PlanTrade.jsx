import { useEffect, useMemo, useState } from 'react';
import HelpLink from '../../components/HelpLink';
import { Link } from 'react-router-dom';
import { Calculator, AlertTriangle, Loader2 } from 'lucide-react';
import { stopCandidates, defaultStop, conditions, conditionMult, sizeStock, pickCalls, sizeOption } from '../../lib/sizing';
import { tradeValue } from '../../lib/journal';

// "I want to buy this — how much?" Size from the stop, shrink for weak conditions,
// cap by your journal limits. Options: two liquid calls per swing expiry, sized by premium.

const SETTINGS_KEY = 'lookup.sizing';
const DEFAULTS = { account: 80000, riskPct: 3 };
const readSettings = () => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return DEFAULTS; } };
const saveSettings = (s) => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* optional */ } };

const money = (v, d = 0) => (v == null ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const f2 = (v) => (v == null ? '—' : Number(v).toFixed(2));
const multCls = (m) => (m >= 1 ? 'text-emerald-300' : m >= 0.75 ? 'text-amber-300' : 'text-rose-300');
const etToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const dteOf = (exp) => Math.round((Date.parse(`${exp}T00:00:00Z`) - Date.parse(`${etToday()}T00:00:00Z`)) / 86400000);

export default function PlanTrade({ sym, a, ctx }) {
  const [settings, setSettings] = useState(readSettings);
  const [entryIn, setEntryIn] = useState('');
  const [stopKey, setStopKey] = useState(null);
  const [customStop, setCustomStop] = useState('');
  const [tab, setTab] = useState('stock');

  const snap = ctx?.snap;
  const setup = useMemo(() => (snap?.setups?.all || []).find((r) => r.ticker === sym) || null, [snap, sym]);
  const group = useMemo(() => (snap?.groups || []).find((g) => (g.members || []).some((m) => m.ticker === sym)) || null, [snap, sym]);
  const sector = useMemo(() => (group?.ref?.quadrant ? { etf: group.ref.symbol, phase: group.ref.quadrant }
    : setup?.sector_phase ? { etf: setup.sector_etf, phase: setup.sector_phase }
      : a.rel?.phase ? { etf: null, phase: a.rel.phase } : null), [group, setup, a.rel]);
  const gate = snap?.risk?.state || null;

  const cands = useMemo(() => stopCandidates(a, setup), [a, setup]);
  const def = defaultStop(cands);
  const entry = Number(entryIn) > 0 ? Number(entryIn) : a.price;
  const stop = stopKey === 'custom' ? (Number(customStop) > 0 ? Number(customStop) : null)
    : (cands.find((c) => c.key === stopKey) || def)?.level ?? null;
  const conds = useMemo(() => conditions({ a, gate, sector }), [a, gate, sector]);
  const mult = conditionMult(conds);

  const limits = ctx?.limits || {};
  const open = ctx?.openAll || [];
  const sameTickerOpen = open.filter((t) => t.ticker === sym && (t.instrument || 'stock') === 'stock').reduce((s, t) => s + tradeValue(t), 0);
  const optionsOpen = open.filter((t) => t.instrument === 'option').reduce((s, t) => s + tradeValue(t), 0);
  const realizedToday = ctx?.realizedToday || 0;
  const base = { account: Number(settings.account), riskPct: Number(settings.riskPct), conds, limits, realizedToday };
  const size = sizeStock({ ...base, entry, stop, sameTickerOpen });

  const upd = (k) => (e) => { const next = { ...settings, [k]: e.target.value }; setSettings(next); saveSettings(next); };
  const inCls = 'w-full rounded border border-neutral-800 bg-transparent px-2 py-1.5 font-mono text-[13px] text-neutral-100 focus:border-emerald-500/50 focus:outline-none';
  const highRisk = Number(settings.riskPct) > 2;

  return (
    <section className="mb-5 rounded-md border border-neutral-800 bg-neutral-950/50">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-900 px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-neutral-300">
          <Calculator className="h-3.5 w-3.5 text-emerald-400" strokeWidth={1.75} /> Plan a trade — how much <HelpLink to="plan" />
        </h2>
        <div className="flex rounded border border-neutral-800 p-0.5 text-[11px]">
          {[['stock', 'Shares'], ['options', 'Options']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded px-3 py-1 ${tab === k ? 'bg-emerald-500/15 text-emerald-300' : 'text-neutral-500 hover:text-neutral-300'}`}>{l}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-b border-neutral-900 px-4 py-3 sm:grid-cols-4">
        <label className="text-[11px] text-neutral-500">Account $
          <input type="number" min="0" step="1000" value={settings.account} onChange={upd('account')} className={`${inCls} mt-1`} />
        </label>
        <label className="text-[11px] text-neutral-500">Risk per trade %
          <input type="number" min="0.1" max="10" step="0.25" value={settings.riskPct} onChange={upd('riskPct')} className={`${inCls} mt-1`} />
          <span className="mt-0.5 block font-mono text-[10px] text-neutral-600">= {money(Number(settings.account) * Number(settings.riskPct) / 100)} full-size risk</span>
        </label>
        <label className="text-[11px] text-neutral-500">Entry
          <input type="number" step="0.01" value={entryIn} placeholder={f2(a.price)} onChange={(e) => setEntryIn(e.target.value)} className={`${inCls} mt-1`} />
          <span className="mt-0.5 block text-[10px] text-neutral-600">blank = current price</span>
        </label>
        <div className="text-[11px] text-neutral-500">Conditions
          <div className={`mt-1 font-mono text-[20px] leading-tight ${multCls(mult)}`}>{Math.round(mult * 100)}%</div>
          <span className="block text-[10px] text-neutral-600">of full size</span>
        </div>
      </div>
      {highRisk && (
        <div className="flex items-start gap-2 border-b border-neutral-900 bg-amber-500/[0.04] px-4 py-2 text-[11px] text-amber-200/90">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {settings.riskPct}% a trade: 10 straight stop-outs ≈ −{Math.round((1 - (1 - Number(settings.riskPct) / 100) ** 10) * 100)}% of the account.
          {limits.max_daily_loss_usd != null && Number(settings.account) * Number(settings.riskPct) / 100 > Number(limits.max_daily_loss_usd)
            && ` One full-size loss (${money(Number(settings.account) * Number(settings.riskPct) / 100)}) is bigger than your ${money(limits.max_daily_loss_usd)} daily stop.`}
        </div>
      )}

      <Conditions conds={conds} mult={mult} />

      {tab === 'stock'
        ? <StockPlan sym={sym} a={a} entry={entry} cands={cands} def={def} stopKey={stopKey} setStopKey={setStopKey}
            customStop={customStop} setCustomStop={setCustomStop} stop={stop} size={size} setup={setup} />
        : <OptionsPlan sym={sym} a={a} base={base} optionsOpen={optionsOpen} stop={stop} />}
    </section>
  );
}

function Conditions({ conds, mult }) {
  if (!conds.length) return null;
  return (
    <div className="border-b border-neutral-900 px-4 py-2.5">
      <div className="mb-1.5 text-[10px] uppercase tracking-[0.16em] text-neutral-500">What shrinks the size (never grows it)</div>
      <div className="grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
        {conds.map((c) => (
          <div key={c.key} className="flex items-baseline gap-2">
            <span className={`w-10 shrink-0 text-right font-mono tabular-nums ${multCls(c.mult)}`}>×{c.mult}</span>
            <span className="text-neutral-300">{c.label} <span className="font-mono text-neutral-400">{c.value}</span></span>
            <span className="truncate text-[11px] text-neutral-600" title={c.note}>{c.note}</span>
          </div>
        ))}
      </div>
      {mult < 0.3 && (
        <div className="mt-2 text-[12px] text-rose-300/90">
          Conditions cut this to {Math.round(mult * 100)}% of a normal position. When this many things are against a long, passing is usually the better trade.
        </div>
      )}
    </div>
  );
}

function StockPlan({ sym, a, entry, cands, def, stopKey, setStopKey, customStop, setCustomStop, stop, size, setup }) {
  const active = stopKey || def?.key;
  return (
    <div className="px-4 py-3">
      <div className="mb-1.5 text-[10px] uppercase tracking-[0.16em] text-neutral-500">Stop — where the idea is wrong</div>
      <div className="flex flex-wrap gap-1.5">
        {cands.map((c) => (
          <button key={c.key} onClick={() => setStopKey(c.key)} title={c.why}
            className={`rounded border px-2 py-1 text-left text-[11px] ${active === c.key ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200' : 'border-neutral-800 text-neutral-400 hover:text-neutral-200'}`}>
            {c.label} <span className="font-mono">{f2(c.level)}</span>
            <span className="ml-1 font-mono text-[10px] text-neutral-500">−{c.distPct}%{c.atrs != null ? ` · ${c.atrs} ATR` : ''}</span>
          </button>
        ))}
        <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] ${active === 'custom' ? 'border-emerald-500/50' : 'border-neutral-800'} text-neutral-400`}>
          Custom
          <input type="number" step="0.01" value={customStop} onChange={(e) => { setCustomStop(e.target.value); setStopKey('custom'); }} onFocus={() => setStopKey('custom')}
            aria-label="Custom stop" className="w-20 bg-transparent font-mono text-neutral-100 focus:outline-none" />
        </span>
      </div>

      {!size ? (
        <div className="mt-3 text-[13px] text-neutral-500">{stop == null ? 'Pick or type a stop below the entry.' : 'The stop has to be below the entry.'}</div>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded border border-neutral-800 px-3 py-2.5">
            {size.shares > 0 ? (
              <>
                <div className="text-[18px] text-neutral-100">
                  Buy <span className="font-mono font-semibold">{size.shares}</span> shares
                  <span className="ml-2 font-mono text-[14px] text-neutral-400">≈ {money(size.cost)} · {size.costPctAccount}% of account</span>
                </div>
                <div className="mt-1 text-[13px] text-neutral-300">
                  If the stop at <span className="font-mono">{f2(stop)}</span> hits: lose <span className="font-mono text-rose-300">{money(size.risk)}</span>
                  <span className="text-neutral-500"> ({size.riskPctAccount}% of account, {money(size.perShare, 2)}/share)</span>
                </div>
                <div className="mt-1 font-mono text-[12px] text-neutral-400">2R {f2(size.target2R)} · 3R {f2(size.target3R)}</div>
              </>
            ) : (
              <div className="text-[14px] text-rose-300">0 shares — {size.bindingLabel} leaves no room for this trade.</div>
            )}
            <Link to={`/journal?${new URLSearchParams({ ticker: sym, price: f2(entry), stop: f2(stop), ...(size.shares ? { qty: String(size.shares) } : {}), ...(setup ? { setup: 'top_setup' } : {}) })}`}
              className="mt-2.5 inline-block rounded border border-neutral-700 px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-neutral-300 hover:border-emerald-500/40 hover:text-emerald-300">
              Log trade with this size
            </Link>
          </div>
          <CapList caps={size.caps.map((c) => ({ ...c, val: `${c.shares} sh` }))} binding={size.binding} footer={
            <>Full-size risk {money(size.base)} × conditions {Math.round(size.mult * 100)}% = {money(size.adj)} ÷ {money(size.perShare, 2)}/share. The smallest limit wins.{a.onePrice ? ' Pre-market: entry is the live price; the open can gap.' : ''}</>
          } />
        </div>
      )}
    </div>
  );
}

function CapList({ caps, binding, footer }) {
  return (
    <div className="rounded border border-neutral-800 px-3 py-2.5 text-[12px]">
      <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-neutral-500">Limits checked</div>
      {caps.map((c) => (
        <div key={c.key} className={`flex justify-between gap-3 py-0.5 ${c.key === binding ? 'text-neutral-100' : 'text-neutral-500'}`}>
          <span>{c.key === binding ? '▸ ' : ''}{c.label}</span>
          <span className="font-mono tabular-nums">{c.val}{c.key === binding ? ' ← sets size' : ''}</span>
        </div>
      ))}
      <div className="mt-1.5 border-t border-neutral-900 pt-1.5 text-[11px] leading-snug text-neutral-600">{footer}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
function OptionsPlan({ sym, a, base, optionsOpen, stop }) {
  const [st, setSt] = useState({ for: null, data: null, error: null });
  useEffect(() => {
    let live = true;
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/options?symbol=${sym}`);
        const js = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(js.error || `HTTP ${r.status}`);
        if (live) setSt({ for: sym, data: js, error: null });
      } catch (e) {
        if (live) setSt({ for: sym, data: null, error: e.message || 'Failed' });
      }
    }, 0);
    return () => { live = false; clearTimeout(id); };
  }, [sym]);

  const loading = st.for !== sym;
  const picks = useMemo(() => (st.data ? pickCalls(st.data.chains, a.price, dteOf) : []), [st.data, a.price]);

  if (loading) return <div className="flex items-center gap-2 px-4 py-4 text-[12px] text-neutral-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the option chain…</div>;
  if (st.error) return <div className="px-4 py-4 text-[12px] text-rose-300">Option chain unavailable: {st.error}</div>;
  if (!st.data?.picked?.length) return <div className="px-4 py-4 text-[12px] text-neutral-500">No listed options 21+ days out for {sym}.</div>;

  return (
    <div className="px-4 py-3">
      <div className="mb-2 text-[12px] leading-snug text-neutral-400">
        Calls only, 21+ and 45+ days out (a 2–10 day hold shouldn't fight fast time decay). Only contracts with a two-sided market,
        spread ≤ 10% and open interest ≥ 100. <span className="text-neutral-300">Sized so the whole premium is the risk</span> — an option can go to zero even if the stock only dips.
      </div>
      {picks.length === 0 && <div className="text-[12px] text-amber-300/90">Nothing liquid enough in {st.data.picked.join(', ')} — wide spreads cost you on the way in and out. Shares are the cleaner trade here.</div>}
      <div className="grid gap-3 lg:grid-cols-2">
        {picks.map((p) => {
          const sz = sizeOption({ ...base, perContract: p.perContract, optionsOpen });
          const desc = `${p.strike}C ${p.exp.slice(5).replace('-', '/')}`;
          const atStop = stop != null && p.delta != null ? (a.price - stop) * p.delta * 100 : null;
          return (
            <div key={`${p.exp}-${p.strike}`} className="rounded border border-neutral-800 px-3 py-2.5 text-[12px]">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-[15px] font-semibold text-neutral-100">{sym} {desc}</span>
                <span className="text-[11px] text-neutral-500">{p.dte} days · {p.kind === 'itm' ? 'in the money' : 'at the money'}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-neutral-500">{p.why}</div>
              <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 font-mono tabular-nums">
                <Kv k="Bid / ask" v={`${f2(p.bid)} / ${f2(p.ask)}`} />
                <Kv k="Spread" v={`${p.spreadPct}%`} />
                <Kv k="Delta" v={p.delta != null ? p.delta.toFixed(2) : '—'} />
                <Kv k="Breakeven" v={`${f2(p.breakeven)} (+${p.breakevenPct}%)`} warn={p.breakevenPct > 8} />
                <Kv k="Decay / day" v={p.thetaDay != null ? money(Math.abs(p.thetaDay)) : '—'} />
                <Kv k="IV · OI" v={`${p.iv != null ? `${p.iv}%` : '—'} · ${p.oi?.toLocaleString() ?? '—'}`} />
              </div>
              <div className="mt-2.5 border-t border-neutral-900 pt-2">
                {sz.contracts > 0 ? (
                  <div className="text-[14px] text-neutral-100">
                    Buy <span className="font-mono font-semibold">{sz.contracts}</span> contract{sz.contracts > 1 ? 's' : ''}
                    <span className="ml-1.5 font-mono text-[12px] text-neutral-400">≈ {money(sz.cost)} at the ask = max loss</span>
                  </div>
                ) : (
                  <div className="text-[13px] text-rose-300">0 contracts — one costs {money(p.perContract)}; {sz.bindingLabel.toLowerCase()} is smaller.</div>
                )}
                <div className="mt-0.5 text-[11px] text-neutral-500">Set by: {sz.bindingLabel}{sz.binding !== 'risk' ? ` (risk budget allows ${sz.caps[0].n})` : ''}</div>
                {atStop != null && sz.contracts > 0 && (
                  <div className="mt-0.5 text-[11px] text-neutral-600">If the stock hits your {f2(stop)} stop: roughly −{money(atStop * sz.contracts)} (delta only; IV and time make it worse).</div>
                )}
                <Link to={`/journal?${new URLSearchParams({ ticker: sym, instrument: 'option', option: desc, price: f2(p.ask), ...(sz.contracts ? { qty: String(sz.contracts) } : {}) })}`}
                  className="mt-2 inline-block rounded border border-neutral-700 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-neutral-300 hover:border-emerald-500/40 hover:text-emerald-300">
                  Log this option
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Kv({ k, v, warn }) {
  return (
    <div>
      <div className="font-sans text-[10px] text-neutral-600">{k}</div>
      <div className={warn ? 'text-amber-300' : 'text-neutral-200'}>{v}</div>
    </div>
  );
}
