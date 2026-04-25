import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  AlertCircle,
  Check,
  Loader2,
} from 'lucide-react';
import { supabase, authReady } from '../../lib/supabase';
import { anthropic, CLAUDE_MODEL } from '../../lib/claude';

// ---------------------------------------------------------------------------
// Editable copy & config — change here, not in markup
// ---------------------------------------------------------------------------

const REFLECTION_PROMPTS = [
  'What moment today felt most alive?',
  'What was I avoiding today?',
  'What would the joyful kid version of me think of today?',
  'What am I grateful for that I almost didn\'t notice?',
];

const ALIVE_LABELS = [
  { upTo: 3,  text: 'Going through motions' },
  { upTo: 6,  text: 'Present but distracted' },
  { upTo: 8,  text: 'Genuinely engaged' },
  { upTo: 10, text: 'Fully alive' },
];

const PHONE_REACTIONS = [
  { upTo: 1,    emoji: '🌟', text: 'Excellent' },
  { upTo: 3,    emoji: '👍', text: 'Good' },
  { upTo: 5,    emoji: '⚠️', text: 'Watch this' },
  { upTo: 999,  emoji: '🔴', text: 'This is stealing your presence' },
];

const MOVEMENT_TYPES = ['Walk', 'Gym', 'Yoga', 'Sports', 'Other'];

// Reflection system prompt — no biography, no priming. Just an honest mirror.
const REFLECTION_SYSTEM_PROMPT = `You are a gentle, honest mirror for someone writing in their journal.

Your role is NOT to:
- Give advice
- Fix problems
- Motivate with generic encouragement

Your role IS to:
- Reflect back what you genuinely observe in their words
- Notice one thing they might have missed about their own experience
- Acknowledge something genuine without exaggerating
- End with one question that helps them go deeper

Tone: Warm but honest. Like a wise friend who actually listens. Not a therapist. Not a coach.

Format: 3 to 4 sentences. End with one genuine question. Never bullet points — this is a conversation, not a report.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatLongDate(d = new Date()) {
  return d.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

function aliveLabel(n) {
  if (n == null) return '';
  return ALIVE_LABELS.find((l) => n <= l.upTo)?.text || '';
}

function phoneReaction(n) {
  if (n == null || n === '') return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return PHONE_REACTIONS.find((r) => v <= r.upTo);
}

// ---------------------------------------------------------------------------
// Data layer
// ---------------------------------------------------------------------------

async function fetchEntry(dateKey) {
  await authReady();
  const { data, error } = await supabase
    .from('life_journal').select('*').eq('date', dateKey).maybeSingle();
  if (error) throw error;
  return data;
}

async function upsertEntry(dateKey, patch) {
  await authReady();
  const { error } = await supabase
    .from('life_journal')
    .upsert(
      { date: dateKey, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'date' },
    );
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LifeJournal() {
  const dateKey = todayKey();

  // --- State -----------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(0);

  // Field state (one big bag — this form is mostly controlled inputs)
  const [alive, setAlive] = useState(5);
  const [akhilaQuality, setAkhilaQuality] = useState(null); // bool | null
  const [akhilaNote, setAkhilaNote] = useState('');
  const [connected, setConnected] = useState(null);
  const [connectedNote, setConnectedNote] = useState('');

  const [moved, setMoved] = useState(null);
  const [movementType, setMovementType] = useState('');
  const [bodyFeel, setBodyFeel] = useState(5);
  const [sleepHours, setSleepHours] = useState('');

  const [phoneHours, setPhoneHours] = useState('');
  const [presentEvening, setPresentEvening] = useState(null);

  const [builtMeaningful, setBuiltMeaningful] = useState(null);
  const [builtNote, setBuiltNote] = useState('');
  const [joyToday, setJoyToday] = useState(null);
  const [joyNote, setJoyNote] = useState('');

  const [freeWrite, setFreeWrite] = useState('');
  const [activePrompt, setActivePrompt] = useState(null); // index | null

  const [tomorrowIntention, setTomorrowIntention] = useState('');
  const [lettingGo, setLettingGo] = useState('');

  // Reflection state
  const [reflectionText, setReflectionText] = useState('');
  const [reflectionAt, setReflectionAt] = useState(null);
  const [reflecting, setReflecting] = useState(false);

  // --- Load on mount ---------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const row = await fetchEntry(dateKey);
        if (cancelled) return;
        if (row) {
          setAlive(row.energy_level ?? 5);
          setAkhilaQuality(row.akhila_quality_time);
          setAkhilaNote(row.akhila_note || '');
          setConnected(row.connected_someone);
          setConnectedNote(row.connected_note || '');
          setMoved(row.movement_done);
          setMovementType(row.movement_type || '');
          setBodyFeel(row.body_feel ?? 5);
          setSleepHours(row.sleep_hours ?? '');
          setPhoneHours(row.phone_hours_nonwork ?? '');
          setPresentEvening(row.present_in_evening);
          setBuiltMeaningful(row.built_meaningful);
          setBuiltNote(row.built_note || '');
          setJoyToday(row.joy_today);
          setJoyNote(row.joy_note || '');
          setFreeWrite(row.free_write || '');
          setTomorrowIntention(row.tomorrow_priority || '');
          setLettingGo(row.letting_go || '');
          setReflectionText(row.reflection_text || '');
          setReflectionAt(row.reflection_at || null);
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dateKey]);

  // --- Save ------------------------------------------------------------------
  const onSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await upsertEntry(dateKey, {
        energy_level: alive,
        akhila_quality_time: akhilaQuality,
        present_with_akhila: akhilaQuality, // keep legacy column in sync
        akhila_note: akhilaNote || null,
        connected_someone: connected,
        connected_note: connectedNote || null,
        movement_done: moved,
        movement_type: moved ? (movementType || null) : null,
        body_feel: bodyFeel,
        sleep_hours: sleepHours === '' ? null : Number(sleepHours),
        phone_hours_nonwork: phoneHours === '' ? null : Number(phoneHours),
        present_in_evening: presentEvening,
        built_meaningful: builtMeaningful,
        built_note: builtNote || null,
        joy_today: joyToday,
        joy_note: joyNote || null,
        free_write: freeWrite || null,
        tomorrow_priority: tomorrowIntention || null,
        letting_go: lettingGo || null,
      });
      setSavedAt(Date.now());
    } catch (e) {
      setError(e.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }, [
    dateKey, alive, akhilaQuality, akhilaNote, connected, connectedNote,
    moved, movementType, bodyFeel, sleepHours, phoneHours, presentEvening,
    builtMeaningful, builtNote, joyToday, joyNote, freeWrite,
    tomorrowIntention, lettingGo,
  ]);

  // --- Reflection ------------------------------------------------------------
  const buildReflectionInput = useCallback(() => {
    const yn = (b) => b === true ? 'yes' : b === false ? 'no' : 'not answered';
    const note = (n) => n?.trim() ? ` — ${n.trim()}` : '';
    return [
      `Alive feeling: ${alive}/10`,
      `Quality time with Akhila: ${yn(akhilaQuality)}${note(akhilaNote)}`,
      `Connected with someone: ${yn(connected)}${note(connectedNote)}`,
      `Movement: ${yn(moved)}${moved && movementType ? ` — ${movementType}` : ''}`,
      `Body feel: ${bodyFeel}/10`,
      sleepHours !== '' ? `Sleep last night: ${sleepHours} hours` : null,
      phoneHours !== '' ? `Phone hours (non-work): ${phoneHours}` : null,
      `Present in evening: ${yn(presentEvening)}`,
      `Built something meaningful: ${yn(builtMeaningful)}${note(builtNote)}`,
      `Did something for pure joy: ${yn(joyToday)}${note(joyNote)}`,
      '',
      'What I wrote:',
      freeWrite || '(left blank)',
      '',
      `Tomorrow's intention: ${tomorrowIntention || '(blank)'}`,
      `Letting go of: ${lettingGo || '(blank)'}`,
      '',
      'Please reflect this back to me honestly.',
    ].filter((l) => l !== null).join('\n');
  }, [
    alive, akhilaQuality, akhilaNote, connected, connectedNote, moved,
    movementType, bodyFeel, sleepHours, phoneHours, presentEvening,
    builtMeaningful, builtNote, joyToday, joyNote, freeWrite,
    tomorrowIntention, lettingGo,
  ]);

  const onReflect = useCallback(async () => {
    setReflecting(true);
    setError(null);
    try {
      const resp = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 400,
        system: REFLECTION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildReflectionInput() }],
      });
      const text = resp.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      const stamp = new Date().toISOString();
      setReflectionText(text);
      setReflectionAt(stamp);
      // Persist alongside the entry
      await upsertEntry(dateKey, {
        reflection_text: text,
        reflection_at: stamp,
      });
    } catch (e) {
      setError(e.message || 'Reflection failed.');
    } finally {
      setReflecting(false);
    }
  }, [dateKey, buildReflectionInput]);

  // --- Saved indicator -------------------------------------------------------
  const savedVisible = Date.now() - savedAt < 1500;
  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setSavedAt((s) => s), 1600); // force tick
    return () => clearTimeout(t);
  }, [savedAt]);

  // --- Render ----------------------------------------------------------------

  const phoneReact = phoneReaction(phoneHours);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 antialiased selection:bg-amber-500/30">
      {/* Softer texture than trading screens — fewer grid lines, lower opacity */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="relative mx-auto max-w-2xl px-6 py-12 sm:px-10 sm:py-16">
        {/* Header */}
        <header className="mb-12">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-[12px] text-neutral-500 hover:text-amber-400 transition-colors"
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={2} />
            Home
          </Link>

          <div className="mt-6 flex items-baseline justify-between">
            <h1 className="font-serif text-4xl font-light tracking-tight text-neutral-100 sm:text-5xl">
              Life journal
            </h1>
            <span
              className={`text-[11px] text-amber-400 transition-opacity duration-500 ${
                savedVisible ? 'opacity-100' : 'opacity-0'
              }`}
            >
              ✓ saved
            </span>
          </div>
          <p className="mt-2 font-mono text-[12px] text-neutral-500">
            {formatLongDate(new Date())}
          </p>
          <p className="mt-6 font-serif text-[18px] italic text-neutral-400">
            What actually happened today?
          </p>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-[13px] text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
              <span>{error}</span>
            </div>
          )}
        </header>

        {loading ? (
          <div className="text-neutral-500 text-sm">Loading today's entry…</div>
        ) : (
          <div className="space-y-14">
            {/* ─── Section 1: Energy & Presence ─── */}
            <Section title="Energy & presence">
              <Question label="How alive did I feel today?">
                <Slider value={alive} onChange={setAlive} min={1} max={10} />
                <div className="mt-2 font-serif italic text-[14px] text-amber-300/90">
                  {aliveLabel(alive)}
                </div>
              </Question>

              <Question label="Quality time with Akhila today?">
                <YesNo value={akhilaQuality} onChange={setAkhilaQuality} />
                {akhilaQuality === true && (
                  <LineInput
                    value={akhilaNote}
                    onChange={setAkhilaNote}
                    placeholder="What did you do together?"
                  />
                )}
                {akhilaQuality === false && (
                  <LineInput
                    value={akhilaNote}
                    onChange={setAkhilaNote}
                    placeholder="What got in the way?"
                  />
                )}
              </Question>

              <Question label="Connected with someone meaningful today?">
                <YesNo value={connected} onChange={setConnected} />
                {connected === true && (
                  <LineInput
                    value={connectedNote}
                    onChange={setConnectedNote}
                    placeholder="Who, and how?"
                  />
                )}
              </Question>
            </Section>

            {/* ─── Section 2: Body & Movement ─── */}
            <Section title="Body & movement">
              <Question label="Did you move your body today?">
                <YesNo value={moved} onChange={setMoved} />
                {moved === true && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {MOVEMENT_TYPES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setMovementType(t)}
                        className={`rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
                          movementType === t
                            ? 'border-amber-500/60 bg-amber-500/10 text-amber-200'
                            : 'border-neutral-800 text-neutral-400 hover:border-neutral-700'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </Question>

              <Question label="How did your body feel today?">
                <Slider value={bodyFeel} onChange={setBodyFeel} min={1} max={10} />
              </Question>

              <Question label="Sleep last night">
                <NumberInput
                  value={sleepHours}
                  onChange={setSleepHours}
                  suffix="hours"
                  step="0.5"
                  placeholder="7.5"
                />
              </Question>
            </Section>

            {/* ─── Section 3: Device & Presence ─── */}
            <Section title="Device & presence">
              <Question label="Estimated hours on phone today (non-work)">
                <NumberInput
                  value={phoneHours}
                  onChange={setPhoneHours}
                  suffix="hours"
                  step="0.5"
                  placeholder="2"
                />
                {phoneReact && (
                  <div className="mt-2 font-serif italic text-[14px] text-neutral-400">
                    <span className="mr-2">{phoneReact.emoji}</span>
                    {phoneReact.text}
                  </div>
                )}
              </Question>

              <Question label="Were you mentally present during dinner / evening?">
                <YesNo value={presentEvening} onChange={setPresentEvening} />
              </Question>
            </Section>

            {/* ─── Section 4: Building & Purpose ─── */}
            <Section title="Building & purpose">
              <Question label="Did you make progress on something that matters to you?">
                <YesNo value={builtMeaningful} onChange={setBuiltMeaningful} />
                {builtMeaningful === true && (
                  <LineInput
                    value={builtNote}
                    onChange={setBuiltNote}
                    placeholder="What did you build or create?"
                  />
                )}
                {builtMeaningful === false && (
                  <LineInput
                    value={builtNote}
                    onChange={setBuiltNote}
                    placeholder="What got in the way?"
                  />
                )}
              </Question>

              <Question
                label="Did you do something purely for joy today?"
                hint="Not productive. Not optimized. Just enjoyable."
              >
                <YesNo value={joyToday} onChange={setJoyToday} />
                {joyToday === true && (
                  <LineInput
                    value={joyNote}
                    onChange={setJoyNote}
                    placeholder="What was it?"
                  />
                )}
              </Question>
            </Section>

            {/* ─── Section 5: The Real Journal ─── */}
            <Section title="What actually happened today" subtle>
              <p className="font-serif italic text-[15px] leading-relaxed text-neutral-400 mb-4">
                How did it feel?
              </p>
              <textarea
                value={freeWrite}
                onChange={(e) => setFreeWrite(e.target.value)}
                rows={10}
                placeholder={
                  activePrompt != null
                    ? REFLECTION_PROMPTS[activePrompt]
                    : 'Write freely. No one is grading this. Just you and your honest experience of today.'
                }
                className="w-full resize-y rounded border border-neutral-800/80 bg-neutral-950/40 px-5 py-4 font-serif text-[16px] leading-[1.7] text-neutral-100 placeholder:text-neutral-600 placeholder:italic focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-colors"
              />

              {/* Prompts — only show when free-write is empty */}
              {!freeWrite && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {REFLECTION_PROMPTS.map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setActivePrompt(i === activePrompt ? null : i)}
                      className={`rounded-full border px-3 py-1.5 text-[12px] font-serif italic transition-colors ${
                        activePrompt === i
                          ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                          : 'border-neutral-800 text-neutral-500 hover:border-neutral-700 hover:text-neutral-300'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </Section>

            {/* ─── Section 6: Tomorrow's Intention ─── */}
            <Section title="Before sleeping">
              <Question label="One thing that would make tomorrow feel meaningful">
                <LineInput
                  value={tomorrowIntention}
                  onChange={setTomorrowIntention}
                  placeholder=""
                  big
                />
              </Question>
              <Question label="One thing I want to let go of before sleeping">
                <LineInput
                  value={lettingGo}
                  onChange={setLettingGo}
                  placeholder=""
                  big
                />
              </Question>
            </Section>

            {/* Save button */}
            <div className="pt-4">
              <button
                type="button"
                onClick={onSave}
                disabled={saving}
                className="w-full rounded border border-amber-500/40 bg-amber-500/10 px-5 py-4 font-serif text-[15px] tracking-wide text-amber-200 hover:bg-amber-500/15 hover:border-amber-500/60 transition-all active:scale-[0.99] disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save today\'s reflection'}
              </button>
            </div>

            {/* Reflection — Claude */}
            {savedAt > 0 || reflectionText ? (
              <div className="pt-2">
                {reflectionText ? (
                  <ReflectionCard
                    text={reflectionText}
                    timestamp={reflectionAt}
                    onAskAgain={onReflect}
                    busy={reflecting}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={onReflect}
                    disabled={reflecting}
                    className="w-full text-left rounded border border-dashed border-neutral-700 bg-neutral-950/30 px-5 py-4 font-serif italic text-[14px] text-neutral-400 hover:border-amber-500/40 hover:text-amber-200 hover:bg-amber-500/5 transition-all disabled:opacity-50"
                  >
                    {reflecting ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                        Reading what you wrote…
                      </span>
                    ) : (
                      'Ask for a reflection on this →'
                    )}
                  </button>
                )}
              </div>
            ) : null}
          </div>
        )}

        <footer className="mt-20 text-center font-serif text-[12px] italic text-neutral-700">
          A page in a long book.
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components — note the deliberately softer style (no uppercase, lighter
// borders, more padding) to differentiate from trading screens
// ---------------------------------------------------------------------------

function Section({ title, subtle, children }) {
  return (
    <section>
      {!subtle && (
        <h2 className="font-serif text-[15px] font-normal text-neutral-400 mb-6">
          {title}
        </h2>
      )}
      {subtle && (
        <h2 className="font-serif text-[20px] font-light text-neutral-200 mb-2">
          {title}
        </h2>
      )}
      <div className="space-y-7">{children}</div>
    </section>
  );
}

function Question({ label, hint, children }) {
  return (
    <div>
      <div className="font-serif text-[15px] text-neutral-200">{label}</div>
      {hint && (
        <div className="mt-0.5 font-serif text-[13px] italic text-neutral-500">
          {hint}
        </div>
      )}
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Slider({ value, onChange, min, max }) {
  return (
    <div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-amber-500"
      />
      <div className="mt-1 flex justify-between font-mono text-[10px] text-neutral-600">
        <span>{min}</span>
        <span className="text-amber-300">{value}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function YesNo({ value, onChange }) {
  return (
    <div className="flex gap-2">
      {[
        { v: true,  label: 'Yes' },
        { v: false, label: 'No' },
      ].map((o) => {
        const active = value === o.v;
        return (
          <button
            key={o.label}
            type="button"
            onClick={() => onChange(active ? null : o.v)}
            className={`rounded-full border px-5 py-1.5 text-[13px] transition-colors ${
              active
                ? 'border-amber-500/60 bg-amber-500/10 text-amber-200'
                : 'border-neutral-800 text-neutral-400 hover:border-neutral-700'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function LineInput({ value, onChange, placeholder, big }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`mt-3 w-full rounded border border-neutral-800/80 bg-transparent px-3 py-2 font-serif italic text-neutral-100 placeholder:text-neutral-600 focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-colors ${
        big ? 'text-[16px]' : 'text-[14px]'
      }`}
    />
  );
}

function NumberInput({ value, onChange, suffix, step, placeholder }) {
  return (
    <div className="flex items-baseline gap-2">
      <input
        type="number"
        step={step || '1'}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-24 rounded border border-neutral-800/80 bg-transparent px-3 py-2 font-mono text-[15px] tabular-nums text-neutral-100 placeholder:text-neutral-700 focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/30 transition-colors"
      />
      <span className="font-serif text-[13px] text-neutral-500">{suffix}</span>
    </div>
  );
}

function ReflectionCard({ text, timestamp, onAskAgain, busy }) {
  return (
    <div className="rounded border-l-2 border-amber-500/60 bg-amber-500/[0.03] px-6 py-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400/70 mb-3">
        Reflection
      </div>
      <p className="font-serif text-[15px] leading-[1.8] text-neutral-200 whitespace-pre-wrap">
        {text}
      </p>
      <div className="mt-5 flex items-center justify-between text-[11px]">
        <span className="font-mono text-neutral-600">
          {timestamp ? new Date(timestamp).toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
          }) : ''}
        </span>
        <button
          type="button"
          onClick={onAskAgain}
          disabled={busy}
          className="font-serif italic text-neutral-500 hover:text-amber-400 transition-colors disabled:opacity-50"
        >
          {busy ? 'Reading…' : 'Ask again'}
        </button>
      </div>
    </div>
  );
}
