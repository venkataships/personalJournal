import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  AlertCircle,
  AlertTriangle,
  Check,
  Zap,
  Compass,
  FileText,
  Target as TargetIcon,
  TrendingUp,
  TrendingDown,
  Quote,
} from 'lucide-react';
import { supabase, authReady } from '../../lib/supabase';
import { usePortfolio } from '../../hooks/usePortfolio';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TRADE_TYPES = [
  { id: 'discord_alert', label: 'Discord Alert',     dot: 'bg-emerald-500' },
  { id: 'independent',   label: 'Independent Trade', dot: 'bg-amber-400'   },
  { id: 'paper',         label: 'Paper Trade',       dot: 'bg-neutral-400' },
];

// Per-type workflow config. Caps are filled in at runtime from usePortfolio().
const TYPE_CONFIG = {
  discord_alert: {
    capKey: 'discord',
    rulePrefix: 'Rule 6 (Discord): 5% of portfolio',
    requireThesis: false,
    requireTarget: false,
    requireChecklist: false,
    requireWatchlistCheck: false,
    thesisMinWords: 0,
  },
  independent: {
    capKey: 'independent',
    rulePrefix: 'Rule 6: 10% of portfolio',
    requireThesis: true,
    requireTarget: true,
    requireChecklist: true,
    requireWatchlistCheck: true,
    thesisMinWords: 50,
  },
  paper: {
    capKey: 'independent', // paper uses the independent cap (practice sizing)
    rulePrefix: 'Rule 6: 10% of portfolio',
    requireThesis: true,
    requireTarget: true,
    requireChecklist: true,
    requireWatchlistCheck: false,
    thesisMinWords: 20,
  },
};

const EMOTIONAL_STATES = [
  { id: 'calm',       emoji: '😌', label: 'Calm',       tone: 'ok'    },
  { id: 'analytical', emoji: '🤔', label: 'Analytical', tone: 'ok'    },
  { id: 'frustrated', emoji: '😤', label: 'Frustrated', tone: 'block' },
  { id: 'anxious',    emoji: '😰', label: 'Anxious',    tone: 'block' },
  { id: 'greedy',     emoji: '🤑', label: 'Greedy',     tone: 'block' },
];

const HOLD_OPTIONS = [
  { id: '1-2d', label: '1–2 days' },
  { id: '3-5d', label: '3–5 days' },
  { id: '1-2w', label: '1–2 weeks' },
];

// Max loss per position scales with portfolio (Rule 7 = 5%). Comes from usePortfolio().

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function wordCount(s) {
  if (!s) return 0;
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function toNum(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtPct(n) {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function fmtRR(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `1 : ${n.toFixed(2)}`;
}

function fmtUSD(n) {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TradeJournalEntry() {
  const navigate = useNavigate();
  const portfolio = usePortfolio();

  // --- Form state ------------------------------------------------------------
  const [tradeType, setTradeType] = useState(null);
  const [direction, setDirection] = useState('long');
  const [ticker, setTicker] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [positionSize, setPositionSize] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [holdEstimate, setHoldEstimate] = useState('3-5d');
  const [thesis, setThesis] = useState('');
  const [emotionalState, setEmotionalState] = useState(null);

  const [ckWatchlist, setCkWatchlist] = useState(false);
  const [ckCalm, setCkCalm] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [confirmation, setConfirmation] = useState(null);

  // --- Watchlist lookup ------------------------------------------------------
  const [watchlistTickers, setWatchlistTickers] = useState(new Set());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await authReady();
        const { data, error: err } = await supabase
          .from('watchlist').select('ticker').eq('is_active', true);
        if (err) throw err;
        if (!cancelled) {
          setWatchlistTickers(new Set((data || []).map((r) => r.ticker.toUpperCase())));
        }
      } catch (e) {
        console.warn('Watchlist fetch failed:', e.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // --- Config for the currently-selected type --------------------------------
  const cfg = tradeType ? TYPE_CONFIG[tradeType] : null;
  const isDiscord = tradeType === 'discord_alert';

  // --- Derived values --------------------------------------------------------
  const entry = toNum(entryPrice);
  const stop = toNum(stopLoss);
  const target = toNum(targetPrice);
  const size = toNum(positionSize);

  const riskPerShare = entry != null && stop != null ? Math.abs(entry - stop) : null;
  const rewardPerShare = entry != null && target != null ? Math.abs(target - entry) : null;
  const stopPct = entry && riskPerShare != null ? (riskPerShare / entry) * 100 : null;
  const riskReward = riskPerShare && rewardPerShare ? rewardPerShare / riskPerShare : null;
  const maxLoss = size != null && stopPct != null ? (size * stopPct) / 100 : null;

  // Direction validation — only when both stop and (if required) target are set
  const directionValid = useMemo(() => {
    if (entry == null || stop == null) return true;
    if (direction === 'long') {
      if (stop >= entry) return false;
      if (cfg?.requireTarget && target != null && target <= entry) return false;
    } else {
      if (stop <= entry) return false;
      if (cfg?.requireTarget && target != null && target >= entry) return false;
    }
    return true;
  }, [direction, entry, stop, target, cfg]);

  const directionError = !directionValid
    ? direction === 'long'
      ? 'For a long: stop must be below entry' + (cfg?.requireTarget ? ', and target above entry.' : '.')
      : 'For a short: stop must be above entry' + (cfg?.requireTarget ? ', and target below entry.' : '.')
    : null;

  // Thesis validation
  const wc = wordCount(thesis);
  const thesisOk = !cfg?.requireThesis || wc >= cfg.thesisMinWords;

  // Warnings
  const isBlockingEmotion = emotionalState &&
    EMOTIONAL_STATES.find((e) => e.id === emotionalState)?.tone === 'block';
  // Dynamic caps from current portfolio value
  const currentCap = cfg && !portfolio.loading ? portfolio.caps[cfg.capKey] : null;
  const currentMaxLoss = !portfolio.loading ? portfolio.caps.maxLoss : null;

  const overMaxPosition = currentCap != null && size != null && size > currentCap;
  const tickerUpper = ticker.toUpperCase().trim();
  const offWatchlist =
    cfg?.requireWatchlistCheck &&
    tickerUpper.length > 0 &&
    watchlistTickers.size > 0 &&
    !watchlistTickers.has(tickerUpper);
  const overMaxLoss = maxLoss != null && currentMaxLoss != null && maxLoss > currentMaxLoss;

  // Automatic preconditions
  const autoStopOk = stop != null;
  const autoSizeOk = size != null && size > 0 && !overMaxPosition;
  const autoThesisOk = thesisOk;

  // Can submit?
  const canSubmit =
    !submitting &&
    !portfolio.loading &&
    !!tradeType &&
    tickerUpper.length > 0 &&
    entry != null &&
    autoSizeOk &&
    autoStopOk &&
    (!cfg?.requireTarget || target != null) &&
    directionValid &&
    autoThesisOk &&
    !!emotionalState &&
    !isBlockingEmotion &&
    (!cfg?.requireChecklist || (ckWatchlist && ckCalm));

  // --- Submit ----------------------------------------------------------------
  const onSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await authReady();
      const row = {
        date: todayKey(),
        ticker: tickerUpper,
        strategy: holdEstimate,
        thesis: thesis || null,
        entry_price: entry,
        position_size: size,
        stop_loss: stop,
        target_price: target, // null for discord — column is nullable
        emotional_state: emotionalState,
        status: 'open',
        trade_type: tradeType,
        direction,
        hold_estimate: isDiscord ? null : holdEstimate,
        stop_loss_pct: stopPct,
        risk_reward: riskReward, // null for discord — no target
      };
      const { error: err } = await supabase
        .from('trade_journal')
        .insert(row)
        .select()
        .single();
      if (err) throw err;
      setConfirmation({
        ticker: tickerUpper,
        entry, stop, target, stopPct, riskReward,
        tradeType, isDiscord,
      });
    } catch (e) {
      setError(e.message || 'Failed to save trade.');
    } finally {
      setSubmitting(false);
    }
  }, [
    canSubmit, tickerUpper, entry, size, stop, target, thesis, emotionalState,
    tradeType, direction, holdEstimate, stopPct, riskReward, isDiscord,
  ]);

  const resetForm = useCallback(() => {
    setTradeType(null);
    setDirection('long');
    setTicker('');
    setEntryPrice('');
    setPositionSize('');
    setStopLoss('');
    setTargetPrice('');
    setHoldEstimate('3-5d');
    setThesis('');
    setEmotionalState(null);
    setCkWatchlist(false);
    setCkCalm(false);
    setConfirmation(null);
  }, []);

  if (confirmation) {
    return <Confirmation data={confirmation} onLogAnother={resetForm} onDashboard={() => navigate('/')} />;
  }

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

      <div className="relative mx-auto max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
        <header className="mb-10">
          <Link
            to="/trading"
            className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] text-neutral-500 hover:text-emerald-400 transition-colors"
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={2} />
            Trading
          </Link>
          <h1 className="mt-4 text-3xl font-light tracking-tight text-neutral-100 sm:text-4xl">
            Log a trade entry
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            {isDiscord
              ? 'Quick capture. Reflection comes at close.'
              : 'Pre-trade checklist. Written commitment before capital.'}
          </p>
          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[13px] text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span className="break-all">{error}</span>
            </div>
          )}
        </header>

        {/* ────────────── Section A: Trade Type ────────────── */}
        <Section icon={Zap} label="Trade type">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {TRADE_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTradeType(t.id)}
                className={`flex items-center gap-2.5 rounded-md border px-4 py-3 text-left transition-all active:scale-[0.98] ${
                  tradeType === t.id
                    ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-100'
                    : 'border-neutral-800 bg-neutral-950/40 text-neutral-300 hover:border-neutral-700'
                }`}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${t.dot}`} />
                <span className="text-[14px] font-medium">{t.label}</span>
              </button>
            ))}
          </div>
          {tradeType === 'independent' && (
            <Callout tone="amber" icon={AlertTriangle}>
              Independent trades require <strong>prior</strong> preparation. If you're
              researching this right now, this is FOMO. Rule 3 applies.
            </Callout>
          )}
          {isDiscord && (
            <Callout tone="neutral" icon={Zap}>
              Discord workflow: fast capture. No thesis required now — log reflection
              at close. Position capped at $500.
            </Callout>
          )}
        </Section>

        {/* Render nothing else until trade type is selected */}
        {!tradeType ? (
          <div className="mt-8 rounded-md border border-neutral-800 bg-neutral-950/40 px-4 py-6 text-center text-sm text-neutral-500">
            Select a trade type to continue.
          </div>
        ) : (
          <>
            {/* ────────────── Section B: Trade Details ────────────── */}
            <Section icon={Compass} label="Trade details">
              {/* Direction toggle */}
              <div className="mb-4 flex rounded-md border border-neutral-800 bg-neutral-950/40 p-1 w-fit">
                <DirectionButton
                  active={direction === 'long'}
                  icon={TrendingUp}
                  label="Long"
                  tone="emerald"
                  onClick={() => setDirection('long')}
                />
                <DirectionButton
                  active={direction === 'short'}
                  icon={TrendingDown}
                  label="Short"
                  tone="red"
                  onClick={() => setDirection('short')}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Ticker">
                  <input
                    type="text"
                    value={ticker}
                    onChange={(e) => setTicker(e.target.value.toUpperCase())}
                    maxLength={6}
                    placeholder="AMZN"
                    className="w-full rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-2.5 font-mono text-[15px] uppercase tracking-wider text-neutral-100 placeholder:text-neutral-700 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                  />
                  {offWatchlist && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-400/90">
                      <AlertTriangle className="h-3 w-3" strokeWidth={2} />
                      <span>Not on watchlist. Off-script trade.</span>
                    </div>
                  )}
                </Field>

                <Field label="Date">
                  <input
                    type="text"
                    value={todayKey()}
                    disabled
                    className="w-full rounded-md border border-neutral-800 bg-neutral-950/30 px-3 py-2.5 font-mono text-[15px] text-neutral-500"
                  />
                </Field>

                <Field label="Entry price">
                  <MoneyInput value={entryPrice} onChange={setEntryPrice} placeholder="249.70" />
                </Field>

                <Field label={`Position size  ·  max ${currentCap != null ? fmtUSD(currentCap) : '—'}`}>
                  <MoneyInput
                    value={positionSize}
                    onChange={setPositionSize}
                    placeholder={isDiscord ? '450' : '950'}
                    alert={overMaxPosition}
                  />
                  {overMaxPosition && currentCap != null && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-red-400">
                      <AlertTriangle className="h-3 w-3" strokeWidth={2} />
                      <span>{cfg.rulePrefix} = {fmtUSD(currentCap)}</span>
                    </div>
                  )}
                </Field>

                <Field label="Stop loss">
                  <MoneyInput value={stopLoss} onChange={setStopLoss} placeholder="242.00" />
                </Field>

                {cfg.requireTarget && (
                  <Field label="Target price">
                    <MoneyInput value={targetPrice} onChange={setTargetPrice} placeholder="260.00" />
                  </Field>
                )}

                {!isDiscord && (
                  <Field label="Hold estimate" className="sm:col-span-2">
                    <div className="flex flex-wrap gap-2">
                      {HOLD_OPTIONS.map((h) => (
                        <button
                          key={h.id}
                          type="button"
                          onClick={() => setHoldEstimate(h.id)}
                          className={`rounded-md border px-3 py-1.5 text-[13px] transition-all active:scale-95 ${
                            holdEstimate === h.id
                              ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
                              : 'border-neutral-800 bg-neutral-950/40 text-neutral-400 hover:border-neutral-700'
                          }`}
                        >
                          {h.label}
                        </button>
                      ))}
                    </div>
                  </Field>
                )}
              </div>

              {directionError && (
                <Callout tone="red" icon={AlertCircle}>{directionError}</Callout>
              )}

              {/* Calculated preview */}
              <div className={`mt-5 grid ${cfg.requireTarget ? 'grid-cols-3' : 'grid-cols-2'} gap-3 rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-3`}>
                <Stat label="Stop loss %" value={stopPct != null ? fmtPct(-Math.abs(stopPct)) : '—'} />
                <Stat label="Max loss" value={fmtUSD(maxLoss)} tone={overMaxLoss ? 'red' : 'neutral'} />
                {cfg.requireTarget && (
                  <Stat
                    label="R : R"
                    value={fmtRR(riskReward)}
                    tone={riskReward && riskReward >= 2 ? 'emerald' : riskReward && riskReward < 1 ? 'red' : 'neutral'}
                  />
                )}
              </div>
              {overMaxLoss && currentMaxLoss != null && (
                <Callout tone="red" icon={AlertTriangle}>
                  Max loss {fmtUSD(maxLoss)} exceeds {fmtUSD(currentMaxLoss)} per-position limit (Rule 7 — 5% of portfolio).
                </Callout>
              )}
            </Section>

            {/* ────────────── Section C: Thesis (non-Discord only) ────────────── */}
            {cfg.requireThesis && (
              <Section icon={FileText} label="Thesis">
                <textarea
                  value={thesis}
                  onChange={(e) => setThesis(e.target.value)}
                  placeholder={
                    tradeType === 'independent'
                      ? "Why are you taking this trade? What's the catalyst? Timeframe? What invalidates it?"
                      : "Why are you taking this trade? What's the setup?"
                  }
                  rows={6}
                  className="w-full resize-y rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-3 text-[14px] leading-relaxed text-neutral-100 placeholder:text-neutral-600 focus:border-emerald-500/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
                />
                <div className="mt-2 flex items-center justify-between text-[11px]">
                  <span className={thesisOk ? 'text-emerald-400' : 'text-red-400'}>
                    {wc} / {cfg.thesisMinWords} words {thesisOk ? '✓' : 'minimum'}
                  </span>
                </div>
              </Section>
            )}

            {/* ────────────── Section D: Emotional State ────────────── */}
            <Section icon={TargetIcon} label="Emotional state">
              <div className="grid grid-cols-5 gap-2">
                {EMOTIONAL_STATES.map((s) => {
                  const active = emotionalState === s.id;
                  const isBlock = s.tone === 'block';
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setEmotionalState(s.id)}
                      className={`flex flex-col items-center gap-1.5 rounded-md border px-2 py-3 transition-all active:scale-95 ${
                        active
                          ? isBlock
                            ? 'border-red-500/60 bg-red-500/10'
                            : 'border-emerald-500/60 bg-emerald-500/10'
                          : 'border-neutral-800 bg-neutral-950/40 hover:border-neutral-700'
                      }`}
                    >
                      <span className="text-2xl">{s.emoji}</span>
                      <span className={`text-[11px] font-medium ${
                        active ? (isBlock ? 'text-red-300' : 'text-emerald-300') : 'text-neutral-400'
                      }`}>
                        {s.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              {isBlockingEmotion && (
                <Callout tone="red" icon={AlertCircle}>
                  <strong>Rule 12 violation.</strong> Walk away for 15 minutes and recheck.
                  Submit is disabled while in this state.
                </Callout>
              )}
            </Section>

            {/* ────────────── Section E: Checklist (non-Discord only) ────────────── */}
            {cfg.requireChecklist && (
              <Section icon={Check} label="Final checklist">
                <div className="space-y-2">
                  <AutoCheck ok={autoThesisOk} label={`Thesis meets ${cfg.thesisMinWords}-word minimum`} />
                  <AutoCheck ok={autoStopOk}   label="Stop loss defined" />
                  <AutoCheck ok={autoSizeOk}   label={`Position size within ${currentCap != null ? fmtUSD(currentCap) : '—'} limit`} />
                  <ManualCheck
                    checked={ckWatchlist}
                    onChange={setCkWatchlist}
                    label="Stock is on my watchlist (or I've researched it thoroughly)"
                  />
                  <ManualCheck
                    checked={ckCalm}
                    onChange={setCkCalm}
                    label="I am in a calm, non-impulsive state"
                  />
                </div>
              </Section>
            )}

            {/* ────────────── Submit ────────────── */}
            <div className="mt-10">
              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit}
                className={`w-full rounded-md border px-5 py-4 text-[14px] font-medium tracking-[0.15em] uppercase transition-all active:scale-[0.99] disabled:cursor-not-allowed ${
                  canSubmit
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/20'
                    : isBlockingEmotion
                    ? 'border-red-500/40 bg-red-500/5 text-red-400/60'
                    : 'border-neutral-800 bg-neutral-950/40 text-neutral-600'
                }`}
              >
                {submitting
                  ? 'Saving…'
                  : isBlockingEmotion
                  ? 'Rule 12 — Submit disabled'
                  : canSubmit
                  ? 'Log Trade Entry'
                  : 'Complete form to submit'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({ icon: Icon, label, children }) {
  return (
    <section className="mb-10">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.22em] text-neutral-500">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span>{label}</span>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Field({ label, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <div className="mb-1.5 text-[11px] uppercase tracking-wider text-neutral-500">{label}</div>
      {children}
    </label>
  );
}

function MoneyInput({ value, onChange, placeholder, alert }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-[15px]">$</span>
      <input
        type="number"
        step="0.01"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-md border bg-neutral-950/60 pl-7 pr-3 py-2.5 font-mono text-[15px] tabular-nums text-neutral-100 placeholder:text-neutral-700 focus:outline-none focus:ring-1 ${
          alert
            ? 'border-red-500/60 focus:border-red-500/80 focus:ring-red-500/40'
            : 'border-neutral-800 focus:border-emerald-500/60 focus:ring-emerald-500/40'
        }`}
      />
    </div>
  );
}

function DirectionButton({ active, icon: Icon, label, tone, onClick }) {
  const activeCls = tone === 'emerald'
    ? 'bg-emerald-500/15 text-emerald-300'
    : 'bg-red-500/15 text-red-300';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[13px] font-medium transition-colors ${
        active ? activeCls : 'text-neutral-500 hover:text-neutral-300'
      }`}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      {label}
    </button>
  );
}

function Stat({ label, value, tone = 'neutral' }) {
  const toneCls =
    tone === 'emerald' ? 'text-emerald-300'
    : tone === 'red'   ? 'text-red-300'
    : 'text-neutral-100';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className={`mt-1 font-mono text-[15px] font-medium tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}

function Callout({ tone, icon: Icon, children }) {
  const toneCls =
    tone === 'red'    ? 'border-red-500/30 bg-red-500/5 text-red-300'
  : tone === 'amber'  ? 'border-amber-500/30 bg-amber-500/5 text-amber-200'
  :                     'border-neutral-800 bg-neutral-950/40 text-neutral-300';
  return (
    <div className={`mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] ${toneCls}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
      <div>{children}</div>
    </div>
  );
}

function AutoCheck({ ok, label }) {
  return (
    <div className="flex items-center gap-3 px-1 py-1">
      <div className={`inline-flex h-5 w-5 items-center justify-center rounded border ${
        ok
          ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
          : 'border-neutral-800 bg-neutral-900/40 text-neutral-700'
      }`}>
        {ok && <Check className="h-3 w-3" strokeWidth={2.5} />}
      </div>
      <span className={`text-[14px] ${ok ? 'text-neutral-300' : 'text-neutral-500'}`}>
        {label}
      </span>
      <span className="ml-auto text-[10px] uppercase tracking-wider text-neutral-700">Auto</span>
    </div>
  );
}

function ManualCheck({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded px-1 py-1 text-left hover:bg-neutral-900/30 transition-colors"
    >
      <div className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
        checked
          ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
          : 'border-neutral-700 bg-neutral-900/40 hover:border-neutral-600'
      }`}>
        {checked && <Check className="h-3 w-3" strokeWidth={2.5} />}
      </div>
      <span className={`text-[14px] ${checked ? 'text-neutral-200' : 'text-neutral-400'}`}>
        {label}
      </span>
    </button>
  );
}

function Confirmation({ data, onLogAnother, onDashboard }) {
  const { ticker, entry, stop, target, stopPct, riskReward, isDiscord } = data;
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 font-sans antialiased flex items-center justify-center px-5 py-10">
      <div className="max-w-md w-full">
        <div className="flex items-center justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/40">
            <Check className="h-7 w-7 text-emerald-400" strokeWidth={2} />
          </div>
        </div>
        <h1 className="mt-5 text-center text-2xl font-light text-neutral-100">Trade logged</h1>

        <div className="mt-6 rounded-md border border-neutral-800 bg-neutral-950/60 p-5">
          <div className="flex items-baseline justify-between">
            <div className="font-mono text-xl font-medium tracking-wider text-neutral-100">{ticker}</div>
            <div className="font-mono text-lg tabular-nums text-emerald-300">{fmtUSD(entry)}</div>
          </div>
          <div className="mt-4 space-y-2 text-[13px]">
            <Row label="Stop loss" value={`${fmtUSD(stop)}  (${fmtPct(-Math.abs(stopPct))})`} />
            {!isDiscord && target != null && (
              <Row label="Target" value={`${fmtUSD(target)}  (${fmtRR(riskReward)})`} />
            )}
          </div>
        </div>

        <figure className="mt-6 border-l-2 border-emerald-500/40 pl-4">
          <Quote className="h-3.5 w-3.5 text-emerald-500/60" strokeWidth={2} />
          <blockquote className="mt-1 text-[14px] italic text-neutral-300">
            {isDiscord
              ? 'Stop is your only out. Log the story at close.'
              : 'Stick to your thesis. Exit at stop without hesitation.'}
          </blockquote>
        </figure>

        <div className="mt-8 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onLogAnother}
            className="rounded-md border border-neutral-800 bg-neutral-950/40 px-4 py-3 text-[13px] uppercase tracking-wider text-neutral-300 hover:border-neutral-700 transition-colors"
          >
            Log another
          </button>
          <button
            type="button"
            onClick={onDashboard}
            className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-[13px] uppercase tracking-wider text-emerald-200 hover:bg-emerald-500/15 transition-colors"
          >
            Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-neutral-500 uppercase tracking-wider text-[11px]">{label}</span>
      <span className="font-mono tabular-nums text-neutral-200">{value}</span>
    </div>
  );
}
