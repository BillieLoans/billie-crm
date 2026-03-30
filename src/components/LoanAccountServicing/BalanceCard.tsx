'use client'

import React, { useState, useEffect, useCallback } from 'react'
import styles from './styles.module.css'

interface BalanceData {
  principalBalance: string
  feeBalance: string
  totalOutstanding: string
  asOf: { seconds: string; nanos: number }
  _fallback?: boolean
  _message?: string
}

interface BalanceCardProps {
  loanAccountId: string
  refreshKey: number
}

export const BalanceCard: React.FC<BalanceCardProps> = ({ loanAccountId, refreshKey }) => {
  const [balance, setBalance] = useState<BalanceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isFallback, setIsFallback] = useState(false)

  const fetchBalance = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ledger/balance?loanAccountId=${loanAccountId}`)
      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to fetch balance')
      }
      const data = await res.json()
      setBalance(data)
      setIsFallback(!!data._fallback)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [loanAccountId])

  useEffect(() => {
    fetchBalance()
  }, [fetchBalance, refreshKey])

  const formatCurrency = (amount: string) => {
    const num = parseFloat(amount || '0')
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
    }).format(num)
  }

  const formatDate = (timestamp: { seconds: string; nanos: number }) => {
    const date = new Date(parseInt(timestamp.seconds) * 1000)
    return date.toLocaleString('en-AU', {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  }

  if (loading) {
    return (
      <div className={styles.balanceCard}>
        <div className={styles.balanceHeader}>
          <h3 className={styles.balanceTitle}>Live Balance</h3>
        </div>
        <p style={{ textAlign: 'center', padding: '1rem' }}>Loading...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.balanceCard}>
        <div className={styles.balanceHeader}>
          <h3 className={styles.balanceTitle}>Live Balance</h3>
          <button className={styles.refreshBtn} onClick={fetchBalance}>
            Retry
          </button>
        </div>
        <p style={{ textAlign: 'center', padding: '1rem', color: '#fca5a5' }}>
          Error: {error}
        </p>
      </div>
    )
  }

  return (
    <div className={styles.balanceCard} style={isFallback ? { background: 'linear-gradient(135deg, #4b5563 0%, #6b7280 100%)' } : undefined}>
      <div className={styles.balanceHeader}>
        <h3 className={styles.balanceTitle}>
          {isFallback ? 'Cached Balance (Ledger Offline)' : 'Live Balance from Ledger'}
        </h3>
        <button className={styles.refreshBtn} onClick={fetchBalance}>
          ↻ Refresh
        </button>
      </div>
      
      {isFallback && (
        <div style={{ 
          background: 'rgba(255,255,255,0.1)', 
          padding: '0.5rem 0.75rem', 
          borderRadius: '6px', 
          marginBottom: '1rem',
          fontSize: '0.75rem' 
        }}>
          ⚠️ Ledger service unavailable. Showing balances from local projection.
        </div>
      )}
      
      <div className={styles.balanceGrid}>
        <div className={styles.balanceItem}>
          <div className={styles.balanceLabel}>Principal</div>
          <div className={styles.balanceValue}>
            {formatCurrency(balance?.principalBalance || '0')}
          </div>
        </div>
        <div className={styles.balanceItem}>
          <div className={styles.balanceLabel}>Fees</div>
          <div className={styles.balanceValue}>
            {formatCurrency(balance?.feeBalance || '0')}
          </div>
        </div>
        <div className={styles.balanceItem}>
          <div className={styles.balanceLabel}>Total Outstanding</div>
          <div className={styles.balanceValue}>
            {formatCurrency(balance?.totalOutstanding || '0')}
          </div>
        </div>
      </div>

      {balance?.asOf && !isFallback && (
        <div className={styles.balanceAsOf}>
          As of: {formatDate(balance.asOf)}
        </div>
      )}
    </div>
  )
}

