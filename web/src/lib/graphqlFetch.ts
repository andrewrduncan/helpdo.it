// Minimal GraphQL client over fetch (mirrors promptlydo's graphqlFetch), but
// the auth token is held centrally here so callers don't thread it through.
// Talks to the Spring API at the relative /graphql path (Vite proxies it in dev).

// Seed from localStorage at module load so the Bearer is present on the very
// first request — React runs child effects before AuthProvider's effect, so a
// page's initial query would otherwise fire before setAuthToken() runs (→ a
// spurious "Unauthorized"). AuthContext still owns the token and overrides this.
let authToken: string | null = (() => {
  try {
    return localStorage.getItem('helpdoit.token')
  } catch {
    return null
  }
})()

export function setAuthToken(token: string | null): void {
  authToken = token
}

// Called when the API rejects our token (401/403) — wired by AuthProvider to sign out and
// bounce to login, so an expired session surfaces as a re-auth rather than scattered errors.
let onUnauthorized: (() => void) | null = null
export function setOnUnauthorized(fn: (() => void) | null): void {
  onUnauthorized = fn
}

/** fetch() with the current Bearer token attached — for authed REST calls (e.g. attachment images). */
export async function authedFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
  })
  if (res.status === 401 || res.status === 403) onUnauthorized?.()
  return res
}

export async function graphqlFetch<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch('/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  })

  // An expired/invalid token makes the resource server reject every call — sign out and
  // redirect to login instead of throwing a generic error into each page.
  if (res.status === 401 || res.status === 403) {
    onUnauthorized?.()
    throw new Error('Your session expired — please sign in again.')
  }

  const body = (await res.json()) as { data?: T; errors?: { message: string }[] }
  if (body.errors?.length) {
    throw new Error(body.errors[0].message)
  }
  if (!res.ok) {
    throw new Error(`GraphQL request failed: ${res.status}`)
  }
  return body.data as T
}
