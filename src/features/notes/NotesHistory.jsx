import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { History, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Sparkles, AlertCircle } from 'lucide-react';
import { supabase, authReady } from '../../lib/supabase';
import { todayET } from '../../lib/journal';
import { etTime, etDayRange, shiftDay, modelName } from '../../lib/notes';
import { BriefBody, EventRow } from '../sectors/AiNotes';

// Every AI brief and event note the bot has written, one day at a time.
// The Sectors page shows only the current brief; this is the record.

const FILTERS = [['all', 'Everything'], ['brief', 'Briefs'], ['event', 'Event notes']];
const dayLabel = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export default function NotesHistory() {
  const { day: dayParam } = useParams();
  const nav = useNavigate();
  const today = todayET();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayParam || '') ? dayParam : today;
  const [st, setSt] = useState({ for: null, rows: [], error: null });
  const [filter, setFilter] = useState('all');

  const load = useCallback(async (d) => {
    try {
      await authReady();
      const { start, end } = etDayRange(d);
      const { data, error } = await supabase.from('pulse_notes').select('*')
        .gte('created_at', start).lt('created_at', end).order('created_at', { ascending: false }).limit(300);
      if (error) throw error;
      setSt({ for: d, rows: data || [], error: null });
    } catch (e) {
      setSt({ for: d, rows: [], error: /pulse_notes/i.test(e.message || '') ? 'No notes table yet — run migrations/010_pulse_notes.sql in Supabase.' : (e.message || 'Failed to load') });
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => load(day), 0);
    return () => clearTimeout(id);
  }, [day, load]);

  const loading = st.for !== day;
  const rows = useMemo(() => (loading ? [] : st.rows), [loading, st.rows]);
  const briefs = rows.filter((r) => r.kind === 'brief');
  const events = rows.filter((r) => r.kind === 'event');
  const shown = rows.filter((r) => filter === 'all' || r.kind === filter);
  const cost = rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
  const go = (d) => nav(d === today ? '/notes' : `/notes/${d}`);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 antialiased">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
        <header className="mb-5">
          <h1 className="flex items-center gap-2.5 text-3xl font-light tracking-tight text-neutral-100">
            <History className="h-6 w-6 text-emerald-400" strokeWidth={1.5} /> AI notes
          </h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            Every brief and event note, by day. The current brief lives on <Link to="/sectors" className="text-emerald-300 hover:underline">Sector Pulse</Link>.
          </p>
        </header>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <button onClick={() => go(shiftDay(day, -1))} aria-label="Previous day" className="rounded border border-neutral-800 p-1.5 text-neutral-400 hover:text-neutral-100"><ChevronLeft className="h-4 w-4" /></button>
            <input type="date" value={day} max={today} onChange={(e) => e.target.value && go(e.target.value)} aria-label="Day"
              className="rounded border border-neutral-800 bg-transparent px-2.5 py-1.5 font-mono text-[12px] text-neutral-100 focus:border-emerald-500/50 focus:outline-none" />
            <button onClick={() => go(shiftDay(day, 1))} disabled={day >= today} aria-label="Next day" className="rounded border border-neutral-800 p-1.5 text-neutral-400 hover:text-neutral-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
            {day !== today && <button onClick={() => go(today)} className="ml-1 rounded border border-neutral-800 px-2.5 py-1.5 text-[12px] text-neutral-400 hover:text-emerald-300">Today</button>}
          </div>
          <div className="flex rounded border border-neutral-800 p-0.5 text-[11px]">
            {FILTERS.map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className={`rounded px-3 py-1 ${filter === k ? 'bg-emerald-500/15 text-emerald-300' : 'text-neutral-500 hover:text-neutral-300'}`}>{l}</button>
            ))}
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[13px] text-neutral-200">{dayLabel(day)}</div>
          {!loading && rows.length > 0 && (
            <div className="font-mono text-[11px] text-neutral-600" title="What the AI calls cost that day">
              {briefs.length} brief{briefs.length !== 1 ? 's' : ''} · {events.length} note{events.length !== 1 ? 's' : ''} · AI cost ${cost.toFixed(4)}
            </div>
          )}
        </div>

        {st.error && !loading && (
          <div className="flex items-start gap-2 rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-[13px] text-rose-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {st.error}
          </div>
        )}
        {loading && <Empty>Loading…</Empty>}
        {!loading && !st.error && shown.length === 0 && (
          <Empty>{rows.length === 0 ? 'Nothing was written this day (weekend, holiday, or before the feature was switched on).' : 'Nothing of this type this day.'}</Empty>
        )}

        {!loading && shown.length > 0 && (
          <div className="overflow-hidden rounded-md border border-neutral-800">
            {shown.map((r, i) => (r.kind === 'brief'
              ? <BriefRow key={r.id} brief={r} first={i === 0 && day === today} />
              : <div key={r.id} className="border-b border-neutral-900 last:border-0"><EventRow e={r} /></div>))}
          </div>
        )}
      </div>
    </div>
  );
}

function Empty({ children }) {
  return <div className="rounded-md border border-dashed border-neutral-800 px-4 py-8 text-center text-[13px] text-neutral-500">{children}</div>;
}

// A brief in the timeline: time + headline, expands to the full write-up.
function BriefRow({ brief, first }) {
  const [open, setOpen] = useState(first);
  return (
    <div className="border-b border-neutral-900 bg-neutral-950/50 last:border-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-3 px-3 py-2.5 text-left">
        <span className="w-16 shrink-0 font-mono text-[11px] tabular-nums text-neutral-500">{etTime(brief.created_at)}</span>
        <span className="min-w-0 flex-1">
          <span className="mb-0.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-emerald-300/80">
            <Sparkles className="h-3 w-3" strokeWidth={1.75} /> Brief
            <span className="normal-case tracking-normal text-neutral-600">{brief.session} · {modelName(brief.model)}</span>
          </span>
          {!open && <span className="block text-[13px] text-neutral-200">{brief.title}</span>}
        </span>
        {open ? <ChevronUp className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" /> : <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />}
      </button>
      {open && <div className="px-3 pb-3 sm:pl-[5.5rem]"><BriefBody brief={brief} compact /></div>}
    </div>
  );
}
