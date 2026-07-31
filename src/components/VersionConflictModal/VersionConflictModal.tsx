'use client'

import React, { useEffect, useRef } from 'react'
import { Modal } from '@/components/ui/Modal'
import { ERROR_MESSAGES } from '@/lib/errors/messages'
import styles from './styles.module.css'

/**
 * Preserved changes to display in the modal.
 */
export interface PreservedChanges {
  /** User-friendly labels and values */
  items: Array<{ label: string; value: string }>
}

export interface VersionConflictModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Callback when modal is closed without action */
  onClose: () => void
  /** Callback when user clicks "Refresh & Retry" */
  onRefresh: () => void
  /** Whether refresh is in progress */
  isRefreshing?: boolean
  /** The user's changes to preserve for reference */
  preservedChanges?: PreservedChanges
}

/**
 * Modal displayed when a version conflict is detected.
 *
 * Shows an error message explaining that the data was modified by another user,
 * optionally displays the user's unsaved changes for reference, and provides
 * buttons to cancel or refresh & retry.
 *
 * @example
 * ```tsx
 * <VersionConflictModal
 *   isOpen={showConflictModal}
 *   onClose={() => setShowConflictModal(false)}
 *   onRefresh={handleRefreshAndRetry}
 *   preservedChanges={{
 *     items: [
 *       { label: 'Amount', value: '$150.00' },
 *       { label: 'Reason', value: 'Customer goodwill' },
 *     ],
 *   }}
 * />
 * ```
 */
export const VersionConflictModal: React.FC<VersionConflictModalProps> = ({
  isOpen,
  onClose,
  onRefresh,
  isRefreshing = false,
  preservedChanges,
}) => {
  const refreshBtnRef = useRef<HTMLButtonElement>(null)

  // Refresh & Retry is the recommended action, so it takes initial focus rather
  // than the first control. Focus trapping, Escape and focus restoration all come
  // from the shared Modal primitive.
  useEffect(() => {
    if (isOpen) {
      const id = setTimeout(() => refreshBtnRef.current?.focus(), 0)
      return () => clearTimeout(id)
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <Modal
      title="Data Changed"
      icon="⚠️"
      onClose={onClose}
      dismissOnBackdropClick={!isRefreshing}
      dismissOnEscape={!isRefreshing}
      closeDisabled={isRefreshing}
      testId="version-conflict-modal"
      maxWidth="480px"
    >

        <div className={styles.modalBody}>
          <p className={styles.modalMessage}>{ERROR_MESSAGES.VERSION_CONFLICT}</p>

          {preservedChanges && preservedChanges.items.length > 0 && (
            <div className={styles.changesSection}>
              <p className={styles.changesSectionTitle}>Your Changes (for reference):</p>
              <ul className={styles.changesList}>
                {preservedChanges.items.map((item) => (
                  <li key={`${item.label}-${item.value}`}>
                    <strong>{item.label}:</strong> {item.value}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className={styles.modalFooter}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={onClose}
            disabled={isRefreshing}
          >
            Cancel
          </button>
          <button
            ref={refreshBtnRef}
            type="button"
            className={styles.refreshBtn}
            onClick={onRefresh}
            disabled={isRefreshing}
            data-testid="refresh-button"
          >
            {isRefreshing ? '🔄 Refreshing...' : '🔄 Refresh & Retry'}
          </button>
        </div>
    </Modal>
  )
}

export default VersionConflictModal
