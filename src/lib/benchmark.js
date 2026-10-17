// Matched benchmark for the paper book: the same dollars, in QQQ, over the same days.
// Pure functions; bars are daily [{ d, o, h, l, c }] oldest→newest (from /api/bars).
//
// Approximations (stated on the page): QQQ "entry" = the entry day's OPEN (trades enter from 10:00 ET,
// so this is slightly generous to neither side); QQQ "exit" = the close of the exit/trim day.

export const BENCH = 'QQQ';

const round2 = (v) => Math.round(v * 100) / 100;

export function barOn(bars, day) {
  return (bars || []).find((b) => b.d === day) || null;
}

// Last bar on or before `day` (handles weekends / missing bars).
function closeOnOrBefore(bars, day) {
  let hit = null;
  for (const b of bars || []) {
    if (b.d <= day) hit = b; else break;
  }
  return hit ? hit.c : null;
}

// QQQ P&L for one trade's dollars. Position cost = shares × entry_price; a trim is benchmarked on the
// trimmed shares up to the trim day, the rest up to the exit day (or the last bar for an open trade).
export function tradeBenchmark(t, bars) {
  const entryBar = barOn(bars, t.entry_day);
  if (!entryBar) return null;
  const q0 = entryBar.o;
  const E = Number(t.entry_price);
  const N = Number(t.shares);
  const last = bars[bars.length - 1];
  const endDay = t.status === 'closed' ? t.exit_day : last?.d;
  const q1 = endDay ? closeOnOrBefore(bars, endDay) : null;
  if (!q0 || q1 == null || !E || !N) return null;
  let pnl = 0;
  let rest = N;
  if (t.trim_day && t.trim_shares) {
    const qt = closeOnOrBefore(bars, t.trim_day);
    if (qt != null) {
      pnl += t.trim_shares * E * (qt / q0 - 1);
      rest -= t.trim_shares;
    }
  }
  pnl += rest * E * (q1 / q0 - 1);
  return round2(pnl);
}

// Closed trades only. Returns null when nothing can be compared yet.
export function matchedBenchmark(trades, bars, account) {
  const rows = [];
  for (const t of trades) {
    if (t.status !== 'closed' || t.pnl == null) continue;
    const q = tradeBenchmark(t, bars);
    if (q == null) continue;
    rows.push({ t, sys: Number(t.pnl), qqq: q });
  }
  if (!rows.length) return null;
  const sys = round2(rows.reduce((a, r) => a + r.sys, 0));
  const qqq = round2(rows.reduce((a, r) => a + r.qqq, 0));
  const beat = rows.filter((r) => r.sys > r.qqq).length;
  return {
    n: rows.length,
    sys, qqq, excess: round2(sys - qqq), beat,
    sysPct: account ? round2((sys / account) * 100) : null,
    qqqPct: account ? round2((qqq / account) * 100) : null,
  };
}

// QQQ bought with the whole account on the first entry day and simply held to the latest bar.
export function holdAll(firstDay, bars, account) {
  const b0 = barOn(bars, firstDay);
  const last = bars?.[bars.length - 1];
  if (!b0 || !last || !account) return null;
  const ret = last.c / b0.o - 1;
  return { pct: round2(ret * 100), usd: round2(account * ret), from: firstDay, to: last.d };
}
