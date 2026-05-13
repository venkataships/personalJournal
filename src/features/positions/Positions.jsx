import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  AlertCircle,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Wallet,
  TrendingUp,
  CircleDollarSign,
} from 'lucide-react';
import { supabase, authReady } from '../../lib/supabase';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ACCOUNT_TYPES = [
  { id: 'taxable',         label: 'Taxable' },
  { id: 'roth_ira',        label: 'Roth IRA' },
  { id: 'traditional_ira', label: 'Trad. IRA' },
  { id: 'joint',           label: 'Joint' },
];

const OPTION_STATUSES = [
  { id: 'open',     label: 'Open' },
  { id: 'closed',   label: 'Closed' },
  { id: 'expired',  label: 'Expired' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'rolled',   label: 'Rolled' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtUSD(n, maxFractionDigits = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: maxFractionDigits,
  });
}

function fmtNum(n, maxFractionDigits = 4) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: maxFractionDigits });
}

function toNum(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function accountLabel(id) {
  return ACCOUNT_TYPES.find((a) => a.id === id)?.label ?? id;
}

// ---------------------------------------------------------------------------
// Data layer
// ---------------------------------------------------------------------------

async function loadAll() {
  await authReady();
  const [stocksRes, optsRes, cashRes] = await Promise.all([
    supabase.from('positions')
      .select('*')
      .order('ticker', { ascending: true }),
    supabase.from('options_positions')
      .select('*')
      .order('status', { ascending: true })
      .order('expiry', { ascending: true }),
    supabase.from('cash_balance')
      .select('*')
      .order('account_type', { ascending: true }),
  ]);
  if (stocksRes.error) throw stocksRes.error;
  if (optsRes.error) throw optsRes.error;
  if (cashRes.error) throw cashRes.error;
  return {
    stocks: stocksRes.data || [],
    options: optsRes.data || [],
    cash: cashRes.data || [],
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Positions() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ stocks: [], options: [], cash: [] });

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const next = await loadAll();
      setData(next);
    } catch (e) {
      setError(e.message || 'Failed to load.');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const next = await loadAll();
        if (!cancelled) setData(next);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Derived totals
  const totals = useMemo(() => {
    const stockCost = data.stocks.reduce(
      (s, p) => s + (Number(p.shares) || 0) * (Number(p.avg_cost) || 0),
      0,
    );
    const openOptionsCost = data.options
      .filter((o) => o.status === 'open')
      .reduce(
        (s, o) => s + (Number(o.premium_per_contract) || 0) * (Number(o.contracts) || 0) * 100,
        0,
      );
    const totalCash = data.cash.reduce((s, c) => s + (Number(c.amount) || 0), 0);
    return { stockCost, openOptionsCost, totalCash };
  }, [data]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 font-sans antialiased selection:bg-emerald-500/30">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <div className="relative mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
        {/* Header */}
        <header className="mb-10">
          <Link
            to="/trading"
            className="inline-flex items-center gap-1.5 mb-3 text-[11px] uppercase tracking-[0.22em] text-neutral-500 hover:text-emerald-400 transition-colors"
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={2} />
            Trading
          </Link>
          <h1 className="text-3xl font-light tracking-tight text-neutral-100 sm:text-4xl">
            Positions
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            What you own right now. Updated by hand; read by the bot.
          </p>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[13px] text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span className="break-all">{error}</span>
            </div>
          )}
        </header>

        {/* Totals strip */}
        <section
          aria-label="Totals"
          className="mb-12 grid grid-cols-1 gap-3 rounded-md border border-neutral-800 bg-neutral-950/40 px-5 py-4 sm:grid-cols-3"
        >
          <Total icon={TrendingUp}        label="Stock cost basis"  value={fmtUSD(totals.stockCost, 0)} />
          <Total icon={CircleDollarSign}  label="Options at risk"   value={fmtUSD(totals.openOptionsCost, 0)} />
          <Total icon={Wallet}            label="Cash"              value={fmtUSD(totals.totalCash, 0)} />
        </section>

        {loading ? (
          <div className="text-sm text-neutral-500">Loading…</div>
        ) : (
          <>
            <StocksSection stocks={data.stocks}   onChange={refresh} setError={setError} />
            <OptionsSection options={data.options} onChange={refresh} setError={setError} />
            <CashSection    cash={data.cash}      onChange={refresh} setError={setError} />
          </>
        )}

        <footer className="pt-6 mt-12 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-700">
          Hold what matters.
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Totals tile
// ---------------------------------------------------------------------------

function Total({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 shrink-0 text-emerald-400/80" strokeWidth={1.75} />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{label}</div>
        <div className="font-mono text-lg font-medium tabular-nums text-neutral-100 truncate">
          {value}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// STOCKS SECTION
// ===========================================================================

function StocksSection({ stocks, onChange, setError }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);

  return (
    <section className="mb-14">
      <SectionHeader
        label="Stocks"
        countText={`${stocks.length} ${stocks.length === 1 ? 'position' : 'positions'}`}
        onAdd={() => { setAdding(true); setEditingId(null); }}
        addLabel="Add position"
      />

      <div className="mt-4 overflow-hidden rounded-md border border-neutral-800 bg-neutral-950/40">
        <StockHeaderRow />

        {/* Add row */}
        {adding && (
          <StockEditRow
            initial={{}}
            isNew
            onCancel={() => setAdding(false)}
            onSaved={() => { setAdding(false); onChange(); }}
            setError={setError}
          />
        )}

        {/* Body */}
        {stocks.length === 0 && !adding && (
          <div className="px-4 py-6 text-center text-[13px] text-neutral-600">
            No stock positions yet.
          </div>
        )}

        {stocks.map((s) => (
          editingId === s.id ? (
            <StockEditRow
              key={s.id}
              initial={s}
              onCancel={() => setEditingId(null)}
              onSaved={() => { setEditingId(null); onChange(); }}
              setError={setError}
            />
          ) : (
            <StockRow
              key={s.id}
              row={s}
              onEdit={() => { setEditingId(s.id); setAdding(false); }}
              onDeleted={onChange}
              setError={setError}
            />
          )
        ))}
      </div>
    </section>
  );
}

function StockHeaderRow() {
  return (
    <div className="hidden sm:grid grid-cols-[1.2fr_1fr_1fr_1fr_1.5fr_auto] items-center gap-3 px-4 py-2.5 border-b border-neutral-800 text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-500">
      <div>Ticker</div>
      <div className="text-right">Shares</div>
      <div className="text-right">Avg cost</div>
      <div>Account</div>
      <div>Notes</div>
      <div className="w-[80px]"></div>
    </div>
  );
}

function StockRow({ row, onEdit, onDeleted, setError }) {
  const [busy, setBusy] = useState(false);
  const costBasis = (Number(row.shares) || 0) * (Number(row.avg_cost) || 0);

  const onDelete = async () => {
    if (!window.confirm(`Delete ${row.ticker}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await authReady();
      const { error } = await supabase.from('positions').delete().eq('id', row.id);
      if (error) throw error;
      onDeleted();
    } catch (e) {
      setError(e.message || 'Delete failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-[1.2fr_1fr_1fr_1fr_1.5fr_auto] items-center gap-3 px-4 py-3 border-b border-neutral-900 last:border-b-0 text-[13px]">
      <div className="font-mono uppercase tracking-wider text-neutral-100 col-span-2 sm:col-span-1 sm:text-left">
        {row.ticker}
        <span className="ml-2 sm:hidden font-sans normal-case text-[11px] text-neutral-600">
          {accountLabel(row.account_type)}
        </span>
      </div>
      <div className="font-mono tabular-nums text-neutral-200 text-right">
        {fmtNum(row.shares)}
      </div>
      <div className="font-mono tabular-nums text-neutral-200 text-right">
        {fmtUSD(row.avg_cost)}
      </div>
      <div className="hidden sm:block text-neutral-400">{accountLabel(row.account_type)}</div>
      <div className="hidden sm:block text-neutral-500 truncate" title={row.notes || ''}>
        {row.notes || <span className="text-neutral-700">—</span>}
      </div>
      <div className="flex items-center justify-end gap-1 col-span-2 sm:col-span-1">
        <span className="mr-2 hidden sm:inline font-mono text-[11px] text-neutral-600 tabular-nums">
          {fmtUSD(costBasis, 0)}
        </span>
        <IconBtn onClick={onEdit} label="Edit" disabled={busy}><Pencil className="h-3.5 w-3.5" strokeWidth={1.75} /></IconBtn>
        <IconBtn onClick={onDelete} label="Delete" disabled={busy} danger><Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} /></IconBtn>
      </div>
    </div>
  );
}

function StockEditRow({ initial, isNew, onCancel, onSaved, setError }) {
  const [ticker,   setTicker]   = useState(initial.ticker || '');
  const [shares,   setShares]   = useState(initial.shares ?? '');
  const [avgCost,  setAvgCost]  = useState(initial.avg_cost ?? '');
  const [account,  setAccount]  = useState(initial.account_type || 'taxable');
  const [notes,    setNotes]    = useState(initial.notes || '');
  const [saving,   setSaving]   = useState(false);

  const tickerUpper = ticker.toUpperCase().trim();
  const sharesNum   = toNum(shares);
  const avgCostNum  = toNum(avgCost);
  const canSave =
    !saving &&
    tickerUpper.length > 0 &&
    sharesNum != null && sharesNum > 0 &&
    avgCostNum != null && avgCostNum > 0;

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await authReady();
      const payload = {
        ticker: tickerUpper,
        shares: sharesNum,
        avg_cost: avgCostNum,
        account_type: account,
        notes: notes.trim() || null,
        updated_at: new Date().toISOString(),
      };
      const q = isNew
        ? supabase.from('positions').insert(payload)
        : supabase.from('positions').update(payload).eq('id', initial.id);
      const { error } = await q;
      if (error) throw error;
      onSaved();
    } catch (e) {
      setError(e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-[1.2fr_1fr_1fr_1fr_1.5fr_auto] items-center gap-2 px-4 py-3 border-b border-neutral-900 bg-emerald-500/[0.03] text-[13px]">
      <TickerInput   value={ticker}  onChange={setTicker}  placeholder="AMZN" />
      <NumberCell    value={shares}  onChange={setShares}  placeholder="100" />
      <MoneyCell     value={avgCost} onChange={setAvgCost} placeholder="180.50" />
      <AccountSelect value={account} onChange={setAccount} />
      <TextCell      value={notes}   onChange={setNotes}   placeholder="Optional notes" />
      <div className="flex items-center justify-end gap-1 col-span-2 sm:col-span-1">
        <IconBtn onClick={onSave}   label="Save"   disabled={!canSave} primary><Check className="h-3.5 w-3.5" strokeWidth={2.25} /></IconBtn>
        <IconBtn onClick={onCancel} label="Cancel" disabled={saving}><X className="h-3.5 w-3.5" strokeWidth={2.25} /></IconBtn>
      </div>
    </div>
  );
}

// ===========================================================================
// OPTIONS SECTION
// ===========================================================================

function OptionsSection({ options, onChange, setError }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const openCount = options.filter((o) => o.status === 'open').length;

  return (
    <section className="mb-14">
      <SectionHeader
        label="Options"
        countText={`${openCount} open · ${options.length} total`}
        onAdd={() => { setAdding(true); setEditingId(null); }}
        addLabel="Add option"
      />

      <div className="mt-4 overflow-hidden rounded-md border border-neutral-800 bg-neutral-950/40">
        <OptionHeaderRow />

        {adding && (
          <OptionEditRow
            initial={{}}
            isNew
            onCancel={() => setAdding(false)}
            onSaved={() => { setAdding(false); onChange(); }}
            setError={setError}
          />
        )}

        {options.length === 0 && !adding && (
          <div className="px-4 py-6 text-center text-[13px] text-neutral-600">
            No options positions yet.
          </div>
        )}

        {options.map((o) => (
          editingId === o.id ? (
            <OptionEditRow
              key={o.id}
              initial={o}
              onCancel={() => setEditingId(null)}
              onSaved={() => { setEditingId(null); onChange(); }}
              setError={setError}
            />
          ) : (
            <OptionRow
              key={o.id}
              row={o}
              onEdit={() => { setEditingId(o.id); setAdding(false); }}
              onDeleted={onChange}
              setError={setError}
            />
          )
        ))}
      </div>
    </section>
  );
}

function OptionHeaderRow() {
  return (
    <div className="hidden sm:grid grid-cols-[1fr_0.7fr_0.7fr_1fr_0.6fr_0.9fr_0.9fr_auto] items-center gap-3 px-4 py-2.5 border-b border-neutral-800 text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-500">
      <div>Ticker</div>
      <div className="text-right">Strike</div>
      <div className="text-right">Type</div>
      <div>Expiry</div>
      <div className="text-right">Cts</div>
      <div className="text-right">Premium</div>
      <div>Status</div>
      <div className="w-[80px]"></div>
    </div>
  );
}

function OptionRow({ row, onEdit, onDeleted, setError }) {
  const [busy, setBusy] = useState(false);
  const isOpen = row.status === 'open';

  const onDelete = async () => {
    if (!window.confirm(`Delete ${row.ticker} ${row.strike}${row.type[0].toUpperCase()}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await authReady();
      const { error } = await supabase.from('options_positions').delete().eq('id', row.id);
      if (error) throw error;
      onDeleted();
    } catch (e) {
      setError(e.message || 'Delete failed.');
    } finally {
      setBusy(false);
    }
  };

  const statusTone =
    row.status === 'open'     ? 'text-emerald-300'
  : row.status === 'closed'   ? 'text-neutral-500'
  : row.status === 'expired'  ? 'text-neutral-600'
  : row.status === 'assigned' ? 'text-amber-300'
  : row.status === 'rolled'   ? 'text-sky-300'
  : 'text-neutral-400';

  return (
    <div className={`grid grid-cols-2 sm:grid-cols-[1fr_0.7fr_0.7fr_1fr_0.6fr_0.9fr_0.9fr_auto] items-center gap-3 px-4 py-3 border-b border-neutral-900 last:border-b-0 text-[13px] ${!isOpen ? 'opacity-60' : ''}`}>
      <div className="font-mono uppercase tracking-wider text-neutral-100 col-span-2 sm:col-span-1">
        {row.ticker}
        <span className="ml-2 sm:hidden font-sans normal-case text-[11px] text-neutral-500">
          {row.strike} {row.type.toUpperCase()} {row.expiry}
        </span>
      </div>
      <div className="hidden sm:block font-mono tabular-nums text-neutral-200 text-right">{fmtUSD(row.strike)}</div>
      <div className="hidden sm:block font-mono uppercase text-neutral-300 text-right text-[12px]">{row.type}</div>
      <div className="hidden sm:block font-mono text-neutral-400 text-[12px]">{row.expiry}</div>
      <div className="hidden sm:block font-mono tabular-nums text-neutral-200 text-right">{row.contracts}</div>
      <div className="hidden sm:block font-mono tabular-nums text-neutral-200 text-right">
        {row.premium_per_contract != null ? fmtUSD(row.premium_per_contract) : '—'}
      </div>
      <div className={`hidden sm:block font-mono uppercase text-[11px] ${statusTone}`}>{row.status}</div>
      <div className="flex items-center justify-end gap-1 col-span-2 sm:col-span-1">
        <IconBtn onClick={onEdit} label="Edit" disabled={busy}><Pencil className="h-3.5 w-3.5" strokeWidth={1.75} /></IconBtn>
        <IconBtn onClick={onDelete} label="Delete" disabled={busy} danger><Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} /></IconBtn>
      </div>
    </div>
  );
}

function OptionEditRow({ initial, isNew, onCancel, onSaved, setError }) {
  const [ticker,    setTicker]    = useState(initial.ticker || '');
  const [strike,    setStrike]    = useState(initial.strike ?? '');
  const [type,      setType]      = useState(initial.type || 'call');
  const [expiry,    setExpiry]    = useState(initial.expiry || '');
  const [contracts, setContracts] = useState(initial.contracts ?? 1);
  const [premium,   setPremium]   = useState(initial.premium_per_contract ?? '');
  const [underlying, setUnderlying] = useState(initial.underlying_price_at_open ?? '');
  const [account,   setAccount]   = useState(initial.account_type || 'taxable');
  const [status,    setStatus]    = useState(initial.status || 'open');
  const [notes,     setNotes]     = useState(initial.notes || '');
  const [saving,    setSaving]    = useState(false);

  // Close-fields, only meaningful when status !== 'open'
  const [closedAt,         setClosedAt]         = useState(initial.closed_at ? initial.closed_at.split('T')[0] : '');
  const [closePremium,     setClosePremium]     = useState(initial.close_premium_per_contract ?? '');
  const [realizedPnl,      setRealizedPnl]      = useState(initial.realized_pnl ?? '');

  const tickerUpper = ticker.toUpperCase().trim();
  const strikeNum   = toNum(strike);
  const contractsNum = toNum(contracts);
  const canSave =
    !saving &&
    tickerUpper.length > 0 &&
    strikeNum != null && strikeNum > 0 &&
    !!expiry &&
    contractsNum != null && contractsNum > 0;

  const showCloseFields = status !== 'open';

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await authReady();
      const payload = {
        ticker: tickerUpper,
        strike: strikeNum,
        type,
        expiry,
        contracts: contractsNum,
        premium_per_contract: toNum(premium),
        underlying_price_at_open: toNum(underlying),
        account_type: account,
        status,
        notes: notes.trim() || null,
        closed_at: showCloseFields && closedAt ? new Date(closedAt).toISOString() : null,
        close_premium_per_contract: showCloseFields ? toNum(closePremium) : null,
        realized_pnl: showCloseFields ? toNum(realizedPnl) : null,
        updated_at: new Date().toISOString(),
      };
      const q = isNew
        ? supabase.from('options_positions').insert(payload)
        : supabase.from('options_positions').update(payload).eq('id', initial.id);
      const { error } = await q;
      if (error) throw error;
      onSaved();
    } catch (e) {
      setError(e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-b border-neutral-900 bg-emerald-500/[0.03] px-4 py-3">
      <div className="grid grid-cols-2 sm:grid-cols-[1fr_0.7fr_0.7fr_1fr_0.6fr_0.9fr_0.9fr_auto] items-center gap-2 text-[13px]">
        <TickerInput value={ticker} onChange={setTicker} placeholder="AMZN" />
        <MoneyCell   value={strike} onChange={setStrike} placeholder="250" />
        <SelectCell  value={type}   onChange={setType}   options={[{id:'call',label:'Call'},{id:'put',label:'Put'}]} />
        <DateCell    value={expiry} onChange={setExpiry} />
        <NumberCell  value={contracts} onChange={setContracts} placeholder="1" integer />
        <MoneyCell   value={premium} onChange={setPremium} placeholder="3.50" />
        <SelectCell  value={status}  onChange={setStatus}  options={OPTION_STATUSES} />
        <div className="flex items-center justify-end gap-1 col-span-2 sm:col-span-1">
          <IconBtn onClick={onSave}   label="Save"   disabled={!canSave} primary><Check className="h-3.5 w-3.5" strokeWidth={2.25} /></IconBtn>
          <IconBtn onClick={onCancel} label="Cancel" disabled={saving}><X className="h-3.5 w-3.5" strokeWidth={2.25} /></IconBtn>
        </div>
      </div>

      {/* Secondary row — fields that don't fit the main grid */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[13px]">
        <LabeledCell label="Account">
          <AccountSelect value={account} onChange={setAccount} />
        </LabeledCell>
        <LabeledCell label="Underlying @ open">
          <MoneyCell value={underlying} onChange={setUnderlying} placeholder="240" />
        </LabeledCell>
        <LabeledCell label="Notes" className="col-span-2">
          <TextCell value={notes} onChange={setNotes} placeholder="Strategy, thesis…" />
        </LabeledCell>
      </div>

      {showCloseFields && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-[13px]">
          <LabeledCell label="Closed at">
            <DateCell value={closedAt} onChange={setClosedAt} />
          </LabeledCell>
          <LabeledCell label="Close premium/ct">
            <MoneyCell value={closePremium} onChange={setClosePremium} placeholder="5.20" />
          </LabeledCell>
          <LabeledCell label="Realized P&L">
            <MoneyCell value={realizedPnl} onChange={setRealizedPnl} placeholder="170" />
          </LabeledCell>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// CASH SECTION
// ===========================================================================

function CashSection({ cash, onChange, setError }) {
  // Cash is one row per account_type (already seeded). No add/delete here —
  // just inline edit of the amount.
  return (
    <section className="mb-10">
      <SectionHeader
        label="Cash"
        countText={`${cash.length} accounts`}
      />

      <div className="mt-4 overflow-hidden rounded-md border border-neutral-800 bg-neutral-950/40">
        {cash.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px] text-neutral-600">
            No cash rows. Run the migration seed.
          </div>
        ) : (
          cash.map((c) => (
            <CashRow key={c.account_type} row={c} onSaved={onChange} setError={setError} />
          ))
        )}
      </div>
    </section>
  );
}

function CashRow({ row, onSaved, setError }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]   = useState(row.amount ?? 0);
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    const v = toNum(draft);
    if (v == null || v < 0) return;
    setSaving(true);
    try {
      await authReady();
      const { error } = await supabase
        .from('cash_balance')
        .update({ amount: v, last_updated: new Date().toISOString() })
        .eq('account_type', row.account_type);
      if (error) throw error;
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-900 last:border-b-0">
      <div className="flex-1">
        <div className="text-[13px] text-neutral-200">{accountLabel(row.account_type)}</div>
        <div className="text-[10px] font-mono text-neutral-600">
          Last updated {row.last_updated ? new Date(row.last_updated).toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : '—'}
        </div>
      </div>
      {editing ? (
        <>
          <div className="w-32">
            <MoneyCell value={draft} onChange={setDraft} placeholder="0" />
          </div>
          <IconBtn onClick={onSave}   label="Save"   disabled={saving} primary><Check className="h-3.5 w-3.5" strokeWidth={2.25} /></IconBtn>
          <IconBtn onClick={() => { setEditing(false); setDraft(row.amount); }} label="Cancel" disabled={saving}><X className="h-3.5 w-3.5" strokeWidth={2.25} /></IconBtn>
        </>
      ) : (
        <>
          <div className="font-mono text-[15px] tabular-nums text-neutral-100">
            {fmtUSD(row.amount, 2)}
          </div>
          <IconBtn onClick={() => setEditing(true)} label="Edit"><Pencil className="h-3.5 w-3.5" strokeWidth={1.75} /></IconBtn>
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Generic primitives
// ===========================================================================

function SectionHeader({ label, countText, onAdd, addLabel }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-[0.22em] text-neutral-500">
          {label}
        </div>
        <div className="mt-1 font-mono text-[11px] text-neutral-600">{countText}</div>
      </div>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[12px] font-medium uppercase tracking-[0.12em] text-emerald-200 hover:bg-emerald-500/15 hover:border-emerald-500/60 transition-colors active:scale-[0.98]"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
          {addLabel}
        </button>
      )}
    </div>
  );
}

function IconBtn({ onClick, label, disabled, primary, danger, children }) {
  const cls = primary
    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/20'
    : danger
    ? 'border-neutral-800 text-neutral-500 hover:border-red-500/40 hover:text-red-400 hover:bg-red-500/5'
    : 'border-neutral-800 text-neutral-500 hover:border-neutral-700 hover:text-neutral-200';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`inline-flex h-7 w-7 items-center justify-center rounded border transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}
    >
      {children}
    </button>
  );
}

function TickerInput({ value, onChange, placeholder }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value.toUpperCase())}
      placeholder={placeholder}
      maxLength={6}
      className="w-full rounded border border-neutral-800 bg-neutral-950/60 px-2 py-1.5 font-mono text-[13px] uppercase tracking-wider text-neutral-100 placeholder:text-neutral-700 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
    />
  );
}

function NumberCell({ value, onChange, placeholder, integer }) {
  return (
    <input
      type="number"
      step={integer ? '1' : 'any'}
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded border border-neutral-800 bg-neutral-950/60 px-2 py-1.5 font-mono text-[13px] tabular-nums text-neutral-100 text-right placeholder:text-neutral-700 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
    />
  );
}

function MoneyCell({ value, onChange, placeholder }) {
  return (
    <div className="relative">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-600 text-[11px]">$</span>
      <input
        type="number"
        step="any"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-neutral-800 bg-neutral-950/60 pl-5 pr-2 py-1.5 font-mono text-[13px] tabular-nums text-neutral-100 text-right placeholder:text-neutral-700 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
      />
    </div>
  );
}

function TextCell({ value, onChange, placeholder }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded border border-neutral-800 bg-neutral-950/60 px-2 py-1.5 text-[13px] text-neutral-200 placeholder:text-neutral-700 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
    />
  );
}

function DateCell({ value, onChange }) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-neutral-800 bg-neutral-950/60 px-2 py-1.5 font-mono text-[12px] text-neutral-200 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
    />
  );
}

function SelectCell({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-neutral-800 bg-neutral-950/60 px-2 py-1.5 text-[13px] text-neutral-200 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.label}</option>
      ))}
    </select>
  );
}

function AccountSelect({ value, onChange }) {
  return (
    <SelectCell value={value} onChange={onChange} options={ACCOUNT_TYPES} />
  );
}

function LabeledCell({ label, className = '', children }) {
  return (
    <div className={className}>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-neutral-600">{label}</div>
      {children}
    </div>
  );
}
