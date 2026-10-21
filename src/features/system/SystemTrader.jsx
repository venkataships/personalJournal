import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase, authReady } from '../../lib/supabase';
import { RULESET, isClosed } from '../../lib/journal';
import { etDay, modelName } from '../../lib/notes';
import HelpLink from '../../components/HelpLink';
import { BENCH, matchedBenchmark, holdAll } from '../../lib/benchmark';

const ACCOUNT = 80000; // paper account (bot default PAPER_ACCOUNT)
const sUsd = (v) => (v == null ? '—' : `${v < 0 ? '−' : '+'}$${Math.abs(Math.round(v)).toLocaleString()}`);
const sPct = (v) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`);

// Rules v1 traded mechanically on paper by the bot (paper_trader.py). It measures the RULES;
// the Journal measures YOU. The gap between them is execution.

const sR = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}R`);
const tone = (v) => (v == null ? 'text-neutral-400' : v > 0 ? 'text-emerald-300' : v < 0 ? 'text-rose-300' : 'text-neutral-300');
const REASON = { stop: 'Stop', gap_stop: 'Gapped through stop', trail: 'Close under 21 EMA', time: 'Time stop' };
const daysApart = (a, b) => Math.abs((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);

function rstats(rs) {
  const n = rs.length;
  if (!n) return { n: 0 };
  const mean = rs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
  const se = sd != null ? sd / Math.sqrt(n) : null;
  return {
    n, win: Math.round((rs.filter((r) => r > 0).length / n) * 100), avg: Math.round(mean * 100) / 100,
    total: Math.round(rs.reduce((a, b) => a + b, 0) * 100) / 100,
    low: se != null ? Math.round((mean - 1.96 * se) * 100) / 100 : null, high: se != null ? Math.round((mean + 1.96 * se) * 100) / 100 : null,
  };
}

export default function SystemTrader() {
  const [st, setSt] = useState({ loaded: false, error: null, trades: [], journal: [], logs: [] });
  const [mode, setMode] = useState('live');
  const [qqq, setQqq] = useState(null); // daily QQQ bars; null until loaded or if unavailable
  const [live, setLive] = useState({ prices: {}, at: null }); // live quotes for open positions

  useEffect(() => {
    const id = setTimeout(async () => {
      try {
        await authReady();
        const [p, j, l] = await Promise.all([
          supabase.from('paper_trades').select('*').order('entry_day', { ascending: false }).limit(1000),
          supabase.from('trade_journal').select('id,ticker,date,exit_date,status,r_multiple,followed_plan,ruleset,direction').order('date', { ascending: false }).limit(500),
          supabase.from('pulse_notes').select('*').in('kind', ['system_daily', 'system_weekly']).order('created_at', { ascending: false }).limit(20),
        ]);
        if (p.error) throw p.error;
        setSt({ loaded: true, error: null, trades: p.data || [], journal: j.data || [], logs: l.data || [] });
      } catch (e) {
        setSt({ loaded: true, error: /paper_trades/.test(e.message || '') ? 'No system book yet — run migrations/014_paper_trades.sql in Supabase, then pull + restart the bot.' : e.message, trades: [], journal: [], logs: [] });
      }
    }, 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    let off = false;
    fetch(`/api/bars?symbols=${BENCH}`).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!off && Array.isArray(j?.[BENCH]) && j[BENCH].length) setQqq(j[BENCH]);
    }).catch(() => {});
    return () => { off = true; };
  }, []);

  const book = useMemo(() => st.trades.filter((t) => t.book === RULESET && (mode === 'all' ? t.mode !== 'early' : t.mode === mode)), [st.trades, mode]);
  const closed = book.filter((t) => t.status === 'closed' && t.r_multiple != null);
  const open = book.filter((t) => t.status === 'open');
  const openKey = [...new Set(open.map((t) => t.ticker))].sort().join(',');

  // Live prices for open positions, refreshed every minute (falls back to the last daily close).
  useEffect(() => {
    if (!openKey) return undefined;
    let off = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/quotes?symbols=${openKey}`);
        if (!r.ok) return;
        const js = await r.json();
        const prices = {};
        for (const [sym, q] of Object.entries(js || {})) if (q?.price != null) prices[sym.toUpperCase()] = { price: q.price, session: q.session };
        if (!off) setLive({ prices, at: new Date() });
      } catch { /* optional */ }
    };
    load();
    const id = setInterval(load, 60000);
    return () => { off = true; clearInterval(id); };
  }, [openKey]);
  const marks = open.map((t) => openMark(t, live.prices[t.ticker]));
  const openTotal = marks.reduce((a, m) => a + (m.pnl ?? 0), 0);
  const openRisk = open.reduce((a, t) => a + Number(t.shares) * (Number(t.entry_price) - Number(t.stop)), 0);
  const sys = rstats(closed.map((t) => Number(t.r_multiple)));
  const mine = useMemo(() => st.journal.filter((t) => isClosed(t) && t.r_multiple != null && t.ruleset === RULESET), [st.journal]);
  const you = rstats(mine.map((t) => Number(t.r_multiple)));

  // Execution gap: same names (entry within 3 calendar days), skipped system trades, your off-system trades.
  const gap = useMemo(() => {
    const liveClosed = st.trades.filter((t) => t.book === RULESET && t.mode === 'live' && t.status === 'closed');
    const match = (s) => mine.find((j) => j.ticker === s.ticker && (j.direction || 'long') === 'long' && daysApart(j.date, s.entry_day) <= 3);
    const both = liveClosed.map((s) => ({ s, j: match(s) })).filter((x) => x.j);
    const skipped = liveClosed.filter((s) => !match(s));
    const offSystem = mine.filter((j) => !st.trades.some((s) => s.book === RULESET && s.mode === 'live' && s.ticker === j.ticker && daysApart(j.date, s.entry_day) <= 3));
    return {
      both: { n: both.length, sys: rstats(both.map((x) => Number(x.s.r_multiple))).avg, you: rstats(both.map((x) => Number(x.j.r_multiple))).avg },
      skipped: rstats(skipped.map((s) => Number(s.r_multiple))),
      offSystem: rstats(offSystem.map((j) => Number(j.r_multiple))),
    };
  }, [st.trades, mine]);

  const bench = useMemo(() => (qqq ? matchedBenchmark(book, qqq, ACCOUNT) : null), [book, qqq]);
  const hold = useMemo(() => {
    const days = book.map((t) => t.entry_day).sort();
    return qqq && days.length ? holdAll(days[0], qqq, ACCOUNT) : null;
  }, [book, qqq]);

  const daily = st.logs.find((l) => l.kind === 'system_daily');
  const weekly = st.logs.find((l) => l.kind === 'system_weekly');
  const hasReplay = st.trades.some((t) => t.mode === 'replay');
  const hasEarly = st.trades.some((t) => t.mode === 'early');

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 antialiased">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
        <header className="mb-5">
          <h1 className="flex items-center gap-2.5 text-3xl font-light tracking-tight text-neutral-100">
            <Bot className="h-6 w-6 text-emerald-400" strokeWidth={1.5} /> System trader <HelpLink to="system" />
          </h1>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-neutral-500">
            Rules {RULESET} traded mechanically on paper — every retest-held Top Setup, sized and exited exactly by the plan, no discretion, no real orders.
            It measures the <span className="text-neutral-300">rules</span>; your <Link to="/journal" className="text-emerald-300 hover:underline">Journal</Link> measures <span className="text-neutral-300">you</span>.
          </p>
        </header>

        {st.error && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-[13px] text-rose-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {st.error}
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex rounded border border-neutral-800 p-0.5 text-[11px]">
            {[['live', 'Live'], ['replay', 'Replay'], ['all', 'Live + replay'], ['early', '9:30 test']].map(([k, l]) => (
              <button key={k} onClick={() => setMode(k)} disabled={(k === 'replay' || k === 'all') ? !hasReplay : k === 'early' ? !hasEarly : false}
                className={`rounded px-3 py-1 disabled:opacity-30 ${mode === k ? 'bg-emerald-500/15 text-emerald-300' : 'text-neutral-500 hover:text-neutral-300'}`}>{l}</button>
            ))}
          </div>
          <span className="text-[11px] text-neutral-600">
            {mode === 'replay' ? 'Rebuilt from saved snapshots — a logic check, not evidence (the rules were written after those weeks).' : mode === 'all' ? 'Live and replay together.' : mode === 'early' ? 'Shadow book: same rules, entries allowed from 9:30 instead of 10:00. Data only.' : 'Trades taken since the system trader went live.'}
          </span>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-neutral-800 bg-neutral-900 sm:grid-cols-5">
          {[
            ['Closed', sys.n || 0],
            ['Win rate', sys.n ? `${sys.win}%` : '—'],
            ['Avg R', <span key="a" className={tone(sys.avg)}>{sR(sys.avg)}</span>],
            ['Total R', <span key="t" className={tone(sys.total)}>{sR(sys.total)}</span>],
            ['Open', open.length],
          ].map(([k, v]) => (
            <div key={k} className="bg-[#0b0b0b] px-3 py-2.5">
              <div className="text-[9px] uppercase tracking-wider text-neutral-600">{k}</div>
              <div className="font-mono text-[18px] tabular-nums text-neutral-100">{v}</div>
            </div>
          ))}
        </div>
        {sys.n > 0 && (
          <p className="mb-5 text-[12px] text-neutral-500">
            {sys.n < 20 ? `${sys.n} closed trades — too few to judge the rules yet (20 to see a shape, 50 to trust it).`
              : `Likely range ${sR(sys.low)} to ${sR(sys.high)} per trade — ${sys.low > 0 ? 'the rules show a positive edge.' : sys.high < 0 ? 'the rules are losing even when followed perfectly.' : 'not proven either way yet.'}`}
          </p>
        )}

        <BenchCard bench={bench} hold={hold} loaded={!!qqq} nClosed={closed.length} />

        <StartTimeCard trades={st.trades} />

        <div className="mb-6 grid gap-3 lg:grid-cols-2">
          <LogCard title="Today’s log" row={daily} />
          <LogCard title="Friday review" row={weekly} />
        </div>

        <section className="mb-6">
          <Title t="System vs you" hint={`Closed trades under rules ${RULESET}. Same rules, different executor.`} />
          <div className="overflow-x-auto rounded-md border border-neutral-800">
            <table className="w-full min-w-[520px] text-[12px]">
              <thead><tr className="text-left text-[9px] uppercase tracking-wider text-neutral-600">
                <th className="px-3 py-1.5 font-normal"> </th><th className="px-2 py-1.5 text-right font-normal">Trades</th>
                <th className="px-2 py-1.5 text-right font-normal">Win %</th><th className="px-2 py-1.5 text-right font-normal">Avg R</th>
                <th className="px-3 py-1.5 text-right font-normal">Total R</th></tr></thead>
              <tbody>
                {[['System (live)', rstats(st.trades.filter((t) => t.book === RULESET && t.mode === 'live' && t.status === 'closed' && t.r_multiple != null).map((t) => Number(t.r_multiple)))], ['You (journal)', you]].map(([k, s]) => (
                  <tr key={k} className="border-t border-neutral-900">
                    <td className="px-3 py-1.5 text-neutral-200">{k}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-neutral-400">{s.n || 0}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-neutral-300">{s.n ? `${s.win}%` : '—'}</td>
                    <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${tone(s.avg)}`}>{sR(s.avg)}</td>
                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${tone(s.total)}`}>{sR(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid gap-px border-t border-neutral-900 bg-neutral-900 sm:grid-cols-3">
              <GapCell k="Same names" v={gap.both.n ? <>system {sR(gap.both.sys)} · you {sR(gap.both.you)}</> : '—'}
                note={gap.both.n ? `${gap.both.n} trade${gap.both.n > 1 ? 's' : ''} you both took — the difference is entries, exits and sizing` : 'none yet'} />
              <GapCell k="System trades you skipped" v={gap.skipped.n ? <span className={tone(gap.skipped.avg)}>{gap.skipped.n} · avg {sR(gap.skipped.avg)}</span> : '—'}
                note="what passing on them cost or saved" />
              <GapCell k="Your trades off-system" v={gap.offSystem.n ? <span className={tone(gap.offSystem.avg)}>{gap.offSystem.n} · avg {sR(gap.offSystem.avg)}</span> : '—'}
                note="trades the rules wouldn’t have taken" />
            </div>
          </div>
        </section>

        <section className="mb-6">
          <Title t={`Open positions (${open.length})`} hint="Open P&L uses live prices, refreshed every minute (* = last daily close when no quote). Includes any trim already taken. Exits are still decided after the close. The plan: trim ⅓ at 2R, rest on a close under the 21 EMA, out after 5 sessions if not +1R." />
          {open.length > 0 && (
            <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px]">
              <span className="text-neutral-500">Open P&amp;L</span>
              <span className={`font-mono text-[18px] tabular-nums ${tone(openTotal)}`}>{sUsd(openTotal)}</span>
              <span className={`font-mono tabular-nums ${tone(openTotal)}`}>{sPct((openTotal / ACCOUNT) * 100)} of ${ACCOUNT.toLocaleString()}</span>
              {openRisk > 0 && <span className={`font-mono tabular-nums ${tone(openTotal)}`}>{sR(Math.round((openTotal / openRisk) * 100) / 100)} on ${Math.round(openRisk).toLocaleString()} at risk</span>}
              <span className="text-[11px] text-neutral-600">{live.at ? `live prices · ${live.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'last daily close'}</span>
            </div>
          )}
          {open.length === 0 ? <Empty>No open positions.</Empty> : <OpenTrades rows={open} marks={marks} />}
        </section>

        <section className="mb-6">
          <Title t="Closed trades" hint="Every exit is a rule: stop, gap through the stop, close under the 21 EMA, or the time stop." />
          {closed.length === 0 ? <Empty>{st.loaded ? 'No closed trades yet.' : 'Loading…'}</Empty> : <Trades rows={closed} />}
        </section>

        <p className="text-[11px] leading-relaxed text-neutral-600">
          Simplifications: fills at the snapshot price with no slippage; entries only on 15-min snapshots from 10:00 ET; stop assumed hit first when a day touches both the stop and the trim level; on the entry day the stop/trim use 15-min bars after the entry (close only when those aren’t available); daily-stop room isn’t applied. Real results will be somewhat worse.
        </p>
      </div>
    </div>
  );
}

function BenchCard({ bench, hold, loaded, nClosed }) {
  return (
    <section className="mb-6 rounded-md border border-neutral-800 bg-neutral-950/50 px-4 py-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">vs {BENCH} — would holding the index have done better?</div>
      {!loaded ? (
        <p className="mt-1 text-[12px] text-neutral-600">{BENCH} prices unavailable right now.</p>
      ) : !bench ? (
        <p className="mt-1 text-[12px] text-neutral-600">{nClosed ? `Can’t match these trades to ${BENCH} bars yet.` : 'Appears once the first trade closes.'}</p>
      ) : (
        <>
          <div className="mt-2 grid gap-px overflow-hidden rounded border border-neutral-800 bg-neutral-900 sm:grid-cols-3">
            <GapCell k="System, closed trades" v={<span className={tone(bench.sys)}>{sUsd(bench.sys)} · {sPct(bench.sysPct)}</span>} note={`${bench.n} trades, % of a $${ACCOUNT.toLocaleString()} account`} />
            <GapCell k={`Same dollars in ${BENCH}, same days`} v={<span className={tone(bench.qqq)}>{sUsd(bench.qqq)} · {sPct(bench.qqqPct)}</span>} note="each trade’s cost held in the index over its holding window" />
            <GapCell k="System minus index" v={<span className={tone(bench.excess)}>{sUsd(bench.excess)}</span>} note={`beat the index on ${bench.beat} of ${bench.n} trades`} />
          </div>
          {hold && (
            <p className="mt-2 text-[12px] text-neutral-500">
              Whole account in {BENCH} from {hold.from.slice(5)} to {hold.to.slice(5)}: <span className={tone(hold.usd)}>{sUsd(hold.usd)} ({sPct(hold.pct)})</span>.
              {' '}The book is rarely fully invested, so also compare this against its total result above.
            </p>
          )}
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">
            Index entry = that day’s open (trades enter from 10:00 ET); exits at the close of the exit or trim day. Over a few weeks this mostly reflects the market’s direction, not skill — judge it over months.
          </p>
        </>
      )}
    </section>
  );
}

// Does skipping the first 30 minutes help? Same rules, two start times (live 10:00 vs shadow 9:30).
function StartTimeCard({ trades }) {
  const closedOf = (m) => trades.filter((t) => t.book === RULESET && t.mode === m && t.status === 'closed' && t.r_multiple != null);
  const live = closedOf('live');
  const early = closedOf('early');
  if (!early.length && !trades.some((t) => t.mode === 'early')) return null;
  const pre = early.filter((t) => String(t.entry_time || '') < '10:00');
  const rows = [
    ['From 10:00 (the rule)', rstats(live.map((t) => Number(t.r_multiple)))],
    ['From 9:30 (shadow)', rstats(early.map((t) => Number(t.r_multiple)))],
    ['…of which entered before 10:00', rstats(pre.map((t) => Number(t.r_multiple)))],
  ];
  return (
    <section className="mb-6">
      <Title t="Start-time test" hint="Same rules, two books: one waits until 10:00, the shadow one may enter from 9:30. Data only; decide at the monthly review." />
      <div className="overflow-x-auto rounded-md border border-neutral-800">
        <table className="w-full min-w-[520px] text-[12px]">
          <thead><tr className="text-left text-[9px] uppercase tracking-wider text-neutral-600">
            <th className="px-3 py-1.5 font-normal"> </th><th className="px-2 py-1.5 text-right font-normal">Closed</th>
            <th className="px-2 py-1.5 text-right font-normal">Win %</th><th className="px-2 py-1.5 text-right font-normal">Avg R</th>
            <th className="px-3 py-1.5 text-right font-normal">Total R</th></tr></thead>
          <tbody>
            {rows.map(([k, s]) => (
              <tr key={k} className="border-t border-neutral-900">
                <td className="px-3 py-1.5 text-neutral-200">{k}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-neutral-400">{s.n || 0}</td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums text-neutral-300">{s.n ? `${s.win}%` : '—'}</td>
                <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${tone(s.avg)}`}>{sR(s.avg)}</td>
                <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${tone(s.total)}`}>{sR(s.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-600">
        The pre-10:00 row is the answer: if those trades average better than the 10:00 book over 20+ trades, the first 30 minutes are worth trading. Fills at the open are the least realistic (widest spreads), so give the early book a haircut when comparing.
      </p>
    </section>
  );
}

function Title({ t, hint }) {
  return (
    <div className="mb-2">
      <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-400">{t}</div>
      {hint && <div className="mt-0.5 text-[12px] text-neutral-600">{hint}</div>}
    </div>
  );
}

function Empty({ children }) {
  return <div className="rounded-md border border-dashed border-neutral-800 px-4 py-5 text-center text-[13px] text-neutral-500">{children}</div>;
}

function GapCell({ k, v, note }) {
  return (
    <div className="bg-[#0b0b0b] px-3 py-2.5">
      <div className="text-[9px] uppercase tracking-wider text-neutral-600">{k}</div>
      <div className="mt-0.5 font-mono text-[13px] tabular-nums text-neutral-100">{v}</div>
      <div className="mt-0.5 text-[11px] text-neutral-600">{note}</div>
    </div>
  );
}

function LogCard({ title, row }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/50 px-4 py-3">
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-[0.18em] text-neutral-500">
        <span>{title}</span>
        {row && <span className="normal-case tracking-normal text-neutral-600">{etDay(row.created_at)} · {modelName(row.model)}</span>}
      </div>
      {!row ? <div className="text-[12px] text-neutral-600">Written after the close by the bot.</div> : (
        <>
          <div className="text-[14px] font-medium text-neutral-100">{row.title}</div>
          <p className={`mt-1 text-[13px] leading-relaxed text-neutral-300 ${open ? '' : 'line-clamp-3'}`}>{row.body}</p>
          <button onClick={() => setOpen((o) => !o)} className="mt-1 inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-300">
            {open ? <>Less <ChevronUp className="h-3 w-3" /></> : <>More <ChevronDown className="h-3 w-3" /></>}
          </button>
        </>
      )}
    </div>
  );
}

// Open P&L for one paper position at `q.price` (live) or its last daily close. Includes a trim already taken.
function openMark(t, q) {
  const E = Number(t.entry_price); const S = Number(t.stop); const N = Number(t.shares);
  const px = q?.price ?? (t.last_close != null ? Number(t.last_close) : null);
  if (px == null || !N) return { px: null, pnl: null, r: null, pct: null, live: false };
  const trimmed = t.trim_shares && t.trim_price ? Number(t.trim_shares) : 0;
  const pnl = trimmed * (Number(t.trim_price || 0) - E) + (N - trimmed) * (px - E);
  return {
    px, live: q?.price != null, pnl: Math.round(pnl * 100) / 100,
    r: E > S ? Math.round((pnl / (N * (E - S))) * 100) / 100 : null,
    pct: Math.round((pnl / (N * E)) * 10000) / 100,
  };
}

function OpenTrades({ rows, marks }) {
  return (
    <>
      {/* phone: one card per position */}
      <div className="space-y-2 sm:hidden">
        {rows.map((t, i) => {
          const m = marks[i];
          return (
            <div key={t.id} className="rounded-md border border-neutral-800 bg-neutral-950/50 px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <Link to={`/lookup/${t.ticker}`} className="font-mono text-[15px] font-semibold text-neutral-100">{t.ticker}</Link>
                <span className={`font-mono text-[15px] tabular-nums ${tone(m.pnl)}`}>{sUsd(m.pnl)}</span>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-2 font-mono text-[12px] tabular-nums">
                <span className="text-neutral-400">{t.shares} @ {Number(t.entry_price).toFixed(2)} → {m.px != null ? Number(m.px).toFixed(2) : '—'}{m.live ? '' : ' (close)'}</span>
                <span className={tone(m.r)}>{sR(m.r)} · {sPct(m.pct)}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-neutral-600">
                {String(t.entry_day).slice(5)} {t.entry_time} · stop {Number(t.stop).toFixed(2)} · {t.sessions ?? 0}/5 sessions{t.trim_price ? ` · trimmed ${t.trim_shares} @ ${Number(t.trim_price).toFixed(2)}` : ''}
                {t.mode !== 'live' && <span className="ml-1 uppercase">· {t.mode}</span>}
              </div>
            </div>
          );
        })}
      </div>
      {/* desktop: table */}
      <div className="hidden overflow-x-auto rounded-md border border-neutral-800 sm:block">
        <table className="w-full text-[12px]">
          <thead><tr className="text-left text-[9px] uppercase tracking-wider text-neutral-600">
            {['Entered', 'Ticker', 'Entry → stop', 'Shares', 'Now', 'Open P&L', 'R', 'Trim', 'Sessions'].map((h, i) => (
              <th key={h} className={`px-2 py-1.5 font-normal first:pl-3 ${i >= 3 && i <= 6 ? 'text-right' : ''}`}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.map((t, i) => {
              const m = marks[i];
              return (
                <tr key={t.id} className="border-t border-neutral-900" title={t.fill_note || undefined}>
                  <td className="px-2 py-1.5 pl-3 font-mono text-neutral-500">{String(t.entry_day).slice(5)} {t.entry_time}</td>
                  <td className="px-2 py-1.5 font-mono font-semibold text-neutral-100">
                    <Link to={`/lookup/${t.ticker}`} className="hover:text-emerald-300 hover:underline">{t.ticker}</Link>
                    {t.mode !== 'live' && <span className="ml-1 rounded border border-neutral-800 px-1 font-sans text-[9px] font-normal uppercase text-neutral-500">{t.mode}</span>}
                  </td>
                  <td className="px-2 py-1.5 font-mono tabular-nums text-neutral-300">{Number(t.entry_price).toFixed(2)} → {Number(t.stop).toFixed(2)}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-neutral-400">{t.shares}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums text-neutral-300" title={m.live ? 'live' : 'last daily close'}>
                    {m.px != null ? Number(m.px).toFixed(2) : '—'}{!m.live && m.px != null && <span className="text-neutral-600">*</span>}
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${tone(m.pnl)}`}>{sUsd(m.pnl)} <span className="text-[10px] opacity-70">{sPct(m.pct)}</span></td>
                  <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${tone(m.r)}`}>{sR(m.r)}</td>
                  <td className="px-2 py-1.5 font-mono text-neutral-400">{t.trim_price ? `${t.trim_shares} @ ${Number(t.trim_price).toFixed(2)}` : '—'}</td>
                  <td className="px-2 py-1.5 text-neutral-400">{t.sessions ?? 0} / 5</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Trades({ rows, open }) {
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-800">
      <table className="w-full min-w-[720px] text-[12px]">
        <thead><tr className="text-left text-[9px] uppercase tracking-wider text-neutral-600">
          {['Entered', 'Ticker', 'Entry → stop', 'Shares', open ? 'Now' : 'Exit', open ? 'R now' : 'R', 'Trim', open ? 'Sessions' : 'Why out', ''].map((h, i) => (
            <th key={h + i} className={`px-2 py-1.5 font-normal first:pl-3 ${i >= 3 && i <= 5 ? 'text-right' : ''}`}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-t border-neutral-900 align-top" title={t.fill_note || undefined}>
              <td className="px-2 py-1.5 pl-3 font-mono text-neutral-500">{String(t.entry_day).slice(5)} {t.entry_time}</td>
              <td className="px-2 py-1.5 font-mono font-semibold text-neutral-100">
                <Link to={`/lookup/${t.ticker}`} className="hover:text-emerald-300 hover:underline">{t.ticker}</Link>
                {t.mode === 'replay' && <span className="ml-1 rounded border border-neutral-800 px-1 font-sans text-[9px] font-normal uppercase text-neutral-500">replay</span>}
              </td>
              <td className="px-2 py-1.5 font-mono tabular-nums text-neutral-300">{Number(t.entry_price).toFixed(2)} → {Number(t.stop).toFixed(2)}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums text-neutral-400">{t.shares}</td>
              <td className="px-2 py-1.5 text-right font-mono tabular-nums text-neutral-300">{open ? (t.last_close != null ? Number(t.last_close).toFixed(2) : '—') : `${Number(t.exit_price).toFixed(2)} ${String(t.exit_day || '').slice(5)}`}</td>
              <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${tone(Number(t.r_multiple))}`}>{sR(t.r_multiple)}</td>
              <td className="px-2 py-1.5 font-mono text-neutral-400">{t.trim_price ? `${t.trim_shares} @ ${Number(t.trim_price).toFixed(2)}` : '—'}</td>
              <td className="px-2 py-1.5 text-neutral-400">{open ? `${t.sessions ?? 0} / 5` : REASON[t.exit_reason] || t.exit_reason}</td>
              <td className="px-2 py-1.5 text-[10px] text-neutral-600">{t.gate}{t.det != null ? ` · det ${t.det}` : ''}{t.score != null ? ` · ${t.score}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
