import { apiCallsBuffer, errorsBuffer } from './buffers'
import { ISSUE_5XX_EVENT } from './constants'
import { sanitizeUrl } from './sanitize'

/** Marker on the patched fetch so we never double-wrap (HMR, remounts) */
const PATCHED = Symbol.for('billie.issueFetchTracker')

type PatchedFetch = typeof fetch & { [PATCHED]?: true }

/** Resolve the request URL from any of fetch's input shapes. */
function resolveUrl(input: RequestInfo | URL): string | null {
  try {
    if (typeof input === 'string') return new URL(input, window.location.href).href
    if (input instanceof URL) return input.href
    if (input instanceof Request) return new URL(input.url, window.location.href).href
    return null
  } catch {
    return null
  }
}

function resolveMethod(input: RequestInfo | URL, init?: RequestInit): string {
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
  return String(method || 'GET')
    .toUpperCase()
    .slice(0, 10)
}

/**
 * Wrap `window.fetch` to record same-origin `/api/*` call metadata.
 *
 * PRIVACY: method, sanitized path, status and duration only — never request
 * or response bodies, never headers.
 *
 * The patch is transparent: the original response is returned and the
 * original error rethrown, untouched, so callers cannot observe it.
 * Idempotent.
 */
export function installFetchTracker(): void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return

  const original = window.fetch as PatchedFetch
  if (original[PATCHED]) return

  const patched: PatchedFetch = async function trackedFetch(input, init) {
    let path: string | null = null

    try {
      const href = resolveUrl(input)
      if (href) {
        const url = new URL(href)
        // Same-origin /api/* only — third-party calls are never logged
        if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
          path = sanitizeUrl(`${url.pathname}${url.search}`).slice(0, 200)
        }
      }
    } catch {
      path = null
    }

    if (!path) return original(input, init)

    const method = resolveMethod(input, init)
    const startedAt = Date.now()

    try {
      const response = await original(input, init)

      try {
        apiCallsBuffer.push({
          at: new Date(startedAt).toISOString(),
          method,
          path,
          status: response.status,
          ok: response.ok,
          durationMs: Date.now() - startedAt,
          error: null,
        })

        if (response.status >= 500) {
          window.dispatchEvent(
            new CustomEvent(ISSUE_5XX_EVENT, { detail: { path, status: response.status } }),
          )
        }
      } catch {
        // Logging failure must not affect the caller
      }

      return response
    } catch (err) {
      try {
        const name = (err as Error | undefined)?.name ?? 'FetchError'

        apiCallsBuffer.push({
          at: new Date(startedAt).toISOString(),
          method,
          path,
          status: null,
          ok: false,
          durationMs: Date.now() - startedAt,
          error: String(name).slice(0, 200),
        })

        errorsBuffer.push({
          at: new Date().toISOString(),
          source: 'fetch-failed',
          message: `${method} ${path} failed: ${(err as Error | undefined)?.message ?? name}`.slice(
            0,
            500,
          ),
          stack: (err as Error | undefined)?.stack?.slice(0, 2000) ?? null,
        })
      } catch {
        // Logging failure must not affect the caller
      }

      throw err
    }
  } as PatchedFetch

  patched[PATCHED] = true
  window.fetch = patched
}
