import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import HelpLink from '../../components/HelpLink';

// Top-down read, in the order a 20-minute morning routine runs it (bot: sector_pulse.build_topdown):
//   1 market check (SPY/QQQ/IWM trend, VIX)  →  2 the 11 sectors ranked vs SPY  →  3 themes inside the leaders
//   →  4 qualified setups that sit inside the leading sectors.
// Phase is always shown as a text label, never color alone.

const PHASE = {
  Leading: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  Improving: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  Weakening: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  Lagging: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  'In line': 'border-neutral-700 bg-neutral-800/40 text-neutral-300',
};
const PREF_KEY = 'sectors.topdown.open';

const pts = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}`);
const pct = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}%`);
const tone = (v) => (v == null ? 'text-neutral-500' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-neutral-400');

function readPref() {
  try { return window.localStorage.getItem(PREF_KEY) !== '0'; } catch { return true; }
}

function Phase({ p }) {
  if (!p) return <span className="text-[10px] text-neutral-600">—</span>;
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] ${PHASE[p] || PHASE['In line']}`}>{p}</span>;
}

function Step({ n, title, hint, children }) {
  return (
    <div className="border-t border-neutral-900 px-3 py-3 first:border-t-0 sm:px-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-[10px] text-emerald-400/80">{n}</span>
        <span className="text-[11px] uppercase tracking-[0.18em] text-neutral-300">{title}</span>
        {hint && <span className="text-[11px] text-neutral-600">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function IndexTile({ sym, m, label }) {
  if (!m) return null;
  const verdict = sym === 'SPY'
    ? (m.uptrend ? 'Uptrend' : m.ema_trend === 'down' ? 'Downtrend' : 'No clean trend')
    : sym === 'QQQ'
      ? ({ Leading: 'Leading SPY', Improving: 'Starting to lead', Weakening: 'Losing its lead', Lagging: 'Lagging SPY', 'In line': 'In line with SPY' }[m.phase] || '—')
      : ({ Leading: 'Participating', Improving: 'Starting to participate', Weakening: 'Fading', Lagging: 'Lagging — narrow market', 'In line': 'In line with SPY' }[m.phase] || '—');
  const good = sym === 'SPY' ? m.uptrend : ['Leading', 'Improving'].includes(m.phase);
  return (
    <div className="rounded border border-neutral-800 bg-[#0b0b0b] px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[13px] font-semibold text-neutral-100">{sym}</span>
        <span className={`font-mono text-[12px] tabular-nums ${tone(m.r1)}`}>{pct(m.r1)}</span>
      </div>
      <div className={`mt-0.5 text-[12px] ${good ? 'text-emerald-300' : 'text-amber-300'}`}>{verdict}</div>
      <div className="mt-0.5 text-[10px] text-neutral-600">
        {label} · 8/21 {m.ema_trend || '—'}{m.ema21_rising ? ', 21 rising' : ''}
        {sym !== 'SPY' && m.rs20 != null && <> · vs SPY 20d {pts(m.rs20)}</>}
      </div>
    </div>
  );
}

function VixTile({ v, cut }) {
  if (!v) return null;
  const word = v.state === 'elevated' ? (v.rising ? 'Elevated and rising' : 'Elevated') : v.state === 'subdued' ? 'Subdued' : 'Normal';
  const bad = v.state === 'elevated';
  return (
    <div className="rounded border border-neutral-800 bg-[#0b0b0b] px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[13px] font-semibold text-neutral-100">VIX</span>
        <span className="font-mono text-[12px] tabular-nums text-neutral-300">{v.level}</span>
      </div>
      <div className={`mt-0.5 text-[12px] ${bad ? 'text-amber-300' : 'text-emerald-300'}`}>{word}</div>
      <div className="mt-0.5 text-[10px] text-neutral-600">
        5d {pct(v.r5)}{cut ? ' · turned the gate to caution' : ' · ≥20 and +10% in 5d = caution'}
      </div>
    </div>
  );
}

export default function TopDown({ market, groups, setups }) {
  const [open, setOpen] = useState(readPref);
  const [allThemes, setAllThemes] = useState(false);
  const td = market?.topdown;
  if (!td) return null;
  const toggle = () => setOpen((o) => {
    try { window.localStorage.setItem(PREF_KEY, o ? '0' : '1'); } catch { /* ignore */ }
    return !o;
  });
  const sectors = td.sectors || [];
  const top = sectors.filter((s) => s.tier === 'top');
  const topSyms = new Set(top.map((s) => s.symbol));
  const themes = (td.themes || []).filter((t) => topSyms.has(t.parent));
  const groupByEtf = new Map();
  for (const g of groups || []) {
    const etf = g.ref?.symbol || g.ref_etf;
    if (etf) groupByEtf.set(etf, [...(groupByEtf.get(etf) || []), g.name]);
  }
  const inLeaders = (setups?.all || []).filter((s) => s.parent_sector && topSyms.has(s.parent_sector));
  const leaders = top.map((s) => s.symbol).join(', ');

  return (
    <section className="mb-6 overflow-hidden rounded-md border border-neutral-800 bg-neutral-950/40">
      <button type="button" onClick={toggle} aria-expanded={open}
        className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left sm:px-4">
        <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-neutral-400">
          Top-down <HelpLink to="topdown" />
          <span className="font-normal normal-case tracking-normal text-neutral-500">
            {leaders ? `leaders ${leaders}` : ''}{td.rotation?.length ? ` · ${td.rotation.length} rotation${td.rotation.length > 1 ? 's' : ''}` : ''}
          </span>
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-neutral-500" /> : <ChevronDown className="h-4 w-4 text-neutral-500" />}
      </button>
      {open && (
        <div className="border-t border-neutral-900">
          <Step n="1" title="Market check" hint="trend, growth vs broad market, fear">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <IndexTile sym="SPY" m={td.market?.SPY} label="S&P 500" />
              <IndexTile sym="QQQ" m={td.market?.QQQ} label="growth" />
              <IndexTile sym="IWM" m={td.market?.IWM} label="breadth" />
              <VixTile v={td.vix} cut={market?.vix_cut} />
            </div>
            {td.notes?.length > 0 && <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">{td.notes.join(' · ')}.</p>}
          </Step>

          <Step n="2" title="Sector ranking" hint="11 sectors vs SPY (5d + 20d) · arrows = change in rank over 5 sessions">
            {td.rotation?.length > 0 && (
              <div className="mb-2 rounded border border-sky-500/30 bg-sky-500/5 px-2.5 py-1.5 text-[12px] text-sky-200">
                Rotation: {td.rotation.map((r) => `${r.symbol} ${r.rank_change > 0 ? 'up' : 'down'} ${Math.abs(r.rank_change)} to #${r.rank}`).join(' · ')}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[460px] text-[12px]">
                <thead><tr className="text-left text-[9px] uppercase tracking-wider text-neutral-600">
                  <th className="py-1 pr-2 font-normal">#</th><th className="py-1 pr-2 font-normal">Sector</th>
                  <th className="py-1 pr-2 text-right font-normal">vs SPY 5d</th><th className="py-1 pr-2 text-right font-normal">20d</th>
                  <th className="py-1 pr-2 font-normal">Phase</th><th className="py-1 text-right font-normal">5d move</th>
                </tr></thead>
                <tbody>
                  {sectors.map((s) => (
                    <tr key={s.symbol} className={`border-t border-neutral-900 ${s.tier === 'middle' ? 'opacity-60' : ''}`}>
                      <td className="py-1 pr-2 font-mono tabular-nums text-neutral-500">{s.rank}</td>
                      <td className="py-1 pr-2">
                        <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${s.tier === 'top' ? 'bg-emerald-400' : s.tier === 'bottom' ? 'bg-rose-400' : 'bg-neutral-600'}`} />
                        <span className="font-mono text-neutral-100">{s.symbol}</span> <span className="text-neutral-500">{s.name}</span>
                      </td>
                      <td className={`py-1 pr-2 text-right font-mono tabular-nums ${tone(s.rs5)}`}>{pts(s.rs5)}</td>
                      <td className={`py-1 pr-2 text-right font-mono tabular-nums ${tone(s.rs20)}`}>{pts(s.rs20)}</td>
                      <td className="py-1 pr-2"><Phase p={s.phase} /></td>
                      <td className="py-1 text-right font-mono text-[11px] tabular-nums">
                        {s.rank_change == null ? <span className="text-neutral-600">—</span>
                          : s.rank_change === 0 ? <Minus className="ml-auto h-3 w-3 text-neutral-600" />
                            : <span className={`inline-flex items-center gap-0.5 ${s.rank_change > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {s.rank_change > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{Math.abs(s.rank_change)}
                            </span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[11px] text-neutral-600">Green dot = top {top.length} (setups there get +5 sector points), red = bottom 3 (+0).</p>
          </Step>

          <Step n="3" title="Themes inside the leaders" hint={leaders ? `themes whose parent is ${leaders}` : ''}>
            {themes.length === 0 ? <div className="text-[12px] text-neutral-600">No tracked themes under the leading sectors.</div> : (
              <div className="flex flex-wrap gap-2">
                {(allThemes ? themes : themes.slice(0, 8)).map((t) => (
                  <div key={t.symbol} className="min-w-[150px] flex-1 rounded border border-neutral-800 bg-[#0b0b0b] px-2.5 py-2 sm:flex-none">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[12px] font-semibold text-neutral-100">{t.symbol}</span>
                      <Phase p={t.phase} />
                    </div>
                    <div className="mt-0.5 text-[11px] text-neutral-400">{t.label} <span className="text-neutral-600">· {t.parent}</span></div>
                    <div className="mt-0.5 font-mono text-[10px] tabular-nums text-neutral-500">
                      vs SPY 5d <span className={tone(t.rs5)}>{pts(t.rs5)}</span> · 20d <span className={tone(t.rs20)}>{pts(t.rs20)}</span>
                    </div>
                    {groupByEtf.get(t.symbol) && <div className="mt-0.5 text-[10px] text-emerald-300/80">your group: {groupByEtf.get(t.symbol).join(', ')}</div>}
                  </div>
                ))}
                {themes.length > 8 && (
                  <button type="button" onClick={() => setAllThemes((v) => !v)} className="self-center text-[11px] text-neutral-500 hover:text-emerald-300">
                    {allThemes ? 'Show top 8' : `Show all ${themes.length}`}
                  </button>
                )}
              </div>
            )}
          </Step>

          <Step n="4" title="Setups inside the leading sectors" hint="from your groups and watchlist">
            {inLeaders.length === 0 ? (
              <div className="text-[12px] text-neutral-600">
                None of today’s qualified setups sit in a top-{top.length} sector. If the market or sectors are weak, smaller size or cash is a valid answer.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {inLeaders.slice(0, 12).map((s) => (
                  <Link key={s.ticker} to={`/lookup/${s.ticker}`}
                    className="inline-flex items-baseline gap-1.5 rounded border border-neutral-800 px-2 py-1 text-[12px] hover:border-emerald-500/40">
                    <span className="font-mono font-semibold text-neutral-100">{s.ticker}</span>
                    <span className="font-mono text-[11px] tabular-nums text-neutral-400">{s.score}</span>
                    <span className="text-[10px] text-neutral-600">{s.sector_etf || s.parent_sector}{s.entry_type === 'retest' ? ' · retest' : ''}</span>
                  </Link>
                ))}
              </div>
            )}
          </Step>
        </div>
      )}
    </section>
  );
}
