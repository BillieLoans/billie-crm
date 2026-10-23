/**
 * Unit tests for the report editor: a new report's link from its title,
 * the error summary, the live preview, the form builders, saving a draft,
 * and publishing after a review of what changed against the published
 * version. `fetch` is mocked; the SQL editor and the chart are stubbed.
 */
import React from 'react'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const routerPush = vi.fn()
const routerReplace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
}))
vi.mock('@/components/ReportsView/SqlEditor', () => ({
  SqlEditor: ({
    id,
    label,
    value,
    onChange,
  }: {
    id: string
    label: string
    value: string
    onChange: (v: string) => void
  }) => (
    <textarea id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))
vi.mock('@/components/ReportsView/ReportChart', () => ({
  ReportChart: () => <div data-testid="report-chart" />,
}))
vi.mock('@/lib/reports/events', () => ({ logReportEvent: vi.fn() }))

import {
  ReportEditor,
  comparable,
  draftProblems,
  readDoc,
  slugFromTitle,
  toDocument,
  type EditorDraft,
} from '@/components/ReportsView/ReportEditor'

const PREVIEW = {
  columns: [
    { name: 'day', kind: 'date' },
    { name: 'applications', kind: 'number' },
  ],
  rows: [
    { day: '2026-10-20', applications: 12 },
    { day: '2026-10-21', applications: 9 },
  ],
  rowCount: 2,
  truncated: false,
  durationMs: 20,
}
const PUBLISHED = {
  id: 'r9',
  slug: 'daily',
  status: 'published',
  title: 'Daily applications',
  description: 'Applications by day.',
  category: 'acquisition',
  featured: false,
  sql: 'SELECT day, count(*) AS applications\nFROM application\nGROUP BY 1',
  parameters: [{ name: 'from', label: 'From', type: 'date', required: true, default: 'today-30' }],
  // One chart, stored as an object rather than a list.
  chart: { type: 'line', x: 'day', series: [{ column: 'applications' }] },
  headline: [],
  columnSettings: [],
  roles: ['admin', 'supervisor'],
  schedule: 'none',
}

const fetchMock = vi.fn()
const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body })
let saveStatus = 200
let publishedStatus = 200
let checkIssues: unknown[] = []
let stored: Record<string, unknown> = PUBLISHED

function routes(url: string, init: RequestInit = {}) {
  if (url === '/api/reports/ask') return json(200, { issues: checkIssues, preview: PREVIEW })
  if (url === '/api/reports/daily/definition') return json(200, stored)
  if (url === '/api/reports/daily/definition?version=published') {
    return json(publishedStatus, publishedStatus === 200 ? PUBLISHED : {})
  }
  if (url.startsWith('/api/report-definitions')) {
    return saveStatus === 200
      ? json(200, { doc: { id: 'r1' } })
      : json(saveStatus, {
          errors: [
            {
              message: 'The following field is invalid: slug',
              data: { errors: [{ path: 'slug', message: 'Value must be unique' }] },
            },
          ],
        })
  }
  void init
  return json(404, {})
}

const calls = (prefix: string) =>
  fetchMock.mock.calls
    .filter(([url]) => (url as string).startsWith(prefix))
    .map(([url, init]) => ({
      url: url as string,
      method: (init as RequestInit | undefined)?.method ?? 'GET',
      body: (init as RequestInit | undefined)?.body
        ? JSON.parse((init as RequestInit).body as string)
        : null,
    }))

function renderEditor(slug?: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ReportEditor slug={slug} reports={[]} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  saveStatus = 200
  publishedStatus = 200
  checkIssues = []
  stored = PUBLISHED
  routerPush.mockReset()
  routerReplace.mockReset()
  fetchMock.mockReset().mockImplementation(routes)
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('report editor helpers', () => {
  it('makes a link from a title', () => {
    expect(slugFromTitle('  Approval rate — by source (weekly)! ')).toBe(
      'approval-rate-by-source-weekly',
    )
    expect(slugFromTitle('!!!')).toBe('')
  })

  it('refuses a link Reports itself uses, and a number default that is not a number', () => {
    const draft = {
      ...(comparable(PUBLISHED) as never as EditorDraft),
      ...fromDocFields(),
    }
    expect(draftProblems({ ...draft, slug: 'new' })).toEqual([
      'The link "new" is taken by Reports itself: choose another',
    ])
    const numbers: EditorDraft = {
      ...draft,
      parameters: [{ name: 'n', label: 'Count', type: 'integer', required: false, default: '1x' }],
    }
    expect(draftProblems(numbers)[0]).toBe('Parameters: the default for Count is not a number')
    // Typed as text, stored as a number.
    const typed = { ...numbers, parameters: [{ ...numbers.parameters[0], default: '-3' }] }
    expect(draftProblems(typed)).toEqual([])
    expect((toDocument(typed).parameters as Array<{ default: unknown }>)[0].default).toBe(-3)
  })

  it('lists what stops a save', () => {
    const draft: EditorDraft = {
      title: ' ',
      slug: 'Bad Slug',
      description: '',
      category: 'other',
      featured: false,
      roles: [],
      schedule: 'none',
      sql: '',
      parameters: [],
      charts: [{ type: 'line', x: '', series: [] }],
      headline: [],
      columnSettings: [],
    }
    expect(draftProblems(draft)).toEqual([
      'Give the report a title',
      'Give the report a link: lower case letters, digits and single hyphens',
      'Write the SQL',
      'Choose who can run it',
      'Charts: each needs a category axis and at least one series',
    ])
  })

  it('stores no charts as null and compares one chart with a list of one', () => {
    const doc = comparable(PUBLISHED)
    expect(doc.chart).toEqual([PUBLISHED.chart])
    expect(toDocument({ ...(comparable(PUBLISHED) as never), charts: [] }).chart).toBeNull()
  })
})

/** The editor fields of the published fixture, as the editor holds them. */
function fromDocFields(): EditorDraft {
  return readDoc(PUBLISHED).draft
}

describe('ReportEditor', () => {
  it('fills the link from the title, and summarises what is missing on save', async () => {
    renderEditor()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Funded loans' } })
    expect(screen.getByLabelText('Link')).toHaveValue('funded-loans')
    fireEvent.click(screen.getByRole('button', { name: 'Save as a draft' }))
    const summary = await screen.findByTestId('editor-problems')
    expect(summary).toHaveTextContent('Write the SQL')
    await waitFor(() => expect(summary).toHaveFocus())
    expect(calls('/api/report-definitions')).toHaveLength(0)
  })

  it('previews the SQL, builds a chart and a headline from its columns, and saves a draft', async () => {
    renderEditor()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Funded loans' } })
    fireEvent.change(screen.getByLabelText('Report SQL'), {
      target: { value: 'SELECT day, count(*) AS applications FROM application GROUP BY 1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run the preview' }))
    expect(await screen.findByTestId('editor-status')).toHaveTextContent(
      'Preview: 2 rows on the defaults.',
    )
    expect(calls('/api/reports/ask')[0].body).toMatchObject({
      mode: 'check',
      question: 'Report editor: Funded loans',
      definition: { slug: 'funded-loans', chart: null },
    })
    expect(screen.getByTestId('report-table')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add a chart' }))
    const chart = screen.getByTestId('chart-0')
    expect(within(chart).getByLabelText('Chart 1')).toHaveValue('line')
    expect(within(chart).getByLabelText('Category or time axis')).toHaveValue('day')
    expect(within(chart).getByLabelText('applications')).toBeChecked()
    expect(screen.getByTestId('report-chart')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add a headline number' }))
    fireEvent.change(screen.getByLabelText('Label', { selector: `[id$="-h0-label"]` }), {
      target: { value: 'Applications' },
    })
    expect(screen.getByTestId('report-headline')).toHaveTextContent('Applications')

    fireEvent.click(screen.getByRole('button', { name: 'Save as a draft' }))
    await waitFor(() =>
      expect(routerReplace).toHaveBeenCalledWith('/admin/reports/funded-loans/edit'),
    )
    const [save] = calls('/api/report-definitions')
    expect(save).toMatchObject({ url: '/api/report-definitions?draft=true', method: 'POST' })
    expect(save.body).toMatchObject({
      _status: 'draft',
      title: 'Funded loans',
      slug: 'funded-loans',
      chart: [{ type: 'line', x: 'day', series: [{ column: 'applications' }] }],
      headline: [{ column: 'applications', label: 'Applications', value: 'total' }],
    })
  })

  it('shows the server’s reason when a save is refused', async () => {
    saveStatus = 400
    renderEditor()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Daily' } })
    fireEvent.change(screen.getByLabelText('Report SQL'), { target: { value: 'SELECT 1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as a draft' }))
    expect(await screen.findByTestId('editor-problems')).toHaveTextContent(
      'slug: Value must be unique',
    )
    expect(routerReplace).not.toHaveBeenCalled()
  })

  it('loads a report, previews it, and publishes after showing what changed', async () => {
    renderEditor('daily')
    expect(await screen.findByLabelText('Title')).toHaveValue('Daily applications')
    expect(screen.getByLabelText('Link')).toBeDisabled()
    await screen.findByText('Preview: 2 rows on the defaults.')
    // The stored chart is shown in the builder.
    expect(within(screen.getByTestId('chart-0')).getByLabelText('Chart 1')).toHaveValue('line')

    // Nothing changed yet: the review says so.
    fireEvent.click(screen.getByRole('button', { name: 'Publish…' }))
    expect(await screen.findByTestId('editor-review')).toHaveTextContent(
      'Nothing has changed since the published version.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Not yet' }))

    fireEvent.change(screen.getByLabelText('Report SQL'), {
      target: { value: PUBLISHED.sql.replace('GROUP BY 1', 'WHERE NOT mock_origin\nGROUP BY 1') },
    })
    fireEvent.click(screen.getByLabelText('Operations'))
    fireEvent.click(screen.getByRole('button', { name: 'Publish…' }))
    const review = await screen.findByTestId('editor-review')
    expect(
      within(review)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['SQL', 'Who can run it'])
    const diff = within(review).getByRole('region', { name: 'SQL changes' })
    expect(diff).toHaveTextContent('Added: WHERE NOT mock_origin')

    fireEvent.click(within(review).getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/admin/reports/daily'))
    const [save] = calls('/api/report-definitions')
    expect(save).toMatchObject({ url: '/api/report-definitions/r9', method: 'PATCH' })
    expect(save.body).toMatchObject({
      _status: 'published',
      roles: ['admin', 'supervisor', 'operations'],
    })
  })

  it('blocks publishing while the checks find an error', async () => {
    checkIssues = [{ level: 'error', code: 'RUN', message: 'column "x" does not exist' }]
    renderEditor('daily')
    await screen.findByText('Preview: 2 rows on the defaults.')
    fireEvent.click(screen.getByRole('button', { name: 'Publish…' }))
    expect(await screen.findByTestId('editor-problems')).toHaveTextContent(
      'column "x" does not exist',
    )
    expect(screen.queryByTestId('editor-review')).toBeNull()
  })

  it('does not show an empty review when the published version cannot be loaded', async () => {
    publishedStatus = 500
    renderEditor('daily')
    await screen.findByText('Preview: 2 rows on the defaults.')
    fireEvent.click(screen.getByRole('button', { name: 'Publish…' }))
    expect(await screen.findByTestId('editor-problems')).toHaveTextContent(
      'The published version could not be loaded to compare.',
    )
    expect(screen.queryByTestId('editor-review')).toBeNull()
  })

  it('closes the review when anything changes after it', async () => {
    renderEditor('daily')
    await screen.findByText('Preview: 2 rows on the defaults.')
    fireEvent.click(screen.getByRole('button', { name: 'Publish…' }))
    await screen.findByTestId('editor-review')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Changed' } })
    expect(screen.queryByTestId('editor-review')).toBeNull()
  })

  it('says which stored settings it could not read', async () => {
    stored = { ...PUBLISHED, headline: [{ nope: true }] }
    renderEditor('daily')
    expect(await screen.findByTestId('editor-unreadable')).toHaveTextContent(
      'The stored headline numbers could not be read',
    )
  })

  it('keeps each parameter\u2019s own options and default when one is removed', async () => {
    renderEditor()
    const addSelect = (label: string, options: string) => {
      fireEvent.click(screen.getByRole('button', { name: 'Add a parameter' }))
      const row = screen.getAllByTestId(/^param-\d+$/).at(-1)!
      fireEvent.change(within(row).getByLabelText('Label'), { target: { value: label } })
      fireEvent.change(within(row).getByLabelText('Type'), { target: { value: 'select' } })
      const box = within(row).getByLabelText(/Options/)
      fireEvent.change(box, { target: { value: options } })
      fireEvent.blur(box)
    }
    addSelect('First', 'a = A')
    addSelect('Second', 'b = B')
    fireEvent.click(screen.getByRole('button', { name: 'Remove First' }))
    const row = screen.getByTestId('param-2')
    expect(within(row).getByLabelText('Label')).toHaveValue('Second')
    expect(within(row).getByLabelText(/Options/)).toHaveValue('b = B')

    // A boolean default is a choice; a number default can be typed through "0.".
    fireEvent.change(within(row).getByLabelText('Type'), { target: { value: 'boolean' } })
    fireEvent.change(within(row).getByLabelText('Default'), { target: { value: 'true' } })
    expect(within(row).getByLabelText('Default')).toHaveValue('true')
    fireEvent.change(within(row).getByLabelText('Type'), { target: { value: 'number' } })
    fireEvent.change(within(row).getByLabelText('Default'), { target: { value: '0.' } })
    expect(within(row).getByLabelText('Default')).toHaveValue('0.')
  })
})
