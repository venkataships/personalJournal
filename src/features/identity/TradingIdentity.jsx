import { useState, useEffect, useCallback } from 'react';

// Static manifesto. Edit values here, not in markup.
const MANIFESTO = {
  header: 'Trading Like Sujay',
  sections: [
    { label: 'My Style',     value: 'Catalyst-driven swing trader. 2–10 day holds. Fundamental thesis confirmed by momentum.' },
    { label: 'My Strengths', value: 'Macro theme identification. Fundamental analysis. Conviction when researched.' },
    { label: 'My Weaknesses', value: 'FOMO entries. Complexity addiction. Emotional management. Need for involvement.' },
    { label: 'My System Protects Me From', value: 'Myself.' },
  ],
  punchline: {
    label: 'My Greatest Strength',
    value: 'The trades I don’t take.',
  },
};

export default function TradingIdentity() {
  // Render dismissed state immediately so the splash doesn't flash on
  // re-mounts within the same session (e.g., HMR during dev). It still shows
  // on every full page load, which is what the user asked for.
  const [visible, setVisible] = useState(true);
  const [exiting, setExiting] = useState(false);

  const dismiss = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    // Match the CSS transition duration below.
    setTimeout(() => setVisible(false), 350);
  }, [exiting]);

  // Keyboard: Escape or Enter dismisses.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        dismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  // Lock background scroll while visible.
  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Trading identity manifesto"
      onClick={dismiss}
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0a0a0a] cursor-pointer transition-opacity duration-[350ms] ${
        exiting ? 'opacity-0' : 'opacity-100 animate-[fadeIn_400ms_ease-out]'
      }`}
      style={{
        // Inline keyframes so we don't depend on Tailwind config additions.
        // animate-[fadeIn_400ms_ease-out] above references this.
      }}
    >
      {/* Background grid texture, matches dashboard */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Inline keyframes — kept here so the component is self-contained */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes lineIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="relative mx-auto max-w-xl px-6 py-10 text-center">
        {/* Header */}
        <div
          className="font-mono text-[10px] uppercase tracking-[0.3em] text-emerald-400/80"
          style={{ animation: 'lineIn 500ms ease-out 100ms both' }}
        >
          — Manifesto —
        </div>
        <h1
          className="mt-3 text-2xl font-light tracking-tight text-neutral-100 sm:text-3xl"
          style={{ animation: 'lineIn 500ms ease-out 200ms both' }}
        >
          {MANIFESTO.header}
        </h1>

        {/* Hairline divider */}
        <div
          className="mx-auto mt-7 h-px w-16 bg-emerald-500/60"
          style={{ animation: 'lineIn 500ms ease-out 300ms both' }}
        />

        {/* Sections */}
        <div className="mt-8 space-y-6 sm:space-y-7">
          {MANIFESTO.sections.map((s, i) => (
            <div
              key={s.label}
              style={{ animation: `lineIn 500ms ease-out ${400 + i * 120}ms both` }}
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-neutral-500">
                {s.label}
              </div>
              <div className="mt-1.5 text-[15px] leading-relaxed text-neutral-200 sm:text-base">
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* Punchline — emphasized */}
        <div
          className="mt-10 pt-8 border-t border-neutral-800/80"
          style={{ animation: `lineIn 500ms ease-out ${400 + MANIFESTO.sections.length * 120 + 100}ms both` }}
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-400/80">
            {MANIFESTO.punchline.label}
          </div>
          <div className="mt-2 text-xl font-light leading-snug text-emerald-300 sm:text-2xl">
            {MANIFESTO.punchline.value}
          </div>
        </div>

        {/* Dismiss hint */}
        <div
          className="mt-12 font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-700"
          style={{ animation: `lineIn 500ms ease-out ${400 + MANIFESTO.sections.length * 120 + 400}ms both` }}
        >
          Tap anywhere to continue
        </div>
      </div>
    </div>
  );
}
