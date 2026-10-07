import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Home, LayoutDashboard, Radar, Eye, BookText, Briefcase, Brain, Sparkles, Search, History } from 'lucide-react';

// One bar across every trading page. Scrolls sideways on a phone.
const LINKS = [
  { to: '/trading',       label: 'Home',         icon: Home, end: true },
  { to: '/dashboard',     label: 'Dashboard',    icon: LayoutDashboard },
  { to: '/sectors',       label: 'Sectors',      icon: Radar },
  { to: '/watchlist',     label: 'Watchlist',    icon: Eye },
  { to: '/lookup',        label: 'Lookup',       icon: Search },
  { to: '/notes',         label: 'AI notes',     icon: History },
  { to: '/journal',       label: 'Journal',      icon: BookText },
  { to: '/positions',     label: 'Positions',    icon: Briefcase },
  { to: '/intelligence',  label: 'Intelligence', icon: Brain },
  { to: '/tomorrow-prep', label: 'Prep',         icon: Sparkles },
];

export function TradingNav() {
  return (
    <nav aria-label="Trading pages"
      className="sticky top-0 z-40 border-b border-neutral-900 bg-[#0a0a0a]/90 backdrop-blur supports-[backdrop-filter]:bg-[#0a0a0a]/75">
      <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 py-1.5 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden">
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}
            className={({ isActive }) => `inline-flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1.5 text-[12px] transition-colors ${
              isActive ? 'bg-emerald-500/10 text-emerald-300' : 'text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200'}`}>
            <l.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
            {l.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export default function TradingLayout() {
  // A new page starts at the top (links deep in one page used to open the next one scrolled down).
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      <TradingNav />
      <Outlet />
    </div>
  );
}
