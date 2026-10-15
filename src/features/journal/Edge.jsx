import { useEffect, useMemo, useState } from 'react';
import { Flame, Target, ShieldCheck } from 'lucide-react';
import { supabase, authReady } from '../../lib/supabase';
import { processStats, edgeStats, isClosed, RULESET, RULESET_SINCE, NEXT_REVIEW } from '../../lib/journal';

// Process first, edge second, P&L last (Douglas: judge the execution; the edge shows over many trades).

const fmtDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const sR = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}R`);
const sP = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}%`);
const tone = (v) => (v == null ? 'text-neutral-400' : v > 0 ? 'text-emerald-300' : v < 0 ? 'text-rose-300' : 'text-neutral-300');

export function ProcessCard({ trades }) {
  const p = useMemo(() => processStats(trades, 20), [trades]);
  const pctTone = p.pct == null ? 'text-neutral-300' : p.pct >= 80 ? 'text-emerald-300' : p.pct >= 60 ? 'text-amber-300' : 'text-rose-300';
  return (
    <section className="mb-5 rounded-md border border-emerald-500/25 bg-emerald-500/[0.03] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-emerald-300/90">
          <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} /> Process
        </div>
        <span className="rounded border border-neutral-800 px-2 py-0.5 font-mono text-[10px] text-neutral-400"
          title="Rules are frozen between monthly reviews so every trade in a version is judged by the same rules">
          Rules {RULESET} · frozen since {fmtDay(RULESET_SINCE)} · next review {fmtDay(NEXT_REVIEW)}
        </span>
      </div>
      {p.n === 0 ? (
        <p className="mt-2 text-[13px] leading-relaxed text-neutral-300">
          The record starts with your next trade. Each one is judged on one thing: <span className="text-neutral-100">did you follow the plan?</span> Wins and losses are part of the process — consistency is the skill.
        </p>
      ) : (
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <div>
            <div className={`font-mono text-[26px] leading-none tabular-nums ${pctTone}`}>{p.followed}<span className="text-[15px] text-neutral-500">/{p.n}</span></div>
            <div className="mt-1 text-[11px] text-neutral-500">of your last {p.n} reviewed trades followed the plan ({p.pct}%)</div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 font-mono text-[26px] leading-none tabular-nums text-neutral-100">
              <Flame className={`h-5 w-5 ${p.streak ? 'text-amber-400' : 'text-neutral-700'}`} strokeWidth={1.75} />{p.streak}
            </div>
            <div className="mt-1 text-[11px] text-neutral-500">in a row by plan · best {p.best}</div>
          </div>
          <div className="text-[12px] leading-snug text-neutral-400">
            {p.pct >= 80 ? 'Consistent execution. Keep the same discipline in every market — that is what turns an edge into results.'
              : p.pct >= 60 ? 'Mostly on plan. The off-plan trades are where to look first — what were you feeling?'
                : 'The plan isn’t being followed yet. Fewer, smaller trades until it is — no strategy works if it isn’t executed.'}
          </div>
        </div>
      )}
    </section>
  );
}

export function EdgePanel({ trades }) {
  const [win, setWin] = useState(20);
  const e = useMemo(() => edgeStats(trades, { window: win }), [trades, win]);
  const off = useMemo(() => edgeStats(trades, { window: 200, ruleset: null, planOnly: false }), [trades]);
  const offPlan = useMemo(() => {
    const rs = trades.filter((t) => isClosed(t) && t.followed_plan === false && t.r_multiple != null).map((t) => Number(t.r_multiple));
    return rs.length ? { n: rs.length, avg: Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 100) / 100 } : null;
  }, [trades]);
  const onPlanAll = useMemo(() => edgeStats(trades, { window: 500, ruleset: null, planOnly: true }), [trades]);

  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] text-neutral-400"><Target className="h-3.5 w-3.5" /> Your edge</div>
          <div className="mt-0.5 text-[12px] text-neutral-600">Only trades that followed the plan under rules {RULESET}. An edge is a probability over many trades, not a promise on the next one.</div>
        </div>
        <div className="flex rounded border border-neutral-800 p-0.5 text-[11px]">
          {[20, 50].map((n) => (
            <button key={n} onClick={() => setWin(n)} className={`rounded px-3 py-1 ${win === n ? 'bg-emerald-500/15 text-emerald-300' : 'text-neutral-500'}`}>Last {n}</button>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-neutral-800 bg-neutral-950/40">
        {e.n === 0 ? (
          <div className="px-4 py-4 text-[13px] text-neutral-500">No plan-following trades under {RULESET} yet. This fills in as you close and review trades — expect it to say “too early” until about 20.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-px bg-neutral-900 sm:grid-cols-5">
              {[
                ['Trades', e.n],
                ['Win rate', `${e.winRate}%`],
                ['Avg win', sR(e.avgWin)],
                ['Avg loss', sR(e.avgLoss)],
                ['Expectancy', <span key="x" className={tone(e.expectancy)}>{sR(e.expectancy)}</span>],
              ].map(([k, v]) => (
                <div key={k} className="bg-[#0b0b0b] px-3 py-2.5">
                  <div className="text-[9px] uppercase tracking-wider text-neutral-600">{k}</div>
                  <div className="font-mono text-[16px] tabular-nums text-neutral-100">{v}</div>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 text-[13px] leading-relaxed text-neutral-300">
              <Verdict e={e} />
            </div>
          </>
        )}
        {offPlan && onPlanAll.n > 0 && (
          <div className="border-t border-neutral-900 px-4 py-2.5 text-[12px] text-neutral-400">
            <span className="text-neutral-200">What breaking the plan costs:</span> on-plan trades average <span className={`font-mono ${tone(onPlanAll.expectancy)}`}>{sR(onPlanAll.expectancy)}</span> ({onPlanAll.n}),
            off-plan <span className={`font-mono ${tone(offPlan.avg)}`}>{sR(offPlan.avg)}</span> ({offPlan.n}), all versions.
          </div>
        )}
        {off.n > 0 && e.n === 0 && (
          <div className="border-t border-neutral-900 px-4 py-2 text-[11px] text-neutral-600">Before {RULESET}: {off.n} trades with an R, average {sR(off.expectancy)} — a different rule set, kept separate.</div>
        )}
      </div>

      <SetupTrackRecord />
      <ReversalStudy />
    </section>
  );
}

function Verdict({ e }) {
  const range = e.low != null ? <span className="font-mono text-neutral-400"> (likely between {sR(e.low)} and {sR(e.high)})</span> : null;
  if (e.verdict === 'too_few') {
    return <>{e.n} trade{e.n > 1 ? 's' : ''} — too few to tell anything from{range}. 20 is the minimum to see a shape, 50 to trust it. Keep executing the same way; don’t change the rules because of these.</>;
  }
  if (e.verdict === 'positive') {
    return <>Positive edge: about <span className="font-mono text-emerald-300">{sR(e.expectancy)}</span> per trade{range}, even counting every loss. That’s what “wins and losses are randomly distributed” looks like when the odds are on your side — keep size steady and keep going.</>;
  }
  if (e.verdict === 'negative') {
    return <>Negative even when the plan is followed{range}. That points at the rules, not your discipline — note it for the {fmtDay(NEXT_REVIEW)} review and change them there, not mid-month.</>;
  }
  return <>Expectancy {sR(e.expectancy)}{range} — the range still includes zero, so the edge isn’t proven either way yet. More trades, same rules.</>;
}

// How Top Setups did after the fact (bot grades the day's picks at +1/+5/+10 sessions).
function SetupTrackRecord() {
  const [st, setSt] = useState({ rows: null, error: null });
  useEffect(() => {
    const id = setTimeout(async () => {
      try {
        await authReady();
        const { data, error } = await supabase.from('setup_grades').select('day,ticker,rank,score,entry_type,gate,r5,spy5,held5,graded_through')
          .order('day', { ascending: false }).limit(1000);
        if (error) throw error;
        setSt({ rows: data || [], error: null });
      } catch (e) {
        setSt({ rows: [], error: /setup_grades/.test(e.message || '') ? 'Run migrations/012_process_edge.sql to start the track record.' : e.message });
      }
    }, 0);
    return () => clearTimeout(id);
  }, []);
  const graded = (st.rows || []).filter((r) => r.graded_through >= 5 && r.r5 != null);
  const groups = [
    ['Top 5 picks', graded.filter((r) => r.rank)],
    ['Other qualified', graded.filter((r) => !r.rank)],
    ['Retest entries', graded.filter((r) => r.entry_type === 'retest')],
    ['Break-only', graded.filter((r) => r.entry_type !== 'retest')],
    ['Score 70+', graded.filter((r) => r.score >= 70)],
    ['Score under 50', graded.filter((r) => r.score < 50)],
  ].filter(([, rs]) => rs.length);
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return (
    <div className="mt-3 rounded-md border border-neutral-800 bg-neutral-950/40">
      <div className="border-b border-neutral-900 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-neutral-400">Top Setups track record — 5 sessions later</div>
      {st.rows == null ? <div className="px-3 py-3 text-[12px] text-neutral-600">Loading…</div>
        : st.error ? <div className="px-3 py-3 text-[12px] text-neutral-500">{st.error}</div>
          : !groups.length ? (
            <div className="px-3 py-3 text-[12px] text-neutral-500">
              {st.rows.length ? `${st.rows.length} picks recorded; the first 5-session grades land a week after recording starts.` : 'The bot records each day’s qualified setups after the close and grades them 1, 5 and 10 sessions later.'} This tells you whether the score itself has an edge — independent of your trades.
            </div>
          ) : (
            <table className="w-full text-[12px]">
              <thead><tr className="text-left text-[9px] uppercase tracking-wider text-neutral-600">
                <th className="px-3 py-1.5 font-normal"> </th><th className="px-2 py-1.5 text-right font-normal">Picks</th>
                <th className="px-2 py-1.5 text-right font-normal">Avg 5d</th><th className="px-2 py-1.5 text-right font-normal">vs SPY</th>
                <th className="px-3 py-1.5 text-right font-normal" title="Never closed below the invalid-below level in 5 sessions">Held level</th></tr></thead>
              <tbody>
                {groups.map(([k, rs]) => {
                  const a = avg(rs.map((r) => Number(r.r5))); const x = avg(rs.map((r) => Number(r.r5) - Number(r.spy5 || 0)));
                  const held = rs.filter((r) => r.held5 != null);
                  return (
                    <tr key={k} className="border-t border-neutral-900">
                      <td className="px-3 py-1.5 text-neutral-300">{k}</td>
                      <td className="px-2 py-1.5 text-right font-mono tabular-nums text-neutral-400">{rs.length}</td>
                      <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${tone(a)}`}>{sP(a)}</td>
                      <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${tone(x)}`}>{sP(x)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-neutral-300">{held.length ? `${Math.round((held.filter((r) => r.held5).length / held.length) * 100)}%` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
    </div>
  );
}

// Flush-then-recover days: every reversal-up the bot saw, graded as if bought at detection with the
// day's low as the stop. Data only — not a rule until the monthly review says so.
function ReversalStudy() {
  const [st, setSt] = useState({ rows: null, error: null });
  const [showCases, setShowCases] = useState(false);
  useEffect(() => {
    const id = setTimeout(async () => {
      try {
        await authReady();
        const { data, error } = await supabase.from('reversal_grades').select('*').order('day', { ascending: false }).limit(500);
        if (error) throw error;
        setSt({ rows: data || [], error: null });
      } catch (e) {
        setSt({ rows: [], error: /reversal_grades/.test(e.message || '') ? 'Run migrations/013_reversal_study.sql to start recording.' : e.message });
      }
    }, 0);
    return () => clearTimeout(id);
  }, []);
  const rows = st.rows || [];
  const graded = rows.filter((r) => r.r_close != null);
  const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
  const line = (k, rs) => {
    const r5 = rs.filter((r) => r.r5 != null);
    return {
      k, n: rs.length, close: avg(rs.map((r) => Number(r.r_close))), win: rs.length ? Math.round((rs.filter((r) => Number(r.r_close) > 0).length / rs.length) * 100) : null,
      r1: avg(rs.filter((r) => r.r1 != null).map((r) => Number(r.r1))), r5: avg(r5.map((r) => Number(r.r5))), n5: r5.length,
      under: rs.length ? Math.round((rs.filter((r) => r.undercut).length / rs.length) * 100) : null,
    };
  };
  const lines = [
    line('All reversals', graded),
    line('Strong names (8/21 up, leading)', graded.filter((r) => r.strong)),
    line('Everything else', graded.filter((r) => !r.strong)),
    line('Gate green', graded.filter((r) => r.gate === 'green')),
    line('Gate caution / red', graded.filter((r) => r.gate && r.gate !== 'green')),
  ].filter((l) => l.n);
  return (
    <div className="mt-3 rounded-md border border-neutral-800 bg-neutral-950/40">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-900 px-3 py-2">
        <span className="text-[11px] uppercase tracking-[0.16em] text-neutral-400">Reversal study — flush, then recovery</span>
        <span className="text-[10px] text-amber-300/80">data only · not a rule until the review</span>
      </div>
      <div className="px-3 py-2 text-[11px] leading-relaxed text-neutral-500">
        Each case: the first 15-min snapshot where a name had fallen 0.8+ ATR below yesterday’s close and won back half the drop. Graded as if bought right there with the day’s low as the stop (= −1R). Taking out that low later counts as −1R.
      </div>
      {st.rows == null ? <div className="px-3 pb-3 text-[12px] text-neutral-600">Loading…</div>
        : st.error ? <div className="px-3 pb-3 text-[12px] text-neutral-500">{st.error}</div>
          : !rows.length ? <div className="px-3 pb-3 text-[12px] text-neutral-500">No cases yet — recording starts on the next market day.</div>
            : (
              <>
                {lines.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-[12px]">
                      <thead><tr className="text-left text-[9px] uppercase tracking-wider text-neutral-600">
                        <th className="px-3 py-1.5 font-normal"> </th><th className="px-2 py-1.5 text-right font-normal">Cases</th>
                        <th className="px-2 py-1.5 text-right font-normal">Up at close</th><th className="px-2 py-1.5 text-right font-normal">Avg R close</th>
                        <th className="px-2 py-1.5 text-right font-normal">Next day</th><th className="px-2 py-1.5 text-right font-normal">5 days</th>
                        <th className="px-3 py-1.5 text-right font-normal" title="Traded back below the low the same day">Lost the low</th></tr></thead>
                      <tbody>
                        {lines.map((l) => (
                          <tr key={l.k} className="border-t border-neutral-900">
                            <td className="px-3 py-1.5 text-neutral-300">{l.k}</td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-neutral-400">{l.n}</td>
                            <td className="px-2 py-1.5 text-right font-mono tabular-nums text-neutral-300">{l.win}%</td>
                            <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${tone(l.close)}`}>{sR(l.close)}</td>
                            <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${tone(l.r1)}`}>{sR(l.r1)}</td>
                            <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${tone(l.r5)}`}>{l.n5 ? sR(l.r5) : '—'}<span className="text-neutral-600">{l.n5 ? ` (${l.n5})` : ''}</span></td>
                            <td className="px-3 py-1.5 text-right font-mono tabular-nums text-neutral-300">{l.under}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <div className="px-3 pb-2 text-[12px] text-neutral-500">{rows.length} case{rows.length > 1 ? 's' : ''} recorded; grades land after today’s close.</div>}
                <button onClick={() => setShowCases((v) => !v)} className="w-full border-t border-neutral-900 py-1.5 text-[11px] text-neutral-500 hover:text-neutral-300">
                  {showCases ? 'Hide cases' : `Show the ${Math.min(rows.length, 15)} latest cases`}
                </button>
                {showCases && (
                  <div className="overflow-x-auto border-t border-neutral-900">
                    <table className="w-full min-w-[620px] text-[11px]">
                      <thead><tr className="text-left text-[9px] uppercase tracking-wider text-neutral-600">
                        {['Day', 'Ticker', 'Seen at', 'Low → entry', 'Drop / bounce', 'Strong', 'Gate', 'Close', '5 days'].map((h) => <th key={h} className="px-2 py-1.5 font-normal first:pl-3">{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {rows.slice(0, 15).map((r) => (
                          <tr key={r.id} className="border-t border-neutral-900 font-mono tabular-nums text-neutral-300">
                            <td className="px-2 py-1.5 pl-3 text-neutral-500">{r.day.slice(5)}</td>
                            <td className="px-2 py-1.5 font-semibold text-neutral-100">{r.ticker}</td>
                            <td className="px-2 py-1.5">{r.detected_at}</td>
                            <td className="px-2 py-1.5">{Number(r.low).toFixed(2)} → {Number(r.price).toFixed(2)}</td>
                            <td className="px-2 py-1.5">{Number(r.drop_pct).toFixed(1)}% / +{Number(r.bounce_pct).toFixed(1)}%</td>
                            <td className="px-2 py-1.5">{r.strong ? <span className="text-emerald-300">yes</span> : <span className="text-neutral-500">no</span>}</td>
                            <td className="px-2 py-1.5 font-sans text-neutral-400">{r.gate || '—'}</td>
                            <td className={`px-2 py-1.5 ${tone(r.r_close)}`}>{r.r_close == null ? '…' : r.undercut ? '−1R lost low' : sR(r.r_close)}</td>
                            <td className={`px-2 py-1.5 ${tone(r.r5)}`}>{r.r5 == null ? '…' : sR(r.r5)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
    </div>
  );
}
