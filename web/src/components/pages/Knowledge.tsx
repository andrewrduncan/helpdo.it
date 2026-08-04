import { useEffect, useState } from 'react'
import { graphqlFetch } from '../../lib/graphqlFetch'
import { useAuth } from '../../contexts/AuthContext'
import { useDomain } from '../../contexts/DomainContext'
import { canManageQueue } from '../../types'
import StatusBadge from '../StatusBadge'
import ConfirmDialog from '../ui/ConfirmDialog'

interface KnowledgeEntry {
  id: string
  title: string
  content: string
  source?: string
  status: string
  pageUrl?: string
  updatedAt?: string
}

/** Open the entry's page in a new tab, signalling the extension to edit it (#helpdoit=k:<id>). */
function openEdit(k: KnowledgeEntry) {
  if (!k.pageUrl) return
  const sep = k.pageUrl.includes('#') ? '&' : '#'
  window.open(`${k.pageUrl}${sep}helpdoit=k:${encodeURIComponent(k.id)}`, '_blank', 'noopener')
}

function when(iso?: string): string {
  return iso ? new Date(iso).toLocaleDateString() : ''
}

export default function Knowledge() {
  const { user } = useAuth()
  const canManage = canManageQueue(user)
  const { domains, domainId } = useDomain()
  const [rows, setRows] = useState<KnowledgeEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<KnowledgeEntry | null>(null)
  const [busy, setBusy] = useState(false)

  // (Re)load entries for the portal's active domain whenever it changes.
  useEffect(() => {
    if (!domainId) {
      setRows(null)
      return
    }
    setRows(null)
    graphqlFetch<{ knowledgeEntries: KnowledgeEntry[] }>(
      'query($d: ID) { knowledgeEntries(domainId: $d) { id title content source status pageUrl updatedAt } }',
      { d: domainId },
    )
      .then((d) => setRows(d.knowledgeEntries))
      .catch((e) => setError(String(e.message ?? e)))
  }, [domainId])

  async function confirmDelete() {
    if (!confirming) return
    setBusy(true)
    setError(null)
    try {
      await graphqlFetch(`mutation($id: ID!) { deleteKnowledgeEntry(id: $id) }`, { id: confirming.id })
      setRows((prev) => prev?.filter((r) => r.id !== confirming.id) ?? prev)
      setConfirming(null)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {error && <p style={{ color: 'var(--pico-del-color)' }}>Failed to load: {error}</p>}

      {domains.length === 0 && (
        <div className="placeholder">
          No domains registered yet. Train an entry on a page to register its domain.
        </div>
      )}

      {domainId && !rows && !error && <p aria-busy="true">Loading…</p>}
      {domainId && rows && rows.length === 0 && (
        <div className="placeholder">No knowledge entries for this domain yet.</div>
      )}

      {domainId && rows && rows.length > 0 && (
        <figure>
          <table className="striped">
            <thead>
              <tr>
                <th>Title</th>
                <th>Preview</th>
                <th>Source</th>
                <th>Status</th>
                <th>Updated</th>
                {canManage && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((k) => (
                <tr key={k.id}>
                  <td>{k.title}</td>
                  <td className="muted">{k.content.slice(0, 80)}{k.content.length > 80 ? '…' : ''}</td>
                  <td className="muted">{k.source ?? '—'}</td>
                  <td>
                    <StatusBadge status={k.status} />
                  </td>
                  <td className="muted">{when(k.updatedAt)}</td>
                  {canManage && (
                    <td className="row-actions">
                      <button
                        className="secondary outline"
                        disabled={!k.pageUrl}
                        title={k.pageUrl ? 'Open this entry on its page to edit' : 'No page URL was captured for this entry'}
                        onClick={() => openEdit(k)}
                      >
                        Edit
                      </button>
                      <button
                        className="danger outline"
                        onClick={() => setConfirming(k)}
                        aria-label="Delete knowledge entry"
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </figure>
      )}

      <ConfirmDialog
        open={!!confirming}
        title="Delete knowledge entry?"
        message={
          <p>
            This removes{confirming ? <> “{confirming.title}”</> : null} and de-indexes it, so it
            stops answering questions.
          </p>
        }
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setConfirming(null)}
      />
    </>
  )
}
