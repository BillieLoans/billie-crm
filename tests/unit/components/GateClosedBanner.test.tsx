import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: null }) }))

const hooks = vi.hoisted(() => ({
  useGateStatus: vi.fn(),
}))
vi.mock('@/hooks', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    useGateStatus: hooks.useGateStatus,
  }
})

import { GateClosedBanner } from '@/components/GateClosedBanner'

describe('GateClosedBanner', () => {
  test('renders the kill-switch banner and Releases link when mode is closed', () => {
    hooks.useGateStatus.mockReturnValue({
      data: { mode: 'closed', setBy: 'ops', changedAt: null },
    })
    render(<GateClosedBanner />)

    const banner = screen.getByRole('status')
    expect(banner.textContent).toMatch(/applications are closed/i)
    expect(banner.textContent).toMatch(/gate kill switch is on/i)
    expect(banner.textContent).toMatch(/no new applications can start/i)

    const link = screen.getByRole('link', { name: /manage in releases/i })
    expect(link.getAttribute('href')).toBe('/admin/marketing/releases')
  })

  test('renders nothing when mode is open', () => {
    hooks.useGateStatus.mockReturnValue({ data: { mode: 'open', setBy: null, changedAt: null } })
    const { container } = render(<GateClosedBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  test('renders nothing when mode is gated', () => {
    hooks.useGateStatus.mockReturnValue({
      data: { mode: 'gated', setBy: 'ops', changedAt: null },
    })
    const { container } = render(<GateClosedBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  test('renders nothing while loading (data undefined)', () => {
    hooks.useGateStatus.mockReturnValue({ data: undefined, isLoading: true })
    const { container } = render(<GateClosedBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  test('renders nothing on error', () => {
    hooks.useGateStatus.mockReturnValue({ data: undefined, isError: true })
    const { container } = render(<GateClosedBanner />)
    expect(container).toBeEmptyDOMElement()
  })
})
