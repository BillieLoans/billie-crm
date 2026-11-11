import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { toast } from 'sonner'
import { useClearDifferentPerson } from '@/hooks/mutations/useClearDifferentPerson'
import { showErrorToast } from '@/lib/utils/error-toast'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@/lib/utils/error-toast', () => ({
  showErrorToast: vi.fn(),
}))

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const command = {
  conversationId: 'conv-stopped-1',
  justification: 'Recycled mobile number, different person',
}

describe('useClearDifferentPerson', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
  })

  it('POSTs the command to the different-person route and returns the request id', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ requestId: 'req-1', eventId: 'evt-1', status: 'accepted' }),
    })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useClearDifferentPerson(), {
      wrapper: createWrapper(queryClient),
    })

    let response: unknown
    await act(async () => {
      response = await result.current.clearAsync(command)
    })

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/commands/reapp-block-clear/different-person',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(command) }),
    )
    expect(response).toMatchObject({ requestId: 'req-1' })
    expect(toast.success).toHaveBeenCalled()
    // The conversation record carries the outcome, so it is re-read.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['conversation'] })
  })

  it("rejects with the route's message and shows the error toast", async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          error: {
            code: 'NOT_A_CONTACT_MATCH_STOP',
            message: 'This application was not stopped by a contact match.',
          },
        }),
    })
    const { result } = renderHook(() => useClearDifferentPerson(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await expect(result.current.clearAsync(command)).rejects.toThrow(
        'This application was not stopped by a contact match.',
      )
    })

    expect(showErrorToast).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'clear-different-person' }),
    )
    expect(toast.success).not.toHaveBeenCalled()
  })
})
