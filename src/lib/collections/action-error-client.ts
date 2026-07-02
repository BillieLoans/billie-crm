/**
 * Client-side error parser for the Collections operator action routes
 * (BTB-198 WS5: `POST /api/collections/actions/{flag-hardship,
 * resume-hardship,stop-contact,advance}`).
 *
 * These routes use a `{ error: { code, message, details? } }` envelope
 * (see `src/lib/collections/action-error.ts`, the server-side gRPC → HTTP
 * mapper that produces it) rather than the flat `{ error: string, message,
 * errorId, ... }` shape `parseApiError` (`src/lib/utils/error.ts`) expects.
 * This mirrors that mapper on the client so the WS5 mutation hooks
 * (useFlagHardship, useResumeHardship, useApplyStopContact,
 * useAdvanceToNextStep) share one parse path instead of re-parsing the
 * envelope four times.
 *
 * NOT_FOUND -> ACCOUNT_NOT_FOUND, INTERNAL_ERROR (502, upstream gRPC
 * unreachable) -> LEDGER_UNAVAILABLE (system error, retryable),
 * FAILED_PRECONDITION (409, state/economic gate) and CONTACT_CAP (429) ->
 * VALIDATION_ERROR (business-rule rejection — not a system error, not
 * auto-retried). Callers that need to show the 409 gate/state reason
 * verbatim should branch on `appError.statusCode === 409` rather than the
 * mapped code, since the message itself already carries the reason.
 */

import { AppError } from '@/lib/utils/error'
import { ERROR_CODES } from '@/lib/errors/codes'

interface CollectionsErrorBody {
  error?: {
    code?: string
    message?: unknown
    details?: unknown
  }
}

export async function parseCollectionsActionError(
  res: Response,
  fallbackMessage: string,
): Promise<AppError> {
  const body: CollectionsErrorBody | null = await res.json().catch(() => null)
  const code = body?.error?.code
  const rawMessage = body?.error?.message
  const message =
    typeof rawMessage === 'string' && rawMessage.length > 0 ? rawMessage : fallbackMessage

  switch (code) {
    case 'NOT_FOUND':
      return new AppError(ERROR_CODES.ACCOUNT_NOT_FOUND, message, { statusCode: res.status })
    case 'INTERNAL_ERROR':
      return new AppError(ERROR_CODES.LEDGER_UNAVAILABLE, message, { statusCode: res.status })
    case 'FAILED_PRECONDITION':
    case 'CONTACT_CAP':
      return new AppError(ERROR_CODES.VALIDATION_ERROR, message, { statusCode: res.status })
    default:
      return new AppError(ERROR_CODES.UNKNOWN_ERROR, message, { statusCode: res.status })
  }
}
