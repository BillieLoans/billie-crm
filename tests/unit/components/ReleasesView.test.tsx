import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/admin/marketing/releases',
}))
vi.mock('next/link', () => ({
  default: ({ children, href }: never) => <a href={href}>{children}</a>,
}))

const hooks = vi.hoisted(() => ({
  useReleases: vi.fn(),
  useGateStatus: vi.fn(),
}))
vi.mock('@/hooks', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return { ...original, useReleases: hooks.useReleases, useGateStatus: hooks.useGateStatus }
})
// The subnav pulls the marketing overview badge counts — stub it so this
// test doesn't also need to mock that fetch.
vi.mock('@/hooks/queries/useMarketingOverview', () => ({
  useMarketingOverview: () => ({ data: undefined }),
}))

import { ReleasesView } from '@/components/MarketingView/ReleasesView'

const release = {
  id: '1',
  releaseId: 'rel-1',
  name: 'August wave 2',
  type: 'waitlist',
  status: 'active',
  derivedStatus: 'active',
  grantedCount: 150,
  claimedCount: 113,
  quotaCount: null,
  expiresAt: '2026-08-15T00:00:00Z',
  releasedAt: '2026-08-01T00:00:00Z',
}

describe('ReleasesView', () => {
  test('shows gate-off banner when mode is open', () => {
    hooks.useReleases.mockReturnValue({
      data: { docs: [release], totalDocs: 1, totalPages: 1, page: 1 },
      isLoading: false,
      isError: false,
    })
    hooks.useGateStatus.mockReturnValue({ data: { mode: 'open', setBy: null, changedAt: null } })
    render(<ReleasesView />)
    expect(screen.getByText(/gate is OFF/i)).toBeTruthy()
    expect(screen.getByText('August wave 2')).toBeTruthy()
  })

  test('no banner when gated; capacity summary shows unclaimed grants', () => {
    hooks.useReleases.mockReturnValue({
      data: { docs: [release], totalDocs: 1, totalPages: 1, page: 1 },
      isLoading: false,
      isError: false,
    })
    hooks.useGateStatus.mockReturnValue({ data: { mode: 'gated', setBy: 'ops', changedAt: null } })
    render(<ReleasesView />)
    expect(screen.queryByText(/gate is OFF/i)).toBeNull()
    expect(screen.queryByText(/kill switch/i)).toBeNull()
    // 150 granted − 113 claimed = 37, surfaced both in the capacity chip and
    // the row's Remaining column.
    expect(screen.getAllByText('37').length).toBeGreaterThan(0)
  })

  test('shows kill-switch alert when mode is closed', () => {
    hooks.useReleases.mockReturnValue({
      data: { docs: [release], totalDocs: 1, totalPages: 1, page: 1 },
      isLoading: false,
      isError: false,
    })
    hooks.useGateStatus.mockReturnValue({
      data: { mode: 'closed', setBy: 'ops', changedAt: null },
    })
    render(<ReleasesView />)
    expect(screen.queryByText(/gate is OFF/i)).toBeNull()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/kill switch on/i)
    expect(alert.textContent).toMatch(/all new applications are blocked/i)
    expect(screen.getByText('August wave 2')).toBeTruthy()
  })
})
