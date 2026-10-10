import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';

// How the system works, end to end. Every number here mirrors the code
// (sector_pulse.py, intraday.py, deterioration.py, pulse_events.py, ai_notes.py,
// src/lib/sizing.js, src/lib/journal.js). Change a rule → change it here in the same commit.

const TOC = [
  ['Start here', [['overview', 'What this is'], ['flow', 'How data moves'], ['day', 'Your day']]],
  ['Pages', [['sectors', 'Sectors'], ['lookup', 'Lookup'], ['plan', 'Plan a trade'], ['ai-notes', 'AI notes'],
    ['playbook', 'Playbook'], ['journal', 'Journal'], ['watchlist', 'Watchlist'], ['other-pages', 'Home, Dashboard, Positions, Intelligence, Prep']]],
  ['Rules', [['pdh', 'PDH / PDL events'], ['retest', 'Retest'], ['ema', '8/21 trend'], ['phase', 'Phase vs SPY'], ['gate', 'Market gate'],
    ['setups', 'Top Setups score'], ['det', 'Deterioration'], ['volume', 'Volume & streaks'], ['events', 'Event rules'],
    ['sizing', 'Sizing multipliers'], ['limits', 'Risk limits'], ['checklist', 'Journal checklist']]],
  ['Honesty', [['limits-of', 'What it can’t tell you']]],
];

export default function Guide() {
  const { hash } = useLocation();
  // Contents start open on desktop (sidebar), collapsed on a phone.
  const [wide] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    if (!hash) return undefined;
    const id = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' }), 50);
    return () => clearTimeout(id);
  }, [hash]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 antialiased">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8 lg:grid lg:grid-cols-[200px_1fr] lg:gap-10">
        <nav aria-label="Guide sections" className="mb-6 lg:sticky lg:top-16 lg:mb-0 lg:max-h-[calc(100vh-5rem)] lg:self-start lg:overflow-y-auto">
          <details className="rounded-md border border-neutral-800 lg:border-0" open={wide}>
            <summary className="cursor-pointer px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-neutral-500 lg:hidden">Contents</summary>
            <div className="px-3 pb-3 lg:px-0">
              {TOC.map(([group, items]) => (
                <div key={group} className="mt-3 first:mt-0">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-neutral-600">{group}</div>
                  {items.map(([id, label]) => (
                    <a key={id} href={`#${id}`} className="block py-0.5 text-[12px] text-neutral-400 hover:text-emerald-300">{label}</a>
                  ))}
                </div>
              ))}
            </div>
          </details>
        </nav>

        <main className="min-w-0 max-w-3xl">
          <header className="mb-6">
            <h1 className="flex items-center gap-2.5 text-3xl font-light tracking-tight text-neutral-100">
              <Compass className="h-6 w-6 text-emerald-400" strokeWidth={1.5} /> Guide
            </h1>
            <p className="mt-1 text-[13px] text-neutral-500">How the system works end to end, and the exact rules behind every chip and number.</p>
          </header>

          <S id="overview" title="What this is">
            <P>A manual swing-trading system for 2–10 day holds, long-biased. It follows one process: <B>market → sector → leader → level → break → retest → 8/21 → risk</B>. The bot measures; the dashboard shows; <B>you decide</B>. Nothing places a trade, and the AI never gives buy/sell calls — it explains what your own rules say.</P>
            <P>Three parts: a <B>bot</B> on a Google Cloud server (Python, runs the numbers and the Telegram commands), <B>Supabase</B> (the database everything reads and writes), and this <B>dashboard</B> (Vercel).</P>
          </S>

          <S id="flow" title="How data moves">
            <Flow steps={[
              ['Prices', 'Public: live quotes and 15-min bars. Yahoo: daily history (cached).'],
              ['Bot, every 15 min', 'Scores every watchlist + group ticker, SPY/QQQ, sector ETFs. ~Every 30 min pre-market (4am) and after hours (to 8pm). Weekdays only.'],
              ['Snapshot', 'One row in market_pulse. Everything on Sectors and Lookup reads the same snapshot.'],
              ['Events + AI', 'Rules spot big moves; Claude Haiku writes the brief and notes from those numbers.'],
              ['You', 'Sectors → Lookup → Plan a trade → Journal.'],
            ]} />
            <P><B>Recalculate</B> on Sectors asks the bot for a fresh snapshot; it picks the request up within about a minute. Lookup is different: it pulls a year of daily bars for any ticker straight from Public and computes in your browser, with the live price merged in every minute (pre-market included).</P>
          </S>

          <S id="day" title="Your day">
            <Steps items={[
              ['Pre-market', <>Sectors: the market gate and the AI brief (one line each, minimized by default). Check catalysts. Look up any gapper in <L to="/lookup">Lookup</L> — it shows the live pre-market price.</>],
              ['9:30–10:00', <>Don’t act on the first push. Breakouts on Top Setups show as “Break only” until they pull back; ~ means provisional until the close. Options spreads are widest now.</>],
              ['~10:00–11:00', <>The 15-min retest check has data. Pick from Top Setups with a <B>held retest</B>, open the ticker in Lookup, size it in <A to="plan">Plan a trade</A>, then <B>Log trade</B>.</>],
              ['Midday', <>AI notes flag big moves on your open trades and groups. Check at set times (say 10:30, 1:00, 3:30) — the system doesn’t need watching.</>],
              ['Close', <>Journal: close trades, fill the review. The checklist score and R go into your stats.</>],
              ['Weekend', <>Journal stats (by checklist score, retest vs break). Study traders’ rules → <L to="/playbook">Playbook</L>.</>],
            ]} />
          </S>

          <S id="sectors" title="Sectors">
            <Page answers="Is the market and my sectors worth trading today, and which names are setting up?"
              data="The latest market_pulse snapshot (every 15 min in market hours)." />
            <Defs items={[
              ['Market gate', <>SPY and QQQ trend, with each index’s PDH/PDL, break and retest. Sets a score penalty for every setup. <A to="gate">Rules</A></>],
              ['AI brief', <>Stance + headline; expand for positions, opportunities, watch levels. <A to="ai-notes">How it’s written</A></>],
              ['Top Setups', <>Top 5 qualified PDH breakouts/retests; “Show all” lists every qualified name (sortable, with Det). <A to="setups">Score</A></>],
              ['Group cards', <>Your pulse groups ranked vs SPY: sector ETF strip, then each ticker’s 1/5/20-day return, vs SPY, PDH/PDL event, phase, 8/21, Det, volume.</>],
              ['Catalysts', <>Type an event (“NVDA GTC Oct 20-22”); tickers with one inside 3 weeks get a ⚡ tag across the page. Read by rules, no AI.</>],
              ['Rotation map', <>Groups plotted by 5-day vs 20-day strength against SPY — the phase quadrants.</>],
            ]} />
          </S>

          <S id="lookup" title="Lookup">
            <Page answers="Everything about one ticker, whether or not it’s in your system."
              data="A year of Public daily bars + live quote (every minute pre-market and intraday); computed in the browser with the same rules as the bot." />
            <Defs items={[
              ['The read', 'Plain-English lines: trend, long-term (200-day), vs SPY, extension in ATRs, RSI, N-day high/low, EMA pullback, 52-week high, deterioration, risk.'],
              ['Chart', '8 EMA (blue), 21 EMA (orange), 50-day (green); N-day high/low and 52-week high lines. Change N above the chart.'],
              ['Cards', 'Moving averages, range, yesterday’s range, volatility (ATR), momentum & volume, vs SPY, deterioration, swing levels.'],
              ['In your system', 'Whether it’s in a group or today’s qualified setups, catalysts, and any open trade.'],
            ]} />
          </S>

          <S id="plan" title="Plan a trade (on Lookup)">
            <P>“I want to buy this — how much?” Size comes from <B>where you’re wrong</B>, not from how good it looks.</P>
            <Formula>shares = account × risk % × conditions ÷ (entry − stop), then capped by your limits</Formula>
            <Defs items={[
              ['Stop', 'Pick one: setup invalid-below (Top Setups), 21 EMA, 8 EMA, nearest swing low, yesterday’s low, 1.5 ATR, or type your own. Default: the setup level, else the 21 EMA if within 2.5 ATR, else the swing low.'],
              ['Conditions', <>Multiply down, never up. <A to="sizing">Table</A>. Under 30% the panel says passing is usually better.</>],
              ['Caps', 'Per-ticker position cap (minus what’s already open), room left before the daily loss stop, and for options the options budget. The smallest wins and is marked “sets size”.'],
              ['Options tab', 'Calls from the first expiry 21+ days out and the first 45+ days out; the contract nearest 0.70 delta (in the money) and 0.50 (at the money). Only spread ≤ 10% and open interest ≥ 100. Sized so the whole premium is the risk.'],
              ['Settings', 'Account and risk % are saved in this browser. Log trade carries the size into the Journal.'],
            ]} />
            <Note>With the current limits the position cap (lower of $5,000 or 5% of the account) usually sets share size — actual risk is often well under the risk % you type. Options aren’t capped that way, so the risk % decides their size.</Note>
          </S>

          <S id="ai-notes" title="AI notes">
            <Page answers="What just happened that matters to me, and what does my plan say about it?"
              data="Rules detect events from each snapshot; Claude Haiku 5.5 writes the words. Brief at the top of Sectors; every note by day on AI notes." />
            <Defs items={[
              ['Numbers vs words', 'Every number comes from the rules. The model only explains them; it is told not to invent prices or news and not to give buy/sell calls. It can state what your rules imply (stop, invalid-below, 8/21, gate).'],
              ['Context it gets', 'Breadth, index moves, sector medians, your open trades and plan status (vs stop and 21 EMA), deterioration, catalysts, and your approved Playbook principles — cited as [Playbook: name].'],
              ['Limits', '$0.50/day budget; up to 4 notes per run and 20 per day, open trades first. After a billing/auth error it pauses 60 min; a new API key clears the pause. When off, notes fall back to the rules’ plain text (tagged “rules”).'],
              ['What it can’t do', 'Knows only our numbers — no headlines. A news-driven move gets “no cause in the data”.'],
            ]} />
          </S>

          <S id="playbook" title="Playbook">
            <Page answers="What have I learned from traders I trust, in rules the AI applies?" data="Your takes and approved principles in Supabase." />
            <Defs items={[
              ['Flow', 'Paste a take + source → the bot (within a minute) drafts 1–5 principles with Haiku → you edit, untick, approve. Nothing is used until approved.'],
              ['Write a principle', 'Add one by hand (works when the AI is off).'],
              ['What the AI sees', 'The newest 15 active principles; changes reach it within ~10 minutes. Archive what stops holding up.'],
              ['What belongs here', 'Concrete rules that would change a decision. Mindset quotes belong in your journal.'],
            ]} />
          </S>

          <S id="journal" title="Journal">
            <Page answers="What did I do, did I follow my rules, and does following them pay?" data="trade_journal and risk_limits in Supabase; also /log, /close, /open in Telegram." />
            <Defs items={[
              ['Log', 'Every trade is checked against your limits at entry; any rule broken needs a written reason and is flagged. The Sector Pulse read at that moment is saved with the trade.'],
              ['Checklist', <>7 items, pre-filled from the pulse where the data answers it; you tick the rest. <A to="checklist">Items</A></>],
              ['Close + review', 'Exit, P&L and R (P&L ÷ risk at entry). Stops hit are marked stopped out.'],
              ['Stats', 'By setup, by checklist score, retest vs break entries, rule breaks — this is where you learn whether the process has an edge.'],
            ]} />
          </S>

          <S id="watchlist" title="Watchlist">
            <Page answers="Which names am I tracking and why?" data="watchlist table + live quotes." />
            <P>Tickers with group, thesis, stage, sentiment and timeframe. Every watchlist ticker is also scanned by the pulse for Top Setups. Link to Sectors at the top.</P>
          </S>

          <S id="other-pages" title="Home, Dashboard, Positions, Intelligence, Prep">
            <Defs items={[
              ['Home', 'Trading start page: check-ins, open trades, shortcuts.'],
              ['Dashboard', 'Command center: daily check-ins, rule of the day, loss cap, trading portfolio.'],
              ['Positions', 'Holdings, options positions and cash by account (Taxable, Roth, Joint…), entered by hand.'],
              ['Intelligence', 'On-demand AI analyses (morning brief, sector analysis, watchlist pulse). Note: this page calls Claude from the browser with a key that ships to it — moving it behind the server is on the backlog.'],
              ['Prep', 'Tomorrow prep for trading, work and life.'],
            ]} />
          </S>

          <S id="pdh" title="PDH / PDL events">
            <P>PDH/PDL = yesterday’s high and low. Each ticker gets one event for today:</P>
            <Defs items={[
              ['↑ Breakout', 'Traded above PDH and holding above it. “vol” = on 1.3x+ average volume.'],
              ['↓ Breakdown', 'Traded below PDL and holding below it.'],
              ['✗ Failed BO', 'Poked above PDH, now back below.'],
              ['↺ Reclaim', 'Broke PDL, now back above it.'],
              ['⇕ Outside day', 'Took out both PDH and PDL.'],
              ['▭ Inside day', 'Range inside yesterday’s — coiling.'],
            ]} />
            <P>Intraday these are provisional (~) until the close.</P>
          </S>

          <S id="retest" title="Retest">
            <P>The entry the process waits for: break the level, pull back to it, hold. A retest level becomes the stop.</P>
            <Defs items={[
              ['Day-2 retest', 'Yesterday closed at least 1% above its prior-day high (the break); today’s low came back to that level — within +0.5% above to 1% below — and price is back above it.'],
              ['Gap retest', 'Today opened at least 1% above PDH; the low came back to PDH (same band) and price holds above.'],
              ['Why the 1%', 'A stock that opens a hair above the level “retests” it automatically. Requiring a real clear first filters that out. “Sitting on the level” = within 0.5% of it, no bounce yet.'],
              ['15-min check', 'For SPY, QQQ and the top 7 setups, Public 15-min bars confirm the sequence. Held = pulled back to the level and no 15-min close below it since (the stop goes under the deepest dip after the retest); Shaky = a 15-min bar closed back below; Lost = now below; Break only = no pullback yet; Weak break = never cleared by 1%.'],
              ['Indices', 'SPY, QQQ, IWM move less, so the 1% / 0.5% thresholds are scaled ×0.3, ×0.4, ×0.5.'],
            ]} />
          </S>

          <S id="ema" title="8/21 trend">
            <Defs items={[
              ['▲ up', 'Daily 8 EMA above the 21 and price above the 21 — buyers in control.'],
              ['▼ down', '8 below 21 and price below the 21 — sellers in control.'],
              ['~ mixed', 'Anything else: crossing, or pulling back through the 21.'],
            ]} />
          </S>

          <S id="phase" title="Phase vs SPY">
            <P>Compares the 5-day and 20-day return to SPY’s. Differences inside ±0.5 pts (5-day) or ±1 pt (20-day) count as flat.</P>
            <Defs items={[
              ['Leading', 'Ahead on both 5 and 20 days.'],
              ['Improving', 'Ahead on 5 days, flat or behind on 20 — money rotating in.'],
              ['Weakening', 'Behind on 5 days (20-day ahead or flat), or flat on 5 with 20-day ahead — momentum fading.'],
              ['Lagging', 'Behind on 20 days and not ahead on 5.'],
              ['In line', 'Flat on both.'],
            ]} />
          </S>

          <S id="gate" title="Market gate">
            <Table head={['State', 'When', 'Setup score']} rows={[
              ['Green', 'SPY and QQQ both 8/21 up', 'no change'],
              ['Caution', 'Only one up, or mixed', '−5'],
              ['Red (“market says wait”)', 'Both down', '−15'],
            ]} />
            <P>Setups still show on red — the penalty and the label are the warning. Plan a trade also sizes down: caution ×0.75, red ×0.5.</P>
          </S>

          <S id="setups" title="Top Setups score">
            <P><B>Must</B> (else not listed): a break above PDH or a held retest · the stock Leading or Improving vs SPY · 8/21 up · sector ETF not Lagging.</P>
            <Table head={['Points', 'Max', 'How']} rows={[
              ['Volume', '25', '2x avg 25 · 1.3x 18 · 1x 8 · retests get at least 12 (pullbacks are quiet)'],
              ['5d vs SPY', '20', '4 per point ahead of SPY, capped'],
              ['Sector', '15', 'ETF Leading 15 · Improving 10 · In line/unknown 5 · Weakening 0'],
              ['HH/HL streak', '15', '3+ days 15 · 2 days 10 · 1 day 5'],
              ['Entry', '15', 'held retest 15 (8 if sitting on the level) · break within 2% of PDH 10 · within 4% 5'],
              ['Not extended', '10', '≤ 8% above the 20-day EMA 10 · ≤ 15% 4'],
              ['Market gate', '—', 'caution −5 · red −15'],
            ]} />
            <P><B>Invalid below</B> = the retest level (retests) or PDH (breaks). Cautions (!) list what’s weak: light volume, no retest yet, stretched, deterioration 2+. The 20-day-high chip and ⚡ catalysts are information only — no points until the scorecard shows they add edge.</P>
          </S>

          <S id="det" title="Deterioration (0–5)">
            <P>“Is the right side of the chart failing?” One point per sign, from daily bars:</P>
            <Defs items={[
              ['Lower highs & lows', 'The last 5 sessions made a lower high and a lower low than the 5 before.'],
              ['Declining 8/21', '8 EMA under the 21, and the 21 lower than 5 sessions ago.'],
              ['Failed EMA bounce', 'In the last 5 sessions: closed under the 8 or 21 EMA, next day traded up into it (within 0.3%) and closed back under.'],
              ['Low-volume bounces', 'While under the 21 EMA or down over 10 sessions: 2+ up days in the last 10, and 60%+ of them on volume under 85% of the 20-day average.'],
              ['Sellers at resistance', 'In the last 5 sessions: traded within 1% of a prior swing high (last ~45 sessions) and closed 1.5%+ below it.'],
            ]} />
            <P>0–1 intact · 2 watch · 3+ deteriorating. Shown on Sectors at 2+, always on Lookup. It adds a caution to setups (no points) and shrinks Plan-a-trade size: 2 ×0.75, 3 ×0.5, 4–5 ×0.25.</P>
          </S>

          <S id="volume" title="Volume & streaks">
            <Defs items={[
              ['Vol (e.g. 1.8x)', 'Today vs the 20-day average. Intraday it’s paced to the time of day. 1.3x+ confirms a breakout; ↗/↘ = heavy volume on an up/down day.'],
              ['↗3d / ↘3d', '3 days in a row of higher highs & higher lows (or lower highs & lower lows).'],
              ['ATR', 'Average daily range in $ (14 days). Used for stops, extension and event sizes.'],
            ]} />
          </S>

          <S id="events" title="Event rules (what triggers a note)">
            <P>Sized by each stock’s own typical daily move (ATR %), so a 3% day means more for a utility than for a crypto miner.</P>
            <Defs items={[
              ['Reversal up/down', 'Fell 0.8+ ATR from the prior close then bounced 0.5+ ATR and recovered half the drop (or the reverse for a fade).'],
              ['Big move', '1.5+ ATR on the day, on 1.2x+ volume (or volume unknown).'],
              ['New high', 'First close above the 20-day high, 20+ day high, 1.2x+ volume.'],
              ['Lost 21 EMA', 'Was above the 21 EMA yesterday, now below, on a 0.5+ ATR drop.'],
              ['Also', 'Retest held, pre-market gap, market gate change, a whole group moving together.'],
            ]} />
          </S>

          <S id="sizing" title="Sizing multipliers">
            <Table head={['Condition', 'Full size', 'Smaller']} rows={[
              ['Market gate', 'green ×1', 'caution ×0.75 · red ×0.5'],
              ['Deterioration', '0–1 ×1', '2 ×0.75 · 3 ×0.5 · 4–5 ×0.25'],
              ['Sector ETF (or the stock vs SPY if no ETF)', 'Leading/Improving/In line ×1', 'Weakening ×0.75 · Lagging ×0.5'],
              ['8/21 trend', 'up ×1', 'mixed ×0.75 · down ×0.5'],
              ['Extension above 21 EMA', '≤ 3 ATR ×1', '> 3 ATR ×0.75 · > 4 ATR ×0.5'],
            ]} />
            <P>Multiplied together. These are judgment calls, not tested values — the scorecard should tune them.</P>
          </S>

          <S id="limits" title="Risk limits">
            <Table head={['Limit', 'Now', 'Enforced in']} rows={[
              ['Per ticker', '$5,000 or 5% of the account, whichever is lower', 'Journal flags · Plan a trade cap'],
              ['Options total', '$10,000', 'Journal flags · options sizing'],
              ['Daily loss stop', '$1,500 realized', 'Journal flags · sizing room left'],
              ['Stop required', 'every trade', 'Journal flags'],
              ['No-trade list', 'your list', 'Journal flags'],
            ]} />
            <P>Edit them on the <L to="/journal">Journal</L> page. A breach doesn’t block a trade — it requires a written reason and is counted in your stats.</P>
          </S>

          <S id="checklist" title="Journal checklist (7)">
            <Table head={['Item', 'Means']} rows={[
              ['Market', 'SPY & QQQ trending up (daily 8 EMA over 21)'],
              ['Sector', 'Sector ETF leading or improving vs SPY'],
              ['Leader', 'The stock itself leading or improving vs SPY'],
              ['Level', 'Marked level with the stop at it'],
              ['Break', 'Broke the level (above PDH) — no break, no trade'],
              ['Retest', 'Entered on the pullback to the level that held, not the first push'],
              ['8/21', 'Daily 8 EMA over 21, price above'],
            ]} />
          </S>

          <S id="limits-of" title="What it can’t tell you">
            <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-neutral-300">
              <li>None of the scores or multipliers is proven yet. They encode a sensible process; whether they have edge is what the Journal stats and the planned scorecard will show.</li>
              <li>No news. The AI sees our numbers only; earnings and events are known only if you add them as catalysts.</li>
              <li>Intraday sequence (break then retest) is checked on 15-min bars only for SPY, QQQ and the top 7 setups. Everything else is daily.</li>
              <li>Snapshots are 15 minutes apart. Between them, prices on Sectors can be stale; Lookup is live every minute.</li>
              <li>It doesn’t know your fills, taxes or account balance unless you log them.</li>
            </ul>
          </S>
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function S({ id, title, children }) {
  return (
    <section id={id} className="scroll-mt-16 border-t border-neutral-900 py-6 first-of-type:border-t-0 first-of-type:pt-0">
      <h2 className="mb-3 text-[18px] font-medium tracking-tight text-neutral-100">
        <a href={`#${id}`} className="hover:text-emerald-300">{title}</a>
      </h2>
      {children}
    </section>
  );
}
const P = ({ children }) => <p className="mb-3 text-[13px] leading-relaxed text-neutral-300">{children}</p>;
const B = ({ children }) => <span className="font-medium text-neutral-100">{children}</span>;
const L = ({ to, children }) => <Link to={to} className="text-emerald-300 hover:underline">{children}</Link>;
const A = ({ to, children }) => <a href={`#${to}`} className="text-emerald-300 hover:underline">{children}</a>;
const Note = ({ children }) => <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] leading-relaxed text-amber-100/90">{children}</div>;
const Formula = ({ children }) => <div className="mb-3 rounded border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-[12px] text-emerald-200">{children}</div>;

function Page({ answers, data }) {
  return (
    <div className="mb-3 grid gap-1 rounded border border-neutral-800 bg-neutral-950/50 px-3 py-2 text-[12px] sm:grid-cols-[90px_1fr]">
      <span className="text-neutral-500">Answers</span><span className="text-neutral-200">{answers}</span>
      <span className="text-neutral-500">Data</span><span className="text-neutral-400">{data}</span>
    </div>
  );
}

function Defs({ items }) {
  return (
    <dl className="mb-3 divide-y divide-neutral-900 rounded border border-neutral-900">
      {items.map(([k, v]) => (
        <div key={k} className="grid gap-1 px-3 py-2 text-[13px] sm:grid-cols-[160px_1fr] sm:gap-3">
          <dt className="font-medium text-neutral-100">{k}</dt>
          <dd className="leading-relaxed text-neutral-400">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Table({ head, rows }) {
  return (
    <div className="mb-3 overflow-x-auto rounded border border-neutral-900">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-500">
            {head.map((h) => <th key={h} className="px-3 py-2 font-normal">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className="border-t border-neutral-900 align-top">
              {r.map((c, i) => <td key={i} className={`px-3 py-2 ${i === 0 ? 'whitespace-nowrap font-medium text-neutral-100' : 'text-neutral-400'}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Flow({ steps }) {
  return (
    <ol className="mb-3 grid gap-2 sm:grid-cols-5">
      {steps.map(([t, d], i) => (
        <li key={t} className="relative rounded border border-neutral-800 bg-neutral-950/50 px-3 py-2">
          <div className="text-[10px] font-mono text-neutral-600">{i + 1}</div>
          <div className="text-[12px] font-medium text-neutral-100">{t}</div>
          <div className="mt-0.5 text-[11px] leading-snug text-neutral-500">{d}</div>
        </li>
      ))}
    </ol>
  );
}

function Steps({ items }) {
  return (
    <ol className="mb-3 space-y-2">
      {items.map(([when, what]) => (
        <li key={when} className="grid gap-1 text-[13px] sm:grid-cols-[120px_1fr] sm:gap-3">
          <span className="font-mono text-[12px] text-emerald-300/90">{when}</span>
          <span className="leading-relaxed text-neutral-300">{what}</span>
        </li>
      ))}
    </ol>
  );
}
