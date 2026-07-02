/**
 * Shared gRPC error → HTTP response mapper for the Collections operator
 * action routes (BTB-198 WS5).
 *
 * `flag-hardship`, `resume-hardship`, `stop-contact`, and `advance` each
 * catch errors from the headless collections engine's gRPC client and map
 * them to an identical HTTP envelope. This was previously copy-pasted
 * verbatim across all four routes; extracted here so the mapping only
 * lives in one place (C6 review).
 */

import { NextResponse } from 'next/server'
import {
  isFailedPrecondition,
  isNotFound,
  isResourceExhausted,
} from '@/server/collections-service-client'

/**
 * Map a gRPC error from a collections operator action to its HTTP response.
 *
 * NOT_FOUND → 404, FAILED_PRECONDITION → 409 (gate/state reason surfaced
 * via `err.details`), RESOURCE_EXHAUSTED → 429 (contact cap), anything
 * else → 502.
 */
export function mapCollectionsActionError(err: unknown): NextResponse {
  if (isNotFound(err))
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'unknown account' } }, { status: 404 })
  if (isFailedPrecondition(err))
    return NextResponse.json(
      { error: { code: 'FAILED_PRECONDITION', message: (err as any)?.details ?? 'precondition failed' } },
      { status: 409 },
    )
  if (isResourceExhausted(err))
    return NextResponse.json(
      { error: { code: 'CONTACT_CAP', message: (err as any)?.details ?? 'contact cap reached' } },
      { status: 429 },
    )
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'collections service error' } },
    { status: 502 },
  )
}
