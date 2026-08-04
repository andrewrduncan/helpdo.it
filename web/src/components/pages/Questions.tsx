import { useEffect, useState } from 'react'
import { graphqlFetch, authedFetch } from '../../lib/graphqlFetch'
import { useAuth } from '../../contexts/AuthContext'
import { useDomain } from '../../contexts/DomainContext'
import { canManageQueue } from '../../types'
import StatusBadge from '../StatusBadge'
import ConfirmDialog from '../ui/ConfirmDialog'

interface Attachment {
  id: string
  filename: string
  contentType: string
  kind: string
  hasImage: boolean
  textPreview?: string
}

interface Question {
  id: string
  text: string
  status: string
  askedBy?: string
  answeredByEntry?: string
  pageUrl?: string
  pageContext?: string
  createdAt?: string
  attachments?: Attachment[]
}

/** A question's image attachment, fetched with the auth token and shown as a thumbnail. */
function AttachmentImage({ questionId, attachment }: { questionId: string; attachment: Attachment }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let url: string | null = null
    let cancelled = false
    authedFetch(`/api/questions/${questionId}/attachments/${attachment.id}`)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setSrc(url)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [questionId, attachment.id])
  if (!src) return <span className="attachment-chip">📎 {attachment.filename}</span>
  return (
    <a href={src} target="_blank" rel="noreferrer" title={attachment.filename}>
      <img className="attachment-thumb" src={src} alt={attachment.filename} />
    </a>
  )
}

/** Render a question's attachments: image thumbnails + document chips (with preview tooltip). */
function Attachments({ question }: { question: Question }) {
  const atts = question.attachments ?? []
  if (atts.length === 0) return null
  return (
    <div className="attachments">
      {atts.map((a) =>
        a.hasImage ? (
          <AttachmentImage key={a.id} questionId={question.id} attachment={a} />
        ) : (
          <span key={a.id} className="attachment-chip" title={a.textPreview ?? undefined}>
            📎 {a.filename}
          </span>
        ),
      )}
    </div>
  )
}

/** Open the question's page in a new tab, signalling the extension to enter Train
 *  mode for this question. Only the id travels in the URL hash — the extension
 *  looks up the question text itself. */
function openTrain(q: Question) {
  if (!q.pageUrl) return
  const sep = q.pageUrl.includes('#') ? '&' : '#'
  const url = `${q.pageUrl}${sep}helpdoit=${encodeURIComponent(q.id)}`
  window.open(url, '_blank', 'noopener')
}

const FILTERS = ['queued', 'answered', 'resolved', 'all'] as const

function pageLabel(pageContext?: string): string {
  if (!pageContext) return '—'
  try {
    const ctx = JSON.parse(pageContext)
    return ctx.title || ctx.url || '—'
  } catch {
    return '—'
  }
}

function when(iso?: string): string {
  return iso ? new Date(iso).toLocaleString() : ''
}

export default function Questions() {
  const { user } = useAuth()
  const canManage = canManageQueue(user)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('queued')
  const { domains, domainId } = useDomain()
  const [rows, setRows] = useState<Question[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Question | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!domainId) {
      setRows(null)
      return
    }
    setRows(null)
    setError(null)
    graphqlFetch<{ questions: Question[] }>(
      `query($d: ID, $s: String) { questions(domainId: $d, status: $s) { id text status askedBy ` +
        `answeredByEntry pageUrl pageContext createdAt ` +
        `attachments { id filename contentType kind hasImage textPreview } } }`,
      { d: domainId, s: filter === 'all' ? null : filter },
    )
      .then((d) => setRows(d.questions))
      .catch((e) => setError(String(e.message ?? e)))
  }, [filter, domainId])

  async function confirmDelete() {
    if (!confirming) return
    setBusy(true)
    setError(null)
    try {
      await graphqlFetch(`mutation($id: ID!) { deleteQuestion(id: $id) }`, { id: confirming.id })
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
      {domainId && (
        <div className="filters">
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`filter-btn${filter === f ? '' : ' secondary outline'}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {error && <p style={{ color: 'var(--pico-del-color)' }}>Failed to load: {error}</p>}

      {domains.length === 0 && (
        <div className="placeholder">No domains registered yet.</div>
      )}

      {domainId && !rows && !error && <p aria-busy="true">Loading…</p>}
      {domainId && rows && rows.length === 0 && (
        <div className="placeholder">No {filter} questions for this domain.</div>
      )}

      {domainId && rows && rows.length > 0 && (
        <figure>
          <table className="striped">
            <thead>
              <tr>
                <th>Question</th>
                <th>Status</th>
                <th>On page</th>
                <th>Asked by</th>
                <th>When</th>
                {canManage && <th aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.id}>
                  <td>
                    {q.text}
                    <Attachments question={q} />
                  </td>
                  <td>
                    <StatusBadge status={q.status} />
                  </td>
                  <td className="muted">{pageLabel(q.pageContext)}</td>
                  <td className="muted">{q.askedBy ?? '—'}</td>
                  <td className="muted">{when(q.createdAt)}</td>
                  {canManage && (
                    <td className="row-actions">
                      <button
                        className="secondary outline"
                        disabled={!q.pageUrl}
                        title={
                          q.pageUrl
                            ? 'Open this page in Train mode'
                            : 'No page URL was captured for this question'
                        }
                        onClick={() => openTrain(q)}
                      >
                        Train
                      </button>
                      <button
                        className="danger outline"
                        onClick={() => setConfirming(q)}
                        aria-label="Delete question"
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
        title="Delete question?"
        message={
          <p>
            This permanently removes the question
            {confirming ? <> “{confirming.text}”</> : null} from the queue.
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
