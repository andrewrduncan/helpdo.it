import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

/** Decode a JWT payload (no verification — just to show identity + gate the UI). */
function parseJwt(token: string): { sub?: string; email?: string; name?: string; roles?: string[] } {
  try {
    return JSON.parse(atob(token.split('.')[1]))
  } catch {
    return {}
  }
}

/**
 * Lands here after the API's OIDC success handler redirects with the app JWT in
 * the URL fragment (#token=...). Stores it via AuthContext and goes to the app.
 */
export default function AuthCallback() {
  const { login } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '')
    const token = new URLSearchParams(hash).get('token')
    if (token) {
      const claims = parseJwt(token)
      login(token, {
        id: claims.sub,
        email: claims.email ?? '',
        name: claims.name,
        roles: claims.roles ?? [],
      })
    }
    // Drop the token from the URL, then enter the app (or back to login if none).
    window.history.replaceState(null, '', '/')
    navigate('/', { replace: true })
  }, [login, navigate])

  return (
    <div className="login-wrap">
      <article className="login-card">
        <p className="muted" aria-busy="true">
          Signing you in…
        </p>
      </article>
    </div>
  )
}
