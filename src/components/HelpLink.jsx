import { Link } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';

// Small "?" that opens the Guide at the section explaining this panel.
export default function HelpLink({ to, label = 'How this works' }) {
  return (
    <Link to={`/guide#${to}`} title={label} aria-label={label}
      className="inline-flex items-center text-neutral-600 hover:text-emerald-300">
      <HelpCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
    </Link>
  );
}
