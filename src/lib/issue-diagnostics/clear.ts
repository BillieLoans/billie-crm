import {
  ISSUE_API_CALLS_KEY,
  ISSUE_ERRORS_KEY,
  ISSUE_INTERACTIONS_KEY,
  ISSUE_ROUTES_KEY,
} from './constants'

/**
 * Drop every diagnostics buffer from localStorage.
 *
 * SECURITY: called on user change so User B never reports User A's browsing
 * trail (see UserSessionGuard), and after a successful report to keep the
 * stored window short.
 */
export function clearIssueDiagnostics(): void {
  if (typeof window === 'undefined') return

  for (const key of [
    ISSUE_INTERACTIONS_KEY,
    ISSUE_ROUTES_KEY,
    ISSUE_API_CALLS_KEY,
    ISSUE_ERRORS_KEY,
  ]) {
    try {
      localStorage.removeItem(key)
    } catch {
      // Ignore localStorage errors
    }
  }
}
