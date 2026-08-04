import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { setAuthToken, setOnUnauthorized } from '../lib/graphqlFetch'
import type { AuthState, User } from '../types'

const TOKEN_KEY = 'helpdoit.token'
const USER_KEY = 'helpdoit.user'
/** Set when a session ends due to expiry/401 so the Login screen can explain why. */
export const SESSION_EXPIRED_KEY = 'helpdoit.sessionExpired'

const AuthContext = createContext<AuthState | null>(null)

/** Decode a JWT's exp (seconds). Returns null for non-JWT / unparsable tokens. */
function jwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return typeof payload.exp === 'number' ? payload.exp : null
  } catch {
    return null
  }
}

function isLive(token: string | null): boolean {
  if (!token) return false
  const exp = jwtExp(token)
  // Non-JWT (dev) tokens have no exp → treated as live until OAuth lands.
  return exp === null || exp * 1000 > Date.now()
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  })

  // Keep the GraphQL client's token in sync.
  useEffect(() => {
    setAuthToken(isLive(token) ? token : null)
  }, [token])

  // Roles live in the DB, not the token — refresh them from /api/me on load so a
  // role change takes effect after a refresh (no full re-login). Identity is also
  // re-synced from the authoritative source.
  useEffect(() => {
    if (!isLive(token)) return
    fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((me: { id?: string; email?: string; name?: string; picture?: string; roles?: string[] } | null) => {
        if (!me) return
        setUser((prev) => {
          const next: User = {
            id: me.id,
            email: me.email ?? prev?.email ?? '',
            name: me.name ?? prev?.name,
            picture: me.picture ?? prev?.picture,
            roles: me.roles ?? [],
          }
          localStorage.setItem(USER_KEY, JSON.stringify(next))
          return next
        })
      })
      .catch(() => {})
  }, [token])

  function login(newToken: string, newUser: User) {
    localStorage.setItem(TOKEN_KEY, newToken)
    localStorage.setItem(USER_KEY, JSON.stringify(newUser))
    setToken(newToken)
    setUser(newUser)
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setToken(null)
    setUser(null)
  }

  // Sign out + flag the reason when the token expires or the API returns 401/403, so the
  // app redirects to login instead of leaving the user on a page firing failing calls.
  function endExpiredSession() {
    try {
      sessionStorage.setItem(SESSION_EXPIRED_KEY, '1')
    } catch {
      /* ignore */
    }
    logout()
  }

  // 401/403 from any GraphQL/REST call → treat the session as ended.
  useEffect(() => {
    setOnUnauthorized(endExpiredSession)
    return () => setOnUnauthorized(null)
  }, [])

  // Proactively end the session the moment the JWT expires, even while idle (isAuthenticated
  // is derived from exp only at render, so without this an idle tab never re-evaluates).
  useEffect(() => {
    if (!token) return
    const exp = jwtExp(token)
    if (exp == null) return // dev token — no expiry
    const ms = exp * 1000 - Date.now()
    if (ms <= 0) {
      endExpiredSession()
      return
    }
    const t = window.setTimeout(endExpiredSession, ms)
    return () => window.clearTimeout(t)
  }, [token])

  // Placeholder until OAuth is wired. Replaced by real provider sign-in.
  function devLogin() {
    login('dev-no-auth', { email: 'dev@helpdo.it', name: 'Dev User' })
  }

  const value = useMemo<AuthState>(
    () => ({ token, user, isAuthenticated: isLive(token), devLogin, login, logout }),
    [token, user],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
