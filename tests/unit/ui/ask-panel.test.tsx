/**
 * Unit tests for the Ask Claude panel (BTB-508): asking, showing the draft,
 * assumptions, warnings and errors, editing and re-checking SQL, refining,
 * and saving. `fetch` is mocked; the chart is stubbed.
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

const DEFINITION = {
  title: 'Decisions by outcome',
  description: 'Decisions since a date.',
  sql: 'SELECT decision, count(*) AS decided FROM decision WHERE decided_on >= $1::date AND NOT mock_origin GROUP BY 1',
  parameters: [{ name: 'from', label: 'From', type: 'date', required: true, default: 'today-30' }],
  chart: { type: 'bar', x: 'decision', series: [{ column: 'decided' }] },
}
const OK = {
  status: 'ok',
  definition: DEFINITION,
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

const fetchMock = vi.fn()
const respond = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body })
const bodies = () => fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(init.body)])

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AskPanel />
    </QueryClientProvider>,
  )
}

async function askQuestion() {
  fireEvent.change(screen.getByLabelText('Question'), {
    target: { value: 'Decisions by outcome?' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Draft the report' }))
  await screen.findByText('Decisions by outcome')
}

beforeEach(() => {
  fetchMock.mockReset().mockImplementation(() => respond(200, OK))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('AskPanel', () => {
  it('asks for a question before calling Claude', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Draft the report' }))
    const summary = await screen.findByTestId('ask-error-summary')
    expect(summary).toHaveTextContent('Enter a question')
    await waitFor(() => expect(summary).toHaveFocus())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the draft, its assumptions, warnings and preview', async () => {
    renderPanel()
    await askQuestion()
    expect(bodies()[0]).toEqual([
      '/api/reports/ask',
      { mode: 'ask', question: 'Decisions by outcome?' },
    ])
    expect(screen.getByText('Counts each application once')).toBeInTheDocument()
    expect(screen.getByTestId('ask-warnings')).toHaveTextContent('Give x a default')
    expect(screen.getByLabelText('SQL')).toHaveValue(DEFINITION.sql)
    expect(screen.getByTestId('report-chart')).toBeInTheDocument()
    expect(within(screen.getByTestId('report-table')).getByText('12')).toBeInTheDocument()
    expect(screen.getByTestId('ask-status')).toHaveTextContent('Draft ready: 1 row')
  })

  it('makes the author re-check edited SQL before saving', async () => {
    renderPanel()
    await askQuestion()
    const save = screen.getByRole('button', { name: 'Save as a draft report' })
    expect(save).not.toHaveAttribute('aria-disabled', 'true')
    fireEvent.change(screen.getByLabelText('SQL'), {
      target: { value: `${DEFINITION.sql} LIMIT 5` },
    })
    expect(save).toHaveAttribute('aria-disabled', 'true')
    expect(save).toHaveAccessibleDescription('Check the edited SQL before saving.')
    fireEvent.click(save)
    expect(bodies()).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Check the edited SQL' }))
    await waitFor(() => expect(bodies()).toHaveLength(2))
    expect(bodies()[1][1]).toMatchObject({
      mode: 'check',
      definition: { sql: `${DEFINITION.sql} LIMIT 5` },
    })
  })

  it('shows check errors in the summary and blocks saving', async () => {
    fetchMock.mockImplementationOnce(() =>
      respond(200, {
        ...OK,
        issues: [{ level: 'error', code: 'RUN', message: 'The query is not valid.' }],
        preview: undefined,
      }),
    )
    renderPanel()
    await askQuestion()
    const summary = screen.getByTestId('ask-error-summary')
    expect(within(summary).getByRole('link', { name: 'The query is not valid.' })).toHaveAttribute(
      'href',
      `#${screen.getByLabelText('SQL').id}`,
    )
    expect(screen.getByRole('button', { name: 'Save as a draft report' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('refines with the current draft and its problems', async () => {
    renderPanel()
    await askQuestion()
    fireEvent.change(screen.getByLabelText('Change something'), {
      target: { value: 'Weekly instead' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask Claude to change it' }))
    await waitFor(() => expect(bodies()).toHaveLength(2))
    expect(bodies()[1][1]).toMatchObject({
      mode: 'refine',
      refinement: 'Weekly instead',
      definition: { title: 'Decisions by outcome' },
      issues: [{ code: 'NO_DEFAULT', message: 'Give x a default' }],
    })
  })

  it('links an empty question to its field', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Draft the report' }))
    const summary = await screen.findByTestId('ask-error-summary')
    const question = screen.getByLabelText('Question')
    expect(within(summary).getByRole('link', { name: 'Enter a question' })).toHaveAttribute(
      'href',
      `#${question.id}`,
    )
    expect(question).toHaveAttribute('aria-invalid', 'true')
    expect(bodies()).toHaveLength(0)
  })

  it('keeps the refinement and blocks saving when a refinement is refused', async () => {
    renderPanel()
    await askQuestion()
    fetchMock.mockImplementationOnce(() =>
      respond(200, { status: 'refused', message: 'Claude declined.', assumptions: [], issues: [] }),
    )
    fireEvent.change(screen.getByLabelText('Change something'), { target: { value: 'Weekly' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask Claude to change it' }))
    expect(await screen.findByTestId('ask-error-summary')).toHaveTextContent('Claude declined.')
    expect(screen.getByRole('button', { name: 'Save as a draft report' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('says when the data cannot answer the question', async () => {
    fetchMock.mockImplementationOnce(() =>
      respond(200, {
        status: 'unanswerable',
        notAnswerableReason: 'No ad spend',
        assumptions: [],
        issues: [],
      }),
    )
    renderPanel()
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Cost per customer?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Draft the report' }))
    expect(await screen.findByTestId('ask-error-summary')).toHaveTextContent(
      'The reporting data cannot answer this question: No ad spend',
    )
  })

  it('saves the draft and links to it', async () => {
    renderPanel()
    await askQuestion()
    fetchMock.mockImplementationOnce(() =>
      respond(200, { ok: true, id: 'r9', slug: 'decisions-by-outcome' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save as a draft report' }))
    const saved = await screen.findByTestId('ask-saved')
    expect(within(saved).getByRole('link', { name: 'Open the draft' })).toHaveAttribute(
      'href',
      '/admin/reports/decisions-by-outcome',
    )
    expect(bodies()[1]).toEqual(['/api/reports/ask/save', { definition: DEFINITION }])
    // A second click does not save a duplicate.
    fireEvent.click(screen.getByRole('button', { name: 'Save as a draft report' }))
    expect(bodies()).toHaveLength(2)
  })
})
