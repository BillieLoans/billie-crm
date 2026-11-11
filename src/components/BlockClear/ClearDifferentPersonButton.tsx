'use client'

import React, { useEffect, useState } from 'react'
import { useAuth } from '@payloadcms/ui'
import { canService } from '@/lib/access'
import { formatDateOnly } from '@/lib/formatters'
import {
  describeClearRejection,
  formatMatchedContactKinds,
  isVerifiedContactStop,
} from '@/lib/reapplicationBlock'
import { ClearDifferentPersonModal } from './ClearDifferentPersonModal'
import styles from './BlockClear.module.css'

export interface ClearDifferentPersonButtonProps {
  /** The stopped conversation's block record. */
  block?: {
    canonicalCustomerId?: string | null
    recognition?: { band?: string | null; matched_contact_kinds?: string[] | null } | null
    clearStatus?: string | null
    clearedAt?: string | null
    clearedBy?: string | null
    clearedByName?: string | null
    clearJustification?: string | null
    clearRequestId?: string | null
    clearRejection?: string | null
  } | null
  /** The conversation the contact match stopped. */
  conversationId: string
}

/** How long the trigger stays disabled waiting for an answer to its own request. */
const WAIT_GIVE_UP_MS = 120_000

/**
 * "Clear: different person" for an application stopped by a verified-contact
 * match (BTB-569), and the record of that clear.
 *
 * Renders nothing unless the block is a verified-contact stop. The outcome
 * (requested / cleared by whom, when and why / refused and why) is read from
 * the conversation record and shown to everyone who can see the banner. The
 * action itself is role-gated like ClearBlockButton (admin, supervisor,
 * operations), as the route requires.
 *
 * The answer arrives on the conversation record, not on the request's
 * response. The conversation view re-reads the record every few seconds, so
 * this only remembers the request it sent, to show "requested" until the
 * record names it.
 */
export function ClearDifferentPersonButton({
  block,
  conversationId,
}: ClearDifferentPersonButtonProps) {
  const { user } = useAuth()
  const [modalOpen, setModalOpen] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [waitExpired, setWaitExpired] = useState(false)

  const status = block?.clearStatus ?? null
  const cleared = status === 'cleared'
  // The record has an answer for the request this button sent.
  const answered =
    cleared || (status === 'rejected' && Boolean(requestId) && block?.clearRequestId === requestId)
  const waitingOnOwn = Boolean(requestId) && !answered && !waitExpired

  useEffect(() => {
    if (!waitingOnOwn) return
    const giveUp = setTimeout(() => setWaitExpired(true), WAIT_GIVE_UP_MS)
    return () => clearTimeout(giveUp)
  }, [waitingOnOwn])

  if (!isVerifiedContactStop(block)) return null

  const matchedCustomerId = block?.canonicalCustomerId ?? null
  const who = block?.clearedByName || block?.clearedBy || null
  // A refusal of an older request is history once a new one has been sent.
  const rejected = status === 'rejected' && !waitingOnOwn
  const pending = !cleared && !rejected && (status === 'pending' || Boolean(requestId))

  const handleRequested = (id: string) => {
    setModalOpen(false)
    setWaitExpired(false)
    setRequestId(id)
  }

  return (
    <>
      {cleared && (
        <div className={styles.clearOutcome} role="status" data-testid="different-person-cleared">
          <span className={styles.clearOutcomeHeadline}>
            Cleared as a different person
            {who ? ` by ${who}` : ''}
            {block?.clearedAt ? ` on ${formatDateOnly(block.clearedAt)}` : ''}
          </span>
          {block?.clearJustification && (
            <span className={styles.clearOutcomeDetail}>“{block.clearJustification}”</span>
          )}
        </div>
      )}

      {!cleared && (
        <div className={styles.clearBlockContainer}>
          {canService(user) &&
            (matchedCustomerId ? (
              <button
                type="button"
                className={styles.clearBlockBtn}
                onClick={() => setModalOpen(true)}
                disabled={waitingOnOwn}
                data-testid="clear-different-person-btn"
              >
                Clear: different person
              </button>
            ) : (
              <button
                type="button"
                className={styles.clearBlockBtnDisabled}
                disabled
                title="The matched customer isn't recorded on this stop — can't clear here."
                data-testid="clear-different-person-btn-disabled"
              >
                Clear: different person
              </button>
            ))}

          {pending && (
            <span
              className={styles.clearStatusPending}
              role="status"
              data-testid="different-person-pending"
            >
              {waitExpired
                ? 'Clear requested — no answer yet. If it still shows after a minute, the block service may be off.'
                : `Clear requested${who && status === 'pending' ? ` by ${who}` : ''} — waiting for confirmation…`}
            </span>
          )}
          {rejected && (
            <span
              className={styles.clearStatusRejected}
              role="alert"
              data-testid="different-person-rejected"
            >
              The clear was not applied: {describeClearRejection(block?.clearRejection)}
            </span>
          )}
        </div>
      )}

      {modalOpen && matchedCustomerId && (
        <ClearDifferentPersonModal
          onClose={() => setModalOpen(false)}
          onRequested={handleRequested}
          conversationId={conversationId}
          matchedCustomerId={matchedCustomerId}
          contactLabel={formatMatchedContactKinds(block?.recognition?.matched_contact_kinds)}
        />
      )}
    </>
  )
}
