import { useMemo, useState } from 'react';
import { Zap, Archive, Plus } from 'lucide-react';
import { supabase, authReady } from '../../lib/supabase';
import {
  THEME_KEYWORDS, parseCatalyst, whenLabel, daysUntil, catalystsFor,
} from '../../lib/catalysts';

const THEMES = Object.keys(THEME_KEYWORDS);
const STRENGTH = {
  high:   { label: 'High',   cls: 'border-rose-500/40 text-rose-300',   dot: '#e11d48' },
  medium: { label: 'Medium', cls: 'border-amber-500/40 text-amber-300', dot: '#d97706' },
  low:    { label: 'Low',    cls: 'border-neutral-700 text-neutral-400', dot: '#737373' },
};
const input = 'w-full rounded border border-neutral-800 bg-transparent px-2.5 py-1.5 text-[12px] text-neutral-100 placeholder:text-neutral-600 focus:border-emerald-500/50 focus:outline-none';
const lbl = 'mb-1 block text-[10px] uppercase tracking-[0.16em] text-neutral-500';

// Pulse group names -> the theme words catalysts use.
const GROUP_THEME = { 'mag tech': 'big-tech', 'big tech': 'big-tech', indices: 'macro' };
function themesOfTicker(ticker, snapshot, wlCategory) {
  const out = new Set();
  const cat = wlCategory.get(ticker);
  if (cat) out.add(cat);
  for (const g of snapshot?.groups || []) {
    if ((g.members || []).some((m) => m.ticker === ticker)) {
      const n = g.name.toLowerCase();
      out.add(GROUP_THEME[n] || n);
    }
  }
  return [...out];
}

export function CatalystChip({ ticker, catalysts, snapshot, wlCategory, today }) {
  if (!catalysts?.length) return null;
  const hits = catalystsFor(ticker, themesOfTicker(ticker, snapshot, wlCategory), catalysts, today);
  if (!hits.length) return null;
  const next = hits.reduce((a, b) => ((a.event_start || '') <= (b.event_start || '') ? a : b));
  const d = daysUntil(next.event_start, today);
  const tip = hits.map((c) => `${c.event_start} (${whenLabel(c, today)}) — ${c.headline}`).join('\n');
  return (
    <span title={tip}
      className="ml-1.5 inline-flex items-center gap-0.5 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 align-middle font-sans text-[9px] font-normal text-amber-200">
      <Zap className="h-2.5 w-2.5" strokeWidth={2} />{d <= 0 ? 'now' : `${d}d`}
    </span>
  );
}

function tickerRead(snapshot, t) {
  for (const g of snapshot?.groups || []) {
    const m = (g.members || []).find((x) => x.ticker === t);
    if (m) return m;
  }
  return (snapshot?.setups?.all || []).find((x) => x.ticker === t) || null;
}

export default function Catalysts({ catalysts, snapshot, known, wlCategory, today, onChange }) {
  const [text, setText] = useState('');
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [showPast, setShowPast] = useState(false);

  const read = () => {
    if (!text.trim()) return;
    const p = parseCatalyst(text, known);
    setDraft({ ...p, tickersText: p.tickers.join(', ') });
  };

  async function save() {
    setSaving(true); setErr(null);
    try {
      await authReady();
      const tickers = draft.tickersText.split(/[\s,]+/).map((t) => t.replace(/^\$/, '').toUpperCase()).filter(Boolean);
      const endDate = draft.event_end || draft.event_start;
      const expires = endDate
        ? new Date(Date.parse(`${endDate}T23:59:00-04:00`) + 86400000)
        : new Date(Date.now() + 14 * 86400000);
      const row = {
        headline: draft.headline.trim(), notes: draft.notes, sector: draft.themes[0] || null,
        tickers_affected: tickers.join(', '), themes: draft.themes, strength: draft.strength,
        source: 'dashboard', event_start: draft.event_start || null, event_end: endDate || null,
        expires_at: expires.toISOString(), is_active: true,
        days_active: Math.max(1, Math.round((expires.getTime() - Date.now()) / 86400000)),
      };
      const { error } = await supabase.from('catalysts').insert(row);
      if (error) {
        throw new Error(/column|event_start|themes|relation/i.test(error.message)
          ? 'Run migrations/009_catalysts.sql in Supabase first.' : error.message);
      }
      setText(''); setDraft(null); onChange();
    } catch (e) {
      setErr(e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function archive(id) {
    await authReady();
    await supabase.from('catalysts').update({ is_active: false }).eq('id', id);
    onChange();
  }

  const { upcoming, past } = useMemo(() => {
    const sorted = [...catalysts].sort((a, b) => (a.event_start || '9999').localeCompare(b.event_start || '9999'));
    const isPast = (c) => (daysUntil(c.event_end || c.event_start, today) ?? 0) < 0;
    return { upcoming: sorted.filter((c) => !isPast(c)), past: sorted.filter(isPast).reverse() };
  }, [catalysts, today]);

  const related = (themes) => {
    const out = [];
    for (const [t, cat] of wlCategory) if (themes.includes(cat)) out.push(t);
    return out.slice(0, 10);
  };

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-end justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-neutral-400">Catalysts</div>
          <div className="mt-0.5 text-[12px] text-neutral-600">Events coming up for your names and themes. Tickers with one inside 3 weeks get a ⚡ tag on this page.</div>
        </div>
      </div>

      <div className="rounded-md border border-neutral-800 bg-neutral-950/40 p-3">
        <div className="flex gap-2">
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) read(); }}
            placeholder="e.g. NVIDIA GTC Berlin 20th to 22nd October 2026 — track on Physical AI and robotics…"
            className={`${input} resize-y`} />
          <button type="button" onClick={read} disabled={!text.trim()}
            className="shrink-0 self-start rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[12px] text-emerald-200 disabled:opacity-40">
            <Plus className="mr-1 inline h-3.5 w-3.5" />Add
          </button>
        </div>

        {draft && (
          <div className="mt-3 space-y-3 border-t border-neutral-900 pt-3">
            <div className="text-[11px] text-neutral-500">Check what was picked up — fix anything wrong, then save.</div>
            <div><span className={lbl}>Headline</span>
              <input className={input} value={draft.headline} onChange={(e) => setDraft({ ...draft, headline: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><span className={lbl}>Starts</span>
                <input type="date" className={input} value={draft.event_start || ''} onChange={(e) => setDraft({ ...draft, event_start: e.target.value || null })} /></div>
              <div><span className={lbl}>Ends</span>
                <input type="date" className={input} value={draft.event_end || ''} onChange={(e) => setDraft({ ...draft, event_end: e.target.value || null })} /></div>
              <div className="col-span-2"><span className={lbl}>Tickers</span>
                <input className={`${input} font-mono uppercase`} value={draft.tickersText} placeholder="NVDA, TSLA"
                  onChange={(e) => setDraft({ ...draft, tickersText: e.target.value })} /></div>
            </div>
            <div><span className={lbl}>Themes (links it to your watchlist categories and pulse groups)</span>
              <div className="flex flex-wrap gap-1.5">
                {THEMES.map((t) => {
                  const on = draft.themes.includes(t);
                  return (
                    <button key={t} type="button"
                      onClick={() => setDraft({ ...draft, themes: on ? draft.themes.filter((x) => x !== t) : [...draft.themes, t] })}
                      className={`rounded border px-2 py-0.5 text-[11px] ${on ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200' : 'border-neutral-800 text-neutral-500'}`}>
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1.5">
                {Object.entries(STRENGTH).map(([k, v]) => (
                  <button key={k} type="button" onClick={() => setDraft({ ...draft, strength: k })}
                    className={`rounded border px-2 py-0.5 text-[11px] ${draft.strength === k ? v.cls : 'border-neutral-800 text-neutral-600'}`}>
                    {v.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setDraft(null)} className="rounded border border-neutral-800 px-3 py-1.5 text-[12px] text-neutral-400">Cancel</button>
                <button type="button" onClick={save} disabled={saving || !draft.headline.trim()}
                  className="rounded border border-emerald-500/50 bg-emerald-500/10 px-3 py-1.5 text-[12px] font-medium text-emerald-200 disabled:opacity-40">
                  {saving ? 'Saving…' : 'Save catalyst'}
                </button>
              </div>
            </div>
            {!draft.event_start && <div className="text-[11px] text-amber-300/80">No date found — add one, or it's kept for 14 days.</div>}
            {err && <div className="text-[12px] text-rose-300">{err}</div>}
          </div>
        )}
      </div>

      {upcoming.length === 0 ? (
        <div className="mt-2 rounded-md border border-dashed border-neutral-800 px-4 py-4 text-center text-[12px] text-neutral-600">
          No upcoming catalysts saved.
        </div>
      ) : (
        <div className="mt-2 overflow-hidden rounded-md border border-neutral-800">
          {upcoming.map((c) => <CatalystRow key={c.id} c={c} today={today} snapshot={snapshot} related={related(c.themes)} onArchive={archive} />)}
        </div>
      )}
      {past.length > 0 && (
        <button type="button" onClick={() => setShowPast((v) => !v)} className="mt-1.5 text-[11px] text-neutral-600 hover:text-neutral-400">
          {showPast ? 'Hide' : 'Show'} {past.length} past
        </button>
      )}
      {showPast && past.length > 0 && (
        <div className="mt-1 overflow-hidden rounded-md border border-neutral-900 opacity-70">
          {past.map((c) => <CatalystRow key={c.id} c={c} today={today} snapshot={snapshot} related={[]} onArchive={archive} />)}
        </div>
      )}
    </section>
  );
}

function CatalystRow({ c, today, snapshot, related, onArchive }) {
  const s = STRENGTH[c.strength] || STRENGTH.medium;
  const soon = (daysUntil(c.event_start, today) ?? 99) <= 7;
  const md = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const range = !c.event_start ? '—'
    : !c.event_end || c.event_end === c.event_start ? md(c.event_start)
      : c.event_end.slice(5, 7) === c.event_start.slice(5, 7) ? `${md(c.event_start)}–${+c.event_end.slice(8)}`
        : `${md(c.event_start)} – ${md(c.event_end)}`;
  return (
    <div className="border-b border-neutral-900 px-3 py-2.5 last:border-0">
      <div className="flex items-start gap-3">
        <div className="w-24 shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums">
          <div className="text-neutral-300">{range}</div>
          <div className={soon ? 'text-amber-300' : 'text-neutral-600'}>{whenLabel(c, today)}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5 text-[13px] text-neutral-100">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: s.dot }} title={`${s.label} strength`} />
            <span title={c.notes || undefined}>{c.headline}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
            {(c.tickers || []).map((t) => {
              const m = tickerRead(snapshot, t);
              return (
                <span key={t} className="inline-flex items-center gap-1 rounded border border-neutral-800 px-1.5 py-0.5"
                  title={m ? `${t}: ${m.quadrant || '—'} vs SPY · 8/21 ${m.ema_trend || '—'} · ${m.pd_event || m.pd_state || ''}` : `${t}: not in today's pulse`}>
                  <span className="font-mono text-neutral-200">{t}</span>
                  {m?.r1 != null && <span className={`font-mono ${m.r1 > 0 ? 'text-emerald-400' : m.r1 < 0 ? 'text-rose-400' : 'text-neutral-500'}`}>{m.r1 > 0 ? '+' : ''}{m.r1.toFixed(1)}%</span>}
                  {m?.quadrant && <span className="text-neutral-500">{m.quadrant}</span>}
                </span>
              );
            })}
            {(c.themes || []).map((t) => (
              <span key={t} className="rounded border border-sky-500/30 px-1.5 py-0.5 text-sky-300/90">{t}</span>
            ))}
          </div>
          {related.length > 0 && (
            <div className="mt-1 text-[11px] text-neutral-600">
              On your watchlist in these themes: <span className="font-mono text-neutral-400">{related.join(', ')}</span>
            </div>
          )}
        </div>
        <button type="button" onClick={() => onArchive(c.id)} title="Archive" aria-label="Archive catalyst"
          className="shrink-0 rounded p-1 text-neutral-600 hover:text-neutral-300">
          <Archive className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

