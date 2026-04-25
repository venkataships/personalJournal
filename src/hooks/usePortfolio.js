import { useState, useEffect, useCallback } from 'react';
import { supabase, authReady } from '../lib/supabase';

// Pool name in portfolio_config. Scoped to the trading account.
const POOL = 'trading';

// Rule anchors — these are your original discipline limits.
// Caps scale with portfolio but these stay visible as reference.
export const RULE_ANCHORS = {
  independentPositionPct: 0.10, // Rule 6
  discordPositionPct:     0.05, // Rule 6 (Discord)
  maxLossPct:             0.05, // Rule 7
  // Original dollar anchors, for reference display when portfolio > $10k
  anchorIndependent: 1000,
  anchorDiscord:     500,
  anchorMaxLoss:     500,
};

// Statuses that count as "realized" — include their P&L in portfolio value.
const REALIZED_STATUSES = ['closed', 'stopped_out', 'partial'];

async function fetchPortfolio() {
  await authReady();

  const [{ data: cfg, error: cfgErr }, { data: trades, error: tradesErr }] =
    await Promise.all([
      supabase.from('portfolio_config').select('starting_capital').eq('name', POOL).maybeSingle(),
      supabase.from('trade_journal').select('pnl, status').in('status', REALIZED_STATUSES),
    ]);

  if (cfgErr) throw cfgErr;
  if (tradesErr) throw tradesErr;
  if (!cfg) throw new Error(`portfolio_config row "${POOL}" missing. Run the migration SQL.`);

  const startingCapital = Number(cfg.starting_capital) || 0;
  const realizedPnl = (trades || [])
    .reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
  const value = startingCapital + realizedPnl;

  return {
    startingCapital,
    realizedPnl,
    value,
    caps: {
      independent: value * RULE_ANCHORS.independentPositionPct,
      discord:     value * RULE_ANCHORS.discordPositionPct,
      maxLoss:     value * RULE_ANCHORS.maxLossPct,
    },
  };
}

/**
 * Returns portfolio state. Re-fetches on demand via `refresh()` — e.g. after
 * a trade closes. No live subscription; callers decide when freshness matters.
 */
export function usePortfolio() {
  const [state, setState] = useState({
    loading: true,
    error: null,
    value: 0,
    startingCapital: 0,
    realizedPnl: 0,
    caps: { independent: 0, discord: 0, maxLoss: 0 },
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchPortfolio();
      setState({ loading: false, error: null, ...data });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e.message || 'Failed to load portfolio.' }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { ...state, refresh: load };
}
