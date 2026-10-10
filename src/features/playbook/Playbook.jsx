import { useCallback, useEffect, useMemo, useState } from 'react';
import HelpLink from '../../components/HelpLink';
import { Link } from 'react-router-dom';
import { BookMarked, AlertCircle, Loader2, Check, X, Archive, RotateCcw, Pencil, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase, authReady } from '../../lib/supabase';
import { etTime, etDay, modelName } from '../../lib/notes';

// Playbook: paste a take you trust → the bot's AI distills it into 1-5 principles
// (a DRAFT, within ~1 min) → you edit and approve → approved principles are fed to
// the AI brief and event notes, which cite them as [Playbook: name].
// Nothing reaches the AI until you approve it.

const TAGS = ['trend', 'entries', 'exits', 'shorting', 'risk', 'sizing', 'volume', 'market', 'sectors', 'options', 'psychology'];
const CHECK_LABELS = {
  deterioration_score: 'deterioration score', lower_highs_lows: 'lower highs & lows', declining_emas: 'declining 8/21',
  failed_ema_bounce: 'failed EMA bounce', low_volume_bounces: 'low-volume bounces', resistance_defended: 'sellers at resistance',
  ema_trend: '8/21 trend', relative_strength: 'vs SPY', volume: 'volume', market_gate: 'market gate', pdh_breakout: 'PDH break',
  retest: 'retest', new_high: 'new high', stop_distance: 'stop distance', extension_atr: 'extension (ATR)',
};
const MAX_ACTIVE = 15;   // playbook.MAX_ACTIVE — the AI sees the newest 15
const EMPTY = { name: '', rule: '', applies_when: '', caveat: '', tags: [], checks: [] };

const missingTable = (e) => /playbook_(takes|principles)/i.test(e?.message || '');
const MIGRATION_MSG = 'No Playbook tables yet — run migrations/011_playbook.sql in Supabase.';

export default function Playbook() {
  const [takes, setTakes] = useState([]);
  const [principles, setPrinciples] = useState([]);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);

  const load = useCallback(async () => {
    try {
      await authReady();
      const [t, p] = await Promise.all([
        supabase.from('playbook_takes').select('*').order('created_at', { ascending: false }).limit(60),
        supabase.from('playbook_principles').select('*').order('created_at', { ascending: false }).limit(300),
      ]);
      if (t.error) throw t.error;
      if (p.error) throw p.error;
      setTakes(t.data || []); setPrinciples(p.data || []); setError(null); setLoadedAt(Date.now());
    } catch (e) {
      setError(missingTable(e) ? MIGRATION_MSG : (e.message || 'Failed to load'));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [load]);

  // Poll while the bot is working on something.
  const working = takes.some((t) => t.status === 'pending' || t.status === 'distilling');
  useEffect(() => {
    if (!working) return undefined;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [working, load]);

  const inbox = takes.filter((t) => ['pending', 'distilling', 'distilled', 'error'].includes(t.status));
  const active = principles.filter((p) => p.status === 'active');
  const archived = principles.filter((p) => p.status === 'archived');
  const takeById = useMemo(() => new Map(takes.map((t) => [t.id, t])), [takes]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 antialiased">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
        <header className="mb-5">
          <h1 className="flex items-center gap-2.5 text-3xl font-light tracking-tight text-neutral-100">
            <BookMarked className="h-6 w-6 text-emerald-400" strokeWidth={1.5} /> Playbook <HelpLink to="playbook" />
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-neutral-500">
            Paste a market take you trust. The AI pulls out the durable principles as a draft; you edit and approve.
            Approved principles feed the <Link to="/sectors" className="text-emerald-300 hover:underline">Sector Pulse</Link> brief
            and <Link to="/notes" className="text-emerald-300 hover:underline">AI notes</Link>, which cite them as <span className="font-mono text-neutral-300">[Playbook: name]</span>.
          </p>
        </header>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-[13px] text-rose-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        <Composer onSent={load} />

        {inbox.length > 0 && (
          <section className="mb-6">
            <SectionTitle>Drafts</SectionTitle>
            <div className="space-y-3">
              {inbox.map((t) => <TakeCard key={t.id} take={t} now={loadedAt} onChange={load} />)}
            </div>
          </section>
        )}

        <section className="mb-6">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <SectionTitle className="mb-0">Active principles</SectionTitle>
            <span className={`font-mono text-[11px] ${active.length > MAX_ACTIVE ? 'text-amber-300' : 'text-neutral-600'}`}
              title="The AI reads the newest 15 active principles; changes reach it within ~10 minutes">
              {active.length} active · AI reads the newest {MAX_ACTIVE}
            </span>
          </div>
          {active.length > MAX_ACTIVE && (
            <div className="mb-2 text-[12px] text-amber-300/80">
              {active.length - MAX_ACTIVE} older principle{active.length - MAX_ACTIVE > 1 ? 's are' : ' is'} not reaching the AI — archive or merge some.
            </div>
          )}
          {loaded && !error && active.length === 0 && (
            <div className="rounded-md border border-dashed border-neutral-800 px-4 py-8 text-center text-[13px] text-neutral-500">
              Nothing approved yet. Paste a take above, or add a principle by hand.
            </div>
          )}
          <PrincipleGroups rows={active} takeById={takeById} rank={new Map(active.map((p, i) => [p.id, i]))} onChange={load} />
        </section>

        {archived.length > 0 && <ArchivedList rows={archived} takeById={takeById} onChange={load} />}
      </div>
    </div>
  );
}

function SectionTitle({ children, className = 'mb-2' }) {
  return <h2 className={`${className} text-[11px] uppercase tracking-[0.22em] text-neutral-400`}>{children}</h2>;
}

// ---------------------------------------------------------------------------
// Paste a take, or write a principle by hand.
// ---------------------------------------------------------------------------
function Composer({ onSent }) {
  const [mode, setMode] = useState('take');
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function sendTake() {
    if (text.trim().length < 20) { setErr('Paste the whole take — a sentence or two at least.'); return; }
    setBusy(true); setErr(null);
    try {
      await authReady();
      const { error } = await supabase.from('playbook_takes').insert({ text: text.trim(), source: source.trim() || null });
      if (error) throw error;
      setText(''); setSource('');
      onSent();
    } catch (e) {
      setErr(missingTable(e) ? MIGRATION_MSG : e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 rounded-md border border-neutral-800 bg-neutral-950/50">
      <div className="flex border-b border-neutral-900 text-[12px]">
        {[['take', 'Paste a take'], ['manual', 'Write a principle']].map(([k, l]) => (
          <button key={k} onClick={() => { setMode(k); setErr(null); }}
            className={`px-3 py-2 ${mode === k ? 'border-b border-emerald-400 text-emerald-300' : 'text-neutral-500 hover:text-neutral-300'}`}>{l}</button>
        ))}
      </div>
      {mode === 'take' ? (
        <div className="p-3">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} aria-label="Take"
            placeholder={'e.g. "Don\'t short momentum because it looks stretched. Wait for deterioration: lower highs and lows, declining EMAs, failed bounces into the 8/21, low-volume bounces, sellers defending resistance…"'}
            className="w-full resize-y rounded border border-neutral-800 bg-transparent px-3 py-2 text-[13px] leading-relaxed text-neutral-100 placeholder:text-neutral-700 focus:border-emerald-500/50 focus:outline-none" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Source (e.g. @trader on X)" aria-label="Source"
              className="min-w-0 flex-1 rounded border border-neutral-800 bg-transparent px-3 py-1.5 text-[12px] text-neutral-100 placeholder:text-neutral-700 focus:border-emerald-500/50 focus:outline-none" />
            <button onClick={sendTake} disabled={busy || !text.trim()}
              className="inline-flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-4 py-1.5 text-[12px] font-medium uppercase tracking-[0.12em] text-emerald-200 disabled:opacity-40">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Distill
            </button>
          </div>
          <div className="mt-2 text-[11px] text-neutral-600">The bot picks it up within a minute (~$0.001 per take). You review the draft before anything is used.</div>
          {err && <div className="mt-2 text-[12px] text-rose-300">{err}</div>}
        </div>
      ) : (
        <div className="p-3">
          <PrincipleForm initial={EMPTY} submitLabel="Add to playbook"
            onSubmit={async (p) => {
              await authReady();
              const { error } = await supabase.from('playbook_principles').insert({ ...p, source: 'me' });
              if (error) throw error;
              onSent();
              return true;
            }} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One take in the inbox: waiting, distilled (review), or failed.
// ---------------------------------------------------------------------------
function TakeCard({ take: t, now, onChange }) {
  const draft = t.draft?.principles || [];
  const [items, setItems] = useState(() => draft.map((p) => ({ ...EMPTY, ...p, keep: true })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [showText, setShowText] = useState(t.status !== 'distilled');
  // A fresh draft arrives by polling after mount.
  const [seen, setSeen] = useState(t.status);
  if (seen !== t.status) {
    setSeen(t.status);
    setItems(draft.map((p) => ({ ...EMPTY, ...p, keep: true })));
    if (t.status === 'distilled') setShowText(false);
  }

  async function update(fields) {
    setBusy(true); setErr(null);
    try {
      await authReady();
      const { error } = await supabase.from('playbook_takes').update(fields).eq('id', t.id);
      if (error) throw error;
      onChange();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function approve() {
    const keep = items.filter((p) => p.keep && p.name.trim() && p.rule.trim());
    if (!keep.length) { setErr('Tick at least one principle with a name and rule, or discard the take.'); return; }
    setBusy(true); setErr(null);
    try {
      await authReady();
      const rows = keep.map(({ name, rule, applies_when, caveat, tags, checks }) => ({
        take_id: t.id, source: t.source, name: name.trim(), rule: rule.trim(),
        applies_when: applies_when?.trim() || null, caveat: caveat?.trim() || null, tags: tags || [], checks: checks || [],
      }));
      const { error } = await supabase.from('playbook_principles').insert(rows);
      if (error) throw error;
      const { error: e2 } = await supabase.from('playbook_takes').update({ status: 'done' }).eq('id', t.id);
      if (e2) throw e2;
      onChange();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const set = (i, patch) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const waiting = t.status === 'pending' || t.status === 'distilling';
  const stale = waiting && now - new Date(t.created_at).getTime() > 5 * 60 * 1000;

  return (
    <div className={`rounded-md border ${t.status === 'error' ? 'border-rose-500/30' : 'border-neutral-800'} bg-neutral-950/50`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-900 px-3 py-2 text-[11px]">
        <span className="flex items-center gap-2 text-neutral-500">
          <StatusChip status={t.status} />
          {t.source && <span className="text-neutral-300">{t.source}</span>}
          <span className="font-mono">{etDay(t.created_at)} {etTime(t.created_at)}</span>
          {t.model && <span>· {modelName(t.model)}{t.cost_usd ? ` · $${Number(t.cost_usd).toFixed(4)}` : ''}</span>}
        </span>
        <button onClick={() => setShowText((s) => !s)} className="inline-flex items-center gap-1 text-neutral-500 hover:text-neutral-300">
          Original {showText ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>
      {showText && <div className="whitespace-pre-wrap border-b border-neutral-900 px-3 py-2 text-[12px] leading-relaxed text-neutral-400">{t.text}</div>}

      {waiting && (
        <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-neutral-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
          {t.status === 'pending' ? 'Waiting for the bot (checks every minute)…' : 'Distilling…'}
          {stale && <span className="text-amber-300/80">Taking longer than usual — is the bot running and pulled to the latest code?</span>}
        </div>
      )}

      {t.status === 'error' && (
        <div className="px-3 py-3 text-[12px]">
          <div className="text-rose-300">{t.error || 'Failed'}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <SmallBtn onClick={() => update({ status: 'pending', error: null })} disabled={busy}><RotateCcw className="h-3 w-3" /> Retry</SmallBtn>
            <SmallBtn onClick={() => { setItems([{ ...EMPTY, keep: true }]); update({ status: 'distilled', error: null, draft: { principles: [EMPTY], skipped: null } }); }} disabled={busy}>
              <Pencil className="h-3 w-3" /> Write it myself
            </SmallBtn>
            <SmallBtn onClick={() => update({ status: 'discarded' })} disabled={busy}><X className="h-3 w-3" /> Discard</SmallBtn>
          </div>
        </div>
      )}

      {t.status === 'distilled' && (
        <div className="space-y-2 p-3">
          {items.map((p, i) => (
            <div key={i} className={`rounded border px-3 py-2.5 ${p.keep ? 'border-emerald-500/30 bg-emerald-500/[0.03]' : 'border-neutral-800 opacity-60'}`}>
              <label className="mb-2 flex items-center gap-2 text-[11px] text-neutral-400">
                <input type="checkbox" checked={p.keep} onChange={(e) => set(i, { keep: e.target.checked })} className="accent-emerald-500" />
                Keep this one
              </label>
              <Fields value={p} onChange={(patch) => set(i, patch)} />
            </div>
          ))}
          {t.draft?.skipped && <div className="text-[11px] text-neutral-600">Left out: {t.draft.skipped}</div>}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button onClick={approve} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[12px] text-emerald-200 disabled:opacity-40">
              <Check className="h-3.5 w-3.5" /> Approve {items.filter((x) => x.keep).length} into playbook
            </button>
            <SmallBtn onClick={() => setItems((xs) => [...xs, { ...EMPTY, keep: true }])} disabled={busy}><Plus className="h-3 w-3" /> Add one</SmallBtn>
            <SmallBtn onClick={() => update({ status: 'pending', draft: null })} disabled={busy}><RotateCcw className="h-3 w-3" /> Re-distill</SmallBtn>
            <SmallBtn onClick={() => update({ status: 'discarded' })} disabled={busy}><X className="h-3 w-3" /> Discard</SmallBtn>
          </div>
        </div>
      )}
      {err && <div className="px-3 pb-3 text-[12px] text-rose-300">{err}</div>}
    </div>
  );
}

function StatusChip({ status }) {
  const s = {
    pending: ['Queued', 'border-neutral-700 text-neutral-400'],
    distilling: ['Distilling', 'border-sky-500/40 text-sky-300'],
    distilled: ['Review', 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'],
    error: ['Failed', 'border-rose-500/40 text-rose-300'],
  }[status] || [status, 'border-neutral-700 text-neutral-400'];
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${s[1]}`}>{s[0]}</span>;
}

function SmallBtn({ children, ...rest }) {
  return (
    <button {...rest} className="inline-flex items-center gap-1 rounded border border-neutral-800 px-2.5 py-1.5 text-[11px] text-neutral-400 hover:text-neutral-100 disabled:opacity-40">
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Editing fields shared by draft review, manual add and edit.
// ---------------------------------------------------------------------------
const inputCls = 'w-full rounded border border-neutral-800 bg-transparent px-2.5 py-1.5 text-[12px] text-neutral-100 placeholder:text-neutral-700 focus:border-emerald-500/50 focus:outline-none';

function FieldRow({ label, children }) {
  return (
    <div className="sm:flex sm:items-start sm:gap-2">
      <div className="mb-0.5 text-[10px] uppercase tracking-wider text-neutral-600 sm:mb-0 sm:w-14 sm:shrink-0 sm:pt-2">{label}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Fields({ value: p, onChange }) {
  const toggle = (t) => onChange({ tags: p.tags?.includes(t) ? p.tags.filter((x) => x !== t) : [...(p.tags || []), t].slice(0, 4) });
  return (
    <div className="space-y-1.5">
      <FieldRow label="Name"><input value={p.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="≤6 words" aria-label="Name" maxLength={80}
        className={`${inputCls} font-medium`} /></FieldRow>
      <FieldRow label="Rule"><textarea value={p.rule} onChange={(e) => onChange({ rule: e.target.value })} placeholder="The rule — concrete, 1-2 sentences" aria-label="Rule" rows={3} maxLength={400}
        className={`${inputCls} resize-y`} /></FieldRow>
      <FieldRow label="When"><textarea value={p.applies_when || ''} onChange={(e) => onChange({ applies_when: e.target.value })} placeholder="The situation where it applies" aria-label="Applies when" rows={2} maxLength={300} className={`${inputCls} resize-y`} /></FieldRow>
      <FieldRow label="Caveat"><textarea value={p.caveat || ''} onChange={(e) => onChange({ caveat: e.target.value })} placeholder="When it doesn't apply / what it costs" aria-label="Caveat" rows={2} maxLength={300} className={`${inputCls} resize-y`} /></FieldRow>
      <div className="flex flex-wrap gap-1 pt-0.5">
        {TAGS.map((t) => (
          <button key={t} type="button" onClick={() => toggle(t)}
            className={`rounded border px-1.5 py-0.5 text-[10px] ${p.tags?.includes(t) ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-neutral-800 text-neutral-600 hover:text-neutral-400'}`}>{t}</button>
        ))}
      </div>
      {p.checks?.length > 0 && (
        <div className="text-[10px] text-neutral-600" title="Data the system computes that shows this principle in play">
          Checks: {p.checks.map((c) => CHECK_LABELS[c] || c).join(' · ')}
        </div>
      )}
    </div>
  );
}

function PrincipleForm({ initial, submitLabel, onSubmit, onCancel }) {
  const [p, setP] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function submit() {
    if (!p.name.trim() || !p.rule.trim()) { setErr('Name and rule are required.'); return; }
    setBusy(true); setErr(null);
    try {
      const ok = await onSubmit({
        name: p.name.trim(), rule: p.rule.trim(), applies_when: p.applies_when?.trim() || null,
        caveat: p.caveat?.trim() || null, tags: p.tags || [], checks: p.checks || [],
      });
      if (ok) setP(EMPTY);
    } catch (e) { setErr(missingTable(e) ? MIGRATION_MSG : e.message); } finally { setBusy(false); }
  }
  return (
    <div>
      <Fields value={p} onChange={(patch) => setP((x) => ({ ...x, ...patch }))} />
      <div className="mt-2 flex gap-2">
        <button onClick={submit} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[12px] text-emerald-200 disabled:opacity-40">
          <Check className="h-3.5 w-3.5" /> {submitLabel}
        </button>
        {onCancel && <SmallBtn onClick={onCancel}>Cancel</SmallBtn>}
      </div>
      {err && <div className="mt-2 text-[12px] text-rose-300">{err}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approved principles, grouped by first tag.
// ---------------------------------------------------------------------------
function PrincipleGroups({ rows, takeById, rank, onChange }) {
  const groups = rows.reduce((m, p) => {
    const k = p.tags?.[0] || 'untagged';
    (m[k] ||= []).push(p);
    return m;
  }, {});
  const order = [...TAGS, 'untagged'].filter((k) => groups[k]);
  return (
    <div className="space-y-4">
      {order.map((k) => (
        <div key={k}>
          <div className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-neutral-600">{k}</div>
          <div className="space-y-2">
            {groups[k].map((p) => <PrincipleCard key={p.id} p={p} take={takeById.get(p.take_id)} unused={rank.get(p.id) >= MAX_ACTIVE} onChange={onChange} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function PrincipleCard({ p, take, unused, onChange, archived }) {
  const [edit, setEdit] = useState(false);
  const [showTake, setShowTake] = useState(false);
  const [err, setErr] = useState(null);

  async function patch(fields) {
    setErr(null);
    try {
      await authReady();
      const { error } = await supabase.from('playbook_principles').update(fields).eq('id', p.id);
      if (error) throw error;
      onChange();
      return true;
    } catch (e) { setErr(e.message); return false; }
  }

  if (edit) {
    return (
      <div className="rounded-md border border-emerald-500/30 bg-neutral-950/50 px-3 py-2.5">
        <PrincipleForm initial={{ ...EMPTY, ...p, applies_when: p.applies_when || '', caveat: p.caveat || '' }} submitLabel="Save"
          onSubmit={async (v) => { const ok = await patch(v); if (ok) setEdit(false); return false; }} onCancel={() => setEdit(false)} />
      </div>
    );
  }
  return (
    <div className={`rounded-md border border-neutral-800 bg-neutral-950/50 px-3 py-2.5 ${archived || unused ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-neutral-100">{p.name}</div>
          <div className="mt-0.5 text-[13px] leading-snug text-neutral-300">{p.rule}</div>
        </div>
        <div className="flex shrink-0 gap-1">
          {!archived && <IconBtn label="Edit" onClick={() => setEdit(true)}><Pencil className="h-3.5 w-3.5" /></IconBtn>}
          {archived
            ? <IconBtn label="Restore" onClick={() => patch({ status: 'active' })}><RotateCcw className="h-3.5 w-3.5" /></IconBtn>
            : <IconBtn label="Archive (AI stops using it)" onClick={() => patch({ status: 'archived' })}><Archive className="h-3.5 w-3.5" /></IconBtn>}
        </div>
      </div>
      {p.applies_when && <div className="mt-1.5 text-[12px] text-neutral-400"><span className="text-neutral-600">When: </span>{p.applies_when}</div>}
      {p.caveat && <div className="mt-0.5 text-[12px] text-amber-200/70"><span className="text-neutral-600">Caveat: </span>{p.caveat}</div>}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-neutral-600">
        {(p.tags || []).map((t) => <span key={t} className="rounded border border-neutral-800 px-1.5 py-0.5">{t}</span>)}
        {p.checks?.length > 0 && <span title="Data the system computes that shows this in play">checks: {p.checks.map((c) => CHECK_LABELS[c] || c).join(', ')}</span>}
        <span>{p.source || 'me'} · {etDay(p.created_at)}</span>
        {unused && <span className="text-amber-300/80">not reaching the AI (over {MAX_ACTIVE})</span>}
        {take && (
          <button onClick={() => setShowTake((s) => !s)} className="text-neutral-500 hover:text-neutral-300 hover:underline">
            {showTake ? 'hide original' : 'original take'}
          </button>
        )}
      </div>
      {showTake && take && <div className="mt-2 whitespace-pre-wrap rounded border border-neutral-900 px-2.5 py-2 text-[12px] leading-relaxed text-neutral-500">{take.text}</div>}
      {err && <div className="mt-1 text-[12px] text-rose-300">{err}</div>}
    </div>
  );
}

function IconBtn({ label, onClick, children }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className="rounded border border-neutral-800 p-1.5 text-neutral-500 hover:text-neutral-100">
      {children}
    </button>
  );
}

function ArchivedList({ rows, takeById, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <button onClick={() => setOpen((o) => !o)} className="mb-2 inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.22em] text-neutral-500 hover:text-neutral-300">
        Archived ({rows.length}) {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && <div className="space-y-2">{rows.map((p) => <PrincipleCard key={p.id} p={p} take={takeById.get(p.take_id)} archived onChange={onChange} />)}</div>}
    </section>
  );
}
