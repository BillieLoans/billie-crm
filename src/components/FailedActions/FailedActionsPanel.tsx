'use client'

import React, { useRef, useEffect } from 'react'
import { useFailedActionsStore, FailedAction, FailedActionType } from '@/stores/failed-actions'
import { useUIStore } from '@/stores/ui'
import { formatRelativeTime } from '@/lib/formatters'
import { MAX_RETRY_ATTEMPTS } from '@/lib/constants'
import styles from './styles.module.css'

export interface FailedActionsPanelProps {
  /** Callback when panel should close */
  onClose: () => void
}

/**
 * Get human-readable label for action type.
 */
function getActionLabel(type: FailedActionType): string {
  switch (type) {
    case 'marketing-command':
      return '📣'
    case 'marketing-command':
      return 'Marketing command'
    case 'waive-fee':
      return 'Waive Fee'
    case 'record-repayment':
      return 'Record Repayment'
    case 'write-off-request':
      return 'Write-Off Request'
    case 'flag-hardship':
      return 'Flag hardship'
    case 'resume-hardship':
      return 'Resume from hardship'
    case 'stop-contact':
      return 'Stop contact'
    case 'advance-step':
      return 'Advance step'
    default:
      return 'Action'
  }
}

/**
 * Get icon for action type.
 */
function getActionIcon(type: FailedActionType): string {
  switch (type) {
    case 'waive-fee':
      return '🎁'
    case 'record-repayment':
      return '💳'
    case 'write-off-request':
      return '❌'
    case 'flag-hardship':
      return '⏸️'
    case 'resume-hardship':
      return '▶️'
    case 'stop-contact':
      return '🛑'
    case 'advance-step':
      return '⏭️'
    default:
      return '⚡'
  }
}

/**
 * Individual failed action item component.
 */
interface ActionItemProps {
  action: FailedAction
  onRetry: (action: FailedAction) => void
  onDismiss: (id: string) => void
  isRetrying: boolean
  readOnlyMode: boolean
}

const ActionItem: React.FC<ActionItemProps> = ({
  action,
  onRetry,
  onDismiss,
  isRetrying,
  readOnlyMode,
}) => {
  return (
    <div className={styles.actionItem} data-testid={`failed-action-${action.id}`}>
      <div className={styles.actionHeader}>
        <div className={styles.actionInfo}>
          <span className={styles.actionType}>
            <span className={styles.actionTypeIcon} aria-hidden="true">
              {getActionIcon(action.type)}
            </span>
            {getActionLabel(action.type)}
          </span>
          <span className={styles.actionAccount}>{action.accountLabel || action.accountId}</span>
        </div>
        <span className={styles.actionTime}>{formatRelativeTime(action.timestamp)}</span>
      </div>

      <span className={styles.actionError}>{action.errorMessage}</span>

      <div className={styles.actionActions}>
        <button
          type="button"
          className={styles.retryBtn}
          onClick={() => onRetry(action)}
          disabled={isRetrying || readOnlyMode || action.retryCount >= MAX_RETRY_ATTEMPTS}
          title={
            action.retryCount >= MAX_RETRY_ATTEMPTS
              ? 'Maximum retry attempts reached'
              : readOnlyMode
                ? 'System in read-only mode'
                : 'Retry this action'
          }
          data-testid={`retry-action-${action.id}`}
        >
          {isRetrying
            ? '⏳ Retrying...'
            : action.retryCount >= MAX_RETRY_ATTEMPTS
              ? '❌ Max retries'
              : '🔄 Retry'}
        </button>
        <button
          type="button"
          className={styles.dismissBtn}
          onClick={() => onDismiss(action.id)}
          data-testid={`dismiss-action-${action.id}`}
        >
          Dismiss
        </button>
        {action.retryCount > 0 && (
          <span className={styles.retryCount}>
            {action.retryCount} {action.retryCount === 1 ? 'retry' : 'retries'}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Panel showing list of failed actions with retry/dismiss controls.
 */
export const FailedActionsPanel: React.FC<FailedActionsPanelProps> = ({ onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const [retryingId, setRetryingId] = React.useState<string | null>(null)

  const actions = useFailedActionsStore((state) => state.actions)
  const removeAction = useFailedActionsStore((state) => state.removeAction)
  const incrementRetryCount = useFailedActionsStore((state) => state.incrementRetryCount)
  const clearAll = useFailedActionsStore((state) => state.clearAll)
  const readOnlyMode = useUIStore((state) => state.readOnlyMode)

  // Focus trap implementation
  useEffect(() => {
    // Store current focus to restore later
    previousFocusRef.current = document.activeElement as HTMLElement

    // Focus the panel
    panelRef.current?.focus()

    // Handle tab key for focus trap
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      const panel = panelRef.current
      if (!panel) return

      const focusableElements = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault()
        lastElement?.focus()
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault()
        firstElement?.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      // Restore focus on close
      previousFocusRef.current?.focus()
    }
  }, [])

  /**
   * Handle retry action.
   * This triggers the appropriate mutation hook and removes on success.
   * For now, we simulate with a placeholder - actual integration happens in step 5-3-5.
   */
  const handleRetry = async (action: FailedAction) => {
    setRetryingId(action.id)
    incrementRetryCount(action.id)

    try {
      // Retry logic will be connected to actual mutation hooks
      // For now, we dispatch a custom event that the mutation hooks can listen to
      const retryEvent = new CustomEvent('billie-retry-action', {
        detail: {
          id: action.id,
          type: action.type,
          accountId: action.accountId,
          params: action.params,
        },
      })
      window.dispatchEvent(retryEvent)

      // Note: The actual removal happens when the retry succeeds via the mutation hook
      // The mutation hook will call removeAction on success
    } finally {
      setRetryingId(null)
    }
  }

  const handleDismiss = (id: string) => {
    removeAction(id)
  }

  const handleClearAll = () => {
    clearAll()
    onClose()
  }

  return (
    <>
      <div className={styles.panelOverlay} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="failed-actions-title"
        tabIndex={-1}
        data-testid="failed-actions-panel"
      >
        <div className={styles.panelHeader}>
          <h2 id="failed-actions-title" className={styles.panelTitle}>
            Failed Actions ({actions.length})
          </h2>
          <div className={styles.panelHeaderActions}>
            {actions.length > 0 && (
              <button
                type="button"
                className={styles.clearAllBtn}
                onClick={handleClearAll}
                data-testid="clear-all-failed-actions"
              >
                Clear All
              </button>
            )}
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="Close panel"
              data-testid="close-failed-actions-panel"
            >
              ✕
            </button>
          </div>
        </div>

        <div className={styles.panelContent}>
          {actions.length === 0 ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>✅</span>
              <span className={styles.emptyText}>No failed actions</span>
            </div>
          ) : (
            actions.map((action) => (
              <ActionItem
                key={action.id}
                action={action}
                onRetry={handleRetry}
                onDismiss={handleDismiss}
                isRetrying={retryingId === action.id}
                readOnlyMode={readOnlyMode}
              />
            ))
          )}
        </div>
      </div>
    </>
  )
}

export default FailedActionsPanel
