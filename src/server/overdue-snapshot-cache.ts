/**
 * Overdue Snapshot Cache
 *
 * In-process, short-TTL memoisation of the ledger's `GetOverdueAccounts` gRPC
 * query, shared by every route that needs aging data:
 *   - GET /api/ledger/aging/overdue      (paged, user-supplied filters)
 *   - GET /api/collections/cases         (full snapshot, used as a lookup map)
 *
 * Both endpoints are polled every ~30s by each open dashboard/collections tab,
 * so without a cache the ledger gets one full snapshot fetch per viewer per
 * poll. The cache collapses those into (at most) one upstream fetch per TTL
 * window, and coalesces concurrent callers onto a single in-flight promise.
 *
 * Semantics:
 * - Entries are keyed by the full request shape (filters + page).
 * - A rejected fetch is NEVER cached — the in-flight entry is dropped so the
 *   next caller retries immediately.
 * - Module-level state, same as the other singletons in `src/server/`. A dev
 *   hot-reload simply starts with an empty cache, which is safe.
 *
 * Pagination: `GetOverdueAccountsRequest` carries `page_token` and the response
 * carries `next_page_token` (proto/accounting_ledger.proto), with a documented
 * server max page size of 1000. `getFullOverdueSnapshot()` follows those tokens
 * so the snapshot is complete rather than silently cut off at the first 1000
 * rows. A page budget guards against a server that never stops handing back
 * tokens; hitting it sets `truncated`.
 */

import { getLedgerClient } from '@/server/grpc-client'
import type { GetOverdueAccountsRequest, OverdueAccount } from '@/server/grpc-client'

// =============================================================================
// Configuration
// =============================================================================

/** Server-documented maximum page size for GetOverdueAccounts. */
export const OVERDUE_PAGE_SIZE_MAX = 1000

const DEFAULT_TTL_MS = 20_000
const DEFAULT_MAX_PAGES = 20

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

/**
 * Cache lifetime in ms. Override with `OVERDUE_SNAPSHOT_CACHE_TTL_MS`.
 * Read lazily so tests (and env reloads) can change it between calls.
 */
export function getSnapshotTtlMs(): number {
  return readPositiveInt(process.env.OVERDUE_SNAPSHOT_CACHE_TTL_MS, DEFAULT_TTL_MS)
}

/**
 * Maximum pages followed when assembling a full snapshot.
 * Override with `OVERDUE_SNAPSHOT_MAX_PAGES`.
 */
function getMaxPages(): number {
  return readPositiveInt(process.env.OVERDUE_SNAPSHOT_MAX_PAGES, DEFAULT_MAX_PAGES)
}

// =============================================================================
// Types
// =============================================================================

/** A single page of overdue accounts, as returned by the ledger. */
export interface OverdueSnapshotPage {
  accounts: OverdueAccount[]
  totalCount: number
  nextPageToken?: string
}

/** Every overdue account matching the filters, assembled across pages. */
export interface FullOverdueSnapshot {
  accounts: OverdueAccount[]
  /** Total matching count reported by the ledger (before pagination). */
  totalCount: number
  /**
   * True when the ledger still had a next page after the page budget was
   * exhausted — enrichment misses beyond this point are expected.
   */
  truncated: boolean
}

/** Filters accepted for a full snapshot (page params are managed internally). */
export type OverdueSnapshotFilters = Omit<GetOverdueAccountsRequest, 'pageSize' | 'pageToken'> & {
  pageSize?: number
}

interface CacheEntry<T> {
  /** Resolved value, present once the promise settles successfully. */
  value?: T
  /** In-flight promise; concurrent callers await this instead of re-fetching. */
  promise?: Promise<T>
  /** Epoch ms at which `value` stops being served. */
  expiresAt: number
}

// =============================================================================
// Cache state
// =============================================================================

const cache = new Map<string, CacheEntry<unknown>>()

function cacheKey(prefix: string, request: Record<string, unknown>): string {
  const normalised: Record<string, unknown> = {}
  for (const key of Object.keys(request).sort()) {
    const value = request[key]
    if (value !== undefined) normalised[key] = value
  }
  return `${prefix}:${JSON.stringify(normalised)}`
}

/**
 * Core memoiser: serve a live value, join an in-flight fetch, or start one.
 * Rejections are not cached.
 */
function memoise<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const existing = cache.get(key) as CacheEntry<T> | undefined

  if (existing) {
    if (existing.promise) return existing.promise
    if (existing.value !== undefined && existing.expiresAt > now) {
      return Promise.resolve(existing.value)
    }
  }

  const entry: CacheEntry<T> = { expiresAt: 0 }
  const promise = fetcher().then(
    (value) => {
      entry.value = value
      entry.promise = undefined
      entry.expiresAt = Date.now() + getSnapshotTtlMs()
      return value
    },
    (error) => {
      // Never cache a failure — drop the entry so the next caller retries.
      cache.delete(key)
      throw error
    },
  )

  entry.promise = promise
  cache.set(key, entry as CacheEntry<unknown>)
  return promise
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Fetch one page of overdue accounts, memoised for the cache TTL.
 * Mirrors `getLedgerClient().getOverdueAccounts()` semantics and errors.
 */
export async function getOverdueSnapshotPage(
  request: GetOverdueAccountsRequest,
): Promise<OverdueSnapshotPage> {
  const normalised: GetOverdueAccountsRequest = {
    ...request,
    pageSize: Math.min(request.pageSize, OVERDUE_PAGE_SIZE_MAX),
  }

  return memoise(cacheKey('page', normalised as unknown as Record<string, unknown>), async () => {
    const response = await getLedgerClient().getOverdueAccounts(normalised)
    return {
      accounts: response.accounts ?? [],
      totalCount: response.totalCount ?? (response.accounts ?? []).length,
      nextPageToken: response.nextPageToken || undefined,
    }
  })
}

/**
 * Fetch every overdue account matching `filters`, following `nextPageToken`
 * until the ledger stops handing one back (or the page budget is spent).
 * Memoised for the cache TTL and coalesced across concurrent callers.
 */
export async function getFullOverdueSnapshot(
  filters: OverdueSnapshotFilters = {},
): Promise<FullOverdueSnapshot> {
  const pageSize = Math.min(filters.pageSize ?? OVERDUE_PAGE_SIZE_MAX, OVERDUE_PAGE_SIZE_MAX)
  const key = cacheKey('full', { ...filters, pageSize } as unknown as Record<string, unknown>)

  return memoise(key, async () => {
    const client = getLedgerClient()
    const maxPages = getMaxPages()
    const accounts: OverdueAccount[] = []
    let totalCount = 0
    let pageToken: string | undefined
    let truncated = false

    for (let page = 0; page < maxPages; page++) {
      const response = await client.getOverdueAccounts({
        ...filters,
        pageSize,
        pageToken,
      })

      const pageAccounts = response.accounts ?? []
      accounts.push(...pageAccounts)
      totalCount = response.totalCount ?? accounts.length

      pageToken = response.nextPageToken || undefined
      if (!pageToken) break
      // Defensive: a server that returns a token with an empty page would loop.
      if (pageAccounts.length === 0) break

      if (page === maxPages - 1) truncated = true
    }

    if (truncated) {
      console.warn(
        `[OverdueSnapshot] Snapshot truncated after ${maxPages} pages ` +
          `(${accounts.length} accounts, ledger reports totalCount=${totalCount}). ` +
          'Aging enrichment will be missing for accounts beyond this point. ' +
          'Raise OVERDUE_SNAPSHOT_MAX_PAGES if this is expected.',
      )
    }

    return { accounts, totalCount, truncated }
  })
}

/**
 * Clear all cached snapshots. Intended for tests; also handy if a caller knows
 * the upstream data just changed.
 */
export function resetOverdueSnapshotCache(): void {
  cache.clear()
}
