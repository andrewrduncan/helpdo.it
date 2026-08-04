/** Small colored pill for a question/knowledge status. */
export default function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{status}</span>
}
