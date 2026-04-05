import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, LineChart, BookOpen, Grid2X2,
  List, Bell, BookMarked, FlaskConical, TrendingUp, BarChart2, Activity,
} from 'lucide-react';

const links = [
  { to: '/dashboard',       label: 'Dashboard',      icon: LayoutDashboard },
  { to: '/chart',           label: 'Chart',          icon: LineChart },
  { to: '/watchlist-charts',label: 'All Charts',     icon: Grid2X2 },
  { to: '/signals',         label: 'Signals',        icon: TrendingUp },
  { to: '/fundamentals',    label: 'Fundamentals',   icon: BarChart2 },
  { to: '/moving-average',  label: '12 MovingAve',   icon: Activity },
  { to: '/options',         label: 'Options',        icon: BookOpen },
  { to: '/calls-matrix',   label: 'Calls Matrix',   icon: List },
  { to: '/alerts',          label: 'Alerts',         icon: Bell },
  { to: '/journal',         label: 'Journal',        icon: BookMarked },
  { to: '/backtest',        label: 'Backtest',       icon: FlaskConical },
];

export default function Sidebar() {
  return (
    <aside className="w-48 shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col py-4">
      <div className="px-4 mb-6">
        <span className="text-blue-400 font-bold text-sm tracking-wider uppercase">StockApp</span>
      </div>
      <nav className="flex-1 space-y-0.5 px-2">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-xs transition-colors ${
                isActive
                  ? 'bg-blue-600/20 text-blue-400'
                  : 'text-gray-300 hover:text-white hover:bg-gray-800'
              }`
            }
          >
            <Icon size={14} />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
