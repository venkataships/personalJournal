import { DET_LABELS } from '../lib/deterioration';

// Deterioration score chip. Hidden at 0-1 unless `always` — "intact" is the normal state
// and a chip on every row would be noise. Hover for the signs and the numbers behind them.
const TONE = {
  intact:        'border-neutral-700 text-neutral-400',
  watch:         'border-amber-500/40 bg-amber-500/10 text-amber-200',
  deteriorating: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
};

export default function DetChip({ d, always = false, compact = false }) {
  if (!d || d.score == null) return null;
  if (!always && d.score < 2) return null;
  const tip = [
    `Deterioration ${d.score}/5 — ${d.label}`,
    ...(d.signs || []).map((s) => `• ${DET_LABELS[s] || s}: ${d.detail?.[s] || ''}`),
    d.score < 2 ? 'Trend structure intact (Playbook: wait for deterioration before fading strength)' : null,
  ].filter(Boolean).join('\n');
  return (
    <span title={tip}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] ${TONE[d.label] || TONE.intact}`}>
      <span aria-hidden>{d.score >= 2 ? '◢' : '◆'}</span>
      {compact ? `${d.score}/5` : `Det ${d.score}/5`}
      <span className="sr-only">{d.label}</span>
    </span>
  );
}
