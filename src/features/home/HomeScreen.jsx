import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Sunrise,
  Sun,
  Moon,
  AlertCircle,
  Plus,
  ArrowRight,
  TrendingUp,
  HeartPulse,
  Sparkles,
  BookText,
  ClipboardCheck,
  LineChart,
  ScrollText,
  Eye,
} from 'lucide-react';
import { supabase, authReady } from '../../lib/supabase';
import { usePortfolio } from '../../hooks/usePortfolio';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5)  return { text: 'Still up',       Icon: Moon };
  if (h < 12) return { text: 'Good morning',   Icon: Sunrise };
  if (h < 17) return { text: 'Good afternoon', Icon: Sun };
  if (h < 21) return { text: 'Good evening',   Icon: Moon };
  return       { text: 'Good night',           Icon: Moon };
}

function formatLongDate(d = new Date()) {
  return d.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

function formatUSD(n) {
  return n.toLocaleString('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  });
}

function wordCount(s) {
  if (!s) return 0;
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// Days between two YYYY-MM-DD keys (positive = b after a)
function daysBetween(aKey, bKey) {
  const [ay, am, ad] = aKey.split('-').map(Number);
  const [by, bm, bd] = bKey.split('-').map(Number);
  const a = new Date(ay, am - 1, ad);
  const b = new Date(by, bm - 1, bd);
  return Math.round((b - a) / 86_400_000);
}

const CHECKIN_KEYS = [
  'trading_ready', 'work_focused', 'movement_done', 'device_boundaries', 'present_with_akhila',
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function HomeScreen() {
  const [now, setNow] = useState(() => new Date());
  const dateKey = todayKey(now);
  const portfolio = usePortfolio();

  // Minute tick for greeting transitions and day rollover
  useEffect(() => {
    let intervalId;
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    const timeoutId = setTimeout(() => {
      setNow(new Date());
      intervalId = setInterval(() => setNow(new Date()), 60_000);
    }, msToNextMinute);
    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  // Today's data — pulled across both systems
  const [data, setData] = useState({
    loading: true,
    error: null,
    intention: '',
    checkInsCompleted: 0,
    openTradesCount: 0,
    lifeToday: null,             // life_journal row for today, or null
    lastLifeEntryDate: null,     // YYYY-MM-DD of most recent entry, or null
  });

  useEffect(() => {
    let cancelled = false;
    setData((d) => ({ ...d, loading: true, error: null }));
    (async () => {
      try {
        await authReady();
        const [
          checkinRes,
          openTradesRes,
          lifeTodayRes,
          lifeLatestRes,
        ] = await Promise.all([
          supabase.from('daily_checkins').select('*').eq('date', dateKey).maybeSingle(),
          supabase.from('trade_journal').select('*', { count: 'exact', head: true }).eq('status', 'open'),
          supabase.from('life_journal').select('*').eq('date', dateKey).maybeSingle(),
          supabase.from('life_journal').select('date').order('date', { ascending: false }).limit(1).maybeSingle(),
        ]);

        if (checkinRes.error) throw checkinRes.error;
        if (openTradesRes.error) throw openTradesRes.error;
        if (lifeTodayRes.error) throw lifeTodayRes.error;
        if (lifeLatestRes.error) throw lifeLatestRes.error;
        if (cancelled) return;

        const ci = checkinRes.data;
        const completed = ci ? CHECKIN_KEYS.filter((k) => ci[k] === true).length : 0;

        setData({
          loading: false,
          error: null,
          intention: ci?.intention || '',
          checkInsCompleted: completed,
          openTradesCount: openTradesRes.count ?? 0,
          lifeToday: lifeTodayRes.data,
          lastLifeEntryDate: lifeLatestRes.data?.date || null,
        });
      } catch (e) {
        if (!cancelled) {
          setData((d) => ({ ...d, loading: false, error: e.message || 'Failed to load.' }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [dateKey]);

  const { text: greetText, Icon: GreetIcon } = greeting(now);
  const isLive = !data.error && !portfolio.error;

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

      <div className="relative mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        {/* ─── Header ─── */}
        <header className="mb-10">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-neutral-500">
            <span className="relative inline-flex h-1.5 w-1.5">
              {isLive && (
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
              )}
              <span
                className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                  isLive
                    ? 'bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/70'
                    : 'bg-red-500 shadow-[0_0_8px] shadow-red-500/70'
                }`}
              />
            </span>
            <span>Command Center</span>
            <span className="text-neutral-700">·</span>
            <span className="font-mono">{formatLongDate(now)}</span>
          </div>

          <h1 className="mt-4 flex items-baseline gap-3 text-3xl font-light tracking-tight text-neutral-100 sm:text-4xl">
            <GreetIcon className="h-7 w-7 shrink-0 self-center text-emerald-400" strokeWidth={1.5} />
            <span>{greetText}, Sujay.</span>
          </h1>

          {(data.error || portfolio.error) && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[13px] text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>{data.error || portfolio.error}</span>
            </div>
          )}
        </header>

        {/* ─── Two registers, side by side ─── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-8">
          <TradingCard
            loading={data.loading || portfolio.loading}
            portfolio={portfolio}
            checkInsCompleted={data.checkInsCompleted}
            openTradesCount={data.openTradesCount}
          />
          <LifeCard
            loading={data.loading}
            today={data.lifeToday}
            lastEntryDate={data.lastLifeEntryDate}
            todayKey={dateKey}
          />
        </div>

        {/* ─── Intention ─── */}
        <section className="mb-8">
          <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500 mb-3">
            Today's intention
          </div>
          {data.loading ? (
            <div className="rounded-md border border-neutral-800 bg-neutral-950/40 px-5 py-4 text-sm text-neutral-600">
              Loading…
            </div>
          ) : data.intention?.trim() ? (
            <div className="rounded-md border border-neutral-800 bg-neutral-950/40 px-5 py-4">
              <blockquote className="text-[15px] italic leading-relaxed text-neutral-200">
                “{data.intention}”
              </blockquote>
            </div>
          ) : (
            <Link
              to="/dashboard"
              className="group flex items-center justify-between rounded-md border border-dashed border-neutral-700 bg-neutral-950/30 px-5 py-4 hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-colors"
            >
              <span className="text-sm text-neutral-400 group-hover:text-neutral-200 transition-colors">
                Set your intention for today
              </span>
              <ArrowRight className="h-4 w-4 text-neutral-600 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all" strokeWidth={2} />
            </Link>
          )}
        </section>

        {/* ─── Quick action ─── */}
        <section className="mb-12">
          <Link
            to="/journal"
            className="group flex items-center justify-center gap-2 w-full rounded-md border border-emerald-500/40 bg-emerald-500/10 px-5 py-4 text-[13px] font-medium uppercase tracking-[0.15em] text-emerald-200 hover:bg-emerald-500/15 hover:border-emerald-500/60 transition-all active:scale-[0.99]"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Log a trade
          </Link>
        </section>

        {/* ─── More: smaller, demoted ─── */}
        <section className="mb-10">
          <div className="text-[10px] uppercase tracking-[0.22em] text-neutral-600 mb-3">
            More
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SmallNav to="/tomorrow-prep"  icon={Sparkles}        title="Tomorrow's Prep"   enabled />
            <SmallNav to="/journal"  icon={BookText}        title="Trade Journal"     enabled />
            <SmallNav to="/pre-trade"      icon={ClipboardCheck}  title="Pre-Trade Check"   />
            <SmallNav to="/performance"    icon={LineChart}       title="Performance"       />
            <SmallNav to="/rules"          icon={ScrollText}      title="My Rules"          />
            <SmallNav to="/watchlist"      icon={Eye}             title="Watchlist"         />
          </div>
        </section>

        <footer className="pt-4 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-700">
          Discipline compounds.
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trading card — cockpit register: monospace, tight, emerald
// ---------------------------------------------------------------------------

function TradingCard({ loading, portfolio, checkInsCompleted, openTradesCount }) {
  return (
    <Link
      to="/dashboard"
      className="group flex flex-col rounded-md border border-neutral-800 bg-neutral-950/40 px-5 py-5 hover:border-emerald-500/40 hover:bg-neutral-900/50 transition-all"
    >
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-emerald-400/80">
        <TrendingUp className="h-3 w-3" strokeWidth={2} />
        Trading today
      </div>

      <div className="mt-4 space-y-3 flex-1">
        {/* Portfolio value */}
        <div>
          <div className="font-mono text-2xl font-medium tabular-nums text-neutral-100">
            {loading ? '—' : formatUSD(portfolio.value)}
          </div>
          <div className="font-mono text-[11px] text-neutral-500 tabular-nums">
            {loading
              ? ''
              : portfolio.realizedPnl > 0
              ? <span className="text-emerald-400">+{formatUSD(portfolio.realizedPnl)} realized</span>
              : portfolio.realizedPnl < 0
              ? <span className="text-red-400">{formatUSD(portfolio.realizedPnl)} realized</span>
              : <span>Flat · no closed trades</span>}
          </div>
        </div>

        {/* Today's trading state */}
        <div className="pt-2 border-t border-neutral-900 grid grid-cols-2 gap-3 text-[12px]">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500">Check-ins</div>
            <div className="mt-1 font-mono tabular-nums text-neutral-200">
              {loading ? '—' : `${checkInsCompleted} / 5`}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500">Open trades</div>
            <div className="mt-1 font-mono tabular-nums text-neutral-200">
              {loading ? '—' : openTradesCount}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-neutral-500 group-hover:text-emerald-400 transition-colors">
        Open dashboard
        <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" strokeWidth={2} />
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Life card — journal register: serif, breathing room, amber
// ---------------------------------------------------------------------------

function LifeCard({ loading, today, lastEntryDate, todayKey: tk }) {
  // Status logic
  const hasEntryToday = today != null;
  const alive = today?.energy_level ?? null;
  const words = wordCount(today?.free_write || '');
  const daysSince = lastEntryDate ? daysBetween(lastEntryDate, tk) : null;

  return (
    <Link
      to="/life-journal"
      className="group flex flex-col rounded-md border border-neutral-800 bg-neutral-950/40 px-5 py-5 hover:border-amber-500/40 hover:bg-neutral-900/50 transition-all"
    >
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-amber-400/80">
        <HeartPulse className="h-3 w-3" strokeWidth={2} />
        Life today
      </div>

      <div className="mt-4 space-y-3 flex-1">
        {/* Primary — alive feeling, or "not yet" */}
        <div>
          {loading ? (
            <div className="font-serif text-2xl text-neutral-600">—</div>
          ) : alive != null ? (
            <>
              <div className="font-serif text-2xl font-light text-neutral-100">
                Felt <span className="text-amber-300">{alive}</span> of 10
              </div>
              <div className="font-serif text-[13px] italic text-neutral-500 mt-0.5">
                {aliveWord(alive)}
              </div>
            </>
          ) : (
            <>
              <div className="font-serif text-xl font-light italic text-neutral-400">
                {hasEntryToday ? 'Today, in progress' : 'Today, not written yet'}
              </div>
              {!hasEntryToday && daysSince != null && daysSince > 0 && (
                <div className="font-serif text-[13px] italic text-neutral-700 mt-1">
                  Last entry {daysSinceText(daysSince)}
                </div>
              )}
              {!hasEntryToday && daysSince == null && (
                <div className="font-serif text-[13px] italic text-neutral-700 mt-1">
                  No entries yet
                </div>
              )}
            </>
          )}
        </div>

        {/* Secondary — words written today */}
        {hasEntryToday && (
          <div className="pt-2 border-t border-neutral-900">
            <div className="font-serif text-[13px] italic text-neutral-500">
              {words === 0
                ? 'No words written'
                : words === 1
                ? '1 word written'
                : `${words} words written`}
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center gap-1 font-serif text-[12px] italic text-neutral-500 group-hover:text-amber-400 transition-colors">
        Open journal
        <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" strokeWidth={2} />
      </div>
    </Link>
  );
}

function aliveWord(n) {
  if (n <= 3) return 'going through motions';
  if (n <= 6) return 'present but distracted';
  if (n <= 8) return 'genuinely engaged';
  return 'fully alive';
}

function daysSinceText(n) {
  if (n === 1) return 'yesterday';
  if (n < 7) return `${n} days ago`;
  if (n < 14) return 'a week ago';
  return `${Math.floor(n / 7)} weeks ago`;
}

// ---------------------------------------------------------------------------
// Small nav tile for the "More" section
// ---------------------------------------------------------------------------

function SmallNav({ to, icon: Icon, title, enabled }) {
  if (enabled) {
    return (
      <Link
        to={to}
        className="group flex items-center gap-2 rounded border border-neutral-800 bg-neutral-950/30 px-3 py-2.5 hover:border-neutral-700 hover:bg-neutral-900/50 transition-colors"
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-emerald-400/80" strokeWidth={1.75} />
        <span className="text-[12px] text-neutral-300 truncate">{title}</span>
      </Link>
    );
  }
  return (
    <div
      aria-disabled="true"
      className="flex items-center gap-2 rounded border border-neutral-900 bg-neutral-950/20 px-3 py-2.5 opacity-60 cursor-not-allowed"
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-700" strokeWidth={1.75} />
      <span className="text-[12px] text-neutral-600 truncate">{title}</span>
      <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.15em] text-neutral-700 shrink-0">
        Soon
      </span>
    </div>
  );
}
