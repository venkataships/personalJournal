import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  AlertCircle,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Briefcase,
  ChevronDown,
  ChevronUp,
  Search,
} from 'lucide-react';
import { supabase, authReady } from '../../lib/supabase';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SENTIMENTS = [
  { id: 'bullish',  label: 'Bullish',  emoji: '🟢' },
  { id: 'neutral',  label: 'Neutral',  emoji: '🟡' },
  { id: 'bearish',  label: 'Bearish',  emoji: '🔴' },
];

const EMPTY_FORM = {
  ticker: '',
  category: '',
  sentiment: 'neutral',
  thesis: '',
  stage: '',
  timeframe: '',
  source: '',
  tags: '',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sentimentEmoji(s) {
  return SENTIMENTS.find((x) => x.id === s)?.emoji ?? '🟡';
}

function truncate(text, len = 80) {
  if (!text) return '';
  return text.length <= len ? text : text.slice(0, len).trimEnd() + '…';
}

// Monday of the current week in YYYY-MM-DD (local time).
// Matches how the bot likely keys weekly focus entries.
function currentWeekStart() {
  const d = new Date();
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// ---------------------------------------------------------------------------
// Data layer
// ---------------------------------------------------------------------------

async function fetchWatchlist() {
  await authReady();
  const { data, error } = await supabase
    .from('watchlist_with_daily')
    .select('*')
    .order('ticker', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchPositionTickers() {
  await authReady();
  const { data, error } = await supabase
    .from('positions')
    .select('ticker');
  if (error) throw error;
  return new Set((data || []).map((r) => r.ticker.toUpperCase()));
}

// Fetch live prices via /api/quotes serverless function.
// Returns Map<ticker, { price, sessionChangePct, extendedChangePct, isExtendedHours }>
// Same logic as Intelligence briefs — both session and extended hours change.
async function fetchPrices(tickers) {
  if (!tickers.length) return new Map();
  const unique = [...new Set(tickers.map((t) => t.toUpperCase()))];
  // Batch in chunks of 50 to stay within URL length limits
  const CHUNK = 50;
  const map = new Map();
  for (let i = 0; i < unique.length; i += CHUNK) {
    const symbols = unique.slice(i, i + CHUNK).join(',');
    try {
      const res = await fetch(`/api/quotes?symbols=${symbols}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const [sym, q] of Object.entries(data)) {
        if (!q || q.price == null) continue;
        map.set(sym.toUpperCase(), {
          price:             q.price,
          sessionChangePct:  q.sessionChangePct  ?? null,
          extendedChangePct: q.extendedChangePct ?? null,
          isExtendedHours:   q.isExtendedHours   ?? false,
        });
      }
    } catch { /* non-fatal — prices degrade gracefully */ }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Watchlist() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);
  const [positionTickers, setPositionTickers] = useState(new Set());
  const [activeCategory, setActiveCategory] = useState(null);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState('');
  const [priceMap, setPriceMap] = useState(new Map());
  const [pricesLoading, setPricesLoading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [wl, pos] = await Promise.all([fetchWatchlist(), fetchPositionTickers()]);
      setItems(wl);
      setPositionTickers(pos);
    } catch (e) {
      setError(e.message || 'Failed to load.');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [load]);

  // Fetch live prices once items are loaded — fires whenever items change
  useEffect(() => {
    if (!items.length) return;
    let cancelled = false;
    setPricesLoading(true);
    const tickers = items.map((r) => r.ticker);
    fetchPrices(tickers).then((map) => {
      if (!cancelled) setPriceMap(map);
    }).finally(() => {
      if (!cancelled) setPricesLoading(false);
    });
    return () => { cancelled = true; };
  }, [items]);

  // Build groups: real category groups + synthetic 'daily' from in_daily_focus.
  // Same row object appears in both — no copies, no duplication.
  const groups = useMemo(() => {
    const g = {};
    for (const item of items) {
      const cat = item.category || 'Uncategorized';
      if (!g[cat]) g[cat] = [];
      g[cat].push(item);
    }
    const daily = items.filter((r) => r.in_daily_focus);
    if (daily.length > 0) g['daily'] = daily;
    return g;
  }, [items]);

  // Compute avg % change per group — uses extended if available, else session
  const groupAvg = useMemo(() => {
    const result = {};
    for (const [cat, tickers] of Object.entries(groups)) {
      const changes = tickers
        .map((r) => {
          const q = priceMap.get(r.ticker.toUpperCase());
          return q?.extendedChangePct ?? q?.sessionChangePct ?? null;
        })
        .filter((c) => c != null && Number.isFinite(c));
      result[cat] = changes.length
        ? changes.reduce((s, c) => s + c, 0) / changes.length
        : null;
    }
    return result;
  }, [groups, priceMap]);

  // daily pinned first, rest alphabetical
  const categories = useMemo(() => {
    const keys = Object.keys(groups);
    const others = keys.filter((k) => k !== 'daily').sort();
    return keys.includes('daily') ? ['daily', ...others] : others;
  }, [groups]);

  // Auto-select first category when data loads.
  useEffect(() => {
    if (categories.length > 0 && !activeCategory) {
      setActiveCategory(categories[0]);
    }
    if (activeCategory && categories.length > 0 && !categories.includes(activeCategory)) {
      setActiveCategory(categories[0]);
    }
  }, [categories, activeCategory]);

  const visibleItems = useMemo(() => {
    if (!activeCategory) return [];
    return groups[activeCategory] || [];
  }, [groups, activeCategory]);

  const countFor = (cat) => (groups[cat] || []).length;

  const openAdd  = () => setModal({ mode: 'add' });
  const openEdit = (row) => setModal({ mode: 'edit', row });
  const closeModal = () => setModal(null);

  const onSaved = useCallback((savedCategory) => {
    closeModal();
    load().then(() => {
      if (savedCategory) setActiveCategory(savedCategory);
    });
  }, [load]);

  const onSoftDelete = useCallback(async (row) => {
    if (!window.confirm(`Remove ${row.ticker} from watchlist?`)) return;
    try {
      await authReady();
      const { error: err } = await supabase
        .from('watchlist')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (err) throw err;
      load();
    } catch (e) {
      setError(e.message || 'Delete failed.');
    }
  }, [load]);

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

      <div className="relative mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        {/* Header */}
        <header className="mb-8">
          <Link
            to="/trading"
            className="inline-flex items-center gap-1.5 mb-3 text-[11px] uppercase tracking-[0.22em] text-neutral-500 hover:text-emerald-400 transition-colors"
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={2} />
            Trading
          </Link>
          <div className="flex items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-light tracking-tight text-neutral-100 sm:text-4xl">
                Watchlist
              </h1>
              <p className="mt-1.5 text-sm text-neutral-500">
                {items.length} active ticker{items.length !== 1 ? 's' : ''} across {categories.length} group{categories.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-500" strokeWidth={2} />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value.toUpperCase())}
                  placeholder="Search ticker…"
                  className="w-36 rounded-md border border-neutral-800 bg-neutral-950/60 pl-8 pr-3 py-2 text-[12px] font-mono uppercase text-neutral-100 placeholder:normal-case placeholder:text-neutral-600 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 transition-colors"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-600 hover:text-neutral-300"
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={openAdd}
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[12px] font-medium uppercase tracking-[0.12em] text-emerald-200 hover:bg-emerald-500/15 hover:border-emerald-500/60 transition-colors active:scale-[0.98]"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
                Add ticker
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[13px] text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span className="break-all">{error}</span>
            </div>
          )}
        </header>

        {loading ? (
          <div className="text-sm text-neutral-500">Loading…</div>
        ) : categories.length === 0 ? (
          <EmptyState onAdd={openAdd} />
        ) : (
          <>
            {search ? (
              /* ── Search results — cross-category, no tabs ── */
              <div className="rounded-md border border-neutral-800 bg-neutral-950/40 overflow-hidden">
                <TickerTableHeader showCategory />
                {items
                  .filter((r) => r.ticker.toUpperCase().includes(search))
                  .length === 0 ? (
                  <div className="px-4 py-8 text-center text-[13px] text-neutral-600">
                    No tickers match "{search}".
                  </div>
                ) : (
                  items
                    .filter((r) => r.ticker.toUpperCase().includes(search))
                    .map((row) => (
                      <TickerRow
                        key={row.id}
                        row={row}
                        inPositions={positionTickers.has(row.ticker.toUpperCase())}
                        showCategory
                        quote={priceMap.get(row.ticker.toUpperCase()) || null}
                        onEdit={() => openEdit(row)}
                        onDelete={() => onSoftDelete(row)}
                      />
                    ))
                )}
              </div>
            ) : (
              <>
                {/* Category tabs — dropdown on mobile, scrollable tabs on desktop */}
                <div className="mb-6">
                  {/* Mobile: native select dropdown */}
                  <div className="sm:hidden">
                    <select
                      value={activeCategory || ''}
                      onChange={(e) => setActiveCategory(e.target.value)}
                      className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2.5 text-[13px] font-medium uppercase tracking-[0.12em] text-emerald-300 focus:border-emerald-500/60 focus:outline-none"
                    >
                      {categories.map((cat) => {
                        const avg = groupAvg[cat];
                        const avgStr = avg != null
                          ? ` ${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%`
                          : '';
                        return (
                          <option key={cat} value={cat}>
                            {cat} ({countFor(cat)}){avgStr}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  {/* Desktop: scrollable tabs */}
                  <div className="hidden sm:flex items-end gap-1 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin', scrollbarColor: '#404040 transparent' }}>
                    {categories.map((cat) => {
                      const avg = groupAvg[cat];
                      const avgStr = avg != null
                        ? (avg >= 0 ? '+' : '') + avg.toFixed(2) + '%'
                        : pricesLoading ? '…' : null;
                      const avgColor = avg == null ? 'text-neutral-600'
                        : avg > 0 ? 'text-emerald-400'
                        : avg < 0 ? 'text-red-400'
                        : 'text-neutral-500';
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setActiveCategory(cat)}
                          className={`shrink-0 rounded-t-md border-t border-l border-r px-4 py-2 text-[12px] font-medium uppercase tracking-[0.15em] transition-colors ${
                            activeCategory === cat
                              ? 'border-neutral-700 bg-neutral-900 text-emerald-300'
                              : 'border-neutral-800/60 bg-neutral-950/40 text-neutral-500 hover:text-neutral-300'
                          }`}
                        >
                          {cat}
                          <span className={`ml-1.5 font-mono text-[10px] ${activeCategory === cat ? 'text-emerald-400/70' : 'text-neutral-700'}`}>
                            {countFor(cat)}
                          </span>
                          {avgStr && (
                            <span className={`ml-1.5 font-mono text-[10px] ${avgColor}`}>
                              {avgStr}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Ticker table */}
                <div className="rounded-md rounded-tl-none border border-neutral-800 bg-neutral-950/40 overflow-hidden">
                  <TickerTableHeader showCategory={activeCategory === 'daily'} />
                  {visibleItems.length === 0 ? (
                    <div className="px-4 py-8 text-center text-[13px] text-neutral-600">
                      No tickers in this group.
                    </div>
                  ) : (
                    visibleItems.map((row) => (
                      <TickerRow
                        key={`${activeCategory}-${row.id}`}
                        row={row}
                        inPositions={positionTickers.has(row.ticker.toUpperCase())}
                        showCategory={activeCategory === 'daily'}
                        quote={priceMap.get(row.ticker.toUpperCase()) || null}
                        onEdit={() => openEdit(row)}
                        onDelete={() => onSoftDelete(row)}
                      />
                    ))
                  )}
                </div>
              </>
            )}
          </>
        )}

        <footer className="mt-16 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-700">
          Know what you're watching.
        </footer>
      </div>

      {/* Modal */}
      {modal && (
        <WatchlistModal
          mode={modal.mode}
          row={modal.row}
          existingCategories={categories}
          allItems={items}
          onSaved={onSaved}
          onCancel={closeModal}
          setError={setError}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function TickerTableHeader({ showCategory }) {
  return (
    <div className={`hidden sm:grid items-center gap-4 px-5 py-2.5 border-b border-neutral-800 text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-500 ${
      showCategory
        ? 'grid-cols-[1fr_0.5fr_1.2fr_2fr_1fr_1fr_auto]'
        : 'grid-cols-[1fr_1.2fr_2fr_1fr_1fr_auto]'
    }`}>
      <div>Ticker</div>
      {showCategory && <div>Group</div>}
      <div className="text-right">Price</div>
      <div>Thesis</div>
      <div>Stage</div>
      <div>Timeframe</div>
      <div className="w-[72px]"></div>
    </div>
  );
}

function TickerRow({ row, inPositions, showCategory, quote, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const longThesis = row.thesis && row.thesis.length > 80;

  // Format price display — same dual-% logic as Intelligence
  const priceDisplay = (() => {
    if (!quote || quote.price == null) return null;
    const priceStr = `$${quote.price.toFixed(2)}`;
    if (quote.isExtendedHours) {
      const sStr = quote.sessionChangePct != null
        ? `${quote.sessionChangePct >= 0 ? '+' : ''}${quote.sessionChangePct.toFixed(2)}%`
        : null;
      const eStr = quote.extendedChangePct != null
        ? `${quote.extendedChangePct >= 0 ? '+' : ''}${quote.extendedChangePct.toFixed(2)}%`
        : null;
      const ePctColor = quote.extendedChangePct == null ? 'text-neutral-500'
        : quote.extendedChangePct > 0 ? 'text-emerald-400'
        : quote.extendedChangePct < 0 ? 'text-red-400'
        : 'text-neutral-400';
      const sPctColor = quote.sessionChangePct == null ? 'text-neutral-500'
        : quote.sessionChangePct > 0 ? 'text-emerald-400'
        : quote.sessionChangePct < 0 ? 'text-red-400'
        : 'text-neutral-400';
      return (
        <div className="text-right">
          <div className="font-mono text-[13px] text-neutral-100">{priceStr}</div>
          {sStr && <div className={`font-mono text-[11px] ${sPctColor}`}>{sStr} cls</div>}
          {eStr && <div className={`font-mono text-[11px] ${ePctColor}`}>{eStr} ext</div>}
        </div>
      );
    }
    // Market hours — just session change
    const pct = quote.sessionChangePct;
    const pctColor = pct == null ? 'text-neutral-500'
      : pct > 0 ? 'text-emerald-400'
      : pct < 0 ? 'text-red-400'
      : 'text-neutral-400';
    const pctStr = pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : null;
    return (
      <div className="text-right">
        <div className="font-mono text-[13px] text-neutral-100">{priceStr}</div>
        {pctStr && <div className={`font-mono text-[11px] ${pctColor}`}>{pctStr}</div>}
      </div>
    );
  })();

  return (
    <div className="border-b border-neutral-900 last:border-b-0">
      <div className={`grid items-start gap-4 px-5 py-3.5 text-[13px] grid-cols-2 ${
        showCategory
          ? 'sm:grid-cols-[1fr_0.5fr_1.2fr_2fr_1fr_1fr_auto]'
          : 'sm:grid-cols-[1fr_1.2fr_2fr_1fr_1fr_auto]'
      }`}>
        {/* Ticker + sentiment */}
        <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
          <span className="text-base leading-none">{sentimentEmoji(row.sentiment)}</span>
          <span className="font-mono font-semibold uppercase tracking-wider text-neutral-100">
            {row.ticker}
          </span>
          {row.in_daily_focus && (
            <span title="In weekly focus" className="text-base leading-none">🎯</span>
          )}
          {inPositions && (
            <span title="In positions" className="inline-flex items-center gap-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
              <Briefcase className="h-2.5 w-2.5" strokeWidth={2} />
            </span>
          )}
        </div>

        {/* Category badge — only in daily tab or search results */}
        {showCategory && (
          <div className="hidden sm:flex items-start">
            <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-400">
              {row.category || 'N/A'}
            </span>
          </div>
        )}

        {/* Live price + % change */}
        <div className="hidden sm:block">
          {priceDisplay ?? <span className="text-neutral-700 text-[12px] font-mono">—</span>}
        </div>

        {/* Thesis — truncated, expandable */}
        <div className="col-span-2 sm:col-span-1">
          <p className="text-neutral-300 leading-relaxed">
            {expanded ? row.thesis : truncate(row.thesis)}
          </p>
          {longThesis && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 inline-flex items-center gap-0.5 text-[11px] text-neutral-600 hover:text-emerald-400 transition-colors"
            >
              {expanded ? (
                <><ChevronUp className="h-3 w-3" strokeWidth={2} /> Less</>
              ) : (
                <><ChevronDown className="h-3 w-3" strokeWidth={2} /> More</>
              )}
            </button>
          )}
          {/* Focus reason — shown when ticker is in weekly focus */}
          {row.focus_reason && (
            <p className="mt-1.5 text-[12px] text-amber-400/80 italic">
              🎯 {row.focus_reason}
            </p>
          )}
          {/* Tags */}
          {row.tags && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {row.tags.split(',').map((t) => t.trim()).filter(Boolean).map((tag) => (
                <span key={tag} className="rounded-full bg-neutral-900 px-2 py-0.5 text-[10px] text-neutral-500 border border-neutral-800">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Stage */}
        <div className="hidden sm:block font-mono text-[12px] text-neutral-400">
          {row.stage || <span className="text-neutral-700">—</span>}
        </div>

        {/* Timeframe */}
        <div className="hidden sm:block font-mono text-[12px] text-neutral-400">
          {row.timeframe || <span className="text-neutral-700">—</span>}
        </div>

        {/* Source */}
        <div className="hidden sm:block text-[12px] text-neutral-500 truncate" title={row.source || ''}>
          {row.source || <span className="text-neutral-700">—</span>}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-1 col-span-2 sm:col-span-1">
          <IconBtn onClick={onEdit}   label="Edit"><Pencil className="h-3.5 w-3.5" strokeWidth={1.75} /></IconBtn>
          <IconBtn onClick={onDelete} label="Remove" danger><Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} /></IconBtn>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

function WatchlistModal({ mode, row, existingCategories, allItems, onSaved, onCancel, setError }) {
  const [form, setForm] = useState(() => {
    if (mode === 'edit' && row) {
      return {
        ticker:    row.ticker    || '',
        category:  row.category  || '',
        sentiment: row.sentiment || 'neutral',
        thesis:    row.thesis    || '',
        stage:     row.stage     || '',
        timeframe: row.timeframe || '',
        source:    row.source    || '',
        tags:      row.tags      || '',
      };
    }
    return { ...EMPTY_FORM };
  });
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState('');
  const [inDailyFocus, setInDailyFocus] = useState(row?.in_daily_focus ?? false);
  const [dailyReason, setDailyReason] = useState('');
  const [dailyFocusId, setDailyFocusId] = useState(null); // existing row id if present
  const tickerRef = useRef(null);

  // Load existing daily_focus row for this ticker (to know id for update)
  useEffect(() => {
    if (!row?.ticker) return;
    (async () => {
      await authReady();
      const { data } = await supabase
        .from('daily_focus')
        .select('id, reason, is_active')
        .eq('ticker', row.ticker.toUpperCase())
        .eq('week_start', currentWeekStart())
        .eq('is_active', true)
        .maybeSingle();
      if (data) {
        setInDailyFocus(true);
        setDailyFocusId(data.id);
        setDailyReason(data.reason || '');
      }
    })();
  }, [row?.ticker]);

  // Focus ticker on mount
  useEffect(() => {
    tickerRef.current?.focus();
  }, []);

  // Dismiss on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const set = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setFieldError('');
  };

  const tickerUpper = form.ticker.toUpperCase().trim();

  const onSave = async () => {
    // Basic field validation — no conflict blocking
    if (!tickerUpper) { setFieldError('Ticker is required.'); return; }
    if (!form.category.trim()) { setFieldError('Group is required.'); return; }

    setSaving(true);
    setFieldError('');
    try {
      await authReady();
      const payload = {
        ticker:     tickerUpper,
        category:   form.category.trim(),
        sentiment:  form.sentiment,
        thesis:     form.thesis.trim()     || null,
        stage:      form.stage.trim()      || null,
        timeframe:  form.timeframe.trim()  || null,
        source:     form.source.trim()     || null,
        tags:       form.tags.trim()       || null,
        is_active:  true,
        updated_at: new Date().toISOString(),
      };

      if (mode === 'edit') {
        // Straightforward update on the known row
        const { error: err } = await supabase
          .from('watchlist').update(payload).eq('id', row.id);
        if (err) throw err;
      } else {
        // Add mode — check if ticker already exists in a different group
        const conflict = allItems.find(
          (r) => r.ticker.toUpperCase() === tickerUpper && r.is_active
        );
        if (conflict) {
          // Move: update the existing row's group (and all other fields) in place.
          // No delete, no re-insert — cleaner and preserves row history.
          const { error: err } = await supabase
            .from('watchlist').update(payload).eq('id', conflict.id);
          if (err) throw err;
        } else {
          // Fresh insert
          const { error: err } = await supabase
            .from('watchlist').insert(payload);
          if (err) {
            if (err.code === '23505') {
              // Race condition — another insert snuck in, fall back to update
              const { error: err2 } = await supabase
                .from('watchlist')
                .update(payload)
                .eq('ticker', tickerUpper)
                .eq('is_active', true);
              if (err2) throw err2;
            } else {
              throw err;
            }
          }
        }
      }

      onSaved(payload.category);

      // Handle daily focus toggle separately from watchlist save
      const weekStart = currentWeekStart();
      if (inDailyFocus) {
        // Add or update daily_focus row
        if (dailyFocusId) {
          await supabase.from('daily_focus')
            .update({ reason: dailyReason || null, is_active: true })
            .eq('id', dailyFocusId);
        } else {
          await supabase.from('daily_focus').insert({
            ticker: tickerUpper,
            reason: dailyReason || null,
            week_start: weekStart,
            is_active: true,
          });
        }
      } else if (dailyFocusId) {
        // Soft-remove from daily focus
        await supabase.from('daily_focus')
          .update({ is_active: false })
          .eq('id', dailyFocusId);
      }
    } catch (e) {
      setError(e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full max-w-lg rounded-md border border-neutral-800 bg-[#111] shadow-2xl">
        {/* Modal header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
          <h2 className="text-[15px] font-medium text-neutral-100">
            {mode === 'add' ? 'Add ticker' : `Edit ${row?.ticker}`}
          </h2>
          <button type="button" onClick={onCancel} className="text-neutral-500 hover:text-neutral-200 transition-colors">
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        {/* Modal body */}
        <div className="px-6 py-5 space-y-4">
          {fieldError && (
            <div className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-[13px] text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>{fieldError}</span>
            </div>
          )}

          {/* Row 1: Ticker + Sentiment */}
          <div className="grid grid-cols-2 gap-3">
            <ModalField label="Ticker *">
              <input
                ref={tickerRef}
                type="text"
                value={form.ticker}
                onChange={(e) => { set('ticker')(e); }}
                onBlur={(e) => setForm((f) => ({ ...f, ticker: e.target.value.toUpperCase().trim() }))}
                placeholder="AMZN"
                maxLength={6}
                className={inputCls}
              />
            </ModalField>
            <ModalField label="Sentiment">
              <div className="flex gap-2">
                {SENTIMENTS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, sentiment: s.id }))}
                    className={`flex-1 rounded border px-2 py-2 text-[12px] transition-colors ${
                      form.sentiment === s.id
                        ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
                        : 'border-neutral-800 text-neutral-400 hover:border-neutral-700'
                    }`}
                  >
                    {s.emoji} {s.label}
                  </button>
                ))}
              </div>
            </ModalField>
          </div>

          {/* Row 2: Category (combobox) */}
          <ModalField label="Group *">
            <CategoryCombobox
              value={form.category}
              onChange={(v) => setForm((f) => ({ ...f, category: v }))}
              options={existingCategories}
            />
          </ModalField>

          {/* Row 3: Thesis */}
          <ModalField label="Thesis">
            <textarea
              value={form.thesis}
              onChange={set('thesis')}
              rows={4}
              placeholder="Why is this on your watchlist? What's the catalyst?"
              className={`${inputCls} resize-y`}
            />
          </ModalField>

          {/* Row 4: Stage + Timeframe */}
          <div className="grid grid-cols-2 gap-3">
            <ModalField label="Stage">
              <input type="text" value={form.stage} onChange={set('stage')} placeholder="breakout, accumulation…" className={inputCls} />
            </ModalField>
            <ModalField label="Timeframe">
              <input type="text" value={form.timeframe} onChange={set('timeframe')} placeholder="swing, 1-2w…" className={inputCls} />
            </ModalField>
          </div>

          {/* Row 5: Source + Tags */}
          <div className="grid grid-cols-2 gap-3">
            <ModalField label="Source">
              <input type="text" value={form.source} onChange={set('source')} placeholder="Discord, newsletter…" className={inputCls} />
            </ModalField>
            <ModalField label="Tags (comma-separated)">
              <input type="text" value={form.tags} onChange={set('tags')} placeholder="AI,semis,breakout" className={inputCls} />
            </ModalField>
          </div>

          {/* Daily focus toggle */}
          <div className={`rounded border px-4 py-3 transition-colors ${
            inDailyFocus
              ? 'border-amber-500/40 bg-amber-500/[0.06]'
              : 'border-neutral-800 bg-neutral-950/40'
          }`}>
            <button
              type="button"
              onClick={() => setInDailyFocus((v) => !v)}
              className="flex w-full items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2">
                <span className="text-[15px]">🎯</span>
                <div className="text-left">
                  <div className={`text-[13px] font-medium ${inDailyFocus ? 'text-amber-200' : 'text-neutral-400'}`}>
                    Add to this week's daily focus
                  </div>
                  <div className="text-[11px] text-neutral-600">
                    Week of {currentWeekStart()}
                  </div>
                </div>
              </div>
              <div className={`h-5 w-9 rounded-full transition-colors ${inDailyFocus ? 'bg-amber-500' : 'bg-neutral-700'}`}>
                <div className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${inDailyFocus ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
            </button>
            {inDailyFocus && (
              <input
                type="text"
                value={dailyReason}
                onChange={(e) => setDailyReason(e.target.value)}
                placeholder="Why is this a focus this week? (optional)"
                className={`mt-3 ${inputCls}`}
              />
            )}
          </div>
        </div>

        {/* Modal footer */}
        <div className="flex items-center justify-end gap-2 border-t border-neutral-800 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 text-[13px] text-neutral-400 hover:text-neutral-200 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !tickerUpper || !form.category.trim()}
            className="inline-flex items-center gap-2 rounded border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-[13px] font-medium text-emerald-200 hover:bg-emerald-500/15 hover:border-emerald-500/60 transition-all active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>Saving…</>
            ) : (
              <><Check className="h-3.5 w-3.5" strokeWidth={2.25} />{mode === 'add' ? 'Add to watchlist' : 'Save changes'}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category combobox — shows existing options + allows typing new
// ---------------------------------------------------------------------------

function CategoryCombobox({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Filter out 'daily' — that's system-managed, not user-assignable.
  // When value is empty show all options; when typing, filter to matches
  // but keep the exact match visible so user can confirm their own new group.
  const filtered = options
    .filter((o) => o !== 'daily')
    .filter((o) => !value || o.toLowerCase().includes(value.toLowerCase()));

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="ai-infra, quantum, nuclear…"
        className={inputCls}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute left-0 top-full z-10 mt-1 w-full max-h-56 overflow-y-auto rounded border border-neutral-700 bg-[#111] shadow-xl">
          {filtered.map((opt) => (
            <li key={opt}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); onChange(opt); setOpen(false); }}
                className="w-full px-3 py-2 text-left text-[13px] text-neutral-300 hover:bg-emerald-500/10 hover:text-emerald-200 transition-colors"
              >
                {opt}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onAdd }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="text-[40px] mb-4">📋</div>
      <p className="text-[15px] text-neutral-300 mb-2">No watchlist entries yet.</p>
      <p className="text-sm text-neutral-600 mb-6">Add tickers you're watching.</p>
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-[13px] font-medium text-emerald-200 hover:bg-emerald-500/15 hover:border-emerald-500/60 transition-colors"
      >
        <Plus className="h-4 w-4" strokeWidth={2.25} />
        Add first ticker
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const inputCls =
  'w-full rounded border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-[13px] text-neutral-100 placeholder:text-neutral-600 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 transition-colors';

function ModalField({ label, children }) {
  return (
    <div>
      <label className="block mb-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </label>
      {children}
    </div>
  );
}

function IconBtn({ onClick, label, disabled, danger, children }) {
  const cls = danger
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
