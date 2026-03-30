'use client'

import React, { useState, useEffect, useCallback } from 'react'
import styles from './styles.module.css'

interface Transaction {
  transactionId: string
  type: string
  transactionDate: { seconds: string; nanos: number }
  principalDelta: string
  feeDelta: string
  totalAfter: string
  description: string
}

interface TransactionListProps {
  loanAccountId: string
  refreshKey: number
}

const TRANSACTION_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'DISBURSEMENT', label: 'Disbursement' },
  { value: 'ESTABLISHMENT_FEE', label: 'Establishment Fee' },
  { value: 'REPAYMENT', label: 'Repayment' },
  { value: 'LATE_FEE', label: 'Late Fee' },
  { value: 'DISHONOUR_FEE', label: 'Dishonour Fee' },
  { value: 'FEE_WAIVER', label: 'Fee Waiver' },
  { value: 'ADJUSTMENT', label: 'Adjustment' },
  { value: 'WRITE_OFF', label: 'Write Off' },
]

export const TransactionList: React.FC<TransactionListProps> = ({ loanAccountId, refreshKey }) => {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('')
  const [limit] = useState(20)
  const [offset, setOffset] = useState(0)

  const [isFallback, setIsFallback] = useState(false)
  const [fallbackMessage, setFallbackMessage] = useState<string | null>(null)

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    try {
      let url = `/api/ledger/transactions?loanAccountId=${loanAccountId}&limit=${limit}`
      if (typeFilter) {
        url += `&type=${typeFilter}`
      }

      const res = await fetch(url)
      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to fetch transactions')
      }
      const data = await res.json()
      setTransactions(data.transactions || [])
      setTotalCount(data.totalCount || 0)
      setIsFallback(!!data._fallback)
      setFallbackMessage(data._message || null)
    } catch (err) {
      console.error('Error fetching transactions:', err)
      setTransactions([])
      setIsFallback(true)
      setFallbackMessage('Unable to connect to ledger service')
    } finally {
      setLoading(false)
    }
  }, [loanAccountId, limit, typeFilter])

  useEffect(() => {
    fetchTransactions()
  }, [fetchTransactions, refreshKey, offset])

  const formatCurrency = (amount: string) => {
    const num = parseFloat(amount || '0')
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      signDisplay: 'exceptZero',
    }).format(num)
  }

  const formatDate = (timestamp: { seconds: string; nanos: number }) => {
    const date = new Date(parseInt(timestamp.seconds) * 1000)
    return date.toLocaleDateString('en-AU', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  }

  const getTypeBadgeClass = (type: string) => {
    const typeMap: Record<string, string> = {
      'DISBURSEMENT': styles.typeDisbursement,
      'ESTABLISHMENT_FEE': styles.typeEstablishmentFee,
      'REPAYMENT': styles.typeRepayment,
      'LATE_FEE': styles.typeLateFee,
      'DISHONOUR_FEE': styles.typeLateFee,
      'FEE_WAIVER': styles.typeFeeWaiver,
      'ADJUSTMENT': styles.typeAdjustment,
      'WRITE_OFF': styles.typeWriteOff,
    }
    return typeMap[type] || styles.typeAdjustment
  }

  const getTypeLabel = (type: string) => {
    const found = TRANSACTION_TYPES.find(t => t.value === type)
    return found?.label || type.replace(/_/g, ' ')
  }

  const calculateTotalDelta = (principal: string, fee: string) => {
    return parseFloat(principal || '0') + parseFloat(fee || '0')
  }

  const totalPages = Math.ceil(totalCount / limit)
  const currentPage = Math.floor(offset / limit) + 1

  return (
    <div className={styles.transactionSection}>
      <div className={styles.transactionHeader}>
        <h3 className={styles.sectionTitle}>
          Transaction History ({totalCount} transactions)
        </h3>
        <div className={styles.filterGroup}>
          <select 
            className={styles.filterSelect}
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value)
              setOffset(0)
            }}
          >
            {TRANSACTION_TYPES.map(type => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className={styles.noTransactions}>Loading transactions...</div>
      ) : isFallback ? (
        <div className={styles.noTransactions}>
          <div style={{ marginBottom: '0.5rem' }}>⚠️ {fallbackMessage || 'Ledger service unavailable'}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--theme-elevation-400)' }}>
            Transaction history requires a connection to the ledger service.
          </div>
        </div>
      ) : transactions.length === 0 ? (
        <div className={styles.noTransactions}>
          No transactions found {typeFilter && `for type "${getTypeLabel(typeFilter)}"`}
        </div>
      ) : (
        <>
          <table className={styles.transactionTable}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Description</th>
                <th style={{ textAlign: 'right' }}>Principal</th>
                <th style={{ textAlign: 'right' }}>Fee</th>
                <th style={{ textAlign: 'right' }}>Net Effect</th>
                <th style={{ textAlign: 'right' }}>Balance After</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((txn) => {
                const totalDelta = calculateTotalDelta(txn.principalDelta, txn.feeDelta)
                const isCredit = totalDelta < 0
                return (
                  <tr key={txn.transactionId}>
                    <td>{formatDate(txn.transactionDate)}</td>
                    <td>
                      <span className={`${styles.typeBadge} ${getTypeBadgeClass(txn.type)}`}>
                        {getTypeLabel(txn.type)}
                      </span>
                    </td>
                    <td>{txn.description}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span className={parseFloat(txn.principalDelta) >= 0 ? styles.amountPositive : styles.amountNegative}>
                        {formatCurrency(txn.principalDelta)}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className={parseFloat(txn.feeDelta) >= 0 ? styles.amountPositive : styles.amountNegative}>
                        {formatCurrency(txn.feeDelta)}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span className={isCredit ? styles.amountNegative : styles.amountPositive}>
                        {formatCurrency(totalDelta.toString())}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 500 }}>
                      {formatCurrency(txn.totalAfter)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className={styles.pagination}>
              <button
                className={styles.pageBtn}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0}
              >
                Previous
              </button>
              <span className={styles.pageInfo}>
                Page {currentPage} of {totalPages}
              </span>
              <button
                className={styles.pageBtn}
                onClick={() => setOffset(offset + limit)}
                disabled={currentPage >= totalPages}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

