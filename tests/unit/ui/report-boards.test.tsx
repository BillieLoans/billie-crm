/**
 * Unit tests for boards: the list and a new board, a board's tiles on one
 * shared period (each run marked as a board run and linking to the report on
 * the same period), changing and deleting a board, and "Add to board" on a
 * report. `fetch` is mocked; the chart is stubbed.
 */
import React from 'react'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  usePathname: () => '/admin/reports/boards/weekly',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/ReportsView/ReportChart', () => ({
  ReportChart: () => <div data-testid="report-chart" />,
}))
vi.mock('@/lib/reports/events', () => ({ logReportEvent: vi.fn() }))

import { BoardsPage } from '@/components/ReportsView/BoardsPage'
import { BoardView, tileHref } from '@/components/ReportsView/BoardView'
import { AddToBoard } from '@/components/ReportsView/AddToBoard'
import { RANGE_PRESETS, sydneyToday } from '@/lib/reports/periods'

const DAILY = {
  id: 'r1',
  slug: 'daily',
  title: 'Daily applications',
  description: null,
  published: true,
  category: 'acquisition',
  featured: false,
  excludesMock: true,
  parameters: [
    { name: 'from', label: 'From', type: 'date', required: true, default: 'today-30' },
    { name: 'to', label: 'To', type: 'date', required: true, default: 'today-1' },
    { name: 'source', label: 'Source', type: 'text', required: false },
  ],
  charts: [{ type: 'line', x: 'day', series: [{ column: 'applications' }] }],
  columns: [],
  headline: [{ column: 'applications', label: 'Applications', value: 'sum' }],
}
const STATIC = { ...DAILY, id: 'r2', slug: 'static', title: 'Static', parameters: [], charts: [] }
const BOARD = {
  id: 'b1',
  slug: 'weekly',
  title: 'Weekly review',
  description: 'For Monday',
  hiddenTiles: 0,
  canEdit: true,
  version: '2026-10-23T01:00:00.000Z',
  tiles: [
    { id: 't1', show: 'both', parameters: { source: 'paid' }, report: DAILY },
    { id: 't2', show: 'headline', parameters: {}, report: STATIC },
  ],
}
const RESULT = {
  report: { slug: 'daily', title: 'Daily applications', version: 'v1', draft: false },
  columns: [
    { name: 'day', kind: 'date' },
    { name: 'applications', kind: 'number' },
  ],
  rows: [
    { day: '2026-10-20', applications: 3 },
    { day: '2026-10-21', applications: 4 },
  ],
  rowCount: 2,
  truncated: false,
  durationMs: 1,
}

const fetchMock = vi.fn()
const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body })
let board: unknown = BOARD
let patchStatus = 200
let boardStatus = 200
let tileFailures = 0

beforeEach(() => {
  board = BOARD
  patchStatus = 200
  boardStatus = 200
  tileFailures = 0
  routerPush.mockReset()
  fetchMock.mockReset().mockImplementation((url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    if (url === '/api/reports/boards' && method === 'GET') {
      return json(200, {
        boards: [{ slug: 'weekly', title: 'Weekly review', description: null, tiles: 2 }],
      })
    }
    if (url === '/api/reports/boards' && method === 'POST') {
      return json(201, {
        board: { slug: 'new-one', title: 'New one', description: null, tiles: 0 },
      })
    }
    if (url === '/api/reports/boards/weekly' && method === 'GET') {
      if (boardStatus !== 200) {
        return json(boardStatus, { error: { code: 'BOARD_FAILED', message: 'x' } })
      }
      return board
        ? json(200, { board })
        : json(404, { error: { code: 'NOT_FOUND', message: 'No' } })
    }
    if (url === '/api/reports/boards/weekly' && method === 'PATCH') {
      return patchStatus === 200
        ? json(200, { board })
        : json(409, {
            error: { code: 'BOARD_CHANGED', message: 'Someone else changed this board.' },
          })
    }
    if (url === '/api/reports/boards/weekly' && method === 'DELETE') return json(200, { ok: true })
    if (url.endsWith('/tiles')) {
      if (tileFailures > 0) {
        tileFailures--
        return json(500, {
          error: { code: 'BOARD_FAILED', message: 'That did not work. Try again.' },
        })
      }
      const slug = url.split('/')[4]
      return json(201, {
        board: { ...BOARD, slug, title: slug === 'new-one' ? 'New one' : 'Weekly review' },
      })
    }
    if (url.startsWith('/api/reports/')) return json(200, RESULT)
    return json(404, {})
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function wrap(ui: React.ReactElement) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  )
}

const runs = () =>
  fetchMock.mock.calls
    .filter(
      ([url, init]) => /^\/api\/reports\/(daily|static)$/.test(url) && init?.method === 'POST',
    )
    .map(([url, init]) => ({ url, body: JSON.parse(init.body as string) }))

describe('BoardsPage', () => {
  it('lists the boards, and authors start one', async () => {
    wrap(<BoardsPage canAuthor />)
    expect(await screen.findByRole('link', { name: 'Weekly review' })).toHaveAttribute(
      'href',
      '/admin/reports/boards/weekly',
    )
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New one' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create the board' }))
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/admin/reports/boards/new-one'))
  })

  it('offers no new board to staff who are not authors', async () => {
    wrap(<BoardsPage canAuthor={false} />)
    await screen.findByRole('link', { name: 'Weekly review' })
    expect(screen.queryByTestId('new-board')).toBeNull()
  })
})

describe('BoardView', () => {
  it('runs every tile on the board’s period as a board run, and links to each report', async () => {
    wrap(<BoardView slug="weekly" />)
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Weekly review')
    await waitFor(() => expect(runs()).toHaveLength(2))
    const last30 = RANGE_PRESETS.find((p) => p.key === 'last-30')!.range(sydneyToday())
    const daily = runs().find((r) => r.url === '/api/reports/daily')!
    expect(daily.body).toEqual({
      parameters: { source: 'paid', from: last30.from, to: last30.to },
      draft: false,
      compare: false,
      trigger: 'board',
    })
    const tile = await screen.findByTestId('tile-t1')
    expect(within(tile).getByRole('link', { name: 'Daily applications' })).toHaveAttribute(
      'href',
      `/admin/reports/daily?source=paid&from=${last30.from}&to=${last30.to}`,
    )
    // A report with no period says so; a headline-only tile has no chart.
    const staticTile = screen.getByTestId('tile-t2')
    expect(staticTile).toHaveTextContent('This report has no period of its own')
    await within(tile).findByTestId('report-chart')
    expect(within(staticTile).queryByTestId('report-chart')).toBeNull()

    fireEvent.change(screen.getByLabelText('Period for every report'), {
      target: { value: 'last-7' },
    })
    fireEvent.click(screen.getByLabelText('Compare with the previous period'))
    const last7 = RANGE_PRESETS.find((p) => p.key === 'last-7')!.range(sydneyToday())
    await waitFor(() =>
      expect(runs().some((r) => r.body.parameters.from === last7.from && r.body.compare)).toBe(
        true,
      ),
    )
  })

  it('lets authors reorder, change and delete a board', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    wrap(<BoardView slug="weekly" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Change this board' }))
    const editor = screen.getByTestId('board-editor')
    fireEvent.click(
      within(screen.getByTestId('edit-tile-1')).getByRole('button', { name: 'Move up' }),
    )
    fireEvent.change(within(editor).getByLabelText('Show for Daily applications'), {
      target: { value: 'chart' },
    })
    fireEvent.click(within(editor).getByRole('button', { name: 'Save the board' }))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true),
    )
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!
    expect(JSON.parse(patch[1].body as string)).toEqual({
      title: 'Weekly review',
      description: 'For Monday',
      tiles: [
        { id: 't2', report: 'static', parameters: {}, show: 'headline' },
        { id: 't1', report: 'daily', parameters: { source: 'paid' }, show: 'chart' },
      ],
      version: '2026-10-23T01:00:00.000Z',
    })
    await waitFor(() => expect(screen.queryByTestId('board-editor')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Delete board' }))
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/admin/reports/boards'))
  })

  it('offers a reload when someone else changed the board meanwhile', async () => {
    patchStatus = 409
    wrap(<BoardView slug="weekly" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Change this board' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save the board' }))
    expect(await screen.findByText('Someone else changed this board.')).toBeInTheDocument()
    const gets = () =>
      fetchMock.mock.calls.filter(
        ([url, init]) => url === '/api/reports/boards/weekly' && (init?.method ?? 'GET') === 'GET',
      ).length
    const before = gets()
    fireEvent.click(screen.getByRole('button', { name: 'Reload the board' }))
    await waitFor(() => expect(gets()).toBe(before + 1))
  })

  it('shows a table-only report as a pointer to it, never a table in a tile', async () => {
    board = {
      ...BOARD,
      tiles: [
        {
          id: 't3',
          show: 'chart',
          parameters: {},
          report: { ...STATIC, headline: [], charts: [] },
        },
      ],
    }
    wrap(<BoardView slug="weekly" />)
    const tile = await screen.findByTestId('tile-t3')
    expect(await within(tile).findByText(/This report is a table/)).toBeInTheDocument()
    expect(within(tile).queryByTestId('report-table')).toBeNull()
  })

  it('tells a failure to load apart from a missing board', async () => {
    boardStatus = 500
    wrap(<BoardView slug="weekly" />)
    expect(await screen.findByTestId('board-error')).toHaveTextContent(
      'The board could not be loaded.',
    )
  })

  it('says when there is no board to show', async () => {
    board = null
    wrap(<BoardView slug="weekly" />)
    expect(await screen.findByTestId('board-not-found')).toHaveTextContent('Board not found')
  })

  it('builds a tile’s link with the comparison only when the report has a period', () => {
    const tile = BOARD.tiles[1] as never
    expect(tileHref(tile, 'last-7', true)).toBe('/admin/reports/static')
  })
})

describe('AddToBoard', () => {
  it('reuses the board it just made when the add is tried again', async () => {
    tileFailures = 1
    wrap(<AddToBoard slug="daily" parameters={{}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to board…' }))
    const form = await screen.findByTestId('add-to-board')
    await waitFor(() => expect(within(form).getByLabelText('Board')).toHaveValue('weekly'))
    fireEvent.change(within(form).getByLabelText('Board'), { target: { value: '__new__' } })
    fireEvent.change(within(form).getByLabelText("New board's title"), {
      target: { value: 'New one' },
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Add it' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('That did not work')
    fireEvent.click(within(form).getByRole('button', { name: 'Add it' }))
    expect(await screen.findByRole('link', { name: 'New one' })).toBeInTheDocument()
    const creates = fetchMock.mock.calls.filter(
      ([url, init]) => url === '/api/reports/boards' && init?.method === 'POST',
    )
    expect(creates).toHaveLength(1)
  })

  it('adds the report to a board, or to a new one', async () => {
    wrap(<AddToBoard slug="daily" parameters={{ source: 'paid', from: '2026-01-01' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to board…' }))
    const form = await screen.findByTestId('add-to-board')
    await waitFor(() => expect(within(form).getByLabelText('Board')).toHaveValue('weekly'))
    fireEvent.click(within(form).getByRole('button', { name: 'Add it' }))
    expect(await screen.findByRole('link', { name: 'Weekly review' })).toHaveAttribute(
      'href',
      '/admin/reports/boards/weekly',
    )
    const tilePost = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/tiles'))!
    expect(tilePost[0]).toBe('/api/reports/boards/weekly/tiles')
    expect(JSON.parse(tilePost[1].body as string)).toEqual({
      report: 'daily',
      parameters: { source: 'paid', from: '2026-01-01' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add to board…' }))
    const again = await screen.findByTestId('add-to-board')
    fireEvent.change(within(again).getByLabelText('Board'), { target: { value: '__new__' } })
    fireEvent.change(within(again).getByLabelText("New board's title"), {
      target: { value: 'New one' },
    })
    fireEvent.click(within(again).getByRole('button', { name: 'Add it' }))
    expect(await screen.findByRole('link', { name: 'New one' })).toHaveAttribute(
      'href',
      '/admin/reports/boards/new-one',
    )
  })
})
