/**
 * Client-side diagnostics for the in-app issue reporter.
 *
 * See constants.ts for the governing privacy/security contract — everything
 * exported here records METADATA ONLY and is cleared on user change.
 */

export {
  ISSUE_5XX_EVENT,
  ISSUE_API_CALLS_KEY,
  ISSUE_BUFFER_TTL_MS,
  ISSUE_ERRORS_KEY,
  ISSUE_INTERACTIONS_KEY,
  ISSUE_ROUTES_KEY,
  MAX_API_CALLS,
  MAX_ERRORS,
  MAX_INTERACTIONS,
  MAX_ROUTES,
  NO_TRACK_ATTR,
  REDACTED_QUERY_PARAMS,
} from './constants'

export { createRingBuffer } from './ring-buffer'
export type { RingBuffer } from './ring-buffer'

export { describeElement, sanitizeUrl } from './sanitize'

export { installInteractionTracker } from './interaction-tracker'
export { installFetchTracker } from './fetch-tracker'
export { installErrorTracker } from './error-tracker'

export { recordRoute } from './route-tracker'
export { captureScreenshot } from './screenshot'
export { collectDiagnostics, installIssueTrackers } from './collect'
export { clearIssueDiagnostics } from './clear'
