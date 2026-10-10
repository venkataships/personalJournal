// Position sizing for a planned long entry.
//
// Size comes from the STOP, not from conviction:
//   base risk $  = account × risk %
//   × conditions  (each 1.0 or lower — market gate, deterioration, sector, 8/21 trend, extension)
//   shares        = adjusted risk ÷ (entry − stop)
//   then capped by: per-ticker position cap, daily-stop room left, (options) the options budget.
// Conditions can only shrink a position, never grow it past the base.

const r2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);

// ---------------------------------------------------------------------------
// Stops
// ---------------------------------------------------------------------------
// Candidate stop levels below the price, most "structural" first.
export function stopCandidates(a, setup) {
  if (!a?.price) return [];
  const p = a.price;
  const out = [];
  const add = (key, label, level, why) => {
    if (level == null || !Number.isFinite(level) || level >= p) return;
    if ((p - level) / p < 0.002) return;                 // too tight to be a real stop
    if (out.some((s) => Math.abs(s.level - level) / p < 0.001)) return;
    out.push({ key, label, level: r2(level), why, distPct: r2((p - level) / p * 100), atrs: a.atr ? r2((p - level) / a.atr) : null });
  };
  if (setup?.invalid_below != null) add('setup', 'Setup invalid-below', setup.invalid_below, setup.entry_type === 'retest' ? 'under the retest (Top Setups)' : 'yesterday’s high (Top Setups)');
  add('ema21', '21 EMA', a.ema21, 'trend support');
  add('ema8', '8 EMA', a.ema8, 'tight — strong trends only');
  if (a.support) add('swing', 'Swing low', a.support.p, `nearest swing low (${a.support.d?.slice(5) || ''})`);
  add('pdl', 'Yesterday’s low', a.pdl, 'PDL');
  if (a.atr) add('atr', '1.5 ATR', p - 1.5 * a.atr, 'volatility stop');
  return out;
}

// The stop to start with: the setup level if this is a qualified setup; else the 21 EMA when it's
// within 2.5 ATR; else the nearest swing low; else 1.5 ATR.
export function defaultStop(cands) {
  const by = (k) => cands.find((c) => c.key === k);
  return by('setup') || (by('ema21') && (by('ema21').atrs == null || by('ema21').atrs <= 2.5) ? by('ema21') : null)
    || by('swing') || by('atr') || cands[0] || null;
}

// ---------------------------------------------------------------------------
// Conditions — each returns { key, label, mult, note } or null when unknown
// ---------------------------------------------------------------------------
const GATE = { green: [1, 'SPY/QQQ both trending up'], caution: [0.75, 'only one of SPY/QQQ trending up'], red: [0.5, 'SPY/QQQ not trending up'] };
const PHASE = { Leading: 1, Improving: 1, 'In line': 1, Weakening: 0.75, Lagging: 0.5 };
const TREND = { up: [1, '8 over 21, price above'], mixed: [0.75, 'pulling back / not confirmed'], down: [0.5, 'sellers in control — long against the trend'] };

export function conditions({ a, gate, sector }) {
  const c = [];
  if (gate && GATE[gate]) c.push({ key: 'gate', label: 'Market gate', value: gate, mult: GATE[gate][0], note: GATE[gate][1] });
  if (a?.det) {
    const s = a.det.score;
    const mult = s >= 4 ? 0.25 : s === 3 ? 0.5 : s === 2 ? 0.75 : 1;
    c.push({ key: 'det', label: 'Deterioration', value: `${s}/5`, mult,
      note: s >= 3 ? 'the right side is failing — Playbook: wait' : s === 2 ? 'watch — two warning signs' : 'structure intact' });
  }
  if (sector?.phase) {
    c.push({ key: 'sector', label: 'Sector', value: `${sector.etf ? `${sector.etf} ` : ''}${sector.phase}`, mult: PHASE[sector.phase] ?? 1,
      note: sector.etf ? 'sector ETF vs SPY' : 'no sector ETF — stock vs SPY' });
  }
  if (a?.trend && TREND[a.trend]) c.push({ key: 'trend', label: '8/21 trend', value: a.trend, mult: TREND[a.trend][0], note: TREND[a.trend][1] });
  if (a?.ext21Atr != null) {
    const e = a.ext21Atr;
    const mult = e > 4 ? 0.5 : e > 3 ? 0.75 : 1;
    c.push({ key: 'ext', label: 'Extension', value: `${e} ATR`, mult, note: mult < 1 ? 'far above the 21 EMA — chasing' : 'not extended' });
  }
  return c;
}

export const conditionMult = (conds) => r2(conds.reduce((m, c) => m * c.mult, 1));

// ---------------------------------------------------------------------------
// Stock size
// ---------------------------------------------------------------------------
// opts: { account, riskPct, entry, stop, conds, limits, sameTickerOpen, realizedToday }
export function sizeStock({ account, riskPct, entry, stop, conds = [], limits = {}, sameTickerOpen = 0, realizedToday = 0 }) {
  if (!(account > 0) || !(riskPct > 0) || !(entry > 0) || stop == null || !(stop < entry)) return null;
  const perShare = entry - stop;
  const base = account * riskPct / 100;
  const mult = conditionMult(conds);
  const adj = base * mult;
  const caps = [{ key: 'risk', label: `Risk budget (${riskPct}% × ${Math.round(mult * 100)}%)`, shares: Math.floor(adj / perShare) }];

  const capUsd = limits.max_position_usd != null
    ? Math.min(Number(limits.max_position_usd), limits.max_position_pct != null ? Number(limits.max_position_pct) / 100 * account : Infinity)
    : null;
  if (capUsd != null) {
    const room = Math.max(0, capUsd - sameTickerOpen);
    caps.push({ key: 'position', label: `Position cap $${Math.round(capUsd).toLocaleString()}${sameTickerOpen ? ` (−$${Math.round(sameTickerOpen).toLocaleString()} already open)` : ''}`, shares: Math.floor(room / entry) });
  }
  if (limits.max_daily_loss_usd != null) {
    const room = Math.max(0, Number(limits.max_daily_loss_usd) + Math.min(0, realizedToday));
    caps.push({ key: 'daily', label: `Daily stop room $${Math.round(room).toLocaleString()}`, shares: Math.floor(room / perShare) });
  }
  const binding = caps.reduce((m, c) => (c.shares < m.shares ? c : m), caps[0]);
  const shares = Math.max(0, binding.shares);
  const risk = shares * perShare;
  return {
    perShare: r2(perShare), base: r2(base), mult, adj: r2(adj), caps, binding: binding.key, bindingLabel: binding.label,
    shares, cost: r2(shares * entry), risk: r2(risk), riskPctAccount: r2(risk / account * 100),
    costPctAccount: r2(shares * entry / account * 100),
    target2R: r2(entry + 2 * perShare), target3R: r2(entry + 3 * perShare),
  };
}

// ---------------------------------------------------------------------------
// Options: pick contracts from the chain, size by premium (the premium is the risk)
// ---------------------------------------------------------------------------
const spreadPct = (c) => (c.bid > 0 && c.ask > 0 ? (c.ask - c.bid) / ((c.ask + c.bid) / 2) * 100 : null);

// Liquid enough to get in and out: two-sided market, spread ≤ 10% of mid, open interest ≥ 100.
export function liquid(c) {
  const sp = spreadPct(c);
  return c.ask > 0 && c.bid > 0 && sp != null && sp <= 10 && (c.oi ?? 0) >= 100;
}

// For each expiry: the call nearest 0.70 delta (stock-replacement, less decay) and nearest 0.50 (ATM).
// Without greeks, falls back to strikes ~5% ITM and ATM.
export function pickCalls(chains, price, dteOf) {
  const picks = [];
  for (const [exp, ch] of Object.entries(chains || {})) {
    const calls = (ch.calls || []).filter(liquid);
    const hasDelta = calls.some((c) => c.delta != null);
    const targets = [['itm', 0.7, price * 0.95, 'In the money (~0.70 delta) — moves more like the stock, less time decay'],
      ['atm', 0.5, price, 'At the money (~0.50 delta) — cheaper, needs the move sooner']];
    for (const [kind, d, k, why] of targets) {
      const best = calls.reduce((m, c) => {
        const dist = hasDelta ? (c.delta == null ? Infinity : Math.abs(c.delta - d)) : Math.abs(c.strike - k);
        return dist < m.dist ? { c, dist } : m;
      }, { c: null, dist: Infinity }).c;
      if (best && !picks.some((p) => p.exp === exp && p.strike === best.strike)) {
        const days = dteOf ? dteOf(exp) : null;
        const prem = best.ask;
        picks.push({
          kind, why, exp, dte: days, strike: best.strike, bid: best.bid, ask: best.ask, mid: best.mid, delta: best.delta,
          iv: best.iv, oi: best.oi, volume: best.volume, spreadPct: r2(spreadPct(best)),
          breakeven: r2(best.strike + prem), breakevenPct: r2((best.strike + prem - price) / price * 100),
          thetaDay: best.theta != null ? r2(best.theta * 100) : null,     // $ per contract per day
          perContract: r2(prem * 100), osi: best.osi,
        });
      }
    }
  }
  return picks;
}

export function sizeOption({ account, riskPct, conds = [], perContract, limits = {}, optionsOpen = 0, realizedToday = 0 }) {
  if (!(account > 0) || !(riskPct > 0) || !(perContract > 0)) return null;
  const mult = conditionMult(conds);
  const adj = account * riskPct / 100 * mult;
  const caps = [{ key: 'risk', label: 'Risk budget (whole premium at risk)', n: Math.floor(adj / perContract) }];
  if (limits.max_options_usd != null) {
    const room = Math.max(0, Number(limits.max_options_usd) - optionsOpen);
    caps.push({ key: 'options', label: `Options budget room $${Math.round(room).toLocaleString()}`, n: Math.floor(room / perContract) });
  }
  if (limits.max_daily_loss_usd != null) {
    const room = Math.max(0, Number(limits.max_daily_loss_usd) + Math.min(0, realizedToday));
    caps.push({ key: 'daily', label: `Daily stop room $${Math.round(room).toLocaleString()}`, n: Math.floor(room / perContract) });
  }
  const binding = caps.reduce((m, c) => (c.n < m.n ? c : m), caps[0]);
  const n = Math.max(0, binding.n);
  return { contracts: n, cost: r2(n * perContract), adj: r2(adj), binding: binding.key, bindingLabel: binding.label, caps };
}
