/**
 * Request Block-Clear Mutation Hook (Event-Sourced)
 *
 * Submits a reapplication block-clear request via the command API.
 *
 * Single-operator path (windowed declines): emits clear_authorized.v1 directly
 * to chatLedger — no projection row created, no poll needed.
 *
 * Maker-checker path (high-risk reasons): emits block_clear_approval.requested.v1
 * to the CRM internal stream — a pending row is created and the request hook
 * returns immediately (caller waits for approval via useApproveBlockClear).
 *
 * In both cases the hook returns after the 202; it does NOT poll.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { showErrorToast } from '@/lib/utils/error-toast'
import type { BlockClearRequestCommand } from '@/lib/events/schemas'
import type { PublishEventResponse } from '@/lib/events/types'

// =============================================================================
// Types
// =============================================================================

export interface RequestBlockClearParams {
  /** Canonical customer ID from billie-platform-services */
  canonicalCustomerId: string
  /** Reasons for the block clear (at least one required) */
  reasons: string[]
  /** Operator justification for the clear */
  justification: string
  /** Optional conversation ID (context for the request) */
  conversationId?: string
  /** Optional customer display name */
  customerName?: string
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * Publish request command via the command API.
 */
async function publishRequestCommand(
  params: RequestBlockClearParams,
): Promise<PublishEventResponse> {
  const command: BlockClearRequestCommand = {
    canonicalCustomerId: params.canonicalCustomerId,
    reasons: params.reasons as BlockClearRequestCommand['reasons'],
    justification: params.justification,
    conversationId: params.conversationId,
    customerName: params.customerName,
  }

  const res = await fetch('/api/commands/reapp-block-clear/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: 'Failed to submit request' } }))
    throw new Error(error.error?.message || 'Failed to submit block-clear request')
  }

  return res.json()
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Mutation hook for submitting a reapplication block-clear request.
 *
 * Returns immediately after 202 — does NOT poll for a projection row
 * (single-operator path has no row; maker-checker row is eventual).
 */
export function useRequestBlockClear() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: publishRequestCommand,
    retry: 0, // Don't retry on failure - let user retry manually

    onSuccess: () => {
      toast.success('Block-clear request submitted', {
        description: 'Your request has been submitted for processing.',
      })
      queryClient.invalidateQueries({ queryKey: ['pending-block-clears'] })
      queryClient.invalidateQueries({ queryKey: ['conversation'] })
    },

    onError: (error) => {
      showErrorToast(error, {
        title: 'Failed to submit request',
        action: 'request-block-clear',
      })
    },
  })

  return {
    request: mutation.mutate,
    requestAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  }
}
