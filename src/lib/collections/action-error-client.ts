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
 *
 * FORBIDDEN/UNAUTHENTICATED (403/401, `requireAuth` in `src/lib/auth.ts`
 * rejecting the operator) -> INSUFFICIENT_PRIVILEGES — same non-system,
 * non-retryable treatment `AppError.isSystemError()`/`isRetryable()` already
 * give `VALIDATION_ERROR` (see `src/lib/utils/error.ts`). Before this fix
 * these fell through to the `default` UNKNOWN_ERROR branch, which
 * `isSystemError()` treats as a system error — so a 403 (e.g. a readonly
 * user hitting an action route directly) got queued into the failed-actions
 * retry store and shown a "Retry" toast that would only ever 403 again
 * (final-review Fix 3). HTTP status is also checked directly as a fallback
 * in case a future error path returns 401/403 with a different `code`.
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
    case 'FORBIDDEN':
    case 'UNAUTHENTICATED':
      return new AppError(ERROR_CODES.INSUFFICIENT_PRIVILEGES, message, { statusCode: res.status })
    default:
      // Defensive fallback: classify by HTTP status even if `code` is
      // missing/unexpected, so a 401/403 is never left to fall through to
      // UNKNOWN_ERROR (a system/retryable error) — see the file-header note.
      if (res.status === 401 || res.status === 403) {
        return new AppError(ERROR_CODES.INSUFFICIENT_PRIVILEGES, message, { statusCode: res.status })
      }
      return new AppError(ERROR_CODES.UNKNOWN_ERROR, message, { statusCode: res.status })
  }
}
