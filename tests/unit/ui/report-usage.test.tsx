/**
 * Unit tests for the Reports usage page: authors only, and the figures read
 * as people, runs, seconds and shares. `fetch` is mocked.
 */
import React from 'react'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { UsagePage } from '@/components/ReportsView/UsagePage'

const USAGE = {
  days: 30,
  weeks: [{ week: '2026-10-19', viewers: 4, runs: 10, runsPerViewer: 2.5 }],
  reports: [
    {
      slug: 'daily',
      title: 'Daily applications',
      views: 10,
      viewers: 4,
      csv: 2,
      csvPerView: 0.2,
      subscribers: 3,
      lastViewed: '2026-10-22T01:00:00.000Z',
    },
    {
      slug: 'old',
      title: 'Old report',
      views: 0,
      viewers: 0,
      csv: 0,
      csvPerView: null,
      subscribers: 0,
      lastViewed: null,
    },
  ],
  unopened: [{ slug: 'old', title: 'Old report' }],
  ask: {
    asks: 12,
    refines: 5,
    answered: 10,
    cancelled: 1,
    saves: 4,
    saveRate: 0.4,
    firstOutputP50: 1800,
    firstOutputP95: 4200,
    totalP50: 31_000,
    totalP95: 64_000,
  },
  searches: { total: 20, unanswered: 3, top: [{ query: 'churn', searches: 3 }] },
}

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => USAGE })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)

describe('UsagePage', () => {
  it('is for report authors', () => {
    wrap(<UsagePage canAuthor={false} />)
    expect(screen.getByTestId('usage-denied')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows people each week, Ask Claude, each report, the unopened and unanswered searches', async () => {
    wrap(<UsagePage canAuthor />)
    const weeks = await screen.findByTestId('usage-weeks')
    expect(within(weeks).getAllByRole('row')[1]).toHaveTextContent(/19 Oct.*4.*10.*2\.5/)
    const ask = screen.getByTestId('usage-ask')
    expect(ask).toHaveTextContent('1.8 s')
    expect(ask).toHaveTextContent('95% within 4.2 s')
    expect(ask).toHaveTextContent('4 of 10 answered; 1 cancelled')
    const reports = screen.getByTestId('usage-reports')
    expect(within(reports).getAllByRole('row')).toHaveLength(2)
    expect(within(reports).getByRole('link', { name: 'Daily applications' })).toBeInTheDocument()
    expect(screen.getByTestId('usage-unopened')).toHaveTextContent('Old report')
    expect(screen.getByTestId('usage-searches')).toHaveTextContent('churn')
  })
})
