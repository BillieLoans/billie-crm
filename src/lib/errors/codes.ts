/**
 * Error codes for standardized error handling.
 * These codes map to user-friendly messages in ERROR_MESSAGES.
 */
export const ERROR_CODES = {
  // Authentication & Authorization
  INSUFFICIENT_PRIVILEGES: 'INSUFFICIENT_PRIVILEGES',
  SELF_APPROVAL_FORBIDDEN: 'SELF_APPROVAL_FORBIDDEN',

  // Data Integrity
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',

  // Ledger business-rule outcomes (deterministic — retrying changes nothing)
  LEDGER_REJECTED: 'LEDGER_REJECTED',
  DUPLICATE_OPERATION: 'DUPLICATE_OPERATION',

  // Service Availability
  LEDGER_UNAVAILABLE: 'LEDGER_UNAVAILABLE',
  /**
   * The gRPC client deadline elapsed before the ledger answered (gRPC code 4,
   * DEADLINE_EXCEEDED). Distinct from LEDGER_UNAVAILABLE because the outcome is
   * *unknown* — the call may have been applied. Retrying is safe only because
   * the money routes carry client idempotency keys, so a replay of the same key
   * cannot double-post.
   */
  LEDGER_TIMEOUT: 'LEDGER_TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',

  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',

  // Fallback
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const

export type ErrorCodeType = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/**
 * HTTP status codes typically associated with each error type.
 */
export const ERROR_STATUS_CODES: Record<ErrorCodeType, number> = {
  [ERROR_CODES.INSUFFICIENT_PRIVILEGES]: 403,
  [ERROR_CODES.SELF_APPROVAL_FORBIDDEN]: 403,
  [ERROR_CODES.VERSION_CONFLICT]: 409,
  [ERROR_CODES.ACCOUNT_NOT_FOUND]: 404,
  [ERROR_CODES.LEDGER_REJECTED]: 422,
  [ERROR_CODES.DUPLICATE_OPERATION]: 409,
  [ERROR_CODES.LEDGER_UNAVAILABLE]: 503,
  // 503 rather than 504: the client classifies by error code, not status, and
  // 503 is the status the codebase already uses for "ledger not answering".
  [ERROR_CODES.LEDGER_TIMEOUT]: 503,
  [ERROR_CODES.NETWORK_ERROR]: 0, // Network errors don't have HTTP status
  [ERROR_CODES.NETWORK_TIMEOUT]: 408,
  [ERROR_CODES.VALIDATION_ERROR]: 400,
  [ERROR_CODES.UNKNOWN_ERROR]: 500,
}

/**
 * Determines if an error code represents a system error (retryable).
 * System errors are transient issues not caused by user input.
 */
export function isSystemErrorCode(code: string): boolean {
  const systemErrorCodes: ErrorCodeType[] = [
    ERROR_CODES.LEDGER_UNAVAILABLE,
    ERROR_CODES.LEDGER_TIMEOUT,
    ERROR_CODES.NETWORK_ERROR,
    ERROR_CODES.NETWORK_TIMEOUT,
    ERROR_CODES.UNKNOWN_ERROR,
  ]
  return systemErrorCodes.includes(code as ErrorCodeType)
}

/**
 * Determines if an error code represents a validation error.
 * Validation errors require user action to fix.
 */
export function isValidationErrorCode(code: string): boolean {
  return code === ERROR_CODES.VALIDATION_ERROR
}

/**
 * Determines if an error code should show a retry button.
 */
export function isRetryableErrorCode(code: string): boolean {
  const retryableErrorCodes: ErrorCodeType[] = [
    ERROR_CODES.LEDGER_UNAVAILABLE,
    ERROR_CODES.LEDGER_TIMEOUT,
    ERROR_CODES.NETWORK_ERROR,
    ERROR_CODES.NETWORK_TIMEOUT,
  ]
  return retryableErrorCodes.includes(code as ErrorCodeType)
}
