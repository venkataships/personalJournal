import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, AlertCircle, RefreshCw, TrendingUp, TrendingDown, Radar,
  Pencil, Plus, Trash2, ChevronUp, ChevronDown, X, Check,
} from 'lucide-react';
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ReferenceLine,
  Tooltip, CartesianGrid,
} from 'recharts';
import { supabase, authReady } from '../../lib/supabase';
import MarketBar from '../../components/MarketBar';
import { MARKET_TICKERS } from '../../lib/marketTickers';

// Groups live in Supabase `pulse_groups` (edited here). sector_pulse.py on the
// bot reads them every run and writes a snapshot to `market_pulse`, which this
// page and the /sectors Telegram command read. No Claude calls.

// Validated for dark surface #0a0a0a (lightness band, contrast, CVD adjacent).
// Phase is always also shown as a text label — never color alone.
const QUADRANT = {
  Leading:   { color: '#059669', text: 'text-emerald-300', chip: 'border-emerald-500/40 bg-emerald-500/10', blurb: 'beating SPY short & long term' },
  Weakening: { color: '#d97706', text: 'text-amber-300',   chip: 'border-amber-500/40 bg-amber-500/10',     blurb: 'trend intact, momentum fading' },
  Improving: { color: '#0284c7', text: 'text-sky-300',     chip: 'border-sky-500/40 bg-sky-500/10',         blurb: 'money rotating in' },
  Lagging:   { color: '#e11d48', text: 'text-rose-300',    chip: 'border-rose-500/40 bg-rose-500/10',       blurb: 'trailing SPY short & long term' },
  'In line': { color: '#737373', text: 'text-neutral-300', chip: 'border-neutral-700 bg-neutral-800/40',    blurb: 'within ±0.5 pts (5d) and ±1 pt (20d) of SPY — no clear direction' },
};

const SESSION_LABEL = {
  premarket: 'Pre-market', regular: 'Market open', afterhours: 'After hours', closed: 'Market closed',
};

const STALE_MIN = 45;
const MARKET_BAR_SYMBOLS = new Set(MARKET_TICKERS.map((t) => t.symbol));

function pct(v, digits = 1) {
  if (v === null || v === undefined) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

function pctClass(v) {
  if (v === null || v === undefined) return 'text-neutral-600';
  if (v > 0) return 'text-emerald-400';
  if (v < 0) return 'text-rose-400';
  return 'text-neutral-400';
}

function minutesAgo(iso) {
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}

function ago(iso) {
  const m = minutesAgo(iso);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function parseTickers(text) {
  return [...new Set(
    text.split(/[\s,]+/).map((t) => t.trim().toUpperCase().replace(/^\$/, '')).filter(Boolean),
  )];
}

// ---------------------------------------------------------------------------

export default function SectorPulse() {
  const [state, setState] = useState({ loading: true, error: null, row: null });
  const [editing, setEditing] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [savedNote, setSavedNote] = useState(false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      await authReady();
      const { data, error } = await supabase
        .from('market_pulse')
        .select('*')
        .order('as_of', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      setState({ loading: false, error: null, row: data });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e.message || 'Failed to load.' }));
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  const row = state.row;
  const groups = row?.groups || [];
  const oldFormat = row && !groups.length && (row.sectors?.length || row.themes?.length);
  const stale = row && ['premarket', 'regular'].includes(row.session) && minutesAgo(row.as_of) > STALE_MIN;
  const missing = row?.coverage?.missing || [];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 font-sans antialiased selection:bg-emerald-500/30">
      <div className="relative mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-12">
        {/* Header */}
        <header className="mb-6">
          <Link
            to="/trading"
            className="inline-flex items-center gap-1.5 mb-3 text-[11px] uppercase tracking-[0.22em] text-neutral-500 hover:text-emerald-400 transition-colors"
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={2} />
            Trading
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2.5 text-3xl font-light tracking-tight text-neutral-100">
                <Radar className="h-7 w-7 text-emerald-400" strokeWidth={1.5} />
                Sector Pulse
              </h1>
              <p className="mt-1 text-[13px] text-neutral-500">Your groups, ranked against SPY.</p>
            </div>
            <div className="flex items-center gap-2">
              {row && (
                <div className="mr-1 text-right font-mono text-[11px] text-neutral-500">
                  <div className="uppercase tracking-[0.18em]">{SESSION_LABEL[row.session] || row.session}</div>
                  <div title={new Date(row.as_of).toLocaleString()}>updated {ago(row.as_of)}</div>
                </div>
              )}
              <IconButton label="Edit groups" onClick={() => setEditing((v) => !v)} active={editing}>
                <Pencil className="h-4 w-4" strokeWidth={1.75} />
              </IconButton>
              <IconButton label="Refresh" onClick={load} disabled={state.loading}>
                <RefreshCw className={`h-4 w-4 ${state.loading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
              </IconButton>
            </div>
          </div>

          {state.error && (
            <Banner tone="error">
              {state.error.includes('market_pulse')
                ? 'The market_pulse table doesn’t exist yet — run migrations/001_market_pulse.sql in Supabase.'
                : state.error}
            </Banner>
          )}
          {stale && (
            <Banner tone="warn">
              Last snapshot is {minutesAgo(row.as_of)} minutes old during market hours — the pulse agent on the
              server may be down. Check <span className="font-mono">journalctl -u portfolio-agent.service</span>.
            </Banner>
          )}
          {['rate_limited', 'stale'].includes(row?.coverage?.history?.status) && (
            <Banner tone="warn">
              Price history: {row.coverage.history.note}. Levels and returns may lag until Yahoo responds again;
              live prices from Public are still current.
            </Banner>
          )}
          {oldFormat && (
            <Banner tone="warn">
              This snapshot is from before group tracking. It refreshes on the next update, or send
              <span className="font-mono"> /sectors now</span> in Telegram.
            </Banner>
          )}
          {savedNote && (
            <Banner tone="ok">
              Groups saved. They show here after the next update (every 30 min, 4am–8pm ET weekdays) —
              or send <span className="font-mono">/sectors now</span> in Telegram to see them immediately.
            </Banner>
          )}
        </header>

        {/* Live market bar — same component and tickers as the Watchlist page */}
        <MarketBar />

        {editing && (
          <GroupEditor
            onClose={() => setEditing(false)}
            onSaved={() => { setEditing(false); setSavedNote(true); }}
          />
        )}

        {!state.loading && !state.error && !row && (
          <div className="rounded-md border border-dashed border-neutral-800 px-5 py-10 text-center text-sm text-neutral-500">
            No snapshots yet. The agent writes its first one about 15 seconds after the bot starts.
          </div>
        )}

        {row && (
          <>
            {/* Index strip: only benchmark tickers the market bar doesn't already show */}
            {Object.keys(row.benchmarks || {}).some((sym) => !MARKET_BAR_SYMBOLS.has(sym)) && (
              <section className="mb-4 grid grid-cols-3 gap-2">
                {Object.entries(row.benchmarks).filter(([sym]) => !MARKET_BAR_SYMBOLS.has(sym)).map(([sym, b]) => (
                  <div key={sym} className="rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[12px] text-neutral-200">{sym}</span>
                      <span className="hidden truncate text-[10px] text-neutral-600 sm:inline">{b.name}</span>
                    </div>
                    <div className={`mt-1 font-mono text-lg tabular-nums ${pctClass(b.r1)}`}>{pct(b.r1, 2)}</div>
                    <div className="font-mono text-[10px] tabular-nums text-neutral-500">
                      {b.price?.toFixed(2)} · 5d {pct(b.r5)}
                    </div>
                  </div>
                ))}
              </section>
            )}

            {/* Top setups */}
            {row.setups && <TopSetups setups={row.setups} />}

            {/* Groups */}
            <section className="space-y-4">
              {groups.map((g, i) => <GroupCard key={g.name} group={g} rank={i + 1} total={groups.length} />)}
            </section>

            {missing.length > 0 && (
              <p className="mt-3 text-[12px] text-neutral-600">
                No price data for: <span className="font-mono">{missing.join(', ')}</span> — check the symbol.
              </p>
            )}

            {/* Rotation map (collapsed by default) */}
            {groups.length > 0 && (
              <section className="mt-8">
                <button
                  onClick={() => setShowMap((v) => !v)}
                  aria-expanded={showMap}
                  className="flex w-full items-center justify-between rounded-md border border-neutral-800 px-4 py-3 text-left hover:border-neutral-700"
                >
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-400">Rotation map</div>
                    <div className="mt-0.5 text-[12px] text-neutral-600">Every ticker by 5-day vs 20-day strength against SPY</div>
                  </div>
                  {showMap ? <ChevronUp className="h-4 w-4 text-neutral-500" /> : <ChevronDown className="h-4 w-4 text-neutral-500" />}
                </button>
                {showMap && <RotationMap groups={groups} />}
              </section>
            )}

            <footer className="mt-8 text-center font-mono text-[10px] text-neutral-700">
              {row.coverage?.symbols_computed}/{row.coverage?.symbols_requested} symbols ·{' '}
              {row.coverage?.live_quotes ? `${row.coverage.live_quotes} live quotes · ` : ''}
              narrative: {row.narrative_source}
              {row.coverage?.history?.base_date && <> · history {row.coverage.history.base_date}
                {' '}({row.coverage.history.status})</>}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function IconButton({ label, onClick, disabled, active, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`rounded border p-2 transition-colors disabled:opacity-50 ${
        active
          ? 'border-emerald-500/50 text-emerald-300'
          : 'border-neutral-800 text-neutral-400 hover:border-emerald-500/40 hover:text-emerald-400'
      }`}
    >
      {children}
    </button>
  );
}

function Banner({ tone, children }) {
  const cls = {
    error: 'border-rose-500/30 bg-rose-500/5 text-rose-300',
    warn: 'border-amber-500/30 bg-amber-500/5 text-amber-200',
    ok: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200',
  }[tone];
  const Icon = tone === 'ok' ? Check : AlertCircle;
  return (
    <div className={`mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] ${cls}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
      <span>{children}</span>
    </div>
  );
}

function QuadrantChip({ q, compact, note }) {
  if (!q) return <span className="text-neutral-700">—</span>;
  const s = QUADRANT[q] || QUADRANT['In line'];
  return (
    <span
      title={`${q} — ${s.blurb}${note ? ` (${note})` : ''}`}
      className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[11px] ${s.chip} ${s.text}`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
      {compact ? (
        <>
          <span className="sm:hidden">{q.slice(0, 4)}</span>
          <span className="hidden sm:inline">{q}</span>
        </>
      ) : q}
      {note && <span aria-hidden className="opacity-60">*</span>}
    </span>
  );
}

function FlowTag({ flow, rvol }) {
  if (!flow) return rvol >= 1.2 ? <span className="font-mono text-neutral-500">{rvol}x</span> : <span className="text-neutral-800">·</span>;
  const inflow = flow === 'inflow';
  const Icon = inflow ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 font-mono ${inflow ? 'text-emerald-400' : 'text-rose-400'}`}>
      <Icon className="h-3 w-3" strokeWidth={2} />
      {rvol}x
    </span>
  );
}

function GroupCard({ group: g, rank, total }) {
  const edge = rank === 1 ? 'Strongest' : rank === total && total > 1 ? 'Weakest' : null;
  return (
    <div className="overflow-hidden rounded-md border border-neutral-800 bg-neutral-950/40">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-900 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-medium text-neutral-100">{g.name}</h2>
            <QuadrantChip q={g.quadrant} note={g.phase_note} />
            {edge && <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{edge}</span>}
          </div>
          <div className="mt-1 font-mono text-[11px] tabular-nums text-neutral-500">
            {g.up}/{g.count} green
            {g.ema_known > 0 && <> · {g.above_ema20}/{g.ema_known} above 20-day avg</>}
            {(g.above_pdh > 0 || g.below_pdl > 0) && (
              <> · <span className="text-emerald-400">{g.above_pdh} above PDH</span>
                {' '}/ <span className="text-rose-400">{g.below_pdl} below PDL</span></>
            )}
            {' '}· vs SPY 5d <span className={pctClass(g.rs5)}>{pct(g.rs5)}</span>
            {' '}· 20d <span className={pctClass(g.rs20)}>{pct(g.rs20)}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="flex gap-4 font-mono tabular-nums">
            {[['1d', g.r1, 2], ['5d', g.r5, 1], ['20d', g.r20, 1]].map(([label, v, d]) => (
              <div key={label}>
                <div className="text-[10px] uppercase tracking-wider text-neutral-600">{label}</div>
                <div className={`${label === '1d' ? 'text-lg' : 'text-[13px] mt-1'} ${pctClass(v)}`}>{pct(v, d)}</div>
              </div>
            ))}
          </div>
          {'avg_r1' in g && (
            <div className="mt-0.5 text-[10px] text-neutral-600" title="Median of the group's tickers, so one outlier can't swing it">
              median of picks
            </div>
          )}
        </div>
      </div>

      {g.ref && <SectorStrip g={g} />}

      {g.count === 0 ? (
        <div className="px-4 py-3 text-[12px] text-neutral-600">No price data for any ticker in this group.</div>
      ) : (
        <div>
          <table className="w-full table-fixed text-[12px]">
            <colgroup>
              <col className="w-[17%] sm:w-[9%]" />
              <col className="w-[19%] sm:w-[10%]" />
              <col className="w-[17%] sm:w-[9%]" />
              <col className="hidden sm:table-column sm:w-[8%]" />
              <col className="hidden sm:table-column sm:w-[8%]" />
              <col className="hidden sm:table-column sm:w-[9%]" />
              <col className="w-[25%] sm:w-[22%]" />
              <col className="w-[22%] sm:w-[15%]" />
              <col className="hidden sm:table-column sm:w-[8%]" />
            </colgroup>
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-600">
                <th className="pl-4 pr-2 py-2 font-normal">Ticker</th>
                <th className="px-2 py-2 text-right font-normal">Price</th>
                <th className="px-2 py-2 text-right font-normal">1d</th>
                <th className="hidden sm:table-cell px-2 py-2 text-right font-normal">5d</th>
                <th className="hidden sm:table-cell px-2 py-2 text-right font-normal">20d</th>
                <th className="hidden sm:table-cell px-2 py-2 text-right font-normal" title="5-day return minus SPY's">vs SPY 5d</th>
                <th className="pl-3 pr-2 py-2 font-normal" title="Price vs the previous day's high (PDH) and low (PDL)">vs PDH/PDL</th>
                <th className="pl-2 pr-2 py-2 font-normal">Phase</th>
                <th className="hidden sm:table-cell pr-4 py-2 font-normal" title="Volume vs 20-day average">Vol</th>
              </tr>
            </thead>
            <tbody>
              {g.members.map((m) => (
                <tr key={m.ticker} className="border-t border-neutral-900 hover:bg-neutral-900/40">
                  <td className="pl-4 pr-2 py-2 font-mono font-medium text-neutral-100">{m.ticker}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-neutral-300">{m.price?.toFixed(2)}</td>
                  <td className={`px-2 py-2 text-right font-mono tabular-nums ${pctClass(m.r1)}`}>{pct(m.r1, 2)}</td>
                  <td className={`hidden sm:table-cell px-2 py-2 text-right font-mono tabular-nums ${pctClass(m.r5)}`}>{pct(m.r5)}</td>
                  <td className={`hidden sm:table-cell px-2 py-2 text-right font-mono tabular-nums ${pctClass(m.r20)}`}>{pct(m.r20)}</td>
                  <td className={`hidden sm:table-cell px-2 py-2 text-right font-mono tabular-nums ${pctClass(m.rs5)}`}>{pct(m.rs5)}</td>
                  <td className="pl-3 pr-2 py-2"><PdCell m={m} /></td>
                  <td className="pl-2 pr-2 py-2"><QuadrantChip q={m.quadrant} compact note={m.phase_note} /></td>
                  <td className="hidden sm:table-cell pr-4 py-2"><FlowTag flow={m.flow} rvol={m.rvol} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {g.missing?.length > 0 && g.count > 0 && (
        <div className="border-t border-neutral-900 px-4 py-2 text-[11px] text-neutral-600">
          No data: <span className="font-mono">{g.missing.join(', ')}</span>
        </div>
      )}
    </div>
  );
}

// Previous-day high/low. Color is always paired with a text label.
const PD_EVENT = {
  breakout:        { label: 'Breakout', short: 'Breakout',    icon: '↑', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', tip: 'Traded above yesterday’s high and holding above it' },
  breakdown:       { label: 'Breakdown', short: 'Brk dn',   icon: '↓', cls: 'border-rose-500/40 bg-rose-500/10 text-rose-300',          tip: 'Traded below yesterday’s low and holding below it' },
  failed_breakout: { label: 'Failed BO', short: 'Failed',   icon: '✗', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300',       tip: 'Poked above yesterday’s high, now back below it' },
  reclaim:         { label: 'Reclaim', short: 'Reclaim',     icon: '↺', cls: 'border-sky-500/40 bg-sky-500/10 text-sky-300',             tip: 'Broke yesterday’s low, now back above it' },
  outside_day:     { label: 'Outside day', short: 'Outside', icon: '⇕', cls: 'border-neutral-700 text-neutral-300',                       tip: 'Took out both yesterday’s high and low' },
  inside_day:      { label: 'Inside day', short: 'Inside',  icon: '▭', cls: 'border-neutral-700 text-neutral-400',                       tip: 'Today’s range is inside yesterday’s — coiling' },
};
const PD_STATE = {
  above:  { label: 'Above PDH', short: 'Above', icon: '↑', cls: 'border-emerald-500/30 text-emerald-300' },
  below:  { label: 'Below PDL', short: 'Below', icon: '↓', cls: 'border-rose-500/30 text-rose-300' },
  inside: { label: 'Inside',     short: 'Inside', icon: '·', cls: 'border-neutral-800 text-neutral-500' },
};

function PdChip({ m }) {
  const e = PD_EVENT[m.pd_event] || PD_STATE[m.pd_state];
  if (!e) return <span className="text-neutral-700">—</span>;
  const tip = (m.pd_live ? 'Live — provisional until the close. ' : '')
    + `${e.tip ? e.tip + '. ' : ''}PDH ${m.pdh} (${pct(m.dist_pdh)}) · PDL ${m.pdl} (${pct(m.dist_pdl)})`
    + (m.pd_vol_confirmed ? ` · on ${m.rvol}x volume` : '')
    + (m.hh_hl_streak ? ` · ${Math.abs(m.hh_hl_streak)} day${Math.abs(m.hh_hl_streak) > 1 ? 's' : ''} of ${m.hh_hl_streak > 0 ? 'higher highs & lows' : 'lower highs & lows'}` : '');
  return (
    <span title={tip} className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] ${e.cls} ${m.pd_live ? 'border-dashed' : ''}`}>
      <span aria-hidden>{e.icon}</span>
      <span className="sm:hidden">{e.short}</span>
      <span className="hidden sm:inline">{e.label}</span>
      {m.pd_vol_confirmed && <span className="font-mono text-[10px] opacity-80">vol</span>}
    </span>
  );
}

// Mini range: PDL tick at 20%, PDH tick at 80%, dot = current price (clamped).
function PdBar({ m }) {
  if (m.pd_pos == null) return null;
  const x = 20 + Math.max(-30, Math.min(130, m.pd_pos)) * 0.6;
  const dot = m.pd_state === 'above' ? '#059669' : m.pd_state === 'below' ? '#e11d48' : '#a3a3a3';
  return (
    <svg width="64" height="12" viewBox="0 0 100 12" aria-hidden className="shrink-0">
      <line x1="20" y1="6" x2="80" y2="6" stroke="#404040" strokeWidth="2" />
      <line x1="20" y1="2" x2="20" y2="10" stroke="#737373" strokeWidth="1.5" />
      <line x1="80" y1="2" x2="80" y2="10" stroke="#737373" strokeWidth="1.5" />
      <circle cx={Math.max(4, Math.min(96, x))} cy="6" r="4" fill={dot} stroke="#0a0a0a" strokeWidth="1.5" />
    </svg>
  );
}

function PdCell({ m }) {
  if (!m.pd_state) return <span className="text-neutral-700">—</span>;
  return (
    <div className="flex items-center gap-2">
      <span className="hidden sm:inline-flex"><PdBar m={m} /></span>
      <PdChip m={m} />
      {m.hh_hl_streak >= 2 && (
        <span className="hidden sm:inline font-mono text-[10px] text-emerald-500" title={`${m.hh_hl_streak} days of higher highs & higher lows`}>↗{m.hh_hl_streak}d</span>
      )}
      {m.hh_hl_streak <= -2 && (
        <span className="hidden sm:inline font-mono text-[10px] text-rose-500" title={`${-m.hh_hl_streak} days of lower highs & lower lows`}>↘{-m.hh_hl_streak}d</span>
      )}
    </div>
  );
}

function SectorStrip({ g }) {
  const r = g.ref;
  const vs = g.vs_ref || {};
  const verdict = vs.r5 == null ? null
    : vs.r5 >= 0.5 ? 'Your picks are beating the sector'
    : vs.r5 <= -0.5 ? 'The ETF is beating your picks'
    : 'Your picks are tracking the sector';
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-neutral-900 bg-neutral-900/30 px-4 py-2.5 text-[12px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">Sector</span>
        <span className="font-mono font-medium text-neutral-100">{r.symbol}</span>
        <span className="font-mono tabular-nums text-neutral-400">
          <span className={pctClass(r.r1)}>{pct(r.r1, 2)}</span> 1d · <span className={pctClass(r.r5)}>{pct(r.r5)}</span> 5d
          {' '}· <span className={pctClass(r.r20)}>{pct(r.r20)}</span> 20d
        </span>
        <QuadrantChip q={r.quadrant} note={r.phase_note} />
        {r.pd_state && <PdChip m={r} />}
        {r.above_ema20 != null && (
          <span className="text-neutral-500">{r.above_ema20 ? 'above' : 'below'} 20-day avg</span>
        )}
      </div>
      {verdict && (
        <div className="font-mono tabular-nums text-neutral-400" title="Median of your picks minus the ETF's return">
          <span className="font-sans text-neutral-500">{verdict}: </span>
          <span className={pctClass(vs.r5)}>{vs.r5 > 0 ? '+' : ''}{vs.r5?.toFixed(1)} pts</span> 5d
          {vs.r20 != null && <> · <span className={pctClass(vs.r20)}>{vs.r20 > 0 ? '+' : ''}{vs.r20.toFixed(1)} pts</span> 20d</>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top setups — rule-based PDH breakout scan (see sector_pulse.score_setup)
// ---------------------------------------------------------------------------

const POINT_LABELS = {
  volume: ['Volume', 25], strength: ['5d vs SPY', 20], sector: ['Sector', 15],
  trend: ['HH/HL streak', 15], entry: ['Near PDH', 15], extension: ['Not extended', 10],
};

const SETUP_RULES =
  'Must: holding above yesterday\'s high · Leading/Improving vs SPY · above 20-day avg · sector ETF not Lagging. '
  + 'Score: volume 25, 5d strength 20, sector 15, higher-highs streak 15, close to PDH 15, not extended 10.';

function TopSetups({ setups }) {
  const picks = setups.picks || [];
  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-400" title={SETUP_RULES}>
            Top setups <span className="normal-case tracking-normal text-neutral-600">ⓘ</span>
          </div>
          <div className="mt-0.5 text-[12px] text-neutral-600">
            {picks.length} shown · {setups.qualified} qualified of {setups.scanned} scanned (watchlist + groups)
          </div>
        </div>
        <div className="text-[11px] text-amber-300/80">Setups to watch, not buy signals — size per your limits.</div>
      </div>
      {picks.length === 0 ? (
        <div className="rounded-md border border-dashed border-neutral-800 px-4 py-5 text-center text-[13px] text-neutral-500">
          No clean breakouts right now. Nothing qualifies — that’s an answer too.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {picks.map((p, i) => <SetupCard key={p.ticker} p={p} rank={i + 1} />)}
        </div>
      )}
    </section>
  );
}

function SetupCard({ p, rank }) {
  const breakdown = Object.entries(p.points || {})
    .map(([k, v]) => `${POINT_LABELS[k]?.[0] ?? k}: ${v}/${POINT_LABELS[k]?.[1] ?? '?'}`).join(' · ');
  return (
    <div className={`flex flex-col rounded-md border bg-neutral-950/50 px-3 py-3 ${p.pd_live ? 'border-dashed border-neutral-700' : 'border-neutral-800'}`}
      title={p.pd_live ? 'Live — provisional until the close' : undefined}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[10px] text-neutral-600">#{rank}</span>
            <span className="font-mono text-[15px] font-semibold text-neutral-100">{p.ticker}</span>
          </div>
          <div className="mt-0.5 truncate text-[11px] capitalize text-neutral-500">
            {p.source}{p.sector_etf ? ` · ${p.sector_etf}` : ''}
          </div>
        </div>
        <div className="text-right" title={breakdown}>
          <div className="font-mono text-lg tabular-nums text-neutral-100">{p.score}</div>
          <div className="text-[9px] uppercase tracking-wider text-neutral-600">/ 100</div>
        </div>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-900" aria-hidden>
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${p.score}%` }} />
      </div>
      <div className="mt-2 flex items-baseline justify-between font-mono text-[12px] tabular-nums">
        <span className="text-neutral-300">{p.price?.toFixed(2)}</span>
        <span className={pctClass(p.r1)}>{pct(p.r1, 2)}</span>
      </div>
      <div className="mt-1 text-[11px] text-neutral-400">
        Invalid below <span className="font-mono text-neutral-200">{p.invalid_below}</span>
        <span className="text-neutral-600"> (PDH)</span>
      </div>
      {p.reasons?.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-emerald-300/90">
          {p.reasons.slice(0, 3).map((r) => <li key={r}>+ {r}</li>)}
        </ul>
      )}
      {p.cautions?.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[11px] text-amber-300/90">
          {p.cautions.map((c) => <li key={c}>! {c}</li>)}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group editor — reads/writes Supabase pulse_groups
// ---------------------------------------------------------------------------

function GroupEditor({ onClose, onSaved }) {
  const [rows, setRows] = useState(null);
  const [originalIds, setOriginalIds] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState([]); // [{ name, tickers }]
  const [refSupported, setRefSupported] = useState(true);

  // Watchlist categories, so a group can be filled from one in a click.
  useEffect(() => {
    (async () => {
      try {
        await authReady();
        const { data, error: e } = await supabase
          .from('watchlist').select('ticker, category').eq('is_active', true);
        if (e) return;
        const byCat = {};
        for (const r of data || []) {
          const c = (r.category || '').trim();
          if (!c || !r.ticker) continue;
          (byCat[c] ||= new Set()).add(r.ticker.toUpperCase());
        }
        setCategories(Object.entries(byCat)
          .map(([name, set]) => ({ name, tickers: [...set].sort() }))
          .sort((a, b) => a.name.localeCompare(b.name)));
      } catch { /* picker just stays empty */ }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await authReady();
        let { data, error: e } = await supabase
          .from('pulse_groups')
          .select('id, name, tickers, is_benchmark, sort_order, ref_etf')
          .order('sort_order');
        if (e && (e.message || '').includes('ref_etf')) {
          // migration 003 not run yet: edit without the sector-ETF field
          setRefSupported(false);
          ({ data, error: e } = await supabase
            .from('pulse_groups').select('id, name, tickers, is_benchmark, sort_order').order('sort_order'));
        }
        if (e) throw e;
        setRows((data || []).map((r) => ({ ...r, ref: r.ref_etf || '', text: r.tickers.join(', ') })));
        setOriginalIds((data || []).map((r) => r.id));
      } catch (e) {
        setError(
          (e.message || '').includes('pulse_groups')
            ? 'The pulse_groups table doesn’t exist yet — run migrations/002_pulse_groups.sql in Supabase.'
            : e.message || 'Failed to load groups.',
        );
        setRows([]);
      }
    })();
  }, []);

  const update = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i, d) => setRows((rs) => {
    const j = i + d;
    if (j < 0 || j >= rs.length) return rs;
    const next = [...rs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const remove = (i) => setRows((rs) => rs.filter((_, j) => j !== i));
  const add = () => setRows((rs) => [...rs, { id: null, name: '', text: '', ref: '', is_benchmark: false }]);
  const addFromCategory = (i, catName) => {
    const cat = categories.find((c) => c.name === catName);
    if (!cat) return;
    setRows((rs) => rs.map((r, j) => {
      if (j !== i) return r;
      const merged = [...new Set([...parseTickers(r.text), ...cat.tickers])];
      return { ...r, text: merged.join(', '), name: r.name || cat.name.replace(/(^|[-\s])\w/g, (m) => m.toUpperCase()) };
    }));
  };

  const cleaned = (rows || []).map((r, i) => ({
    id: r.id, name: r.name.trim(), tickers: parseTickers(r.text), is_benchmark: r.is_benchmark, sort_order: i,
    ref_etf: (r.ref || '').trim().toUpperCase().replace(/^\$/, '') || null,
  }));
  const names = cleaned.map((r) => r.name.toLowerCase());
  const problems = [
    cleaned.some((r) => !r.name) && 'Every group needs a name.',
    cleaned.some((r) => !r.tickers.length) && 'Every group needs at least one ticker.',
    names.some((n, i) => n && names.indexOf(n) !== i) && 'Group names must be unique.',
  ].filter(Boolean);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await authReady();
      const keep = new Set(cleaned.filter((r) => r.id).map((r) => r.id));
      const toDelete = originalIds.filter((id) => !keep.has(id));
      if (toDelete.length) {
        const { error: e } = await supabase.from('pulse_groups').delete().in('id', toDelete);
        if (e) throw e;
      }
      // Two passes on existing rows so renames that swap names don't hit the unique constraint.
      const existing = cleaned.filter((r) => r.id);
      for (const r of existing) {
        const { error: e } = await supabase.from('pulse_groups').update({ name: `__tmp_${r.id}` }).eq('id', r.id);
        if (e) throw e;
      }
      for (const r of existing) {
        const { error: e } = await supabase.from('pulse_groups').update({
          name: r.name, tickers: r.tickers, is_benchmark: r.is_benchmark,
          sort_order: r.sort_order, updated_at: new Date().toISOString(),
          ...(refSupported ? { ref_etf: r.ref_etf } : {}),
        }).eq('id', r.id);
        if (e) throw e;
      }
      const fresh = cleaned.filter((r) => !r.id).map((r) => ({
        name: r.name, tickers: r.tickers, is_benchmark: r.is_benchmark, sort_order: r.sort_order,
        ...(refSupported ? { ref_etf: r.ref_etf } : {}),
      }));
      if (fresh.length) {
        const { error: e } = await supabase.from('pulse_groups').insert(fresh);
        if (e) throw e;
      }
      onSaved();
    } catch (e) {
      setError(e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mb-6 rounded-md border border-emerald-500/30 bg-neutral-950/60 px-4 py-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-emerald-300">Edit groups</div>
          <div className="mt-0.5 text-[12px] text-neutral-500">
            Tickers separated by commas or spaces. <em>Sector ETF</em> is the benchmark for the group
            (e.g. SMH for semis) — it isn’t counted as one of your picks. Mark a group as <em>index strip</em> to
            show it as the row of index tiles at the top instead of a ranked card.
          </div>
        </div>
        <button onClick={onClose} aria-label="Close editor" className="text-neutral-500 hover:text-neutral-200">
          <X className="h-4 w-4" />
        </button>
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {!refSupported && (
        <Banner tone="warn">Run migrations/003_pulse_ref_etf.sql in Supabase to enable the Sector ETF field.</Banner>
      )}
      {rows === null && <div className="py-4 text-[13px] text-neutral-500">Loading…</div>}

      <div className="mt-2 space-y-2">
        {(rows || []).map((r, i) => (
          <div key={r.id ?? `new-${i}`} className="rounded border border-neutral-800 bg-neutral-950/60 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={r.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="Group name"
                aria-label="Group name"
                className="min-w-0 flex-1 rounded border border-neutral-800 bg-transparent px-2 py-1.5 text-[13px] text-neutral-100 placeholder:text-neutral-700 focus:border-emerald-500/50 focus:outline-none"
              />
              {refSupported && !r.is_benchmark && (
                <input
                  value={r.ref}
                  onChange={(e) => update(i, { ref: e.target.value })}
                  placeholder="Sector ETF (e.g. SMH)"
                  aria-label="Sector ETF"
                  title="Reference ETF: shows whether the sector is trending and whether your picks beat it"
                  className="w-40 rounded border border-neutral-800 bg-transparent px-2 py-1.5 font-mono text-[12px] uppercase text-neutral-200 placeholder:normal-case placeholder:font-sans placeholder:text-neutral-700 focus:border-emerald-500/50 focus:outline-none"
                />
              )}
              <label className="flex items-center gap-1.5 text-[11px] text-neutral-400">
                <input
                  type="checkbox"
                  checked={r.is_benchmark}
                  onChange={(e) => update(i, { is_benchmark: e.target.checked })}
                  className="accent-emerald-500"
                />
                index strip
              </label>
              <div className="flex items-center">
                <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="p-1 text-neutral-500 hover:text-neutral-200 disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
                <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Move down" className="p-1 text-neutral-500 hover:text-neutral-200 disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
                <button onClick={() => remove(i)} aria-label="Delete group" className="p-1 text-neutral-500 hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={r.text}
                onChange={(e) => update(i, { text: e.target.value })}
                placeholder="AMD, NVDA, ARM"
                aria-label="Tickers"
                className="min-w-0 flex-1 rounded border border-neutral-800 bg-transparent px-2 py-1.5 font-mono text-[12px] uppercase text-neutral-200 placeholder:normal-case placeholder:text-neutral-700 focus:border-emerald-500/50 focus:outline-none"
              />
              {categories.length > 0 && (
                <select
                  value=""
                  onChange={(e) => addFromCategory(i, e.target.value)}
                  aria-label="Add tickers from a watchlist category"
                  className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-[12px] text-neutral-400 focus:border-emerald-500/50 focus:outline-none"
                >
                  <option value="">+ from watchlist…</option>
                  {categories.map((c) => (
                    <option key={c.name} value={c.name}>{c.name} ({c.tickers.length})</option>
                  ))}
                </select>
              )}
            </div>
            {r.text && (
              <div className="mt-1 text-[10px] text-neutral-600">{parseTickers(r.text).length} tickers</div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={add}
          className="inline-flex items-center gap-1.5 rounded border border-dashed border-neutral-700 px-3 py-1.5 text-[12px] text-neutral-400 hover:border-emerald-500/50 hover:text-emerald-300"
        >
          <Plus className="h-3.5 w-3.5" /> Add group
        </button>
        <div className="flex items-center gap-3">
          {problems.length > 0 && <span className="text-[12px] text-amber-300">{problems[0]}</span>}
          <button
            onClick={save}
            disabled={saving || rows === null || problems.length > 0}
            className="rounded border border-emerald-500/50 bg-emerald-500/10 px-4 py-1.5 text-[12px] font-medium uppercase tracking-[0.12em] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save groups'}
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rotation map
// ---------------------------------------------------------------------------

function RotationTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-[12px] shadow-xl">
      <div className="font-medium text-neutral-100">{d.ticker} <span className="text-neutral-500">{d.group}</span></div>
      <div className="mt-1 font-mono tabular-nums text-neutral-400">
        vs SPY 5d <span className={pctClass(d.rs5)}>{pct(d.rs5)}</span> · 20d <span className={pctClass(d.rs20)}>{pct(d.rs20)}</span>
      </div>
      <div className="font-mono tabular-nums text-neutral-400">today <span className={pctClass(d.r1)}>{pct(d.r1, 2)}</span></div>
      {d.quadrant && <div className="mt-1 text-neutral-500">{d.quadrant} — {QUADRANT[d.quadrant].blurb}</div>}
    </div>
  );
}

function Dot({ cx, cy, payload }) {
  if (cx == null || cy == null) return null;
  const color = QUADRANT[payload.quadrant]?.color || '#737373';
  return (
    <g>
      <circle cx={cx} cy={cy} r={5} fill={color} stroke="#0a0a0a" strokeWidth={2} />
      <text x={cx + 8} y={cy + 3.5} fontSize={10} fill="#a3a3a3" fontFamily="ui-monospace, monospace">
        {payload.ticker}
      </text>
    </g>
  );
}

function RotationMap({ groups }) {
  const data = useMemo(() => {
    const seen = new Set();
    return groups.flatMap((g) => g.members.map((m) => ({ ...m, group: g.name })))
      .filter((m) => m.rs5 != null && m.rs20 != null && !seen.has(m.ticker) && seen.add(m.ticker));
  }, [groups]);
  if (!data.length) return null;
  const bound = (key) => Math.ceil(Math.max(1, ...data.map((d) => Math.abs(d[key]))) * 1.15);
  const bx = bound('rs20');
  const by = bound('rs5');
  const ticks = (b) => {
    const h = Math.round(b / 2);
    return h > 0 && h < b ? [-b, -h, 0, h, b] : [-b, 0, b];
  };
  const corner = 'pointer-events-none absolute text-[10px] uppercase tracking-[0.18em]';
  return (
    <div className="relative mt-2 rounded-md border border-neutral-800 bg-neutral-950/40 px-1 py-2">
      <span className={`${corner} right-8 top-3 ${QUADRANT.Leading.text}`}>Leading</span>
      <span className={`${corner} left-14 top-3 ${QUADRANT.Improving.text}`}>Improving</span>
      <span className={`${corner} right-8 bottom-16 ${QUADRANT.Weakening.text}`}>Weakening</span>
      <span className={`${corner} left-14 bottom-16 ${QUADRANT.Lagging.text}`}>Lagging</span>
      <ResponsiveContainer width="100%" height={320}>
        <ScatterChart margin={{ top: 16, right: 28, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#1f1f1f" />
          <XAxis
            type="number" dataKey="rs20" domain={[-bx, bx]} ticks={ticks(bx)} tickFormatter={(v) => `${v > 0 ? '+' : ''}${v}`}
            stroke="#525252" tick={{ fontSize: 10, fill: '#737373' }} tickLine={false}
            label={{ value: 'vs SPY, 20 days (pts)', position: 'insideBottom', offset: -4, fontSize: 10, fill: '#525252' }}
            height={36}
          />
          <YAxis
            type="number" dataKey="rs5" domain={[-by, by]} ticks={ticks(by)} tickFormatter={(v) => `${v > 0 ? '+' : ''}${v}`}
            stroke="#525252" tick={{ fontSize: 10, fill: '#737373' }} tickLine={false} width={44}
            label={{ value: '5 days', angle: -90, position: 'insideLeft', offset: 14, fontSize: 10, fill: '#525252' }}
          />
          <ReferenceLine x={0} stroke="#404040" />
          <ReferenceLine y={0} stroke="#404040" />
          <Tooltip content={<RotationTooltip />} cursor={false} />
          <Scatter data={data} shape={<Dot />} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
