import { useState, useEffect, useMemo, useCallback } from 'react';
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
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Trading rules — single source of truth. Kept as ordered array so rule #N
// in the UI matches rule #N in Sujay's actual list.
// ---------------------------------------------------------------------------
const TRADING_RULES = [
  'Start with $10,000 learning account on Webull.',
  'No trades without preparation.',
  'Prep includes watchlist review, key levels, and full understanding before entering.',
  'No averaging down unless written justification exists before adding.',
  'Always stick to thesis. Exit without regret. Find the next opportunity.',
  'Maximum 10% of account per trade — $1,000 maximum position size.',
  'Maximum drawdown per position: $500.',
  'Maximum 2 losses in a week — take a break if hit.',
  'Take profits systematically, but let winners run.',
  'No 0DTE options. Ever.',
  'No new option entries on Fridays.',
  'Check emotional state before every trade.',
  'Do not let trading distract from work — Discord alerts at lunch only.',
  'Journal every trade. Daily.',
  'Weekend analysis and preparation.',
  'Be happy. If trading causes consistent stress, adjust.',
];

const CHECK_INS = [
  { id: 'trading_ready',    label: 'Trading ready',        icon: TrendingUp },
  { id: 'work_focused',     label: 'Work focused',         icon: Briefcase },
  { id: 'movement_done',    label: 'Movement done',        icon: Activity },
  { id: 'device_boundaries',label: 'Device boundaries kept', icon: Smartphone },
  { id: 'present_akhila',   label: 'Present with Akhila',  icon: Heart },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// YYYY-MM-DD in LOCAL time — not UTC, to avoid rule/check-in flipping at 8pm EST.
function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Deterministic rule-of-the-day. Same date -> same rule, regardless of reloads
// or re-renders. Uses a simple string hash of the date key.
function ruleIndexForDate(dateKey) {
  let h = 0;
  for (let i = 0; i < dateKey.length; i++) {
    h = (h * 31 + dateKey.charCodeAt(i)) >>> 0;
  }
  return h % TRADING_RULES.length;
}

function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5)  return { text: 'Still up',      Icon: Moon };
  if (h < 12) return { text: 'Good morning',  Icon: Sunrise };
  if (h < 17) return { text: 'Good afternoon', Icon: Sun };
  if (h < 21) return { text: 'Good evening',  Icon: Moon };
  return       { text: 'Good night',          Icon: Moon };
}

function formatLongDate(d = new Date()) {
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatUSD(n) {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

// Safe localStorage — swallows SSR / private-mode / quota errors.
const store = {
  get(key, fallback) {
    try {
      const v = window.localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DailyDashboard({ netWorth = 560899 }) {
  const [now, setNow] = useState(() => new Date());
  const dateKey = todayKey(now);

  // Re-render on the minute so the greeting crosses noon / 5pm / 9pm cleanly,
  // and so a browser tab left open overnight rolls over to the new day.
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

  // Intention — persisted per-day.
  const intentionKey = `cc.intention.${dateKey}`;
  const [intention, setIntention] = useState(() => store.get(intentionKey, ''));
  const [intentionSaved, setIntentionSaved] = useState(false);
  useEffect(() => {
    setIntention(store.get(intentionKey, ''));
    setIntentionSaved(false);
  }, [intentionKey]);

  const onIntentionChange = useCallback(
    (e) => {
      const v = e.target.value;
      setIntention(v);
      store.set(intentionKey, v);
      setIntentionSaved(true);
    },
    [intentionKey],
  );

  // Check-ins — persisted per-day as { id: 'yes' | 'no' | null }.
  const checkInKey = `cc.checkins.${dateKey}`;
  const [checkIns, setCheckIns] = useState(() => store.get(checkInKey, {}));
  useEffect(() => {
    setCheckIns(store.get(checkInKey, {}));
  }, [checkInKey]);

  const setCheckIn = useCallback(
    (id, value) => {
      setCheckIns((prev) => {
        // Tapping the active state again clears it — lets user undo a mis-tap.
        const next = { ...prev, [id]: prev[id] === value ? null : value };
        store.set(checkInKey, next);
        return next;
      });
    },
    [checkInKey],
  );

  const completedCount = useMemo(
    () => CHECK_INS.filter((c) => checkIns[c.id] === 'yes').length,
    [checkIns],
  );

  // Rule of the day — deterministic.
  const ruleIdx = useMemo(() => ruleIndexForDate(dateKey), [dateKey]);
  const ruleText = TRADING_RULES[ruleIdx];

  const { text: greetText, Icon: GreetIcon } = greeting(now);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 font-sans antialiased selection:bg-emerald-500/30">
      {/* subtle grid texture — Bloomberg-ish without being loud */}
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
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-neutral-500">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/70" />
            <span>Command Center</span>
            <span className="text-neutral-700">·</span>
            <span className="font-mono">{formatLongDate(now)}</span>
          </div>

          <h1 className="mt-4 flex items-baseline gap-3 text-3xl font-light tracking-tight text-neutral-100 sm:text-4xl">
            <GreetIcon
              className="h-7 w-7 shrink-0 self-center text-emerald-400"
              strokeWidth={1.5}
            />
            <span>{greetText}, Sujay.</span>
          </h1>

          <p className="mt-2 text-sm text-neutral-500">
            {completedCount === 5
              ? 'All five check-ins logged. Good day.'
              : completedCount === 0
              ? 'Set an intention and run your check-ins below.'
              : `${completedCount} of 5 check-ins complete.`}
          </p>
        </header>

        {/* ─── Net worth strip ─── */}
        <section
          aria-label="Net worth"
          className="mb-10 flex items-end justify-between border-b border-neutral-800/80 pb-5"
        >
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-neutral-500">
              Net Worth
            </div>
            <div className="mt-2 font-mono text-3xl font-medium tabular-nums text-neutral-100 sm:text-4xl">
              {formatUSD(netWorth)}
            </div>
          </div>
          <div className="text-right text-[11px] uppercase tracking-wider text-neutral-600">
            <div>Static</div>
            <div className="font-mono text-neutral-500">— · —</div>
          </div>
        </section>

        {/* ─── Intention ─── */}
        <section className="mb-10">
          <SectionLabel icon={Target} label="Today's intention" />
          <div className="relative mt-3">
            <textarea
              value={intention}
              onChange={onIntentionChange}
              onBlur={() => setIntentionSaved(false)}
              placeholder="What matters most today?"
              rows={2}
              className="w-full resize-none rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-3 text-base leading-relaxed text-neutral-100 placeholder:text-neutral-600 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40 transition-colors"
            />
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-neutral-600">
              <span>{intention.length ? `${intention.length} chars` : ''}</span>
              <span
                className={`transition-opacity duration-700 ${
                  intentionSaved && intention ? 'opacity-100' : 'opacity-0'
                }`}
              >
                saved
              </span>
            </div>
          </div>
        </section>

        {/* ─── Check-ins ─── */}
        <section className="mb-10">
          <SectionLabel icon={Check} label="Daily check-ins" />
          <ul className="mt-3 divide-y divide-neutral-900 rounded-md border border-neutral-800 bg-neutral-950/40">
            {CHECK_INS.map(({ id, label, icon: Icon }) => {
              const state = checkIns[id]; // 'yes' | 'no' | null/undefined
              return (
                <li
                  key={id}
                  className="flex items-center gap-3 px-4 py-3.5 sm:gap-4"
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 transition-colors ${
                      state === 'yes'
                        ? 'text-emerald-400'
                        : state === 'no'
                        ? 'text-red-400'
                        : 'text-neutral-500'
                    }`}
                    strokeWidth={1.75}
                  />
                  <span
                    className={`flex-1 text-[15px] transition-colors ${
                      state === 'yes'
                        ? 'text-neutral-100'
                        : state === 'no'
                        ? 'text-neutral-400'
                        : 'text-neutral-300'
                    }`}
                  >
                    {label}
                  </span>

                  <div className="flex items-center gap-1.5">
                    <ToggleButton
                      active={state === 'yes'}
                      tone="positive"
                      onClick={() => setCheckIn(id, 'yes')}
                      ariaLabel={`${label}: yes`}
                    >
                      <Check className="h-4 w-4" strokeWidth={2.25} />
                    </ToggleButton>
                    <ToggleButton
                      active={state === 'no'}
                      tone="negative"
                      onClick={() => setCheckIn(id, 'no')}
                      ariaLabel={`${label}: no`}
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
          <SectionLabel icon={BookOpen} label="Rule of the day" />
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

        <footer className="pt-6 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-700">
          Discipline compounds.
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ icon: Icon, label }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.22em] text-neutral-500">
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      <span>{label}</span>
    </div>
  );
}

function ToggleButton({ active, tone, onClick, ariaLabel, children }) {
  const base =
    'inline-flex h-9 w-9 items-center justify-center rounded-md border transition-all duration-150 active:scale-95';
  const inactive =
    'border-neutral-800 bg-neutral-900/40 text-neutral-500 hover:border-neutral-700 hover:text-neutral-300';
  const activePos =
    'border-emerald-500/60 bg-emerald-500/15 text-emerald-300 shadow-[0_0_0_1px_rgba(34,197,94,0.25)]';
  const activeNeg =
    'border-red-500/60 bg-red-500/10 text-red-300 shadow-[0_0_0_1px_rgba(239,68,68,0.25)]';

  const cls = active
    ? tone === 'positive'
      ? activePos
      : activeNeg
    : inactive;

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      onClick={onClick}
      className={`${base} ${cls}`}
    >
      {children}
    </button>
  );
}
