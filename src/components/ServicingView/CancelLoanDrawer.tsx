'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@payloadcms/ui'
import { ContextDrawer } from '@/components/ui/ContextDrawer'
import { Modal } from '@/components/ui/Modal'
import { SetManualBlockModal } from '@/components/BlockSet/SetManualBlockModal'
import {
  CANCELLATION_REASON_CODES,
  CANCELLATION_REASON_LABELS,
  type CancellationReasonCode,
} from '@/lib/cancellation'
import { MIN_CANCELLATION_NOTE_LENGTH, MIN_NO_BLOCK_REASON_LENGTH } from '@/lib/constants'
import { formatBlockLabel, formatBlockedUntil, isManualBlockActive } from '@/lib/reapplicationBlock'
import type { BlockConfirmation } from '@/lib/schemas/ledger'
import {
  clearFrozenCancellation,
  frozenCancellationHeldByAnother,
  loadFrozenCancellation,
  saveFrozenCancellation,
} from '@/lib/frozenCancellation'
import type { CustomerData } from '@/hooks/queries/useCustomer'
import styles from './CancelLoanDrawer.module.css'

export interface CancelLoanDrawerProps {
  isOpen: boolean
  onClose: () => void
  loanAccountId: string
  accountNumber: string
  /** The canonical customer's id: the one a manual block is set on. */
  customerId: string
  customerName?: string
  /** The customer's re-application block, as the servicing view has it. */
  reapplicationBlock?: CustomerData['reapplicationBlock'] | null
  /**
   * Re-read the customer and its accounts: after a cancel, after a refusal
   * that means the view is stale, and while waiting for a requested block.
   */
  onRefresh?: () => void
}

/** The body POST /api/ledger/cancel-account takes (BTB-517, task C2). */
interface CancelRequest {
  loanAccountId: string
  reason: CancellationReasonCode
  note: string
  evidenceRef?: string
  blockConfirmation: BlockConfirmation
  idempotencyKey: string
}

const POLL_MS = 3_000
const POLL_GIVE_UP_MS = 120_000
const UNSENT_MESSAGE =
  'The cancellation could not be sent, so it may not have happened. Try again: it sends the same request, so the loan is never cancelled twice.'

/** The message an API route sent, in whichever of its shapes it used. */
function messageFrom(body: Record<string, unknown>): string | null {
  if (typeof body.message === 'string' && body.message) return body.message
  if (body.error && typeof body.error === 'object') {
    const message = (body.error as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
  }
  if (body.details && typeof body.details === 'object') {
    const messages = Object.values(body.details as Record<string, unknown>)
      .flatMap((v) => (Array.isArray(v) ? v : []))
      .filter((v): v is string => typeof v === 'string')
    if (messages.length) return messages.join(' ')
  }
  return typeof body.error === 'string' ? body.error : null
}

/**
 * Cancel a loan before disbursement (BTB-517). Supervisor/admin only: the
 * action that opens it needs approval authority, and the route checks again.
 *
 * Two steps, as irreversible changes must be: the form, then a confirm dialog
 * that says "This cannot be undone". The customer must either already have an
 * active manual re-application block (the route re-checks it) or the
 * supervisor says why none is needed. A block can be requested from here; it
 * counts once it shows on the customer record.
 *
 * The idempotency key is minted once per drawer session and reused on every
 * retry. After a failure whose outcome is unknown (5xx, or no response) the
 * request is frozen, so "Try again" sends exactly the same cancel and the
 * platform completes it rather than starting another.
 */
export const CancelLoanDrawer: React.FC<CancelLoanDrawerProps> = ({
  isOpen,
  onClose,
  ...formProps
}) => {
  // True while a dialog is open over the form or a cancel is in flight: then
  // Escape or a click outside must not close the drawer.
  const [busy, setBusy] = useState(false)
  const guardedClose = useCallback(() => {
    if (busy) return
    onClose()
  }, [busy, onClose])

  // The form lives inside the drawer, so it mounts on every opening. An
  // opening is a new cancel with a fresh form and a fresh idempotency key,
  // unless this user left a cancel for this loan unfinished: then it reopens
  // that request, key and all (frozenCancellation).
  return (
    <ContextDrawer isOpen={isOpen} onClose={guardedClose} title="Cancel loan" maxWidth="520px">
      <CancelLoanForm {...formProps} onClose={onClose} onBusyChange={setBusy} />
    </ContextDrawer>
  )
}

interface CancelLoanFormProps extends Omit<CancelLoanDrawerProps, 'isOpen'> {
  onBusyChange: (busy: boolean) => void
}

function CancelLoanForm({
  onClose,
  onBusyChange,
  loanAccountId,
  accountNumber,
  customerId,
  customerName,
  reapplicationBlock,
  onRefresh,
}: CancelLoanFormProps) {
  const [reason, setReason] = useState<CancellationReasonCode | ''>('')
  const [note, setNote] = useState('')
  const [evidenceRef, setEvidenceRef] = useState('')
  const [noBlockNeeded, setNoBlockNeeded] = useState(false)
  const [noBlockReason, setNoBlockReason] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The signed-in CRM user owns a frozen request; nobody else is offered it.
  const { user } = useAuth()
  const ownerId = user?.id != null ? String(user.id) : null
  /**
   * Set after an outcome-unknown failure: every retry sends this, unchanged,
   * key and all. It is also kept for this user and loan across closing and
   * reopening (frozenCancellation), so a reopened drawer starts from it.
   */
  const [lockedRequest, setLockedRequest] = useState<CancelRequest | null>(() =>
    loadFrozenCancellation(loanAccountId, ownerId),
  )
  /** The drawer opened on a cancellation an earlier opening left unfinished. */
  const [resumed, setResumed] = useState(() => lockedRequest !== null)
  /** Whether the frozen request is safely kept; if not, the drawer must stay open. */
  const [kept, setKept] = useState(true)
  /** It could not be kept because another user's unfinished cancel holds this loan here. */
  const [heldByAnother, setHeldByAnother] = useState(false)
  const [result, setResult] = useState<{ noteError: boolean } | null>(null)
  const [blockModalOpen, setBlockModalOpen] = useState(false)
  const [blockRequestId, setBlockRequestId] = useState<string | null>(null)
  const [blockWaitExpired, setBlockWaitExpired] = useState(false)
  /** Minted on the first submit of this form, then reused by every retry. */
  const idempotencyKeyRef = useRef<string | null>(null)

  const locked = lockedRequest !== null
  // Without storage the frozen request lives only in this drawer: closing it
  // would lose the key that finishes the cancellation.
  // (Not once it succeeded: the success screen has nothing left to lose.)
  const mustStayOpen = locked && !kept && !result
  const busy = confirmOpen || blockModalOpen || submitting || mustStayOpen
  useEffect(() => {
    onBusyChange(busy)
  }, [busy, onBusyChange])
  useEffect(() => () => onBusyChange(false), [onBusyChange])

  const manualBlockActive = isManualBlockActive(reapplicationBlock)
  const blockRejection =
    blockRequestId && reapplicationBlock?.manualSetRejectedRequestId === blockRequestId
      ? (reapplicationBlock.manualSetRejection ?? 'no reason given')
      : null
  const waitingForBlock = Boolean(
    blockRequestId && !manualBlockActive && !blockRejection && !blockWaitExpired,
  )

  // A requested block arrives on the customer record, not on the request's
  // response, so re-read the customer until it shows, is refused, or we give up.
  useEffect(() => {
    if (!waitingForBlock) return
    const poll = setInterval(() => onRefresh?.(), POLL_MS)
    const giveUp = setTimeout(() => setBlockWaitExpired(true), POLL_GIVE_UP_MS)
    return () => {
      clearInterval(poll)
      clearTimeout(giveUp)
    }
  }, [waitingForBlock, onRefresh])

  const evidenceRequired = reason === 'mutual_cancellation'
  const noteLength = note.trim().length
  const noBlockReasonLength = noBlockReason.trim().length

  const blockConfirmation: BlockConfirmation | null = manualBlockActive
    ? { kind: 'manual_block_active' }
    : noBlockNeeded && noBlockReasonLength >= MIN_NO_BLOCK_REASON_LENGTH
      ? { kind: 'no_block_needed', reason: noBlockReason.trim() }
      : null

  const missing: { href: string; text: string }[] = []
  if (!reason) missing.push({ href: '#cancel-loan-reason', text: 'Choose a reason' })
  if (noteLength < MIN_CANCELLATION_NOTE_LENGTH) {
    missing.push({
      href: '#cancel-loan-note',
      text: `Write a note of at least ${MIN_CANCELLATION_NOTE_LENGTH} characters`,
    })
  }
  if (evidenceRequired && !evidenceRef.trim()) {
    missing.push({ href: '#cancel-loan-evidence', text: 'Add the evidence reference' })
  }
  if (!blockConfirmation) {
    missing.push({
      href: '#cancel-loan-block',
      text: 'Set a manual block, or confirm that none is needed',
    })
  }

  /** What this cancel will send, less the idempotency key; null until complete. */
  const draft: Omit<CancelRequest, 'idempotencyKey'> | null =
    reason && blockConfirmation && missing.length === 0
      ? {
          loanAccountId,
          reason,
          note: note.trim(),
          ...(evidenceRequired ? { evidenceRef: evidenceRef.trim() } : {}),
          blockConfirmation,
        }
      : null
  const shown = lockedRequest ?? draft
  const canSubmit = shown !== null

  /** Keep this exact request until an answer settles it. */
  const freeze = (request: CancelRequest) => {
    setLockedRequest(request)
    const saved = saveFrozenCancellation(request, ownerId)
    setKept(saved)
    setHeldByAnother(!saved && frozenCancellationHeldByAnother(loanAccountId, ownerId))
  }

  /** The platform answered for this key and holds nothing for it: start afresh. */
  const unfreeze = () => {
    clearFrozenCancellation(loanAccountId, ownerId)
    setLockedRequest(null)
    setResumed(false)
    setKept(true)
    setHeldByAnother(false)
    idempotencyKeyRef.current = null
  }

  /*
   * What settles a request:
   * - success (2xx): done;
   * - NOT_CANCELLABLE or VALIDATION: the platform itself answered this key and
   *   holds no claim for it (a claim or record for the key would have been
   *   resumed or replayed instead).
   * Anything else keeps a frozen request: 5xx, 409 ACCOUNT_BUSY or no answer
   * (the outcome is unknown), and the CRM's own refusals on a retry
   * (BLOCK_REQUIRED, 401/403, 404, a 400 from the form check), because the
   * platform was not asked this time and may still hold the first attempt.
   * On a first attempt those refusals mean nothing was sent, so nothing is
   * frozen.
   */
  const submit = async () => {
    let request = lockedRequest
    if (!request) {
      if (!draft) return
      idempotencyKeyRef.current ??= crypto.randomUUID()
      request = { ...draft, idempotencyKey: idempotencyKeyRef.current }
    }
    setSubmitting(true)
    setError(null)
    try {
      let res: Response
      try {
        res = await fetch('/api/ledger/cancel-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(request),
        })
      } catch {
        freeze(request)
        setError(UNSENT_MESSAGE)
        return
      }
      const body = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>

      if (res.ok && body.success === true) {
        clearFrozenCancellation(loanAccountId, ownerId)
        setResult({ noteError: body.noteError === true })
        onRefresh?.()
        return
      }

      const message = messageFrom(body)
      if (res.status >= 500 || res.ok || res.status === 409) {
        // The cancel may be part-way through, or the account was busy. Only
        // the same request, with the same key, is safe to send again.
        freeze(request)
        setError(message ?? UNSENT_MESSAGE)
      } else if (body.error === 'NOT_CANCELLABLE') {
        unfreeze()
        setError(`This loan can’t be cancelled: ${message ?? 'the ledger refused it.'}`)
        onRefresh?.()
      } else if (body.error === 'VALIDATION') {
        unfreeze()
        setError(message ?? 'The ledger refused the request.')
      } else if (body.error === 'BLOCK_REQUIRED') {
        setError(message ?? 'This customer has no active manual re-application block.')
        onRefresh?.()
      } else if (res.status === 401 || res.status === 403) {
        setError(message ?? 'You do not have permission to cancel loans.')
      } else {
        // 400 form check / 404: refused before the ledger was asked.
        setError(message ?? 'The loan was not cancelled.')
      }
    } finally {
      setSubmitting(false)
      setConfirmOpen(false)
    }
  }

  // A frozen request that claimed the customer's manual block, which has since
  // gone: the route will refuse it until the block is set again.
  const frozenNeedsBlock =
    lockedRequest?.blockConfirmation.kind === 'manual_block_active' && !manualBlockActive

  const blockSummary = manualBlockActive
    ? `${formatBlockLabel(reapplicationBlock)} (${formatBlockedUntil(reapplicationBlock ?? {})})`
    : null

  return (
    <>
      {result ? (
        <div className={styles.form}>
          <div className={styles.success} role="status">
            <p className={styles.successTitle}>Loan {accountNumber} cancelled.</p>
            <p className={styles.successText}>
              It shows as Cancelled once the update reaches the CRM, usually within a few seconds.
            </p>
          </div>
          {result.noteError && (
            <div className={styles.warning} role="alert">
              The cancellation is recorded, but the contact note was not written. Add a note to the
              customer’s timeline.
            </div>
          )}
          <div className={styles.actions}>
            <button type="button" className={styles.secondaryBtn} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) setConfirmOpen(true)
          }}
        >
          <div className={styles.summary}>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Account</span>
              <span className={styles.summaryValue}>{accountNumber}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Customer</span>
              <span className={styles.summaryValue}>{customerName || customerId}</span>
            </div>
          </div>

          {error && (
            <div className={styles.error} role="alert">
              {error}
            </div>
          )}
          {resumed && (
            <p className={styles.info} role="status">
              A cancellation for this loan is in progress — retry to finish it.
            </p>
          )}
          {locked && heldByAnother && (
            <p className={styles.info}>
              Another operator has an unfinished cancellation for this loan in this browser, so this
              one cannot be kept here.
            </p>
          )}
          {locked && (
            <p className={styles.hint}>
              {kept
                ? 'Try again to finish it: it sends exactly the same request, so the loan is never cancelled twice. You can close this drawer; the cancellation stays here until it is finished.'
                : 'Keep this drawer open and try again to finish it: it sends exactly the same request, so the loan is never cancelled twice.'}
            </p>
          )}

          <div className={styles.field}>
            <label htmlFor="cancel-loan-reason" className={styles.label}>
              Reason
            </label>
            <select
              id="cancel-loan-reason"
              className={styles.input}
              value={lockedRequest?.reason ?? reason}
              onChange={(e) => setReason(e.target.value as CancellationReasonCode | '')}
              disabled={locked || submitting}
              required
            >
              <option value="">Select a reason…</option>
              {CANCELLATION_REASON_CODES.map((code) => (
                <option key={code} value={code}>
                  {CANCELLATION_REASON_LABELS[code]}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label htmlFor="cancel-loan-note" className={styles.label}>
              Note
            </label>
            <textarea
              id="cancel-loan-note"
              className={styles.textarea}
              value={lockedRequest?.note ?? note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              disabled={locked || submitting}
              required
              aria-describedby="cancel-loan-note-count"
            />
            <p id="cancel-loan-note-count" className={styles.hint}>
              {(lockedRequest?.note ?? note).trim().length}/{MIN_CANCELLATION_NOTE_LENGTH}{' '}
              characters minimum
            </p>
          </div>

          {evidenceRequired && (
            <div className={styles.field}>
              <label htmlFor="cancel-loan-evidence" className={styles.label}>
                Evidence reference
              </label>
              <input
                id="cancel-loan-evidence"
                type="text"
                className={styles.input}
                value={lockedRequest?.evidenceRef ?? evidenceRef}
                onChange={(e) => setEvidenceRef(e.target.value)}
                disabled={locked || submitting}
                required
                aria-describedby="cancel-loan-evidence-hint"
              />
              <p id="cancel-loan-evidence-hint" className={styles.hint}>
                Where the customer’s agreement to cancel is kept, such as a ticket or document.
              </p>
            </div>
          )}

          <fieldset id="cancel-loan-block" className={styles.blockSection}>
            <legend className={styles.label}>Re-application block</legend>
            {manualBlockActive ? (
              <p className={styles.blockInPlace}>
                Manual block in place: <strong>{blockSummary}</strong>
              </p>
            ) : (
              <>
                <p className={styles.hint}>
                  {frozenNeedsBlock
                    ? 'This cancellation relies on a manual block that is no longer on the customer record. Set it again, then try again.'
                    : 'This customer has no active manual block. Once the loan is cancelled they could apply again straight away.'}
                </p>
                {waitingForBlock && (
                  <p className={styles.info} role="status">
                    Manual block requested. Waiting for it to reach the customer record…
                  </p>
                )}
                {blockWaitExpired && !blockRejection && (
                  <p className={styles.info} role="status">
                    The manual block has not reached the customer record yet. The block service may
                    be switched off. Request it again later, or confirm that no block is needed.
                  </p>
                )}
                {blockRejection && (
                  <p className={styles.error} role="alert">
                    The manual block was not set: {blockRejection}
                  </p>
                )}
                {!waitingForBlock && (!locked || frozenNeedsBlock) && (
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => setBlockModalOpen(true)}
                    disabled={submitting}
                  >
                    Set manual block
                  </button>
                )}
                {!frozenNeedsBlock && (
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={
                        lockedRequest
                          ? lockedRequest.blockConfirmation.kind === 'no_block_needed'
                          : noBlockNeeded
                      }
                      onChange={(e) => setNoBlockNeeded(e.target.checked)}
                      disabled={locked || submitting}
                    />
                    No block needed
                  </label>
                )}
                {(noBlockNeeded || lockedRequest?.blockConfirmation.kind === 'no_block_needed') && (
                  <div className={styles.field}>
                    <label htmlFor="cancel-loan-no-block-reason" className={styles.label}>
                      Why no block is needed
                    </label>
                    <textarea
                      id="cancel-loan-no-block-reason"
                      className={styles.textarea}
                      value={
                        lockedRequest?.blockConfirmation.kind === 'no_block_needed'
                          ? lockedRequest.blockConfirmation.reason
                          : noBlockReason
                      }
                      onChange={(e) => setNoBlockReason(e.target.value)}
                      rows={2}
                      disabled={locked || submitting}
                      aria-describedby="cancel-loan-no-block-count"
                    />
                    <p id="cancel-loan-no-block-count" className={styles.hint}>
                      {lockedRequest?.blockConfirmation.kind === 'no_block_needed'
                        ? lockedRequest.blockConfirmation.reason.length
                        : noBlockReasonLength}
                      /{MIN_NO_BLOCK_REASON_LENGTH} characters minimum
                    </p>
                  </div>
                )}
              </>
            )}
          </fieldset>

          {!locked && missing.length > 0 && (
            <div className={styles.missing} aria-live="polite">
              <p id="cancel-loan-missing" className={styles.missingTitle}>
                Still needed
              </p>
              <ul aria-labelledby="cancel-loan-missing" className={styles.missingList}>
                {missing.map((item) => (
                  <li key={item.href}>
                    <a href={item.href}>{item.text}</a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={onClose}
              disabled={submitting || mustStayOpen}
              title={
                mustStayOpen ? 'Try again first: closing would lose this cancellation' : undefined
              }
            >
              Close
            </button>
            <button
              type="submit"
              className={styles.dangerBtn}
              disabled={!canSubmit || submitting}
              data-testid="cancel-loan-submit"
            >
              {locked ? 'Try again' : 'Cancel loan'}
            </button>
          </div>
        </form>
      )}

      {confirmOpen && shown && (
        <Modal
          title="Cancel this loan?"
          onClose={() => setConfirmOpen(false)}
          dismissOnBackdropClick={!submitting}
          dismissOnEscape={!submitting}
          closeDisabled={submitting}
          testId="cancel-loan-confirm"
          maxWidth="480px"
        >
          <div className={styles.confirmBody}>
            <dl className={styles.confirmList}>
              <dt>Account</dt>
              <dd>{accountNumber}</dd>
              <dt>Customer</dt>
              <dd>{customerName || customerId}</dd>
              <dt>Reason</dt>
              <dd>{CANCELLATION_REASON_LABELS[shown.reason]}</dd>
              <dt>Re-application block</dt>
              <dd>
                {shown.blockConfirmation.kind === 'manual_block_active'
                  ? 'Manual block in place'
                  : 'None needed'}
              </dd>
            </dl>
            <p className={styles.irreversible}>
              <strong>This cannot be undone</strong>. The loan becomes Cancelled, its instalments
              are voided and it can never be disbursed.
            </p>
          </div>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
            >
              Go back
            </button>
            <button
              type="button"
              className={styles.dangerBtn}
              onClick={submit}
              disabled={submitting}
            >
              {submitting ? 'Cancelling…' : 'Cancel loan'}
            </button>
          </div>
        </Modal>
      )}

      {blockModalOpen && (
        <SetManualBlockModal
          onClose={() => setBlockModalOpen(false)}
          onRequested={(requestId) => {
            setBlockModalOpen(false)
            setBlockRequestId(requestId)
            setBlockWaitExpired(false)
            onRefresh?.()
          }}
          canonicalCustomerId={customerId}
          customerName={customerName}
          defaultReasonCode={reason === 'fraud_hold' ? 'fraud_hold' : 'cancelled_pre_disbursement'}
        />
      )}
    </>
  )
}
