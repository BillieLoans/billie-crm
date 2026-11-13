'use client'

import React, { useCallback, useEffect, useRef } from 'react'
import { useNotificationBody } from '@/hooks/queries/useNotificationBody'
import styles from './styles.module.css'

export interface NotificationBodyModalProps {
  notificationId: string
  onClose: () => void
}

/**
 * The stored subject + body of one sent notification, as the customer saw it.
 * Shared by this modal and the collections case view's reminder pop-up.
 */
export const NotificationBodyContent: React.FC<{ notificationId: string }> = ({
  notificationId,
}) => {
  const { body, isLoading, isError, isNotFound, error } = useNotificationBody(notificationId)

  return (
    <>
      {isLoading && <div className={styles.modalSkeleton} />}

      {isNotFound && (
        <div className={styles.modalEmpty}>
          Body unavailable. Notifications are only retrievable for 90 days after send.
        </div>
      )}

      {isError && !isNotFound && (
        <div className={styles.modalEmpty}>
          Could not load the notification body.
          <br />
          <small>{error?.message ?? 'Unknown error'}</small>
        </div>
      )}

      {body && (
        <>
          {body.subject && (
            <div className={styles.modalSubject}>
              <span className={styles.modalSubjectLabel}>Subject:</span>
              {body.subject}
            </div>
          )}
          {body.isHtml ? (
            <iframe
              className={styles.modalIframe}
              title="Notification body"
              sandbox=""
              srcDoc={body.body}
            />
          ) : (
            <pre className={styles.modalPre}>{body.body}</pre>
          )}
        </>
      )}
    </>
  )
}

export const NotificationBodyModal: React.FC<NotificationBodyModalProps> = ({
  notificationId,
  onClose,
}) => {
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeBtnRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const handleOverlayClick = useCallback(() => onClose(), [onClose])
  const stopPropagation = useCallback((e: React.MouseEvent) => e.stopPropagation(), [])

  return (
    <div
      className={styles.modalOverlay}
      onClick={handleOverlayClick}
      role="presentation"
      data-testid="notification-body-modal-overlay"
    >
      <div
        className={styles.modalContent}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-body-modal-title"
        onClick={stopPropagation}
      >
        <div className={styles.modalHeader}>
          <h3 id="notification-body-modal-title" className={styles.modalTitle}>
            Notification body
          </h3>
          <button
            ref={closeBtnRef}
            type="button"
            className={styles.modalCloseBtn}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          <NotificationBodyContent notificationId={notificationId} />
        </div>
      </div>
    </div>
  )
}
