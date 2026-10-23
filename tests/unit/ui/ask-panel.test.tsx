/**
 * Unit tests for the Ask Claude panel (BTB-508): an existing report offered
 * first, the streamed plan and stages while Claude works, cancelling, the
 * preview presented as the report will be, assumptions and quick changes,
 * the SQL behind a disclosure, publishing and saving, staff who are not
 * authors, a draft kept for the session, and changing an existing report.
 * `fetch` is mocked; the chart is stubbed.
 */
import React from 'react'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/components/ReportsView/ReportChart', () => ({
  ReportChart: () => <div data-testid="report-chart" />,
}))
vi.mock('@/lib/reports/events', () => ({ logReportEvent: vi.fn() }))

import { AskPanel } from '@/components/ReportsView/AskPanel'
import { parseEvents } from '@/hooks/mutations/useAskClaude'

const DEFINITION = {
  title: 'Decisions by outcome',
  description: 'Decisions since a date.',
  sql: 'SELECT decision, count(*) AS decided FROM decision WHERE decided_on >= $1::date AND NOT mock_origin GROUP BY 1',
  parameters: [{ name: 'from', label: 'From', type: 'date', required: true, default: 'today-30' }],
  chart: [{ type: 'bar', x: 'decision', series: [{ column: 'decided' }] }],
  headline: [{ column: 'decided', label: 'Decisions', value: 'sum' }],
  columnSettings: [],
  category: 'credit',
}
const OK = {
  status: 'ok',
  definition: DEFINITION,
  plan: ['Count decisions since the date', 'Split by outcome'],
  assumptions: ['Counts each application once'],
  issues: [{ level: 'warning', code: 'NO_DEFAULT', message: 'Give x a default' }],
  preview: {
    columns: [
      { name: 'decision', kind: 'text' },
      { name: 'decided', kind: 'number' },
    ],
    rows: [{ decision: 'APPROVED', decided: 12 }],
    rowCount: 1,
    truncated: false,
    durationMs: 30,
  },
}

type Route = (url: string, body: Record<string, unknown> | null, init: RequestInit) => unknown

let matches: unknown[] = []
let streamed: unknown = OK
let hold: Promise<void> | null = null
const fetchMock = vi.fn()

/** A streamed answer: stages and the plan, then the result. */
function sse(result: unknown, signal?: AbortSignal | null) {
  const events = [
    ['stage', { type: 'stage', stage: 'planning', atMs: 0 }],
    [
      'partial',
      {
        type: 'partial',
        draft: {
          title: 'Decisions by outcome',
          plan: ['Count decisions since the date'],
          assumptions: [],
          writingSql: false,
        },
      },
    ],
    ['stage', { type: 'stage', stage: 'writing_sql', atMs: 900 }],
    ['result', result],
  ]
  const text = events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('')
  const encoded = new TextEncoder().encode(text)
  let sent = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          // Hand over the first half, then (optionally) wait before the rest.
          if (sent === 0) {
            sent = 1
            return { value: encoded.slice(0, encoded.length / 2), done: false }
          }
          if (hold) {
            await Promise.race([
              hold,
              new Promise((_, reject) =>
                signal?.addEventListener('abort', () =>
                  reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
                ),
              ),
            ])
          }
          if (sent === 1) {
            sent = 2
            return { value: encoded.slice(encoded.length / 2), done: false }
          }
          return { value: undefined, done: true }
        },
      }),
    },
  }
}

const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body })

const routes: Route = (url, body, init) => {
  if (url.startsWith('/api/reports/ask/match')) return json(200, { matches })
  if (url.startsWith('/api/reports/ask/recent')) return json(200, { recent: [] })
  if (url === '/api/reports/ask/save') {
    return json(200, {
      ok: true,
      id: 'r1',
      slug: 'decisions-by-outcome',
      published: !!body?.publish,
    })
  }
  if (url.startsWith('/api/reports/decline-rate/definition')) {
    return json(200, {
      ...DEFINITION,
      id: 'r9',
      slug: 'decline-rate',
      status: 'published',
      roles: ['admin', 'supervisor', 'operations'],
      featured: false,
      schedule: 'none',
    })
  }
  if (url === '/api/reports/ask') {
    if (body?.stream)
      return Promise.resolve(sse({ ...(streamed as object), askId: 'ask-1' }, init.signal))
    return json(200, { ...OK, askId: 'ask-2' })
  }
  return json(404, {})
}

const posts = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([url, init]) => [url, JSON.parse(init.body)] as [string, Record<string, unknown>])

function renderPanel(props: React.ComponentProps<typeof AskPanel> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AskPanel {...props} />
    </QueryClientProvider>,
  )
}

async function askQuestion(text = 'Decisions by outcome?') {
  fireEvent.change(screen.getByLabelText('Question'), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Draft the report' }))
  await screen.findByTestId('report-table')
}

beforeEach(() => {
  matches = []
  streamed = OK
  hold = null
  window.sessionStorage.clear()
  fetchMock
    .mockReset()
    .mockImplementation((url: string, init: RequestInit = {}) =>
      routes(url, init.body ? JSON.parse(String(init.body)) : null, init),
    )
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('AskPanel', () => {
  it('asks for a question before calling Claude, and offers examples', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Draft the report' }))
    const summary = await screen.findByTestId('ask-error-summary')
    expect(summary).toHaveTextContent('Enter a question')
    await waitFor(() => expect(summary).toHaveFocus())
    expect(posts()).toHaveLength(0)
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Example questions' })).getAllByRole('button')[0],
    )
    expect(screen.getByLabelText('Question')).toHaveValue(
      'Approval rate by acquisition source for each week of the last quarter',
    )
  })

  it('offers a report that already answers the question before asking Claude', async () => {
    matches = [
      {
        slug: 'decline-rate',
        title: 'Decline rate and reasons',
        description: 'Decisions by source. More.',
        parameters: { group_by: 'ruleset' },
      },
    ]
    renderPanel()
    fireEvent.change(screen.getByLabelText('Question'), {
      target: { value: 'decline rate by ruleset' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Draft the report' }))
    const card = await screen.findByTestId('ask-matches')
    expect(
      within(card).getByRole('link', { name: 'Open Decline rate and reasons' }),
    ).toHaveAttribute('href', '/admin/reports/decline-rate?group_by=ruleset')
    expect(posts()).toHaveLength(0)
    fireEvent.click(within(card).getByRole('button', { name: 'Draft a new one anyway' }))
    await screen.findByTestId('report-table')
    expect(posts()[0]).toEqual([
      '/api/reports/ask',
      { mode: 'ask', question: 'decline rate by ruleset', stream: true },
    ])
  })

  it('shows the plan and stages while Claude works, and can be cancelled', async () => {
    let release: () => void = () => undefined
    hold = new Promise((r) => (release = r))
    renderPanel()
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'q' } })
    fireEvent.click(screen.getByRole('button', { name: 'Draft the report' }))
    const progress = await screen.findByTestId('ask-progress')
    expect(await within(progress).findByText('Count decisions since the date')).toBeInTheDocument()
    expect(within(progress).getByText('Writing the SQL')).toBeInTheDocument()
    expect(within(progress).getByText(/0:0\d/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByTestId('ask-progress')).toBeNull())
    expect(screen.queryByTestId('ask-error-summary')).toBeNull()
    release()
  })

  it('leads with the preview as the report will look, then assumptions and changes', async () => {
    renderPanel()
    await askQuestion()
    expect(screen.getByTestId('report-headline')).toHaveTextContent('Decisions12')
    expect(screen.getByText('Split by outcome')).toBeInTheDocument()
    expect(screen.getByTestId('report-chart')).toBeInTheDocument()
    expect(screen.getByTestId('ask-warnings')).toHaveTextContent('Give x a default')
    expect(screen.getByTestId('ask-status')).toHaveTextContent('Draft ready: 1 row')

    fireEvent.click(screen.getByRole('button', { name: 'Counts each application once' }))
    expect(screen.getByLabelText('Change something')).toHaveValue(
      'Instead of "Counts each application once": ',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Make it monthly' }))
    await waitFor(() => expect(posts()).toHaveLength(2))
    expect(posts()[1][1]).toMatchObject({
      mode: 'refine',
      refinement: 'Make it monthly',
      definition: { sql: DEFINITION.sql },
      askId: 'ask-1',
      stream: true,
    })
  })

  it('keeps the SQL behind a disclosure, and makes an author re-check it after editing', async () => {
    renderPanel()
    await askQuestion()
    const details = screen.getByText('Show the SQL').closest('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    const save = screen.getByRole('button', { name: 'Save as a draft' })
    fireEvent.change(within(details).getByLabelText('SQL'), {
      target: { value: `${DEFINITION.sql} LIMIT 5` },
    })
    expect(save).toHaveAttribute('aria-disabled', 'true')
    expect(save).toHaveAccessibleDescription('Check the edited SQL before saving.')
    fireEvent.click(within(details).getByRole('button', { name: 'Check the edited SQL' }))
    await waitFor(() => expect(posts()).toHaveLength(2))
    expect(posts()[1][1]).toMatchObject({
      mode: 'check',
      definition: { sql: `${DEFINITION.sql} LIMIT 5` },
    })
  })

  it('publishes to the chosen area and roles after a confirmation, or saves a draft', async () => {
    renderPanel()
    await askQuestion()
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish…' }))
    const box = screen.getByTestId('ask-publish')
    expect(within(box).getByLabelText('Area')).toHaveValue('credit')
    fireEvent.click(within(box).getByLabelText('Operations'))
    fireEvent.click(within(box).getByRole('button', { name: 'Publish' }))
    expect(await screen.findByTestId('ask-saved')).toHaveTextContent('Published.')
    expect(posts().at(-1)).toEqual([
      '/api/reports/ask/save',
      {
        definition: DEFINITION,
        publish: true,
        roles: ['admin', 'supervisor', 'operations'],
        category: 'credit',
      },
    ])
  })

  it('updates the report it saved, rather than making another, after a further change', async () => {
    renderPanel()
    await askQuestion()
    fireEvent.click(screen.getByRole('button', { name: 'Save as a draft' }))
    await screen.findByTestId('ask-saved')
    fireEvent.click(screen.getByRole('button', { name: 'Make it monthly' }))
    await waitFor(() => expect(screen.queryByTestId('ask-saved')).toBeNull())
    await screen.findByRole('button', { name: 'Save as a draft' })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save as a draft' })).not.toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save as a draft' }))
    await screen.findByTestId('ask-saved')
    const saves = posts().filter(([url]) => url === '/api/reports/ask/save')
    expect(saves[0][1].reportId).toBeUndefined()
    expect(saves[1][1].reportId).toBe('r1')
  })

  it('lets staff who are not authors ask, marked not reviewed, with no SQL or saving', async () => {
    renderPanel({ canAuthor: false })
    await askQuestion()
    expect(screen.getByTestId('ask-not-reviewed')).toHaveTextContent('Not reviewed')
    expect(screen.queryByText('Show the SQL')).toBeNull()
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull()
    expect(screen.getByText(/Only report authors/)).toBeInTheDocument()
  })

  it('says when the data cannot answer the question, and shows API failures', async () => {
    streamed = {
      status: 'unanswerable',
      notAnswerableReason: 'No ad spend',
      plan: [],
      assumptions: [],
      issues: [],
    }
    renderPanel()
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'cost per customer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Draft the report' }))
    expect(await screen.findByTestId('ask-error-summary')).toHaveTextContent(
      'The reporting data cannot answer this question: No ad spend',
    )
  })

  it('keeps the draft for the session, and brings it back with a fresh preview', async () => {
    const first = renderPanel()
    await askQuestion()
    first.unmount()
    fetchMock.mockClear()
    renderPanel()
    expect(await screen.findByText(/Your draft from earlier is back/)).toBeInTheDocument()
    expect(posts()[0][1]).toMatchObject({ mode: 'check', question: 'Decisions by outcome?' })
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
    expect(window.sessionStorage.getItem('billie-ask-draft')).toBeNull()
  })

  it('changes an existing report in place', async () => {
    renderPanel({ fromSlug: 'decline-rate' })
    expect(
      await screen.findByRole('heading', { name: 'Change "Decisions by outcome" with Claude' }),
    ).toBeInTheDocument()
    await screen.findByTestId('report-table')
    fireEvent.click(screen.getByRole('button', { name: 'Save as a draft of the report' }))
    await screen.findByTestId('ask-saved')
    expect(posts().at(-1)?.[1]).toMatchObject({ reportId: 'r9', publish: false })
  })
})

describe('parseEvents', () => {
  it('splits server-sent events, skips comments and keeps an unfinished event', () => {
    const { events, rest } = parseEvents(
      ': keep-alive\n\nevent: stage\ndata: {"a":1}\n\nevent: result\ndata: {"b"',
    )
    expect(events).toEqual([{ event: 'stage', data: '{"a":1}' }])
    expect(rest).toBe('event: result\ndata: {"b"')
  })
})
