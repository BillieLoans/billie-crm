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
  /**
   * `collection_cases.state` is nullable in Postgres: the
   * hardship_paused/resumed/stop_contact_applied/step_advanced event
   * handlers legitimately upsert a row without `state` when they're the
   * first event seen for an account (out-of-order delivery, no prior
   * `opened`). `null` here means "case row exists, lifecycle state
   * unknown" — callers must not assume one of the three known states
   * (final-review Fix 1, BTB-200/196/197).
   */
  state: 'open' | 'awaiting_human' | 'cured' | null
  rung: number | null
  hardshipPaused: boolean
  stoppedContact: boolean
  overdueAmount: number | null
  daysOverdue: number | null
  lastStep: number | null
  openedAt: string | null
  /**
   * Lifecycle timestamps (BTB-197 WS4). These have lived on the
   * `collection-cases` projection since BTB-199
   * (`src/collections/CollectionsCases.ts`) but weren't previously
   * surfaced on the row — added here so the case-detail view can render a
   * lifecycle history. `null` until the corresponding `collection.case.*`
   * event has been projected.
   */
  curedAt: string | null
  exhaustedAt: string | null
  pausedAt: string | null
  resumedAt: string | null
  stopContactAt: string | null
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

/**
 * Result of a Collections operator action (flag-hardship, resume-hardship,
 * stop-contact, advance) — mirrors `CaseActionResponse` from the
 * server-only gRPC client (`src/server/collections-service-client.ts`),
 * redeclared here so client-side mutation hooks (BTB-198 WS5) don't pull
 * in that file's node-only (`@grpc/grpc-js`, `path`) imports.
 */
export interface CollectionsActionResult {
  accountId: string
  newState: string
  emittedEventId: string
}
