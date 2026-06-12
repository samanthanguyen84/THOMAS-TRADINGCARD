import { useContext } from 'react';
import { NavLink } from 'react-router-dom';
import { AlertsContext } from '../alertsContext.js';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '📊', end: true },
  { to: '/prices', label: 'Price Lookup', icon: '🔎' },
  { to: '/inventory', label: 'Inventory', icon: '🗃️' },
  { to: '/money', label: 'Sales & Money', icon: '💵' },
  { to: '/shows', label: 'Shows', icon: '🎪' },
  { to: '/watch', label: 'Restock Watch', icon: '📦' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function Layout({ children }) {
  const { count } = useContext(AlertsContext);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">🎴</span>
          <span className="brand-name">
            Thomas&rsquo;s Card Shop
            <span className="brand-sub">trading card vendor</span>
          </span>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
              {item.to === '/watch' && count > 0 && (
                <span className="badge" title={`${count} unseen alert${count === 1 ? '' : 's'}`}>
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">Pricing at % of market · weekend shows</div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
