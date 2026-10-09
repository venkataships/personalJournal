// "Is the right side of the chart failing?" — 0-5. Mirrors the bot's deterioration.py
// exactly (same rules, same thresholds) so Lookup and Sector Pulse agree.
//
//   lower_highs_lows    last 5 sessions made a lower high AND a lower low than the 5 before
//   declining_emas      8 EMA under the 21 EMA and the 21 falling over 5 sessions
//   failed_ema_bounce   last 5 sessions: came up to the 8 or 21 EMA from below, closed back under it
//   low_volume_bounces  most up days in the last 10 sessions on below-average volume, while in a decline
//   resistance_defended last 5 sessions: traded within 1% of a prior swing high, closed 1.5%+ below it
//
// Labels: 0-1 intact · 2 watch · 3+ deteriorating.

export const DET_SIGNS = ['lower_highs_lows', 'declining_emas', 'failed_ema_bounce', 'low_volume_bounces', 'resistance_defended'];
export const DET_LABELS = {
  lower_highs_lows: 'Lower highs & lows',
  declining_emas: 'Declining 8/21 EMAs',
  failed_ema_bounce: 'Failed bounce into EMA',
  low_volume_bounces: 'Low-volume bounces',
  resistance_defended: 'Sellers defending resistance',
};

export function detLabel(score) {
  if (score == null) return null;
  return score >= 3 ? 'deteriorating' : score === 2 ? 'watch' : 'intact';
}

function emaSeries(vals, span) {
  const out = new Array(vals.length).fill(null);
  if (vals.length < span) return out;
  const k = 2 / (span + 1);
  let e = vals.slice(0, span).reduce((a, b) => a + b, 0) / span;
  out[span - 1] = e;
  for (let i = span; i < vals.length; i++) {
    e = vals[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

function swingHighs(highs, start, end, k = 3) {
  const out = [];
  for (let i = Math.max(k, start); i < Math.min(end, highs.length - k); i++) {
    let top = true;
    for (let j = i - k; j <= i + k; j++) if (highs[j] > highs[i]) { top = false; break; }
    if (top) out.push([i, highs[i]]);
  }
  return out;
}

const ago = (i, n) => (n - 1 - i === 0 ? 'last session' : `${n - i} sessions ago`);
const f2 = (v) => v.toFixed(2);
const sum = (a) => a.reduce((s, v) => s + v, 0);

// bars: [{close, high, low, volume}], oldest first, completed sessions. price: live price (optional).
export function deterioration(bars, price) {
  const n = bars?.length || 0;
  if (n < 31) return null;
  const c = bars.map((b) => b.close), h = bars.map((b) => b.high), l = bars.map((b) => b.low), v = bars.map((b) => b.volume || 0);
  const px = price ?? c[n - 1];
  const e8 = emaSeries(c, 8), e21 = emaSeries(c, 21);
  const signs = {};

  // 1. lower highs & lower lows
  const hNew = Math.max(...h.slice(-5)), hOld = Math.max(...h.slice(-10, -5));
  const lNew = Math.min(...l.slice(-5)), lOld = Math.min(...l.slice(-10, -5));
  if (hNew < hOld && lNew < lOld) signs.lower_highs_lows = `last 5 sessions: high ${f2(hNew)} < ${f2(hOld)}, low ${f2(lNew)} < ${f2(lOld)}`;

  // 2. declining 8/21
  if (e8[n - 1] < e21[n - 1] && e21[n - 6] && e21[n - 1] < e21[n - 6]) {
    const slope = (e21[n - 1] / e21[n - 6] - 1) * 100;
    signs.declining_emas = `8 EMA ${f2(e8[n - 1])} < 21 EMA ${f2(e21[n - 1])}, 21 EMA ${slope >= 0 ? '+' : ''}${slope.toFixed(1)}% over 5 sessions`;
  }

  // 3. failed bounce into the 8 or 21 EMA (from below, last 5 sessions; keep the most recent)
  for (let i = n - 5; i < n; i++) {
    for (const [name, e] of [['21', e21], ['8', e8]]) {
      if (e[i] == null || e[i - 1] == null) continue;
      if (c[i - 1] < e[i - 1] && h[i] >= e[i] * 0.997 && c[i] < e[i]) {
        signs.failed_ema_bounce = `${ago(i, n)}: high ${f2(h[i])} tagged the ${name} EMA (${f2(e[i])}), closed ${f2(c[i])} under it`;
        break;
      }
    }
  }

  // 4. low-volume bounces in a decline
  const up = [];
  for (let i = n - 10; i < n; i++) if (c[i] > c[i - 1]) up.push(i);
  const low = up.filter((i) => { const s = sum(v.slice(i - 20, i)); return v[i] && s && v[i] < 0.85 * (s / 20); });
  const inDecline = px < e21[n - 1] || c[n - 1] < c[n - 11];
  if (inDecline && low.length >= 2 && low.length / Math.max(1, up.length) >= 0.6) {
    signs.low_volume_bounces = `${low.length} of ${up.length} up days in the last 10 sessions on below-average volume`;
  }

  // 5. sellers defending resistance (keep the last match, like the Python)
  const levels = swingHighs(h, n - 45, n - 5).filter(([, p]) => p >= px);
  for (let i = n - 5; i < n; i++) {
    for (const [j, lvl] of levels) {
      if (h[i] >= lvl * 0.99 && c[i] <= lvl * 0.985) {
        signs.resistance_defended = `${ago(i, n)}: traded to ${f2(h[i])} near the ${f2(lvl)} swing high (${ago(j, n)}), closed ${f2(c[i])}`;
      }
    }
  }

  const list = DET_SIGNS.filter((s) => s in signs);
  return { score: list.length, label: detLabel(list.length), signs: list, detail: Object.fromEntries(list.map((s) => [s, signs[s]])) };
}
