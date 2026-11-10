import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import HelpLink from '../../components/HelpLink';

// Strength view (Nov 10): the same ranking, drawn so relative strength reads at a glance:
//   buckets in plain words (Leading / Turning up / Fading / Weak) instead of one long list
//   a 30-session relative-strength line per group (median member minus SPY, added up; last 5 sessions highlighted)
//   5d and 20d as bars from a zero line, a 10-day win/loss strip, and how many members are ahead of SPY
// The table view is still there. Display only: the ranking rule did not change.
// Your watchlist, read top-down like the sectors (bot: sector_pulse.watchlist_groups + rank_groups):
// categories ranked by median (5d + 20d/4) excess return vs SPY, rank change over 5 sessions, then the strongest names
// inside the top groups. Phase is always shown as a text label, never color alone.

const PHASE = {
  Leading: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  Improving: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  Weakening: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  Lagging: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  'In line': 'border-neutral-700 bg-neutral-800/40 text-neutral-300',
};
const PREF_KEY = 'sectors.wlrank.open';
const VIEW_KEY = 'sectors.wlrank.view';
const pts = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}`);
const tone = (v) => (v == null ? 'text-neutral-500' : v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-neutral-400');

function readPref() {
  try { return window.localStorage.getItem(PREF_KEY) !== '0'; } catch { return true; }
}

function Phase({ p }) {
  if (!p) return <span className="text-[10px] text-neutral-600">—</span>;
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] ${PHASE[p] || PHASE['In line']}`}>{p}</span>;
}

function Change({ v }) {
  if (v == null) return <span className="text-neutral-600">—</span>;
  if (v === 0) return <Minus className="ml-auto h-3 w-3 text-neutral-600" />;
  return (
    <span className={`inline-flex items-center gap-0.5 ${v > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
      {v > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{Math.abs(v)}
    </span>
  );
}

const BUCKETS = [
  { phase: 'Leading', label: 'Leading', hint: 'Ahead of SPY this week and over 20 days.', cls: 'text-emerald-300' },
  { phase: 'Improving', label: 'Turning up', hint: 'Ahead this week, still behind over 20 days. A bounce until the 20-day line turns.', cls: 'text-sky-300' },
  { phase: 'Weakening', label: 'Fading', hint: 'Behind this week, still ahead over 20 days. Leadership at risk.', cls: 'text-amber-300' },
  { phase: 'In line', label: 'In line', hint: 'Moving with SPY.', cls: 'text-neutral-300' },
  { phase: 'Lagging', label: 'Weak', hint: 'Behind SPY this week and over 20 days.', cls: 'text-rose-300' },
];
const UP = '#34d399';
const DOWN = '#fb7185';

function readView() {
  try { return window.localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'chart'; } catch { return 'chart'; }
}

// The group's relative-strength line: its job is the SHAPE (rising, falling, turning). Each line is scaled to
// itself (never tighter than a 6-point range, so a quiet group still looks quiet); the bars carry the size.
// Grey = the older sessions, colour = the last 5.
function RsLine({ line, name }) {
  if (!line || line.length < 3) return <span className="text-[10px] text-neutral-700">no history yet</span>;
  const W = 150, H = 38, pad = 3;
  const mid = (Math.min(...line) + Math.max(...line)) / 2;
  const half = Math.max(3, (Math.max(...line) - Math.min(...line)) / 2);
  const lo = mid - half, hi = mid + half;
  const x = (i) => pad + (i / (line.length - 1)) * (W - 2 * pad);
  const y = (v) => pad + (1 - (v - lo) / (hi - lo || 1)) * (H - 2 * pad);
  const pts = line.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const cut = Math.max(0, line.length - 6);
  const end = line[line.length - 1];
  const wk = end - line[cut];
  const col = wk >= 0 ? UP : DOWN;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[38px] w-[150px] shrink-0" role="img"
      aria-label={`${name}: ${pts.length - 1}-session line vs SPY ends at ${pts.length ? end.toFixed(1) : 0} points, ${wk >= 0 ? 'up' : 'down'} ${Math.abs(wk).toFixed(1)} in the last 5 sessions`}>
      {lo <= 0 && hi >= 0 && <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} stroke="#525252" strokeWidth="1" strokeDasharray="2 3" />}
      <polyline points={pts.slice(0, cut + 1).join(' ')} fill="none" stroke="#737373" strokeWidth="1.25" strokeLinejoin="round" />
      <polyline points={pts.slice(cut).join(' ')} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(line.length - 1)} cy={y(end)} r="2.5" fill={col} />
    </svg>
  );
}

// One bar from a zero line in the middle. `max` is the largest move in that window across all groups.
function Bar({ label, v, max }) {
  const w = v == null ? 0 : Math.min(50, (Math.abs(v) / (max || 1)) * 50);
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-6 text-[9px] uppercase tracking-wider text-neutral-600">{label}</span>
      <span className="relative h-2 w-24 shrink-0 rounded-sm bg-neutral-900">
        <span className="absolute inset-y-0 left-1/2 w-px bg-neutral-600" />
        {v != null && <span className="absolute inset-y-0 rounded-sm" style={{ background: v >= 0 ? UP : DOWN, width: `${w}%`, left: v >= 0 ? '50%' : `${50 - w}%` }} />}
      </span>
      <span className={`w-11 text-right font-mono text-[11px] tabular-nums ${tone(v)}`}>{pts(v)}</span>
    </div>
  );
}

// The last 10 sessions, oldest to newest: a filled square = the group beat SPY that day, hollow = it lost.
function Strip({ days, wins }) {
  if (!days?.length) return <span className="text-[10px] text-neutral-700">—</span>;
  return (
    <div className="flex items-center gap-1.5">
      <span className="flex gap-[2px]" role="img" aria-label={`Beat SPY on ${wins} of the last ${days.length} sessions`}>
        {days.map((d, i) => (
          <span key={i} title={`${days.length - i - 1 ? `${days.length - i - 1} sessions ago` : 'latest session'}: ${pts(d)} vs SPY`}
            className="h-3 w-[7px] rounded-[1px] border"
            style={d > 0 ? { background: UP, borderColor: UP, opacity: 0.45 + Math.min(0.55, Math.abs(d) / 4) }
              : { background: 'transparent', borderColor: DOWN, opacity: 0.45 + Math.min(0.55, Math.abs(d) / 4) }} />
        ))}
      </span>
      <span className="font-mono text-[11px] tabular-nums text-neutral-400">{wins}/{days.length}</span>
    </div>
  );
}

function Row({ g, scale }) {
  const hole = g.quadrant === 'Improving' && g.rs20 != null && g.rs20 <= -10;
  return (
    <div className="grid grid-cols-[1.4rem_1fr_auto] items-center gap-x-3 gap-y-1.5 border-t border-neutral-900 py-2 sm:grid-cols-[1.4rem_minmax(8rem,1fr)_150px_auto_auto_3.2rem]">
      <span className="font-mono text-[12px] tabular-nums text-neutral-500">{g.rank}</span>
      <div className="min-w-0">
        <div className="truncate">
          <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${g.tier === 'top' ? 'bg-emerald-400' : g.tier === 'bottom' ? 'bg-rose-400' : 'bg-neutral-600'}`} />
          <span className="text-[13px] text-neutral-100">{g.name}</span>
          <span className="ml-1 text-[10px] text-neutral-600">{g.count}</span>
        </div>
        <div className="text-[10px] text-neutral-500">
          {g.beat5 != null ? `${g.beat5}/${g.count} names ahead of SPY this week` : `${g.up}/${g.count} green today`}
          {hole && <span className="text-amber-300/80"> · deep 20-day hole</span>}
        </div>
      </div>
      <span className="justify-self-end font-mono text-[11px] tabular-nums sm:order-last"><Change v={g.rank_change} /></span>
      <div className="col-span-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 sm:contents">
        <RsLine line={g.rs_line} name={g.name} />
        <div className="space-y-1">
          <Bar label="5d" v={g.rs5} max={scale.m5} />
          <Bar label="20d" v={g.rs20} max={scale.m20} />
        </div>
        <Strip days={g.rs_days} wins={g.rs_wins} />
      </div>
    </div>
  );
}

function StrengthView({ ranked }) {
  const noHistory = !ranked.some((g) => g.rs_line?.length);
  const scale = {
    m5: Math.max(1, ...ranked.map((g) => Math.abs(g.rs5 ?? 0))), m20: Math.max(1, ...ranked.map((g) => Math.abs(g.rs20 ?? 0))),
  };
  return (
    <div>
      <div className="mb-1 hidden grid-cols-[1.4rem_minmax(8rem,1fr)_150px_auto_auto_3.2rem] gap-x-3 text-[9px] uppercase tracking-wider text-neutral-600 sm:grid">
        <span>#</span><span>Group</span><span>Strength line, 30 sessions</span><span className="w-[11.5rem]">Lead over SPY</span><span className="w-[7.5rem]">Last 10 days</span><span className="text-right">5d move</span>
      </div>
      {BUCKETS.map((b) => {
        const rows = ranked.filter((g) => (g.quadrant || 'In line') === b.phase);
        if (!rows.length) return null;
        return (
          <div key={b.phase} className="mb-3">
            <div className="flex flex-wrap items-baseline gap-x-2 pb-1 pt-2">
              <span className={`text-[12px] font-semibold ${b.cls}`}>{b.label}</span>
              <span className="font-mono text-[11px] text-neutral-500">{rows.length}</span>
              <span className="text-[11px] text-neutral-500">{b.hint}</span>
            </div>
            {rows.map((g) => <Row key={g.name} g={g} scale={scale} />)}
          </div>
        );
      })}
      {noHistory && <p className="text-[11px] text-amber-300/80">The strength line and the 10-day strip appear after the bot is updated and runs its next pulse.</p>}
      <p className="mt-1 text-[11px] text-neutral-600">
        Strength line: each session, the middle stock in the group minus SPY, added up. Rising = gaining on SPY. Read it for shape: each line is scaled to itself, so use the bars for size. The dashed line is where it started 30 sessions ago; the coloured end is the last 5 sessions.
        Bars: lead over SPY in points (5d and 20d are scaled separately). Squares: filled = beat SPY that day, hollow = lost; darker = bigger.
      </p>
    </div>
  );
}

export default function WatchlistRanking({ groups }) {
  const [open, setOpen] = useState(readPref);
  const [view, setView] = useState(readView);
  const ranked = (groups || []).filter((g) => g.rank != null);
  if (!ranked.length) return null;
  const toggle = () => setOpen((o) => {
    try { window.localStorage.setItem(PREF_KEY, o ? '0' : '1'); } catch { /* ignore */ }
    return !o;
  });
  const pick = (v) => { setView(v); try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ } };
  const ahead5 = ranked.filter((g) => (g.rs5 ?? 0) > 0).length;
  const ahead20 = ranked.filter((g) => (g.rs20 ?? 0) > 0).length;
  const movers = ranked.filter((g) => g.rank_change).sort((a, b) => b.rank_change - a.rank_change);
  const climbers = movers.filter((g) => g.rank_change > 0).slice(0, 3);
  const fallers = movers.filter((g) => g.rank_change < 0).slice(-3).reverse();
  const top = ranked.filter((g) => g.tier === 'top');
  const step = Math.max(3, Math.round(ranked.length / 4));
  const rotation = ranked.filter((g) => (g.rotation ?? (g.rank_change != null && Math.abs(g.rank_change) >= step)));
  // strongest names inside the top groups: Leading/Improving with 8/21 up, best 5d vs SPY first
  const leaders = top.flatMap((g) => (g.members || [])
    .filter((m) => ['Leading', 'Improving'].includes(m.quadrant) && m.ema_trend === 'up')
    .sort((a, b) => (b.rs5 ?? -99) - (a.rs5 ?? -99))
    .slice(0, 3)
    .map((m) => ({ ...m, group: g.name })));

  return (
    <section className="mb-6 overflow-hidden rounded-md border border-neutral-800 bg-neutral-950/40">
      <button type="button" onClick={toggle} aria-expanded={open}
        className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-left sm:px-4">
        <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-neutral-400">
          Your watchlist, top-down <HelpLink to="wl-groups" />
          <span className="font-normal normal-case tracking-normal text-neutral-500">
            {top.length ? `leaders ${top.map((g) => g.name).join(', ')}` : ''}{rotation.length ? ` · ${rotation.length} rotation${rotation.length > 1 ? 's' : ''}` : ''}
          </span>
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-neutral-500" /> : <ChevronDown className="h-4 w-4 text-neutral-500" />}
      </button>
      {open && (
        <div className="border-t border-neutral-900 px-3 py-3 sm:px-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] text-neutral-300">
              <span className="font-mono tabular-nums text-neutral-100">{ahead5}</span> of {ranked.length} groups are ahead of SPY this week,{' '}
              <span className="font-mono tabular-nums text-neutral-100">{ahead20}</span> over 20 days.
              {climbers.length > 0 && <> Climbing: {climbers.map((g) => `${g.name} ↑${g.rank_change}`).join(', ')}.</>}
              {fallers.length > 0 && <> Falling: {fallers.map((g) => `${g.name} ↓${Math.abs(g.rank_change)}`).join(', ')}.</>}
            </p>
            <div className="flex rounded border border-neutral-800 text-[11px]" role="group" aria-label="View">
              {[['chart', 'Strength'], ['table', 'Table']].map(([k, label]) => (
                <button key={k} type="button" onClick={() => pick(k)} aria-pressed={view === k}
                  className={`min-h-[28px] px-2.5 ${view === k ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}>{label}</button>
              ))}
            </div>
          </div>
          {view === 'chart' ? <StrengthView ranked={ranked} /> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[12px]">
              <thead><tr className="text-left text-[9px] uppercase tracking-wider text-neutral-600">
                <th className="py-1 pr-2 font-normal">#</th><th className="py-1 pr-2 font-normal">Group</th>
                <th className="py-1 pr-2 font-normal">ETF</th>
                <th className="py-1 pr-2 text-right font-normal">vs SPY 5d</th><th className="py-1 pr-2 text-right font-normal">20d</th>
                <th className="py-1 pr-2 text-right font-normal">Green</th>
                <th className="py-1 pr-2 font-normal">Phase</th><th className="py-1 text-right font-normal">5d move</th>
              </tr></thead>
              <tbody>
                {ranked.map((g) => (
                  <tr key={g.name} className={`border-t border-neutral-900 ${g.tier === 'middle' ? 'opacity-60' : ''}`}>
                    <td className="py-1 pr-2 font-mono tabular-nums text-neutral-500">{g.rank}</td>
                    <td className="py-1 pr-2">
                      <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${g.tier === 'top' ? 'bg-emerald-400' : g.tier === 'bottom' ? 'bg-rose-400' : 'bg-neutral-600'}`} />
                      <span className="text-neutral-100">{g.name}</span>
                      <span className="ml-1 text-[10px] text-neutral-600">{g.count}</span>
                    </td>
                    <td className="py-1 pr-2 font-mono text-[11px] text-neutral-500">{g.ref_etf || '—'}</td>
                    <td className={`py-1 pr-2 text-right font-mono tabular-nums ${tone(g.rs5)}`}>{pts(g.rs5)}</td>
                    <td className={`py-1 pr-2 text-right font-mono tabular-nums ${tone(g.rs20)}`}>{pts(g.rs20)}</td>
                    <td className="py-1 pr-2 text-right font-mono tabular-nums text-neutral-400">{g.up}/{g.count}</td>
                    <td className="py-1 pr-2"><Phase p={g.quadrant} /></td>
                    <td className="py-1 text-right font-mono text-[11px] tabular-nums"><Change v={g.rank_change} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          <div className="mt-3">
            <div className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-neutral-500">Strongest names in the top groups</div>
            {leaders.length === 0 ? (
              <div className="text-[12px] text-neutral-600">None of the top groups has a name that is Leading/Improving with 8/21 up right now.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {leaders.map((m) => (
                  <Link key={`${m.group}-${m.ticker}`} to={`/lookup/${m.ticker}`}
                    className="inline-flex items-baseline gap-1.5 rounded border border-neutral-800 px-2 py-1 text-[12px] hover:border-emerald-500/40">
                    <span className="font-mono font-semibold text-neutral-100">{m.ticker}</span>
                    <span className={`font-mono text-[11px] tabular-nums ${tone(m.rs5)}`}>{pts(m.rs5)}</span>
                    <span className="text-[10px] text-neutral-600">{m.group}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <p className="mt-1.5 text-[11px] text-neutral-600">Rank = 5-day lead over SPY + ¼ of the 20-day lead (each week counts the same). Green = top 3 and Leading/Improving; red = bottom 3. Rotation = moved {step}+ places in 5 sessions.</p>
          <p className="mt-2 text-[11px] text-neutral-600">Groups are your watchlist categories (a category with one name goes to Other). Edit them on the <Link to="/watchlist" className="text-emerald-300/80 hover:underline">Watchlist</Link>.</p>
        </div>
      )}
    </section>
  );
}
