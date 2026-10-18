import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Sunrise, Sun, Moon, Check, X, TrendingUp, Briefcase, Activity, Smartphone, Heart, Target, BookOpen,
  ChevronRight, AlertCircle, Wallet, ArrowLeft, ArrowDown, Plus, Radar, Search, Star, Sparkles, Loader2, RefreshCw, ListChecks,
} from 'lucide-react';
import { supabase, authReady } from '../../lib/supabase';
import { usePortfolio, RULE_ANCHORS } from '../../hooks/usePortfolio';
import { processStats, RULESET } from '../../lib/journal';
import { TodayAlerts } from '../alerts/Alerts';
import { localDay, nextDay, fetchLifeJournal, fetchActiveRules, fetchPrep, savePrep, generatePrep } from './prep';

// One page for the whole day (replaces Home + Dashboard + Tomorrow's Prep):
//   numbers & process → alerts → today's plan (made last night) → intention & check-ins → rule of the day
//   → tonight: prep tomorrow (which becomes tomorrow's "Today's plan").

const CHECK_INS = [
  { id: 'trading_ready', label: 'Trading ready', icon: TrendingUp },
  { id: 'work_focused', label: 'Work focused', icon: Briefcase },
  { id: 'movement_done', label: 'Movement done', icon: Activity },
  { id: 'device_boundaries', label: 'Device boundaries kept', icon: Smartphone },
  { id: 'present_with_akhila', label: 'Present with Akhila', icon: Heart },
];
const FALLBACK_RULES = [{ rule_number: 1, rule_text: 'Stick to your rules.' }];
const EVENING_HOUR = 16;

function ruleIndexForDate(dateKey, total) {
  let h = 0;
  for (let i = 0; i < dateKey.length; i++) h = (h * 31 + dateKey.charCodeAt(i)) >>> 0;
  return h % total;
}

function greeting(d) {
  const h = d.getHours();
  if (h < 5) return { text: 'Still up', Icon: Moon };
  if (h < 12) return { text: 'Good morning', Icon: Sunrise };
  if (h < 17) return { text: 'Good afternoon', Icon: Sun };
  if (h < 21) return { text: 'Good evening', Icon: Moon };
  return { text: 'Good night', Icon: Moon };
}

const usd = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const prettyDay = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
};

const store = {
  get(key, fallback) {
    try { const v = window.localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

async function upsertCheckin(dateKey, patch) {
  await authReady();
  const { error } = await supabase.from('daily_checkins')
    .upsert({ date: dateKey, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'date' });
  if (error) throw error;
}

const prepRow = (p) => ({
  for_date: p.for_date, reflection_summary: p.reflection_summary, trading_items: p.trading_items, work_items: p.work_items,
  life_items: p.life_items, priority: p.priority, model: p.model, prompt_tokens: p.prompt_tokens, completion_tokens: p.completion_tokens,
});

export default function Today() {
  const [now, setNow] = useState(() => new Date());
  const dateKey = localDay(now);
  const tomorrow = nextDay(now);
  const portfolio = usePortfolio();

  useEffect(() => {
    let intervalId;
    const timeoutId = setTimeout(() => {
      setNow(new Date());
      intervalId = setInterval(() => setNow(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => { clearTimeout(timeoutId); if (intervalId) clearInterval(intervalId); };
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(0);
  const flashSaved = useCallback(() => { const d = new Date(); setSavedAt(d.getTime()); setNow(d); }, []);
  const savedVisible = savedAt > 0 && now.getTime() - savedAt < 1500;
  useEffect(() => {
    if (!savedAt) return undefined;
    const t = setTimeout(() => setNow(new Date()), 1600);
    return () => clearTimeout(t);
  }, [savedAt]);

  const [intention, setIntention] = useState('');
  const [checkIns, setCheckIns] = useState({});
  const [rules, setRules] = useState(FALLBACK_RULES);
  const [extra, setExtra] = useState({ openTrades: 0, process: null, life: null });
  const [planToday, setPlanToday] = useState(null);     // made last night (for_date = today)
  const [planTomorrow, setPlanTomorrow] = useState(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await authReady();
        const [ciRes, openRes, closedRes, rs, pToday, pTomorrow, life] = await Promise.all([
          supabase.from('daily_checkins').select('*').eq('date', dateKey).maybeSingle(),
          supabase.from('trade_journal').select('*', { count: 'exact', head: true }).eq('status', 'open'),
          supabase.from('trade_journal').select('status, followed_plan, closed_at, exit_date')
            .in('status', ['closed', 'stopped_out', 'partial']).order('closed_at', { ascending: false }).limit(200),
          fetchActiveRules().catch(() => []),
          fetchPrep(dateKey).catch(() => null),
          fetchPrep(nextDay(new Date(`${dateKey}T12:00:00`))).catch(() => null),
          fetchLifeJournal(dateKey).catch(() => null),
        ]);
        if (ciRes.error) throw ciRes.error;
        if (cancelled) return;
        const row = ciRes.data;
        const draft = store.get(`cc.draft.${dateKey}`, null);
        if (row) {
          setIntention(row.intention || '');
          setCheckIns(Object.fromEntries(CHECK_INS.map((c) => [c.id, row[c.id]])));
        } else {
          setIntention(draft?.intention || '');
          setCheckIns(draft?.checkIns || {});
        }
        if (rs.length) setRules(rs);
        setPlanToday(pToday);
        setPlanTomorrow(pTomorrow);
        setExtra({ openTrades: openRes.count ?? 0, process: processStats(closedRes.data || [], 20), life });
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'Failed to load today.');
          const draft = store.get(`cc.draft.${dateKey}`, null);
          if (draft) { setIntention(draft.intention || ''); setCheckIns(draft.checkIns || {}); }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dateKey]);

  useEffect(() => { store.set(`cc.draft.${dateKey}`, { intention, checkIns }); }, [dateKey, intention, checkIns]);

  // Intention: debounced save
  const debounce = useRef(null);
  const onIntention = useCallback((e) => {
    const v = e.target.value;
    setIntention(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try { await upsertCheckin(dateKey, { intention: v }); setError(null); flashSaved(); } catch (err) { setError(err.message || 'Failed to save intention.'); }
    }, 500);
  }, [dateKey, flashSaved]);
  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  const setCheckIn = useCallback((id, value) => {
    setCheckIns((prev) => {
      const next = prev[id] === value ? null : value;
      (async () => {
        try { await upsertCheckin(dateKey, { [id]: next }); setError(null); flashSaved(); } catch (err) { setError(err.message || 'Failed to save check-in.'); }
      })();
      return { ...prev, [id]: next };
    });
  }, [dateKey, flashSaved]);
  const done = useMemo(() => CHECK_INS.filter((c) => checkIns[c.id] === true).length, [checkIns]);

  // Rule of the day
  const offKey = `cc.ruleOffset.${dateKey}`;
  const [ruleOffset, setRuleOffset] = useState(() => store.get(offKey, 0));
  const ruleIdx = (ruleIndexForDate(dateKey, rules.length || 1) + ruleOffset) % (rules.length || 1);
  const rule = rules[ruleIdx] || FALLBACK_RULES[0];
  const nextRule = () => setRuleOffset((p) => { const n = (p + 1) % (rules.length || 1); store.set(offKey, n); return n; });
  const resetRule = () => { setRuleOffset(0); store.set(offKey, 0); };

  // Checklists (today's and tomorrow's) — optimistic toggle, saved to daily_prep
  const toggle = useCallback(async (which, category, idx) => {
    const [plan, set] = which === 'today' ? [planToday, setPlanToday] : [planTomorrow, setPlanTomorrow];
    if (!plan) return;
    const arr = [...(plan[category] || [])];
    arr[idx] = { ...arr[idx], done: !arr[idx].done };
    const updated = { ...plan, [category]: arr };
    set(updated);
    try { await savePrep(prepRow(updated)); } catch (e) { setError(e.message || 'Failed to save.'); }
  }, [planToday, planTomorrow]);

  const onGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const r = await generatePrep({ intention, checkIns, lifeEntry: extra.life, rules });
      const row = {
        for_date: tomorrow, reflection_summary: intention || '', trading_items: r.trading_items, work_items: r.work_items,
        life_items: r.life_items, priority: r.priority, model: r.usage.model, prompt_tokens: r.usage.prompt_tokens,
        completion_tokens: r.usage.completion_tokens,
      };
      await savePrep(row);
      setPlanTomorrow({ ...row, generated_at: new Date().toISOString() });
    } catch (e) {
      setError(e.message || 'Generation failed.');
    } finally {
      setGenerating(false);
    }
  }, [intention, checkIns, extra.life, rules, tomorrow]);

  const { text: greetText, Icon: GreetIcon } = greeting(now);
  const evening = now.getHours() >= EVENING_HOUR;
  const p = extra.process;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 antialiased selection:bg-emerald-500/30">
      <div className="relative mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-10">
        {/* Header */}
        <header className="mb-6">
          <Link to="/" className="mb-3 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] text-neutral-500 hover:text-emerald-400">
            <ArrowLeft className="h-3 w-3" strokeWidth={2} /> Switch
          </Link>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-neutral-500">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${error || portfolio.error ? 'bg-red-500' : 'bg-emerald-500'}`} />
            <span>Today</span><span className="text-neutral-700">·</span>
            <span className="font-mono">{prettyDay(dateKey)}</span>
            <span className={`ml-auto flex items-center gap-1 text-emerald-400 transition-opacity duration-500 ${savedVisible ? 'opacity-100' : 'opacity-0'}`}>
              <Check className="h-3 w-3" strokeWidth={2.5} /><span className="normal-case tracking-normal">Saved</span>
            </span>
          </div>
          <h1 className="mt-3 flex items-baseline gap-3 text-3xl font-light tracking-tight text-neutral-100 sm:text-4xl">
            <GreetIcon className="h-7 w-7 shrink-0 self-center text-emerald-400" strokeWidth={1.5} />
            <span>{greetText}, Sujay.</span>
          </h1>
          {evening && (
            <a href="#prep" className="mt-2 inline-flex items-center gap-1 text-[12px] text-emerald-300/90 hover:underline">
              <ArrowDown className="h-3 w-3" /> Evening — prep tomorrow
            </a>
          )}
          {(error || portfolio.error) && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[13px] text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span className="break-words">{error || portfolio.error}{error ? ' Check-ins are kept locally until the connection returns.' : ''}</span>
            </div>
          )}
        </header>

        {/* Numbers + process */}
        <section className="mb-5 overflow-hidden rounded-md border border-neutral-800 bg-neutral-950/40">
          <div className="grid grid-cols-2 gap-px bg-neutral-900 sm:grid-cols-4">
            <Stat label={<><Wallet className="h-3 w-3" /> Portfolio</>}
              value={portfolio.loading ? '—' : usd(portfolio.value)}
              sub={portfolio.loading ? '' : portfolio.realizedPnl
                ? <span className={portfolio.realizedPnl > 0 ? 'text-emerald-400' : 'text-red-400'}>{portfolio.realizedPnl > 0 ? '+' : ''}{usd(portfolio.realizedPnl)} realized</span>
                : 'flat'} />
            <Stat label="Open trades" value={loading ? '—' : extra.openTrades} sub={<Link to="/journal" className="hover:text-emerald-300">Journal →</Link>} />
            <Stat label="Check-ins" value={loading ? '—' : `${done} / 5`} sub={<a href="#checkins" className="hover:text-emerald-300">below ↓</a>} />
            <Stat label={`Process · ${RULESET}`} value={!p ? '—' : p.n ? `${p.followed}/${p.n}` : '—'}
              sub={!p ? '' : p.n ? `by plan · ${p.streak} in a row` : 'no reviewed trades yet'} />
          </div>
          {!portfolio.loading && (
            <div className="grid grid-cols-3 gap-3 border-t border-neutral-900 px-4 py-2.5">
              <Cap label="Indep. max" value={portfolio.caps.independent} anchor={RULE_ANCHORS.anchorIndependent} />
              <Cap label="Discord max" value={portfolio.caps.discord} anchor={RULE_ANCHORS.anchorDiscord} />
              <Cap label="Loss cap" value={portfolio.caps.maxLoss} anchor={RULE_ANCHORS.anchorMaxLoss} />
            </div>
          )}
          <div className="flex flex-wrap gap-2 border-t border-neutral-900 px-4 py-2.5">
            <Quick to="/journal" icon={Plus} primary>Log a trade</Quick>
            <Quick to="/sectors" icon={Radar}>Sectors</Quick>
            <Quick to="/lookup" icon={Search}>Plan a trade</Quick>
            <span className="ml-auto self-center text-[11px] text-neutral-600">Your job today: execute the plan.</span>
          </div>
        </section>

        {/* Alerts */}
        <TodayAlerts />

        {/* Today's plan (made last night) */}
        <section className="mb-8">
          <Label icon={ListChecks} text="Today’s plan" hint="made last night" />
          {loading ? <Skeleton /> : !planToday ? (
            <div className="mt-3 rounded-md border border-dashed border-neutral-800 px-4 py-3 text-[13px] text-neutral-500">
              No plan from last night. Make tomorrow’s this evening in <a href="#prep" className="text-emerald-300 hover:underline">Prep tomorrow</a> — it shows up here.
            </div>
          ) : <Plan plan={planToday} onToggle={(c, i) => toggle('today', c, i)} />}
        </section>

        {/* Intention */}
        <section className="mb-8">
          <Label icon={Target} text="Today’s intention" />
          <textarea value={intention} onChange={onIntention} placeholder="What matters most today?" rows={2} disabled={loading}
            className="mt-3 w-full resize-none rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-3 text-base leading-relaxed text-neutral-100 placeholder:text-neutral-600 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 disabled:opacity-50" />
        </section>

        {/* Check-ins */}
        <section id="checkins" className="mb-8 scroll-mt-16">
          <Label icon={Check} text="Daily check-ins" hint={`${done} of 5`} />
          <ul className="mt-3 divide-y divide-neutral-900 rounded-md border border-neutral-800 bg-neutral-950/40">
            {CHECK_INS.map(({ id, label, icon }) => {
              const s = checkIns[id];
              const Icon = icon;
              return (
                <li key={id} className="flex items-center gap-3 px-4 py-3">
                  <Icon className={`h-4 w-4 shrink-0 ${s === true ? 'text-emerald-400' : s === false ? 'text-red-400' : 'text-neutral-500'}`} strokeWidth={1.75} />
                  <span className={`flex-1 text-[15px] ${s === true ? 'text-neutral-100' : s === false ? 'text-neutral-400' : 'text-neutral-300'}`}>{label}</span>
                  <Toggle active={s === true} tone="pos" onClick={() => setCheckIn(id, true)} label={`${label}: yes`} disabled={loading}><Check className="h-4 w-4" strokeWidth={2.25} /></Toggle>
                  <Toggle active={s === false} tone="neg" onClick={() => setCheckIn(id, false)} label={`${label}: no`} disabled={loading}><X className="h-4 w-4" strokeWidth={2.25} /></Toggle>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Rule of the day */}
        <section className="mb-10">
          <div className="flex items-center justify-between">
            <Label icon={BookOpen} text="Rule of the day" />
            <div className="flex items-center gap-2">
              {ruleOffset !== 0 && <button type="button" onClick={resetRule} className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 hover:text-emerald-400">Back to today</button>}
              <button type="button" onClick={nextRule} aria-label="Next rule" disabled={rules.length <= 1}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-800 text-neutral-500 hover:text-emerald-400 disabled:opacity-40">
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          </div>
          <figure className="mt-3 flex items-start gap-4 rounded-md border border-neutral-800 bg-neutral-950/60 p-4">
            <div className="shrink-0 font-mono text-[11px] uppercase tracking-[0.2em] text-emerald-400/80">
              Rule<div className="mt-0.5 text-2xl font-medium tabular-nums text-emerald-400">{String(rule.rule_number ?? ruleIdx + 1).padStart(2, '0')}</div>
            </div>
            <blockquote className="border-l border-neutral-800 pl-4 text-[15px] leading-relaxed text-neutral-200">{rule.rule_text}</blockquote>
          </figure>
        </section>

        {/* Tonight: prep tomorrow */}
        <section id="prep" className="scroll-mt-16 rounded-md border border-neutral-800 bg-neutral-950/40 p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Label icon={Sparkles} text="Tonight: prep tomorrow" hint={`for ${prettyDay(tomorrow)}`} />
            {planTomorrow && (
              <span className="font-mono text-[10px] text-neutral-600">
                generated {planTomorrow.generated_at ? new Date(planTomorrow.generated_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'earlier'}
              </span>
            )}
          </div>
          <p className="mt-2 text-[12px] text-neutral-500">
            Built from today’s intention, check-ins and life journal. Tomorrow it appears at the top as “Today’s plan”.
          </p>
          <button type="button" onClick={onGenerate} disabled={generating || loading || !intention.trim()}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-5 py-3 text-[14px] font-medium text-emerald-300 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-40">
            {generating ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
              : planTomorrow ? <><RefreshCw className="h-4 w-4" /> Regenerate</> : <><Sparkles className="h-4 w-4" /> Generate tomorrow’s checklist</>}
          </button>
          {!intention.trim() && !loading && <p className="mt-2 text-[12px] text-neutral-500">Write today’s intention above first.</p>}
          {planTomorrow && <div className="mt-5"><Plan plan={planTomorrow} onToggle={(c, i) => toggle('tomorrow', c, i)} /></div>}
        </section>

        <footer className="pt-8 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-700">Discipline compounds.</footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Stat({ label, value, sub }) {
  return (
    <div className="bg-[#0b0b0b] px-4 py-3">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="mt-1 font-mono text-[20px] tabular-nums text-neutral-100">{value}</div>
      <div className="mt-0.5 font-mono text-[11px] text-neutral-500">{sub}</div>
    </div>
  );
}

function Cap({ label, value, anchor }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="font-mono text-[13px] tabular-nums text-neutral-200">{usd(value)}</div>
      {value > anchor && <div className="font-mono text-[10px] text-neutral-600">anchor {usd(anchor)}</div>}
    </div>
  );
}

function Quick({ to, icon, primary, children }) {
  const Icon = icon;
  return (
    <Link to={to} className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[12px] ${primary
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15'
      : 'border-neutral-800 text-neutral-300 hover:border-neutral-700 hover:text-neutral-100'}`}>
      <Icon className="h-3.5 w-3.5" strokeWidth={2} /> {children}
    </Link>
  );
}

function Label({ icon, text, hint }) {
  const Icon = icon;
  return (
    <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.22em] text-neutral-500">
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} /> <span>{text}</span>
      {hint && <span className="font-normal normal-case tracking-normal text-neutral-600">· {hint}</span>}
    </div>
  );
}

function Skeleton() {
  return <div className="mt-3 h-16 animate-pulse rounded-md border border-neutral-800 bg-neutral-950/40" />;
}

function Toggle({ active, tone, onClick, label, disabled, children }) {
  const on = tone === 'pos' ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300' : 'border-red-500/60 bg-red-500/10 text-red-300';
  return (
    <button type="button" aria-label={label} aria-pressed={active} onClick={onClick} disabled={disabled}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-md border transition-all active:scale-95 disabled:opacity-40 ${active ? on : 'border-neutral-800 bg-neutral-900/40 text-neutral-500 hover:text-neutral-300'}`}>
      {children}
    </button>
  );
}

const ACCENT = {
  trading_items: { label: 'Trading', icon: TrendingUp, text: 'text-emerald-400', box: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400' },
  work_items: { label: 'Work', icon: Briefcase, text: 'text-sky-400', box: 'border-sky-500/40 bg-sky-500/15 text-sky-400' },
  life_items: { label: 'Life', icon: Heart, text: 'text-violet-400', box: 'border-violet-500/40 bg-violet-500/15 text-violet-400' },
};

function Plan({ plan, onToggle }) {
  return (
    <div className="mt-3 space-y-4">
      {plan.priority && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-[14px] leading-relaxed text-amber-50">
          <Star className="mt-1 h-3.5 w-3.5 shrink-0 text-amber-400" fill="currentColor" /> {plan.priority}
        </div>
      )}
      {Object.entries(ACCENT).map(([cat, a]) => (plan[cat] || []).length > 0 && (
        <div key={cat}>
          <div className={`flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] ${a.text}`}><a.icon className="h-3 w-3" /> {a.label}</div>
          <ul className="mt-1.5 divide-y divide-neutral-900 rounded-md border border-neutral-800 bg-neutral-950/40">
            {plan[cat].map((item, i) => (
              <li key={i} className="flex items-start gap-3 px-3 py-2.5">
                <button type="button" onClick={() => onToggle(cat, i)} aria-pressed={item.done} aria-label={item.done ? 'Mark as not done' : 'Mark as done'}
                  className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border ${item.done ? a.box : 'border-neutral-700 bg-neutral-900/40 hover:border-neutral-600'}`}>
                  {item.done && <Check className="h-3 w-3" strokeWidth={3} />}
                </button>
                <span className={`flex-1 text-[14px] leading-relaxed ${item.done ? 'text-neutral-500 line-through' : 'text-neutral-200'}`}>{item.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
