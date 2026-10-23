/**
 * Unit tests for the Reports view (BTB-506): role gate, report list, the
 * generated parameter form with its error summary, results, status
 * announcements, draft handling and the CSV export. The report list hook
 * and the chart are mocked; runs go through the real query hook with
 * `fetch` mocked.
 */
import React from 'react'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

let currentUser: { id: string; role: string } | null = { id: 'u1', role: 'operations' }
vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: currentUser }) }))

const reportsState: {
  data?: { reports: unknown[]; canAuthor: boolean }
  isLoading: boolean
  error: Error | null
} = { isLoading: false, error: null }
vi.mock('@/hooks/queries/useReports', () => ({ useReports: () => reportsState }))

vi.mock('@/components/ReportsView/ReportChart', () => ({
  ReportChart: ({ spec }: { spec: { x: string } }) => (
    <div data-testid="report-chart" data-x={spec.x} />
  ),
}))

import { ReportsView } from '@/components/ReportsView/ReportsView'
import { toCsv } from '@/components/ReportsView/csv'

const WEEKLY = {
  id: 'r1',
  slug: 'weekly',
  title: 'Weekly approvals',
  description: 'Approvals by day',
  published: true,
  parameters: [{ name: 'from', label: 'From', type: 'date', required: true, default: 'today-7' }],
  chart: { type: 'line', x: 'day', series: [{ column: 'approved' }] },
}
const BY_CODE = {
  id: 'r2',
  slug: 'by-code',
  title: 'Declines by code',
  description: null,
  published: true,
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

const fetchMock = vi.fn()

function respond(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body })
}

/** The JSON bodies sent to the run endpoint. */
function sentBodies(): Array<{ parameters: Record<string, unknown>; draft: boolean }> {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))
}

function renderView(slug: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ReportsView slug={slug} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  currentUser = { id: 'u1', role: 'operations' }
  reportsState.data = { reports: [WEEKLY, BY_CODE], canAuthor: false }
  reportsState.isLoading = false
  reportsState.error = null
  fetchMock.mockReset().mockImplementation(() => respond(200, RESULT))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ReportsView', () => {
  it('explains, rather than shows, reports to roles outside the lending wall', () => {
    currentUser = { id: 'm1', role: 'marketing' }
    renderView('')
    expect(screen.getByTestId('access-denied')).toHaveTextContent('You cannot open reports')
  })

  it('lists the reports the user can run, marking the current one', () => {
    renderView('weekly')
    const nav = screen.getByRole('navigation', { name: 'Reports' })
    expect(within(nav).getByRole('link', { name: 'Weekly approvals' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).getByRole('link', { name: 'Declines by code' })).toHaveAttribute(
      'href',
      '/admin/reports/by-code',
    )
    expect(screen.queryByText('Edit report')).toBeNull()
    expect(screen.queryByLabelText('Run the latest draft')).toBeNull()
  })

  it('runs once straight away when every parameter has a default, then shows the results', async () => {
    renderView('weekly')
    expect(await screen.findByTestId('report-table')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/reports/weekly')
    expect(sentBodies()[0]).toMatchObject({ draft: false })
    expect(sentBodies()[0].parameters.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    expect(screen.getByTestId('report-status')).toHaveTextContent('2 rows in 0.4 seconds.')
    expect(screen.getByTestId('report-chart')).toBeInTheDocument()
    const table = screen.getByTestId('report-table')
    expect(within(table).getByText('1,234')).toBeInTheDocument()
    expect(within(table).getByText('20 October 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeEnabled()
  })

  it('does not run until required parameters are filled, and summarises what is missing', async () => {
    renderView('by-code')
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }))
    expect(fetchMock).not.toHaveBeenCalled()

    const summary = await screen.findByTestId('report-error-summary')
    await waitFor(() => expect(summary).toHaveFocus())
    const link = within(summary).getByRole('link', { name: 'Enter reason code' })
    const input = screen.getByLabelText('Reason code')
    expect(link).toHaveAttribute('href', `#${input.id}`)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toContain(`${input.id}-error`)
  })

  it('shows server-side field errors and run failures in the summary', async () => {
    fetchMock.mockImplementation(() =>
      respond(400, {
        error: {
          code: 'INVALID_PARAMETERS',
          message: 'Check the highlighted fields.',
          fields: { code: 'Reason code must be 200 characters or fewer' },
        },
      }),
    )
    renderView('by-code')
    fireEvent.change(screen.getByLabelText('Reason code'), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }))
    expect(await screen.findByTestId('report-error-summary')).toHaveTextContent(
      'Reason code must be 200 characters or fewer',
    )

    fetchMock.mockImplementation(() =>
      respond(504, { error: { code: 'TIMEOUT', message: 'The report took too long.' } }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }))
    await waitFor(() =>
      expect(screen.getByTestId('report-error-summary')).toHaveTextContent(
        'The report took too long.',
      ),
    )
    expect(screen.getByTestId('report-status')).toHaveTextContent('The report did not run.')
  })

  it('clears the previous results when a re-run fails', async () => {
    renderView('weekly')
    await screen.findByTestId('report-table')
    fetchMock.mockImplementation(() =>
      respond(504, { error: { code: 'TIMEOUT', message: 'The report took too long.' } }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }))
    await screen.findByTestId('report-error-summary')
    expect(screen.queryByTestId('report-table')).toBeNull()
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled()
  })

  it('keeps focus on the run button while a run is in progress', async () => {
    renderView('by-code')
    fireEvent.change(screen.getByLabelText('Reason code'), { target: { value: 'X' } })
    const button = screen.getByRole('button', { name: 'Run report' })
    button.focus()
    fireEvent.click(button)
    expect(button).toBeEnabled()
    expect(button).toHaveFocus()
    await screen.findByTestId('report-table')
  })

  it('warns when results were cut at the row limit', async () => {
    fetchMock.mockImplementation(() =>
      respond(200, { ...RESULT, truncated: true, rowCount: 50000 }),
    )
    renderView('weekly')
    expect(await screen.findByTestId('report-truncated')).toHaveTextContent(
      'Reports stop at 50,000 rows',
    )
  })

  it('gives authors an edit link and runs the draft with the draft form', async () => {
    currentUser = { id: 'a1', role: 'supervisor' }
    const withDraft = {
      ...BY_CODE,
      draft: {
        title: 'Declines by code (v2)',
        description: null,
        parameters: [{ name: 'since', label: 'Since', type: 'date', required: true }],
        chart: { type: 'bar', x: 'code', series: [{ column: 'n' }] },
      },
    }
    reportsState.data = { reports: [WEEKLY, withDraft], canAuthor: true }
    renderView('by-code')
    expect(screen.getByRole('link', { name: 'Edit report' })).toHaveAttribute(
      'href',
      '/admin/collections/report-definitions/r2',
    )
    expect(screen.getByLabelText('Reason code')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Run the latest draft'))
    expect(screen.queryByLabelText('Reason code')).toBeNull()
    fireEvent.change(screen.getByLabelText('Since'), { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }))
    await screen.findByTestId('report-table')
    expect(sentBodies().at(-1)).toEqual({ parameters: { since: '2026-10-01' }, draft: true })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Declines by code (v2)')
  })

  it('runs a draft-only report as a draft and says it is unpublished', async () => {
    currentUser = { id: 'a1', role: 'admin' }
    const draftOnly = { ...WEEKLY, slug: 'new-one', published: false, draft: WEEKLY }
    reportsState.data = { reports: [draftOnly], canAuthor: true }
    renderView('new-one')
    expect(screen.getByText(/Not published\./)).toBeInTheDocument()
    const toggle = screen.getByLabelText('Run the latest draft')
    expect(toggle).toBeChecked()
    expect(toggle).toBeDisabled()
    await screen.findByTestId('report-table')
    expect(sentBodies()[0]).toMatchObject({ draft: true })
    expect(
      within(screen.getByRole('navigation', { name: 'Reports' })).getByText('(draft)'),
    ).toBeInTheDocument()
  })

  it('says when a link names no report the user can run', () => {
    renderView('secret')
    expect(screen.getByTestId('report-not-found')).toHaveTextContent('Report not found')
  })
})

describe('toCsv', () => {
  it('writes raw values and neutralises spreadsheet formulas, headers included', () => {
    const csv = toCsv(
      [
        { name: 'name', kind: 'text' },
        { name: 'n', kind: 'number' },
        { name: 'meta', kind: 'text' },
        { name: '=cmd()', kind: 'text' },
      ],
      [
        { name: '=HYPERLINK("http://x")', n: -5, meta: { a: 1 }, '=cmd()': '-12' },
        { name: 'plain, with comma', n: 1.5, meta: null, '=cmd()': '-x' },
      ],
    )
    expect(csv.split('\r\n')).toEqual([
      `name,n,meta,'=cmd()`,
      `"'=HYPERLINK(""http://x"")",-5,"{""a"":1}",-12`,
      `"plain, with comma",1.5,,'-x`,
    ])
  })
})
