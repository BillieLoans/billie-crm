'use client'

import React, { useState } from 'react'
import { useCustomerSearch } from '@/hooks/queries/useCustomerSearch'
import type { CustomerSearchResult } from '@/hooks/queries/useCustomerSearch'
import { useLinkContact } from '@/hooks/mutations/useMarketingCommands'
import { useEscapeClose } from '@/hooks/useModalA11y'
import styles from './styles.module.css'

interface LinkCustomerModalProps {
  contactId: string
  contactName: string
  onClose: () => void
}

/**
 * Search-and-select picker for manually linking a contact to a customer.
 * Reuses the staff customer search (name / email / mobile / customer ID,
 * min 3 chars). The selected customerId goes to LinkContact
 * (match_basis="manual"); the matcher keeps handling automatic links.
 */
export const LinkCustomerModal: React.FC<LinkCustomerModalProps> = ({
  contactId,
  contactName,
  onClose,
}) => {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<CustomerSearchResult | null>(null)

  const { data, isFetching } = useCustomerSearch(query)
  const link = useLinkContact()
  const results = data?.results ?? []
  const canSubmit = !!selected && !link.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || !selected) return
    link.mutate({ contactId, customerId: selected.customerId }, { onSuccess: () => onClose() })
  }

  useEscapeClose(onClose)

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>Link {contactName} to a customer</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            {link.isError && (
              <div className={styles.errorMessage}>
                {link.error instanceof Error ? link.error.message : 'Failed to link contact'}
              </div>
            )}

            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="link-customer-search">
                Search customers
              </label>
              <input
                id="link-customer-search"
                type="text"
                className={styles.formInput}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSelected(null)
                }}
                placeholder="Name, email, mobile, or customer ID"
                autoFocus
              />
              <p className={styles.formHint}>
                {query.trim().length < 3
                  ? 'Type at least 3 characters to search.'
                  : isFetching
                    ? 'Searching…'
                    : `${results.length} match(es).`}
              </p>
            </div>

            <div className={styles.searchResults} role="listbox" aria-label="Customer results">
              {results.length === 0 ? (
                <div className={styles.panelEmpty}>
                  {query.trim().length < 3 ? '—' : 'No customers match.'}
                </div>
              ) : (
                results.map((c) => (
                  <button
                    key={c.customerId}
                    type="button"
                    role="option"
                    aria-selected={selected?.customerId === c.customerId}
                    className={`${styles.searchResult} ${
                      selected?.customerId === c.customerId ? styles.searchResultSelected : ''
                    }`}
                    onClick={() => setSelected(c)}
                  >
                    <span className={styles.panelRowPrimary}>{c.fullName ?? '—'}</span>
                    <span className={styles.panelRowMeta}>
                      {c.customerId}
                      {c.emailAddress ? ` · ${c.emailAddress}` : ''}
                      {c.identityVerified ? ' · ✓ ID verified' : ''}
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className={styles.panelRow}>
              <span className={styles.panelRowLabel}>Selected</span>
              <span className={styles.panelRowValue}>
                {selected ? `${selected.fullName ?? '—'} (${selected.customerId})` : '—'}
              </span>
            </div>
          </div>

          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnCancel} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.btnSubmit} disabled={!canSubmit}>
              {link.isPending ? 'Linking…' : 'Link customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default LinkCustomerModal
