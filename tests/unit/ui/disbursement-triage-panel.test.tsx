import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DisbursementTriagePanel } from '@/components/DashboardView/DisbursementTriagePanel'

vi.mock('@/hooks/queries/useDashboard', () => ({
  useDashboard: () => ({
    isLoading: false,
    data: {
      disbursementBuckets: {
        overdue: { count: 2, totalAmount: 1150, totalAmountFormatted: '$1,150.00' },
        today: { count: 8, totalAmount: 5940, totalAmountFormatted: '$5,940.00' },
        scheduled: { count: 14, totalAmount: 0, totalAmountFormatted: '$0.00' },
        todayDoneCount: 3,
        todayTotalCount: 11,
        scheduledTomorrowCount: 5,
      },
    },
  }),
}))

afterEach(cleanup)

describe('DisbursementTriagePanel', () => {
  it('renders all three buckets with counts', () => {
    render(<DisbursementTriagePanel />)
    expect(screen.getByTestId('bucket-overdue')).toHaveTextContent('2')
    expect(screen.getByTestId('bucket-today')).toHaveTextContent('8') // remaining, not total
    expect(screen.getByTestId('bucket-today')).toHaveTextContent('3 of 11')
    expect(screen.getByTestId('bucket-scheduled')).toHaveTextContent('14')
    expect(screen.getByTestId('bucket-scheduled')).toHaveTextContent('Tomorrow 5')
  })
})
