'use client'

import React, { useEffect, useState } from 'react'
import { useAuth } from '@payloadcms/ui'
import { hasApprovalAuthority } from '@/lib/access'
import { describeManualSetRejection } from '@/lib/reapplicationBlock'
import type { CustomerData } from '@/hooks/queries/useCustomer'
import { SetManualBlockModal } from './SetManualBlockModal'
import styles from './BlockSet.module.css'

export interface SetManualBlockButtonProps {
  /** The canonical customer's id: the one the block is set on. */
  canonicalCustomerId: string
  customerName?: string
  /** The customer's re-application block, as the servicing view has it. */
  reapplicationBlock?: CustomerData['reapplicationBlock'] | null
  /** Re-read the customer: while waiting for the requested block to arrive. */
  onRefresh: () => void
}

// Same cadence as the Cancel loan drawer's wait for a requested block.
const POLL_MS = 3_000
const POLL_GIVE_UP_MS = 120_000
/** How long "Manual block set." stays up before the header goes back to normal. */
const APPLIED_NOTICE_MS = 5_000

/**
 * "Set manual block" in the customer header (BTB-517): a supervisor blocks the
 * customer from re-applying without cancelling a loan. The same request the
 * Cancel loan drawer sends (SetManualBlockModal, then the reapp-block-set
 * route); billieChat decides whether to apply it.
 *
 * Self-gating, like ClearBlockButton: renders nothing unless the user has
 * approval authority (admin or supervisor, as the route requires) and the
 * customer's canonical id is known.
 *
 * The answer arrives on the customer record, not on the request's response, so
 * after the request this re-reads the customer every few seconds until the
 * record names this request as applied or refused, or two minutes pass. The
 * block itself then shows in the "Needs attention" chip. This adds no rules of
 * its own: billieChat is the system of record for the block.
 */
export function SetManualBlockButton({
  canonicalCustomerId,
  customerName,
  reapplicationBlock,
  onRefresh,
}: SetManualBlockButtonProps) {
  const { user } = useAuth()
  const [modalOpen, setModalOpen] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [waitExpired, setWaitExpired] = useState(false)

  // Only the request this button sent counts: an older set's id (or another
  // user's) on the record says nothing about this one.
  const applied = Boolean(requestId && reapplicationBlock?.manualSetRequestId === requestId)
  const rejection =
    requestId && reapplicationBlock?.manualSetRejectedRequestId === requestId
      ? describeManualSetRejection(reapplicationBlock.manualSetRejection)
      : null
  const waiting = Boolean(requestId && !applied && !rejection && !waitExpired)

  useEffect(() => {
    if (!waiting) return
    const poll = setInterval(() => onRefresh(), POLL_MS)
    const giveUp = setTimeout(() => setWaitExpired(true), POLL_GIVE_UP_MS)
    return () => {
      clearInterval(poll)
      clearTimeout(giveUp)
    }
  }, [waiting, onRefresh])

  // The confirmation is brief: the attention chip carries the block from here.
  useEffect(() => {
    if (!applied) return
    const done = setTimeout(() => setRequestId(null), APPLIED_NOTICE_MS)
    return () => clearTimeout(done)
  }, [applied])

  // Role gate: the same one the route and the Cancel loan action use.
  if (!hasApprovalAuthority(user)) return null
  if (!canonicalCustomerId) return null

  // A new request starts clean: the last one's outcome should not linger
  // while a supervisor writes the next.
  const handleOpen = () => {
    setRequestId(null)
    setWaitExpired(false)
    setModalOpen(true)
  }

  const handleRequested = (id: string) => {
    setModalOpen(false)
    setWaitExpired(false)
    setRequestId(id)
  }

  return (
    <>
      <div className={styles.headerBlock}>
        <button
          type="button"
          className={styles.headerBtn}
          onClick={handleOpen}
          disabled={waiting}
          data-testid="set-manual-block-btn"
        >
          Set manual block
        </button>
        {waiting && (
          <p className={styles.headerNotice} role="status">
            Manual block requested. Waiting for confirmation…
          </p>
        )}
        {applied && (
          <p className={styles.headerNotice} role="status">
            Manual block set.
          </p>
        )}
        {rejection && (
          <p className={`${styles.headerNotice} ${styles.headerNoticeError}`} role="alert">
            The manual block was not set: {rejection}
          </p>
        )}
        {requestId && waitExpired && !applied && !rejection && (
          <p className={styles.headerNotice} role="status">
            The block hasn&apos;t reached the customer record yet. Refresh in a minute; if it still
            isn&apos;t there, the block service may be off.
          </p>
        )}
      </div>

      {modalOpen && (
        <SetManualBlockModal
          onClose={() => setModalOpen(false)}
          onRequested={handleRequested}
          canonicalCustomerId={canonicalCustomerId}
          customerName={customerName}
          defaultReasonCode="credit_review_hold"
        />
      )}
    </>
  )
}
