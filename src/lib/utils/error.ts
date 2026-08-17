import { nanoid } from 'nanoid'
import { ERROR_MESSAGES, type ErrorCode } from '@/lib/errors/messages'
import { ERROR_CODES, type ErrorCodeType } from '@/lib/errors/codes'
import { ERROR_ID_PREFIX } from '@/lib/constants'

/**
 * Structured error class for consistent error handling across the application.
 * Extends Error with additional metadata for debugging and user feedback.
 */
export class AppError extends Error {
  /** Error code from ERROR_CODES */
  readonly code: ErrorCodeType
  /** Unique error ID for support reference (e.g., "ERR-abc12345") */
  readonly errorId: string
  /** ISO timestamp when the error occurred */
  readonly timestamp: string
  /** Additional details for debugging (not shown to users) */
  readonly details?: Record<string, unknown>
  /** HTTP status code if from an API response */
  readonly statusCode?: number

  constructor(
    code: ErrorCodeType,
    message?: string,
    options?: {
      details?: Record<string, unknown>
      statusCode?: number
      errorId?: string
    }
  ) {
    // Use provided message or fallback to ERROR_MESSAGES
    const userMessage = message || getErrorMessage(code)
    super(userMessage)

    this.name = 'AppError'
    this.code = code
    this.errorId = options?.errorId || generateErrorId()
    this.timestamp = new Date().toISOString()
    this.details = options?.details
    this.statusCode = options?.statusCode

    // Maintains proper stack trace for V8 engines
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError)
    }
  }

  /**
   * Returns error details suitable for copying to clipboard.
   */
  toClipboardDetails(): Record<string, unknown> {
    return {
      errorId: this.errorId,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
      ...(this.details && { details: this.details }),
    }
  }

  /**
   * Check if this error is a system error (transient, may be retried).
   */
  isSystemError(): boolean {
    const systemErrorCodes: ErrorCodeType[] = [
      ERROR_CODES.LEDGER_UNAVAILABLE,
      ERROR_CODES.LEDGER_TIMEOUT,
      ERROR_CODES.NETWORK_ERROR,
      ERROR_CODES.NETWORK_TIMEOUT,
      ERROR_CODES.UNKNOWN_ERROR,
    ]
    return systemErrorCodes.includes(this.code as ErrorCodeType)
  }

  /**
   * Check if this error should show a retry button.
   */
  isRetryable(): boolean {
    const retryableErrorCodes: ErrorCodeType[] = [
      ERROR_CODES.LEDGER_UNAVAILABLE,
      // Deadline exceeded on a ledger call: outcome unknown, but the money
      // routes carry idempotency keys so a replay is safe.
      ERROR_CODES.LEDGER_TIMEOUT,
      ERROR_CODES.NETWORK_ERROR,
      ERROR_CODES.NETWORK_TIMEOUT,
    ]
    return retryableErrorCodes.includes(this.code as ErrorCodeType)
  }
}

/**
 * Generates a unique error ID for support reference.
 * Format: ERR-{8 character nanoid}
 * @example "ERR-abc12345"
 */
export function generateErrorId(): string {
  return `${ERROR_ID_PREFIX}-${nanoid(8)}`
}

/**
 * Gets the user-friendly message for an error code.
 * Falls back to UNKNOWN_ERROR message if code not found.
 */
export function getErrorMessage(code: string): string {
  if (code in ERROR_MESSAGES) {
    return ERROR_MESSAGES[code as ErrorCode]
  }
  return ERROR_MESSAGES.UNKNOWN_ERROR
}

/**
 * Checks if an error is a network timeout (AbortError from fetch).
 */
export function isNetworkTimeout(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === 'AbortError'
  }
  return false
}

/**
 * Checks if an error is a network error (fetch failed).
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    // TypeError is thrown when fetch fails (network issues)
    return error.name === 'TypeError' && error.message.includes('fetch')
  }
  return false
}

/**
 * Structured API error response format.
 */
export interface ApiErrorResponse {
  error: string
  message?: string
  errorId?: string
  timestamp?: string
  details?: Record<string, unknown>
  currentVersion?: string
  expectedVersion?: string
}

/**
 * Parses an API error response into an AppError.
 * Handles various error formats and normalizes them.
 *
 * @param response - Fetch Response object or parsed error body
 * @param fallbackMessage - Message to use if parsing fails
 * @returns AppError with normalized properties
 */
export async function parseApiError(
  response: Response | ApiErrorResponse,
  fallbackMessage = 'An error occurred'
): Promise<AppError> {
  let errorBody: ApiErrorResponse

  if (response instanceof Response) {
    try {
      errorBody = await response.json()
    } catch {
      // Response body is not JSON
      return new AppError(ERROR_CODES.UNKNOWN_ERROR, fallbackMessage, {
        statusCode: response.status,
      })
    }
  } else {
    errorBody = response
  }

  // Determine error code
  const code = mapErrorToCode(errorBody.error)

  // Build details object
  const details: Record<string, unknown> = { ...errorBody.details }
  if (errorBody.currentVersion) {
    details.currentVersion = errorBody.currentVersion
  }
  if (errorBody.expectedVersion) {
    details.expectedVersion = errorBody.expectedVersion
  }

  return new AppError(code, errorBody.message || getErrorMessage(code), {
    errorId: errorBody.errorId,
    details: Object.keys(details).length > 0 ? details : undefined,
    statusCode: response instanceof Response ? response.status : undefined,
  })
}

/**
 * Maps an error string to a known error code.
 * Handles both exact matches and pattern matching.
 */
function mapErrorToCode(error?: string): ErrorCodeType {
  if (!error) return ERROR_CODES.UNKNOWN_ERROR

  // Check for exact match first
  if (Object.values(ERROR_CODES).includes(error as ErrorCodeType)) {
    return error as ErrorCodeType
  }

  // Pattern matching for common error messages
  const lowerError = error.toLowerCase()

  if (lowerError.includes('permission') || lowerError.includes('forbidden')) {
    return ERROR_CODES.INSUFFICIENT_PRIVILEGES
  }
  if (lowerError.includes('version') || lowerError.includes('conflict')) {
    return ERROR_CODES.VERSION_CONFLICT
  }
  if (lowerError.includes('not found') || lowerError.includes('notfound')) {
    return ERROR_CODES.ACCOUNT_NOT_FOUND
  }
  if (lowerError.includes('unavailable') || lowerError.includes('service error') || lowerError.includes('grpc')) {
    return ERROR_CODES.LEDGER_UNAVAILABLE
  }
  if (lowerError.includes('timeout')) {
    return ERROR_CODES.NETWORK_TIMEOUT
  }
  if (lowerError.includes('network') || lowerError.includes('connection')) {
    return ERROR_CODES.NETWORK_ERROR
  }
  if (
    lowerError.includes('validation') ||
    lowerError.includes('invalid') ||
    lowerError.includes('required')
  ) {
    return ERROR_CODES.VALIDATION_ERROR
  }

  return ERROR_CODES.UNKNOWN_ERROR
}

/**
 * Converts any error to an AppError.
 * Useful for catch blocks to normalize errors.
 */
export function toAppError(
  error: unknown,
  fallbackMessage = 'An error occurred'
): AppError {
  // Already an AppError
  if (error instanceof AppError) {
    return error
  }

  // Check for timeout
  if (isNetworkTimeout(error)) {
    return new AppError(ERROR_CODES.NETWORK_TIMEOUT, 'Request timed out. Please try again.')
  }

  // Check for network error
  if (isNetworkError(error)) {
    return new AppError(ERROR_CODES.NETWORK_ERROR, 'Network error. Please check your connection.')
  }

  // Standard Error
  if (error instanceof Error) {
    // Check for error code property (from existing code)
    const code = (error as { code?: string }).code
    if (code && Object.values(ERROR_CODES).includes(code as ErrorCodeType)) {
      return new AppError(code as ErrorCodeType, error.message, {
        details: {
          currentVersion: (error as { currentVersion?: string }).currentVersion,
          expectedVersion: (error as { expectedVersion?: string }).expectedVersion,
        },
      })
    }

    // Map message to code
    const mappedCode = mapErrorToCode(error.message)
    return new AppError(mappedCode, error.message)
  }

  // Unknown error type
  return new AppError(ERROR_CODES.UNKNOWN_ERROR, fallbackMessage)
}
