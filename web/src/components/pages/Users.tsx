import { useEffect, useState } from 'react'
import { graphqlFetch } from '../../lib/graphqlFetch'
import { useAuth } from '../../contexts/AuthContext'

interface UserAccount {
  id: string
  email: string
  name?: string
  roles: string[]
}

interface RoleInfo {
  key: string
  description?: string
}

const USER_FIELDS = '{ id email name roles }'

export default function Users() {
  const { user: me } = useAuth()
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<UserAccount[] | null>(null)
  const [roles, setRoles] = useState<RoleInfo[]>([])
  const [selected, setSelected] = useState<UserAccount | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // The fixed role vocabulary (rendered as toggles).
  useEffect(() => {
    graphqlFetch<{ roles: RoleInfo[] }>(`{ roles { key description } }`)
      .then((d) => setRoles(d.roles))
      .catch((e) => setError(String(e.message ?? e)))
  }, [])

  // Debounced user search (server-side ILIKE on email/name).
  useEffect(() => {
    setResults(null)
    const t = setTimeout(() => {
      graphqlFetch<{ users: UserAccount[] }>(
        `query($search: String) { users(search: $search) ${USER_FIELDS} }`,
        { search: search.trim() || null },
      )
        .then((d) => {
          setResults(d.users)
          setError(null) // a successful load clears any earlier (e.g. startup-race) error
        })
        .catch((e) => setError(String(e.message ?? e)))
    }, 200)
    return () => clearTimeout(t)
  }, [search])

  async function toggleRole(roleKey: string, assigned: boolean) {
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    const mutation = assigned ? 'removeRole' : 'assignRole'
    try {
      const data = await graphqlFetch<Record<string, UserAccount>>(
        `mutation($userId: ID!, $role: String!) { ${mutation}(userId: $userId, role: $role) ${USER_FIELDS} }`,
        { userId: selected.id, role: roleKey },
      )
      const updated = data[mutation]
      setSelected(updated)
      // Keep the results list in sync without a refetch.
      setResults((prev) => prev?.map((u) => (u.id === updated.id ? updated : u)) ?? prev)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="users-page">
      <div className="user-picker">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search users by name or email…"
          aria-label="Search users"
        />

        {error && <p style={{ color: 'var(--pico-del-color)' }}>{error}</p>}
        {!results && !error && <p aria-busy="true">Loading…</p>}
        {results && results.length === 0 && (
          <div className="placeholder">No users match “{search}”.</div>
        )}

        {results && results.length > 0 && (
          <div className="user-list" role="listbox" aria-label="Users">
            {results.map((u) => (
              <div
                key={u.id}
                role="option"
                aria-selected={selected?.id === u.id}
                tabIndex={0}
                className={`user-row${selected?.id === u.id ? ' is-selected' : ''}`}
                onClick={() => setSelected(u)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSelected(u)
                  }
                }}
              >
                <span className="user-id">
                  <span className="user-name">{u.name || u.email}</span>
                  {u.name && <span className="muted user-email">{u.email}</span>}
                </span>
                <span className="user-rolechips">
                  {u.roles.length ? (
                    u.roles.map((r) => (
                      <span key={r} className="badge badge-role">
                        {r}
                      </span>
                    ))
                  ) : (
                    <span className="muted">no roles</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="user-detail">
        {!selected ? (
          <div className="placeholder">Select a user to manage their roles.</div>
        ) : (
          <article>
            <header>
              <strong>{selected.name || selected.email}</strong>
              <div className="muted">{selected.email}</div>
            </header>
            <p className="muted">
              Roles are part of the system — assign or remove them below. Admins can do
              anything; trainers handle knowledge &amp; the FAQ queue.
            </p>
            <div className="role-toggles">
              {roles.map((r) => {
                const assigned = selected.roles.includes(r.key)
                const isSelfAdmin = r.key === 'admin' && selected.id === me?.id
                return (
                  <div key={r.key} className="role-toggle">
                    <div className="role-meta">
                      <strong>{r.key}</strong>
                      {r.description && <span className="muted"> — {r.description}</span>}
                    </div>
                    <button
                      className={assigned ? 'secondary outline' : ''}
                      disabled={busy || (assigned && isSelfAdmin)}
                      title={
                        assigned && isSelfAdmin
                          ? 'You cannot remove your own admin role — ask another admin.'
                          : undefined
                      }
                      onClick={() => toggleRole(r.key, assigned)}
                    >
                      {assigned ? 'Remove' : 'Assign'}
                    </button>
                  </div>
                )
              })}
            </div>
          </article>
        )}
      </div>
    </div>
  )
}
