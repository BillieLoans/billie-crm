/**
 * Shared types for the Collections read APIs and hooks (BTB-200 WS2).
 * Single source of truth to prevent type drift between the API routes
 * (`src/app/api/collections/cases/**`) and the WS2 read hooks that consume
 * them.
 */

export interface CollectionsCaseAging {
  dpd: number
  bucket: string
  totalOverdue: string
}

export interface CollectionsCaseRow {
  accountId: string
  customerId: string | null
  customerName: string | null
  accountNumber: string | null
  state: 'open' | 'awaiting_human' | 'cured'
  rung: number | null
  hardshipPaused: boolean
  stoppedContact: boolean
  overdueAmount: number | null
  daysOverdue: number | null
  lastStep: number | null
  openedAt: string | null
  updatedAt: string
  aging: CollectionsCaseAging | null
}

export interface CollectionsCasesListResponse {
  cases: CollectionsCaseRow[]
  totalDocs: number
  page: number
  totalPages: number
  hasNextPage: boolean
  agingUnavailable: boolean
}

export interface CollectionsCaseDetailResponse {
  case: CollectionsCaseRow
}
