'use client'

/**
 * Loan Account Servicing Panel
 * 
 * Custom component for the LoanAccounts collection that provides:
 * - Live balance display from ledger
 * - Transaction history with filtering
 * - Action buttons for payments, fees, waivers, etc.
 */

import React, { useState, useEffect } from 'react'
import { useDocumentInfo } from '@payloadcms/ui'
import { useUIStore } from '@/stores/ui'
import styles from './styles.module.css'

// Sub-components
import { BalanceCard } from './BalanceCard'
import { TransactionList } from './TransactionList'
import { RecordPaymentModal } from './RecordPaymentModal'
import { ApplyLateFeeModal } from './ApplyLateFeeModal'
import { WaiveFeeModal } from './WaiveFeeModal'
import { WriteOffModal } from './WriteOffModal'
import { AdjustmentModal } from './AdjustmentModal'
import { DisburseLoanModal } from './DisburseLoanModal'

type ModalType = 'payment' | 'lateFee' | 'waiveFee' | 'writeOff' | 'adjustment' | 'disburse' | null

export const LoanAccountServicing: React.FC = () => {
  const { id } = useDocumentInfo()
  const [loanAccountId, setLoanAccountId] = useState<string | null>(null)
  const [accountNumber, setAccountNumber] = useState<string | null>(null)
  const [activeModal, setActiveModal] = useState<ModalType>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [accountStatus, setAccountStatus] = useState<string>('active')
  const [loanAmount, setLoanAmount] = useState<number | null>(null)
  const readOnlyMode = useUIStore((state) => state.readOnlyMode)

  // Fetch the loanAccountId from the document
  useEffect(() => {
    if (id) {
      fetch(`/api/loan-accounts/${id}`)
        .then(res => res.json())
        .then(data => {
          setLoanAccountId(data.loanAccountId)
          setAccountNumber(data.accountNumber || null)
          setAccountStatus(data.accountStatus || 'active')
          setLoanAmount(data.loanTerms?.loanAmount ?? null)
        })
        .catch(err => console.error('Failed to fetch loan account:', err))
    }
  }, [id])

  const handleActionComplete = () => {
    setActiveModal(null)
    setRefreshKey(prev => prev + 1)
  }

  if (!loanAccountId) {
    return (
      <div className={styles.loading}>
        Loading account details...
      </div>
    )
  }

  const isWrittenOff = accountStatus === 'written_off'
  const isPaidOff = accountStatus === 'paid_off'
  const isPendingDisbursement = accountStatus === 'pending_disbursement'

  return (
    <div className={styles.container}>
      {/* Balance Card */}
      <BalanceCard 
        loanAccountId={loanAccountId} 
        refreshKey={refreshKey}
      />

      {/* Action Buttons */}
      <div className={styles.actionsSection}>
        <h3 className={styles.sectionTitle}>Account Actions</h3>

        {readOnlyMode && (
          <p className={styles.disabledNote} role="alert">
            🔒 System is in read-only mode. Actions are temporarily disabled.
          </p>
        )}

        <div className={styles.actionButtons}>
          {isPendingDisbursement && (
            <button
              className={`${styles.actionBtn} ${styles.primary}`}
              onClick={() => setActiveModal('disburse')}
              disabled={readOnlyMode}
              title={readOnlyMode ? 'System in read-only mode' : undefined}
            >
              <span className={styles.icon}>🏦</span>
              Disburse Loan
            </button>
          )}
          <button
            className={`${styles.actionBtn} ${styles.primary}`}
            onClick={() => setActiveModal('payment')}
            disabled={readOnlyMode || isWrittenOff || isPaidOff || isPendingDisbursement}
            title={readOnlyMode ? 'System in read-only mode' : isPendingDisbursement ? 'Account must be disbursed first' : undefined}
          >
            <span className={styles.icon}>💳</span>
            Record Payment
          </button>
          <button
            className={`${styles.actionBtn} ${styles.warning}`}
            onClick={() => setActiveModal('lateFee')}
            disabled={readOnlyMode || isWrittenOff || isPaidOff || isPendingDisbursement}
            title={readOnlyMode ? 'System in read-only mode' : isPendingDisbursement ? 'Account must be disbursed first' : undefined}
          >
            <span className={styles.icon}>⚠️</span>
            Apply Late Fee
          </button>
          <button
            className={`${styles.actionBtn} ${styles.success}`}
            onClick={() => setActiveModal('waiveFee')}
            disabled={readOnlyMode || isWrittenOff || isPendingDisbursement}
            title={readOnlyMode ? 'System in read-only mode' : isPendingDisbursement ? 'Account must be disbursed first' : undefined}
          >
            <span className={styles.icon}>🎁</span>
            Waive Fee
          </button>
          <button
            className={`${styles.actionBtn} ${styles.neutral}`}
            onClick={() => setActiveModal('adjustment')}
            disabled={readOnlyMode || isWrittenOff || isPendingDisbursement}
            title={readOnlyMode ? 'System in read-only mode' : isPendingDisbursement ? 'Account must be disbursed first' : undefined}
          >
            <span className={styles.icon}>📝</span>
            Adjustment
          </button>
          <button
            className={`${styles.actionBtn} ${styles.danger}`}
            onClick={() => setActiveModal('writeOff')}
            disabled={readOnlyMode || isWrittenOff || isPaidOff || isPendingDisbursement}
            title={readOnlyMode ? 'System in read-only mode' : isPendingDisbursement ? 'Account must be disbursed first' : undefined}
          >
            <span className={styles.icon}>❌</span>
            Write Off
          </button>
        </div>
        {!readOnlyMode && (isWrittenOff || isPaidOff || isPendingDisbursement) && (
          <p className={styles.disabledNote}>
            {isPendingDisbursement
              ? 'This account is pending disbursement. Disburse funds before performing other actions.'
              : isWrittenOff 
                ? 'This account has been written off. Most actions are disabled.'
                : 'This account is paid off. Payment and fee actions are disabled.'
            }
          </p>
        )}
      </div>

      {/* Transaction History */}
      <TransactionList 
        loanAccountId={loanAccountId}
        refreshKey={refreshKey}
      />

      {/* Modals */}
      {activeModal === 'payment' && (
        <RecordPaymentModal
          loanAccountId={loanAccountId}
          onClose={() => setActiveModal(null)}
          onSuccess={handleActionComplete}
        />
      )}
      {activeModal === 'lateFee' && (
        <ApplyLateFeeModal
          loanAccountId={loanAccountId}
          onClose={() => setActiveModal(null)}
          onSuccess={handleActionComplete}
        />
      )}
      {activeModal === 'waiveFee' && (
        <WaiveFeeModal
          loanAccountId={loanAccountId}
          onClose={() => setActiveModal(null)}
          onSuccess={handleActionComplete}
        />
      )}
      {activeModal === 'writeOff' && (
        <WriteOffModal
          loanAccountId={loanAccountId}
          onClose={() => setActiveModal(null)}
          onSuccess={handleActionComplete}
        />
      )}
      {activeModal === 'adjustment' && (
        <AdjustmentModal
          loanAccountId={loanAccountId}
          onClose={() => setActiveModal(null)}
          onSuccess={handleActionComplete}
        />
      )}
      {activeModal === 'disburse' && (
        <DisburseLoanModal
          loanAccountId={loanAccountId}
          accountNumber={accountNumber || ''}
          defaultAmount={loanAmount}
          onClose={() => setActiveModal(null)}
          onSuccess={handleActionComplete}
        />
      )}
    </div>
  )
}

export default LoanAccountServicing


