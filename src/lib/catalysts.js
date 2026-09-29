// Rule-based catalyst reader: pulls dates, tickers and themes out of a line of
// text so a catalyst can be saved without an AI call. Always shown as an
// editable preview before saving — it's a first guess, not the truth.

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11,
};
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const ORD = '(?:st|nd|rd|th)?';
const TO = '\\s*(?:-|–|—|to|through|thru|until)\\s*';

// Company names people type -> ticker. Extend freely.
export const NAME_TO_TICKER = {
  nvidia: 'NVDA', amd: 'AMD', 'advanced micro devices': 'AMD', micron: 'MU', intel: 'INTC', arm: 'ARM',
  sandisk: 'SNDK', 'sk hynix': 'SKHY', hynix: 'SKHY', broadcom: 'AVGO', tsmc: 'TSM', 'taiwan semi': 'TSM',
  qualcomm: 'QCOM', marvell: 'MRVL', teradyne: 'TER', navitas: 'NVTS', supermicro: 'SMCI', 'super micro': 'SMCI',
  apple: 'AAPL', microsoft: 'MSFT', google: 'GOOG', alphabet: 'GOOG', amazon: 'AMZN', aws: 'AMZN', meta: 'META',
  facebook: 'META', netflix: 'NFLX', tesla: 'TSLA', optimus: 'TSLA', oracle: 'ORCL', palantir: 'PLTR',
  coreweave: 'CRWV', vertiv: 'VRT', oklo: 'OKLO', 'nuscale': 'SMR', cameco: 'CCJ', centrus: 'LEU',
  ionq: 'IONQ', rigetti: 'RGTI', 'd-wave': 'QBTS', 'rocket lab': 'RKLB', 'ast spacemobile': 'ASTS',
  coinbase: 'COIN', microstrategy: 'MSTR', strategy: null, 'joby': 'JOBY', archer: 'ACHR',
  'symbotic': 'SYM', 'intuitive surgical': 'ISRG', serve: 'SERV', 'richtech': 'RR',
};

// Keywords -> theme (same names as the watchlist categories / pulse groups).
export const THEME_KEYWORDS = {
  robotics: ['robot', 'robotics', 'humanoid', 'embodied', 'physical ai', 'autonomous', 'optimus', 'automation'],
  'ai-infra': ['data center', 'datacenter', 'gpu', 'inference', 'ai infrastructure', 'hyperscaler', 'cluster', 'gtc'],
  semis: ['semiconductor', 'chip', 'foundry', 'wafer', 'semis'],
  memory: ['hbm', 'dram', 'nand', 'memory', 'ssd'],
  nuclear: ['nuclear', 'smr', 'uranium', 'reactor', 'fission', 'fusion'],
  quantum: ['quantum', 'qubit'],
  space: ['space', 'satellite', 'launch', 'rocket', 'orbit'],
  crypto: ['bitcoin', 'crypto', 'ethereum', 'stablecoin', 'etf approval'],
  defense: ['defense', 'defence', 'military', 'pentagon', 'drone'],
  photonics: ['photonics', 'optical', 'co-packaged', 'silicon photonics', 'transceiver'],
  power: ['power grid', 'utility', 'electricity', 'energy storage', 'battery'],
  'big-tech': ['keynote', 'developer conference', 'wwdc', 'ignite', 're:invent', 'google i/o'],
  macro: ['fomc', 'fed ', 'cpi', 'jobs report', 'nfp', 'rate decision', 'powell'],
};

function iso(y, m, d) {
  const dt = new Date(Date.UTC(y, m, d));
  if (dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return null; // 31 Feb etc.
  return dt.toISOString().slice(0, 10);
}

// Year when none is typed: this year, or next year if that date is >60 days in the past.
function guessYear(m, d, today) {
  const y = today.getUTCFullYear();
  const cand = Date.UTC(y, m, d);
  return cand < today.getTime() - 60 * 86400000 ? y + 1 : y;
}

export function parseDates(text, today = new Date()) {
  const t = text.toLowerCase();
  const mo = (s) => MONTHS[s.slice(0, 3) === 'sep' ? 'sep' : s.slice(0, 3)] ?? MONTHS[s];
  const yr = (y, m, d) => (y ? Number(y.length === 2 ? `20${y}` : y) : guessYear(m, d, today));
  const tries = [
    // 20th to 22nd October 2026 · 20-22 Oct
    [new RegExp(`\\b(\\d{1,2})${ORD}${TO}(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MON}\\.?,?\\s*(\\d{4})?`), (x) => {
      const m = mo(x[3]); const y = yr(x[4], m, +x[1]); return [iso(y, m, +x[1]), iso(y, m, +x[2])];
    }],
    // October 20-22, 2026 · Oct 20 to 22
    [new RegExp(`\\b${MON}\\.?\\s+(\\d{1,2})${ORD}${TO}(\\d{1,2})${ORD},?\\s*(\\d{4})?`), (x) => {
      const m = mo(x[1]); const y = yr(x[4], m, +x[2]); return [iso(y, m, +x[2]), iso(y, m, +x[3])];
    }],
    // Oct 30 - Nov 2
    [new RegExp(`\\b${MON}\\.?\\s+(\\d{1,2})${ORD}${TO}${MON}\\.?\\s+(\\d{1,2})${ORD},?\\s*(\\d{4})?`), (x) => {
      const m1 = mo(x[1]); const m2 = mo(x[3]); const y = yr(x[5], m1, +x[2]);
      return [iso(y, m1, +x[2]), iso(m2 < m1 ? y + 1 : y, m2, +x[4])];
    }],
    // October 20, 2026 · Oct 20
    [new RegExp(`\\b${MON}\\.?\\s+(\\d{1,2})${ORD}\\b,?\\s*(\\d{4})?`), (x) => {
      const m = mo(x[1]); const y = yr(x[3], m, +x[2]); const d = iso(y, m, +x[2]); return [d, d];
    }],
    // 20th October 2026 · 20 Oct
    [new RegExp(`\\b(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MON}\\.?,?\\s*(\\d{4})?`), (x) => {
      const m = mo(x[2]); const y = yr(x[3], m, +x[1]); const d = iso(y, m, +x[1]); return [d, d];
    }],
    // 10/20/2026 · 10/20 (US month/day)
    [/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (x) => {
      const m = +x[1] - 1; const y = yr(x[3], m, +x[2]); const d = iso(y, m, +x[2]); return [d, d];
    }],
  ];
  for (const [re, fn] of tries) {
    const x = t.match(re);
    if (x) {
      const [start, end] = fn(x);
      if (start) return { start, end: end && end >= start ? end : start };
    }
  }
  return { start: null, end: null };
}

const BARE_STOP = new Set(['ON', 'IT', 'AI', 'GO', 'SO', 'UP', 'BE', 'AT', 'AN', 'AS', 'BY', 'IN', 'IS', 'OR',
  'TO', 'US', 'WE', 'OF', 'NO', 'DO', 'ME', 'MY', 'OK', 'PM', 'AM', 'TV', 'PC', 'UK', 'EU', 'AR', 'VR', 'EV', 'ALL', 'ARE', 'NOW', 'ONE', 'CAN', 'HAS', 'NEW', 'FOR', 'BIG', 'OPEN', 'REAL', 'CEO',
  'CFO', 'GTC', 'FDA', 'DOE', 'SEC', 'IPO', 'ETF', 'USA', 'CPI', 'GDP', 'FOMC', 'AGI', 'LLM', 'EPS', 'API']);

// known: tickers the user tracks (watchlist + pulse), so bare "NVDA" / "MU" are picked up.
export function parseTickers(text, known = new Set()) {
  const out = new Set();
  for (const m of text.matchAll(/\$([A-Za-z]{1,5})\b/g)) out.add(m[1].toUpperCase());
  const lower = ` ${text.toLowerCase()} `;
  for (const [name, tk] of Object.entries(NAME_TO_TICKER)) {
    if (!tk) continue;
    const re = new RegExp(`[^a-z]${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:'s)?[^a-z]`);
    if (re.test(lower)) out.add(tk);
  }
  // Bare symbols: 2+ letters and not an everyday word ($P / $ON still work).
  for (const m of text.matchAll(/\b([A-Z]{2,5})\b/g)) if (known.has(m[1]) && !BARE_STOP.has(m[1])) out.add(m[1]);
  return [...out];
}

export function parseThemes(text) {
  const lower = ` ${text.toLowerCase()} `;
  return Object.entries(THEME_KEYWORDS)
    .filter(([, words]) => words.some((w) => lower.includes(w)))
    .map(([theme]) => theme);
}

export function headlineOf(text) {
  const first = text.trim().split(/(?<=[.!?])\s+/)[0];
  return first.length <= 110 ? first : `${first.slice(0, 107).trimEnd()}…`;
}

export function parseCatalyst(text, known, today = new Date()) {
  const dates = parseDates(text, today);
  return {
    headline: headlineOf(text),
    notes: text.trim(),
    event_start: dates.start,
    event_end: dates.end,
    tickers: parseTickers(text, known),
    themes: parseThemes(text),
    strength: 'medium',
  };
}

// Days from today (ET date string) to an ISO date. Negative = past.
export function daysUntil(isoDate, todayISO) {
  if (!isoDate) return null;
  return Math.round((Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${todayISO}T00:00:00Z`)) / 86400000);
}

export function whenLabel(c, todayISO) {
  const s = daysUntil(c.event_start, todayISO);
  const e = daysUntil(c.event_end || c.event_start, todayISO);
  if (s == null) return 'no date';
  if (s > 1) return `in ${s} days`;
  if (s === 1) return 'tomorrow';
  if (e >= 0) return s === 0 && e === 0 ? 'today' : 'happening now';
  return `${-e}d ago`;
}

// Catalysts touching a ticker (directly, or through its theme/group) within `days`.
export function catalystsFor(ticker, themesOfTicker, list, todayISO, days = 21) {
  return list.filter((c) => {
    const s = daysUntil(c.event_start, todayISO);
    const e = daysUntil(c.event_end || c.event_start, todayISO);
    if (s == null || s > days || e < 0) return false;
    const direct = (c.tickers || []).includes(ticker);
    const viaTheme = (c.themes || []).some((t) => themesOfTicker.includes(t));
    return direct || viaTheme;
  });
}

export function rowToCatalyst(r) {
  return {
    ...r,
    tickers: (r.tickers_affected || '').split(',').map((t) => t.trim().toUpperCase()).filter(Boolean),
    themes: r.themes || [],
  };
}
