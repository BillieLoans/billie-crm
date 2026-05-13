'use client'

import { useCallback, useEffect, useRef } from 'react'
import styles from './styles.module.css'

export interface ContextDrawerProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  /**
   * Optional override for the drawer's max-width. Accepts any CSS length
   * (e.g. `"560px"`, `"40rem"`). Defaults to the stylesheet's 480px.
   */
  maxWidth?: string
}

/**
 * ContextDrawer - Slide-over panel from the right.
 * 
 * Features:
 * - Accessible focus trap when open
 * - Escape key to close
 * - Click outside to close
 * - Smooth slide animation
 */
export const ContextDrawer: React.FC<ContextDrawerProps> = ({
  isOpen,
  onClose,
  title,
  children,
  maxWidth,
}) => {
  const drawerRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // Store previous focus and trap focus when opening
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement
      // Small delay to ensure drawer is rendered
      const timer = setTimeout(() => {
        drawerRef.current?.focus()
      }, 10)
      return () => clearTimeout(timer)
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus()
      previousFocusRef.current = null
    }
  }, [isOpen])

  // Handle escape key
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose()
      }
    },
    [isOpen, onClose]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className={styles.overlay} onClick={onClose} data-testid="context-drawer-overlay">
      <div
        ref={drawerRef}
        className={styles.drawer}
        style={maxWidth ? { maxWidth } : undefined}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabIndex={-1}
        data-testid="context-drawer"
      >
        <div className={styles.header}>
          <h2 id="drawer-title" className={styles.title}>
            {title}
          </h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close drawer"
            data-testid="context-drawer-close"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  )
}
