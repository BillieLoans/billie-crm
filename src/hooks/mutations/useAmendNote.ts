import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { CreateNoteParams, CreateNoteResult } from './useCreateNote'

export interface AmendNoteParams extends Omit<CreateNoteParams, 'content'> {
  originalNoteId: string
  content: object
}

interface AmendmentStatusUpdateError extends Error {
  retryContext: {
    originalNoteId: string
    amendmentNoteId: string
  }
}

async function createAmendment(params: AmendNoteParams): Promise<CreateNoteResult> {
  const res = await fetch('/api/contact-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...params,
      amendsNote: params.originalNoteId,
    }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const message = body?.errors?.[0]?.message || body?.message || 'Failed to create amendment'
    throw new Error(message)
  }

  return res.json()
}

async function markOriginalAsAmended(originalNoteId: string): Promise<void> {
  const res = await fetch(`/api/contact-notes/${originalNoteId}/amend`, {
    method: 'PATCH',
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const message =
      body?.error?.message ||
      body?.errors?.[0]?.message ||
      body?.message ||
      'Amendment was created but the original note could not be marked amended'
    throw new Error(message)
  }
}

async function amendNote(params: AmendNoteParams): Promise<CreateNoteResult> {
  const createResult = await createAmendment(params)

  try {
    await markOriginalAsAmended(params.originalNoteId)
  } catch (error) {
    const partialError = new Error(
      error instanceof Error
        ? error.message
        : 'Amendment was created but the original note could not be marked amended',
    ) as AmendmentStatusUpdateError

    partialError.retryContext = {
      originalNoteId: params.originalNoteId,
      amendmentNoteId: createResult.doc.id,
    }
    throw partialError
  }

  return createResult
}

export function useAmendNote(customerId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: amendNote,
    onSuccess: () => {
      toast.success('Amendment created')
      queryClient.invalidateQueries({ queryKey: ['contact-notes', customerId] })
    },
    onError: (error) => {
      if (error instanceof Error && 'retryContext' in error) {
        toast.error('Amendment partially applied', {
          description:
            'A new amendment was saved, but the original note status update failed. Retry marking the original as amended.',
        })
        return
      }

      toast.error('Failed to amend note', {
        description: error instanceof Error ? error.message : 'Please try again',
      })
    },
  })
}
