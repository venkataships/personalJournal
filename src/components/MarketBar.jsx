import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { MARKET_TICKERS } from '../lib/marketTickers';
import { supabase, authReady } from '../lib/supabase';

// ---------------------------------------------------------------------------
// Config — tickers to display and their labels
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Sentiment determination
// Primary: weighted avg of SPY + QQQ + IWM (IWM at 0.5x — confirmation, not primary)
// IWM lagging while SPY/QQQ lead = narrow rally, less conviction
// Bonds (IEF) up = risk-off / defensive bid
// Gold up + equities down = fear trade confirmed
//
// Thresholds (weighted avg):
//   ≥ +0.8%           → BULLISH (strong, broad participation)
//   ≥ +0.15%          → BULLISH
//   -0.15% to +0.15%  → NEUTRAL
//   ≤ -0.15%          → BEARISH
//   ≤ -0.8% + bonds   → BEARISH (confirmed risk-off)
// ---------------------------------------------------------------------------

function determineSentiment(quotes) {
  const spy = quotes['SPY']?.changePct;
  const qqq = quotes['QQQ']?.changePct;
  const iwm = quotes['IWM']?.changePct;
  const ief = quotes['IEF']?.changePct;
  const gld = quotes['GLD']?.changePct;

  if (spy == null || qqq == null) return null;

  // Weighted avg: SPY + QQQ full weight, IWM half weight (breadth confirmation)
  const divisor    = iwm != null ? 2.5 : 2;
  const equityAvg  = (spy + qqq + (iwm != null ? iwm * 0.5 : 0)) / divisor;

  // IWM lagging = narrow rally flag
  const narrowRally = iwm != null && equityAvg > 0.15 && iwm < equityAvg - 0.4;
  const bondsUp     = ief != null && ief > 0.25;
  const goldUp      = gld != null && gld > 0.4;

  if (equityAvg >= 0.8 && !bondsUp && !narrowRally) {
    return { label: 'BULLISH', color: 'emerald', description: 'Broad participation — strong risk-on tape' };
  }
  if (equityAvg >= 0.8 && narrowRally) {
    return { label: 'BULLISH', color: 'emerald', description: 'Large-cap led — small caps lagging, watch breadth' };
  }
  if (equityAvg >= 0.15 && !bondsUp) {
    return { label: 'BULLISH', color: 'emerald', description: narrowRally ? 'Modest upside, narrow breadth' : 'Cautiously positive' };
  }
  if (equityAvg >= 0.15 && bondsUp) {
    return { label: 'NEUTRAL', color: 'amber', description: 'Equities up but bonds bid — mixed signals' };
  }
  if (equityAvg <= -0.8 && bondsUp) {
    return { label: 'BEARISH', color: 'red', description: 'Flight to safety — risk-off confirmed' };
  }
  if (equityAvg <= -0.8 || (equityAvg <= -0.4 && goldUp)) {
    return { label: 'BEARISH', color: 'red', description: 'Broad selling — equities under pressure' };
  }
  if (equityAvg <= -0.15) {
    return { label: 'BEARISH', color: 'red', description: 'Mild selling — watch for follow-through' };
  }
  return { label: 'NEUTRAL', color: 'amber', description: 'No clear directional signal' };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MarketBar() {
  const [quotes, setQuotes]   = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [tnx, setTnx] = useState(null);   // { yield, chg_bps, live, as_of } from the latest pulse
  const intervalRef = useRef(null);

  const fetchQuotes = useCallback(async () => {
    setError(null);
    try {
      const symbols = MARKET_TICKERS.map((t) => t.symbol).join(',');
      const res = await fetch(`/api/quotes?symbols=${symbols}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setQuotes(data);
      try {   // 10-year yield rides in the latest pulse snapshot (optional)
        await authReady();
        const { data: row } = await supabase.from('market_pulse').select('risk')
          .order('as_of', { ascending: false }).limit(1).maybeSingle();
        setTnx(row?.risk?.tnx || null);
      } catch { /* chip falls back to IEF */ }
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(fetchQuotes, 0);   // state updates land in a callback, not the effect body
    // Auto-refresh every 5 minutes
    intervalRef.current = setInterval(fetchQuotes, 5 * 60 * 1000);
    return () => { clearTimeout(first); clearInterval(intervalRef.current); };
  }, [fetchQuotes]);

  const sentiment = determineSentiment(quotes);

  const sentimentStyles = {
    emerald: {
      label:  'text-emerald-400',
      border: 'border-emerald-500/30',
      bg:     'bg-emerald-500/[0.06]',
      dot:    'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]',
      desc:   'text-emerald-300/70',
    },
    red: {
      label:  'text-red-400',
      border: 'border-red-500/30',
      bg:     'bg-red-500/[0.06]',
      dot:    'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]',
      desc:   'text-red-300/70',
    },
    amber: {
      label:  'text-amber-400',
      border: 'border-amber-500/30',
      bg:     'bg-amber-500/[0.06]',
      dot:    'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]',
      desc:   'text-amber-300/70',
    },
  };

  const s = sentiment ? sentimentStyles[sentiment.color] : sentimentStyles.amber;

  return (
    <div className={`rounded-md border ${s.border} ${s.bg} px-4 py-3 mb-8`}>
      <div className="flex items-center justify-between gap-4 flex-wrap">

        {/* Sentiment label — big and prominent */}
        <div className="flex items-center gap-3 shrink-0">
          {loading ? (
            <div className="h-6 w-24 rounded bg-neutral-800 animate-pulse" />
          ) : sentiment ? (
            <>
              <span className={`relative flex h-2.5 w-2.5 shrink-0`}>
                <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${s.dot.split(' ')[0]}`} />
                <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${s.dot}`} />
              </span>
              <div>
                <div className={`font-mono text-[22px] font-bold tracking-[0.15em] leading-none ${s.label}`}>
                  {sentiment.label}
                </div>
                <div className={`text-[11px] mt-0.5 ${s.desc}`}>
                  {sentiment.description}
                </div>
              </div>
            </>
          ) : (
            <div className="font-mono text-[22px] font-bold tracking-[0.15em] text-neutral-600">
              NO DATA
            </div>
          )}
        </div>

        {/* Ticker chips */}
        <div className="flex items-center gap-2 flex-wrap">
          {MARKET_TICKERS.map(({ symbol, label, kind }) => {
            if (kind === 'yield' && tnx?.yield != null) return <YieldChip key={symbol} label={label} t={tnx} />;
            const q = quotes[symbol];
            const pct = q?.changePct ?? null;
            const price = q?.price ?? null;

            const chipColor =
              pct == null  ? 'text-neutral-500 border-neutral-800'
            : pct > 0      ? 'text-emerald-400 border-emerald-500/30'
            : pct < 0      ? 'text-red-400 border-red-500/30'
            :                'text-neutral-400 border-neutral-700';

            return (
              <div
                key={symbol}
                className={`flex items-center gap-1.5 rounded border ${chipColor} bg-neutral-950/60 px-2.5 py-1.5`}
              >
                <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-500">
                  {kind === 'yield' ? 'IEF bonds' : label}
                </span>
                {loading ? (
                  <div className="h-3 w-10 rounded bg-neutral-800 animate-pulse" />
                ) : price != null ? (
                  <span className="font-mono text-[12px] font-semibold tabular-nums">
                    ${price.toFixed(2)}
                    {pct != null && (
                      <span className="ml-1 text-[11px] font-normal">
                        {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="font-mono text-[11px] text-neutral-600">—</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Refresh + timestamp */}
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {lastUpdated && (
            <span className="text-[10px] font-mono text-neutral-700">
              {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            type="button"
            onClick={fetchQuotes}
            disabled={loading}
            className="text-neutral-600 hover:text-neutral-300 transition-colors disabled:opacity-40"
            title="Refresh prices"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} strokeWidth={2} />
          </button>
        </div>

      </div>

      {error && (
        <div className="mt-2 text-[11px] text-red-400/70">
          Price fetch failed: {error}
        </div>
      )}
    </div>
  );
}

// 10-year Treasury yield. Shown in % with the change in basis points; colour is
// neutral on purpose (a rising yield is "up" but usually a headwind for stocks).
function YieldChip({ label, t }) {
  const bps = t.chg_bps;
  const asOf = t.as_of ? new Date(t.as_of).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  const tip = `10-year Treasury yield (CBOE ^TNX), ${t.live ? 'intraday' : 'last close'}${asOf ? `, from the ${asOf} pulse` : ''}. `
    + 'Rising yields are usually a headwind for growth/tech; falling yields a tailwind.';
  return (
    <div title={tip} className="flex items-center gap-1.5 rounded border border-neutral-700 bg-neutral-950/60 px-2.5 py-1.5 text-neutral-200">
      <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-neutral-500">{label}</span>
      <span className="font-mono text-[12px] font-semibold tabular-nums">
        {t.yield.toFixed(3)}%
        {bps != null && (
          <span className={`ml-1 text-[11px] font-normal ${bps > 0 ? 'text-amber-300' : bps < 0 ? 'text-sky-300' : 'text-neutral-400'}`}>
            {bps > 0 ? '▲' : bps < 0 ? '▼' : ''}{Math.abs(bps).toFixed(1)}bp
          </span>
        )}
      </span>
    </div>
  );
}
