/**
 * Unit tests for the Reports view (BTB-506): role gate, report list,
 * generated parameter form with its error summary, results table, status
 * announcements and the CSV export. Data hooks and the chart are mocked.
 */
import React from 'react'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

let currentUser: { id: string; role: string } | null = { id: 'u1', role: 'operations' }
vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: currentUser }) }))

const reportsState: {
  data?: { reports: unknown[]; canAuthor: boolean }
  isLoading: boolean
  error: Error | null
} = { isLoading: false, error: null }
vi.mock('@/hooks/queries/useReports', () => ({ useReports: () => reportsState }))

const mutate = vi.fn()
vi.mock('@/hooks/mutations/useRunReport', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/mutations/useRunReport')>(
    '@/hooks/mutations/useRunReport',
  )
  return { ...actual, useRunReport: () => ({ mutate, isPending: false }) }
})

vi.mock('@/components/ReportsView/ReportChart', () => ({
  ReportChart: () => <div data-testid="report-chart" />,
}))

import { ReportsView } from '@/components/ReportsView/ReportsView'
import { ReportRunFailure } from '@/hooks/mutations/useRunReport'
import { toCsv } from '@/components/ReportsView/csv'

const WEEKLY = {
  id: 'r1',
  slug: 'weekly',
  title: 'Weekly approvals',
  description: 'Approvals by day',
  parameters: [{ name: 'from', label: 'From', type: 'date', required: true, default: 'today-7' }],
  chart: { type: 'line', x: 'day', series: [{ column: 'approved' }] },
}
const BY_CODE = {
  id: 'r2',
  slug: 'by-code',
  title: 'Declines by code',
  description: null,
  parameters: [
    { name: 'code', label: 'Reason code', type: 'text', required: true },
    { name: 'limit', label: 'Limit', type: 'integer', required: false },
  ],
  chart: null,
}

const RESULT = {
  report: { slug: 'weekly', title: 'Weekly approvals', version: 'v1', draft: false },
  columns: [
    { name: 'day', kind: 'date' },
    { name: 'approved', kind: 'number' },
  ],
  rows: [
    { day: '2026-10-20', approved: 1234 },
    { day: '2026-10-21', approved: 7 },
  ],
  rowCount: 2,
  truncated: false,
  durationMs: 420,
}

beforeEach(() => {
  currentUser = { id: 'u1', role: 'operations' }
  reportsState.data = { reports: [WEEKLY, BY_CODE], canAuthor: false }
  reportsState.isLoading = false
  reportsState.error = null
  mutate.mockReset()
})

describe('ReportsView', () => {
  it('explains, rather than shows, reports to roles outside the lending wall', () => {
    currentUser = { id: 'm1', role: 'marketing' }
    render(<ReportsView slug="" />)
    expect(screen.getByTestId('access-denied')).toHaveTextContent('You cannot open reports')
  })

  it('lists the reports the user can run, marking the current one', () => {
    render(<ReportsView slug="weekly" />)
    const nav = screen.getByRole('navigation', { name: 'Reports' })
    const current = within(nav).getByRole('link', { name: 'Weekly approvals' })
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Declines by code' })).toHaveAttribute(
      'href',
      '/admin/reports/by-code',
    )
    expect(screen.queryByText('Edit report')).toBeNull()
    expect(screen.queryByLabelText('Run the latest draft')).toBeNull()
  })

  it('runs straight away when every parameter has a default, then shows the results', () => {
    mutate.mockImplementation((_vars, opts) => opts.onSuccess(RESULT))
    render(<ReportsView slug="weekly" />)
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0][0]).toMatchObject({ slug: 'weekly', draft: false })
    expect(mutate.mock.calls[0][0].parameters.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    expect(screen.getByTestId('report-status')).toHaveTextContent('2 rows in 0.4 seconds.')
    expect(screen.getByTestId('report-chart')).toBeInTheDocument()
    const table = screen.getByTestId('report-table')
    expect(within(table).getByText('1,234')).toBeInTheDocument()
    expect(within(table).getByText('20 October 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeEnabled()
  })

  it('does not run until required parameters are filled, and summarises what is missing', () => {
    render(<ReportsView slug="by-code" />)
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }))
    expect(mutate).not.toHaveBeenCalled()

    const summary = screen.getByTestId('report-error-summary')
    expect(summary).toHaveFocus()
    const link = within(summary).getByRole('link', { name: 'Enter reason code' })
    const input = screen.getByLabelText('Reason code')
    expect(link).toHaveAttribute('href', `#${input.id}`)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toContain(`${input.id}-error`)
  })

  it('shows server-side field errors and run failures in the summary', () => {
    mutate.mockImplementation((_vars, opts) =>
      opts.onError(
        new ReportRunFailure('Check the highlighted fields.', 'INVALID_PARAMETERS', {
          code: 'Reason code must be 200 characters or fewer',
        }),
      ),
    )
    render(<ReportsView slug="by-code" />)
    fireEvent.change(screen.getByLabelText('Reason code'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }))
    expect(screen.getByTestId('report-error-summary')).toHaveTextContent(
      'Reason code must be 200 characters or fewer',
    )

    mutate.mockImplementation((_vars, opts) =>
      opts.onError(new ReportRunFailure('The report took too long.', 'TIMEOUT')),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }))
    expect(screen.getByTestId('report-error-summary')).toHaveTextContent(
      'The report took too long.',
    )
    expect(screen.getByTestId('report-status')).toHaveTextContent('The report did not run.')
  })

  it('warns when results were cut at the row limit', () => {
    mutate.mockImplementation((_vars, opts) =>
      opts.onSuccess({ ...RESULT, truncated: true, rowCount: 50000 }),
    )
    render(<ReportsView slug="weekly" />)
    expect(screen.getByTestId('report-truncated')).toHaveTextContent('Reports stop at 50,000 rows')
  })

  it('gives authors an edit link and the draft switch', () => {
    currentUser = { id: 'a1', role: 'supervisor' }
    reportsState.data = { reports: [WEEKLY, BY_CODE], canAuthor: true }
    render(<ReportsView slug="by-code" />)
    expect(screen.getByRole('link', { name: 'Edit report' })).toHaveAttribute(
      'href',
      '/admin/collections/report-definitions/r2',
    )
    fireEvent.click(screen.getByLabelText('Run the latest draft'))
    fireEvent.change(screen.getByLabelText('Reason code'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }))
    expect(mutate.mock.calls[0][0]).toMatchObject({ draft: true, parameters: { code: 'X' } })
  })

  it('says when a link names no report the user can run', () => {
    render(<ReportsView slug="secret" />)
    expect(screen.getByTestId('report-not-found')).toHaveTextContent('Report not found')
  })
})

describe('toCsv', () => {
  it('writes raw values and neutralises spreadsheet formulas', () => {
    const csv = toCsv(
      [
        { name: 'name', kind: 'text' },
        { name: 'n', kind: 'number' },
        { name: 'meta', kind: 'text' },
      ],
      [
        { name: '=HYPERLINK("http://x")', n: -5, meta: { a: 1 } },
        { name: 'plain, with comma', n: 1.5, meta: null },
      ],
    )
    expect(csv.split('\r\n')).toEqual([
      'name,n,meta',
      `"'=HYPERLINK(""http://x"")",-5,"{""a"":1}"`,
      '"plain, with comma",1.5,',
    ])
  })
})
