/**
 * Shared account status configuration.
 * Used by LoanAccountCard and LoanAccountDetails.
 */

export type AccountStatus = 'pending_disbursement' | 'active' | 'paid_off' | 'in_arrears' | 'written_off'

export interface StatusConfig {
  label: string
  colorClass: string
}

/**
 * Account status display labels and color classes.
 * Color classes should be combined with size-specific base classes
 * (e.g., `accountStatus` or `detailsStatus`).
 */
export const ACCOUNT_STATUS_CONFIG: Record<AccountStatus, StatusConfig> = {
  pending_disbursement: { label: 'Pending Disbursement', colorClass: 'statusPendingDisbursement' },
  active: { label: 'Active', colorClass: 'statusActive' },
  paid_off: { label: 'Paid Off', colorClass: 'statusPaidOff' },
  in_arrears: { label: 'In Arrears', colorClass: 'statusArrears' },
  written_off: { label: 'Written Off', colorClass: 'statusWrittenOff' },
}

/**
 * Get status config with fallback to active.
 */
export function getStatusConfig(status: string): StatusConfig {
  return ACCOUNT_STATUS_CONFIG[status as AccountStatus] || ACCOUNT_STATUS_CONFIG.active
}
