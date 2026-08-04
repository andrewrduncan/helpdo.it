import { useAuth, SESSION_EXPIRED_KEY } from '../../contexts/AuthContext'

// The OAuth flow runs on the API (it owns the redirect URI), so login navigates
// directly to the API origin — not through the Vite proxy.
const API_ORIGIN = 'http://localhost:8080'

/** True once, when we arrived here because the session expired (clears the flag). */
function consumeSessionExpired(): boolean {
  try {
    if (sessionStorage.getItem(SESSION_EXPIRED_KEY)) {
      sessionStorage.removeItem(SESSION_EXPIRED_KEY)
      return true
    }
  } catch {
    /* ignore */
  }
  return false
}

/**
 * Login screen. "Continue with Google" hands off to the API's server-side OIDC
 * flow; on success the API redirects back to /auth/callback with our app JWT.
 * Adding another provider is just another button → /oauth2/authorization/<id>.
 */
export default function Login() {
  const { devLogin } = useAuth()
  const expired = consumeSessionExpired()

  function startLogin(provider: string) {
    window.location.href = `${API_ORIGIN}/oauth2/authorization/${provider}`
  }

  return (
    <div className="login-wrap">
      <article className="login-card">
        <div className="brand">helpdo.it</div>
        <p className="muted">Admin &amp; training portal</p>

        {expired && (
          <p className="muted" style={{ color: 'var(--pico-del-color)' }}>
            Your session expired — please sign in again.
          </p>
        )}

        <button onClick={() => startLogin('google')}>Continue with Google</button>
        <button className="secondary" disabled>
          Continue with Microsoft (add a registration to enable)
        </button>

        <hr />
        <button className="contrast outline" onClick={devLogin}>
          Continue without auth (dev)
        </button>
      </article>
    </div>
  )
}
