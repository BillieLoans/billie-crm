import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'

const authState = vi.hoisted(() => ({
  user: null as { id: string; role: string } | null,
}))
vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: authState.user }) }))
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
  useSetGateMode: vi.fn(),
}))
vi.mock('@/hooks', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    useReleases: hooks.useReleases,
    useGateStatus: hooks.useGateStatus,
    useSetGateMode: hooks.useSetGateMode,
  }
})
// The subnav pulls the marketing overview badge counts — stub it so this
// test doesn't also need to mock that fetch.
vi.mock('@/hooks/queries/useMarketingOverview', () => ({
  useMarketingOverview: () => ({ data: undefined }),
}))

import { ReleasesView } from '@/components/MarketingView/ReleasesView'

const ADMIN_USER = { id: 'admin-1', role: 'admin' }
const OPS_USER = { id: 'ops-1', role: 'operations' }

beforeEach(() => {
  authState.user = null
  hooks.useSetGateMode.mockReset().mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  })
})

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

describe('ReleasesView — gate-mode controls (admin-only)', () => {
  beforeEach(() => {
    hooks.useReleases.mockReturnValue({
      data: { docs: [release], totalDocs: 1, totalPages: 1, page: 1 },
      isLoading: false,
      isError: false,
    })
    hooks.useGateStatus.mockReturnValue({ data: { mode: 'open', setBy: null, changedAt: null } })
  })

  test('renders the three mode buttons for an admin user; current mode is disabled', () => {
    authState.user = ADMIN_USER
    render(<ReleasesView />)

    expect(screen.getByTestId('gate-control')).toBeTruthy()
    expect(screen.getByTestId('gate-btn-open')).toBeDisabled() // already open
    expect(screen.getByTestId('gate-btn-gated')).not.toBeDisabled()
    expect(screen.getByTestId('gate-btn-closed')).not.toBeDisabled()
  })

  test('hides the gate control for a non-admin user', () => {
    authState.user = OPS_USER
    render(<ReleasesView />)
    expect(screen.queryByTestId('gate-control')).toBeNull()
    expect(screen.queryByTestId('gate-btn-closed')).toBeNull()
  })

  test('hides the gate control when logged out', () => {
    authState.user = null
    render(<ReleasesView />)
    expect(screen.queryByTestId('gate-control')).toBeNull()
  })

  test('switching to gated opens a consequence-confirm modal; confirming fires the mutation', () => {
    authState.user = ADMIN_USER
    const mutate = vi.fn()
    hooks.useSetGateMode.mockReturnValue({ mutate, isPending: false, isError: false, error: null })
    render(<ReleasesView />)

    fireEvent.click(screen.getByTestId('gate-btn-gated'))
    expect(screen.getByText('Gated: only released applicants can start applications.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Confirm — set Gated/i }))
    expect(mutate).toHaveBeenCalledWith({ mode: 'gated' }, expect.any(Object))
  })

  test('switching to open opens a consequence-confirm modal with the open copy', () => {
    authState.user = ADMIN_USER
    hooks.useGateStatus.mockReturnValue({ data: { mode: 'gated', setBy: 'ops', changedAt: null } })
    render(<ReleasesView />)

    fireEvent.click(screen.getByTestId('gate-btn-open'))
    expect(screen.getByText('Open: gate off, everyone can apply.')).toBeTruthy()
  })

  test('closing the gate requires the exact typed phrase CLOSE before confirm enables', () => {
    authState.user = ADMIN_USER
    const mutate = vi.fn()
    hooks.useSetGateMode.mockReturnValue({ mutate, isPending: false, isError: false, error: null })
    render(<ReleasesView />)

    fireEvent.click(screen.getByTestId('gate-btn-closed'))
    expect(screen.getByText(/Blocks ALL new applications.*until reopened/)).toBeTruthy()

    const confirmButton = screen.getByRole('button', { name: 'Close the gate' })
    expect(confirmButton).toBeDisabled()

    const input = screen.getByLabelText(/to confirm/i)
    fireEvent.change(input, { target: { value: 'clos' } }) // wrong case / partial
    expect(confirmButton).toBeDisabled()

    fireEvent.change(input, { target: { value: 'CLOSE' } })
    expect(confirmButton).not.toBeDisabled()

    fireEvent.click(confirmButton)
    expect(mutate).toHaveBeenCalledWith({ mode: 'closed' }, expect.any(Object))
  })

  test('disables all mode buttons while a change is pending', () => {
    authState.user = ADMIN_USER
    hooks.useSetGateMode.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
      isError: false,
      error: null,
    })
    render(<ReleasesView />)

    expect(screen.getByTestId('gate-btn-gated')).toBeDisabled()
    expect(screen.getByTestId('gate-btn-closed')).toBeDisabled()
  })
})
