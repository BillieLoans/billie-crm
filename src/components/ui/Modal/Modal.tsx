'use client'

import React, { useCallback, useEffect, useId, useRef } from 'react'
import styles from './Modal.module.css'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export interface ModalProps {
  /** Visible heading. Becomes the dialog's accessible name. */
  title?: string
  /**
   * Decorative glyph shown before the title. Hidden from assistive tech — an emoji
   * in the accessible name reads as e.g. "cross mark write off account".
   */
  icon?: React.ReactNode
  /** Accessible name when the design has no visible heading. */
  ariaLabel?: string
  onClose: () => void
  /**
   * Whether clicking the backdrop dismisses. Default true. Set false while an
   * irreversible operation is in flight so a stray click cannot abandon it.
   */
  dismissOnBackdropClick?: boolean
  /** Whether Escape dismisses. Default true; same rationale as above. */
  dismissOnEscape?: boolean
  /** Disables the close control — pair with the dismiss flags during an operation. */
  closeDisabled?: boolean
  /** Applied to the dialog panel, so tests target the dialog rather than the backdrop. */
  testId?: string
  /** Extra class on the panel. */
  className?: string
  /**
   * Overrides the panel's 500px default. Applied inline deliberately: a second
   * CSS-module class ties precedence to stylesheet order, which is not stable.
   */
  maxWidth?: string
  /**
   * Panel content, rendered directly below the header. The primitive deliberately
   * adds no body wrapper: most modals wrap body + footer in a single <form>, and an
   * imposed wrapper would either split the form or double the padding.
   */
  children: React.ReactNode
}

/**
 * The single dialog primitive for the app.
 *
 * Implements the ARIA APG modal dialog contract required by docs/ux-standards.md
 * §1.3: dialog role on the panel (never the backdrop), an accessible name, a focus
 * trap, focus restoration to the invoking element, and Escape to dismiss.
 *
 * Hand-rolling this markup is what let six money-movement modals ship without a
 * dialog role at all — see ux-standards.md §8.3.
 */
export const Modal: React.FC<ModalProps> = ({
  title,
  icon,
  ariaLabel,
  onClose,
  dismissOnBackdropClick = true,
  dismissOnEscape = true,
  closeDisabled = false,
  testId,
  className,
  maxWidth,
  children,
}) => {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<Element | null>(null)
  const titleId = useId()

  // Capture the invoking element once, then hand focus back to it on unmount so
  // closing a modal returns the operator to the row or button they came from.
  useEffect(() => {
    restoreFocusRef.current = document.activeElement

    // Prefer the first real control over the close button — the design spec's
    // "opening a modal always focuses the first input".
    const focusables = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    )
    const firstContentControl = focusables.find((el) => el !== closeRef.current)
    ;(firstContentControl ?? panelRef.current)?.focus()

    return () => {
      const toRestore = restoreFocusRef.current
      if (toRestore instanceof HTMLElement && document.contains(toRestore)) {
        toRestore.focus()
      }
    }
  }, [])

  useEffect(() => {
    if (!dismissOnEscape) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    // Escape is bound on the document so it closes the deepest layer even when
    // focus has moved to a portalled child.
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, dismissOnEscape])

  const trapFocus = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return

    const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    if (focusables.length === 0) return

    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement

    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }, [])

  const onBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only a click on the backdrop itself dismisses — comparing the target avoids
    // stopPropagation on the panel, which would swallow clicks from child handlers.
    if (dismissOnBackdropClick && e.target === e.currentTarget) onClose()
  }

  return (
    <div className={styles.backdrop} role="presentation" onClick={onBackdropClick}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        tabIndex={-1}
        data-testid={testId}
        className={`${styles.panel} ${className ?? ''}`.trim()}
        style={maxWidth ? { maxWidth } : undefined}
        onKeyDown={trapFocus}
      >
        <div className={styles.header}>
          {title ? (
            <h2 id={titleId} className={styles.title}>
              {icon ? (
                <span aria-hidden="true" className={styles.icon}>
                  {icon}
                </span>
              ) : null}
              {title}
            </h2>
          ) : (
            <span />
          )}
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="Close"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        {children}
      </div>
    </div>
  )
}
