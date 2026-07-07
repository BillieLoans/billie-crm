/**
 * Write-Off Request Mutation Hook (Event-Sourced)
 *
 * Submits a write-off request via the command API, which publishes
 * an event to Redis. Then polls for the resulting projection.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useUIStore } from '@/stores/ui'
import { pollForWriteOffRequest, PollTimeoutError } from '@/lib/events/poll'
import type { WriteOffRequestCommand } from '@/lib/events/schemas'
import type { PublishEventResponse } from '@/lib/events/types'

// =============================================================================
// Types
// =============================================================================

export interface WriteOffRequestParams {
  loanAccountId: string
  customerId: string
  customerName?: string
  accountNumber?: string
  amount: number
  originalBalance: number
  reason: string
  notes?: string
  priority?: 'normal' | 'high' | 'urgent'
}

export interface WriteOffRequestResult {
  id: string
  requestNumber: string
  requestId: string
  eventId: string
  loanAccountId: string
  customerId: string
  amount: number
  reason: string
  status: string
  priority: string
  createdAt: string
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Senior approval threshold in AUD
 */
export const SENIOR_APPROVAL_THRESHOLD = 10000

/**
 * Query key for pending write-off requests
 */
export const writeOffRequestsQueryKey = (loanAccountId: string) =>
  ['write-off-requests', loanAccountId] as const

// =============================================================================
// API Functions
// =============================================================================

/**
 * Submit a write-off request via the command API.
 * Returns 202 Accepted with eventId for polling.
 */
async function publishWriteOffCommand(
  params: WriteOffRequestParams,
): Promise<PublishEventResponse> {
  const command: WriteOffRequestCommand = {
    loanAccountId: params.loanAccountId,
    customerId: params.customerId,
    customerName: params.customerName ?? '',
    accountNumber: params.accountNumber ?? '',
    amount: params.amount,
    originalBalance: params.originalBalance,
    reason: params.reason as WriteOffRequestCommand['reason'],
    notes: params.notes,
    priority: params.priority ?? 'normal',
  }

  const res = await fetch('/api/commands/writeoff/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: 'Failed to submit request' } }))
    throw new Error(error.error?.message || 'Failed to submit write-off request')
  }

  return res.json()
}

/**
 * Submit write-off request and poll for the resulting projection.
 */
async function submitWriteOffRequest(
  params: WriteOffRequestParams,
): Promise<WriteOffRequestResult> {
  // 1. Publish the command event
  const { eventId } = await publishWriteOffCommand(params)

  // 2. Poll for the projection to appear
  const projection = await pollForWriteOffRequest<WriteOffRequestResult>(eventId, {
    maxAttempts: 10,
    intervalMs: 500,
    initialDelayMs: 100,
  })

  return projection
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Mutation hook for submitting write-off requests.
 *
 * Uses event sourcing: publishes command → polls for projection.
 */
export function useWriteOffRequest() {
  const queryClient = useQueryClient()
  const readOnlyMode = useUIStore((state) => state.readOnlyMode)

  const mutation = useMutation({
    mutationFn: submitWriteOffRequest,

    onSuccess: (data) => {
      const requiresSenior = data.amount >= SENIOR_APPROVAL_THRESHOLD

      toast.success('Write-off request submitted', {
        description: requiresSenior
          ? `Request ${data.requestNumber} requires senior approval`
          : `Request ${data.requestNumber} is pending approval`,
      })

      // Invalidate pending write-off queries
      queryClient.invalidateQueries({
        queryKey: ['write-off-requests'],
      })
    },

    onError: (error) => {
      // Handle polling timeout specifically
      if (error instanceof PollTimeoutError) {
        toast.error('Request submitted but confirmation delayed', {
          description:
            'Your request was accepted but is taking longer than expected to process. Please refresh to see the status.',
        })
        // Still invalidate queries so a manual refresh shows the request
        queryClient.invalidateQueries({ queryKey: ['write-off-requests'] })
        return
      }

      const errorMessage =
        error instanceof Error ? error.message : 'Failed to submit write-off request'

      toast.error('Request failed', {
        description: errorMessage,
      })
    },
  })

  return {
    submitRequest: mutation.mutate,
    submitRequestAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
    isReadOnlyMode: readOnlyMode,
  }
}
