import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useDomain } from '../contexts/DomainContext'
import { isAdmin } from '../types'

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/questions', label: 'Question Queue' },
  { to: '/knowledge', label: 'Knowledge' },
  { to: '/feedback', label: 'Feedback' },
  { to: '/agents', label: 'Agents' },
  { to: '/users', label: 'Users & Roles', adminOnly: true },
]

function titleFor(pathname: string): string {
  const match = NAV.find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)))
  return match?.label ?? 'helpdo.it'
}

export default function Layout() {
  const { logout, user } = useAuth()
  const { domains, domainId, setDomainId } = useDomain()
  const location = useLocation()
  const nav = NAV.filter((n) => !n.adminOnly || isAdmin(user))
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') ?? 'light',
  )

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', next)
    setTheme(next)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/favicon.svg" alt="" />
          helpdo.it
        </div>
        <nav>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="spacer" />
        <div className="sidebar-user">
          {user?.picture ? (
            <img className="avatar" src={user.picture} alt="" referrerPolicy="no-referrer" />
          ) : (
            <div className="avatar avatar-fallback">
              {(user?.name ?? user?.email ?? '?').charAt(0).toUpperCase()}
            </div>
          )}
          <small className="muted">{user?.name ?? user?.email}</small>
          <button className="secondary outline" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h1>{titleFor(location.pathname)}</h1>
          <div className="actions">
            <label className="domain-picker" aria-label="Active domain">
              <select
                value={domainId ?? ''}
                onChange={(e) => setDomainId(e.target.value || null)}
                disabled={domains.length === 0}
              >
                {domains.length === 0 && <option value="">No domains</option>}
                {domains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name && d.name !== d.host ? `${d.name} (${d.host})` : d.host}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary outline" onClick={toggleTheme}>
              {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
