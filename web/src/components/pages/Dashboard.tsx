import { useEffect, useState } from 'react'
import { graphqlFetch } from '../../lib/graphqlFetch'

interface Overview {
  health: { application: string; status: string }
  queued: { id: string }[]
  knowledge: { id: string }[]
}

/** Dashboard — live API status + counts from the admin GraphQL queries. */
export default function Dashboard() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    graphqlFetch<Overview>(
      `{ health { application status }
         queued: questions(status: "queued") { id }
         knowledge: knowledgeEntries { id } }`,
    )
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)))
  }, [])

  const apiValue = error ? (
    <span style={{ color: 'var(--pico-del-color)' }}>offline</span>
  ) : data ? (
    `${data.health.application} · ${data.health.status}`
  ) : (
    'checking…'
  )

  return (
    <div className="tiles">
      <article className="tile">
        <small>API</small>
        <div className="value" style={{ fontSize: 16 }}>
          {apiValue}
        </div>
        {error && <small className="muted">{error}</small>}
      </article>
      <article className="tile">
        <small>Queued questions</small>
        <div className="value">{data ? data.queued.length : '—'}</div>
      </article>
      <article className="tile">
        <small>Knowledge entries</small>
        <div className="value">{data ? data.knowledge.length : '—'}</div>
      </article>
      <article className="tile">
        <small>Open feedback</small>
        <div className="value muted">—</div>
      </article>
    </div>
  )
}
