import { useState, useCallback, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  AlertCircle,
  Sunrise,
  Radar,
  Activity,
  RefreshCw,
  Square,
  Settings,
  Check,
} from 'lucide-react';
import { supabase, authReady } from '../../lib/supabase';
import { anthropic, CLAUDE_MODEL } from '../../lib/claude';

// ---------------------------------------------------------------------------
// System prompts — exact mirrors of bot prompts
// ---------------------------------------------------------------------------

const SYSTEM_MORNING = `You are MARCO, a morning intelligence agent for a catalyst-driven swing trader.
Trading style: 2-10 day holds, sector momentum confirmation, catalyst-driven entries.
Be direct and specific. No fluff. Dollar amounts always included.
Format with emojis and clear sections. Mobile-friendly output.`;

const SYSTEM_SECTOR = `You are SCOUT, a sector rotation analyst for a swing trader.
Your job: identify which sectors have momentum today and whether the trader's
positioning aligns with or fights the tape.
Be specific about tickers, not generic about sectors.`;

const SYSTEM_PULSE = `You are a watchlist intelligence agent for a swing trader.
Your job: cut through the noise and identify the 2-3 most actionable
setups from today's watchlist movers.
Be ruthlessly specific. One sentence per ticker max.`;

// ---------------------------------------------------------------------------
// Data fetching — mirrors bot's Supabase queries exactly
// ---------------------------------------------------------------------------

async function fetchAll() {
  await authReady();
  const [posRes, optRes, catRes, wlRes, cashRes] = await Promise.all([
    supabase
      .from('positions')
      .select('ticker, shares, avg_cost, account_type')
      .order('shares', { ascending: false }),
    supabase
      .from('options_positions')
      .select('ticker, strike, expiry, type, contracts, premium_per_contract, notes')
      .eq('status', 'open'),
    supabase
      .from('catalysts')
      .select('headline, sector, tickers_affected, strength, expires_at, added_at, days_active')
      .eq('is_active', true)
      .gt('expires_at', new Date().toISOString()),
    supabase
      .from('watchlist')
      .select('ticker, thesis, sentiment, category, timeframe, stage, tags')
      .eq('is_active', true)
      .order('category'),
    supabase
      .from('cash_balance')
      .select('amount')
      .eq('account_type', 'taxable')
      .maybeSingle(),
  ]);

  if (posRes.error)  throw posRes.error;
  if (optRes.error)  throw optRes.error;
  if (catRes.error)  throw catRes.error;
  if (wlRes.error)   throw wlRes.error;
  if (cashRes.error) throw cashRes.error;

  return {
    positions: posRes.data  || [],
    options:   optRes.data  || [],
    catalysts: catRes.data  || [],
    watchlist: wlRes.data   || [],
    cash:      cashRes.data?.amount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Live price fetching — Public API via /api/quotes serverless function.
// Returns mid = (bid+ask)/2 per quote.py logic. Just price for now.
// Map<ticker, { price, mid, last, bid, ask }>
// ---------------------------------------------------------------------------

async function fetchPrices(tickers) {
  if (!tickers.length) return new Map();
  const unique  = [...new Set(tickers.map((t) => t.toUpperCase()))];
  const symbols = unique.join(',');

  try {
    const res = await fetch(`/api/quotes?symbols=${symbols}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Quote fetch HTTP ${res.status}: ${err.error || ''}`);
    }
    const data = await res.json();
    const map  = new Map();
    for (const [sym, q] of Object.entries(data)) {
      if (!q || !q.price) continue;
      map.set(sym.toUpperCase(), {
        price:             q.price,  // mid if available, last otherwise
        mid:               q.mid    ?? null,
        last:              q.last   ?? null,
        bid:               q.bid    ?? null,
        ask:               q.ask    ?? null,
        // Change % fields — null until confirmed working
        sessionChangePct:  null,
        extendedChangePct: null,
        isExtendedHours:   false,
      });
    }
    return map;
  } catch (e) {
    console.warn('Price fetch failed:', e.message);
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// Prompt builders — format Supabase rows into readable text blocks
// ---------------------------------------------------------------------------

function daysUntil(isoString) {
  if (!isoString) return '?';
  const diff = new Date(isoString) - new Date();
  const days = Math.ceil(diff / 86_400_000);
  return days <= 0 ? 'expired' : `${days}d`;
}

function fmtPositions(positions) {
  if (!positions.length) return 'No open positions.';
  return positions
    .map((p) => {
      const basis = (Number(p.shares) || 0) * (Number(p.avg_cost) || 0);
      return `${p.ticker}: ${p.shares} shares @ $${Number(p.avg_cost).toFixed(2)} (basis $${basis.toFixed(0)}) [${p.account_type}]`;
    })
    .join('\n');
}

function fmtOptions(options) {
  if (!options.length) return 'No open options.';
  const today = new Date();
  return options
    .map((o) => {
      const expiry = new Date(o.expiry);
      const daysLeft = Math.ceil((expiry - today) / 86_400_000);
      const urgentFlag = daysLeft <= 7 ? ' ⚠️ URGENT' : '';
      const totalCost = (Number(o.premium_per_contract) || 0) * (Number(o.contracts) || 0) * 100;
      return `${o.ticker} $${o.strike}${o.type[0].toUpperCase()} exp ${o.expiry} x${o.contracts} @ $${Number(o.premium_per_contract || 0).toFixed(2)}/ct (cost $${totalCost.toFixed(0)})${urgentFlag}${o.notes ? ` | ${o.notes}` : ''}`;
    })
    .join('\n');
}

function fmtCatalysts(catalysts) {
  if (!catalysts.length) return 'No active catalysts.';
  return catalysts
    .map((c) => {
      const days = daysUntil(c.expires_at);
      return `[${c.strength?.toUpperCase() || 'MEDIUM'}] ${c.headline} | Sector: ${c.sector || 'N/A'} | Tickers: ${c.tickers_affected || 'N/A'} | ${days} remaining`;
    })
    .join('\n');
}

function fmtWatchlistSummary(watchlist) {
  if (!watchlist.length) return 'No watchlist entries.';
  const byCategory = {};
  for (const w of watchlist) {
    const cat = w.category || 'Uncategorized';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(`${w.ticker} (${w.sentiment}, ${w.stage || 'n/a'})`);
  }
  return Object.entries(byCategory)
    .map(([cat, tickers]) => `${cat}: ${tickers.join(', ')}`)
    .join('\n');
}

function fmtWatchlistByCategory(watchlist) {
  if (!watchlist.length) return 'Empty watchlist.';
  const byCategory = {};
  for (const w of watchlist) {
    const cat = w.category || 'Uncategorized';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(
      `  ${w.ticker} | ${w.sentiment} | ${w.stage || 'N/A'} | ${w.timeframe || 'N/A'} | ${w.thesis?.slice(0, 60) || 'No thesis'}…`
    );
  }
  return Object.entries(byCategory)
    .map(([cat, rows]) => `${cat.toUpperCase()}:\n${rows.join('\n')}`)
    .join('\n\n');
}

function fmtTickersByCategory(watchlist, category) {
  return watchlist
    .filter((w) => (w.category || '').toLowerCase() === category.toLowerCase())
    .map((w) => w.ticker)
    .join(', ') || 'None';
}

function buildMorningPrompt(d) {
  return `Generate a morning portfolio intelligence brief using this live data:

ACTIVE CATALYSTS:
${fmtCatalysts(d.catalysts)}

PORTFOLIO POSITIONS:
${fmtPositions(d.positions)}

OPEN OPTIONS:
${fmtOptions(d.options)}

WATCHLIST SUMMARY:
${fmtWatchlistSummary(d.watchlist)}

CASH BALANCE: $${Number(d.cash).toFixed(2)}

Structure your brief:

🔬 ACTIVE CATALYSTS
- List each with days remaining, strength, and which held positions are affected
- Flag if any catalyst ticker is unusually active today

📊 PORTFOLIO OVERVIEW
- Total cost basis, estimated value (use avg_cost × shares as proxy)
- Top 3 positions by size
- Any positions with thesis concerns

⏰ OPTIONS DESK
- Positions expiring within 7 days — URGENT flag
- Any deep ITM shorts at risk

🎯 FOCUS FOR TODAY
- 2-3 specific things to watch based on catalysts + positioning
- Be specific: ticker, price level, what to look for

Keep it tight. This is a pre-market brief, not a report.`;
}

// ---------------------------------------------------------------------------
// Shared sector heat builder — used by both Sector Analysis and Pulse.
// Macro pinned first, then hottest → coldest for the rest.
// ---------------------------------------------------------------------------

function buildSectorHeatBlock(watchlist, priceMap) {
  const byCategory = {};
  for (const w of watchlist) {
    const cat = w.category || 'Uncategorized';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(w.ticker);
  }

  const priceLine = (ticker) => {
    const q = priceMap?.get(ticker.toUpperCase());
    if (!q || q.price == null) return null;
    return `${ticker} $${q.price.toFixed(2)}`;
  };

  const rows = Object.entries(byCategory).map(([cat, tickers]) => {
    const tickerLines = tickers.map(priceLine).filter(Boolean).join(' | ');
    const priceCount  = tickers.filter((t) => priceMap?.get(t.toUpperCase())?.price != null).length;
    return { cat, avg: null, tickerLines, count: tickers.length, priceCount };
  });

  // Macro pinned first, rest alpha (no avg to sort by — % coming later)
  // Skip thin groups (under 3 tickers)
  const macro  = rows.find((r) => r.cat.toLowerCase() === 'macro' && r.count >= 2);
  const others = rows
    .filter((r) => r.cat.toLowerCase() !== 'macro' && r.count >= 3)
    .sort((a, b) => a.cat.localeCompare(b.cat));

  // Top 5 and bottom 5 — arbitrary split for now, sorted alpha
  const top5    = others.slice(0, 5);
  const bottom5 = others.slice(-5).filter((r) => !top5.includes(r));
  const selected = [...top5, ...bottom5];

  const ordered = macro ? [macro, ...selected] : selected;

  return ordered
    .map(({ cat, tickerLines, count }) =>
      `${cat.toUpperCase()} (${count} tickers)\n  ${tickerLines || '(no price data)'}`)
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Compact one-line group summary — used as the header line in Pulse
// ---------------------------------------------------------------------------

function buildGroupSummaryLine(watchlist, priceMap) {
  const byCategory = {};
  for (const w of watchlist) {
    const cat = w.category || 'Uncategorized';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(w.ticker);
  }

  const cats = [...new Set(watchlist.map((w) => w.category || 'Uncategorized'))];
  const macro  = cats.find((c) => c.toLowerCase() === 'macro');
  const others = cats.filter((c) => c.toLowerCase() !== 'macro').sort();
  const ordered = macro ? [macro, ...others] : others;
  return ordered
    .map((cat) => {
      const count = watchlist.filter((w) => (w.category || 'Uncategorized') === cat).length;
      return `${cat} (${count})`;
    })
    .join(' | ');
}

function buildSectorPrompt(d, priceMap, selectedGroups) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  });

  // Filter watchlist to selected groups only
  const focused = selectedGroups.length > 0
    ? d.watchlist.filter((w) => selectedGroups.includes(w.category || 'Uncategorized'))
    : d.watchlist;

  // Build group blocks for selected groups only
  const byCategory = {};
  for (const w of focused) {
    const cat = w.category || 'Uncategorized';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(w);
  }

  const groupBlocks = Object.entries(byCategory).map(([cat, items]) => {
    const tickers = items.map((w) => {
      const q = priceMap?.get(w.ticker.toUpperCase());
      if (!q || q.price == null) return `${w.ticker} (no price)`;
      return `${w.ticker} $${q.price.toFixed(2)}`;
    }).join(', ');

    const changes = items
      .map((w) => {
        const q = priceMap?.get(w.ticker.toUpperCase());
        return q?.extendedChangePct ?? q?.sessionChangePct ?? null;
      })
      .filter((c) => c != null && Number.isFinite(c));
    const avg = changes.length ? changes.reduce((s, c) => s + c, 0) / changes.length : null;
    const avgStr = avg != null ? `avg ${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%` : 'no price data';

    return `${cat.toUpperCase()} (${items.length} tickers, ${avgStr})\n  ${tickers}`;
  }).join('\n\n');

  // Also include macro group for context even if not selected
  const macroItems = d.watchlist.filter((w) => (w.category || '').toLowerCase() === 'macro');
  const macroBlock = macroItems.length > 0 ? (() => {
    const tickers = macroItems.map((w) => {
      const q = priceMap?.get(w.ticker.toUpperCase());
      if (!q || q.price == null) return w.ticker;
      return `${w.ticker} $${q.price.toFixed(2)}`;
    }).join(', ');
    return `MACRO: ${tickers}`;
  })() : '';

  return `Sector-focused analysis for ${today}.

MACRO CONTEXT (always include regardless of focus):
${macroBlock || 'No macro tickers in watchlist.'}

MY FOCUSED GROUPS (with live prices):
${groupBlocks || 'No data for selected groups.'}

ACTIVE CATALYSTS (for context):
${fmtCatalysts(d.catalysts)}

You are a sector analyst with access to real-time market knowledge up to your training cutoff.
For each of my focused groups above:
1. Use the live prices I provided to assess today's price action
2. Apply YOUR OWN knowledge: what is happening in this sector today? Recent news, macro tailwinds/headwinds, earnings, regulatory moves, institutional flows — anything relevant you know about
3. Tell me if my watchlist price action CONFIRMS or CONTRADICTS the broader sector narrative you know about

Produce exactly this format:

📊 SECTOR ANALYSIS — ${today}

🌐 MACRO READ
[Risk-on or risk-off today based on the macro tickers? One sentence.]

${Object.keys(byCategory).map(cat => `🔍 ${cat.toUpperCase()}
[Price action: what my tickers show today]
[Your context: what you know about this sector/news/macro right now — be specific, name catalysts, earnings, regulatory events, macro drivers]
[Signal: bullish / bearish / neutral — and why]`).join('\n\n')}

⚡ HIGHEST CONVICTION CALL
[Based on price action + your sector knowledge, the single best setup right now. Ticker, price, why today specifically.]`;
}


function buildPulsePrompt(d, priceMap) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
  });

  // Note market context for Claude
  const marketContext = 'Prices are current mid (bid/ask average) from Public API.';

  // Compact one-liner for the header
  const groupSummary = buildGroupSummaryLine(d.watchlist, priceMap);

  // Full heat block for the detailed breakdown
  const heatBlock = buildSectorHeatBlock(d.watchlist, priceMap);

  // All tickers with prices — sorted by price descending for now
  // (change % ranking will be re-enabled once price feed is confirmed stable)
  const allWithPrices = d.watchlist
    .map((w) => {
      const q = priceMap.get(w.ticker.toUpperCase());
      if (!q || q.price == null) return null;
      return {
        ticker: w.ticker,
        cat:    w.category || 'Uncategorized',
        price:  q.price,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.price - a.price);

  const top7    = allWithPrices.slice(0, 7);
  const bottom7 = allWithPrices.slice(-7).reverse();

  const rankLine = (x) =>
    `${x.ticker} $${x.price.toFixed(2)} [${x.cat}]`;

  const gainersBlock = top7.length    ? top7.map(rankLine).join('\n')    : 'No data';
  const losersBlock  = bottom7.length ? bottom7.map(rankLine).join('\n') : 'No data';

  return `Watchlist market pulse for ${today}.
${marketContext}

GROUP SUMMARY (Macro first, then hottest → coldest):
${groupSummary}

FULL GROUP BREAKDOWN:
${heatBlock}

TOP 7 GAINERS TODAY:
${gainersBlock}

TOP 7 LOSERS TODAY:
${losersBlock}

Produce exactly this format — tight, no filler:

📊 WATCHLIST PULSE — ${today}

🌐 GROUP HEAT (Macro first)
[One line per group: name, avg % change, 1-2 notable tickers. Macro always first.]
[Call out any group where the entire group is green or red — real sector move.]
[3-5 lines total — skip thin groups with 1-2 tickers.]

🟢 TOP GAINERS
[Each of the top 7: ticker +X.X% [group] — one sentence on why.]

🔴 TOP LOSERS
[Each of the bottom 7: ticker -X.X% [group] — one sentence on why.]

⚡ ONE SETUP
[The single most interesting ticker today. One sentence. Specific price level.]`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const BRIEFS = [
  {
    id: 'morning',
    label: 'Morning Brief',
    sublabel: 'Portfolio + catalysts + options desk',
    icon: Sunrise,
    system: SYSTEM_MORNING,
    buildPrompt: buildMorningPrompt,
    color: 'emerald',
  },
  {
    id: 'sector',
    label: 'Sector Analysis',
    sublabel: 'Catalyst-driven sector rotation',
    icon: Radar,
    system: SYSTEM_SECTOR,
    buildPrompt: buildSectorPrompt,
    color: 'sky',
  },
  {
    id: 'pulse',
    label: 'Watchlist Pulse',
    sublabel: 'Actionable setups from the watchlist',
    icon: Activity,
    system: SYSTEM_PULSE,
    buildPrompt: buildPulsePrompt,
    color: 'amber',
  },
];

// Per-brief state shape: { status: 'idle'|'loading'|'streaming'|'done'|'error', text: string, error: string }
const IDLE = { status: 'idle', text: '', error: '' };

export default function Intelligence() {
  const [dataError, setDataError] = useState(null);
  const [briefs, setBriefs] = useState({
    morning: { ...IDLE },
    sector:  { ...IDLE },
    pulse:   { ...IDLE },
  });
  const abortRefs = useRef({});

  // Sector Analysis: selected groups — loaded from Supabase, saved on change
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [allGroups, setAllGroups] = useState([]);
  const [groupSelectorOpen, setGroupSelectorOpen] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(true);

  // Load available groups + saved preferences on mount
  useEffect(() => {
    (async () => {
      await authReady();
      const [wlRes, prefRes] = await Promise.all([
        supabase.from('watchlist').select('category').eq('is_active', true),
        supabase.from('user_preferences').select('value').eq('key', 'sector_analysis_groups').maybeSingle(),
      ]);
      if (wlRes.data) {
        const cats = [...new Set(wlRes.data.map((r) => r.category || 'Uncategorized'))].sort();
        setAllGroups(cats);
        // Default to all groups if no preference saved yet
        const saved = prefRes.data?.value;
        setSelectedGroups(Array.isArray(saved) ? saved : cats);
      }
      setGroupsLoading(false);
    })();
  }, []);

  const saveSelectedGroups = useCallback(async (groups) => {
    setSelectedGroups(groups);
    await authReady();
    await supabase.from('user_preferences').upsert({
      key: 'sector_analysis_groups',
      value: groups,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
  }, []);

  const setBrief = useCallback((id, patch) => {
    setBriefs((prev) => {
      const next = typeof patch === 'function' ? patch(prev[id]) : { ...prev[id], ...patch };
      return { ...prev, [id]: next };
    });
  }, []);

  const run = useCallback(async (brief) => {
    // Cancel any in-flight stream for this brief
    abortRefs.current[brief.id]?.abort();
    const controller = new AbortController();
    abortRefs.current[brief.id] = controller;

    setBrief(brief.id, { status: 'loading', text: '', error: '' });
    setDataError(null);

    let data;
    try {
      data = await fetchAll();
    } catch (e) {
      setBrief(brief.id, { status: 'error', error: e.message || 'Failed to load data.' });
      setDataError(e.message || 'Supabase fetch failed.');
      return;
    }

    setBrief(brief.id, { status: 'streaming', text: '' });

    try {
      // Fetch live prices for Pulse and Sector Analysis — both use group heat.
      // Morning Brief doesn't need prices.
      let priceMap = new Map();
      if ((brief.id === 'pulse' || brief.id === 'sector') && data.watchlist.length > 0) {
        const tickers = data.watchlist.map((w) => w.ticker);
        priceMap = await fetchPrices(tickers);
      }

      // Sector Analysis needs more tokens — large watchlists hit 1024 easily.
      const maxTokens = brief.id === 'sector' ? 2048 : 1024;

      const stream = anthropic.messages.stream({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system: brief.system,
        messages: [{
          role: 'user',
          content: brief.id === 'sector'
            ? brief.buildPrompt(data, priceMap, selectedGroups)
            : (brief.id === 'pulse')
            ? brief.buildPrompt(data, priceMap)
            : brief.buildPrompt(data),
        }],
      });

      for await (const event of stream) {
        if (controller.signal.aborted) break;
        if (
          event.type === 'content_block_delta' &&
          event.delta?.type === 'text_delta'
        ) {
          setBrief(brief.id, (prev) => ({
            ...prev,
            text: prev.text + event.delta.text,
          }));
        }
      }

      if (!controller.signal.aborted) {
        setBrief(brief.id, { status: 'done' });
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setBrief(brief.id, {
          status: 'error',
          error: e.message || 'Stream failed.',
        });
      }
    }
  }, [setBrief]);

  const stop = useCallback((id) => {
    abortRefs.current[id]?.abort();
    setBrief(id, { status: 'done' });
  }, [setBrief]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(abortRefs.current).forEach((c) => c.abort());
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 font-sans antialiased selection:bg-emerald-500/30">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <div className="relative mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        {/* Header */}
        <header className="mb-10">
          <Link
            to="/trading"
            className="inline-flex items-center gap-1.5 mb-3 text-[11px] uppercase tracking-[0.22em] text-neutral-500 hover:text-emerald-400 transition-colors"
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={2} />
            Trading
          </Link>
          <h1 className="text-3xl font-light tracking-tight text-neutral-100 sm:text-4xl">
            Intelligence
          </h1>
          <p className="mt-1.5 text-sm text-neutral-500">
            Live briefs from your Supabase data. Each runs independently.
          </p>

          {dataError && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[13px] text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span className="break-all">{dataError}</span>
            </div>
          )}
        </header>

        {/* Brief cards */}
        <div className="space-y-10">
          {BRIEFS.map((brief) => (
            <div key={brief.id}>
              {/* Group selector — only for sector brief */}
              {brief.id === 'sector' && (
                <GroupSelector
                  allGroups={allGroups}
                  selectedGroups={selectedGroups}
                  loading={groupsLoading}
                  open={groupSelectorOpen}
                  onToggle={() => setGroupSelectorOpen((v) => !v)}
                  onChange={saveSelectedGroups}
                />
              )}
              <BriefCard
                brief={brief}
                state={briefs[brief.id]}
                onRun={() => run(brief)}
                onStop={() => stop(brief.id)}
              />
            </div>
          ))}
        </div>

        <footer className="mt-16 text-center font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-700">
          Know before you act.
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group selector — shown above Sector Analysis card
// ---------------------------------------------------------------------------

function GroupSelector({ allGroups, selectedGroups, loading, open, onToggle, onChange }) {
  const selectedCount = selectedGroups.length;
  const allSelected  = selectedCount === allGroups.length;

  const toggle = (group) => {
    const next = selectedGroups.includes(group)
      ? selectedGroups.filter((g) => g !== group)
      : [...selectedGroups, group];
    onChange(next);
  };

  const toggleAll = () => {
    onChange(allSelected ? [] : [...allGroups]);
  };

  return (
    <div className="mb-3 rounded-md border border-neutral-800 bg-neutral-950/60">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-[12px] text-neutral-400 hover:text-neutral-200 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Settings className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span className="uppercase tracking-[0.15em]">Focus groups</span>
          {!loading && (
            <span className="font-mono text-[10px] text-neutral-600">
              {selectedCount}/{allGroups.length} selected
            </span>
          )}
        </div>
        <span className="text-neutral-600 text-[10px]">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-neutral-800 px-4 py-3">
          {loading ? (
            <div className="text-[12px] text-neutral-600">Loading groups…</div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <div className="text-[11px] text-neutral-500">
                  Select which groups Sector Analysis focuses on
                </div>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-[11px] text-sky-400 hover:text-sky-300 transition-colors"
                >
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {allGroups.map((group) => {
                  const active = selectedGroups.includes(group);
                  return (
                    <button
                      key={group}
                      type="button"
                      onClick={() => toggle(group)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.1em] transition-all ${
                        active
                          ? 'border-sky-500/60 bg-sky-500/10 text-sky-200'
                          : 'border-neutral-800 text-neutral-600 hover:border-neutral-600 hover:text-neutral-400'
                      }`}
                    >
                      {active && <Check className="h-3 w-3" strokeWidth={2.5} />}
                      {group}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brief card
// ---------------------------------------------------------------------------

const COLOR_MAP = {
  emerald: {
    dot:     'bg-emerald-500 shadow-emerald-500/70',
    border:  'border-emerald-500/50',
    bg:      'bg-emerald-500/10',
    text:    'text-emerald-200',
    icon:    'text-emerald-400',
    hover:   'hover:bg-emerald-500/15 hover:border-emerald-500/70',
    cursor:  'bg-emerald-400',
  },
  sky: {
    dot:     'bg-sky-500 shadow-sky-500/70',
    border:  'border-sky-500/50',
    bg:      'bg-sky-500/10',
    text:    'text-sky-200',
    icon:    'text-sky-400',
    hover:   'hover:bg-sky-500/15 hover:border-sky-500/70',
    cursor:  'bg-sky-400',
  },
  amber: {
    dot:     'bg-amber-500 shadow-amber-500/70',
    border:  'border-amber-500/50',
    bg:      'bg-amber-500/10',
    text:    'text-amber-200',
    icon:    'text-amber-400',
    hover:   'hover:bg-amber-500/15 hover:border-amber-500/70',
    cursor:  'bg-amber-400',
  },
};

function BriefCard({ brief, state, onRun, onStop }) {
  const c = COLOR_MAP[brief.color];
  const Icon = brief.icon;
  const isActive = state.status === 'loading' || state.status === 'streaming';
  const hasOutput = state.text.length > 0;

  return (
    <section className="rounded-md border border-neutral-800 bg-neutral-950/40 overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
        <div className="flex items-center gap-3">
          {isActive ? (
            <span className="relative inline-flex h-2 w-2">
              <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${c.dot.split(' ')[0]}`} />
              <span className={`relative inline-flex h-2 w-2 rounded-full shadow-[0_0_8px] ${c.dot}`} />
            </span>
          ) : (
            <Icon className={`h-4 w-4 ${c.icon}`} strokeWidth={1.75} />
          )}
          <div>
            <div className="text-[14px] font-medium text-neutral-100">{brief.label}</div>
            <div className="text-[11px] text-neutral-500">{brief.sublabel}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Stop button while streaming */}
          {isActive && (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex items-center gap-1.5 rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-[11px] text-neutral-400 hover:text-neutral-200 hover:border-neutral-600 transition-colors"
            >
              <Square className="h-3 w-3" strokeWidth={2} />
              Stop
            </button>
          )}
          {/* Run / Re-run button */}
          <button
            type="button"
            onClick={onRun}
            disabled={isActive}
            className={`inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-[12px] font-medium uppercase tracking-[0.12em] transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed ${c.border} ${c.bg} ${c.text} ${c.hover}`}
          >
            {state.status === 'done' || state.status === 'error' ? (
              <><RefreshCw className="h-3.5 w-3.5" strokeWidth={2} /> Re-run</>
            ) : state.status === 'loading' ? (
              <>Fetching data…</>
            ) : state.status === 'streaming' ? (
              <>Streaming…</>
            ) : (
              <>Run</>
            )}
          </button>
        </div>
      </div>

      {/* Output */}
      {state.status === 'error' && (
        <div className="px-5 py-4 text-[13px] text-red-300 flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span>{state.error}</span>
        </div>
      )}

      {state.status === 'loading' && !hasOutput && (
        <div className="px-5 py-6 text-[13px] text-neutral-500 animate-pulse">
          Fetching your positions, options, catalysts, and watchlist…
        </div>
      )}

      {hasOutput && (
        <div className="px-5 py-5">
          <StreamOutput
            text={state.text}
            streaming={state.status === 'streaming'}
            cursorColor={c.cursor}
          />
        </div>
      )}

      {state.status === 'idle' && (
        <div className="px-5 py-6 text-center text-[13px] text-neutral-600">
          Press Run to generate.
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Streaming text renderer — renders markdown-like output as formatted text
// ---------------------------------------------------------------------------

function StreamOutput({ text, streaming, cursorColor }) {
  const endRef = useRef(null);

  // Auto-scroll as text streams in
  useEffect(() => {
    if (streaming) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [text, streaming]);

  // Very light formatting: bold on **text**, newlines preserved, no full
  // markdown parser dependency — these briefs are emoji+text, not complex markdown.
  const formatted = text
    .split('\n')
    .map((line, i) => {
      // Bold: **text**
      const parts = line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={j} className="text-neutral-100">{part.slice(2, -2)}</strong>
          : part
      );
      return <p key={i} className={line.trim() === '' ? 'mt-3' : 'leading-relaxed'}>{parts}</p>;
    });

  return (
    <div className="font-mono text-[13px] text-neutral-300 whitespace-pre-wrap leading-relaxed">
      {formatted}
      {streaming && (
        <span
          className={`inline-block w-[7px] h-[14px] ml-0.5 translate-y-[2px] animate-pulse rounded-sm ${cursorColor}`}
        />
      )}
      <div ref={endRef} />
    </div>
  );
}
