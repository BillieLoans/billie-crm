import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import {
  useNotificationBody,
  NotificationBodyNotFoundError,
} from '@/hooks/queries/useNotificationBody'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const successBody = {
  notificationId: 'ntn_001',
  idempotencyKey: 'key',
  channel: 'email',
  templateName: 'pre_due_email_first',
  templateContentHash: 'hash',
  templateGitSha: 'sha',
  subject: 'Your payment is due',
  body: '<html>...</html>',
  isHtml: true,
  provider: 'resend',
  providerMessageId: 'abc',
  recipientHash: 'rh',
  customerId: 'cust_abc',
  correlationId: '',
  sentAt: '2026-05-11T00:00:00.000Z',
  failedAt: null,
  success: true,
  errorType: '',
  errorMessage: '',
  tags: { category: 'servicing' },
}

describe('useNotificationBody', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the body on success', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => successBody,
    })

    const { result } = renderHook(() => useNotificationBody('ntn_001'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.body?.subject).toBe('Your payment is due')
    expect(result.current.isNotFound).toBe(false)
  })

  it('flags isNotFound on 404 without retrying', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'NOT_FOUND', message: 'too old' } }),
    })

    const { result } = renderHook(() => useNotificationBody('ntn_old'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.isNotFound).toBe(true)
    expect(result.current.error).toBeInstanceOf(NotificationBodyNotFoundError)
    // 404 must not trigger retries
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not fetch when disabled', async () => {
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    renderHook(() => useNotificationBody('ntn_001', { enabled: false }), {
      wrapper: createWrapper(),
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
