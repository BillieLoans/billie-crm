/**
 * Approve Block-Clear Mutation Hook (Event-Sourced)
 *
 * Approves a reapplication block-clear request via the command API, which
 * publishes an event to the CRM stream and chatLedger. Then polls for the
 * status change in the reapplication-block-clear-requests collection.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { showErrorToast } from '@/lib/utils/error-toast'
import { pollForBlockClearUpdate, PollTimeoutError } from '@/lib/events/poll'
import type { BlockClearApproveCommand } from '@/lib/events/schemas'
import type { PublishEventResponse } from '@/lib/events/types'

// =============================================================================
// Types
// =============================================================================

export interface ApproveBlockClearParams {
  /** Block-clear request ID */
  requestId: string
  /** Human-readable request number (e.g., BC-20241211...) */
  requestNumber: string
  /** Mandatory approval comment (min 10 chars) */
  comment: string
}

export interface ApproveBlockClearResult {
  id: string
  requestNumber: string
  requestId: string
  status: 'approved'
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * Publish approve command via the command API.
 */
async function publishApproveCommand(
  params: ApproveBlockClearParams,
): Promise<PublishEventResponse> {
  const command: BlockClearApproveCommand = {
    requestId: params.requestId,
    requestNumber: params.requestNumber,
    comment: params.comment.trim(),
  }

  const res = await fetch('/api/commands/reapp-block-clear/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  })

  if (!res.ok) {
    const error = await res
      .json()
      .catch(() => ({ error: { message: 'Failed to approve request' } }))
    throw new Error(error.error?.message || 'Failed to approve block-clear request')
  }

  return res.json()
}

/**
 * Approve block-clear request and poll for the status change.
 */
async function approveBlockClear(
  params: ApproveBlockClearParams,
): Promise<ApproveBlockClearResult> {
  // 1. Publish the command event
  await publishApproveCommand(params)

  // 2. Poll for the status to change to 'approved'
  const projection = await pollForBlockClearUpdate<ApproveBlockClearResult>(
    params.requestId,
    'approved',
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
 * Mutation hook for approving a reapplication block-clear request.
 *
 * Uses event sourcing: publishes command → polls for status change.
 */
export function useApproveBlockClear() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: approveBlockClear,
    retry: 0, // Don't retry on failure - let user retry manually

    onSuccess: (data) => {
      toast.success(`Block-clear request ${data.requestNumber} approved`, {
        description: 'The reapplication block has been cleared.',
      })
      queryClient.invalidateQueries({ queryKey: ['block-clear-requests'] })
      queryClient.invalidateQueries({ queryKey: ['pending-block-clears'] })
    },

    onError: (error) => {
      // Handle polling timeout specifically
      if (error instanceof PollTimeoutError) {
        toast.warning('Approval submitted but confirmation delayed', {
          description:
            'Your approval was accepted but is taking longer than expected. Please refresh to see the status.',
        })
        queryClient.invalidateQueries({ queryKey: ['block-clear-requests'] })
        queryClient.invalidateQueries({ queryKey: ['pending-block-clears'] })
        return
      }

      showErrorToast(error, {
        title: 'Failed to approve request',
        action: 'approve-block-clear',
      })
    },
  })

  return {
    approve: mutation.mutate,
    approveAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  }
}
