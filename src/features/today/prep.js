// Data + Claude call for the evening prep checklist (moved from the old Tomorrow's Prep page).
// Note: generation calls Claude from the browser with the VITE_ key — moving it server-side is on the backlog.
import { supabase, authReady } from '../../lib/supabase';
import { anthropic, CLAUDE_MODEL } from '../../lib/claude';

export function localDay(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function nextDay(d = new Date()) {
  const t = new Date(d);
  t.setDate(t.getDate() + 1);
  return localDay(t);
}

export const CHECKIN_LABELS = {
  trading_ready:       'Trading ready',
  work_focused:        'Work focused',
  movement_done:       'Movement done',
  device_boundaries:   'Device boundaries kept',
  present_with_akhila: 'Present with Akhila',
};

// ---------------------------------------------------------------------------
// Data layer
// ---------------------------------------------------------------------------

export async function fetchLifeJournal(dateKey) {
  await authReady();
  const { data, error } = await supabase
    .from('life_journal').select('*').eq('date', dateKey).maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchActiveRules() {
  await authReady();
  const { data, error } = await supabase
    .from('trade_rules')
    .select('rule_number, rule_text')
    .eq('is_active', true)
    .order('rule_number', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function fetchPrep(forDate) {
  await authReady();
  const { data, error } = await supabase
    .from('daily_prep').select('*').eq('for_date', forDate).maybeSingle();
  if (error) throw error;
  return data;
}

export async function savePrep(row) {
  await authReady();
  const { error } = await supabase
    .from('daily_prep')
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'for_date' });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Claude call
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a personal accountability coach analyzing someone's daily journal to create tomorrow's prep checklist.

The user has trading rules they must follow. Analyze their journal entry and check-in results to identify:
1. What rules were violated today
2. What habits were missed
3. What needs specific attention tomorrow

Return ONLY valid JSON in this exact format, with no surrounding prose, code fences, or commentary:
{
  "trading": ["specific action 1", "specific action 2", "specific action 3"],
  "work": ["specific action 1", "specific action 2"],
  "life": ["specific action 1", "specific action 2"],
  "priority": "single most important thing for tomorrow in one sentence"
}

Be specific and direct. Reference actual things from their journal. Maximum 3 items per category. No generic advice. If a check-in was missed, address it. If it was met, reinforce it briefly.`;

function buildUserMessage({ intention, checkIns, lifeEntry, rules }) {
  const checkInLines = Object.entries(CHECKIN_LABELS).map(([key, label]) => {
    const v = checkIns?.[key];
    const display = v === true ? 'yes' : v === false ? 'no' : 'not answered';
    return `- ${label}: ${display}`;
  }).join('\n');

  const rulesText = rules
    .map((r) => `${r.rule_number}. ${r.rule_text}`)
    .join('\n');

  const lifeBlock = lifeEntry
    ? `
Today's life-journal entry:
- Energy level (1-10): ${lifeEntry.energy_level ?? 'n/a'}
- Work presence (1-10): ${lifeEntry.work_presence ?? 'n/a'}
- Device-free hours: ${lifeEntry.device_free_hours ?? 'n/a'}
- SaaS progress: ${lifeEntry.saas_progress ? 'yes' : 'no'}
- Grateful for: ${lifeEntry.grateful_for || '(blank)'}
- Improve tomorrow: ${lifeEntry.improve_tomorrow || '(blank)'}
- Tomorrow's priority (their note): ${lifeEntry.tomorrow_priority || '(blank)'}
- Note about Akhila: ${lifeEntry.akhila_note || '(blank)'}`
    : '\n(No life-journal entry for today.)';

  return `Today's intention: ${intention || '(blank)'}

Today's check-ins:
${checkInLines}
${lifeBlock}

Trading rules:
${rulesText}

Generate tomorrow's prep checklist based on what actually happened today.`;
}

export async function generatePrep({ intention, checkIns, lifeEntry, rules }) {
  const userMessage = buildUserMessage({ intention, checkIns, lifeEntry, rules });

  const resp = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  // Extract text from content blocks (resp.content is an array).
  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Strip code fences if Claude added them despite instructions.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Claude returned non-JSON output. Raw: ${text.slice(0, 200)}`);
  }

  // Defensive normalization. Don't trust Claude's shape.
  const toItems = (arr) =>
    (Array.isArray(arr) ? arr : []).filter((x) => typeof x === 'string').map((text) => ({ text, done: false }));

  return {
    trading_items: toItems(parsed.trading),
    work_items:    toItems(parsed.work),
    life_items:    toItems(parsed.life),
    priority:      typeof parsed.priority === 'string' ? parsed.priority : '',
    usage: {
      model: CLAUDE_MODEL,
      prompt_tokens:     resp.usage?.input_tokens ?? null,
      completion_tokens: resp.usage?.output_tokens ?? null,
    },
  };
}

