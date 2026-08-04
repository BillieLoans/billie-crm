import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'

vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/admin/marketing/releases/rel-1',
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: never) => <a href={href}>{children}</a>,
}))
vi.mock('@/hooks/queries/useMarketingOverview', () => ({
  useMarketingOverview: () => ({ data: undefined }),
}))

const hooks = vi.hoisted(() => ({
  useRelease: vi.fn(),
  useRevokeRelease: vi.fn(),
}))
vi.mock('@/hooks', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return { ...original, useRelease: hooks.useRelease, useRevokeRelease: hooks.useRevokeRelease }
})

import { ReleaseDetail } from '@/components/MarketingView/ReleaseDetail'

const baseRelease = {
  id: '1',
  releaseId: 'rel-1',
  name: 'August wave 2',
  type: 'waitlist',
  status: 'active',
  derivedStatus: 'active',
  quotaCount: null,
  expiresAt: '2026-08-15T00:00:00Z',
  sendInviteSms: true,
  grantedCount: 150,
  claimedCount: 113,
  smsSentCount: 120,
  smsFailedCount: 2,
  createdByActor: 'ops-1',
  releasedAt: '2026-08-01T00:00:00Z',
  revokedBy: null,
  revokedAt: null,
  updatedAt: '2026-08-01T00:00:00Z',
  createdAt: '2026-08-01T00:00:00Z',
}

const grants = {
  docs: [
    {
      id: 'g1',
      releaseId: 'rel-1',
      mobileE164: '+61400000001',
      contactId: 'c-1',
      customerId: null,
      source: 'targeted',
      status: 'granted',
      smsStatus: 'sent',
      claimedAt: null,
      updatedAt: '',
      createdAt: '',
    },
    {
      id: 'g2',
      releaseId: 'rel-1',
      mobileE164: '+61400000002',
      contactId: null,
      customerId: 'CUS-TEST-002',
      source: 'targeted',
      status: 'claimed',
      smsStatus: 'not_sent',
      claimedAt: '2026-08-02T00:00:00Z',
      updatedAt: '',
      createdAt: '',
    },
    {
      id: 'g3',
      releaseId: 'rel-1',
      mobileE164: '+61400000003',
      contactId: null,
      customerId: null,
      source: 'quota_claim',
      status: 'claimed',
      smsStatus: 'not_sent',
      claimedAt: '2026-08-02T00:00:00Z',
      updatedAt: '',
      createdAt: '',
    },
  ],
  totalDocs: 3,
  totalPages: 1,
  page: 1,
}

const mutate = vi.fn()

beforeEach(() => {
  cleanup()
  mutate.mockReset()
  hooks.useRevokeRelease.mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
    error: null,
  })
})

describe('ReleaseDetail', () => {
  test('shows a syncing empty-state while the release has not landed yet', () => {
    hooks.useRelease.mockReturnValue({ data: undefined, isLoading: true })
    render(<ReleaseDetail releaseId="rel-1" />)
    expect(screen.getByText(/still syncing/i)).toBeTruthy()
  })

  test('renders header, stat tiles, and the grants table with a contact link', () => {
    hooks.useRelease.mockReturnValue({ data: { release: baseRelease, grants }, isLoading: false })
    render(<ReleaseDetail releaseId="rel-1" />)

    expect(screen.getByText('August wave 2')).toBeTruthy()
    expect(screen.getByText('active')).toBeTruthy()
    expect(screen.getByText('150')).toBeTruthy() // Granted
    expect(screen.getByText('113')).toBeTruthy() // Claimed

    const contactLink = screen.getByText('c-1').closest('a')
    expect(contactLink?.getAttribute('href')).toBe('/admin/marketing/contacts/c-1')
  })

  test('links to the customer/servicing view when a grant has a customerId but no contactId yet', () => {
    hooks.useRelease.mockReturnValue({ data: { release: baseRelease, grants }, isLoading: false })
    render(<ReleaseDetail releaseId="rel-1" />)

    const customerLink = screen.getByText('CUS-TEST-002').closest('a')
    expect(customerLink?.getAttribute('href')).toBe('/admin/servicing/CUS-TEST-002')
  })

  test('shows — in the Contact cell when neither contactId nor customerId is set', () => {
    hooks.useRelease.mockReturnValue({ data: { release: baseRelease, grants }, isLoading: false })
    render(<ReleaseDetail releaseId="rel-1" />)

    const row = screen.getByText('+61400000003').closest('tr')
    expect(row?.textContent).toContain('—')
  })

  test('Granted tile shows — for an open_quota release', () => {
    hooks.useRelease.mockReturnValue({
      data: { release: { ...baseRelease, type: 'open_quota', quotaCount: 200 }, grants },
      isLoading: false,
    })
    render(<ReleaseDetail releaseId="rel-1" />)
    const grantedLabel = screen.getByText('Granted')
    expect(grantedLabel.parentElement?.textContent).toContain('—')
  })

  test('revoke confirm enables only when the typed text matches the release name exactly', () => {
    hooks.useRelease.mockReturnValue({ data: { release: baseRelease, grants }, isLoading: false })
    render(<ReleaseDetail releaseId="rel-1" />)

    fireEvent.click(screen.getByRole('button', { name: /revoke release/i }))
    const confirmButton = screen.getByRole('button', { name: /^revoke release$/i })
    expect(confirmButton).toBeDisabled()

    const input = screen.getByLabelText(/to confirm/i)
    fireEvent.change(input, { target: { value: 'August wave' } }) // partial match
    expect(confirmButton).toBeDisabled()

    fireEvent.change(input, { target: { value: 'August wave 2' } })
    expect(confirmButton).not.toBeDisabled()

    fireEvent.click(confirmButton)
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ releaseId: 'rel-1' }),
      expect.any(Object),
    )
  })
})
