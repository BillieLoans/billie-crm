/**
 * Shared types for search APIs and hooks.
 * Single source of truth to prevent type drift.
 */

// === Customer Search ===

export interface CustomerSearchResult {
  id: string
  customerId: string
  fullName: string | null
  emailAddress: string | null
  identityVerified: boolean
  accountCount: number
  /**
   * BTB-392: set when the search matched a former record (an alias an identity
   * link folded into `customerId`); the name/email shown are that record's.
   */
  matchedFormerRecord?: string | null
}

export interface CustomerSearchResponse {
  results: CustomerSearchResult[]
  total: number
}

// Legacy alias for backwards compatibility
export type SearchResponse = CustomerSearchResponse

// === Loan Account Search ===

export interface LoanAccountSearchResult {
  id: string
  loanAccountId: string
  accountNumber: string
  customerName: string | null
  customerIdString: string | null
  accountStatus: 'active' | 'paid_off' | 'in_arrears' | 'written_off'
  totalOutstanding: number
}

export interface LoanAccountSearchResponse {
  results: LoanAccountSearchResult[]
  total: number
}
