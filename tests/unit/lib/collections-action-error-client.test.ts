/**
 * Unit tests for `parseCollectionsActionError` (BTB-198 WS5 client-side
 * error mapper for the Collections operator action routes).
 *
 * Final-review Fix 3: FORBIDDEN/UNAUTHENTICATED (403/401 — `requireAuth` in
 * `src/lib/auth.ts` rejecting the operator) must map to a NON-system,
 * non-retryable `AppError` (INSUFFICIENT_PRIVILEGES), not the default
 * UNKNOWN_ERROR branch (a system/retryable error). Previously a 403 got
 * queued into the failed-actions retry store and shown a useless "Retry"
 * toast that would only ever 403 again.
 */

import { describe, it, expect } from 'vitest'
import { parseCollectionsActionError } from '@/lib/collections/action-error-client'
import { ERROR_CODES } from '@/lib/errors/codes'

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

describe('parseCollectionsActionError', () => {
  it('maps a 403 FORBIDDEN body to INSUFFICIENT_PRIVILEGES, a non-system, non-retryable error', async () => {
    const res = jsonResponse(403, {
      error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' },
    })

    const appError = await parseCollectionsActionError(res, 'fallback')

    expect(appError.code).toBe(ERROR_CODES.INSUFFICIENT_PRIVILEGES)
    expect(appError.message).toBe('You do not have permission to perform this action.')
    expect(appError.statusCode).toBe(403)
    expect(appError.isSystemError()).toBe(false)
    expect(appError.isRetryable()).toBe(false)
  })

  it('maps a 401 UNAUTHENTICATED body to INSUFFICIENT_PRIVILEGES, a non-system, non-retryable error', async () => {
    const res = jsonResponse(401, {
      error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue.' },
    })

    const appError = await parseCollectionsActionError(res, 'fallback')

    expect(appError.code).toBe(ERROR_CODES.INSUFFICIENT_PRIVILEGES)
    expect(appError.isSystemError()).toBe(false)
    expect(appError.isRetryable()).toBe(false)
  })

  it('falls back to HTTP status classification when a 403 body carries an unexpected code', async () => {
    const res = jsonResponse(403, { error: { code: 'SOME_OTHER_CODE', message: 'nope' } })

    const appError = await parseCollectionsActionError(res, 'fallback')

    expect(appError.code).toBe(ERROR_CODES.INSUFFICIENT_PRIVILEGES)
    expect(appError.isSystemError()).toBe(false)
  })

  it('still maps INTERNAL_ERROR (502) to LEDGER_UNAVAILABLE, a system/retryable error', async () => {
    const res = jsonResponse(502, { error: { code: 'INTERNAL_ERROR', message: 'upstream unreachable' } })

    const appError = await parseCollectionsActionError(res, 'fallback')

    expect(appError.code).toBe(ERROR_CODES.LEDGER_UNAVAILABLE)
    expect(appError.isSystemError()).toBe(true)
    expect(appError.isRetryable()).toBe(true)
  })

  it('still maps FAILED_PRECONDITION (409) to VALIDATION_ERROR', async () => {
    const res = jsonResponse(409, { error: { code: 'FAILED_PRECONDITION', message: 'case already cured' } })

    const appError = await parseCollectionsActionError(res, 'fallback')

    expect(appError.code).toBe(ERROR_CODES.VALIDATION_ERROR)
    expect(appError.isSystemError()).toBe(false)
  })

  it('uses the fallback message when the response body has no message', async () => {
    const res = jsonResponse(403, { error: { code: 'FORBIDDEN' } })

    const appError = await parseCollectionsActionError(res, 'Cannot perform action')

    expect(appError.message).toBe('Cannot perform action')
  })
})
