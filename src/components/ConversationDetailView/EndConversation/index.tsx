'use client'

import React, { useState } from 'react'
import { useAuth } from '@payloadcms/ui'
import { hasApprovalAuthority } from '@/lib/access'
import { Modal } from '@/components/ui/Modal'
import { ContextDrawer } from '@/components/ui/ContextDrawer'
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
  { value: 'compliance', label: 'Compliance' },
  { value: 'customer_request', label: 'Customer request' },
]

/**
 * Friendly label for a kill reason category, falling back to the raw value
 * for anything not in REASON_OPTIONS (e.g. a category added server-side
 * before the CRM picks up a matching label) rather than hiding it.
 */
const reasonLabel = (category: string | null | undefined): string =>
  REASON_OPTIONS.find((o) => o.value === category)?.label ?? category ?? '—'

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

  // A customer asking to cancel must never be blocked from re-applying — the
  // reapplicationBlock service raises a MANUAL_ADMIN block purely on the
  // blockRequested boolean, so the guard has to live on this side.
  const isCustomerRequest = reasonCategory === 'customer_request'
  const effectiveBlockRequested = isCustomerRequest ? false : blockRequested

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
      ...(showBlockCheckbox ? { blockRequested: effectiveBlockRequested } : {}),
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
                  checked={effectiveBlockRequested}
                  onChange={(e) => setBlockRequested(e.target.checked)}
                  disabled={isPending || isCustomerRequest}
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
 *
 * The compact line is a fixed one-line layout (never reflows by content —
 * the kill note is variable length and belongs in the drawer, not inline).
 * Clicking it opens a ContextDrawer with the full audit detail, including
 * the note entered in the end-conversation modal.
 */
export function KillBanner({ killRecord }: KillBannerProps) {
  const [open, setOpen] = useState(false)

  if (!killRecord) return null

  const { actor, actorName, reason_category, note, killed_at } = killRecord
  const displayActor = actorName || actor || '—'
  const displayReason = reasonLabel(reason_category)
  const displayDate = killed_at ? formatDateMedium(killed_at) : '—'
  const hasNote = Boolean(note?.trim())

  return (
    <>
      <button
        type="button"
        className={styles.killBanner}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="kill-banner"
      >
        <span className={styles.killBannerText}>
          Ended by {displayActor} · {displayReason} · {displayDate}
        </span>
        <span className={styles.killBannerAffordance} aria-hidden="true">
          Details
        </span>
      </button>
      <ContextDrawer isOpen={open} onClose={() => setOpen(false)} title="Conversation ended">
        <div className={styles.killDrawerRow}>
          <span className={styles.killDrawerLabel}>Ended by</span>
          <span className={styles.killDrawerValue}>{displayActor}</span>
        </div>
        <div className={styles.killDrawerRow}>
          <span className={styles.killDrawerLabel}>Reason</span>
          <span className={styles.killDrawerValue}>{displayReason}</span>
        </div>
        <div className={styles.killDrawerRow}>
          <span className={styles.killDrawerLabel}>Ended at</span>
          <span className={styles.killDrawerValue}>{displayDate}</span>
        </div>
        <div className={styles.killDrawerNoteBlock}>
          <span className={styles.killDrawerLabel}>Note</span>
          {hasNote ? (
            <p className={styles.killDrawerNote} data-testid="kill-note">
              {note}
            </p>
          ) : (
            <p className={styles.killDrawerNoteEmpty}>No note recorded.</p>
          )}
        </div>
      </ContextDrawer>
    </>
  )
}
