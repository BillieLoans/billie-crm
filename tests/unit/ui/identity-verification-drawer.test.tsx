/**
 * IdentityVerificationDrawer — servicing-view slide-over that renders the
 * customer's latest identity check with IdentityVerificationDetail.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: React.PropsWithChildren<{ href: string; [k: string]: unknown }>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import { IdentityVerificationDrawer } from '@/components/ServicingView/IdentityVerificationDrawer'

const renderDrawer = (isOpen = true) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <IdentityVerificationDrawer customerId="C1" isOpen={isOpen} onClose={() => {}} />
    </QueryClientProvider>,
  )

const PAYLOAD = {
  conversationId: 'conv-9',
  applicationNumber: 'APP-9',
  assessedAt: '2026-09-12T01:00:00.000Z',
  identity: {
    decision: 'APPROVED',
    lab_verification: {
      id: 'vid-1',
      verificationNumber: 'V60000296',
      status: 'completed',
      createdAt: '2026-09-12T01:00:00Z',
      result: {
        outcome: 'pass',
        checks: [
          { checkType: 'identity', outcome: 'pass', providers: [] },
          { checkType: 'screening', outcome: 'pass', providers: [] },
        ],
      },
      provider: [{ name: 'IDMatrix', reference: 'REF-1' }],
    },
  },
  report: { reportAvailable: true, screeningReportAvailable: true, rawResponseAvailable: false },
}

describe('IdentityVerificationDrawer', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('does not fetch while closed', () => {
    renderDrawer(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches on open and renders the same detail as the application view', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => PAYLOAD })
    renderDrawer(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/customer/C1/identity-verification')
    await waitFor(() => expect(screen.getByTestId('identity-decision')).toBeInTheDocument())
    expect(screen.getByTestId('identity-decision')).toHaveTextContent('APPROVED')
    expect(screen.getByText('V60000296')).toBeInTheDocument()
    expect(screen.getByTestId('identity-check-identity')).toBeInTheDocument()
    expect(screen.getByTestId('identity-check-screening')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'APP-9' })).toHaveAttribute(
      'href',
      '/admin/applications/conv-9?from=servicing',
    )
    expect(screen.getByTestId('identity-check-screening-report')).toHaveAttribute(
      'href',
      '/api/customer/C1/identity-report?artifact=screening',
    )
  })

  it('explains when no identity check exists', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    renderDrawer(true)
    await waitFor(() =>
      expect(screen.getByText(/No identity check has been recorded/)).toBeInTheDocument(),
    )
  })
})
