'use client'

import type { LoanAccountData } from '@/hooks/queries/useCustomer'
import { useCarryingAmountBreakdown } from '@/hooks/queries/useCarryingAmountBreakdown'
import { getAccountSignal } from '@/lib/accountTriage'
import { RepaymentScheduleList } from './RepaymentScheduleList'
import styles from './styles.module.css'

export interface OverviewTabProps {
  account: LoanAccountData
  /** Callback to navigate to a transaction in the Transactions tab */
  onNavigateToTransaction?: (transactionId: string) => void
}

// Hoisted for performance
const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
})

const dateFormatter = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

function formatDate(dateString: string | null): string {
  if (!dateString) return '—'
  try {
    return dateFormatter.format(new Date(dateString))
  } catch {
    return '—'
  }
}

function formatFrequency(freq: string | null | undefined): string {
  if (!freq) return ''
  const map: Record<string, string> = { weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly' }
  return map[freq] ?? freq
}

/**
 * OverviewTab - Displays account balance details, loan terms, and payment info.
 * Refactored from LoanAccountDetails (minus action buttons).
 */
export const OverviewTab: React.FC<OverviewTabProps> = ({ account, onNavigateToTransaction }) => {
  const hasLiveBalance = account.liveBalance !== null
  const { breakdown: carryingAmountBreakdown } = useCarryingAmountBreakdown(account.loanAccountId)

  const principal = hasLiveBalance
    ? account.liveBalance!.principalBalance
    : account.balances?.currentBalance ?? 0
  const fees = hasLiveBalance ? account.liveBalance!.feeBalance : 0
  const totalOutstanding = hasLiveBalance
    ? account.liveBalance!.totalOutstanding
    : account.balances?.totalOutstanding ?? 0

  // Prefer Ledger carrying-amount breakdown for Total Paid when available (matches modal).
  // Fallback: Payload balances.totalPaid, then sum of schedule amountPaid. See docs/bugs/LEDGER-GetCarryingAmountBreakdown-total-paid-zero.md
  const totalPaidFromBreakdown =
    carryingAmountBreakdown?.totalPaid != null && carryingAmountBreakdown.totalPaid !== ''
      ? parseFloat(carryingAmountBreakdown.totalPaid)
      : null
  const totalPaidFromPayload = account.balances?.totalPaid ?? 0
  const totalPaidFromSchedule =
    account.repaymentSchedule?.payments?.reduce(
      (sum, p) => sum + (p.amountPaid ?? 0),
      0
    ) ?? 0
  const totalPaid =
    (totalPaidFromBreakdown != null && totalPaidFromBreakdown > 0
      ? totalPaidFromBreakdown
      : totalPaidFromPayload) || totalPaidFromSchedule
  const showTotalPaid =
    hasLiveBalance ||
    carryingAmountBreakdown != null ||
    account.balances?.totalPaid != null ||
    totalPaidFromSchedule > 0

  // Repayment progress (mockup parity): paid count, progress bar, next instalment, last payment
  const payments = account.repaymentSchedule?.payments ?? []
  const totalPayments = account.repaymentSchedule?.numberOfPayments ?? payments.length
  const paidCount = payments.filter((p) => p.status === 'paid').length
  const progressPct = totalPayments > 0 ? Math.round((paidCount / totalPayments) * 100) : 0
  const signal = getAccountSignal(account)
  const hasLastPayment = !!(account.lastPayment && (account.lastPayment.date || account.lastPayment.amount))
  const showProgress = payments.length > 0 || hasLastPayment

  return (
    <div
      className={styles.overviewTab}
      role="tabpanel"
      id="tabpanel-overview"
      aria-labelledby="tab-overview"
      data-testid="overview-tab"
    >
      {/* Row 1: Balance + Last Payment side-by-side */}
      <div className={styles.overviewGridTwo}>
        {/* Balance Section */}
        <div className={styles.overviewSection}>
          <h4 className={styles.overviewSectionTitle}>
            Current Balance
            {hasLiveBalance ? (
              <span className={styles.overviewLiveTag}>Live</span>
            ) : (
              <span className={styles.overviewCachedTag}>Cached</span>
            )}
          </h4>
          <div className={styles.overviewGrid}>
            <div className={styles.overviewItem}>
              <span className={styles.overviewLabel}>Principal</span>
              <span className={styles.overviewValue}>{currencyFormatter.format(principal)}</span>
            </div>
            {hasLiveBalance && (
              <div className={styles.overviewItem}>
                <span className={styles.overviewLabel}>Fees</span>
                <span className={styles.overviewValue}>{currencyFormatter.format(fees)}</span>
              </div>
            )}
            <div className={styles.overviewItem}>
              <span className={styles.overviewLabel}>Total Outstanding</span>
              <span className={`${styles.overviewValue} ${styles.overviewValueHighlight}`}>
                {currencyFormatter.format(totalOutstanding)}
              </span>
            </div>
            {showTotalPaid && (
              <div className={styles.overviewItem}>
                <span className={styles.overviewLabel}>Total Paid</span>
                <span className={styles.overviewValue}>
                  {currencyFormatter.format(totalPaid)}
                </span>
              </div>
            )}
          </div>
          {hasLiveBalance && account.liveBalance?.asOf && (
            <p className={styles.overviewTimestamp}>
              Balance as of {formatDate(account.liveBalance.asOf)}
            </p>
          )}
        </div>

        {/* Repayment progress */}
        {showProgress && (
          <div className={styles.overviewSection}>
            <h4 className={styles.overviewSectionTitle}>Repayment progress</h4>
            {totalPayments > 0 && (
              <>
                <div className={styles.progressTop}>
                  <span>
                    <strong>
                      {paidCount} of {totalPayments}
                    </strong>{' '}
                    paid
                  </span>
                  {account.repaymentSchedule?.paymentFrequency && (
                    <span className={styles.progressFreq}>
                      {formatFrequency(account.repaymentSchedule.paymentFrequency)}
                    </span>
                  )}
                </div>
                <div className={styles.progressBar}>
                  <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
                </div>
              </>
            )}
            {signal.nextDueDate && (
              <div className={signal.isOverdue ? styles.progressNextOverdue : styles.progressNext}>
                Next: {currencyFormatter.format(signal.nextDueAmount ?? 0)}
                {signal.isOverdue
                  ? ` — overdue ${signal.daysOverdue}d`
                  : ` · ${formatDate(signal.nextDueDate)}`}
              </div>
            )}
            {hasLastPayment && (
              <div className={styles.progressLast}>
                Last payment{' '}
                {account.lastPayment!.amount
                  ? currencyFormatter.format(account.lastPayment!.amount)
                  : '—'}
                {account.lastPayment!.date ? ` · ${formatDate(account.lastPayment!.date)}` : ''}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Repayment Schedule — full width */}
      {account.repaymentSchedule && (
        <div className={styles.overviewSection}>
          <h4 className={styles.overviewSectionTitle}>Repayment Schedule</h4>
          <RepaymentScheduleList
            payments={account.repaymentSchedule.payments}
            numberOfPayments={account.repaymentSchedule.numberOfPayments}
            paymentFrequency={account.repaymentSchedule.paymentFrequency}
            onNavigateToTransaction={onNavigateToTransaction}
          />
        </div>
      )}

      {/* Row 2: Loan Terms + Loan agreement side-by-side */}
      <div className={styles.overviewGridTwo}>
        {/* Loan Terms */}
        {account.loanTerms && (
          <div className={styles.overviewSection}>
            <h4 className={styles.overviewSectionTitle}>Loan Terms</h4>
            <div className={styles.overviewGrid}>
              <div className={styles.overviewItem}>
                <span className={styles.overviewLabel}>Loan Amount</span>
                <span className={styles.overviewValue}>
                  {account.loanTerms.loanAmount
                    ? currencyFormatter.format(account.loanTerms.loanAmount)
                    : '—'}
                </span>
              </div>
              <div className={styles.overviewItem}>
                <span className={styles.overviewLabel}>Loan Fee</span>
                <span className={styles.overviewValue}>
                  {account.loanTerms.loanFee
                    ? currencyFormatter.format(account.loanTerms.loanFee)
                    : '—'}
                </span>
              </div>
              <div className={styles.overviewItem}>
                <span className={styles.overviewLabel}>Total Payable</span>
                <span className={styles.overviewValue}>
                  {account.loanTerms.totalPayable
                    ? currencyFormatter.format(account.loanTerms.totalPayable)
                    : '—'}
                </span>
              </div>
              <div className={styles.overviewItem}>
                <span className={styles.overviewLabel}>Opened</span>
                <span className={styles.overviewValue}>{formatDate(account.loanTerms.openedDate)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Loan agreement link - when available */}
        {account.signedLoanAgreementUrl && (
          <div className={styles.overviewSection}>
            <h4 className={styles.overviewSectionTitle}>Loan agreement</h4>
            <a
              href={`/api/loan-agreement?accountId=${encodeURIComponent(account.loanAccountId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.overviewLink}
              data-testid="view-loan-agreement"
            >
              <span aria-hidden>📄</span>
              View signed loan agreement
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
