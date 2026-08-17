/**
 * Server-side API error utilities.
 * Used in API routes to return structured error responses.
 */

import { NextResponse } from 'next/server'
import { ERROR_CODES, type ErrorCodeType, ERROR_STATUS_CODES } from '@/lib/errors/codes'
import { ERROR_MESSAGES, type ErrorCode } from '@/lib/errors/messages'
import { generateErrorId } from './error'

/**
 * Structured API error response format.
 */
export interface ApiErrorBody {
  error: ErrorCodeType
  message: string
  errorId: string
  timestamp: string
  details?: Record<string, unknown>
}

/**
 * Creates a structured API error response.
 *
 * @param code - Error code from ERROR_CODES
 * @param options - Additional error options
 * @returns NextResponse with structured error body
 */
export function createApiError(
  code: ErrorCodeType,
  options?: {
    message?: string
    details?: Record<string, unknown>
    statusCode?: number
  },
): NextResponse<ApiErrorBody> {
  const statusCode = options?.statusCode || ERROR_STATUS_CODES[code] || 500
  const message =
    options?.message ||
    (code in ERROR_MESSAGES ? ERROR_MESSAGES[code as ErrorCode] : ERROR_MESSAGES.UNKNOWN_ERROR)

  const body: ApiErrorBody = {
    error: code,
    message,
    errorId: generateErrorId(),
    timestamp: new Date().toISOString(),
    ...(options?.details && { details: options.details }),
  }

  return NextResponse.json(body, { status: statusCode })
}

/**
 * Body shape of a validation failure.
 *
 * This intentionally does NOT use {@link ApiErrorBody}: the dominant convention
 * across the API routes is `{ error: 'Validation failed', details: fieldErrors }`
 * where `details` is a Zod `flatten().fieldErrors` map, and the client's
 * `parseApiError`/`mapErrorToCode` already resolves that string to
 * `VALIDATION_ERROR`. The helper was reshaped to the convention rather than the
 * ~19 routes being reshaped to the helper.
 */
export interface ValidationErrorBody {
  error: string
  details: Record<string, string[] | undefined>
}

/**
 * Creates a 400 validation error response from Zod field errors.
 *
 * @param fieldErrors - `parseResult.error.flatten().fieldErrors`
 * @param message - Optional override for the top-level `error` string
 */
export function createValidationError(
  fieldErrors: Record<string, string[] | undefined>,
  message = 'Validation failed',
): NextResponse<ValidationErrorBody> {
  return NextResponse.json({ error: message, details: fieldErrors }, { status: 400 })
}

/**
 * gRPC status codes we map deliberately.
 * @see https://grpc.io/docs/guides/status-codes/
 */
const GRPC_DEADLINE_EXCEEDED = 4
const GRPC_NOT_FOUND = 5
const GRPC_ALREADY_EXISTS = 6
const GRPC_FAILED_PRECONDITION = 9
const GRPC_UNAVAILABLE = 14

/**
 * gRPC `ServiceError`s reject with `{ code: number, details: string }` alongside
 * the standard Error fields (see the promisify wrapper in `server/grpc-client.ts`).
 */
function getGrpcStatus(error: unknown): { code: number; details?: string } | null {
  if (!error || typeof error !== 'object') return null
  const code = (error as { code?: unknown }).code
  if (typeof code !== 'number') return null
  const details = (error as { details?: unknown }).details
  return { code, details: typeof details === 'string' && details ? details : undefined }
}

/**
 * Converts a caught error to an API error response.
 * Useful in catch blocks to normalize error responses.
 *
 * Resolution order:
 *  1. gRPC status code (authoritative — the ledger sets it deliberately)
 *  2. message substring heuristics (legacy fallback, kept so nothing regresses)
 *  3. UNKNOWN_ERROR / 500
 */
export function handleApiError(
  error: unknown,
  context?: {
    action?: string
    accountId?: string
  },
): NextResponse<ApiErrorBody> {
  console.error(`API Error${context?.action ? ` [${context.action}]` : ''}:`, error)

  const contextDetails = {
    ...(context?.action && { action: context.action }),
    ...(context?.accountId && { accountId: context.accountId }),
  }

  // 1. gRPC status codes — deterministic, so they take priority over substrings.
  const grpc = getGrpcStatus(error)
  if (grpc) {
    switch (grpc.code) {
      // Deterministic business-rule rejection (e.g. NCC fee cap). Retrying is
      // pointless, so this must never surface as a retryable 5xx.
      case GRPC_FAILED_PRECONDITION:
        return createApiError(ERROR_CODES.LEDGER_REJECTED, {
          ...(grpc.details && { message: grpc.details }),
          details: { ...contextDetails, grpcCode: grpc.code },
        })
      // The operation was already applied (duplicate post).
      case GRPC_ALREADY_EXISTS:
        return createApiError(ERROR_CODES.DUPLICATE_OPERATION, {
          ...(grpc.details && { message: grpc.details }),
          details: { ...contextDetails, grpcCode: grpc.code },
        })
      case GRPC_NOT_FOUND:
        return createApiError(ERROR_CODES.ACCOUNT_NOT_FOUND, {
          details: { ...contextDetails, grpcCode: grpc.code },
        })
      // The client deadline elapsed (10s read / 45s write) before the ledger
      // answered. The outcome is unknown — the post may or may not have landed —
      // but every money route sends a client idempotency key, so replaying the
      // same key cannot double-post. Surface as a retryable 503.
      //
      // Note the default message is used deliberately rather than `grpc.details`
      // ("Deadline exceeded"), which tells the operator nothing about whether it
      // is safe to retry.
      case GRPC_DEADLINE_EXCEEDED:
        return createApiError(ERROR_CODES.LEDGER_TIMEOUT, {
          details: { ...contextDetails, service: 'ledger', grpcCode: grpc.code },
        })
      // Transport-level: the ledger is down or unreachable. Retryable.
      case GRPC_UNAVAILABLE:
        return createApiError(ERROR_CODES.LEDGER_UNAVAILABLE, {
          details: { ...contextDetails, service: 'ledger', grpcCode: grpc.code },
        })
    }
  }

  // 2. Legacy message-substring heuristics.
  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    // Check for service unavailable
    if (message.includes('unavailable') || message.includes('connect')) {
      return createApiError(ERROR_CODES.LEDGER_UNAVAILABLE, {
        details: {
          ...(context?.action && { action: context.action }),
          ...(context?.accountId && { accountId: context.accountId }),
          service: 'ledger',
        },
      })
    }

    // Check for not found
    if (message.includes('not found')) {
      return createApiError(ERROR_CODES.ACCOUNT_NOT_FOUND, {
        details: {
          ...(context?.accountId && { accountId: context.accountId }),
        },
      })
    }

    // Check for permission errors
    if (message.includes('permission') || message.includes('forbidden')) {
      return createApiError(ERROR_CODES.INSUFFICIENT_PRIVILEGES)
    }
  }

  // Default to unknown error
  return createApiError(ERROR_CODES.UNKNOWN_ERROR, {
    details: {
      ...(context?.action && { action: context.action }),
      ...(context?.accountId && { accountId: context.accountId }),
      reason: 'An unexpected error occurred.',
    },
  })
}
