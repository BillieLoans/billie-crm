import { toast } from 'sonner'
import { AppError, toAppError } from './error'
import { ERROR_CODES } from '@/lib/errors/codes'

/**
 * Options for showErrorToast.
 */
export interface ErrorToastOptions {
  /** Title for the toast (defaults to "An error occurred") */
  title?: string
  /** Callback when retry button is clicked */
  onRetry?: () => void
  /** Action context for error details (e.g., "waive-fee", "record-repayment") */
  action?: string
  /** Account ID for error details */
  accountId?: string
  /** Additional context to include in clipboard data */
  context?: Record<string, unknown>
}

/**
 * Shows an error toast with consistent formatting and optional actions.
 *
 * Features:
 * - User-friendly error message from ERROR_MESSAGES
 * - Copy error details button for support tickets
 * - Retry button for retryable errors
 * - Error ID displayed for unknown errors
 *
 * @param error - The error to display (AppError, Error, or unknown)
 * @param options - Toast configuration options
 * @returns The AppError instance (useful for further processing)
 */
export function showErrorToast(
  error: unknown,
  options: ErrorToastOptions = {}
): AppError {
  const appError = toAppError(error, options.title)
  const { title, onRetry, action, accountId, context } = options

  // Build description with error ID for unknown/system errors
  let description = appError.message
  if (appError.code === ERROR_CODES.UNKNOWN_ERROR) {
    description = `${appError.message} (${appError.errorId})`
  }

  // Determine which action to show
  const toastAction = getToastAction(appError, {
    onRetry,
    action,
    accountId,
    context,
  })

  // Show the toast
  toast.error(title || getDefaultTitle(appError), {
    description,
    ...(toastAction && { action: toastAction }),
    duration: appError.isRetryable() ? 10000 : 5000, // Longer for retryable
  })

  return appError
}

/**
 * Gets the appropriate toast action based on error type.
 */
function getToastAction(
  appError: AppError,
  options: {
    onRetry?: () => void
    action?: string
    accountId?: string
    context?: Record<string, unknown>
  }
): { label: string; onClick: () => void } | undefined {
  const { onRetry, action, accountId, context } = options

  // For retryable errors with onRetry callback, show Retry button
  if (appError.isRetryable() && onRetry) {
    return {
      label: 'Retry',
      onClick: onRetry,
    }
  }

  // For all errors, show Copy Details button
  return {
    label: '📋 Copy details',
    onClick: () =>
      copyErrorDetails(appError, {
        action,
        accountId,
        ...context,
      }),
  }
}

/**
 * Gets the default title based on error code.
 */
function getDefaultTitle(appError: AppError): string {
  switch (appError.code) {
    case ERROR_CODES.NETWORK_TIMEOUT:
      return 'Request timed out'
    case ERROR_CODES.NETWORK_ERROR:
      return 'Network error'
    case ERROR_CODES.LEDGER_UNAVAILABLE:
      return 'Service unavailable'
    case ERROR_CODES.LEDGER_TIMEOUT:
      return 'Ledger timed out'
    case ERROR_CODES.VERSION_CONFLICT:
      return 'Data has changed'
    case ERROR_CODES.INSUFFICIENT_PRIVILEGES:
      return 'Permission denied'
    case ERROR_CODES.VALIDATION_ERROR:
      return 'Validation error'
    case ERROR_CODES.ACCOUNT_NOT_FOUND:
      return 'Not found'
    default:
      return 'An error occurred'
  }
}

/**
 * Copies error details to clipboard in JSON format.
 * Shows a success/failure toast.
 */
export async function copyErrorDetails(
  appError: AppError,
  additionalContext?: Record<string, unknown>
): Promise<boolean> {
  const details = {
    ...appError.toClipboardDetails(),
    ...(additionalContext && Object.keys(additionalContext).length > 0
      ? additionalContext
      : {}),
  }

  try {
    await navigator.clipboard.writeText(JSON.stringify(details, null, 2))
    toast.success('Error details copied', {
      description: 'Paste into your support ticket',
      duration: 2000,
    })
    return true
  } catch {
    toast.error('Failed to copy', {
      description: 'Please try again',
      duration: 2000,
    })
    return false
  }
}

/**
 * Shows a network timeout error toast with retry option.
 * Convenience wrapper for timeout-specific errors.
 */
export function showTimeoutToast(onRetry?: () => void): AppError {
  return showErrorToast(
    new AppError(ERROR_CODES.NETWORK_TIMEOUT, 'Request timed out. Please try again.'),
    {
      title: 'Request timed out',
      onRetry,
    }
  )
}

/**
 * Shows a service unavailable error toast with retry option.
 * Convenience wrapper for ledger unavailable errors.
 */
export function showServiceUnavailableToast(onRetry?: () => void): AppError {
  return showErrorToast(
    new AppError(ERROR_CODES.LEDGER_UNAVAILABLE),
    {
      title: 'Service unavailable',
      onRetry,
    }
  )
}
