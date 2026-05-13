import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Feather,
  AlertCircle,
} from 'lucide-react';
import { supabase, authReady } from '../../lib/supabase';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatLongDate(d = new Date()) {
  return d.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

function formatEntryDate(dateKey, todayK) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (dateKey === todayK) return 'Today';
  // Compute days ago
  const [ty, tm, td] = todayK.split('-').map(Number);
  const today = new Date(ty, tm - 1, td);
  const days = Math.round((today - date) / 86_400_000);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function wordCount(s) {
  if (!s) return 0;
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function aliveWord(n) {
  if (n == null) return '';
  if (n <= 3) return 'going through motions';
  if (n <= 6) return 'present but distracted';
  if (n <= 8) return 'genuinely engaged';
  return 'fully alive';
}

function snippet(text, maxLen = 110) {
  if (!text) return '';
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen).trimEnd() + '…';
}

// Prompts shown as starting points — match LifeJournal's
const REFLECTION_PROMPTS = [
  'What moment today felt most alive?',
  'What was I avoiding today?',
  'What would the joyful kid version of me think of today?',
  'What am I grateful for that I almost didn\'t notice?',
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LifeHome() {
  const today = todayKey();

  const [state, setState] = useState({
    loading: true,
    error: null,
    todayEntry: null,
    recentEntries: [],
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        await authReady();
        // Fetch the last 7 days of entries (today + 6 prior). Done as one
        // query, then we split into "today" vs "recent".
        const { data, error } = await supabase
          .from('life_journal')
          .select('date, energy_level, free_write, joy_today, present_with_akhila, movement_done')
          .order('date', { ascending: false })
          .limit(7);
        if (error) throw error;
        if (cancelled) return;

        const todayEntry = (data || []).find((r) => r.date === today) || null;
        const recentEntries = (data || []).filter((r) => r.date !== today);

        setState({
          loading: false,
          error: null,
          todayEntry,
          recentEntries,
        });
      } catch (e) {
        if (!cancelled) {
          setState((s) => ({ ...s, loading: false, error: e.message || 'Failed to load.' }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [today]);

  const hasToday = state.todayEntry != null;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 antialiased selection:bg-amber-500/30">
      {/* Softer dot texture, matching LifeJournal */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="relative mx-auto max-w-2xl px-6 py-12 sm:px-10 sm:py-16">
        <header className="mb-12">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-[12px] text-neutral-500 hover:text-amber-400 transition-colors"
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={2} />
            Switch
          </Link>

          <h1 className="mt-6 font-serif text-4xl font-light tracking-tight text-neutral-100 sm:text-5xl">
            Life
          </h1>
          <p className="mt-2 font-mono text-[12px] text-neutral-500">
            {formatLongDate(new Date())}
          </p>

          {state.error && (
            <div className="mt-4 flex items-start gap-2 rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-[13px] text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>{state.error}</span>
            </div>
          )}
        </header>

        {state.loading ? (
          <div className="text-neutral-500 text-sm">Loading…</div>
        ) : (
          <>
            {/* ─── Today ─── */}
            <section className="mb-12">
              <div className="font-serif text-[13px] italic text-neutral-500 mb-4">
                Today
              </div>

              {hasToday ? (
                <Link
                  to="/life-journal"
                  className="group block rounded border border-neutral-800/80 bg-neutral-950/40 px-6 py-5 hover:border-amber-500/40 hover:bg-amber-500/[0.03] transition-all"
                >
                  {state.todayEntry.energy_level != null && (
                    <div>
                      <div className="font-serif text-2xl font-light text-neutral-100">
                        Felt <span className="text-amber-300">{state.todayEntry.energy_level}</span> of 10
                      </div>
                      <div className="font-serif text-[13px] italic text-neutral-500 mt-0.5">
                        {aliveWord(state.todayEntry.energy_level)}
                      </div>
                    </div>
                  )}

                  {state.todayEntry.free_write?.trim() && (
                    <p className="mt-4 font-serif text-[14px] leading-relaxed text-neutral-400 italic">
                      “{snippet(state.todayEntry.free_write, 140)}”
                    </p>
                  )}

                  <div className="mt-4 inline-flex items-center gap-1 font-serif text-[12px] italic text-neutral-500 group-hover:text-amber-400 transition-colors">
                    Continue writing
                    <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" strokeWidth={2} />
                  </div>
                </Link>
              ) : (
                <Link
                  to="/life-journal"
                  className="group block rounded border border-dashed border-neutral-700 bg-neutral-950/30 px-6 py-8 hover:border-amber-500/50 hover:bg-amber-500/[0.03] transition-all"
                >
                  <div className="flex items-center gap-3">
                    <Feather className="h-5 w-5 text-amber-400/70 group-hover:text-amber-400 transition-colors" strokeWidth={1.5} />
                    <div>
                      <div className="font-serif text-[18px] italic text-neutral-300 group-hover:text-neutral-100 transition-colors">
                        Write today's entry
                      </div>
                      <div className="font-serif text-[13px] italic text-neutral-600 mt-0.5">
                        What actually happened today?
                      </div>
                    </div>
                  </div>

                  <div className="mt-6">
                    <div className="font-serif text-[12px] italic text-neutral-700 mb-2">
                      A way to start, if it helps:
                    </div>
                    <ul className="space-y-1.5">
                      {REFLECTION_PROMPTS.map((p, i) => (
                        <li
                          key={i}
                          className="font-serif text-[13px] italic text-neutral-500 group-hover:text-neutral-400 transition-colors"
                        >
                          — {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                </Link>
              )}
            </section>

            {/* ─── Recent ─── */}
            <section className="mb-12">
              <div className="font-serif text-[13px] italic text-neutral-500 mb-4">
                Recent
              </div>

              {state.recentEntries.length === 0 ? (
                <div className="font-serif text-[14px] italic text-neutral-600">
                  No prior entries yet. Today will be the first.
                </div>
              ) : (
                <ul className="space-y-3">
                  {state.recentEntries.map((entry) => (
                    <li key={entry.date}>
                      <RecentEntry entry={entry} todayK={today} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        <footer className="mt-20 text-center font-serif text-[12px] italic text-neutral-700">
          A page in a long book.
        </footer>
      </div>
    </div>
  );
}

function RecentEntry({ entry, todayK }) {
  const words = wordCount(entry.free_write || '');
  return (
    <div className="rounded border border-neutral-900 bg-neutral-950/30 px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-serif text-[14px] text-neutral-300">
          {formatEntryDate(entry.date, todayK)}
        </div>
        <div className="font-mono text-[10px] text-neutral-600">
          {entry.energy_level != null && `${entry.energy_level}/10`}
        </div>
      </div>
      {entry.free_write?.trim() ? (
        <p className="mt-2 font-serif text-[13px] italic leading-relaxed text-neutral-500">
          “{snippet(entry.free_write, 110)}”
        </p>
      ) : (
        <p className="mt-2 font-serif text-[13px] italic text-neutral-700">
          {words === 0 ? 'No words written' : ''}
        </p>
      )}
    </div>
  );
}
