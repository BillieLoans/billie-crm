'use client'

import { useState } from 'react'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'
import { CommunicationsPanel } from './Communications/CommunicationsPanel'
import { ApplicationsPanel } from './ApplicationsPanel'
import styles from './ContextPane.module.css'

export interface ContextPaneProps {
  customerDocId: string
  customerBusinessId: string
  customerName?: string
  selectedAccountId: string | null
  accounts: LoanAccountData[]
  onNavigateToAccount: (accountId: string) => void
}

type ContextTab = 'communications' | 'applications'

export const ContextPane: React.FC<ContextPaneProps> = (props) => {
  const [tab, setTab] = useState<ContextTab>('communications')

  return (
    <div className={styles.pane} data-testid="context-pane">
      <div className={styles.tabs} role="tablist" aria-label="Customer context">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'communications'}
          className={`${styles.tab} ${tab === 'communications' ? styles.tabActive : ''}`}
          onClick={() => setTab('communications')}
        >
          Communications
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'applications'}
          className={`${styles.tab} ${tab === 'applications' ? styles.tabActive : ''}`}
          onClick={() => setTab('applications')}
        >
          Applications
        </button>
      </div>
      <div className={styles.body} role="tabpanel">
        {tab === 'communications' ? (
          <CommunicationsPanel
            customerDocId={props.customerDocId}
            customerBusinessId={props.customerBusinessId}
            customerName={props.customerName}
            selectedAccountId={props.selectedAccountId}
            accounts={props.accounts}
            onNavigateToAccount={props.onNavigateToAccount}
          />
        ) : (
          <ApplicationsPanel customerIdString={props.customerBusinessId} />
        )}
      </div>
    </div>
  )
}
