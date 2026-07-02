import { describe, test, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

/**
 * Unit tests for BlockClearList row rendering.
 *
 * Regression: the row rendered `request.reasons.join(', ')`, which threw
 * "Cannot read properties of undefined (reading 'join')" whenever a request
 * arrived without a `reasons` array (the API/projection does not guarantee it,
 * despite the type declaring it required). BlockClearList must render a fallback
 * instead of crashing.
 */

const { hook } = vi.hoisted(() => ({
  hook: { result: null as unknown },
}))

vi.mock('@/hooks/queries/usePendingBlockClears', () => ({
  usePendingBlockClears: () => hook.result,
}))

// Keep this a focused unit test — stub the detail drawer child.
vi.mock('@/components/ApprovalsView/BlockClearDetailDrawer', () => ({
  BlockClearDetailDrawer: () => null,
}))

import { BlockClearList } from '@/components/ApprovalsView/BlockClearList'

type Doc = Record<string, unknown>

function asLoaded(docs: Doc[]) {
  hook.result = {
    data: {
      docs,
      totalDocs: docs.length,
      totalPages: 1,
      page: 1,
      hasNextPage: false,
      hasPrevPage: false,
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  }
}

afterEach(() => cleanup())

describe('BlockClearList row rendering', () => {
  test('does not crash when a request has no reasons', () => {
    asLoaded([
      {
        id: 'r1',
        requestNumber: 'BCR-1',
        customerName: 'Jane Doe',
        requestedByName: 'Op One',
        createdAt: '2026-06-01T00:00:00Z',
        reasons: undefined,
      },
    ])

    expect(() => render(<BlockClearList />)).not.toThrow()
    expect(screen.getByTestId('block-clear-row-r1')).toBeInTheDocument()
  })

  test('joins reasons with a comma when present', () => {
    asLoaded([
      {
        id: 'r2',
        requestNumber: 'BCR-2',
        customerName: 'Jane Doe',
        requestedByName: 'Op One',
        createdAt: '2026-06-01T00:00:00Z',
        reasons: ['SCREENING_HIT', 'ADDRESS_MISMATCH'],
      },
    ])

    render(<BlockClearList />)
    expect(screen.getByText('SCREENING_HIT, ADDRESS_MISMATCH')).toBeInTheDocument()
  })
})
