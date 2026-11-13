'use client'

import React from 'react'
import Link from 'next/link'
import type { CustomerData } from '@/hooks/queries/useCustomer'
import { CopyButton } from '@/components/ui/CopyButton'
import styles from './styles.module.css'

export interface CaseCustomerCardProps {
  customerId: string
  /** Name off the loan account, shown while the customer record loads or if it can't. */
  fallbackName: string | null
  customer: CustomerData | undefined
  isLoading: boolean
  isError: boolean
  /** Link into the customer view, with this account selected. */
  customerHref: string
}

function formatAddress(address: CustomerData['residentialAddress']): string {
  if (!address) return '—'
  if (address.fullAddress) return address.fullAddress
  const parts: string[] = []
  if (address.street) parts.push(address.street)
  if (address.suburb) parts.push(address.suburb)
  const statePostcode = [address.state, address.postcode].filter(Boolean).join(' ')
  if (statePostcode) parts.push(statePostcode)
  return parts.length > 0 ? parts.join(', ') : '—'
}

/**
 * Who the collections case is about: name, customer ID (linked to the
 * customer view) and how to reach them.
 */
export function CaseCustomerCard({
  customerId,
  fallbackName,
  customer,
  isLoading,
  isError,
  customerHref,
}: CaseCustomerCardProps) {
  const name = customer?.fullName || fallbackName || 'Unknown customer'
  const preferred =
    customer?.preferredName && customer.preferredName !== customer.firstName
      ? customer.preferredName
      : null

  const placeholder = isLoading ? 'Loading…' : isError ? 'Unavailable' : '—'

  return (
    <section className={styles.customerCard} aria-label="Customer" data-testid="case-customer-card">
      <div className={styles.customerIdentity}>
        <span className={styles.customerName}>
          {name}
          {preferred && <span className={styles.customerPreferred}> ({preferred})</span>}
        </span>
        <span className={styles.customerIdRow}>
          <Link
            href={customerHref}
            className={styles.customerIdLink}
            data-testid="case-customer-link"
          >
            {customerId}
          </Link>
          <CopyButton value={customerId} label="Copy customer ID" />
        </span>
        {customer?.vulnerableFlag && <span className={styles.flagChip}>Vulnerable</span>}
      </div>

      <dl className={styles.customerContact}>
        <div>
          <dt>Mobile</dt>
          <dd data-testid="case-customer-mobile">
            {customer?.mobilePhoneNumber ? (
              <a href={`tel:${customer.mobilePhoneNumber}`}>{customer.mobilePhoneNumber}</a>
            ) : (
              placeholder
            )}
          </dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd data-testid="case-customer-email">
            {customer?.emailAddress ? (
              <a href={`mailto:${customer.emailAddress}`}>{customer.emailAddress}</a>
            ) : (
              placeholder
            )}
          </dd>
        </div>
        <div className={styles.customerAddress}>
          <dt>Address</dt>
          <dd data-testid="case-customer-address">
            {customer ? formatAddress(customer.residentialAddress) : placeholder}
          </dd>
        </div>
      </dl>
    </section>
  )
}
