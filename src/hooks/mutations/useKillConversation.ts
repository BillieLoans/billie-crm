import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { ConversationKillCommand } from '@/lib/events/schemas'

export interface KillConversationResult {
  eventId: string
  requestId: string
}

/**
 * Mutation hook for ending a live billieChat conversation (admin/supervisor
 * only). Publishes `conversation.kill.requested.v1` via
 * `POST /api/commands/conversation-kill` and fires immediately — no
 * approval round-trip (see docs/superpowers/specs/2026-08-24-conversation-kill-design.md).
 *
 * On success, shows a "request submitted" toast (this is a 202-accepted,
 * no-optimistic-claim flow — the toast is the only confirmation an operator
 * gets until the poll catches up) and invalidates the conversation detail
 * query so the banner and status flip once the projection has caught up.
 */
export function useKillConversation(conversationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (cmd: ConversationKillCommand): Promise<KillConversationResult> => {
      const res = await fetch('/api/commands/conversation-kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(cmd),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error?.message ?? 'Failed to end conversation')
      }
      return res.json() as Promise<KillConversationResult>
    },
    onSuccess: () => {
      toast.success('End-conversation request submitted')
      queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
    },
  })
}
