/**
 * Unit tests for the report results block: formatted table cells, totals
 * pinned in the footer, small samples marked, the data behind "Show data"
 * when there is a chart, changes against the previous period, and copying
 * the table.
 */
import React from 'react'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/ReportsView/ReportChart', () => ({
  ReportChart: ({ spec }: { spec: { type: string } }) => (
    <div data-testid="report-chart" data-type={spec.type} />
  ),
}))

import { ReportResults } from '@/components/ReportsView/ReportResults'

const COLUMNS = [
  { name: 'segment', kind: 'text' as const },
  { name: 'decided', kind: 'number' as const },
  { name: 'decline_rate_pct', kind: 'number' as const },
]
const ROWS = [
  { segment: 'All', decided: 47, decline_rate_pct: 40 },
  { segment: 'not recorded', decided: 25, decline_rate_pct: 44 },
  { segment: 'paid', decided: 17, decline_rate_pct: 35.3 },
  { segment: 'llm', decided: 5, decline_rate_pct: 60 },
]

describe('ReportResults', () => {
  it('formats values, pins the total in the footer and puts data gaps last', () => {
    render(<ReportResults title="Declines" charts={[]} columns={COLUMNS} rows={ROWS} />)
    const table = screen.getByTestId('report-table')
    const [head, body, foot] = within(table).getAllByRole('rowgroup')
    expect(within(head).getByText('Decline rate')).toBeInTheDocument()
    const bodyRows = within(body).getAllByRole('row')
    expect(bodyRows.map((r) => r.querySelector('td')?.textContent)).toEqual([
      'paid',
      'llm',
      'not recorded',
    ])
    expect(within(foot).getByRole('rowheader')).toHaveTextContent('All')
    expect(within(foot).getByText('40%')).toBeInTheDocument()
  })

  it('marks rates on small samples and explains the mark', () => {
    render(<ReportResults title="Declines" charts={[]} columns={COLUMNS} rows={ROWS} />)
    expect(screen.getAllByText('(small sample)')).toHaveLength(2)
    expect(screen.getByTestId('small-sample-note')).toHaveTextContent(
      'Based on fewer than 20 decided',
    )
  })

  it('puts the table behind Show data when there is a chart', () => {
    render(
      <ReportResults
        title="Declines"
        charts={[{ type: 'bar', x: 'segment', series: [{ column: 'decided' }] }]}
        columns={COLUMNS}
        rows={ROWS}
      />,
    )
    const toggle = screen.getByRole('button', { name: 'Show data (4 rows)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('report-table').closest('[hidden]')).not.toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide data' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByTestId('report-table').closest('[hidden]')).toBeNull()
  })

  it('shows the change on the previous period beside each number', () => {
    render(
      <ReportResults
        title="Declines"
        charts={[]}
        columnSpecs={[{ name: 'decline_rate_pct', better: 'lower' }]}
        columns={COLUMNS}
        rows={ROWS}
        previousRows={[{ segment: 'All', decided: 40, decline_rate_pct: 34 }]}
      />,
    )
    const foot = within(screen.getByTestId('report-table')).getAllByRole('rowgroup')[2]
    expect(within(foot).getByText('up 6 pts on the previous period')).toBeInTheDocument()
    expect(within(foot).getByText('up 17.5% on the previous period')).toBeInTheDocument()
  })

  it('copies the table as tab-separated text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<ReportResults title="Declines" charts={[]} columns={COLUMNS} rows={ROWS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy table' }))
    await waitFor(() => expect(screen.getByText(/Table copied/)).toBeInTheDocument())
    expect(writeText.mock.calls[0][0]).toBe(
      [
        'Segment\tDecided\tDecline rate',
        'paid\t17\t35.3%',
        'llm\t5\t60%',
        'not recorded\t25\t44%',
        'All\t47\t40%',
      ].join('\n'),
    )
  })
})
