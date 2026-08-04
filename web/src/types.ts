/** Shared app types (single file, mirroring promptlydo's convention). */

export interface User {
  id?: string
  email: string
  name?: string
  picture?: string
  roles?: string[]
}

/** True when the user holds the admin role. */
export function isAdmin(user: User | null): boolean {
  return !!user?.roles?.includes('admin')
}

/** True when the user can manage the question queue (trainer or admin). */
export function canManageQueue(user: User | null): boolean {
  const roles = user?.roles ?? []
  return roles.includes('admin') || roles.includes('trainer')
}

export interface AuthState {
  token: string | null
  user: User | null
  isAuthenticated: boolean
  /** Temporary dev entry until OAuth is wired; replaced by provider sign-in. */
  devLogin: () => void
  login: (token: string, user: User) => void
  logout: () => void
}
