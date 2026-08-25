'use client'

import React, { useState } from 'react'
import { useAuth } from '@payloadcms/ui'
import { hasApprovalAuthority } from '@/lib/access'
import { Modal } from '@/components/ui/Modal'
import { useKillConversation } from '@/hooks/mutations/useKillConversation'
import { formatDateMedium } from '@/lib/formatters'
import type { ConversationDetail } from '@/lib/schemas/conversations'
import type { ConversationKillCommand } from '@/lib/events/schemas'
import styles from '../styles.module.css'

/** Statuses from which a conversation can still be ended. */
const ENDABLE_STATUSES = ['active', 'paused']

type ReasonCategory = ConversationKillCommand['reasonCategory']

const REASON_OPTIONS: { value: ReasonCategory; label: string }[] = [
  { value: 'fraud_abuse', label: 'Fraud / abuse' },
  { value: 'operational', label: 'Operational cleanup' },
  { value: 'compliance', label: 'Compliance / customer request' },
]

/**
 * The single neutral message every kill shows the customer (billieChat config
 * `conversationKill_stop_message`, pattern of `fraudRisk_stop_message`). The
 * reason category never reaches the customer — see
 * docs/superpowers/specs/2026-08-24-conversation-kill-design.md.
 */
const STOP_MESSAGE =
  'This conversation has been ended by our team. If you have any questions, please contact our support team.'

export interface EndConversationButtonProps {
  conversation: ConversationDetail
  conversationId: string
}

/**
 * "End conversation" button for the ConversationDetailView header.
 *
 * Rendered only for supervisor/admin (`hasApprovalAuthority`) while the
 * conversation is still live (`active`/`paused`). Disabled — rather than
 * hidden — when the conversation has no linked customer id, since the kill
 * command requires one; the title explains why.
 */
export function EndConversationButton({
  conversation,
  conversationId,
}: EndConversationButtonProps) {
  const { user } = useAuth()
  const [isModalOpen, setIsModalOpen] = useState(false)

  if (!hasApprovalAuthority(user)) return null
  if (!ENDABLE_STATUSES.includes(conversation.status ?? '')) return null

  const customerId = conversation.customer?.customerId ?? null
  const disabled = !customerId

  return (
    <>
      <button
        type="button"
        className={styles.endConversationBtn}
        onClick={() => setIsModalOpen(true)}
        disabled={disabled}
        title={disabled ? 'Cannot end conversation: no linked customer id' : undefined}
      >
        End conversation
      </button>
      {isModalOpen && customerId && (
        <EndConversationModal
          onClose={() => setIsModalOpen(false)}
          conversationId={conversationId}
          customerId={customerId}
          applicationNumber={conversation.applicationNumber ?? undefined}
        />
      )}
    </>
  )
}

interface EndConversationModalProps {
  onClose: () => void
  conversationId: string
  customerId: string
  applicationNumber?: string
}

function EndConversationModal({
  onClose,
  conversationId,
  customerId,
  applicationNumber,
}: EndConversationModalProps) {
  const { mutateAsync, isPending, error } = useKillConversation(conversationId)
  const [reasonCategory, setReasonCategory] = useState<ReasonCategory | ''>('')
  const [note, setNote] = useState('')
  const [blockRequested, setBlockRequested] = useState(false)

  // The block checkbox is a Phase 2 affordance — hidden until its flag lands.
  const showBlockCheckbox = process.env.NEXT_PUBLIC_ENABLE_KILL_BLOCK === 'true'

  // No reset effect needed: EndConversationButton fully unmounts this modal on
  // close (see the `isModalOpen && customerId && …` guard above), so each open
  // is a fresh mount and the `useState` initializers above are the reset.
  const isValid = reasonCategory !== ''

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid) return

    const command: ConversationKillCommand = {
      conversationId,
      customerId,
      applicationNumber,
      reasonCategory,
      note: note.trim() || undefined,
      ...(showBlockCheckbox ? { blockRequested } : {}),
    }

    try {
      await mutateAsync(command)
      onClose()
    } catch {
      // Error is surfaced inline below via the mutation's `error` state;
      // keep the modal open so the operator can retry.
    }
  }

  return (
    <Modal
      title="End conversation"
      onClose={onClose}
      dismissOnBackdropClick={!isPending}
      dismissOnEscape={!isPending}
      closeDisabled={isPending}
      testId="end-conversation-modal"
      maxWidth="520px"
    >
      <form onSubmit={handleSubmit}>
        <div className={styles.modalBody}>
          <p className={styles.stopMessagePreview} data-testid="end-conversation-stop-message">
            {STOP_MESSAGE}
          </p>

          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel} id="end-conversation-reason-label">
              Reason
            </span>
            <div
              className={styles.radioList}
              role="radiogroup"
              aria-labelledby="end-conversation-reason-label"
            >
              {REASON_OPTIONS.map((opt) => (
                <label key={opt.value} className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="reasonCategory"
                    value={opt.value}
                    checked={reasonCategory === opt.value}
                    onChange={() => setReasonCategory(opt.value)}
                    disabled={isPending}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor="end-conversation-note">
              Note (optional)
            </label>
            <textarea
              id="end-conversation-note"
              className={styles.textarea}
              placeholder="Internal note for the audit trail — not shown to the customer"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              disabled={isPending}
            />
          </div>

          {showBlockCheckbox && (
            <div className={styles.fieldGroup}>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={blockRequested}
                  onChange={(e) => setBlockRequested(e.target.checked)}
                  disabled={isPending}
                />
                Also block this customer from re-applying
              </label>
            </div>
          )}

          {error && (
            <div className={styles.errorMessage} role="alert">
              {error instanceof Error ? error.message : 'Failed to end conversation'}
            </div>
          )}
        </div>

        <div className={styles.modalFooter}>
          <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={isPending}>
            Cancel
          </button>
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={!isValid || isPending}
            data-testid="end-conversation-confirm"
          >
            {isPending ? 'Ending…' : 'End conversation'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export interface KillBannerProps {
  killRecord: ConversationDetail['killRecord']
}

/**
 * Audit banner shown above the split panel once a conversation has been
 * ended: "Ended by <actor> · <reason> · <date>". Nothing renders while
 * `killRecord` is absent.
 */
export function KillBanner({ killRecord }: KillBannerProps) {
  if (!killRecord) return null

  const { actor, actorName, reason_category, killed_at } = killRecord

  return (
    <div className={styles.killBanner} data-testid="kill-banner">
      Ended by {actorName || actor} · {reason_category} ·{' '}
      {killed_at ? formatDateMedium(killed_at) : '—'}
    </div>
  )
}
