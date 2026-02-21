'use client'

import React from 'react'
import { type LoanAccountData } from '@/hooks/queries/useCustomer'
import { getAccountStatusLabel } from './labels'
import styles from './styles.module.css'

export interface ContactNoteFiltersProps {
  topicFilter: string | null
  accountFilter: string | null
  accounts: LoanAccountData[]
  onTopicChange: (topic: string | null) => void
  onAccountChange: (accountId: string | null) => void
}

const NOTE_TOPIC_LABELS: Record<string, string> = {
  general_enquiry: 'General Enquiry',
  complaint: 'Complaint',
  escalation: 'Escalation',
  internal_note: 'Internal Note',
  account_update: 'Account Update',
  collections: 'Collections Activity',
}

export const ContactNoteFilters: React.FC<ContactNoteFiltersProps> = ({
  topicFilter,
  accountFilter,
  accounts,
  onTopicChange,
  onAccountChange,
}) => {
  return (
    <div className={styles.filtersGroup}>
      <select
        className={styles.filterSelect}
        data-testid="note-topic-filter"
        value={topicFilter ?? ''}
        onChange={(e) => onTopicChange(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">All Topics</option>
        {Object.entries(NOTE_TOPIC_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {accounts.length >= 2 && (
        <select
          className={styles.filterSelect}
          data-testid="account-filter"
          value={accountFilter ?? ''}
          onChange={(e) => onAccountChange(e.target.value === '' ? null : e.target.value)}
        >
          <option value="">All Accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.accountNumber} ({getAccountStatusLabel(a.accountStatus)})
            </option>
          ))}
          <option value="none">General (no account)</option>
        </select>
      )}
    </div>
  )
}
