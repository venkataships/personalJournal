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

// ---------------------------------------------------------------------------
// Data layer
// ---------------------------------------------------------------------------

async function fetchWatchlist() {
  await authReady();
  const { data, error } = await supabase
    .from('watchlist')
    .select('*')
    .eq('is_active', true)
    .order('category', { ascending: true })
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Watchlist() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);
  const [positionTickers, setPositionTickers] = useState(new Set());
  const [activeCategory, setActiveCategory] = useState(null);
  const [modal, setModal] = useState(null); // null | { mode: 'add' | 'edit', row?: {} }

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

  // Derive categories from data. Preserve encounter order but sort alpha.
  const categories = useMemo(() => {
    const cats = [...new Set(items.map((r) => r.category || 'Uncategorized'))].sort();
    return cats;
  }, [items]);

  // Auto-select first category when data loads.
  useEffect(() => {
    if (categories.length > 0 && !activeCategory) {
      setActiveCategory(categories[0]);
    }
    // If the active category disappears (all tickers removed), fall back.
    if (activeCategory && categories.length > 0 && !categories.includes(activeCategory)) {
      setActiveCategory(categories[0]);
    }
  }, [categories, activeCategory]);

  const visibleItems = useMemo(() => {
    if (!activeCategory) return [];
    const target = activeCategory === 'Uncategorized' ? null : activeCategory;
    return items.filter((r) => (r.category || null) === target);
  }, [items, activeCategory]);

  const countFor = (cat) => {
    const target = cat === 'Uncategorized' ? null : cat;
    return items.filter((r) => (r.category || null) === target).length;
  };

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
            <button
              type="button"
              onClick={openAdd}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[12px] font-medium uppercase tracking-[0.12em] text-emerald-200 hover:bg-emerald-500/15 hover:border-emerald-500/60 transition-colors active:scale-[0.98] shrink-0"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
              Add ticker
            </button>
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
            {/* Category tabs */}
            <div className="mb-6 flex items-end gap-1 overflow-x-auto pb-px scrollbar-none">
              {categories.map((cat) => (
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
                  <span className={`ml-2 font-mono text-[10px] ${activeCategory === cat ? 'text-emerald-400/70' : 'text-neutral-700'}`}>
                    {countFor(cat)}
                  </span>
                </button>
              ))}
            </div>

            {/* Ticker table */}
            <div className="rounded-md rounded-tl-none border border-neutral-800 bg-neutral-950/40 overflow-hidden">
              <TickerTableHeader />
              {visibleItems.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px] text-neutral-600">
                  No tickers in this group.
                </div>
              ) : (
                visibleItems.map((row) => (
                  <TickerRow
                    key={row.id}
                    row={row}
                    inPositions={positionTickers.has(row.ticker.toUpperCase())}
                    onEdit={() => openEdit(row)}
                    onDelete={() => onSoftDelete(row)}
                  />
                ))
              )}
            </div>
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

function TickerTableHeader() {
  return (
    <div className="hidden sm:grid grid-cols-[1fr_2.5fr_1fr_1fr_1.2fr_auto] items-center gap-4 px-5 py-2.5 border-b border-neutral-800 text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-500">
      <div>Ticker</div>
      <div>Thesis</div>
      <div>Stage</div>
      <div>Timeframe</div>
      <div>Source</div>
      <div className="w-[72px]"></div>
    </div>
  );
}

function TickerRow({ row, inPositions, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const longThesis = row.thesis && row.thesis.length > 80;

  return (
    <div className="border-b border-neutral-900 last:border-b-0">
      {/* Main row */}
      <div className="grid grid-cols-2 sm:grid-cols-[1fr_2.5fr_1fr_1fr_1.2fr_auto] items-start gap-4 px-5 py-3.5 text-[13px]">
        {/* Ticker + sentiment */}
        <div className="flex items-center gap-2 col-span-2 sm:col-span-1">
          <span className="text-base leading-none">{sentimentEmoji(row.sentiment)}</span>
          <span className="font-mono font-semibold uppercase tracking-wider text-neutral-100">
            {row.ticker}
          </span>
          {inPositions && (
            <span title="In positions" className="inline-flex items-center gap-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
              <Briefcase className="h-2.5 w-2.5" strokeWidth={2} />
            </span>
          )}
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
          {/* Tags — shown on mobile as chips, desktop inline */}
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
  const tickerRef = useRef(null);

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

  const validate = useCallback(() => {
    if (!tickerUpper) return 'Ticker is required.';
    if (!form.category.trim()) return 'Group is required.';
    // Unique-ticker-across-groups check (UI-level; DB also enforces via partial index)
    if (mode === 'add') {
      const conflict = allItems.find(
        (r) => r.ticker.toUpperCase() === tickerUpper && r.is_active
      );
      if (conflict) {
        return `${tickerUpper} is already in group ${conflict.category || 'Uncategorized'}. Remove it first.`;
      }
    }
    if (mode === 'edit' && row) {
      const conflict = allItems.find(
        (r) =>
          r.ticker.toUpperCase() === tickerUpper &&
          r.is_active &&
          r.id !== row.id
      );
      if (conflict) {
        return `${tickerUpper} is already in group ${conflict.category || 'Uncategorized'}. Remove it first.`;
      }
    }
    return null;
  }, [tickerUpper, form.category, allItems, mode, row]);

  const onSave = async () => {
    const validationError = validate();
    if (validationError) { setFieldError(validationError); return; }
    setSaving(true);
    try {
      await authReady();
      const payload = {
        ticker:    tickerUpper,
        category:  form.category.trim(),
        sentiment: form.sentiment,
        thesis:    form.thesis.trim() || null,
        stage:     form.stage.trim()  || null,
        timeframe: form.timeframe.trim() || null,
        source:    form.source.trim() || null,
        tags:      form.tags.trim()   || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      };
      const q = mode === 'add'
        ? supabase.from('watchlist').insert(payload)
        : supabase.from('watchlist').update(payload).eq('id', row.id);
      const { error: err } = await q;
      if (err) {
        // Supabase unique violation
        if (err.code === '23505') {
          setFieldError(`${tickerUpper} already exists in the watchlist.`);
        } else {
          throw err;
        }
        return;
      }
      onSaved(payload.category);
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

  const filtered = options.filter(
    (o) => o.toLowerCase().includes(value.toLowerCase()) && o.toLowerCase() !== value.toLowerCase()
  );

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
        <ul className="absolute left-0 top-full z-10 mt-1 w-full rounded border border-neutral-700 bg-[#111] shadow-xl">
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
