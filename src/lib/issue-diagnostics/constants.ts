/**
 * Constants for the in-app issue reporter's client-side diagnostics.
 *
 * SECURITY NOTES (governing contract for everything in this directory):
 * - The four ring buffers below persist to localStorage. They may only ever
 *   hold METADATA — element identity (tag/id/class/label), sanitized URL
 *   paths, HTTP methods/statuses, error messages and stacks.
 * - NEVER store input values, passwords, request/response bodies, headers,
 *   cookies, tokens, or customer PII (names, emails, phone numbers, account
 *   numbers). Same rationale as src/stores/recentCustomers.ts:26-36 — if XSS
 *   compromises localStorage, only low-value metadata is exposed.
 * - Anything inside a `[data-issue-no-track]` subtree is excluded from
 *   interaction tracking AND redacted out of screenshots.
 * - Data is CLEARED when a different user logs in (see UserSessionGuard).
 *
 * @see src/components/UserSessionGuard - clears these keys on user change
 */

/** localStorage key for the recent-interactions ring buffer */
export const ISSUE_INTERACTIONS_KEY = 'billie_issue_interactions'

/** localStorage key for the recent-routes ring buffer */
export const ISSUE_ROUTES_KEY = 'billie_issue_routes'

/** localStorage key for the recent-API-calls ring buffer */
export const ISSUE_API_CALLS_KEY = 'billie_issue_api_calls'

/** localStorage key for the recent-errors ring buffer */
export const ISSUE_ERRORS_KEY = 'billie_issue_errors'

/** Max entries retained per buffer (oldest dropped first) */
export const MAX_INTERACTIONS = 10
export const MAX_ROUTES = 10
export const MAX_API_CALLS = 15
export const MAX_ERRORS = 30

/** Entries older than this are dropped on read (24h) */
export const ISSUE_BUFFER_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Opt-out attribute. Elements carrying it (and their descendants) are never
 * described in interaction events and are filtered out of screenshots.
 */
export const NO_TRACK_ATTR = 'data-issue-no-track'

/** Window event dispatched by the fetch tracker when an /api/* call 5xxs */
export const ISSUE_5XX_EVENT = 'issue-reporter:5xx'

/** Query params whose VALUES are redacted by sanitizeUrl */
export const REDACTED_QUERY_PARAMS = [
  'token',
  'code',
  'secret',
  'key',
  'password',
  'email',
  'q',
  'search',
]
