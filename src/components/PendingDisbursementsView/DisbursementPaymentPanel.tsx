'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { useAnnouncerStore } from '@/stores/announcer'
import { useDisbursableCheck, type DisbursableVerdict } from '@/hooks/useDisbursableCheck'
import { recordDisbursementAccess } from '@/lib/disbursement-access-log'
import { OSKO_MESSAGE_MAX_LENGTH } from '@/lib/disbursement-payments'
import { formatDateOnly } from '@/lib/formatters'
import { PayoutField } from './PayoutField'
import type { QueueItem } from './DisbursementSection'
import styles from './DisbursementPaymentPanel.module.css'

interface Props {
  item: QueueItem
  onDisburse: (item: QueueItem) => void
}

type PayeeCheck = 'unchecked' | 'match' | 'mismatch'

/**
 * How each eKYC outcome reads next to the payee name.
 *
 * Deliberately four states rather than verified/unverified. A FAILED identity check
 * is a fraud signal and has to look different from one that simply has not run —
 * collapsing them would either understate a real hit or cry wolf on every customer
 * whose check is still pending, and a warning that is always on gets clicked past.
 */
const EKYC_META = {
  successful: { label: 'eKYC-verified identity', badge: '', tone: 'unverified' },
  failed: { label: 'Identity check FAILED', badge: '🛑 eKYC failed', tone: 'ekycFailed' },
  pending: { label: 'Customer (eKYC pending)', badge: '⚠ check not complete', tone: 'unverified' },
  unknown: { label: 'Customer (no eKYC record)', badge: '⚠ not verified', tone: 'unverified' },
} as const

/** Shown while the platform has not yet answered. Carries no payout details. */
const CHECKING_COPY = 'Checking with the platform that this loan can be paid…'

/** Fail-closed copy: no answer is "do not pay", never "probably fine". */
const CHECK_FAILED_COPY =
  "🛑 Couldn't confirm with the platform that this loan can be paid. Don't pay until this clears."

interface BlockedCopy {
  /** The do-not-pay line, announced to assistive tech as well. */
  headline: string
  /** A second line, when there is something the operator should do next. */
  detail?: string
  /** Offer a Retry: the platform may simply not be ready yet. */
  retryable?: boolean
}

/**
 * What the operator reads when the platform says it would refuse DisburseLoan.
 * The CRM holds no rule of its own: this only words the platform's verdict. An
 * unfamiliar reason falls back to the platform's own message, so a reason the
 * platform adds later still reads as "do not pay" rather than slipping through.
 */
function blockedCopy(verdict: DisbursableVerdict): BlockedCopy {
  switch (verdict.reason) {
    case 'CANCELLED':
      return {
        headline:
          '🛑 Do not pay. The platform has recorded this loan as cancelled before disbursement.',
        detail:
          'This queue may be showing it from a stale update. Refresh the page to see its current status.',
      }
    case 'ALREADY_DISBURSED':
      return {
        headline: '🛑 Do not pay. The platform has already recorded a disbursement for this loan.',
      }
    case 'NOT_PENDING_DISBURSEMENT':
      return {
        headline: `🛑 Do not pay. The platform says this loan is ${verdict.status || 'not set up'} and can't be disbursed yet.`,
      }
    case 'NO_LEDGER_RECORD':
      return {
        headline:
          "🛑 Do not pay yet. The platform hasn't finished setting up this loan's ledger. Try again in a minute.",
        retryable: true,
      }
    default:
      return {
        headline: `🛑 Do not pay. ${verdict.message || "The platform says this loan can't be disbursed."}`,
      }
  }
}

/**
 * The per-loan payment panel. It asks the platform, the system of record,
 * whether DisburseLoan would accept this loan BEFORE it shows anything an
 * operator could pay from (BTB-517).
 *
 * The CRM is a projection and can show a stale status: a replayed
 * account.updated can put a cancelled loan back in the queue. "Mark disbursed"
 * is only reached after the operator has already paid by hand in ANZ, and by
 * then the platform's refusal comes too late to stop the money. So until the
 * platform answers, and whenever it says no or cannot be reached, the panel
 * shows a status or a stop message and none of the payout details, the copy
 * actions, the signed-agreement link or the disburse control.
 */
export function DisbursementPaymentPanel({ item, onDisburse }: Props) {
  const { state, retry } = useDisbursableCheck(item.loanAccountId)
  const announce = useAnnouncerStore((s) => s.announce)

  useEffect(() => {
    if (state.status === 'failed') {
      announce(CHECK_FAILED_COPY, 'assertive')
    } else if (state.status === 'answered') {
      if (state.verdict.disbursable) {
        announce('Platform confirmed this loan can be paid', 'polite')
      } else {
        announce(blockedCopy(state.verdict).headline, 'assertive')
      }
    }
  }, [state, announce])

  if (state.status === 'checking') {
    return (
      <div className={styles.panel}>
        <p className={styles.notice} role="status">
          {CHECKING_COPY}
        </p>
      </div>
    )
  }

  if (state.status === 'failed') {
    return (
      <div className={styles.panel}>
        <p className={styles.stop} role="alert" data-testid="disbursable-blocked">
          {CHECK_FAILED_COPY}
        </p>
        <div className={styles.blockActions}>
          <button type="button" className={styles.secondaryBtn} onClick={retry}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!state.verdict.disbursable) {
    const copy = blockedCopy(state.verdict)
    return (
      <div className={styles.panel}>
        <div className={styles.stop} role="alert" data-testid="disbursable-blocked">
          <p className={styles.stopLine}>{copy.headline}</p>
          {copy.detail && <p className={styles.stopLine}>{copy.detail}</p>}
        </div>
        {copy.retryable && (
          <div className={styles.blockActions}>
            <button type="button" className={styles.secondaryBtn} onClick={retry}>
              Retry
            </button>
          </div>
        )}
      </div>
    )
  }

  return <PaymentDetails item={item} onDisburse={onDisburse} />
}

/**
 * The platform has said this loan can be paid, so this is everything an operator
 * needs to pay one advance by hand in ANZ "Pay Anyone", and the
 * Confirmation-of-Payee gate they must pass first.
 *
 * Order matters and mirrors the operator's real sequence (ops spec §A2-A3):
 * copy the details → pay in ANZ → check the name the bank returns against the
 * identity Billie verified → only then mark it disbursed. The Disburse control
 * stays disabled until that name check is answered, so "stop on mismatch" is a
 * property of the UI rather than of the operator remembering.
 */
function PaymentDetails({ item, onDisburse }: Props) {
  const [payeeCheck, setPayeeCheck] = useState<PayeeCheck>('unchecked')
  const [messageCopied, setMessageCopied] = useState(false)
  const announce = useAnnouncerStore((s) => s.announce)
  const groupId = useId()

  const account = item.disbursementAccount

  const handleCopyMessage = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(item.oskoMessage)
      setMessageCopied(true)
      setTimeout(() => setMessageCopied(false), 2000)
      announce('Payment message copied', 'polite')
    } catch (err) {
      console.error('Failed to copy:', err)
      announce('Payment message could not be copied — copy it manually', 'assertive')
    }
  }, [announce, item.oskoMessage])

  const handleCopyAll = useCallback(async () => {
    if (!account) return
    const block = [
      account.holder ? `Name: ${account.holder}` : null,
      account.bsbFormatted ? `BSB: ${account.bsbFormatted}` : null,
      account.number ? `Account: ${account.number}` : null,
      `Amount: ${item.loanAmountFormatted}`,
      `Message: ${item.oskoMessage}`,
    ]
      .filter(Boolean)
      .join('\n')
    try {
      await navigator.clipboard.writeText(block)
      recordDisbursementAccess({
        loanAccountId: item.loanAccountId,
        accountNumber: item.accountNumber,
        action: 'copy',
        field: 'all',
      })
      announce('All payment details copied', 'polite')
    } catch (err) {
      console.error('Failed to copy:', err)
      announce('Payment details could not be copied — copy them manually', 'assertive')
    }
  }, [account, announce, item])

  const handleCheck = useCallback(
    (value: PayeeCheck) => {
      setPayeeCheck(value)
      announce(
        value === 'match'
          ? 'Payee name confirmed as matching'
          : 'Payee name marked as not matching — disbursement blocked',
        value === 'match' ? 'polite' : 'assertive',
      )
    },
    [announce],
  )

  const messageLength = item.oskoMessage.length

  return (
    <div className={styles.panel}>
      {/* ── 1. Where the money goes ────────────────────────────────── */}
      <section className={styles.block}>
        <h4 className={styles.blockTitle}>Pay to</h4>
        {account ? (
          <>
            <div className={styles.fieldGrid}>
              <PayoutField
                label="Account name"
                value={account.holder}
                field="holder"
                loanAccountId={item.loanAccountId}
                accountNumber={item.accountNumber}
              />
              <PayoutField
                label="BSB"
                value={account.bsbFormatted}
                field="bsb"
                loanAccountId={item.loanAccountId}
                accountNumber={item.accountNumber}
                mono
              />
              <PayoutField
                label="Account number"
                value={account.number}
                field="accountNumber"
                loanAccountId={item.loanAccountId}
                accountNumber={item.accountNumber}
                sensitive
                mono
              />
              <PayoutField
                label="Amount"
                value={item.loanAmountFormatted}
                field="all"
                loanAccountId={item.loanAccountId}
                accountNumber={item.accountNumber}
                mono
              />
            </div>
            {!account.isComplete && (
              <p className={styles.warn} role="alert">
                ⚠ Missing {account.missing.join(', ')}. Do not pay from a partial record —
                open the signed agreement and confirm the nominated account.
              </p>
            )}
            <div className={styles.blockActions}>
              <button type="button" className={styles.secondaryBtn} onClick={handleCopyAll}>
                Copy all details
              </button>
              {item.signedLoanAgreementUrl && (
                <a
                  className={styles.link}
                  href={`/api/loan-agreement?accountId=${encodeURIComponent(item.loanAccountId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open signed agreement ↗
                </a>
              )}
            </div>
          </>
        ) : (
          <p className={styles.warn} role="alert">
            ⚠ No nominated account on this loan. It was created before the payout details
            were carried on the account event, or the execution plan was missing. Open the
            signed agreement to read the nominated account before paying.
            {item.signedLoanAgreementUrl && (
              <>
                {' '}
                <a
                  className={styles.link}
                  href={`/api/loan-agreement?accountId=${encodeURIComponent(item.loanAccountId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open signed agreement ↗
                </a>
              </>
            )}
          </p>
        )}
      </section>

      {/* ── 2. The message that travels with the money ─────────────── */}
      <section className={styles.block}>
        <h4 className={styles.blockTitle}>
          Payment message
          <span className={styles.counter}>
            {messageLength}/{OSKO_MESSAGE_MAX_LENGTH}
          </span>
        </h4>
        <p className={styles.messageBox} data-testid="osko-message">
          {item.oskoMessage}
        </p>
        <div className={styles.blockActions}>
          <button type="button" className={styles.secondaryBtn} onClick={handleCopyMessage}>
            {messageCopied ? '✓ Copied' : 'Copy message'}
          </button>
          <span className={styles.hint}>
            Paste into ANZ&apos;s payment description. It lands on the customer&apos;s
            statement and is what next morning&apos;s reconciliation matches on.
          </span>
        </div>
      </section>

      {/* ── 3. Confirmation of Payee — the gate ────────────────────── */}
      <section className={styles.block}>
        <h4 className={styles.blockTitle}>Confirmation of Payee</h4>
        <div className={styles.copCompare}>
          <div className={styles.copSide}>
            <span className={styles.label}>Name ANZ should return</span>
            <span className={styles.copValue}>{account?.holder ?? '—'}</span>
          </div>
          <div className={styles.copSide}>
            <span className={styles.label}>{EKYC_META[item.ekycStatus].label}</span>
            <span className={styles.copValue}>
              {item.ekycVerifiedName ?? item.customerName}
              {EKYC_META[item.ekycStatus].badge && (
                <span className={styles[EKYC_META[item.ekycStatus].tone]}>
                  {' '}
                  {EKYC_META[item.ekycStatus].badge}
                </span>
              )}
            </span>
          </div>
        </div>

        <fieldset className={styles.checkGroup} aria-describedby={`${groupId}-help`}>
          <legend className={styles.checkLegend}>
            Does the name ANZ showed you match the customer?
          </legend>
          <p id={`${groupId}-help`} className={styles.hint}>
            Compare against the name ANZ returns at the confirmation step — not against
            this screen alone.
          </p>
          <div className={styles.checkOptions}>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name={`${groupId}-cop`}
                checked={payeeCheck === 'match'}
                onChange={() => handleCheck('match')}
              />
              Yes — names match
            </label>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name={`${groupId}-cop`}
                checked={payeeCheck === 'mismatch'}
                onChange={() => handleCheck('mismatch')}
              />
              No — names differ
            </label>
          </div>
        </fieldset>

        {payeeCheck === 'mismatch' && (
          <p className={styles.stop} role="alert">
            🛑 Stop. Do not disburse. A payee-name mismatch is a fraud and
            misdirected-payment signal. Escalate to a supervisor and leave the loan in
            this queue — do not retry with a different account.
          </p>
        )}
      </section>

      {/* ── 4. Disburse ────────────────────────────────────────────── */}
      <div className={styles.footer}>
        <div className={styles.footerMeta}>
          {item.firstDueDate && <>First repayment {formatDateOnly(item.firstDueDate)}</>}
        </div>
        {/*
          Gated on the payee-name check ALONE, never on whether we hold the payout
          details. "Mark disbursed" records a payment the operator has already made
          by hand in ANZ — it does not move money. Gating it on data completeness
          would not stop a bad payment; it would only strand a real one outside the
          ledger, which is the worse failure. Loans created before the payout details
          rode the account event have none, and they still have to be disbursable:
          the banner above sends the operator to the signed agreement to read the
          account, and this attests they checked the name the bank returned.
        */}
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={payeeCheck !== 'match'}
          onClick={() => onDisburse(item)}
          data-testid="panel-disburse"
        >
          Mark disbursed
        </button>
      </div>
      {payeeCheck === 'unchecked' && (
        <p className={styles.gateHint}>
          Confirm the payee name above to enable &ldquo;Mark disbursed&rdquo;.
        </p>
      )}
    </div>
  )
}
