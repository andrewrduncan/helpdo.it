import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { graphqlFetch } from '../lib/graphqlFetch'

export interface Domain {
  id: string
  host: string
  name?: string
}

interface DomainState {
  domains: Domain[]
  domainId: string | null
  setDomainId: (id: string | null) => void
  currentDomain: Domain | null
  loading: boolean
}

const KEY = 'helpdoit.domainId'
const DomainContext = createContext<DomainState | null>(null)

/**
 * Portal-wide domain context. A single header select picks the active domain; every
 * domain-scoped page (Knowledge, Questions) reads it here. The choice persists in
 * localStorage so it survives reloads, and defaults to the first registered domain.
 */
export function DomainProvider({ children }: { children: ReactNode }) {
  const [domains, setDomains] = useState<Domain[]>([])
  const [domainId, setId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(KEY)
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    graphqlFetch<{ domains: Domain[] }>('{ domains { id host name } }')
      .then((d) => {
        setDomains(d.domains)
        // Keep a valid selection: honor the persisted one if it still exists, else
        // default to the first domain so the portal always has a context.
        setId((cur) => (cur && d.domains.some((x) => x.id === cur) ? cur : (d.domains[0]?.id ?? null)))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function setDomainId(id: string | null) {
    setId(id)
    try {
      if (id) localStorage.setItem(KEY, id)
      else localStorage.removeItem(KEY)
    } catch {
      /* ignore */
    }
  }

  const currentDomain = useMemo(() => domains.find((d) => d.id === domainId) ?? null, [domains, domainId])

  const value = useMemo<DomainState>(
    () => ({ domains, domainId, setDomainId, currentDomain, loading }),
    [domains, domainId, currentDomain, loading],
  )

  return <DomainContext value={value}>{children}</DomainContext>
}

export function useDomain(): DomainState {
  const ctx = useContext(DomainContext)
  if (!ctx) throw new Error('useDomain must be used within DomainProvider')
  return ctx
}
