import { routesBuffer } from './buffers'
import { sanitizeUrl } from './sanitize'

/**
 * Record a client-side navigation. Both ends are sanitized so query-string
 * secrets (and search terms) never reach localStorage.
 */
export function recordRoute(from: string | null, to: string): void {
  try {
    routesBuffer.push({
      at: new Date().toISOString(),
      from: from ? sanitizeUrl(from) : null,
      to: sanitizeUrl(to).slice(0, 200),
    })
  } catch {
    // Tracking must never interfere with navigation
  }
}
