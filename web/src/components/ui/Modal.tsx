import { useEffect, useRef, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  /** Footer content (usually action buttons), right-aligned. */
  footer?: ReactNode
}

/**
 * Reusable modal built on the native <dialog> element (styled by Pico). The
 * browser gives us the backdrop, ESC-to-close, and focus trapping for free —
 * no component-library dependency. Compose specific dialogs (e.g. ConfirmDialog)
 * on top of this.
 */
export default function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  // Drive the native dialog from the `open` prop.
  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      // Fires for ESC, backdrop close, or programmatic close → tell the parent.
      onClose={onClose}
      // Click on the backdrop (the dialog itself, not its content) closes it.
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close()
      }}
    >
      <article>
        {title && (
          <header>
            <strong>{title}</strong>
          </header>
        )}
        {children}
        {footer && <footer>{footer}</footer>}
      </article>
    </dialog>
  )
}
