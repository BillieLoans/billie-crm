'use client'

import { useCallback, useId, useState } from 'react'
import { useAnnouncerStore } from '@/stores/announcer'
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
 * The per-loan payment panel: everything an operator needs to pay one advance by
 * hand in ANZ "Pay Anyone", and the Confirmation-of-Payee gate they must pass first.
 *
 * Order matters and mirrors the operator's real sequence (ops spec §A2-A3):
 * copy the details → pay in ANZ → check the name the bank returns against the
 * identity Billie verified → only then mark it disbursed. The Disburse control
 * stays disabled until that name check is answered, so "stop on mismatch" is a
 * property of the UI rather than of the operator remembering.
 */
export function DisbursementPaymentPanel({ item, onDisburse }: Props) {
  const [payeeCheck, setPayeeCheck] = useState<PayeeCheck>('unchecked')
  const [messageCopied, setMessageCopied] = useState(false)
  const announce = useAnnouncerStore((s) => s.announce)
  const groupId = useId()

  const account = item.disbursementAccount
  const canPay = account?.isComplete === true

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
            <span className={styles.label}>
              {item.identityVerified ? 'eKYC-verified identity' : 'Customer (not eKYC-verified)'}
            </span>
            <span className={styles.copValue}>
              {item.ekycVerifiedName ?? item.customerName}
              {!item.identityVerified && <span className={styles.unverified}> ⚠ unverified</span>}
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
        <button
          type="button"
          className={styles.primaryBtn}
          disabled={payeeCheck !== 'match' || !canPay}
          onClick={() => onDisburse(item)}
          data-testid="panel-disburse"
        >
          Mark disbursed
        </button>
      </div>
      {payeeCheck === 'unchecked' && canPay && (
        <p className={styles.gateHint}>
          Confirm the payee name above to enable &ldquo;Mark disbursed&rdquo;.
        </p>
      )}
    </div>
  )
}
