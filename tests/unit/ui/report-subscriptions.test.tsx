/**
 * Unit tests for "Email me this" and "Alert me" on a report, and the page
 * that lists a person's report emails and alerts. `fetch` is mocked.
 */
import React from 'react'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { SubscribePanel, thresholdValue } from '@/components/ReportsView/SubscribePanel'
import { SubscriptionsPage } from '@/components/ReportsView/SubscriptionsPage'
import type { ReportSpec } from '@/hooks/queries/useReports'
import type { ReportRunResponse } from '@/hooks/queries/useReportRun'
import { RANGE_PRESETS, sydneyToday } from '@/lib/reports/periods'

const SPEC: ReportSpec = {
  title: 'Declines',
  description: null,
  category: 'credit',
  parameters: [
    { name: 'from', label: 'From', type: 'date', required: true, default: 'today-30' },
    { name: 'to', label: 'To', type: 'date', required: true, default: 'today-1' },
    {
      name: 'group_by',
      label: 'Split by',
      type: 'select',
      required: true,
      options: [{ value: 'source', label: 'Source' }],
    },
  ],
  charts: [],
  columns: [],
  headline: [{ column: 'decline_rate', label: 'Decline rate' }],
  featured: false,
  excludesMock: true,
}
const RESULT = {
  report: { slug: 'declines', title: 'Declines', version: 'v1', draft: false },
  columns: [
    { name: 'segment', kind: 'text' },
    { name: 'decided', kind: 'number' },
    { name: 'decline_rate', kind: 'number' },
  ],
  rows: [
    { segment: 'Paid', decided: 60, decline_rate: 0.42 },
    { segment: 'All', decided: 100, decline_rate: 0.35 },
  ],
  rowCount: 2,
  truncated: false,
  durationMs: 5,
} as unknown as ReportRunResponse

const SUBS = [
  {
    id: 's1',
    kind: 'digest',
    slug: 'declines',
    title: 'Declines',
    frequency: 'weekly',
    range: 'last-7',
    rangeLabel: 'Last 7 days',
    channel: 'email',
    parameters: {},
    alert: null,
    lastValue: null,
    alertActive: false,
    paused: false,
    lastSentAt: null,
    lastCheckedAt: null,
    lastError: null,
  },
  {
    id: 's2',
    kind: 'alert',
    slug: 'declines',
    title: 'Declines',
    frequency: null,
    range: 'last-7',
    rangeLabel: 'Last 7 days',
    channel: 'slack',
    parameters: {},
    alert: 'Decline rate (Paid) above 40%',
    lastValue: '42%',
    alertActive: true,
    paused: true,
    lastSentAt: '2026-10-26T21:00:00.000Z',
    lastCheckedAt: null,
    lastError: 'You can no longer run this report.',
  },
]

const fetchMock = vi.fn()
let slack = false
let createStatus = 201
const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body })

beforeEach(() => {
  slack = false
  createStatus = 201
  fetchMock.mockReset().mockImplementation((url: string, init: RequestInit = {}) => {
    if (url === '/api/reports/subscriptions' && (init.method ?? 'GET') === 'GET') {
      return json(200, { subscriptions: SUBS, slack })
    }
    if (url === '/api/reports/subscriptions') {
      return createStatus === 201
        ? json(201, { subscription: SUBS[0] })
        : json(createStatus, {
            error: { code: 'ALREADY_SUBSCRIBED', message: 'You already get this report then.' },
          })
    }
    return json(200, { ok: true })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function wrap(ui: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)
}

const posted = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([, init]) => JSON.parse(init.body as string))

describe('SubscribePanel', () => {
  const values = { from: '2026-10-01', to: '2026-10-21', group_by: 'source' }

  it('sends the report weekly with the settings on screen, the period moving', async () => {
    wrap(<SubscribePanel slug="declines" spec={SPEC} values={values} result={RESULT} />)
    fireEvent.click(screen.getByRole('button', { name: 'Email me this…' }))
    const form = screen.getByTestId('digest-form')
    expect(within(form).getByText(/Split by: Source/)).toBeInTheDocument()
    fireEvent.click(within(form).getByLabelText('Monday mornings'))
    expect(within(form).getByLabelText('Each one covers')).toHaveValue('last-7')
    fireEvent.click(within(form).getByLabelText('On the 1st of each month'))
    expect(within(form).getByLabelText('Each one covers')).toHaveValue('last-month')
    // Slack is offered only when the server says so.
    expect(within(form).queryByText('The Slack channel')).toBeNull()
    fireEvent.click(within(form).getByRole('button', { name: 'Start sending' }))
    expect(await screen.findByTestId('subscribe-status')).toHaveTextContent(
      'Done: on the 1st of each month, by email.',
    )
    expect(posted()[0]).toEqual({
      kind: 'digest',
      slug: 'declines',
      frequency: 'monthly',
      range: 'last-month',
      parameters: { group_by: 'source' },
      channel: 'email',
    })
    expect(screen.getByRole('link', { name: 'Your report emails and alerts' })).toHaveAttribute(
      'href',
      '/admin/reports/subscriptions',
    )
  })

  it('shows why a subscription was refused', async () => {
    createStatus = 409
    wrap(<SubscribePanel slug="declines" spec={SPEC} values={values} result={RESULT} />)
    fireEvent.click(screen.getByRole('button', { name: 'Email me this…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start sending' }))
    expect(await screen.findByTestId('subscribe-error')).toHaveTextContent(
      'You already get this report then.',
    )
  })

  it('creates an alert on a row, in the column’s units, and can go to Slack', async () => {
    slack = true
    // The results on screen cover the last 30 days: the checks will too.
    const last30 = RANGE_PRESETS.find((p) => p.key === 'last-30')!.range(sydneyToday())
    const shown = { ...values, from: last30.from, to: last30.to }
    wrap(<SubscribePanel slug="declines" spec={SPEC} values={shown} result={RESULT} />)
    fireEvent.click(screen.getByRole('button', { name: 'Alert me…' }))
    const form = screen.getByTestId('alert-form')
    // The headline's column first.
    expect(within(form).getByLabelText('Watch')).toHaveValue('decline_rate')
    expect(within(form).getByLabelText('Each check covers')).toHaveValue('last-30')
    expect(within(form).getByText(/It is 35% now/)).toBeInTheDocument()
    fireEvent.change(within(form).getByLabelText('For'), { target: { value: 'Paid' } })
    expect(within(form).getByText(/It is 42% now/)).toBeInTheDocument()
    fireEvent.click(within(form).getByRole('button', { name: 'Create the alert' }))
    expect(within(form).getByText('Enter the threshold as a number')).toBeInTheDocument()
    fireEvent.change(within(form).getByLabelText('Threshold (%)'), { target: { value: '40' } })
    await within(form).findByText('The Slack channel')
    fireEvent.click(within(form).getByLabelText('The Slack channel'))
    fireEvent.click(within(form).getByRole('button', { name: 'Create the alert' }))
    await waitFor(() => expect(posted()).toHaveLength(1))
    expect(posted()[0]).toEqual({
      kind: 'alert',
      slug: 'declines',
      range: 'last-30',
      parameters: { group_by: 'source' },
      channel: 'slack',
      alert: { column: 'decline_rate', row: 'Paid', operator: 'above', threshold: 0.4 },
    })
  })

  it('does not quote the number on screen for a different period', () => {
    wrap(<SubscribePanel slug="declines" spec={SPEC} values={values} result={RESULT} />)
    fireEvent.click(screen.getByRole('button', { name: 'Alert me…' }))
    const form = screen.getByTestId('alert-form')
    // 1 to 21 October is not a preset: checks default to the last 7 days.
    expect(within(form).getByLabelText('Each check covers')).toHaveValue('last-7')
    expect(form).toHaveTextContent('The results on screen cover another period')
    expect(form).not.toHaveTextContent(/It is .* now/)
  })

  it('offers an alert only once there are results to watch', () => {
    wrap(<SubscribePanel slug="declines" spec={SPEC} values={values} result={undefined} />)
    expect(screen.getByRole('button', { name: 'Alert me…' })).toBeDisabled()
  })

  it('reads a threshold as typed', () => {
    const percent = { name: 'r', label: 'R', format: 'percent' } as never
    expect(thresholdValue('12.5%', percent)).toBe(0.125)
    expect(thresholdValue('$1,200', undefined)).toBe(1200)
    expect(thresholdValue('lots', undefined)).toBeNull()
  })
})

describe('SubscriptionsPage', () => {
  it('lists each with when and how it sends, and how it went last time', async () => {
    wrap(<SubscriptionsPage />)
    const digest = await screen.findByTestId('subscription-s1')
    expect(digest).toHaveTextContent('Monday mornings, by email, covering last 7 days')
    expect(digest).toHaveTextContent('Not sent yet')
    const alert = screen.getByTestId('subscription-s2')
    expect(alert).toHaveTextContent('Alert to the Slack channel when Decline rate (Paid) above 40%')
    expect(alert).toHaveTextContent('last check 42%, over the line')
    expect(alert).toHaveTextContent('Paused')
    expect(alert).toHaveTextContent('Last time: You can no longer run this report.')
  })

  it('pauses, resumes and removes', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    wrap(<SubscriptionsPage />)
    const digest = await screen.findByTestId('subscription-s1')
    fireEvent.click(within(digest).getByRole('button', { name: 'Pause Declines' }))
    await screen.findByText('Declines: paused.')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/reports/subscriptions/s1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ paused: true }) }),
    )
    fireEvent.click(
      within(screen.getByTestId('subscription-s2')).getByRole('button', {
        name: 'Resume Declines',
      }),
    )
    await screen.findByText('Declines: resumed.')
    fireEvent.click(within(digest).getByRole('button', { name: 'Remove Declines' }))
    await screen.findByText('Declines: removed.')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/reports/subscriptions/s1',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
