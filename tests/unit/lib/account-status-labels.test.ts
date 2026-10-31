/**
 * Every account-status label map knows `cancelled` (BTB-517), so a loan
 * cancelled before disbursement is never shown as "Active" by a fallback.
 */
import { describe, it, expect } from 'vitest'
import { ACCOUNT_STATUS_CONFIG, getStatusConfig } from '@/components/ServicingView/account-status'
import { getAccountStatusLabel } from '@/components/ServicingView/ContactNotes/labels'

describe('cancelled account status labels (BTB-517)', () => {
  it('servicing status config: Cancelled, in its own neutral class', () => {
    expect(ACCOUNT_STATUS_CONFIG.cancelled).toEqual({
      label: 'Cancelled',
      colorClass: 'statusCancelled',
    })
    expect(getStatusConfig('cancelled').label).toBe('Cancelled')
  })

  it('contact notes label', () => {
    expect(getAccountStatusLabel('cancelled')).toBe('Cancelled')
    expect(getAccountStatusLabel('pending_disbursement')).toBe('Pending Disbursement')
  })
})
