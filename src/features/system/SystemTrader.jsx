import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase, authReady } from '../../lib/supabase';
import { RULESET, isClosed } from '../../lib/journal';
import { etDay, modelName } from '../../lib/notes';
import HelpLink from '../../components/HelpLink';

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

  const book = useMemo(() => st.trades.filter((t) => t.book === RULESET && (mode === 'all' || t.mode === mode)), [st.trades, mode]);
  const closed = book.filter((t) => t.status === 'closed' && t.r_multiple != null);
  const open = book.filter((t) => t.status === 'open');
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

  const daily = st.logs.find((l) => l.kind === 'system_daily');
  const weekly = st.logs.find((l) => l.kind === 'system_weekly');
  const hasReplay = st.trades.some((t) => t.mode === 'replay');

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
            {[['live', 'Live'], ['replay', 'Replay'], ['all', 'Both']].map(([k, l]) => (
              <button key={k} onClick={() => setMode(k)} disabled={k !== 'live' && !hasReplay}
                className={`rounded px-3 py-1 disabled:opacity-30 ${mode === k ? 'bg-emerald-500/15 text-emerald-300' : 'text-neutral-500 hover:text-neutral-300'}`}>{l}</button>
            ))}
          </div>
          <span className="text-[11px] text-neutral-600">
            {mode === 'replay' ? 'Rebuilt from saved snapshots — early ones used slightly older rules.' : mode === 'all' ? 'Live and replay together.' : 'Trades taken since the system trader went live.'}
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
          <Title t={`Open positions (${open.length})`} hint="Marked at the last daily close. The plan: trim ⅓ at 2R, rest on a close under the 21 EMA, out after 5 sessions if not +1R." />
          {open.length === 0 ? <Empty>No open positions.</Empty> : <Trades rows={open} open />}
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
