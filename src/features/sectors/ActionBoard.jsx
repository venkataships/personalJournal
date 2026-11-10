import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Zap, Volume2, VolumeX, ChevronDown, ChevronUp, Check, X } from 'lucide-react';
import { supabase, authReady } from '../../lib/supabase';
import { etTime } from '../../lib/notes';
import HelpLink from '../../components/HelpLink';

// The Action board: what the 60-second level watcher says to do NOW, as states rather than a log.
//   Act now          a level trigger (long or short) fired in the last 30 min and price is still in the zone
//   Close to trigger an armed level within 0.5%: what has to happen next
//   Manage           your open trades: R now, distance to stop, trim level
//   Earlier today    triggers that are extended, failed, at target or stale
// Rules only. It never places orders.

const SOUND_KEY = 'board.sound';
const LEVEL = { open: 'the open', pdl: 'yesterday’s low', orh: 'the opening-range high', pdh: 'yesterday’s high', orl: 'the opening-range low' };
const VERB = { reclaim: 'Reclaimed', orh: 'Broke', reject: 'Lost', orl: 'Broke' };
const isShort = (t) => t.side === 'short';
const GRADE = {
  A: 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200',
  B: 'border-sky-500/50 bg-sky-500/10 text-sky-200',
  C: 'border-neutral-700 bg-neutral-800/40 text-neutral-400',
};
const STATUS = {
  in_zone: { label: 'In the zone', cls: 'text-emerald-300' },
  extended: { label: 'Extended: don’t chase', cls: 'text-amber-300' },
  wrong_side: { label: 'Back through the level', cls: 'text-amber-300' },
  failed: { label: 'Failed: lost the stop', cls: 'text-rose-300' },
  target: { label: '2R reached', cls: 'text-emerald-300' },
  stale: { label: 'Triggered earlier', cls: 'text-neutral-400' },
};
const TRADE = {
  stop: { label: 'At stop', cls: 'border-rose-500/60 bg-rose-500/15 text-rose-200' },
  near_stop: { label: 'Near stop', cls: 'border-amber-500/50 bg-amber-500/10 text-amber-200' },
  trim: { label: 'Trim level', cls: 'border-sky-500/50 bg-sky-500/10 text-sky-200' },
  ok: { label: 'OK', cls: 'border-neutral-700 text-neutral-400' },
};
const num = (v, d = 2) => (v == null ? '—' : Number(v).toFixed(d));
const rText = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}R`);
const what = (t) => `${VERB[t.kind] || 'Crossed'} ${LEVEL[t.level_name] || t.level_name} ${num(t.level)}`;
const SideChip = ({ t }) => (
  <span title={isShort(t) ? 'Short triggers are a test: no track record yet' : undefined}
    className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${isShort(t) ? 'border-rose-500/50 bg-rose-500/10 text-rose-200' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'}`}>{isShort(t) ? 'SHORT · TEST' : 'LONG'}</span>
);

function readSound() {
  try { return window.localStorage.getItem(SOUND_KEY) === '1'; } catch { return false; }
}

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.25);
    o.onended = () => ctx.close();
  } catch { /* no audio */ }
}

function Label({ children }) {
  return <div className="px-3 pb-1 pt-2.5 text-[10px] uppercase tracking-[0.18em] text-neutral-500">{children}</div>;
}

function ActCard({ ticker, price, t }) {
  const short = isShort(t);
  const [zLo, zHi] = [t.entry, t.chase].sort((x, y) => x - y);
  const swing = t.swing_stop != null && t.swing_stop !== t.stop;
  return (
    <div className={`border-t px-3 py-2.5 ${short ? 'border-rose-500/20 bg-rose-500/[0.04]' : 'border-emerald-500/20 bg-emerald-500/[0.04]'}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Link to={`/lookup/${ticker}`} className="font-mono text-[15px] font-semibold text-neutral-50 hover:text-emerald-300">{ticker}</Link>
        <SideChip t={t} />
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${GRADE[t.grade] || GRADE.C}`}>Grade {t.grade}</span>
        <span className="text-[13px] text-neutral-200">{what(t)} at {t.at}</span>
        <span className="font-mono text-[12px] tabular-nums text-neutral-400">now {num(price)} ({rText(t.r_now)})</span>
        <Link to={`/lookup/${ticker}`} className="ml-auto text-[11px] text-emerald-300 hover:underline">Plan it →</Link>
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[12px] tabular-nums sm:grid-cols-4">
        <span><span className="font-sans text-[10px] uppercase tracking-wider text-neutral-500">{short ? 'Short zone' : 'Buy zone'}</span><br /><span className={short ? 'text-rose-200' : 'text-emerald-200'}>{num(zLo)}–{num(zHi)}</span></span>
        <span><span className="font-sans text-[10px] uppercase tracking-wider text-neutral-500">Stop (today)</span><br /><span className="text-rose-300">{num(t.stop)}</span> <span className="text-neutral-500">{short ? '+' : '−'}{num(t.risk_pct, 1)}%</span></span>
        <span><span className="font-sans text-[10px] uppercase tracking-wider text-neutral-500">Size (your cap)</span><br /><span className="text-neutral-200">{t.shares ? `${t.shares} sh` : '—'}</span> <span className="text-neutral-500">risk ${num(t.risk_usd, 0)}</span></span>
        <span><span className="font-sans text-[10px] uppercase tracking-wider text-neutral-500">1R / 2R</span><br /><span className="text-neutral-200">{num(t.r1)} / {num(t.r2)}</span></span>
      </div>
      {swing && (
        <div className="mt-1.5 text-[12px] text-neutral-300">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">If you hold overnight</span>{' '}
          stop <span className="font-mono tabular-nums text-rose-300">{num(t.swing_stop)}</span>{' '}
          <span className="text-neutral-500">({num(t.swing_risk_pct, 1)}%, 1 ATR)</span> · <span className="font-mono tabular-nums">{t.swing_shares} sh</span>{' '}
          <span className="text-neutral-500">for the same ${num(t.risk_usd, 0)} at risk</span>
        </div>
      )}
      {short && <div className="mt-1 text-[11px] text-amber-300/80">Test: short triggers have no track record yet. A put bought from this card is not tracked in Manage.</div>}
      {short && (
        <div className="mt-1 text-[12px] text-neutral-300">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">Put instead</span>{' '}
          {t.put ? (
            <>
              <span className="font-mono tabular-nums">{t.put.expiry} {t.put.strike}P</span> ≈ ${num(t.put.mid)}{' '}
              <span className="text-neutral-500">(${num(t.put.cost, 0)} a contract{t.put.delta != null ? `, delta ${num(t.put.delta)}` : ''}; max {t.put.max_contracts} under your cap) · exit if the stock is back above {num(t.stop)}</span>
            </>
          ) : <span className="text-neutral-500">no quote found. Shorting needs a borrow; a put keeps the loss to the premium. Exit if the stock is back above {num(t.stop)}.</span>}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        {(t.checks || []).map(([label, ok]) => (
          <span key={label} className={`inline-flex items-center gap-1 ${ok ? 'text-neutral-300' : 'text-neutral-600'}`}>
            {ok ? <Check className="h-3 w-3 text-emerald-400" /> : <X className="h-3 w-3 text-rose-400/70" />}{label}
          </span>
        ))}
      </div>
      {t.skip && <div className="mt-1 text-[11px] text-amber-300/80">Not posted as an alert: {t.skip}.</div>}
    </div>
  );
}

const NAME = { 'reclaim:open': 'Reclaim open', 'reclaim:pdl': 'Reclaim PDL', 'orh:orh': 'Range-high break',
  'reject:open': 'Lost open', 'reject:pdh': 'Lost PDH', 'orl:orl': 'Range-low break' };
const avg = (a) => (a.n ? a.sum / a.n : null);

function Scorecard() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        await authReady();
        const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
        const q = (cols) => supabase.from('level_triggers').select(cols).gte('day', since).eq('final', true).limit(3000);
        let { data, error } = await q('kind, level_name, grade, hit_1r, stopped, close_r, side, r2d, r5d, r10d');
        if (error) ({ data, error } = await q('kind, level_name, grade, hit_1r, stopped, close_r'));   // before migration 018
        if (error) throw error;
        if (!off) setRows(data || []);
      } catch { if (!off) setRows([]); }
    })();
    return () => { off = true; };
  }, []);
  if (rows == null) return <div className="px-3 py-2 text-[12px] text-neutral-600">Loading…</div>;
  if (!rows.length) {
    return <div className="px-3 py-2 text-[12px] text-neutral-500">No finished triggers yet. Every trigger (posted or not) is followed to the close, then for 2, 5 and 10 sessions; results show here from tomorrow.</div>;
  }
  const by = new Map();
  for (const r of rows) {
    const k = `${r.side === 'short' ? 'Short' : 'Long'} · ${NAME[`${r.kind}:${r.level_name}`] || r.kind} · ${r.grade}`;
    const a = by.get(k) || { k, n: 0, r1: 0, stopped: 0, sum: 0, d2: { n: 0, sum: 0 }, d5: { n: 0, sum: 0 }, d10: { n: 0, sum: 0 } };
    a.n += 1; a.r1 += r.hit_1r ? 1 : 0; a.stopped += r.stopped && !r.hit_1r ? 1 : 0; a.sum += Number(r.close_r ?? 0);
    for (const [f, d] of [['r2d', a.d2], ['r5d', a.d5], ['r10d', a.d10]]) {
      if (r[f] != null) { d.n += 1; d.sum += Number(r[f]); }
    }
    by.set(k, a);
  }
  const list = [...by.values()].sort((a, b) => a.k.localeCompare(b.k));
  const Cell = ({ d }) => (
    <td className="py-1 pr-2 text-right font-mono tabular-nums">
      {d.n ? <><span className={avg(d) > 0 ? 'text-emerald-300' : 'text-rose-300'}>{rText(avg(d))}</span> <span className="text-neutral-600">{d.n}</span></> : <span className="text-neutral-700">—</span>}
    </td>
  );
  return (
    <div className="overflow-x-auto px-3 pb-2">
      <table className="w-full min-w-[640px] text-[12px]">
        <thead><tr className="text-left text-[9px] uppercase tracking-wider text-neutral-600">
          <th className="py-1 pr-2 font-normal">Side · trigger · grade</th><th className="py-1 pr-2 text-right font-normal">Count</th>
          <th className="py-1 pr-2 text-right font-normal">1R before stop</th><th className="py-1 pr-2 text-right font-normal">Stopped first</th>
          <th className="py-1 pr-2 text-right font-normal">R at close</th>
          <th className="py-1 pr-2 text-right font-normal">+2 days</th><th className="py-1 pr-2 text-right font-normal">+5 days</th><th className="py-1 pr-2 text-right font-normal">+10 days</th>
        </tr></thead>
        <tbody>
          {list.map((a) => (
            <tr key={a.k} className="border-t border-neutral-900">
              <td className="py-1 pr-2 text-neutral-200">{a.k}</td>
              <td className="py-1 pr-2 text-right font-mono tabular-nums text-neutral-400">{a.n}</td>
              <td className="py-1 pr-2 text-right font-mono tabular-nums text-neutral-200">{Math.round((a.r1 / a.n) * 100)}%</td>
              <td className="py-1 pr-2 text-right font-mono tabular-nums text-neutral-400">{Math.round((a.stopped / a.n) * 100)}%</td>
              <td className={`py-1 pr-2 text-right font-mono tabular-nums ${a.sum / a.n > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{rText(a.sum / a.n)}</td>
              <Cell d={a.d2} /><Cell d={a.d5} /><Cell d={a.d10} />
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5 text-[11px] text-neutral-600">Last 45 days, every trigger whether or not it was posted. “R at close” is the day trade: entry at the trigger, today’s stop, out at the close. “+2 / +5 / +10 days” is the swing hold: same entry, the overnight stop (1 ATR), average R after that many sessions, with the number of triggers that have got that far in grey. Under about 30 in a row, treat the numbers as noise.</p>
    </div>
  );
}

export default function ActionBoard({ watch }) {
  const { board, ageMin, missing, loaded } = watch;
  const [sound, setSound] = useState(readSound);
  const [score, setScore] = useState(false);
  const seen = useRef(null);

  const rows = board?.rows || [];
  const all = rows.flatMap((r) => (r.triggers || []).map((t) => ({ ticker: r.ticker, price: r.price, t })));
  const act = all.filter((x) => x.t.status === 'in_zone').sort((a, b) => b.t.score - a.t.score);
  const earlier = all.filter((x) => x.t.status !== 'in_zone').sort((a, b) => String(b.t.ts).localeCompare(String(a.t.ts)));
  const close = rows.flatMap((r) => (r.near || []).map((n) => ({ ticker: r.ticker, price: r.price, n }))).sort((a, b) => a.n.dist_pct - b.n.dist_pct);
  const trades = board?.trades || [];
  const urgent = trades.filter((t) => t.state !== 'ok');
  const actKey = act.map((x) => `${x.ticker}:${x.t.id}`).join(',');

  useEffect(() => {      // a new "act now" since the last refresh: beep + browser notification, if you turned sound on
    const now = new Set(actKey ? actKey.split(',') : []);
    if (seen.current && sound) {
      const fresh = [...now].filter((k) => !seen.current.has(k));
      if (fresh.length) {
        beep();
        try {
          if (window.Notification?.permission === 'granted') new window.Notification(`Act now: ${fresh.map((k) => k.split(':')[0]).join(', ')}`);
        } catch { /* ignore */ }
      }
    }
    seen.current = now;
  }, [actKey, sound]);

  if (missing || (loaded && !board)) {
    return (
      <section className="mb-5 rounded-md border border-neutral-800 bg-neutral-950/50 px-3 py-2.5 text-[12px] text-neutral-500">
        <span className="mr-2 text-[10px] uppercase tracking-[0.18em] text-neutral-400">Action board</span>
        Waiting for the level watcher. It needs migration 017 and the updated bot; then it fills in during market hours.
      </section>
    );
  }
  if (!board) return null;

  const toggleSound = () => setSound((s) => {
    const next = !s;
    try { window.localStorage.setItem(SOUND_KEY, next ? '1' : '0'); } catch { /* ignore */ }
    if (next) { beep(); try { window.Notification?.requestPermission?.(); } catch { /* ignore */ } }
    return next;
  });
  const stale = !board.closed && ageMin != null && ageMin > 3;
  const watching = rows.filter((r) => r.role === 'entry').length;

  return (
    <section className="mb-5 overflow-hidden rounded-md border border-neutral-800 bg-neutral-950/50">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <span className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-neutral-400">
          <Zap className="h-3.5 w-3.5 text-emerald-400" strokeWidth={1.75} /> Action board <HelpLink to="alerts" />
          <span className="normal-case tracking-normal text-neutral-500">
            gate {board.gate || '—'} · SPY {board.spy_up == null ? '—' : board.spy_up ? 'above its open' : 'below its open'} · watching {watching}
            {' '}· {board.closed ? 'closed' : 'updated'} {etTime(board.as_of)}
          </span>
        </span>
        <button type="button" onClick={toggleSound} aria-pressed={sound}
          className="inline-flex min-h-[28px] items-center gap-1 rounded border border-neutral-800 px-2 text-[11px] text-neutral-400 hover:text-neutral-200">
          {sound ? <Volume2 className="h-3.5 w-3.5 text-emerald-400" /> : <VolumeX className="h-3.5 w-3.5" />} Sound {sound ? 'on' : 'off'}
        </button>
      </div>
      {stale && <div className="border-t border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-[12px] text-amber-200">The watcher last updated {Math.round(ageMin)} min ago. Treat everything below as old until it catches up.</div>}
      {board.locked && <div className="border-t border-rose-500/30 bg-rose-500/5 px-3 py-1.5 text-[12px] text-rose-200">Daily loss stop reached. No entry alerts post for the rest of today, long or short.</div>}
      {board.gate === 'red' && <div className="border-t border-rose-500/30 bg-rose-500/5 px-3 py-1.5 text-[12px] text-rose-200">Market gate is red: no long triggers today. Short triggers on your focus list and open trades are still watched.</div>}

      <div className="border-t border-neutral-900">
        <Label>Act now {act.length > 0 && <span className="ml-1 font-mono normal-case tracking-normal text-emerald-300">{act.length}</span>}</Label>
        {act.length === 0 ? (
          <div className="px-3 pb-2.5 text-[12px] text-neutral-500">Nothing in a zone right now. No trade is a valid outcome.</div>
        ) : act.map((x) => <ActCard key={`${x.ticker}:${x.t.id}`} {...x} />)}
      </div>

      {close.length > 0 && (
        <div className="border-t border-neutral-900">
          <Label>Close to trigger</Label>
          <div className="px-3 pb-2.5">
            {close.map(({ ticker, price, n }) => (
              <div key={`${ticker}:${n.kind}:${n.level_name}`} className="flex flex-wrap items-baseline gap-x-2 py-0.5 text-[12px]">
                <Link to={`/lookup/${ticker}`} className="w-14 font-mono font-semibold text-neutral-100 hover:text-emerald-300">{ticker}</Link>
                <span className="font-mono tabular-nums text-neutral-400">{num(price)}</span>
                {n.side === 'short' ? (
                  <span className="text-neutral-300">a <span className="text-rose-200">short</span> triggers if it loses <span className="font-mono tabular-nums text-sky-200">{num(n.level)}</span> ({num(-n.dist_pct, 1)}%), {LEVEL[n.level_name]}</span>
                ) : (
                  <span className="text-neutral-300">needs <span className="font-mono tabular-nums text-sky-200">{num(n.level)}</span> ({n.dist_pct > 0 ? '+' : ''}{num(n.dist_pct, 1)}%) to {n.kind === 'reclaim' ? `reclaim ${LEVEL[n.level_name]}` : `break ${LEVEL.orh}`}</span>
                )}
                {n.stop != null && <span className="text-neutral-500">· stop would be {num(n.stop)} ({num(n.risk_pct, 1)}%)</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {trades.length > 0 && (
        <div className="border-t border-neutral-900">
          <Label>Manage {urgent.length > 0 && <span className="ml-1 font-mono normal-case tracking-normal text-rose-300">{urgent.length} need attention</span>}</Label>
          <div className="px-3 pb-2.5">
            {trades.map((t) => {
              const s = TRADE[t.state] || TRADE.ok;
              return (
                <div key={t.id ?? t.ticker} className="flex flex-wrap items-baseline gap-x-2 py-0.5 text-[12px]">
                  <Link to={`/lookup/${t.ticker}`} className="w-14 font-mono font-semibold text-neutral-100 hover:text-emerald-300">{t.ticker}</Link>
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] ${s.cls}`}>{s.label}</span>
                  <span className="font-mono tabular-nums text-neutral-300">{num(t.price)}</span>
                  <span className={`font-mono tabular-nums ${t.r == null ? 'text-neutral-500' : t.r >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{rText(t.r)}</span>
                  {t.stop != null && <span className="text-neutral-500">stop {num(t.stop)}{t.to_stop_pct != null ? ` (${num(t.to_stop_pct, 1)}% away)` : ''}</span>}
                  {t.trim_at != null && <span className="text-neutral-500">· trim at {num(t.trim_at)}</span>}
                  {t.stop == null && <span className="text-amber-300/80">no stop in the journal</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {earlier.length > 0 && (
        <div className="border-t border-neutral-900">
          <Label>Earlier today</Label>
          <div className="px-3 pb-2.5">
            {earlier.map(({ ticker, t }) => {
              const s = STATUS[t.status] || STATUS.stale;
              return (
                <div key={`${ticker}:${t.id}`} className="flex flex-wrap items-baseline gap-x-2 py-0.5 text-[12px]">
                  <span className="w-12 font-mono text-[11px] tabular-nums text-neutral-500">{t.at}</span>
                  <Link to={`/lookup/${ticker}`} className="w-14 font-mono font-semibold text-neutral-100 hover:text-emerald-300">{ticker}</Link>
                  <SideChip t={t} />
                  <span className={`rounded border px-1 text-[10px] ${GRADE[t.grade] || GRADE.C}`}>{t.grade}</span>
                  <span className="text-neutral-400">{what(t)}</span>
                  <span className={s.cls}>{s.label}</span>
                  <span className="font-mono tabular-nums text-neutral-500">{rText(t.r_now)} · stop {num(t.stop)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="border-t border-neutral-900">
        <button type="button" onClick={() => setScore((o) => !o)} aria-expanded={score}
          className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[11px] text-neutral-500 hover:text-neutral-300">
          <span>Do these alerts work? Scorecard</span>
          {score ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {score && <Scorecard />}
      </div>
      <div className="border-t border-neutral-900 px-3 py-1.5 text-[11px] text-neutral-600">
        Rules only: what your levels say, not advice. Nothing here places an order. Size is your position cap (${num(board.cap_usd, 0)}), not a recommendation.
      </div>
    </section>
  );
}
