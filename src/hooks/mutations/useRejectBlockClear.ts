/**
 * Reject Block-Clear Mutation Hook (Event-Sourced)
 *
 * Rejects a reapplication block-clear request via the command API, which
 * publishes an event to the CRM stream. Then polls for the status change.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { showErrorToast } from '@/lib/utils/error-toast'
import { pollForBlockClearUpdate, PollTimeoutError } from '@/lib/events/poll'
import type { BlockClearRejectCommand } from '@/lib/events/schemas'
import type { PublishEventResponse } from '@/lib/events/types'

// =============================================================================
// Types
// =============================================================================

export interface RejectBlockClearParams {
  /** Block-clear request ID */
  requestId: string
  /** Human-readable request number (e.g., BC-20241211...) */
  requestNumber: string
  /** Mandatory rejection reason (min 10 chars) */
  reason: string
}

export interface RejectBlockClearResult {
  id: string
  requestNumber: string
  requestId: string
  status: 'rejected'
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * Publish reject command via the command API.
 */
async function publishRejectCommand(params: RejectBlockClearParams): Promise<PublishEventResponse> {
  const command: BlockClearRejectCommand = {
    requestId: params.requestId,
    requestNumber: params.requestNumber,
    reason: params.reason.trim(),
  }

  const res = await fetch('/api/commands/reapp-block-clear/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: 'Failed to reject request' } }))
    throw new Error(error.error?.message || 'Failed to reject block-clear request')
  }

  return res.json()
}

/**
 * Reject block-clear request and poll for the status change.
 */
async function rejectBlockClear(params: RejectBlockClearParams): Promise<RejectBlockClearResult> {
  // 1. Publish the command event
  await publishRejectCommand(params)

  // 2. Poll for the status to change to 'rejected'
  const projection = await pollForBlockClearUpdate<RejectBlockClearResult>(
    params.requestId,
    'rejected',
    {
      maxAttempts: 10,
      intervalMs: 500,
      initialDelayMs: 100,
    },
  )

  return projection
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Mutation hook for rejecting a reapplication block-clear request.
 *
 * Uses event sourcing: publishes command → polls for status change.
 */
export function useRejectBlockClear() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: rejectBlockClear,
    retry: 0, // Don't retry on failure - let user retry manually

    onSuccess: (data) => {
      toast.success(`Block-clear request ${data.requestNumber} rejected`, {
        description: 'The request has been rejected.',
      })
      queryClient.invalidateQueries({ queryKey: ['block-clear-requests'] })
      queryClient.invalidateQueries({ queryKey: ['pending-block-clears'] })
    },

    onError: (error) => {
      // Handle polling timeout specifically
      if (error instanceof PollTimeoutError) {
        toast.warning('Rejection submitted but confirmation delayed', {
          description:
            'Your rejection was accepted but is taking longer than expected. Please refresh to see the status.',
        })
        queryClient.invalidateQueries({ queryKey: ['block-clear-requests'] })
        queryClient.invalidateQueries({ queryKey: ['pending-block-clears'] })
        return
      }

      showErrorToast(error, {
        title: 'Failed to reject request',
        action: 'reject-block-clear',
      })
    },
  })

  return {
    reject: mutation.mutate,
    rejectAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  }
}
