'use client'

import React from 'react'
import Link from 'next/link'
import { ContextDrawer } from '@/components/ui/ContextDrawer'
import { IdentityVerificationDetail } from '@/components/ConversationDetailView/AssessmentPanel/IdentityVerificationDetail'
import {
  IdentityVerificationNotFoundError,
  useIdentityVerification,
} from '@/hooks/queries/useIdentityVerification'
import { formatDateMedium } from '@/lib/formatters'
import styles from './IdentityVerificationDrawer.module.css'

export interface IdentityVerificationDrawerProps {
  customerId: string
  isOpen: boolean
  onClose: () => void
}

/**
 * Slide-over showing the customer's latest identity check in exactly the
 * format the application view uses (`IdentityVerificationDetail`), fetched
 * lazily when opened.
 */
export function IdentityVerificationDrawer({
  customerId,
  isOpen,
  onClose,
}: IdentityVerificationDrawerProps) {
  const { data, isLoading, error } = useIdentityVerification(customerId, isOpen)

  return (
    <ContextDrawer isOpen={isOpen} onClose={onClose} title="Identity check" maxWidth="640px">
      <div className={styles.body} data-testid="identity-verification-drawer">
        {isLoading && <p className={styles.note}>Loading identity check…</p>}
        {error instanceof IdentityVerificationNotFoundError && (
          <p className={styles.note}>No identity check has been recorded for this customer.</p>
        )}
        {error && !(error instanceof IdentityVerificationNotFoundError) && (
          <p className={styles.error}>Could not load the identity check. Try again.</p>
        )}
        {data && (
          <>
            <p className={styles.source}>
              From application{' '}
              {data.applicationNumber ? (
                <Link
                  href={`/admin/applications/${encodeURIComponent(data.conversationId)}?from=servicing`}
                  className={styles.sourceLink}
                >
                  {data.applicationNumber}
                </Link>
              ) : (
                data.conversationId
              )}
              {data.assessedAt ? ` · ${formatDateMedium(data.assessedAt)}` : ''}
            </p>
            <IdentityVerificationDetail
              identity={data.identity}
              report={data.report}
              customerId={customerId}
            />
          </>
        )}
      </div>
    </ContextDrawer>
  )
}
