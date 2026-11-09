// "Undercut ✓" — same rule as the bot's focus.py, computed in the browser from today's 15-min bars
// (/api/intraday), so the focus list can refresh faster than the 15-minute pulse.
//   opening print = first bar's open · morning low = lowest low of the first OR minutes (30 = two bars)
//   undercut = morning low at least 0.4% below the open · reclaim (after the opening range) = a bar closes above the open
//   or VWAP (whichever is lower) on rising volume: more than the previous bar AND >= the average of the bars
//   since the opening range · invalidation = the morning low.

const etParts = (iso) => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso));
  const h = Number(p.find((x) => x.type === 'hour').value);
  const m = Number(p.find((x) => x.type === 'minute').value);
  return { mins: h * 60 + m - 570, hm: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
};
const r2 = (v) => Math.round(v * 100) / 100;
const MIN_FLUSH_PCT = 0.4;

export function undercut(barsIn, orMinutes = 30) {
  if (!barsIn?.length) return { status: 'no_data' };
  const bars = [...barsIn].sort((a, b) => a.t.localeCompare(b.t)).map((b) => ({ ...b, ...etParts(b.t) }));
  const open = bars[0].o;
  const orBars = bars.filter((b) => b.mins < orMinutes);
  const after = bars.filter((b) => b.mins >= orMinutes);
  const lowBar = (orBars.length ? orBars : bars.slice(0, 1)).reduce((a, b) => (b.l < a.l ? b : a));
  const low = lowBar.l;
  const last = bars[bars.length - 1];
  let pv = 0; let vol = 0;
  const vwapAt = bars.map((b) => { pv += ((b.h + b.l + b.c) / 3) * b.v; vol += b.v; return vol ? pv / vol : null; });
  const out = {
    open: r2(open), morning_low: r2(low), low_at: lowBar.hm, price: r2(last.c), or_minutes: orMinutes,
    vwap: vwapAt[vwapAt.length - 1] != null ? r2(vwapAt[vwapAt.length - 1]) : null,
    risk_pct: last.c ? r2(((last.c - low) / last.c) * 100) : null, last_bar: last.hm,
  };
  if (!after.length) return { ...out, status: 'forming' };
  // Nov 9: a dip under the open smaller than 0.4% is not a flush
  out.flush_pct = open ? r2(((open - low) / open) * 100) : null;
  if (low >= open || out.flush_pct < MIN_FLUSH_PCT) return { ...out, status: 'held_open' };
  let status = 'watching';
  const idx0 = bars.length - after.length;
  for (let j = 0; j < after.length; j++) {
    const b = after[j];
    const i = idx0 + j;
    if (status === 'watching') {
      if (b.l < low) return { ...out, status: 'broke_low', broke_at: b.hm };
      const vwap = vwapAt[i];
      const levels = [open, vwap].filter((x) => x != null);
      const earlier = after.slice(0, j).map((x) => x.v);
      const avg = earlier.length ? earlier.reduce((a, x) => a + x, 0) / earlier.length : 0;
      const rising = b.v > bars[i - 1].v && b.v >= avg;
      // Nov 9: a reclaim needs a real cross: this bar opened, or the previous bar closed, at or under the level
      const lvl = levels.length ? Math.min(...levels) : null;
      const crossed = lvl != null && (b.o <= lvl || bars[i - 1].c <= lvl);
      if (crossed && b.c > lvl && rising) {
        const above = [['open', open], ['VWAP', vwap]].filter(([, x]) => x != null && b.c > x).map(([n]) => n);
        status = 'undercut_ok';
        Object.assign(out, { reclaim_at: b.hm, reclaim_level: above.join(' + '), reclaim_price: r2(b.c),
          reclaim_vol_x: avg ? r2(b.v / avg) : null });
      }
    } else if (b.l < low) {
      return { ...out, status: 'failed', failed_at: b.hm };
    }
  }
  return { ...out, status };
}
