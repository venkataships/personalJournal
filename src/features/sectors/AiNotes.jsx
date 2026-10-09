import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, ChevronDown, ChevronUp, History } from 'lucide-react';
import { etTime as hm, modelName } from '../../lib/notes';

// AI brief (top of the Sectors page) + today's event notes.
// The bot's rules detect the events and compute every number; Claude Haiku
// writes the words. Notes saved with model 'rules' are the rule-written
// sentence (used when the AI is unavailable).

const SEV = {
  3: { label: 'Important', dot: '#e11d48', cls: 'text-rose-300' },
  2: { label: 'Notable',   dot: '#d97706', cls: 'text-amber-300' },
  1: { label: 'FYI',       dot: '#737373', cls: 'text-neutral-400' },
};
const TYPE_LABEL = {
  reversal_up: 'Reversal up', reversal_down: 'Fade from high', big_up: 'Big move up', big_down: 'Big move down',
  premarket_gap: 'Pre-market gap', new_high: 'New high', lost_21ema: 'Lost 21 EMA', retest_held: 'Retest held',
  sector_hot: 'Sector moving', sector_cold: 'Sector selling',
};
const typeLabel = (t) => TYPE_LABEL[t] || (t?.startsWith('gate_') ? 'Market gate' : t || 'Event');
const minsAgo = (iso) => Math.round((Date.now() - new Date(iso).getTime()) / 60000);
const agoLabel = (m) => (m < 1 ? 'just now' : m < 90 ? `${m}m ago` : m < 36 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`);
const isTicker = (t) => /^[A-Z.]{1,6}$/.test(t || '') && t !== 'MARKET';
// How many of today's notes the Sectors page shows before sending you to the history page.
const SHOWN_ON_SECTORS = 3;

export default function AiNotes({ brief, events, session }) {
  const [open, setOpen] = useState(true);
  if (!brief && !events?.length) return null;
  const age = brief ? minsAgo(brief.created_at) : null;
  const stale = brief && ['premarket', 'regular'].includes(session) && age > 45;
  const shown = (events || []).slice(0, SHOWN_ON_SECTORS);
  const aiOff = events?.[0]?.model === 'rules' ? (events[0].data?.ai || 'unknown reason') : null;
  const more = (events?.length || 0) - shown.length;
  return (
    <section className="mb-6">
      {brief && (
        <div className="rounded-md border border-neutral-800 bg-neutral-950/50 px-4 py-3">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.22em] text-neutral-400">
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" strokeWidth={1.75} /> AI brief
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={`font-mono text-[11px] ${stale ? 'text-amber-300' : 'text-neutral-600'}`}
                title="Written by the model from the pulse's numbers. Rules compute the numbers; the model writes the words.">
                {hm(brief.created_at)} ET · {agoLabel(age)}{stale ? ' · stale' : ''} · {modelName(brief.model)}
              </span>
              <Link to="/notes" className="inline-flex items-center gap-1 rounded border border-neutral-800 px-2 py-0.5 text-[11px] text-neutral-400 hover:border-emerald-500/40 hover:text-emerald-300"
                title="Earlier briefs and notes, by day">
                <History className="h-3 w-3" strokeWidth={1.75} /> Earlier briefs
              </Link>
            </span>
          </div>
          <BriefBody brief={brief} />
        </div>
      )}

      {aiOff && (
        <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-200/90">
          AI write-ups are off — notes below are the rules' plain text. Reason from the bot: <span className="font-mono">{aiOff}</span>
          {/ANTHROPIC_API_KEY/.test(aiOff) && ' — add the key to the server .env and restart.'}
          {/budget/.test(aiOff) && ' — resets tomorrow, or raise PULSE_AI_DAILY_BUDGET.'}
          {/credit|billing|balance|402|400|401|403/i.test(aiOff) && ' — check API credits / key in the Anthropic Console.'}
        </div>
      )}
      {events?.length > 0 && (
        <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-950/40">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
            className="flex w-full items-center justify-between px-3 py-2 text-left">
            <span className="text-[12px] text-neutral-300">Latest notes <span className="font-mono text-neutral-500">{shown.length} of {events.length} today</span></span>
            {open ? <ChevronUp className="h-4 w-4 text-neutral-500" /> : <ChevronDown className="h-4 w-4 text-neutral-500" />}
          </button>
          {open && (
            <div className="border-t border-neutral-900">
              {shown.map((e) => <EventRow key={e.id} e={e} />)}
              <Link to="/notes" className="block border-t border-neutral-900 px-3 py-2 text-center text-[12px] text-neutral-400 hover:text-emerald-300">
                {more > 0 ? `${more} more today · ` : ''}All notes and earlier days →
              </Link>
            </div>
          )}
        </div>
      )}
      {!brief && events?.length > 0 && (
        <Link to="/notes" className="mt-1.5 inline-block text-[11px] text-neutral-500 hover:text-emerald-300">Earlier briefs and notes →</Link>
      )}
    </section>
  );
}

// Headline, summary, hot/weak sectors, watch list, caution — shared with the history page.
export function BriefBody({ brief, compact }) {
  const d = brief?.data || {};
  return (
    <>
      <div className="flex flex-wrap items-start gap-2">
        {d.stance?.label && <StanceChip stance={d.stance} />}
        <div className={`${compact ? 'text-[14px]' : 'text-[15px]'} min-w-0 flex-1 font-medium leading-snug text-neutral-100`}>{brief.title}</div>
      </div>
      {brief.body && <p className="mt-1 text-[13px] leading-relaxed text-neutral-300">{brief.body}</p>}
      {d.holdings?.length > 0 && (
        <div className="mt-3 rounded border border-sky-500/20 bg-sky-500/[0.04] px-3 py-2">
          <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-sky-300/80">Your positions</div>
          <ul className="space-y-0.5 text-[12px] text-neutral-300">
            {d.holdings.map((h) => (
              <li key={h.t} className="flex gap-2">
                <span className={`font-mono ${/breach/i.test(h.status || '') ? 'text-rose-300' : 'text-neutral-600'}`}>{/breach/i.test(h.status || '') ? '!' : '·'}</span>
                <span><TickerLink t={h.t} />: {h.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {d.opportunities?.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-neutral-500">Worth a look</div>
          <ul className="space-y-0.5 text-[12px] text-neutral-300">
            {d.opportunities.map((o) => (
              <li key={o.t} className="flex gap-2"><span className="font-mono text-emerald-400/80">+</span>
                <span><TickerLink t={o.t} /> — {o.why}{o.level && <span className="text-neutral-500"> · must hold {o.level}</span>}</span></li>
            ))}
          </ul>
        </div>
      )}
      {(d.hot?.length > 0 || d.weak?.length > 0) && (
        <div className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <SectorList title="Hot" mark="▲" cls="text-emerald-300" items={d.hot} />
          <SectorList title="Weak" mark="▼" cls="text-rose-300" items={d.weak} />
        </div>
      )}
      {d.watch?.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-neutral-500">Watch</div>
          <ul className="space-y-0.5 text-[12px] text-neutral-300">
            {d.watch.map((w) => <li key={w} className="flex gap-2"><span className="text-neutral-600">·</span><WatchLine text={w} /></li>)}
          </ul>
        </div>
      )}
      {d.caution && <div className="mt-2 text-[12px] text-amber-300/90"><span className="font-mono">!</span> {d.caution}</div>}
    </>
  );
}

const STANCE = {
  defensive:    'border-rose-500/40 bg-rose-500/10 text-rose-200',
  selective:    'border-amber-500/40 bg-amber-500/10 text-amber-200',
  constructive: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
};
function StanceChip({ stance }) {
  const k = String(stance.label).toLowerCase().trim();
  return (
    <span title={stance.why || undefined}
      className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] ${STANCE[k] || 'border-neutral-700 text-neutral-300'}`}>
      {stance.label}
    </span>
  );
}

function TickerLink({ t }) {
  return /^[A-Z.]{1,6}$/.test(t || '')
    ? <Link to={`/lookup/${t}`} className="font-mono font-semibold text-neutral-100 hover:text-emerald-300 hover:underline">{t}</Link>
    : <span className="font-medium text-neutral-100">{t}</span>;
}

const MOVE_IS = { 'market-wide': 'Market-wide', 'sector-wide': 'Sector-wide', 'stock-specific': 'Stock-specific' };

function SectorList({ title, mark, cls, items }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-neutral-500">{title}</div>
      <ul className="space-y-1 text-[12px]">
        {items.map((s) => (
          <li key={s.name} className="flex gap-2">
            <span className={`font-mono ${cls}`} aria-hidden>{mark}</span>
            <span><span className="font-medium capitalize text-neutral-100">{s.name}</span><span className="text-neutral-400"> — {s.why}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// "MU: holding above 1081 ..." -> ticker links to its Lookup page
function WatchLine({ text }) {
  const m = /^([A-Z.]{1,6}):\s*(.*)$/s.exec(text || '');
  if (!m) return <span>{text}</span>;
  return <span><Link to={`/lookup/${m[1]}`} className="font-mono font-semibold text-neutral-100 hover:text-emerald-300 hover:underline">{m[1]}</Link>: {m[2]}</span>;
}

export function EventRow({ e }) {
  const s = SEV[e.severity] || SEV[1];
  const watch = e.data?.watch;
  return (
    <div className="border-b border-neutral-900 px-3 py-2.5 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]">
        <span className="font-mono tabular-nums text-neutral-500">{hm(e.created_at)}</span>
        <span className="inline-flex items-center gap-1" title={`${s.label} — ${typeLabel(e.event_type)}`}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.dot }} />
          <span className={s.cls}>{s.label}</span>
        </span>
        <span className="rounded border border-neutral-800 px-1.5 py-0.5 text-neutral-400">{typeLabel(e.event_type)}</span>
        {isTicker(e.ticker)
          ? <Link to={`/lookup/${e.ticker}`} className="font-mono font-semibold text-neutral-100 hover:text-emerald-300 hover:underline">{e.ticker}</Link>
          : <span className="font-medium capitalize text-neutral-200">{e.ticker === 'MARKET' ? 'Market' : e.ticker}</span>}
        {e.data?.facts?.open_trade && <span className="rounded border border-sky-500/40 bg-sky-500/10 px-1 py-0.5 text-[9px] uppercase tracking-wider text-sky-300">In trade</span>}
        {e.data?.move_is && <span className="rounded border border-neutral-800 px-1.5 py-0.5 text-neutral-500" title="From today's numbers: stock vs SPY vs its sector">{MOVE_IS[e.data.move_is] || e.data.move_is}</span>}
        {e.model === 'rules' && (
          <span className="text-neutral-600 underline decoration-dotted underline-offset-2"
            title={`Written by the rules, not the AI${e.data?.ai ? ` — AI off: ${e.data.ai}` : ''}`}>rules</span>
        )}
      </div>
      <div className="mt-1 text-[13px] font-medium text-neutral-100">{e.title}</div>
      {e.body && e.body !== e.title && <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-300">{e.body}</p>}
      {e.data?.position && <p className="mt-0.5 text-[12px] text-sky-200/90"><span className="text-sky-300/70">Your position:</span> {e.data.position}</p>}
      {e.data?.opportunity && <p className="mt-0.5 text-[12px] text-emerald-200/90"><span className="text-emerald-300/70">Worth a look:</span> {e.data.opportunity}</p>}
      {watch && <p className="mt-0.5 text-[12px] text-neutral-400"><span className="text-neutral-500">Watch:</span> {watch}</p>}
    </div>
  );
}
