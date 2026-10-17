import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase, authReady } from '../../lib/supabase';
import { todayET } from '../../lib/journal';
import { etTime, etDayRange } from '../../lib/notes';
import HelpLink from '../../components/HelpLink';

// Alerts on your own rules, written by the bot (alerts.py) after each regular-hours pulse.
// Rules only — they say what your rules say; the decision is yours.

const ALERT_TYPES = {
  ready: { label: 'Setup ready', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
  lost: { label: 'Retest lost', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  stop: { label: 'Stop', cls: 'border-rose-500/50 bg-rose-500/10 text-rose-300' },
  trim: { label: 'Trim', cls: 'border-sky-500/40 bg-sky-500/10 text-sky-300' },
  trail: { label: 'Trail', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  time: { label: 'Time stop', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
};

// "🎯 Setup ready: MU (#1, score 78)" -> "MU (#1, score 78)"; strips the leading emoji/label the chip already shows.
const cleanTitle = (t) => String(t || '').replace(/^\S+\s+/, '').replace(/^Setup ready:\s*/, '');

export function AlertRow({ a }) {
  const ty = ALERT_TYPES[a.event_type] || { label: a.event_type, cls: 'border-neutral-700 text-neutral-400' };
  const lines = String(a.body || '').split('\n').filter(Boolean);
  const plan = lines.find((l) => /\/lookup\/[A-Z.]+/.test(l));
  const rest = lines.filter((l) => l !== plan);
  return (
    <div className="border-b border-neutral-900 px-3 py-2 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="w-14 shrink-0 font-mono text-[11px] tabular-nums text-neutral-500">{etTime(a.created_at)}</span>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${ty.cls}`}>{ty.label}</span>
        <span className="min-w-0 flex-1 text-[13px] text-neutral-100">{cleanTitle(a.title)}</span>
        {a.ticker && /^[A-Z.]{1,6}$/.test(a.ticker) && (
          <Link to={`/lookup/${a.ticker}`} className="text-[11px] text-emerald-300 hover:underline">{plan ? 'Plan it →' : 'Lookup →'}</Link>
        )}
      </div>
      {rest.length > 0 && (
        <div className="mt-0.5 space-y-0.5 pl-0 text-[12px] leading-relaxed text-neutral-400 sm:pl-16">
          {rest.map((l) => <div key={l}>{l}</div>)}
        </div>
      )}
    </div>
  );
}

// Today's alerts, newest first, refreshed every minute. Used at the top of the Sectors page.
export function TodayAlerts() {
  const [st, setSt] = useState({ rows: [], loaded: false, missing: false });
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let off = false;
    const load = async () => {
      try {
        await authReady();
        const { data, error } = await supabase.from('pulse_notes').select('*').eq('kind', 'alert')
          .gte('created_at', etDayRange(todayET()).start).order('created_at', { ascending: false }).limit(50);
        if (error) throw error;
        if (!off) setSt({ rows: data || [], loaded: true, missing: false });
      } catch {
        if (!off) setSt({ rows: [], loaded: true, missing: true });
      }
    };
    const first = setTimeout(load, 0);
    const id = setInterval(load, 60000);
    return () => { off = true; clearTimeout(first); clearInterval(id); };
  }, []);

  if (st.missing) return null;
  const n = st.rows.length;
  const urgent = st.rows.filter((r) => r.event_type === 'stop').length;
  return (
    <section className="mb-5 rounded-md border border-neutral-800 bg-neutral-950/50">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
        <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-neutral-400">
          <Bell className="h-3.5 w-3.5 text-emerald-400" strokeWidth={1.75} /> Alerts today
          <span className="font-mono normal-case tracking-normal text-neutral-500">{st.loaded ? n : '…'}</span>
          {urgent > 0 && <span className="rounded border border-rose-500/50 bg-rose-500/10 px-1.5 text-[10px] normal-case tracking-normal text-rose-300">{urgent} stop{urgent > 1 ? 's' : ''}</span>}
          <HelpLink to="alerts" />
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-neutral-500" /> : <ChevronDown className="h-4 w-4 text-neutral-500" />}
      </button>
      {open && (
        <div className="border-t border-neutral-900">
          {n === 0 ? (
            <div className="px-3 py-2.5 text-[12px] text-neutral-600">
              {st.loaded ? 'None yet. Setup alerts start at 10:00 ET; trade alerts fire when a stop, trim level, trail or time stop is hit.' : 'Loading…'}
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto">{st.rows.map((a) => <AlertRow key={a.id} a={a} />)}</div>
          )}
          <div className="border-t border-neutral-900 px-3 py-1.5 text-[11px] text-neutral-600">
            Rules only: what your rules say, not advice. Past days: <Link to="/notes" className="text-emerald-300/80 hover:underline">Notes &amp; alerts</Link>.
          </div>
        </div>
      )}
    </section>
  );
}
