// Journal rules — mirrors portfolio-agent/journal.py so the dashboard and the
// Telegram /log command agree on P&L, R and risk flags.

export const SETUPS = [
  { id: 'top_setup',    label: 'Top Setup' },
  { id: 'pdh_breakout', label: 'PDH breakout' },
  { id: 'catalyst',     label: 'Catalyst' },
  { id: 'discord',      label: 'Discord alert' },
  { id: 'other',        label: 'Other' },
];
export const setupLabel = (id) => SETUPS.find((s) => s.id === id)?.label ?? (id || '—');

export const MISTAKES = [
  { id: 'oversized',             label: 'Oversized' },
  { id: 'no_stop',               label: 'No stop' },
  { id: 'moved_stop',            label: 'Moved stop' },
  { id: 'chased_entry',          label: 'Chased entry' },
  { id: 'averaged_down',         label: 'Averaged down' },
  { id: 'held_through_earnings', label: 'Held through earnings' },
  { id: 'revenge_trade',         label: 'Revenge trade' },
  { id: 'cut_winner_early',      label: 'Cut winner early' },
];
export const mistakeLabel = (id) => MISTAKES.find((m) => m.id === id)?.label ?? id;

export const STATES = [
  { id: 'calm',      label: 'Calm' },
  { id: 'confident', label: 'Confident' },
  { id: 'fomo',      label: 'FOMO' },
  { id: 'anxious',   label: 'Anxious' },
  { id: 'revenge',   label: 'Frustrated' },
];

export const DEFAULT_LIMITS = {
  max_position_usd: 5000, max_position_pct: 5, max_options_usd: 10000, max_daily_loss_usd: 1500, no_trade: [],
};

const r2 = (n) => Math.round(n * 100) / 100;
export const multiplier = (instrument) => (instrument === 'option' ? 100 : 1);
export const positionValue = (entry, qty, instrument) => r2(Math.abs(entry * qty) * multiplier(instrument));
export const computePnl = (entry, exit, qty, direction, instrument) =>
  r2((exit - entry) * qty * multiplier(instrument) * (direction === 'short' ? -1 : 1));
export function riskAmount(entry, stop, qty, instrument) {
  if (stop == null || entry == null || !qty) return null;
  const r = Math.abs(entry - stop) * qty * multiplier(instrument);
  return r > 0 ? r2(r) : null;
}
export const rMultiple = (pnl, risk) => (risk ? r2(pnl / risk) : null);
export function closeStatus(direction, exit, stop) {
  if (stop != null && ((direction !== 'short' && exit <= stop) || (direction === 'short' && exit >= stop))) return 'stopped_out';
  return 'closed';
}

export function positionCap(limits, accountValue) {
  const usd = Number(limits.max_position_usd);
  if (accountValue > 0) return r2(Math.min(usd, (Number(limits.max_position_pct) / 100) * accountValue));
  return usd;
}

export function tradeValue(t) {
  if (t.position_size != null) return Math.abs(Number(t.position_size));
  if (t.entry_price != null && t.quantity != null) return positionValue(Number(t.entry_price), Number(t.quantity), t.instrument || 'stock');
  return 0;
}

export const isClosed = (t) => ['closed', 'stopped_out', 'partial'].includes(t.status);

// Every rule a new trade would break. Same rules as journal.risk_check.
export function riskCheck(limits, accountValue, openTrades, closedToday, n) {
  const flags = [];
  if (!n.ticker || !n.entry_price || !n.quantity) return flags;
  const cap = positionCap(limits, accountValue);
  const value = positionValue(n.entry_price, n.quantity, n.instrument);
  const same = openTrades.filter((t) => (t.ticker || '').toUpperCase() === n.ticker).reduce((s, t) => s + tradeValue(t), 0);
  if (value + same > cap) {
    flags.push({ rule: 'position_size', message: `$${fmt0(value)}${same ? ` (plus $${fmt0(same)} already open)` : ''} is over the $${fmt0(cap)} per-ticker cap` });
  }
  if (n.instrument === 'option') {
    const opts = openTrades.filter((t) => t.instrument === 'option').reduce((s, t) => s + tradeValue(t), 0);
    const max = Number(limits.max_options_usd);
    if (opts + value > max) flags.push({ rule: 'options_budget', message: `Options would be $${fmt0(opts + value)}, over the $${fmt0(max)} budget` });
  }
  const realized = closedToday.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
  const maxLoss = Number(limits.max_daily_loss_usd);
  if (realized <= -maxLoss) flags.push({ rule: 'daily_stop', message: `Already down $${fmt0(-realized)} today — past the $${fmt0(maxLoss)} daily stop` });
  if (n.stop_loss == null) flags.push({ rule: 'no_stop', message: 'No stop / invalidation level' });
  if ((limits.no_trade || []).map((t) => t.toUpperCase()).includes(n.ticker)) {
    flags.push({ rule: 'no_trade', message: `${n.ticker} is on your no-trade list` });
  }
  return flags;
}

// Sector Pulse read for a ticker (same as journal.pulse_context).
export function pulseContext(snapshot, ticker) {
  if (!snapshot) return null;
  const ctx = { snapshot_as_of: snapshot.as_of, session: snapshot.session, top_setup: false };
  const picks = snapshot.setups?.picks || [];
  const i = picks.findIndex((p) => p.ticker === ticker);
  if (i >= 0) Object.assign(ctx, { top_setup: true, setup_rank: i + 1, setup_score: picks[i].score, invalid_below: picks[i].invalid_below });
  for (const g of snapshot.groups || []) {
    const m = (g.members || []).find((x) => x.ticker === ticker);
    if (m) {
      return Object.assign(ctx, {
        group: g.name, phase: m.quadrant, pd_event: m.pd_event, pd_state: m.pd_state, pdh: m.pdh, rs5: m.rs5,
        sector_etf: g.ref?.symbol, sector_phase: g.ref?.quadrant,
      });
    }
  }
  if (i >= 0) {
    const p = picks[i];
    Object.assign(ctx, { group: p.source, phase: p.quadrant, sector_etf: p.sector_etf, sector_phase: p.sector_phase, pdh: p.pdh });
  }
  return ctx;
}

export function fmt0(n) {
  return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
export function usd(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return '—';
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${n < 0 ? '-' : ''}$${s}`;
}
export function signedUsd(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n > 0 ? '+' : ''}${usd(n, digits)}`;
}
export function daysAgoET(days) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() - days * 86400000));
}
export function todayET() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

// ---------------------------------------------------------------------------
// Stats for the review section
// ---------------------------------------------------------------------------

function summarize(trades) {
  const n = trades.length;
  const wins = trades.filter((t) => Number(t.pnl) > 0).length;
  const pnl = trades.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
  const rs = trades.map((t) => t.r_multiple).filter((r) => r != null).map(Number);
  return {
    n, wins, winRate: n ? Math.round((wins / n) * 100) : null, pnl: r2(pnl),
    avgR: rs.length ? r2(rs.reduce((a, b) => a + b, 0) / rs.length) : null,
  };
}

export function journalStats(trades, sinceISO) {
  const closed = trades.filter((t) => isClosed(t) && (!sinceISO || (t.exit_date || t.date) >= sinceISO));
  const all = trades.filter((t) => !sinceISO || (t.date || '') >= sinceISO);
  const groupBy = (keyFn) => {
    const m = new Map();
    for (const t of closed) {
      const k = keyFn(t);
      if (k == null) continue;
      m.set(k, [...(m.get(k) || []), t]);
    }
    return [...m.entries()].map(([k, ts]) => ({ key: k, ...summarize(ts) })).sort((a, b) => b.n - a.n);
  };
  const mistakes = new Map();
  for (const t of closed) {
    for (const mk of t.mistakes || []) {
      const cur = mistakes.get(mk) || { key: mk, n: 0, pnl: 0 };
      cur.n += 1; cur.pnl = r2(cur.pnl + (Number(t.pnl) || 0));
      mistakes.set(mk, cur);
    }
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  return {
    overall: summarize(closed),
    bySetup: groupBy((t) => t.setup || 'other'),
    bySystem: groupBy((t) => (t.pulse_context ? (t.pulse_context.top_setup ? 'Top Setup' : ['Leading', 'Improving'].includes(t.pulse_context.phase) ? 'Pulse strong' : 'Against / no signal') : 'No pulse data')),
    byRules: groupBy((t) => ((t.risk_flags || []).length ? 'Broke a rule at entry' : 'Within limits')),
    byPlan: groupBy((t) => (t.followed_plan == null ? null : t.followed_plan ? 'Followed plan' : 'Broke plan')),
    byState: groupBy((t) => t.emotional_state || null),
    mistakes: [...mistakes.values()].sort((a, b) => a.pnl - b.pnl),
    discipline: {
      withStop: pct(all.filter((t) => t.stop_loss != null).length, all.length),
      withWhy: pct(all.filter((t) => (t.thesis || '').trim()).length, all.length),
      reviewed: pct(closed.filter((t) => t.followed_plan != null).length, closed.length),
      logged: all.length,
    },
  };
}
