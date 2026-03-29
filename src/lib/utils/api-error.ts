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
  }
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
 * Creates a validation error response.
 */
export function createValidationError(
  field: string,
  message?: string
): NextResponse<ApiErrorBody> {
  return createApiError(ERROR_CODES.VALIDATION_ERROR, {
    message: message || `${field} is required`,
    details: { field },
    statusCode: 400,
  })
}

/**
 * Converts a caught error to an API error response.
 * Useful in catch blocks to normalize error responses.
 */
export function handleApiError(
  error: unknown,
  context?: {
    action?: string
    accountId?: string
  }
): NextResponse<ApiErrorBody> {
  console.error(`API Error${context?.action ? ` [${context.action}]` : ''}:`, error)

  // Check for gRPC errors (common format)
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
