/**
 * Unit tests for CollectionsView re-platformed onto the event-sourced
 * worklist (BTB-196 WS3): useCollectionsCases data spine, state/rung/
 * hardship/stop-contact filters, ENR client-side sort, case-detail row
 * navigation, and the agingUnavailable degrade banner.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { CollectionsCaseRow } from '@/types/collections'

// ─── Mocks (declared with `mock` prefix so Vitest hoists them into the
//     vi.mock factories below — see tests/unit/ui/nav-sidebar.test.tsx) ────

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

const mockUseCollectionsCases = vi.fn()
vi.mock('@/hooks/queries/useCollectionsCases', () => ({
  useCollectionsCases: (filters: unknown) => mockUseCollectionsCases(filters),
}))

import { CollectionsView } from '@/components/CollectionsView/CollectionsView'

// ─── Test data / helpers ───────────────────────────────────────────────────

function makeCase(overrides: Partial<CollectionsCaseRow> = {}): CollectionsCaseRow {
  return {
    accountId: 'acc-1',
    customerId: 'cust-1',
    customerName: 'Jane Doe',
    accountNumber: 'ACC-0001',
    state: 'open',
    rung: 1,
    hardshipPaused: false,
    stoppedContact: false,
    overdueAmount: 100.5,
    daysOverdue: 10,
    lastStep: 2,
    openedAt: '2026-06-01T00:00:00.000Z',
    curedAt: null,
    exhaustedAt: null,
    pausedAt: null,
    resumedAt: null,
    stopContactAt: null,
    updatedAt: '2026-06-20T00:00:00.000Z',
    aging: { dpd: 10, bucket: 'early_arrears', totalOverdue: '100.50' },
    ...overrides,
  }
}

interface MockHookOverrides {
  cases?: CollectionsCaseRow[]
  totalDocs?: number
  agingUnavailable?: boolean
  hasNextPage?: boolean
  isLoading?: boolean
  isFetching?: boolean
}

function mockHookReturn(overrides: MockHookOverrides = {}) {
  return {
    cases: overrides.cases ?? [],
    totalDocs: overrides.totalDocs ?? (overrides.cases?.length ?? 0),
    agingUnavailable: overrides.agingUnavailable ?? false,
    fetchNextPage: vi.fn(),
    hasNextPage: overrides.hasNextPage ?? false,
    isLoading: overrides.isLoading ?? false,
    isFetching: overrides.isFetching ?? false,
  }
}

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(CollectionsView)),
  )
}

function lastFilterCall() {
  return mockUseCollectionsCases.mock.calls.at(-1)?.[0]
}

beforeEach(() => {
  mockPush.mockReset()
  mockUseCollectionsCases.mockReset()
  global.fetch = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('CollectionsView (BTB-196 WS3)', () => {
  it('renders rows from the mocked useCollectionsCases hook', () => {
    const rows = [
      makeCase({ accountId: 'acc-1', accountNumber: 'ACC-1', customerName: 'Jane Doe', rung: 2 }),
      makeCase({ accountId: 'acc-2', accountNumber: 'ACC-2', customerName: 'Bob Smith', rung: 4 }),
    ]
    mockUseCollectionsCases.mockReturnValue(mockHookReturn({ cases: rows }))

    renderView()

    expect(screen.getByText('ACC-1')).toBeInTheDocument()
    expect(screen.getByText('ACC-2')).toBeInTheDocument()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('Bob Smith')).toBeInTheDocument()
    expect(screen.getByText('Step 2/5')).toBeInTheDocument()
    expect(screen.getByText('Step 4/5')).toBeInTheDocument()
  })

  it('renders "—" for rung and degraded aging columns when absent', () => {
    const rows = [makeCase({ accountId: 'acc-1', rung: null, aging: null })]
    mockUseCollectionsCases.mockReturnValue(mockHookReturn({ cases: rows }))

    renderView()

    const dashes = screen.getAllByText('—')
    // Rung, DPD, Bucket, Amount all fall back to '—' when rung/aging are null.
    expect(dashes.length).toBeGreaterThanOrEqual(4)
  })

  it('updates the hook filters when the State select changes', () => {
    mockUseCollectionsCases.mockReturnValue(mockHookReturn())
    renderView()

    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'cured' } })

    expect(lastFilterCall()).toMatchObject({ state: 'cured' })
  })

  it('sets state=awaiting_human via the quick chip and toggles it off on a second click', () => {
    mockUseCollectionsCases.mockReturnValue(mockHookReturn())
    renderView()

    const chip = screen.getByRole('button', { name: 'Awaiting human' })

    fireEvent.click(chip)
    expect(lastFilterCall()).toMatchObject({ state: 'awaiting_human' })

    fireEvent.click(chip)
    expect(lastFilterCall()).toMatchObject({ state: undefined })
  })

  it('updates hardshipPaused/stoppedContact filters from the checkboxes', () => {
    mockUseCollectionsCases.mockReturnValue(mockHookReturn())
    renderView()

    fireEvent.click(screen.getByLabelText('Hardship'))
    expect(lastFilterCall()).toMatchObject({ hardshipPaused: true })

    fireEvent.click(screen.getByLabelText('Stop contact'))
    expect(lastFilterCall()).toMatchObject({ hardshipPaused: true, stoppedContact: true })
  })

  it('pushes the case-detail path on row click', () => {
    const rows = [makeCase({ accountId: 'acc-42', accountNumber: 'ACC-0001' })]
    mockUseCollectionsCases.mockReturnValue(mockHookReturn({ cases: rows }))

    renderView()

    fireEvent.click(screen.getByText('ACC-0001'))

    expect(mockPush).toHaveBeenCalledWith('/admin/collections-queue/acc-42')
  })

  it('triggers the batch economics POST and reorders rows by expected net recovery desc', async () => {
    const rows = [
      makeCase({ accountId: 'acc-low', accountNumber: 'LOW' }),
      makeCase({ accountId: 'acc-high', accountNumber: 'HIGH' }),
    ]
    mockUseCollectionsCases.mockReturnValue(mockHookReturn({ cases: rows }))

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          { accountId: 'acc-low', expectedNetRecovery: '10.00', gateResult: { status: 'PASS', reason: '' } },
          { accountId: 'acc-high', expectedNetRecovery: '500.00', gateResult: { status: 'PASS', reason: '' } },
        ],
      }),
    })

    renderView()

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'enr' } })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/collections/economics')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      accountIds: ['acc-low', 'acc-high'],
    })

    await waitFor(() => {
      const cells = screen.getAllByText(/^(LOW|HIGH)$/)
      expect(cells[0]).toHaveTextContent('HIGH')
      expect(cells[1]).toHaveTextContent('LOW')
    })

    // Order was determined by ENR, not the pending-note fallback.
    expect(
      screen.queryByText(/Net-recovery sort pending platform deploy \(BTB-194\)/),
    ).not.toBeInTheDocument()
  })

  it('shows the pending note and preserves Updated order when every gate is NOT_APPLICABLE', async () => {
    const rows = [
      makeCase({ accountId: 'acc-a', accountNumber: 'AAA' }),
      makeCase({ accountId: 'acc-b', accountNumber: 'BBB' }),
    ]
    mockUseCollectionsCases.mockReturnValue(mockHookReturn({ cases: rows }))

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          { accountId: 'acc-a', expectedNetRecovery: '0', gateResult: { status: 'NOT_APPLICABLE', reason: '' } },
          { accountId: 'acc-b', expectedNetRecovery: '0', gateResult: { status: 'NOT_APPLICABLE', reason: '' } },
        ],
      }),
    })

    renderView()

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'enr' } })

    await waitFor(() =>
      expect(screen.getByText(/Net-recovery sort pending platform deploy \(BTB-194\)/)).toBeInTheDocument(),
    )

    const cells = screen.getAllByText(/^(AAA|BBB)$/)
    expect(cells[0]).toHaveTextContent('AAA')
    expect(cells[1]).toHaveTextContent('BBB')
  })

  it('shows the pending note and preserves order when the economics route is unavailable', async () => {
    const rows = [
      makeCase({ accountId: 'acc-a', accountNumber: 'AAA' }),
      makeCase({ accountId: 'acc-b', accountNumber: 'BBB' }),
    ]
    mockUseCollectionsCases.mockReturnValue(mockHookReturn({ cases: rows }))

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], unavailable: true }),
    })

    renderView()

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'enr' } })

    await waitFor(() =>
      expect(screen.getByText(/Net-recovery sort pending platform deploy \(BTB-194\)/)).toBeInTheDocument(),
    )

    const cells = screen.getAllByText(/^(AAA|BBB)$/)
    expect(cells[0]).toHaveTextContent('AAA')
    expect(cells[1]).toHaveTextContent('BBB')
  })

  it('shows the pending note and preserves order when the economics fetch fails with 502', async () => {
    const rows = [
      makeCase({ accountId: 'acc-a', accountNumber: 'AAA' }),
      makeCase({ accountId: 'acc-b', accountNumber: 'BBB' }),
    ]
    mockUseCollectionsCases.mockReturnValue(mockHookReturn({ cases: rows }))

    const fetchMock = global.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: { message: 'Bad Gateway' } }),
    })

    renderView()

    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'enr' } })

    await waitFor(() =>
      expect(screen.getByText(/Net-recovery sort pending platform deploy \(BTB-194\)/)).toBeInTheDocument(),
    )

    const cells = screen.getAllByText(/^(AAA|BBB)$/)
    expect(cells[0]).toHaveTextContent('AAA')
    expect(cells[1]).toHaveTextContent('BBB')
  })

  it('renders the agingUnavailable degrade banner and still renders cases', () => {
    const rows = [makeCase({ accountId: 'acc-1' })]
    mockUseCollectionsCases.mockReturnValue(mockHookReturn({ cases: rows, agingUnavailable: true }))

    renderView()

    expect(
      screen.getByText('Ledger aging temporarily unavailable — DPD/Bucket/Amount columns degraded.'),
    ).toBeInTheDocument()
    expect(screen.getByText('ACC-0001')).toBeInTheDocument()
  })

  it('does not render the banner when aging is available', () => {
    mockUseCollectionsCases.mockReturnValue(mockHookReturn({ agingUnavailable: false }))

    renderView()

    expect(screen.queryByText(/Ledger aging temporarily unavailable/)).not.toBeInTheDocument()
  })

  it('renders a "Load more" button that calls fetchNextPage when hasNextPage is true', () => {
    const fetchNextPage = vi.fn()
    mockUseCollectionsCases.mockReturnValue({
      ...mockHookReturn({ cases: [makeCase()], hasNextPage: true }),
      fetchNextPage,
    })

    renderView()

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(fetchNextPage).toHaveBeenCalled()
  })
})
