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

let searchParams = new URLSearchParams()
const routerReplace = vi.fn()
const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, push: routerPush }),
  usePathname: () => '/admin/reports/weekly',
  useSearchParams: () => searchParams,
}))

const reportsState: {
  data?: { reports: unknown[]; canAuthor: boolean }
  isLoading: boolean
  error: Error | null
} = { isLoading: false, error: null }
vi.mock('@/hooks/queries/useReports', () => ({ useReports: () => reportsState }))

let pinned: string[] = []
const togglePin = vi.fn()
vi.mock('@/hooks/queries/useReportPreferences', () => ({
  useReportPins: () => ({
    pinned,
    isPinned: (slug: string) => pinned.includes(slug),
    toggle: togglePin,
    error: null,
  }),
}))
const homeState: { data?: unknown[]; isLoading: boolean; error: Error | null } = {
  isLoading: false,
  error: null,
}
vi.mock('@/hooks/queries/useReportsHome', () => ({ useReportsHome: () => homeState }))

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
  charts: [{ type: 'line', x: 'day', series: [{ column: 'approved' }] }],
  columns: [],
  headline: [],
  category: 'credit',
  featured: false,
  excludesMock: true,
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
  charts: [],
  columns: [],
  headline: [],
  category: 'other',
  featured: false,
  excludesMock: false,
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

const RANGED = {
  id: 'r3',
  slug: 'declines',
  title: 'Declines',
  description: 'Decline rate by source. Mock decisions are excluded.',
  published: true,
  category: 'credit',
  featured: false,
  excludesMock: true,
  parameters: [
    { name: 'from', label: 'From', type: 'date', required: true, default: 'today-30' },
    { name: 'to', label: 'To', type: 'date', required: true, default: 'today-1' },
    {
      name: 'group_by',
      label: 'Split by',
      type: 'select',
      required: true,
      default: 'source',
      options: [
        { value: 'source', label: 'Source' },
        { value: 'ruleset', label: 'Ruleset' },
      ],
    },
  ],
  charts: [],
  headline: [{ column: 'decline_rate_pct', label: 'Decline rate', better: 'lower' }],
  columns: [],
}
const RANGED_RESULT = {
  report: { slug: 'declines', title: 'Declines', version: 'v1', draft: false },
  columns: [
    { name: 'segment', kind: 'text' },
    { name: 'decided', kind: 'number' },
    { name: 'decline_rate_pct', kind: 'number' },
  ],
  rows: [
    { segment: 'paid', decided: 60, decline_rate_pct: 30 },
    { segment: 'organic', decided: 40, decline_rate_pct: 45 },
    { segment: 'All', decided: 100, decline_rate_pct: 36 },
  ],
  rowCount: 3,
  truncated: false,
  durationMs: 12,
}
const PREVIOUS_ROWS = [{ segment: 'All', decided: 90, decline_rate_pct: 30 }]

const fetchMock = vi.fn()

function respond(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body })
}

/** The JSON bodies sent to the run endpoint. */
function sentBodies(): Array<{
  parameters: Record<string, unknown>
  draft: boolean
  compare: boolean
}> {
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
  searchParams = new URLSearchParams()
  pinned = []
  togglePin.mockReset()
  homeState.data = []
  homeState.isLoading = false
  homeState.error = null
  window.history.replaceState(null, '', '/')
  routerReplace.mockReset()
  routerPush.mockReset()
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
    expect(screen.queryByTestId('author-toolbar')).toBeNull()
  })

  it('runs once straight away when every parameter has a default, then shows the results', async () => {
    renderView('weekly')
    expect(await screen.findByTestId('report-table')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/reports/weekly')
    expect(sentBodies()[0]).toMatchObject({ draft: false })
    expect(sentBodies()[0].parameters.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    expect(screen.getByTestId('report-status')).toHaveTextContent('Showing 2 rows.')
    expect(screen.getByTestId('report-freshness')).toHaveTextContent('Sydney dates')
    expect(screen.getByTestId('report-chart')).toBeInTheDocument()
    const table = screen.getByTestId('report-table')
    expect(within(table).getByText('1,234')).toBeInTheDocument()
    expect(within(table).getByText('20/10/26')).toBeInTheDocument()
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
        charts: [{ type: 'bar', x: 'code', series: [{ column: 'n' }] }],
        columns: [],
        headline: [],
      },
    }
    reportsState.data = { reports: [WEEKLY, withDraft], canAuthor: true }
    renderView('by-code')
    expect(screen.getByRole('link', { name: 'Edit report' })).toHaveAttribute(
      'href',
      '/admin/collections/report-definitions/r2',
    )
    expect(screen.getByLabelText('Reason code')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Latest draft'))
    expect(screen.queryByLabelText('Reason code')).toBeNull()
    expect(window.location.search).toBe('?_draft=1')
    fireEvent.change(screen.getByLabelText('Since'), { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run report' }))
    await screen.findByTestId('report-table')
    expect(sentBodies().at(-1)).toMatchObject({ parameters: { since: '2026-10-01' }, draft: true })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Declines by code (v2)')
  })

  it('runs a draft-only report as a draft and says it is unpublished', async () => {
    currentUser = { id: 'a1', role: 'admin' }
    const draftOnly = { ...WEEKLY, slug: 'new-one', published: false, draft: WEEKLY }
    reportsState.data = { reports: [draftOnly], canAuthor: true }
    renderView('new-one')
    expect(screen.getByText(/Not published\./)).toBeInTheDocument()
    expect(screen.queryByLabelText('Latest draft')).toBeNull()
    await screen.findByTestId('report-table')
    expect(sentBodies()[0]).toMatchObject({ draft: true })
    expect(
      within(screen.getByRole('navigation', { name: 'Reports' })).getByText('(draft)'),
    ).toBeInTheDocument()
  })

  it('reads its settings from the link and writes changes back to it', async () => {
    searchParams = new URLSearchParams('code=AB12&limit=5')
    renderView('by-code')
    expect(screen.getByLabelText('Reason code')).toHaveValue('AB12')
    await screen.findByTestId('report-table')
    expect(sentBodies()[0].parameters).toEqual({ code: 'AB12', limit: '5' })

    fireEvent.change(screen.getByLabelText('Reason code'), { target: { value: 'CD34' } })
    expect(window.location.pathname).toBe('/admin/reports/weekly')
    expect(window.location.search).toBe('?code=CD34&limit=5')
    // Re-runs on its own shortly after the change.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(sentBodies()[1].parameters).toEqual({ code: 'CD34', limit: '5' })
  })

  it('offers preset periods, compares with the previous period and leads with the headline', async () => {
    fetchMock.mockImplementation(() =>
      respond(200, {
        ...RANGED_RESULT,
        previous: { from: '2026-09-01', to: '2026-09-30', rows: PREVIOUS_ROWS, rowCount: 1 },
        dataAsAt: new Date().toISOString(),
      }),
    )
    reportsState.data = { reports: [RANGED], canAuthor: false }
    renderView('declines')
    const period = screen.getByRole('group', { name: 'Period' })
    expect(within(period).getByLabelText('Last 30 days')).toBeChecked()
    await screen.findByTestId('report-headline')

    fireEvent.click(screen.getByLabelText('Compare with the previous period'))
    await waitFor(() => expect(sentBodies().at(-1)).toMatchObject({ compare: true }))
    expect(await screen.findAllByText(/up 6 pts on the previous 30 days/)).toHaveLength(2)
    expect(screen.getByTestId('report-narrative')).toHaveTextContent(
      'Decline rate was 36%, up 6 pts on the previous 30 days.',
    )
    expect(screen.getByTestId('report-freshness')).toHaveTextContent(/Data to .* today/)
    expect(screen.getByTestId('report-freshness')).toHaveTextContent('mock applications excluded')

    fireEvent.click(within(period).getByLabelText('Last 7 days'))
    await waitFor(() =>
      expect(sentBodies().at(-1)?.parameters.from).not.toBe(sentBodies()[0].parameters.from),
    )
    fireEvent.click(within(period).getByLabelText('Custom'))
    expect(screen.getByLabelText('From')).toBeInTheDocument()
  })

  it('clears the results while an edit is invalid, and marks the field without moving focus', async () => {
    renderView('by-code')
    fireEvent.change(screen.getByLabelText('Reason code'), { target: { value: 'AB' } })
    await screen.findByTestId('report-table')
    const field = screen.getByLabelText(/Limit/)
    field.focus()
    fireEvent.change(field, { target: { value: 'many' } })
    await waitFor(() => expect(screen.queryByTestId('report-table')).toBeNull())
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveFocus()
    expect(screen.queryByTestId('report-error-summary')).toBeNull()
  })

  it('shows choices of four or fewer as a row of options', () => {
    reportsState.data = { reports: [RANGED], canAuthor: false }
    renderView('declines')
    const split = screen.getByRole('group', { name: 'Split by' })
    expect(within(split).getByLabelText('Source')).toBeChecked()
    expect(within(split).getByLabelText('Ruleset')).not.toBeChecked()
  })

  it('says when a link names no report the user can run', () => {
    renderView('secret')
    expect(screen.getByTestId('report-not-found')).toHaveTextContent('Report not found')
  })
})

describe('Reports home', () => {
  it('leads with the headline numbers, then pinned, recent and every report by area', () => {
    pinned = ['by-code']
    homeState.data = [
      {
        slug: 'weekly',
        title: 'Weekly approvals',
        category: 'credit',
        label: 'Approved',
        text: '1,241',
        change: { delta: 12, unit: 'pct', direction: 'up', tone: 'good', text: 'up 12%' },
        previousLabel: 'the previous 7 days',
        spark: [1, 3, 2],
      },
    ]
    renderView('')
    const home = screen.getByTestId('reports-home')
    const kpi = within(screen.getByTestId('home-kpis')).getByRole('link')
    expect(kpi).toHaveAttribute('href', '/admin/reports/weekly')
    expect(kpi).toHaveTextContent('Approved1,241▲ up 12% on the previous 7 days (better)')
    expect(within(home).getByRole('heading', { name: 'Pinned' })).toBeInTheDocument()
    expect(within(home).getByRole('region', { name: 'Credit decisions' })).toHaveTextContent(
      'Weekly approvals',
    )
    expect(screen.queryByRole('navigation', { name: 'Reports' })).toBeNull()
  })

  it('searches reports by name and offers Claude when nothing matches', async () => {
    currentUser = { id: 'a1', role: 'supervisor' }
    reportsState.data = { reports: [WEEKLY, BY_CODE], canAuthor: true }
    renderView('')
    const search = screen.getByLabelText('Find a report')
    fireEvent.change(search, { target: { value: 'declines' } })
    expect(screen.getByRole('heading', { name: /1 report matches/ })).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'churn' } })
    expect(screen.getByRole('link', { name: 'Ask Claude to draft it' })).toHaveAttribute(
      'href',
      '/admin/reports/ask?q=churn',
    )
    fireEvent.change(screen.getByLabelText('Or ask a question'), {
      target: { value: 'approvals by week' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask Claude' }))
    expect(routerPush).toHaveBeenCalledWith('/admin/reports/ask?q=approvals%20by%20week')
  })
})

describe('Ask Claude from the home', () => {
  it('opens with the question asked on the home', () => {
    currentUser = { id: 'a1', role: 'supervisor' }
    reportsState.data = { reports: [WEEKLY], canAuthor: true }
    searchParams = new URLSearchParams('q=approvals by week')
    renderView('ask')
    expect(screen.getByLabelText('Question')).toHaveValue('approvals by week')
  })
})

describe('Reports sidebar', () => {
  it('groups reports by area, filters them, and pins the chosen ones first', () => {
    pinned = ['by-code']
    renderView('weekly')
    const nav = screen.getByRole('navigation', { name: 'Reports' })
    expect(within(nav).getByRole('heading', { name: 'Pinned' })).toBeInTheDocument()
    expect(within(nav).getByText('Credit decisions')).toBeInTheDocument()
    fireEvent.change(within(nav).getByLabelText('Find a report'), { target: { value: 'zzz' } })
    expect(within(nav).getByText(/No report matches/)).toBeInTheDocument()
  })

  it('folds behind a button that names the current report, for small screens', () => {
    renderView('weekly')
    // Shown only on small screens (CSS), so found by its test id here.
    const toggle = screen.getByTestId('reports-nav-toggle')
    expect(toggle).toHaveTextContent('Reports: Weekly approvals')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('pins a report from its page', () => {
    renderView('weekly')
    fireEvent.click(screen.getByRole('button', { name: 'Pin Weekly approvals' }))
    expect(togglePin).toHaveBeenCalledWith('weekly')
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
