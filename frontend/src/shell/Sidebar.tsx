import { NavLink } from 'react-router-dom'

import {
  DashboardIcon,
  InstructorsIcon,
  PlusIcon,
  SettingsIcon,
  StudentsIcon,
} from './Icons'
import './Sidebar.css'

const NAV = [
  { to: '/', label: 'Dashboard', icon: DashboardIcon, end: true },
  { to: '/students', label: 'Students', icon: StudentsIcon, end: false },
  { to: '/instructors', label: 'Instructors', icon: InstructorsIcon, end: false },
]

/** Fixed left rail: wordmark, primary action, nav, settings pinned to the bottom. */
export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          Σ
        </span>
        <span className="brand-text">
          <span className="brand-name">Sigma</span>
          <span className="brand-tagline">All our Mathlete metrics. One hub.</span>
        </span>
      </div>

      {/* The reference's primary action. It belongs to the report entry page, which does
          not exist yet -- shown so the rail's proportions are right, disabled so it does
          not promise anything. */}
      <button type="button" className="sidebar-action" disabled title="Coming with report entry">
        New report
        <PlusIcon />
      </button>

      <nav className="sidebar-nav">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => (isActive ? 'nav-item nav-item-active' : 'nav-item')}
          >
            <Icon />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button type="button" className="nav-item" disabled title="Coming later">
          <SettingsIcon />
          Settings
        </button>
      </div>
    </aside>
  )
}
