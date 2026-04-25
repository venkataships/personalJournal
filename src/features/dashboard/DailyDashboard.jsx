import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Sunrise,
  Sun,
  Moon,
  Check,
  X,
  TrendingUp,
  Briefcase,
  Activity,
  Smartphone,
  Heart,
  Target,
  BookOpen,
  ChevronRight,
  AlertCircle,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  ArrowLeft,
} from 'lucide-react';
import { supabase, authReady } from '../../lib/supabase';
import { usePortfolio, RULE_ANCHORS } from '../../hooks/usePortfolio';

// ---------------------------------------------------------------------------
// Static config. Check-in IDs must match column names on `daily_checkins`.
// ---------------------------------------------------------------------------
const CHECK_INS = [
  { id: 'trading_ready',       label: 'Trading ready',          icon: TrendingUp },
  { id: 'work_focused',        label: 'Work focused',           icon: Briefcase },
  { id: 'movement_done',       label: 'Movement done',          icon: Activity },
  { id: 'device_boundaries',   label: 'Device boundaries kept', icon: Smartphone },
  { id: 'present_with_akhila', label: 'Present with Akhila',    icon: Heart },
];

// Fallback used only if trade_rules table fails to load.
const FALLBACK_RULES = ['Stick to your rules.'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// YYYY-MM-DD in LOCAL time — not UTC, to avoid the day flipping at 8pm EST.
function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Deterministic rule-of-the-day. Same date → same rule.
function ruleIndexForDate(dateKey, total) {
  let h = 0;
  for (let i = 0; i < dateKey.length; i++) {
    h = (h * 31 + dateKey.charCodeAt(i)) >>> 0;
  }
  return h % total;
}

function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5)  return { text: 'Still up',        Icon: Moon };
  if (h < 12) return { text: 'Good morning',    Icon: Sunrise };
  if (h < 17) return { text: 'Good afternoon',  Icon: Sun };
  if (h < 21) return { text: 'Good evening',    Icon: Moon };
  return       { text: 'Good night',            Icon: Moon };
}

function formatLongDate(d = new Date()) {
  return d.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function formatUSD(n) {
  return n.toLocaleString('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  });
}

// Safe localStorage.
const store = {
  get(key, fallback) {
    try {
      const v = window.localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); }
    catch { /* ignore */ }
  },
};

// ---------------------------------------------------------------------------
// Supabase data layer
// ---------------------------------------------------------------------------

async function fetchTodayRow(dateKey) {
  await authReady();
  const { data, error } = await supabase
    .from('daily_checkins')
    .select('*')
    .eq('date', dateKey)
    .maybeSingle();
  if (error) throw error;
  return data; // null if no row yet
}

async function upsertCheckinRow(dateKey, patch) {
  await authReady();
  const { error } = await supabase
    .from('daily_checkins')
    .upsert(
      { date: dateKey, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'date' },
    );
  if (error) throw error;
}

async function fetchRules() {
  await authReady();
  const { data, error } = await supabase
    .from('trade_rules')
    .select('rule_number, rule_text')
    .eq('is_active', true)
    .order('rule_number', { ascending: true });
  if (error) throw error;
  return (data || []).map((r) => r.rule_text);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DailyDashboard() {
  const [now, setNow] = useState(() => new Date());
  const dateKey = todayKey(now);
  const portfolio = usePortfolio();

  // Minute tick so greeting crosses noon / 5pm / 9pm and day rolls over.
  useEffect(() => {
    const tick = () => setNow(new Date());
    let intervalId;
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    const timeoutId = setTimeout(() => {
      tick();
      intervalId = setInterval(tick, 60_000);
    }, msToNextMinute);
    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  // --- Connection / error state ----------------------------------------------
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(0);
  const flashSaved = useCallback(() => setSavedAt(Date.now()), []);
  const savedVisible = Date.now() - savedAt < 1500;
  // Force a re-render 1.6s after save so the indicator fades out.
  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setNow((d) => new Date(d.getTime())), 1600);
    return () => clearTimeout(t);
  }, [savedAt]);

  // --- Intention + check-ins state -------------------------------------------
  const [intention, setIntention] = useState('');
  const [checkIns, setCheckIns] = useState({}); // { [id]: true | false | null }

  // --- Rules state -----------------------------------------------------------
  const [rules, setRules] = useState(FALLBACK_RULES);

  // Load today's row + rules on mount / date change.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [row, loadedRules] = await Promise.all([
          fetchTodayRow(dateKey),
          fetchRules(),
        ]);
        if (cancelled) return;

        if (loadedRules.length) setRules(loadedRules);

        if (row) {
          setIntention(row.intention || '');
          setCheckIns({
            trading_ready:       row.trading_ready,
            work_focused:        row.work_focused,
            movement_done:       row.movement_done,
            device_boundaries:   row.device_boundaries,
            present_with_akhila: row.present_with_akhila,
          });
        } else {
          const draft = store.get(`cc.draft.${dateKey}`, null);
          if (draft) {
            setIntention(draft.intention || '');
            setCheckIns(draft.checkIns || {});
          } else {
            setIntention('');
            setCheckIns({});
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'Failed to load today’s data.');
          const draft = store.get(`cc.draft.${dateKey}`, null);
          if (draft) {
            setIntention(draft.intention || '');
            setCheckIns(draft.checkIns || {});
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [dateKey]);

  // Mirror to localStorage so flaky network doesn't lose in-progress edits.
  useEffect(() => {
    store.set(`cc.draft.${dateKey}`, { intention, checkIns });
  }, [dateKey, intention, checkIns]);

  // --- Intention save (debounced 500ms) --------------------------------------
  const intentionDebounceRef = useRef(null);
  const onIntentionChange = useCallback(
    (e) => {
      const v = e.target.value;
      setIntention(v);
      if (intentionDebounceRef.current) clearTimeout(intentionDebounceRef.current);
      intentionDebounceRef.current = setTimeout(async () => {
        try {
          await upsertCheckinRow(dateKey, { intention: v });
          setError(null);
          flashSaved();
        } catch (err) {
          setError(err.message || 'Failed to save intention.');
        }
      }, 500);
    },
    [dateKey, flashSaved],
  );

  useEffect(() => {
    return () => {
      if (intentionDebounceRef.current) clearTimeout(intentionDebounceRef.current);
    };
  }, []);

  // --- Check-in toggle -------------------------------------------------------
  const setCheckIn = useCallback(
    (id, value) => {
      setCheckIns((prev) => {
        const current = prev[id];
        const next = current === value ? null : value; // tri-state
        const updated = { ...prev, [id]: next };

        // Fire-and-forget optimistic DB write.
        (async () => {
          try {
            await upsertCheckinRow(dateKey, { [id]: next });
            setError(null);
            flashSaved();
          } catch (err) {
            setError(err.message || 'Failed to save check-in.');
          }
        })();

        return updated;
      });
    },
    [dateKey, flashSaved],
  );

  const completedCount = useMemo(
    () => CHECK_INS.filter((c) => checkIns[c.id] === true).length,
    [checkIns],
  );

  // --- Rule of the day -------------------------------------------------------
  const ruleOffsetKey = `cc.ruleOffset.${dateKey}`;
  const [ruleOffset, setRuleOffset] = useState(() => store.get(ruleOffsetKey, 0));
  useEffect(() => { setRuleOffset(store.get(ruleOffsetKey, 0)); }, [ruleOffsetKey]);

  const baseRuleIdx = useMemo(
    () => ruleIndexForDate(dateKey, rules.length || 1),
    [dateKey, rules.length],
  );
  const ruleIdx = rules.length ? (baseRuleIdx + ruleOffset) % rules.length : 0;
  const ruleText = rules[ruleIdx] || FALLBACK_RULES[0];
  const isBrowsing = ruleOffset !== 0;

  const advanceRule = useCallback(() => {
    setRuleOffset((prev) => {
      const next = rules.length ? (prev + 1) % rules.length : 0;
      store.set(ruleOffsetKey, next);
      return next;
    });
  }, [ruleOffsetKey, rules.length]);

  const resetRule = useCallback(() => {
    setRuleOffset(0);
    store.set(ruleOffsetKey, 0);
  }, [ruleOffsetKey]);

  const { text: greetText, Icon: GreetIcon } = greeting(now);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 font-sans antialiased selection:bg-emerald-500/30">
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
        {/* ─── Header ─── */}
        <header className="mb-10">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 mb-3 text-[11px] uppercase tracking-[0.22em] text-neutral-500 hover:text-emerald-400 transition-colors"
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={2} />
            Home
          </Link>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-neutral-500">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                error
                  ? 'bg-red-500 shadow-[0_0_8px] shadow-red-500/70'
                  : 'bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/70'
              }`}
            />
            <span>Command Center</span>
            <span className="text-neutral-700">·</span>
            <span className="font-mono">{formatLongDate(now)}</span>

            <span
              className={`ml-auto flex items-center gap-1 text-emerald-400 transition-opacity duration-500 ${
                savedVisible ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <Check className="h-3 w-3" strokeWidth={2.5} />
              <span className="normal-case tracking-normal">Saved</span>
            </span>
          </div>

          <h1 className="mt-4 flex items-baseline gap-3 text-3xl font-light tracking-tight text-neutral-100 sm:text-4xl">
            <GreetIcon className="h-7 w-7 shrink-0 self-center text-emerald-400" strokeWidth={1.5} />
            <span>{greetText}, Sujay.</span>
          </h1>

          <p className="mt-2 text-sm text-neutral-500">
            {loading
              ? 'Loading today’s entry…'
              : completedCount === 5
              ? 'All five check-ins logged. Good day.'
              : completedCount === 0
              ? 'Set an intention and run your check-ins below.'
              : `${completedCount} of 5 check-ins complete.`}
          </p>

          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[13px] text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>
                {error} Your changes are saved locally and will sync when the connection returns.
              </span>
            </div>
          )}
        </header>

        {/* ─── Trading portfolio ─── */}
        <section
          aria-label="Trading portfolio"
          className="mb-10 rounded-md border border-neutral-800 bg-neutral-950/40 px-5 py-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-neutral-500">
                <Wallet className="h-3 w-3" strokeWidth={2} />
                Trading portfolio
              </div>
              <div className="mt-2 font-mono text-3xl font-medium tabular-nums text-neutral-100 sm:text-4xl">
                {portfolio.loading ? '—' : formatUSD(portfolio.value)}
              </div>
              {!portfolio.loading && (
                <div className="mt-1 flex items-center gap-1 font-mono text-[12px] tabular-nums">
                  {portfolio.realizedPnl > 0 ? (
                    <>
                      <ArrowUpRight className="h-3 w-3 text-emerald-400" strokeWidth={2} />
                      <span className="text-emerald-400">+{formatUSD(portfolio.realizedPnl)}</span>
                    </>
                  ) : portfolio.realizedPnl < 0 ? (
                    <>
                      <ArrowDownRight className="h-3 w-3 text-red-400" strokeWidth={2} />
                      <span className="text-red-400">{formatUSD(portfolio.realizedPnl)}</span>
                    </>
                  ) : (
                    <span className="text-neutral-500">Flat · no closed trades</span>
                  )}
                  {portfolio.realizedPnl !== 0 && (
                    <span className="text-neutral-600">from {formatUSD(portfolio.startingCapital)} start</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Caps row — position size limits derived from current portfolio */}
          {!portfolio.loading && (
            <div className="mt-5 pt-4 border-t border-neutral-900 grid grid-cols-3 gap-3">
              <CapStat
                label="Indep. max"
                value={portfolio.caps.independent}
                anchor={RULE_ANCHORS.anchorIndependent}
              />
              <CapStat
                label="Discord max"
                value={portfolio.caps.discord}
                anchor={RULE_ANCHORS.anchorDiscord}
              />
              <CapStat
                label="Loss cap"
                value={portfolio.caps.maxLoss}
                anchor={RULE_ANCHORS.anchorMaxLoss}
              />
            </div>
          )}

          {portfolio.error && (
            <div className="mt-3 text-[11px] text-red-400">
              {portfolio.error}
            </div>
          )}
        </section>

        {/* ─── Intention ─── */}
        <section className="mb-10">
          <SectionLabel icon={Target} label="Today's intention" />
          <div className="relative mt-3">
            <textarea
              value={intention}
              onChange={onIntentionChange}
              placeholder="What matters most today?"
              rows={2}
              disabled={loading}
              className="w-full resize-none rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-3 text-base leading-relaxed text-neutral-100 placeholder:text-neutral-600 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 transition-colors disabled:opacity-50"
            />
            <div className="mt-1.5 text-right text-[11px] text-neutral-600">
              {intention.length ? `${intention.length} chars` : ''}
            </div>
          </div>
        </section>

        {/* ─── Check-ins ─── */}
        <section className="mb-10">
          <SectionLabel icon={Check} label="Daily check-ins" />
          <ul className="mt-3 divide-y divide-neutral-900 rounded-md border border-neutral-800 bg-neutral-950/40">
            {CHECK_INS.map(({ id, label, icon: Icon }) => {
              const state = checkIns[id];
              return (
                <li key={id} className="flex items-center gap-3 px-4 py-3.5 sm:gap-4">
                  <Icon
                    className={`h-4 w-4 shrink-0 transition-colors ${
                      state === true
                        ? 'text-emerald-400'
                        : state === false
                        ? 'text-red-400'
                        : 'text-neutral-500'
                    }`}
                    strokeWidth={1.75}
                  />
                  <span
                    className={`flex-1 text-[15px] transition-colors ${
                      state === true
                        ? 'text-neutral-100'
                        : state === false
                        ? 'text-neutral-400'
                        : 'text-neutral-300'
                    }`}
                  >
                    {label}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <ToggleButton
                      active={state === true}
                      tone="positive"
                      onClick={() => setCheckIn(id, true)}
                      ariaLabel={`${label}: yes`}
                      disabled={loading}
                    >
                      <Check className="h-4 w-4" strokeWidth={2.25} />
                    </ToggleButton>
                    <ToggleButton
                      active={state === false}
                      tone="negative"
                      onClick={() => setCheckIn(id, false)}
                      ariaLabel={`${label}: no`}
                      disabled={loading}
                    >
                      <X className="h-4 w-4" strokeWidth={2.25} />
                    </ToggleButton>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ─── Rule of the day ─── */}
        <section className="mb-4">
          <div className="flex items-center justify-between">
            <SectionLabel icon={BookOpen} label="Rule of the day" />
            <div className="flex items-center gap-2">
              {isBrowsing && (
                <button
                  type="button"
                  onClick={resetRule}
                  className="text-[10px] uppercase tracking-[0.2em] text-neutral-500 hover:text-emerald-400 transition-colors"
                >
                  Back to today
                </button>
              )}
              <button
                type="button"
                onClick={advanceRule}
                aria-label="Next rule"
                disabled={rules.length <= 1}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-800 bg-neutral-900/40 text-neutral-500 hover:border-neutral-700 hover:text-emerald-400 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          </div>
          <figure className="mt-3 rounded-md border border-neutral-800 bg-gradient-to-b from-neutral-950/80 to-neutral-950/40 p-5">
            <div className="flex items-start gap-4">
              <div className="shrink-0 font-mono text-[11px] uppercase tracking-[0.2em] text-emerald-400/80">
                Rule
                <div className="mt-0.5 font-mono text-2xl font-medium text-emerald-400 tabular-nums">
                  {String(ruleIdx + 1).padStart(2, '0')}
                </div>
              </div>
              <blockquote className="border-l border-neutral-800 pl-4 text-[15px] leading-relaxed text-neutral-200">
                {ruleText}
              </blockquote>
            </div>
          </figure>
        </section>

        <footer className="pt-6 flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-700">
          <span className="hidden sm:inline">Discipline compounds.</span>
          <div className="flex items-center gap-4 ml-auto">
            <Link
              to="/trade-journal"
              className="inline-flex items-center gap-1.5 text-neutral-500 hover:text-emerald-400 transition-colors"
            >
              Log trade →
            </Link>
            <Link
              to="/tomorrow-prep"
              className="inline-flex items-center gap-1.5 text-neutral-500 hover:text-emerald-400 transition-colors"
            >
              Tomorrow's prep →
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CapStat({ label, value, anchor }) {
  // Show the derived value. If it's grown past the original anchor, display
  // the anchor in faint text as a reminder of where the rule started.
  const exceedsAnchor = value > anchor;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="mt-1 font-mono text-[14px] font-medium tabular-nums text-neutral-200">
        {value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
      </div>
      {exceedsAnchor && (
        <div className="text-[10px] font-mono text-neutral-600">
          anchor {anchor.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ icon: Icon, label }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.22em] text-neutral-500">
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      <span>{label}</span>
    </div>
  );
}

function ToggleButton({ active, tone, onClick, ariaLabel, disabled, children }) {
  const base =
    'inline-flex h-9 w-9 items-center justify-center rounded-md border transition-all duration-150 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed';
  const inactive =
    'border-neutral-800 bg-neutral-900/40 text-neutral-500 hover:border-neutral-700 hover:text-neutral-300';
  const activePos =
    'border-emerald-500/60 bg-emerald-500/15 text-emerald-300 shadow-[0_0_0_1px_rgba(34,197,94,0.25)]';
  const activeNeg =
    'border-red-500/60 bg-red-500/10 text-red-300 shadow-[0_0_0_1px_rgba(239,68,68,0.25)]';

  const cls = active ? (tone === 'positive' ? activePos : activeNeg) : inactive;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${cls}`}
    >
      {children}
    </button>
  );
}
