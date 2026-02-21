import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

// =============================================================================
// Types
// =============================================================================

export interface CreateNoteParams {
  customer: string
  channel: string
  topic: string
  subject: string
  content: object
  loanAccount?: string | null
  contactDirection?: string | null
  priority?: string
  sentiment?: string
}

export interface CreateNoteResult {
  doc: { id: string }
}

// =============================================================================
// API
// =============================================================================

async function createNote(params: CreateNoteParams): Promise<CreateNoteResult> {
  const res = await fetch('/api/contact-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const message =
      // Payload wraps validation errors in errors array
      body?.errors?.[0]?.message ||
      body?.message ||
      'Failed to create note'
    throw new Error(message)
  }

  return res.json()
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Mutation hook for creating a new contact note.
 *
 * On success: shows "Note added" toast and invalidates contact-notes queries.
 * On error:   shows error toast with message.
 */
export function useCreateNote(customerId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createNote,

    onSuccess: () => {
      toast.success('Note added')
      queryClient.invalidateQueries({ queryKey: ['contact-notes', customerId] })
    },

    onError: (error) => {
      toast.error('Failed to add note', {
        description: error instanceof Error ? error.message : 'Please try again',
      })
    },
  })
}
