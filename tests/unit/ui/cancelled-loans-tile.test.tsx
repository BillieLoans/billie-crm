/**
 * Dashboard tile: loans cancelled before disbursement (BTB-517).
 */
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'

const dashboard = vi.hoisted(() => ({
  value: { isLoading: false, data: { cancelledBeforeDisbursementCount: 3 } } as any,
}))
vi.mock('@/hooks/queries/useDashboard', () => ({ useDashboard: () => dashboard.value }))
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import { CancelledLoansTile } from '@/components/DashboardView/CancelledLoansTile'

afterEach(cleanup)

describe('CancelledLoansTile', () => {
  it('shows the count and links to the cancelled loans in the accounts browser', () => {
    render(<CancelledLoansTile />)
    const tile = screen.getByTestId('cancelled-loans-tile')
    expect(tile).toHaveTextContent('Cancelled before disbursement')
    expect(tile).toHaveTextContent('3')
    expect(screen.getByRole('link', { name: /View cancelled loans/ })).toHaveAttribute(
      'href',
      '/admin/accounts?status=cancelled',
    )
    expect(tile).toHaveAttribute('data-accent', 'neutral')
  })

  it('shows none when there are none, with no link', () => {
    dashboard.value = { isLoading: false, data: { cancelledBeforeDisbursementCount: 0 } }
    render(<CancelledLoansTile />)
    expect(screen.getByTestId('cancelled-loans-tile')).toHaveTextContent('0')
    expect(screen.queryByRole('link')).toBeNull()
  })
})
