import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { CutoffCountdown } from '@/components/DashboardView/CutoffCountdown'
import { msUntilCutoff } from '@/lib/disbursement-cutoff'

vi.mock('@/lib/disbursement-cutoff', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/disbursement-cutoff')>()),
  msUntilCutoff: vi.fn(),
}))
const mockMs = vi.mocked(msUntilCutoff)

describe('CutoffCountdown', () => {
  beforeEach(() => mockMs.mockReturnValue(2 * 3600_000 + 14 * 60_000))

  afterEach(() => cleanup())

  it('shows the formatted countdown before 3pm', async () => {
    render(<CutoffCountdown />)
    await waitFor(() => expect(screen.getByTestId('cutoff-countdown')).toHaveTextContent('2h 14m'))
    expect(screen.getByText("Today's 3:00pm cut-off in")).toBeInTheDocument()
  })

  it('shows the passed state after 3pm', async () => {
    mockMs.mockReturnValue(-60_000)
    render(<CutoffCountdown />)
    await waitFor(() =>
      expect(screen.getByTestId('cutoff-countdown')).toHaveTextContent('passed at 3:00pm'),
    )
  })
})
