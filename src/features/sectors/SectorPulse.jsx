import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, AlertCircle, RefreshCw, TrendingUp, TrendingDown, Radar,
} from 'lucide-react';
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis, ReferenceLine,
  Tooltip, CartesianGrid,
} from 'recharts';
import { supabase, authReady } from '../../lib/supabase';

// Written every 30 min by sector_pulse.py on the GCP bot → Supabase market_pulse.
// This page only reads the latest row, so it loads instantly and costs nothing.

// Validated for dark surface #0a0a0a (lightness band, contrast, CVD adjacent).
// Quadrant is also encoded by chart position and a text label — never color alone.
const QUADRANT = {
  Leading:   { color: '#059669', text: 'text-emerald-300', chip: 'border-emerald-500/40 bg-emerald-500/10', blurb: 'strong short & long term' },
  Weakening: { color: '#d97706', text: 'text-amber-300',   chip: 'border-amber-500/40 bg-amber-500/10',     blurb: 'trend intact, momentum fading' },
  Improving: { color: '#0284c7', text: 'text-sky-300',     chip: 'border-sky-500/40 bg-sky-500/10',         blurb: 'money rotating in' },
  Lagging:   { color: '#e11d48', text: 'text-rose-300',    chip: 'border-rose-500/40 bg-rose-500/10',       blurb: 'weak short & long term' },
};

const SESSION_LABEL = {
  premarket: 'Pre-market', regular: 'Market open', afterhours: 'After hours', closed: 'Market closed',
};

const STALE_MIN = 45;

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

// ---------------------------------------------------------------------------

export default function SectorPulse() {
  const [state, setState] = useState({ loading: true, error: null, row: null });
  const [tab, setTab] = useState('themes');

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
  const stale = row && ['premarket', 'regular'].includes(row.session) && minutesAgo(row.as_of) > STALE_MIN;
  const groups = row ? (tab === 'themes' ? row.themes : row.sectors) : [];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 font-sans antialiased selection:bg-emerald-500/30">
      <div className="relative mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
        {/* Header */}
        <header className="mb-8">
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
              <p className="mt-1 text-[13px] text-neutral-500">
                Where money is moving — sectors, themes, and your watchlist groups.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {row && (
                <div className="text-right font-mono text-[11px] text-neutral-500">
                  <div className="uppercase tracking-[0.18em]">{SESSION_LABEL[row.session] || row.session}</div>
                  <div title={new Date(row.as_of).toLocaleString()}>updated {ago(row.as_of)}</div>
                </div>
              )}
              <button
                onClick={load}
                disabled={state.loading}
                aria-label="Refresh"
                className="rounded border border-neutral-800 p-2 text-neutral-400 hover:border-emerald-500/40 hover:text-emerald-400 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`h-4 w-4 ${state.loading ? 'animate-spin' : ''}`} strokeWidth={1.75} />
              </button>
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
        </header>

        {!state.loading && !state.error && !row && (
          <div className="rounded-md border border-dashed border-neutral-800 px-5 py-10 text-center text-sm text-neutral-500">
            No snapshots yet. The agent writes its first one about 15 seconds after the bot starts.
          </div>
        )}

        {row && (
          <>
            {/* Narrative + tape */}
            <section className="mb-6 rounded-md border border-neutral-800 bg-neutral-950/40 px-5 py-5">
              <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-emerald-400/80">
                Read of the tape
                {row.risk?.tone && <RiskChip tone={row.risk.tone} />}
              </div>
              <p className="mt-3 text-[14px] leading-relaxed text-neutral-300">{row.narrative}</p>
              <div className="mt-5 grid grid-cols-3 gap-3 border-t border-neutral-900 pt-4 sm:grid-cols-5">
                {Object.entries(row.benchmarks || {}).map(([sym, b]) => (
                  <div key={sym}>
                    <div className="text-[10px] uppercase tracking-wider text-neutral-500">
                      {sym} <span className="normal-case tracking-normal text-neutral-700">{b.name}</span>
                    </div>
                    <div className={`mt-1 font-mono text-[15px] tabular-nums ${pctClass(b.r1)}`}>{pct(b.r1, 2)}</div>
                    <div className="font-mono text-[10px] tabular-nums text-neutral-600">5d {pct(b.r5)}</div>
                  </div>
                ))}
              </div>
            </section>

            {/* Watchlist groups */}
            <section className="mb-8">
              <SectionTitle
                title="Your watchlist groups"
                hint="Ranked by heat (0–100, relative strength vs SPY over 1/5/20 days). Tap a group for leaders."
              />
              <CategoryGrid categories={row.categories || []} />
            </section>

            {/* Rotation map + table */}
            <section className="mb-8">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <SectionTitle
                  title="Rotation"
                  hint="Right = beating SPY over 20 days. Up = beating SPY over 5 days."
                  noMargin
                />
                <div role="tablist" className="flex rounded border border-neutral-800 p-0.5 text-[11px] uppercase tracking-[0.15em]">
                  {[['themes', 'Themes'], ['sectors', 'Sectors']].map(([k, label]) => (
                    <button
                      key={k}
                      role="tab"
                      aria-selected={tab === k}
                      onClick={() => setTab(k)}
                      className={`rounded px-3 py-1.5 transition-colors ${
                        tab === k ? 'bg-emerald-500/15 text-emerald-300' : 'text-neutral-500 hover:text-neutral-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <RotationMap rows={groups} />
              <GroupTable rows={groups} />
            </section>

            <footer className="pt-2 text-center font-mono text-[10px] text-neutral-700">
              {row.coverage?.symbols_computed}/{row.coverage?.symbols_requested} symbols ·{' '}
              {row.coverage?.live_quotes ? `${row.coverage.live_quotes} live quotes · ` : ''}
              narrative: {row.narrative_source}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Banner({ tone, children }) {
  const cls = tone === 'error'
    ? 'border-rose-500/30 bg-rose-500/5 text-rose-300'
    : 'border-amber-500/30 bg-amber-500/5 text-amber-200';
  return (
    <div className={`mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] ${cls}`}>
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
      <span>{children}</span>
    </div>
  );
}

function SectionTitle({ title, hint, noMargin }) {
  return (
    <div className={noMargin ? '' : 'mb-3'}>
      <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-400">{title}</div>
      {hint && <div className="mt-0.5 text-[12px] text-neutral-600">{hint}</div>}
    </div>
  );
}

function RiskChip({ tone }) {
  const map = {
    'risk-on':  ['Risk-on', 'border-emerald-500/40 text-emerald-300', TrendingUp],
    'risk-off': ['Risk-off', 'border-rose-500/40 text-rose-300', TrendingDown],
    mixed:      ['Mixed', 'border-neutral-700 text-neutral-400', null],
  };
  const [label, cls, Icon] = map[tone] || map.mixed;
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 normal-case tracking-normal text-[11px] ${cls}`}>
      {Icon && <Icon className="h-3 w-3" strokeWidth={2} />}
      {label}
    </span>
  );
}

function QuadrantChip({ q }) {
  if (!q) return <span className="text-neutral-700">—</span>;
  const s = QUADRANT[q];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[11px] ${s.chip} ${s.text}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
      {q}
    </span>
  );
}

function FlowTag({ flow, rvol }) {
  if (!flow) return rvol ? <span className="font-mono text-neutral-600">{rvol}x</span> : <span className="text-neutral-700">—</span>;
  const inflow = flow === 'inflow';
  return (
    <span className={`inline-flex items-center gap-1 font-mono ${inflow ? 'text-emerald-400' : 'text-rose-400'}`}>
      {inflow ? <TrendingUp className="h-3 w-3" strokeWidth={2} /> : <TrendingDown className="h-3 w-3" strokeWidth={2} />}
      {rvol}x {inflow ? 'in' : 'out'}
    </span>
  );
}

function HeatBar({ heat }) {
  if (heat === null || heat === undefined) return <span className="text-neutral-700">—</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-neutral-900" aria-hidden>
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(heat, 3)}%`, opacity: 0.35 + (heat / 100) * 0.65 }} />
      </div>
      <span className="w-6 font-mono tabular-nums text-neutral-300">{heat}</span>
    </div>
  );
}

// Diverging tile tint on today's move: rose ← neutral → emerald, capped at ±3%.
function tileStyle(r1) {
  if (r1 === null || r1 === undefined) return {};
  const a = Math.min(Math.abs(r1) / 3, 1) * 0.22;
  const rgb = r1 >= 0 ? '5,150,105' : '225,29,72';
  return { background: `rgba(${rgb},${a})`, borderColor: `rgba(${rgb},${0.15 + a * 1.5})` };
}

function CategoryGrid({ categories }) {
  const [open, setOpen] = useState(null);
  if (!categories.length) {
    return <div className="text-[13px] text-neutral-600">No categorised watchlist tickers.</div>;
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {categories.map((c) => {
        const isOpen = open === c.category;
        return (
          <button
            key={c.category}
            onClick={() => setOpen(isOpen ? null : c.category)}
            aria-expanded={isOpen}
            style={tileStyle(c.r1)}
            className={`rounded-md border border-neutral-800 px-3 py-3 text-left transition-colors hover:border-neutral-600 ${
              isOpen ? 'col-span-2 sm:col-span-3 lg:col-span-4' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-[13px] font-medium capitalize text-neutral-100">{c.category}</div>
              <div className="font-mono text-[11px] tabular-nums text-neutral-400" title="Heat (0–100)">{c.heat ?? '—'}</div>
            </div>
            <div className={`mt-1.5 font-mono text-lg tabular-nums ${pctClass(c.r1)}`}>{pct(c.r1)}</div>
            <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10px] tabular-nums text-neutral-500">
              <span>5d {pct(c.r5)}</span>
              <span>{c.breadth_up ?? '—'}% green</span>
              <span>{c.count} names</span>
            </div>
            {!isOpen && c.leaders?.[0] && (
              <div className="mt-2 truncate text-[11px] text-neutral-500">
                top <span className="font-mono text-neutral-300">{c.leaders[0].ticker}</span>{' '}
                <span className={`font-mono ${pctClass(c.leaders[0].r1)}`}>{pct(c.leaders[0].r1)}</span>
              </div>
            )}
            {isOpen && (
              <div className="mt-3 grid gap-4 border-t border-neutral-800/80 pt-3 sm:grid-cols-3">
                <MemberList title="Leaders" items={c.leaders} />
                <MemberList title="Laggards" items={c.laggards} />
                <div className="space-y-1 text-[12px] text-neutral-400">
                  <div className="text-[10px] uppercase tracking-wider text-neutral-500">Detail</div>
                  <div className="flex items-center gap-2">Phase <QuadrantChip q={c.quadrant} /></div>
                  <div>vs SPY: <span className={`font-mono ${pctClass(c.rs5)}`}>{pct(c.rs5)}</span> 5d · <span className={`font-mono ${pctClass(c.rs20)}`}>{pct(c.rs20)}</span> 20d</div>
                  <div>{c.pct_above_ema20 ?? '—'}% above 20 EMA</div>
                  {(c.inflows > 0 || c.outflows > 0) && (
                    <div>Heavy volume: <span className="text-emerald-400">{c.inflows} up</span> · <span className="text-rose-400">{c.outflows} down</span></div>
                  )}
                  {c.missing?.length > 0 && <div className="text-neutral-600">No data: {c.missing.join(', ')}</div>}
                </div>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function MemberList({ title, items }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-neutral-500">{title}</div>
      {items?.length ? (
        <ul className="space-y-0.5">
          {items.map((m) => (
            <li key={m.ticker} className="flex justify-between gap-3 font-mono text-[12px] tabular-nums">
              <span className="text-neutral-200">{m.ticker}</span>
              <span className={pctClass(m.r1)}>{pct(m.r1)}</span>
            </li>
          ))}
        </ul>
      ) : <div className="text-[12px] text-neutral-600">—</div>}
    </div>
  );
}

function RotationTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded border border-neutral-700 bg-neutral-950 px-3 py-2 text-[12px] shadow-xl">
      <div className="font-medium text-neutral-100">{d.symbol} <span className="text-neutral-500">{d.name}</span></div>
      <div className="mt-1 font-mono tabular-nums text-neutral-400">
        vs SPY 5d <span className={pctClass(d.rs5)}>{pct(d.rs5)}</span> · 20d <span className={pctClass(d.rs20)}>{pct(d.rs20)}</span>
      </div>
      <div className="font-mono tabular-nums text-neutral-400">today <span className={pctClass(d.r1)}>{pct(d.r1, 2)}</span> · heat {d.heat}</div>
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
        {payload.symbol}
      </text>
    </g>
  );
}

function RotationMap({ rows }) {
  const data = useMemo(() => rows.filter((r) => r.rs5 != null && r.rs20 != null), [rows]);
  const bound = (key) => {
    const m = Math.max(1, ...data.map((d) => Math.abs(d[key])));
    return Math.ceil(m * 1.15);
  };
  const bx = bound('rs20');
  const by = bound('rs5');
  const ticks = (b) => {
    const h = Math.round(b / 2);
    return h > 0 && h < b ? [-b, -h, 0, h, b] : [-b, 0, b];
  };
  if (!data.length) return null;

  const corner = 'pointer-events-none absolute text-[10px] uppercase tracking-[0.18em]';
  return (
    <div className="relative mb-4 rounded-md border border-neutral-800 bg-neutral-950/40 px-1 py-2">
      <span className={`${corner} right-8 top-3 ${QUADRANT.Leading.text}`}>Leading</span>
      <span className={`${corner} left-14 top-3 ${QUADRANT.Improving.text}`}>Improving</span>
      <span className={`${corner} right-8 bottom-16 ${QUADRANT.Weakening.text}`}>Weakening</span>
      <span className={`${corner} left-14 bottom-16 ${QUADRANT.Lagging.text}`}>Lagging</span>
      <ResponsiveContainer width="100%" height={340}>
        <ScatterChart margin={{ top: 16, right: 28, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#1f1f1f" strokeDasharray="0" />
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

function GroupTable({ rows }) {
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-800">
      <table className="w-full min-w-[640px] text-[12px]">
        <thead>
          <tr className="border-b border-neutral-800 text-left text-[10px] uppercase tracking-wider text-neutral-500">
            <th className="px-3 py-2 font-normal">ETF</th>
            <th className="px-3 py-2 font-normal">Heat</th>
            <th className="px-3 py-2 text-right font-normal">1d</th>
            <th className="px-3 py-2 text-right font-normal">5d</th>
            <th className="px-3 py-2 text-right font-normal">20d</th>
            <th className="px-3 py-2 font-normal">Phase</th>
            <th className="px-3 py-2 font-normal">Volume</th>
            <th className="px-3 py-2 text-right font-normal">vs 20 EMA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol} className="border-b border-neutral-900 last:border-0 hover:bg-neutral-900/40">
              <td className="px-3 py-2">
                <span className="font-mono text-neutral-100">{r.symbol}</span>{' '}
                <span className="text-neutral-500">{r.name}</span>
              </td>
              <td className="px-3 py-2"><HeatBar heat={r.heat} /></td>
              <td className={`px-3 py-2 text-right font-mono tabular-nums ${pctClass(r.r1)}`}>{pct(r.r1, 2)}</td>
              <td className={`px-3 py-2 text-right font-mono tabular-nums ${pctClass(r.r5)}`}>{pct(r.r5)}</td>
              <td className={`px-3 py-2 text-right font-mono tabular-nums ${pctClass(r.r20)}`}>{pct(r.r20)}</td>
              <td className="px-3 py-2"><QuadrantChip q={r.quadrant} /></td>
              <td className="px-3 py-2"><FlowTag flow={r.flow} rvol={r.rvol} /></td>
              <td className={`px-3 py-2 text-right font-mono tabular-nums ${pctClass(r.dist_ema20)}`}>{pct(r.dist_ema20)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
