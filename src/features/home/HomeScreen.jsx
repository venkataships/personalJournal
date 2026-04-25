import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Sunrise,
  Sun,
  Moon,
  AlertCircle,
  Plus,
  Sunrise as DashIcon,
  Sparkles,
  ClipboardCheck,
  BookText,
  HeartPulse,
  LineChart,
  ScrollText,
  Eye,
  ArrowRight,
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

const CHECKIN_KEYS = [
  'trading_ready', 'work_focused', 'movement_done', 'device_boundaries', 'present_with_akhila',
];

// ---------------------------------------------------------------------------
// Navigation grid config
// ---------------------------------------------------------------------------

const NAV_CARDS = [
  { id: 'dashboard',     to: '/dashboard',     icon: DashIcon,        title: 'Daily Dashboard',  subtitle: 'Check-ins & intention',     enabled: true },
  { id: 'tomorrow',      to: '/tomorrow-prep', icon: Sparkles,        title: "Tomorrow's Prep",  subtitle: 'Plan your next day',        enabled: true },
  { id: 'trade-journal', to: '/trade-journal', icon: BookText,        title: 'Trade Journal',    subtitle: 'Log & review trades',       enabled: true },
  { id: 'pre-trade',     to: '/pre-trade',     icon: ClipboardCheck,  title: 'Pre-Trade Check',  subtitle: 'Before every trade',        enabled: false },
  { id: 'life-journal',  to: '/life-journal',  icon: HeartPulse,      title: 'Life Journal',     subtitle: 'Daily reflection',          enabled: true },
  { id: 'performance',   to: '/performance',   icon: LineChart,       title: 'Performance',      subtitle: 'P&L & patterns',            enabled: false },
  { id: 'rules',         to: '/rules',         icon: ScrollText,      title: 'My Rules',         subtitle: '16 trading rules',          enabled: false },
  { id: 'watchlist',     to: '/watchlist',     icon: Eye,             title: 'Watchlist',        subtitle: 'Tickers & theses',          enabled: false },
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

  // Today's data
  const [todayData, setTodayData] = useState({
    loading: true,
    error: null,
    intention: '',
    checkInsCompleted: 0,
    openTradesCount: 0,
  });

  useEffect(() => {
    let cancelled = false;
    setTodayData((d) => ({ ...d, loading: true, error: null }));
    (async () => {
      try {
        await authReady();
        const [{ data: ci, error: ciErr }, { count: openCount, error: tradesErr }] =
          await Promise.all([
            supabase.from('daily_checkins').select('*').eq('date', dateKey).maybeSingle(),
            supabase.from('trade_journal').select('*', { count: 'exact', head: true }).eq('status', 'open'),
          ]);
        if (ciErr) throw ciErr;
        if (tradesErr) throw tradesErr;
        if (cancelled) return;
        const completed = ci ? CHECKIN_KEYS.filter((k) => ci[k] === true).length : 0;
        setTodayData({
          loading: false,
          error: null,
          intention: ci?.intention || '',
          checkInsCompleted: completed,
          openTradesCount: openCount ?? 0,
        });
      } catch (e) {
        if (!cancelled) {
          setTodayData((d) => ({ ...d, loading: false, error: e.message || 'Failed to load.' }));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [dateKey]);

  const { text: greetText, Icon: GreetIcon } = greeting(now);

  const isLive = !todayData.error && !portfolio.error;

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
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-neutral-500">
            <span
              className={`relative inline-flex h-1.5 w-1.5 ${isLive ? '' : ''}`}
            >
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

          {(todayData.error || portfolio.error) && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[13px] text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>{todayData.error || portfolio.error}</span>
            </div>
          )}
        </header>

        {/* ─── Status strip ─── */}
        <section
          aria-label="Today's status"
          className="mb-10 grid grid-cols-3 gap-3 rounded-md border border-neutral-800 bg-neutral-950/40 px-5 py-4 sm:gap-6"
        >
          <Stat
            label="Portfolio"
            value={portfolio.loading ? '—' : formatUSD(portfolio.value)}
            sub={
              portfolio.loading
                ? null
                : portfolio.realizedPnl > 0
                ? <span className="text-emerald-400">+{formatUSD(portfolio.realizedPnl)}</span>
                : portfolio.realizedPnl < 0
                ? <span className="text-red-400">{formatUSD(portfolio.realizedPnl)}</span>
                : 'Flat'
            }
          />
          <Stat
            label="Check-ins"
            value={todayData.loading ? '—' : `${todayData.checkInsCompleted}/5`}
            sub={
              todayData.loading
                ? null
                : todayData.checkInsCompleted === 5
                ? <span className="text-emerald-400">Complete</span>
                : todayData.checkInsCompleted === 0
                ? <span className="text-neutral-600">Not started</span>
                : 'In progress'
            }
          />
          <Stat
            label="Open trades"
            value={todayData.loading ? '—' : String(todayData.openTradesCount)}
            sub={todayData.openTradesCount === 0 ? <span className="text-neutral-600">None active</span> : 'Active'}
          />
        </section>

        {/* ─── Today's intention ─── */}
        <section className="mb-10">
          <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
            Today's intention
          </div>
          <div className="mt-3">
            {todayData.loading ? (
              <div className="rounded-md border border-neutral-800 bg-neutral-950/40 px-5 py-4 text-sm text-neutral-600">
                Loading…
              </div>
            ) : todayData.intention?.trim() ? (
              <div className="rounded-md border border-neutral-800 bg-neutral-950/40 px-5 py-4">
                <blockquote className="text-[15px] italic leading-relaxed text-neutral-200">
                  “{todayData.intention}”
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
          </div>
        </section>

        {/* ─── Quick action ─── */}
        <section className="mb-8">
          <Link
            to="/trade-journal"
            className="group flex items-center justify-center gap-2 w-full rounded-md border border-emerald-500/40 bg-emerald-500/10 px-5 py-4 text-[13px] font-medium uppercase tracking-[0.15em] text-emerald-200 hover:bg-emerald-500/15 hover:border-emerald-500/60 transition-all active:scale-[0.99]"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Log a trade
          </Link>
        </section>

        {/* ─── Navigation grid ─── */}
        <section className="mb-10">
          <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-500 mb-3">
            Navigate
          </div>
          <div className="grid grid-cols-2 gap-3">
            {NAV_CARDS.map((card) => (
              <NavCard key={card.id} {...card} />
            ))}
          </div>
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

function formatUSD(n) {
  return n.toLocaleString('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  });
}

function Stat({ label, value, sub }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </div>
      <div className="mt-1 font-mono text-xl font-medium tabular-nums text-neutral-100 sm:text-2xl truncate">
        {value}
      </div>
      {sub != null && (
        <div className="mt-0.5 text-[11px] font-mono text-neutral-500 truncate">
          {sub}
        </div>
      )}
    </div>
  );
}

function NavCard({ to, icon: Icon, title, subtitle, enabled }) {
  const inner = (
    <>
      <div className="flex items-start justify-between">
        <Icon
          className={`h-5 w-5 ${enabled ? 'text-emerald-400' : 'text-neutral-700'}`}
          strokeWidth={1.75}
        />
        {!enabled && (
          <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-neutral-700">
            Soon
          </span>
        )}
      </div>
      <div className="mt-4">
        <div className={`text-[14px] font-medium ${enabled ? 'text-neutral-100' : 'text-neutral-500'}`}>
          {title}
        </div>
        <div className={`mt-0.5 text-[11px] ${enabled ? 'text-neutral-500' : 'text-neutral-700'}`}>
          {subtitle}
        </div>
      </div>
    </>
  );

  const baseCls = 'block rounded-md border px-4 py-4 transition-all min-h-[110px]';

  if (enabled) {
    return (
      <Link
        to={to}
        className={`${baseCls} border-neutral-800 bg-neutral-950/40 hover:border-emerald-500/50 hover:bg-neutral-900/60 active:scale-[0.99]`}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div
      className={`${baseCls} border-neutral-900 bg-neutral-950/20 cursor-not-allowed opacity-70`}
      aria-disabled="true"
    >
      {inner}
    </div>
  );
}
