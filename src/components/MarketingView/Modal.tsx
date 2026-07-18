'use client'

import React, { useEffect, useId, useRef } from 'react'
import { useEscapeClose } from '@/hooks/useModalA11y'
import styles from './styles.module.css'

export interface ModalProps {
  title: React.ReactNode
  onClose: () => void
  /** Dialog body. */
  children: React.ReactNode
  /** Action row; omit for informational dialogs. */
  footer?: React.ReactNode
  /** Widens the dialog for content-heavy bodies (search pickers, previews). */
  wide?: boolean
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Shared dialog shell for the marketing module. Every dialog gets the same
 * behaviour: overlay + × + Escape close, focus moved into the dialog on open
 * and restored on close, Tab cycling trapped inside, and correct dialog
 * semantics (`role="dialog"`, `aria-modal`, labelled title). Composition:
 *
 *   <Modal title="…" onClose={…} footer={<>buttons</>}>body</Modal>
 *
 * Forms should wrap the Modal's children/footer externally by passing a
 * <form> as the single child with the footer inside it — or simply use
 * onSubmit on a form element inside `children` and mirror the primary action
 * in `footer`. (All current callers use footer buttons with type="submit"
 * via the `form` attribute or plain onClick handlers.)
 */
export const Modal: React.FC<ModalProps> = ({ title, onClose, children, footer, wide }) => {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEscapeClose(onClose)

  // Move focus into the dialog on mount (autoFocus fields win when present),
  // restore it to the opener on unmount.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    if (dialog && !dialog.contains(document.activeElement)) {
      const first = dialog.querySelector<HTMLElement>(FOCUSABLE)
      first?.focus()
    }
    return () => {
      opener?.focus?.()
    }
  }, [])

  // Keep Tab inside the dialog.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        ref={dialogRef}
        className={wide ? `${styles.modal} ${styles.modalWide}` : styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className={styles.modalHeader}>
          <h2 id={titleId} className={styles.modalTitle}>
            {title}
          </h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
        {footer && <div className={styles.modalFooter}>{footer}</div>}
      </div>
    </div>
  )
}

export default Modal
