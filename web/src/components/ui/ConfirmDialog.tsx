import { type ReactNode } from 'react'
import Modal from './Modal'

interface ConfirmDialogProps {
  open: boolean
  title?: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Style the confirm action as destructive (red). */
  destructive?: boolean
  /** In-flight: disables both actions and shows a spinner on confirm. */
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * A confirm/cancel dialog on top of {@link Modal}. Cancel is rendered first so
 * the browser auto-focuses it — the safe default for destructive actions.
 */
export default function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onCancel()
      }}
      title={title}
      footer={
        <>
          <button className="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button className={destructive ? 'danger' : ''} onClick={onConfirm} disabled={busy}>
            {busy ? '…' : confirmLabel}
          </button>
        </>
      }
    >
      {message}
    </Modal>
  )
}
