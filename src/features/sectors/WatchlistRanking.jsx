import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronUp, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import HelpLink from '../../components/HelpLink';

// Your watchlist, read top-down like the sectors (bot: sector_pulse.watchlist_groups + rank_groups):
// categories ranked by median 5d + 20d return vs SPY, rank change over 5 sessions, then the strongest names
// inside the top groups. Phase is always shown as a text label, never color alone.

const PHASE = {
  Leading: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  Improving: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  Weakening: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  Lagging: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  'In line': 'border-neutral-700 bg-neutral-800/40 text-neutral-300',
};
const PREF_KEY = 'sectors.wlrank.open';
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

export default function WatchlistRanking({ groups }) {
  const [open, setOpen] = useState(readPref);
  const ranked = (groups || []).filter((g) => g.rank != null);
  if (!ranked.length) return null;
  const toggle = () => setOpen((o) => {
    try { window.localStorage.setItem(PREF_KEY, o ? '0' : '1'); } catch { /* ignore */ }
    return !o;
  });
  const top = ranked.filter((g) => g.tier === 'top');
  const rotation = ranked.filter((g) => g.rank_change != null && Math.abs(g.rank_change) >= 3);
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
          {rotation.length > 0 && (
            <div className="mb-2 rounded border border-sky-500/30 bg-sky-500/5 px-2.5 py-1.5 text-[12px] text-sky-200">
              Rotation: {rotation.map((g) => `${g.name} ${g.rank_change > 0 ? 'up' : 'down'} ${Math.abs(g.rank_change)} to #${g.rank}`).join(' · ')}
            </div>
          )}
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
                      <a href={`#group-${encodeURIComponent(g.name)}`} className="text-neutral-100 hover:text-emerald-300">{g.name}</a>
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
          <p className="mt-2 text-[11px] text-neutral-600">Groups are your watchlist categories (a category with one name goes to Other). Edit them on the <Link to="/watchlist" className="text-emerald-300/80 hover:underline">Watchlist</Link>.</p>
        </div>
      )}
    </section>
  );
}
