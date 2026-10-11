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

// Entry state of mind — Douglas's "emotions to watch". Required at entry since ruleset v1.
export const STATES = [
  { id: 'calm',      label: 'Calm',       hint: 'Neutral — following the process' },
  { id: 'confident', label: 'Confident',  hint: 'Sure of this one (watch for “need to be right”)' },
  { id: 'fomo',      label: 'FOMO',       hint: 'Afraid to miss it — greed / chasing' },
  { id: 'anxious',   label: 'Anxious',    hint: 'Fear — hesitating, wants to exit early' },
  { id: 'revenge',   label: 'Frustrated', hint: 'Want to win it back — revenge' },
  { id: 'euphoric',  label: 'Euphoric',   hint: 'After wins — tempted to size up' },
];
export const RISKY_STATES = ['fomo', 'revenge', 'euphoric'];

// ---------------------------------------------------------------------------
// Ruleset v1 (frozen Oct 11, 2026). Every trade is tagged with the ruleset it was
// taken under; rules change only at the monthly review. Mirrors journal.RULESET.
// ---------------------------------------------------------------------------
export const RULESET = 'v1';
export const RULESET_SINCE = '2026-10-11';
export const NEXT_REVIEW = '2026-11-08';

// Exit plan, decided before entry. Mirrors journal.EXIT_PRESETS.
//   trim_r     take trim_frac off at this many R (null = no trim)
//   trail      exit the rest on a daily CLOSE under this EMA ('ema8' | 'ema21' | 'none')
//   time_days  out after this many sessions if it hasn't reached +1R (null = no time stop)
export const EXIT_PRESETS = [
  { id: 'standard', label: 'Standard swing', trim_r: 2, trim_frac: 1 / 3, trail: 'ema21', time_days: 5,
    hint: 'Trim ⅓ at 2R · rest exits on a daily close under the 21 EMA · out after 5 sessions if not +1R' },
  { id: 'momentum', label: 'Fast momentum', trim_r: 2, trim_frac: 1 / 3, trail: 'ema8', time_days: 3,
    hint: 'Trim ⅓ at 2R · rest exits on a daily close under the 8 EMA · out after 3 sessions if not +1R' },
  { id: 'runner', label: 'Let it run', trim_r: 3, trim_frac: 1 / 3, trail: 'ema21', time_days: 7,
    hint: 'Trim ⅓ at 3R · rest on a daily close under the 21 EMA · out after 7 sessions if not +1R' },
];
export const TRAIL_LABEL = { ema8: '8 EMA', ema21: '21 EMA', none: 'no trail' };
export const presetPlan = (id) => {
  const p = EXIT_PRESETS.find((x) => x.id === id) || EXIT_PRESETS[0];
  return { preset: p.id, trim_r: p.trim_r, trim_frac: p.trim_frac, trail: p.trail, time_days: p.time_days };
};
export function planText(plan) {
  if (!plan) return 'no exit plan';
  const frac = plan.trim_frac ? `${Math.round(plan.trim_frac * 100)}%` : '';
  return [
    plan.trim_r ? `trim ${frac} at ${plan.trim_r}R` : 'no trim',
    plan.trail && plan.trail !== 'none' ? `rest on a close under the ${TRAIL_LABEL[plan.trail]}` : 'no trail',
    plan.time_days ? `out after ${plan.time_days} sessions if not +1R` : null,
  ].filter(Boolean).join(' · ');
}

// Why a trade was exited. The first five are the plan working; the last three are emotions.
export const EXIT_REASONS = [
  { id: 'stop',        label: 'Stop hit',            plan: true },
  { id: 'trail',       label: 'Trailing rule',       plan: true },
  { id: 'target',      label: 'Trim / target',       plan: true },
  { id: 'time',        label: 'Time stop',           plan: true },
  { id: 'invalidated', label: 'Setup invalidated',   plan: true },
  { id: 'early_fear',  label: 'Got out early (fear)',  plan: false },
  { id: 'held_hope',   label: 'Held past stop (hope)', plan: false },
  { id: 'impulse',     label: 'Impulse / other',      plan: false },
];
export const exitReasonLabel = (id) => EXIT_REASONS.find((x) => x.id === id)?.label ?? id;
export const isPlanExit = (id) => !!EXIT_REASONS.find((x) => x.id === id)?.plan;

// Where an open trade stands against its own exit plan (price-only parts; the trail needs
// daily EMAs, which the bot checks in the AI notes). Mirrors journal.exit_plan_status.
export function exitPlanStatus(t, price, today = todayET()) {
  const plan = t.exit_plan;
  const entry = Number(t.entry_price); const stop = t.stop_loss != null ? Number(t.stop_loss) : null;
  if (!plan || !entry || stop == null || price == null || (t.instrument || 'stock') !== 'stock') return null;
  const short = t.direction === 'short';
  const perR = Math.abs(entry - stop);
  if (!perR) return null;
  const r = ((price - entry) * (short ? -1 : 1)) / perR;
  const sessions = sessionsBetween(t.date, today);
  const out = { r: r2(r), sessions, trimAt: plan.trim_r ? r2(entry + (short ? -1 : 1) * plan.trim_r * perR) : null, items: [] };
  if (r <= -1) out.items.push({ tone: 'bad', text: 'At or past the stop — the plan says exit' });
  if (plan.trim_r && r >= plan.trim_r) out.items.push({ tone: 'good', text: `Trim zone: ${plan.trim_r}R reached (${out.trimAt})` });
  if (plan.time_days && sessions >= plan.time_days && r < 1) out.items.push({ tone: 'warn', text: `Time stop: ${sessions} sessions and not +1R` });
  return out;
}

// Weekday sessions from a to b (holidays not excluded — close enough for a time stop).
export function sessionsBetween(aISO, bISO) {
  if (!aISO || !bISO) return 0;
  let n = 0;
  const d = new Date(`${aISO}T12:00:00Z`); const end = new Date(`${bISO}T12:00:00Z`);
  while (d < end) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n += 1; }
  return n;
}

// ---------------------------------------------------------------------------
// Tilt guards — the patterns Douglas calls fear, hope, revenge and euphoria, read from
// your own journal. Each one needs a written reason, like a limit breach.
// Mirrors journal.tilt_check.
// ---------------------------------------------------------------------------
export const COOL_OFF_MIN = 30;
export function tiltCheck(n, closed, now = new Date()) {
  const flags = [];
  if (!n.ticker) return flags;
  const today = todayET();
  const lossesToday = closed.filter((t) => t.exit_date === today && Number(t.pnl) < 0);
  const lastLoss = lossesToday.map((t) => t.closed_at).filter(Boolean).sort().at(-1);
  if (lastLoss && (now - new Date(lastLoss)) / 60000 < COOL_OFF_MIN) {
    const mins = Math.max(1, Math.round((now - new Date(lastLoss)) / 60000));
    flags.push({ rule: 'cool_off', message: `A loss closed ${mins} min ago — the next trade after a loss is the likeliest revenge trade (${COOL_OFF_MIN}-min cool-off)` });
  }
  if (lossesToday.some((t) => (t.ticker || '').toUpperCase() === n.ticker)) {
    flags.push({ rule: 'reentry', message: `${n.ticker} already lost you money today — re-entering the same day` });
  }
  if (lossesToday.length >= 2) flags.push({ rule: 'two_losses', message: `${lossesToday.length} losing trades today — stop and reset before another` });
  const recent = [...closed].sort((a, b) => (b.closed_at || b.exit_date || '').localeCompare(a.closed_at || a.exit_date || ''));
  const last = recent[0];
  const sizes = recent.slice(0, 10).map((t) => tradeValue(t)).filter((v) => v > 0);
  const value = n.entry_price && n.quantity ? positionValue(n.entry_price, n.quantity, n.instrument) : null;
  if (last && Number(last.pnl) < 0 && value && sizes.length >= 3) {
    const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    if (value > 1.25 * avg) flags.push({ rule: 'size_after_loss', message: `$${fmt0(value)} is ${Math.round((value / avg - 1) * 100)}% bigger than your recent average, right after a loss` });
  }
  if (RISKY_STATES.includes(n.state)) {
    const lbl = STATES.find((x) => x.id === n.state)?.label;
    flags.push({ rule: 'emotion', message: `You tagged ${lbl}. The plan decides, not the feeling — say why this trade is on-plan` });
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Process and edge
// ---------------------------------------------------------------------------
// Process first: of your last N reviewed trades, how many followed the plan; current streak.
export function processStats(trades, n = 20) {
  const reviewed = trades.filter((t) => isClosed(t) && t.followed_plan != null)
    .sort((a, b) => (b.closed_at || b.exit_date || '').localeCompare(a.closed_at || a.exit_date || ''));
  const lastN = reviewed.slice(0, n);
  const followed = lastN.filter((t) => t.followed_plan).length;
  let streak = 0;
  for (const t of reviewed) { if (t.followed_plan) streak += 1; else break; }
  const best = reviewed.reduceRight((acc, t) => {
    const cur = t.followed_plan ? acc.cur + 1 : 0;
    return { cur, best: Math.max(acc.best, cur) };
  }, { cur: 0, best: 0 }).best;
  return { n: lastN.length, followed, pct: lastN.length ? Math.round((followed / lastN.length) * 100) : null, streak, best };
}

// Expectancy over the last `window` closed trades with an R, optionally plan-only.
// range = ±1.96 standard errors — how much the number could be noise.
export function edgeStats(trades, { window = 20, ruleset = RULESET, planOnly = true } = {}) {
  const pool = trades.filter((t) => isClosed(t) && t.r_multiple != null
    && (!ruleset || t.ruleset === ruleset) && (!planOnly || t.followed_plan === true))
    .sort((a, b) => (b.closed_at || b.exit_date || '').localeCompare(a.closed_at || a.exit_date || ''))
    .slice(0, window);
  const rs = pool.map((t) => Number(t.r_multiple));
  const n = rs.length;
  if (!n) return { n: 0 };
  const wins = rs.filter((r) => r > 0); const losses = rs.filter((r) => r <= 0);
  const mean = rs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
  const se = sd != null ? sd / Math.sqrt(n) : null;
  return {
    n, winRate: Math.round((wins.length / n) * 100),
    avgWin: wins.length ? r2(wins.reduce((a, b) => a + b, 0) / wins.length) : null,
    avgLoss: losses.length ? r2(losses.reduce((a, b) => a + b, 0) / losses.length) : null,
    expectancy: r2(mean), low: se != null ? r2(mean - 1.96 * se) : null, high: se != null ? r2(mean + 1.96 * se) : null,
    totalR: r2(rs.reduce((a, b) => a + b, 0)),
    verdict: n < 20 ? 'too_few' : (se != null && mean - 1.96 * se > 0) ? 'positive' : (se != null && mean + 1.96 * se < 0) ? 'negative' : 'unclear',
  };
}


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
  if (snapshot.market?.state) ctx.market_state = snapshot.market.state;
  const picks = snapshot.setups?.picks || [];
  const i = picks.findIndex((p) => p.ticker === ticker);
  if (i >= 0) Object.assign(ctx, { top_setup: true, setup_rank: i + 1, setup_score: picks[i].score, invalid_below: picks[i].invalid_below });
  const q = (snapshot.setups?.all || []).find((r) => r.ticker === ticker);
  if (q && i < 0) Object.assign(ctx, { qualified: true, setup_score: q.score, invalid_below: q.invalid_below });
  const putTrend = (m) => {
    for (const k of ['ema_trend', 'retest', 'retest_level']) if (m[k] != null) ctx[k] = m[k];
  };
  for (const g of snapshot.groups || []) {
    const m = (g.members || []).find((x) => x.ticker === ticker);
    if (m) {
      Object.assign(ctx, {
        group: g.name, phase: m.quadrant, pd_event: m.pd_event, pd_state: m.pd_state, pdh: m.pdh, rs5: m.rs5,
        sector_etf: g.ref?.symbol, sector_phase: g.ref?.quadrant,
      });
      putTrend(m);
      return ctx;
    }
  }
  const p = i >= 0 ? picks[i] : q;
  if (p) {
    Object.assign(ctx, { group: p.source, phase: p.quadrant, sector_etf: p.sector_etf, sector_phase: p.sector_phase, pdh: p.pdh });
    putTrend(p);
  }
  return ctx;
}

// Market -> Sector -> Leader -> Level -> Break -> Retest -> 8/21 (same as journal.prefill_checklist)
export const CHECKLIST = [
  { id: 'market', label: 'Market', hint: 'SPY & QQQ trending up (daily 8 EMA over 21)' },
  { id: 'sector', label: 'Sector', hint: 'Sector ETF leading or improving vs SPY' },
  { id: 'leader', label: 'Leader', hint: 'The stock itself leading or improving vs SPY' },
  { id: 'level',  label: 'Level',  hint: 'Marked level with the stop at it' },
  { id: 'break',  label: 'Break',  hint: 'Broke the level (above PDH) — no break, no trade' },
  { id: 'retest', label: 'Retest', hint: 'Entered on the pullback to the level that held, not the first push' },
  { id: 'ema',    label: '8/21',   hint: 'Daily 8 EMA over 21, price above — buyers in control' },
];
const STRONG = ['Leading', 'Improving'];

export function prefillChecklist(ctx, stopLoss, direction = 'long') {
  const c = ctx || {};
  const out = Object.fromEntries(CHECKLIST.map((x) => [x.id, null]));
  out.level = stopLoss != null;
  if (direction === 'short') return out;
  if (c.market_state) out.market = c.market_state === 'green';
  if (c.sector_phase) out.sector = STRONG.includes(c.sector_phase);
  if (c.phase) out.leader = STRONG.includes(c.phase);
  if (c.pd_state || c.retest) out.break = Boolean(c.retest) || c.pd_state === 'above';
  if ('ema_trend' in c || 'pd_state' in c) out.retest = Boolean(c.retest);
  if (c.ema_trend) out.ema = c.ema_trend === 'up';
  return out;
}

export function checklistScore(cl) {
  if (!cl) return null;
  return CHECKLIST.filter((x) => cl[x.id] === true).length;
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
    byExit: groupBy((t) => t.exit_reason || null),
    byRuleset: groupBy((t) => t.ruleset || 'before v1'),
    byChecklist: groupBy((t) => {
      const n = checklistScore(t.checklist);
      return n == null ? null : n === 7 ? '7/7 — full checklist' : n >= 5 ? '5–6 of 7' : '4 or fewer';
    }),
    byEntry: groupBy((t) => {
      const c = t.checklist || {};
      return c.retest === true ? 'Entered on a retest' : c.break === true ? 'Entered on the break' : null;
    }),
    mistakes: [...mistakes.values()].sort((a, b) => a.pnl - b.pnl),
    discipline: {
      withStop: pct(all.filter((t) => t.stop_loss != null).length, all.length),
      withWhy: pct(all.filter((t) => (t.thesis || '').trim()).length, all.length),
      reviewed: pct(closed.filter((t) => t.followed_plan != null).length, closed.length),
      logged: all.length,
    },
  };
}
