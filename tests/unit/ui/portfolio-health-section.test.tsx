/**
 * The Dashboard's portfolio section points to Reports for the business's
 * headline numbers and trends, rather than repeating them (the UX review's
 * decision: headline tiles live on the Reports home).
 */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/DashboardView/ECLSummaryWidget', () => ({
  ECLSummaryWidget: () => <div data-testid="ecl-widget" />,
}))

import { PortfolioHealthSection } from '@/components/DashboardView/PortfolioHealthSection'

describe('PortfolioHealthSection', () => {
  it('links to Reports for applications, approval rate, lending and arrears', () => {
    render(<PortfolioHealthSection />)
    const link = screen.getByTestId('dashboard-reports-link')
    expect(link).toHaveAttribute('href', '/admin/reports')
    expect(screen.getByTestId('portfolio-health-section')).toHaveTextContent(
      'Applications, approval rate, lending and arrears, with their trends, are in Reports.',
    )
  })
})
