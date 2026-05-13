import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles,
  ArrowLeft,
  AlertCircle,
  Star,
  TrendingUp,
  Briefcase,
  Heart,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { supabase, authReady } from '../../lib/supabase';
import { anthropic, CLAUDE_MODEL } from '../../lib/claude';

// ---------------------------------------------------------------------------
// Helpers (kept local — extract to shared module once a third screen needs them)
// ---------------------------------------------------------------------------

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function tomorrowKey(d = new Date()) {
  const t = new Date(d);
  t.setDate(t.getDate() + 1);
  return todayKey(t);
}

function formatPrettyDate(dateKey) {
  // dateKey is YYYY-MM-DD; parse as local, not UTC.
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

const CHECKIN_LABELS = {
  trading_ready:       'Trading ready',
  work_focused:        'Work focused',
  movement_done:       'Movement done',
  device_boundaries:   'Device boundaries kept',
  present_with_akhila: 'Present with Akhila',
};

// ---------------------------------------------------------------------------
// Data layer
// ---------------------------------------------------------------------------

async function fetchTodayCheckin(dateKey) {
  await authReady();
  const { data, error } = await supabase
    .from('daily_checkins').select('*').eq('date', dateKey).maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchLifeJournal(dateKey) {
  await authReady();
  const { data, error } = await supabase
    .from('life_journal').select('*').eq('date', dateKey).maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchActiveRules() {
  await authReady();
  const { data, error } = await supabase
    .from('trade_rules')
    .select('rule_number, rule_text')
    .eq('is_active', true)
    .order('rule_number', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchPrep(forDate) {
  await authReady();
  const { data, error } = await supabase
    .from('daily_prep').select('*').eq('for_date', forDate).maybeSingle();
  if (error) throw error;
  return data;
}

async function savePrep(row) {
  await authReady();
  const { error } = await supabase
    .from('daily_prep')
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'for_date' });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Claude call
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a personal accountability coach analyzing someone's daily journal to create tomorrow's prep checklist.

The user has trading rules they must follow. Analyze their journal entry and check-in results to identify:
1. What rules were violated today
2. What habits were missed
3. What needs specific attention tomorrow

Return ONLY valid JSON in this exact format, with no surrounding prose, code fences, or commentary:
{
  "trading": ["specific action 1", "specific action 2", "specific action 3"],
  "work": ["specific action 1", "specific action 2"],
  "life": ["specific action 1", "specific action 2"],
  "priority": "single most important thing for tomorrow in one sentence"
}

Be specific and direct. Reference actual things from their journal. Maximum 3 items per category. No generic advice. If a check-in was missed, address it. If it was met, reinforce it briefly.`;

function buildUserMessage({ intention, checkIns, lifeEntry, rules }) {
  const checkInLines = Object.entries(CHECKIN_LABELS).map(([key, label]) => {
    const v = checkIns?.[key];
    const display = v === true ? 'yes' : v === false ? 'no' : 'not answered';
    return `- ${label}: ${display}`;
  }).join('\n');

  const rulesText = rules
    .map((r) => `${r.rule_number}. ${r.rule_text}`)
    .join('\n');

  const lifeBlock = lifeEntry
    ? `
Today's life-journal entry:
- Energy level (1-10): ${lifeEntry.energy_level ?? 'n/a'}
- Work presence (1-10): ${lifeEntry.work_presence ?? 'n/a'}
- Device-free hours: ${lifeEntry.device_free_hours ?? 'n/a'}
- SaaS progress: ${lifeEntry.saas_progress ? 'yes' : 'no'}
- Grateful for: ${lifeEntry.grateful_for || '(blank)'}
- Improve tomorrow: ${lifeEntry.improve_tomorrow || '(blank)'}
- Tomorrow's priority (their note): ${lifeEntry.tomorrow_priority || '(blank)'}
- Note about Akhila: ${lifeEntry.akhila_note || '(blank)'}`
    : '\n(No life-journal entry for today.)';

  return `Today's intention: ${intention || '(blank)'}

Today's check-ins:
${checkInLines}
${lifeBlock}

Trading rules:
${rulesText}

Generate tomorrow's prep checklist based on what actually happened today.`;
}

async function generatePrep({ intention, checkIns, lifeEntry, rules }) {
  const userMessage = buildUserMessage({ intention, checkIns, lifeEntry, rules });

  const resp = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  // Extract text from content blocks (resp.content is an array).
  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Strip code fences if Claude added them despite instructions.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`Claude returned non-JSON output. Raw: ${text.slice(0, 200)}`);
  }

  // Defensive normalization. Don't trust Claude's shape.
  const toItems = (arr) =>
    (Array.isArray(arr) ? arr : []).filter((x) => typeof x === 'string').map((text) => ({ text, done: false }));

  return {
    trading_items: toItems(parsed.trading),
    work_items:    toItems(parsed.work),
    life_items:    toItems(parsed.life),
    priority:      typeof parsed.priority === 'string' ? parsed.priority : '',
    usage: {
      model: CLAUDE_MODEL,
      prompt_tokens:     resp.usage?.input_tokens ?? null,
      completion_tokens: resp.usage?.output_tokens ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TomorrowPrep() {
  const today = todayKey();
  const tomorrow = tomorrowKey();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [todayCheckin, setTodayCheckin] = useState(null);
  const [todayLife, setTodayLife] = useState(null);
  const [rules, setRules] = useState([]);
  const [prep, setPrep] = useState(null);

  const [generating, setGenerating] = useState(false);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [ci, lj, rs, existingPrep] = await Promise.all([
          fetchTodayCheckin(today),
          fetchLifeJournal(today),
          fetchActiveRules(),
          fetchPrep(tomorrow),
        ]);
        if (cancelled) return;
        setTodayCheckin(ci);
        setTodayLife(lj);
        setRules(rs);
        setPrep(existingPrep);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [today, tomorrow]);

  const hasIntention = Boolean(todayCheckin?.intention?.trim());

  const onGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const result = await generatePrep({
        intention: todayCheckin?.intention || '',
        checkIns: todayCheckin || {},
        lifeEntry: todayLife,
        rules,
      });

      const row = {
        for_date: tomorrow,
        reflection_summary: todayCheckin?.intention || '',
        trading_items: result.trading_items,
        work_items: result.work_items,
        life_items: result.life_items,
        priority: result.priority,
        model: result.usage.model,
        prompt_tokens: result.usage.prompt_tokens,
        completion_tokens: result.usage.completion_tokens,
      };
      await savePrep(row);
      setPrep(row);
    } catch (e) {
      setError(e.message || 'Generation failed.');
    } finally {
      setGenerating(false);
    }
  }, [todayCheckin, todayLife, rules, tomorrow]);

  // Toggle a checklist item — optimistic, persists to DB.
  const toggleItem = useCallback(
    async (category, idx) => {
      if (!prep) return;
      const arr = [...(prep[category] || [])];
      arr[idx] = { ...arr[idx], done: !arr[idx].done };
      const updated = { ...prep, [category]: arr };
      setPrep(updated);
      try {
        await savePrep({
          for_date: prep.for_date,
          reflection_summary: prep.reflection_summary,
          trading_items: updated.trading_items,
          work_items: updated.work_items,
          life_items: updated.life_items,
          priority: prep.priority,
          model: prep.model,
          prompt_tokens: prep.prompt_tokens,
          completion_tokens: prep.completion_tokens,
        });
      } catch (e) {
        setError(e.message || 'Failed to save toggle.');
      }
    },
    [prep],
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 font-sans antialiased">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <div className="relative mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        {/* Header */}
        <header className="mb-10">
          <Link
            to="/trading"
            className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] text-neutral-500 hover:text-emerald-400 transition-colors"
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={2} />
            Trading
          </Link>

          <h1 className="mt-4 text-3xl font-light tracking-tight text-neutral-100 sm:text-4xl">
            Tomorrow's prep
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            For <span className="font-mono text-neutral-400">{formatPrettyDate(tomorrow)}</span>
            {' · based on today'}
          </p>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[13px] text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span className="break-all">{error}</span>
            </div>
          )}
        </header>

        {loading ? (
          <SkeletonState />
        ) : !hasIntention && !prep ? (
          <EmptyState />
        ) : (
          <>
            {/* Section 1: Today's intention */}
            <ReflectionCard intention={todayCheckin?.intention} checkIns={todayCheckin} />

            {/* Section 2: Generate button */}
            <section className="mb-10">
              <div className="flex items-center justify-between gap-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
                  {prep ? 'Regenerate checklist' : 'Generate checklist'}
                </div>
                {prep && (
                  <span className="text-[10px] text-neutral-600 font-mono">
                    Generated{' '}
                    {prep.generated_at
                      ? new Date(prep.generated_at).toLocaleString(undefined, {
                          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                        })
                      : 'just now'}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={onGenerate}
                disabled={generating || !hasIntention}
                className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-5 py-3.5 text-[14px] font-medium tracking-wide text-emerald-300 hover:bg-emerald-500/15 hover:border-emerald-500/60 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-500/10"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                    Generating your checklist…
                  </>
                ) : prep ? (
                  <>
                    <RefreshCw className="h-4 w-4" strokeWidth={2} />
                    Regenerate
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" strokeWidth={2} />
                    Generate Tomorrow's Checklist
                  </>
                )}
              </button>
              {!hasIntention && (
                <p className="mt-2 text-[12px] text-neutral-500">
                  Write today's intention on the dashboard first.
                </p>
              )}
            </section>

            {/* Section 3: Checklist */}
            {prep && (
              <>
                <PriorityCard text={prep.priority} />
                <CategorySection
                  label="Trading"
                  accent="emerald"
                  icon={TrendingUp}
                  items={prep.trading_items || []}
                  onToggle={(idx) => toggleItem('trading_items', idx)}
                />
                <CategorySection
                  label="Work"
                  accent="sky"
                  icon={Briefcase}
                  items={prep.work_items || []}
                  onToggle={(idx) => toggleItem('work_items', idx)}
                />
                <CategorySection
                  label="Life"
                  accent="violet"
                  icon={Heart}
                  items={prep.life_items || []}
                  onToggle={(idx) => toggleItem('life_items', idx)}
                />
              </>
            )}
          </>
        )}

        <footer className="pt-6 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-700">
          Plan the day. Then live it.
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SkeletonState() {
  return (
    <div className="space-y-4">
      <div className="h-24 rounded-md border border-neutral-800 bg-neutral-950/40 animate-pulse" />
      <div className="h-14 rounded-md border border-neutral-800 bg-neutral-950/40 animate-pulse" />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/40 p-8 text-center">
      <p className="text-[15px] text-neutral-300">
        Write your intention first.
      </p>
      <p className="mt-2 text-sm text-neutral-500">
        Come back here at end of day to generate tomorrow's prep.
      </p>
      <Link
        to="/"
        className="mt-5 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] text-emerald-400 hover:text-emerald-300 transition-colors"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={2} />
        Back to Dashboard
      </Link>
    </div>
  );
}

function ReflectionCard({ intention, checkIns }) {
  const completed = checkIns
    ? Object.entries(CHECKIN_LABELS).filter(([k]) => checkIns[k] === true).length
    : 0;

  return (
    <section className="mb-10">
      <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
        Today's intention
      </div>
      <div className="mt-3 rounded-md border border-neutral-800 bg-neutral-950/40 p-5">
        <blockquote className="text-[15px] leading-relaxed text-neutral-200 italic">
          {intention?.trim() ? `“${intention}”` : <span className="not-italic text-neutral-600">No intention recorded today.</span>}
        </blockquote>
        <div className="mt-4 pt-4 border-t border-neutral-900 text-[11px] text-neutral-500 font-mono">
          {completed} / 5 check-ins met
        </div>
      </div>
    </section>
  );
}

function PriorityCard({ text }) {
  if (!text) return null;
  return (
    <section className="mb-8">
      <div className="text-[11px] uppercase tracking-[0.22em] text-amber-400/80 flex items-center gap-2">
        <Star className="h-3.5 w-3.5" strokeWidth={2} fill="currentColor" />
        Tomorrow's priority
      </div>
      <div className="mt-3 rounded-md border border-amber-500/30 bg-gradient-to-b from-amber-500/[0.08] to-amber-500/[0.02] p-5">
        <p className="text-[16px] leading-relaxed text-amber-50">{text}</p>
      </div>
    </section>
  );
}

const ACCENT_MAP = {
  emerald: { text: 'text-emerald-400', border: 'border-emerald-500/40', bg: 'bg-emerald-500/15' },
  sky:     { text: 'text-sky-400',     border: 'border-sky-500/40',     bg: 'bg-sky-500/15' },
  violet:  { text: 'text-violet-400',  border: 'border-violet-500/40',  bg: 'bg-violet-500/15' },
};

function CategorySection({ label, accent, icon: Icon, items, onToggle }) {
  const a = ACCENT_MAP[accent];
  if (!items.length) return null;

  return (
    <section className="mb-8">
      <div className={`flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] ${a.text}`}>
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        <span>{label}</span>
      </div>
      <ul className="mt-3 divide-y divide-neutral-900 rounded-md border border-neutral-800 bg-neutral-950/40">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-start gap-3 px-4 py-3.5">
            <button
              type="button"
              onClick={() => onToggle(idx)}
              aria-pressed={item.done}
              aria-label={item.done ? 'Mark as not done' : 'Mark as done'}
              className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all active:scale-90 ${
                item.done
                  ? `${a.border} ${a.bg} ${a.text}`
                  : 'border-neutral-700 bg-neutral-900/40 hover:border-neutral-600'
              }`}
            >
              {item.done && (
                <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3">
                  <path d="M3 8l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <span
              className={`flex-1 text-[14px] leading-relaxed transition-colors ${
                item.done ? 'text-neutral-500 line-through' : 'text-neutral-200'
              }`}
            >
              {item.text}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
