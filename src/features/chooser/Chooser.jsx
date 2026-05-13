import { Link } from 'react-router-dom';
import { TrendingUp, HeartPulse } from 'lucide-react';

// Two-button entry point. No data, no decisions. Just: which mode are you in?
// Visual contrast carries the meaning: emerald cockpit on one side, amber
// journal on the other.

export default function Chooser() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-200 antialiased">
      {/* Subtle grid texture, like the rest of the app */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col px-5 py-8 sm:px-8 sm:py-10">
        {/* Tiny header — date and one line. No greeting, no instructions. */}
        <div className="text-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-700">
            Command Center
          </div>
          <div className="mt-1 font-mono text-[11px] text-neutral-600">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long', month: 'long', day: 'numeric',
            })}
          </div>
        </div>

        {/* Two cards, stretched to fill the viewport */}
        <div className="mt-8 flex-1 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
          <ChoiceCard
            to="/trading"
            tone="trading"
            icon={TrendingUp}
            label="Trading"
            sublabel="Discipline. Rules. The cockpit."
          />
          <ChoiceCard
            to="/life"
            tone="life"
            icon={HeartPulse}
            label="Life"
            sublabel="Presence. Words. The journal."
          />
        </div>
      </div>
    </div>
  );
}

function ChoiceCard({ to, tone, icon: Icon, label, sublabel }) {
  // tone === 'trading' | 'life'
  const isLife = tone === 'life';
  return (
    <Link
      to={to}
      className={`group relative flex flex-col items-center justify-center rounded-md border transition-all active:scale-[0.99]
        ${isLife
          ? 'border-neutral-800 hover:border-amber-500/50 hover:bg-amber-500/[0.03]'
          : 'border-neutral-800 hover:border-emerald-500/50 hover:bg-emerald-500/[0.03]'}
        bg-neutral-950/40
        min-h-[280px] sm:min-h-[420px]
      `}
    >
      <Icon
        className={`h-10 w-10 transition-colors
          ${isLife
            ? 'text-amber-400/70 group-hover:text-amber-400'
            : 'text-emerald-400/70 group-hover:text-emerald-400'}
        `}
        strokeWidth={1.25}
      />

      <div
        className={`mt-6 text-3xl sm:text-4xl
          ${isLife
            ? 'font-serif font-light text-neutral-100'
            : 'font-sans font-light tracking-tight text-neutral-100'}
        `}
      >
        {label}
      </div>

      <div
        className={`mt-3 px-6 text-center text-[13px]
          ${isLife
            ? 'font-serif italic text-neutral-500'
            : 'font-mono uppercase tracking-[0.18em] text-neutral-500'}
        `}
      >
        {sublabel}
      </div>
    </Link>
  );
}
