import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { ManualBlockSetCommand } from '@/lib/events/schemas'

export interface SetManualBlockResult {
  requestId: string
  eventId: string
}

/** The error message an API route sent, in either of the shapes routes use. */
function errorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as { error?: unknown; message?: unknown; details?: unknown }
  if (b.error && typeof b.error === 'object') {
    const message = (b.error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  if (b.details && typeof b.details === 'object') {
    const messages = Object.values(b.details as Record<string, unknown>)
      .flatMap((v) => (Array.isArray(v) ? v : []))
      .filter((v): v is string => typeof v === 'string')
    if (messages.length) return messages.join(' ')
  }
  return typeof b.message === 'string' ? b.message : null
}

/**
 * Mutation hook for "Set manual block" (BTB-517, supervisor/admin only).
 * Publishes `reapplication_block.manual_set.v1` via
 * `POST /api/commands/reapp-block-set` and returns the request id after the
 * 202. It does not wait for the block: billieChat's answer reaches the
 * customer record later (state.changed + manual_set_applied / _rejected), and
 * the caller watches the record for this request id.
 */
export function useSetManualBlock() {
  return useMutation({
    mutationFn: async (cmd: ManualBlockSetCommand): Promise<SetManualBlockResult> => {
      const res = await fetch('/api/commands/reapp-block-set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(cmd),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(errorMessage(body) ?? 'The block request was not sent. Try again.')
      }
      return res.json() as Promise<SetManualBlockResult>
    },
    onSuccess: () => {
      toast.success('Manual block requested')
    },
  })
}
