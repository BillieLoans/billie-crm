'use client'

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import { CLEARABLE_REASONS } from '@/lib/events/config'

// ─── Heavy hook mocks ─────────────────────────────────────────────────────────

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}))

vi.mock('@/hooks/queries/useCustomer', () => ({
  useCustomer: vi.fn(),
}))

vi.mock('@/hooks/queries/useFeesCount', () => ({
  useFeesCount: vi.fn(() => 0),
}))

vi.mock('@/hooks/queries/usePendingWriteOff', () => ({
  usePendingWriteOff: vi.fn(() => ({ data: null, isError: false })),
}))

vi.mock('@/hooks/queries/useTransactions', () => ({
  transactionsQueryKey: vi.fn(() => ['transactions']),
}))

vi.mock('@/hooks/queries/useAccruedYield', () => ({
  accruedYieldQueryKey: vi.fn(() => ['accrued-yield']),
  accrualHistoryQueryKey: vi.fn(() => ['accrual-history']),
}))

vi.mock('@/hooks/queries/useECLAllowance', () => ({
  eclAllowanceQueryKey: vi.fn(() => ['ecl-allowance']),
}))

vi.mock('@/hooks/useTrackCustomerView', () => ({
  useTrackCustomerView: vi.fn(),
}))

// ─── Sub-component stubs ──────────────────────────────────────────────────────

vi.mock('@/components/ServicingView/CustomerHeader', () => ({
  CustomerHeader: () => <div data-testid="stub-customer-header" />,
}))

vi.mock('@/components/ServicingView/CustomerHeaderSkeleton', () => ({
  CustomerHeaderSkeleton: () => <div data-testid="stub-header-skeleton" />,
}))

vi.mock('@/components/ServicingView/LoanAccountsSkeleton', () => ({
  LoanAccountsSkeleton: () => <div data-testid="stub-accounts-skeleton" />,
}))

vi.mock('@/components/ServicingView/TransactionsSkeleton', () => ({
  TransactionsSkeleton: () => <div data-testid="stub-tx-skeleton" />,
}))

vi.mock('@/components/ServicingView/WaiveFeeDrawer', () => ({
  WaiveFeeDrawer: () => null,
}))

vi.mock('@/components/ServicingView/RecordRepaymentDrawer', () => ({
  RecordRepaymentDrawer: () => null,
}))

vi.mock('@/components/ServicingView/BulkWaiveFeeDrawer', () => ({
  BulkWaiveFeeDrawer: () => null,
}))

vi.mock('@/components/ServicingView/WriteOffRequestDrawer', () => ({
  WriteOffRequestDrawer: () => null,
}))

vi.mock('@/components/ServicingView/DisburseLoanDrawer', () => ({
  DisburseLoanDrawer: () => null,
}))

vi.mock('@/components/ServicingView/ApplyFeeDrawer', () => ({
  ApplyFeeDrawer: () => null,
}))

vi.mock('@/components/ServicingView/AccountPanel', () => ({
  AccountPanel: () => <div data-testid="stub-account-panel" />,
}))

vi.mock('@/components/ServicingView/AccountRail', () => ({
  AccountRail: () => <div data-testid="stub-account-rail" />,
}))

vi.mock('@/components/ServicingView/AttentionStrip', () => ({
  // Render the trailing slot — the ClearBlockButton rides inline in the strip.
  AttentionStrip: ({ trailing }: { trailing?: React.ReactNode }) => (
    <div data-testid="stub-attention-strip">{trailing}</div>
  ),
}))

vi.mock('@/components/ServicingView/ContextPane', () => ({
  ContextPane: () => <div data-testid="stub-context-pane" />,
}))

vi.mock('@/components/Breadcrumb', () => ({
  Breadcrumb: () => <div data-testid="stub-breadcrumb" />,
}))

vi.mock('@/lib/accountTriage', () => ({
  getAttentionItems: vi.fn(() => []),
  sortAccountsForRail: vi.fn(() => ({ active: [], closed: [] })),
}))

// ─── ClearBlockButton spy ─────────────────────────────────────────────────────
// Expose what it receives as data attributes so we can assert on them.

vi.mock('@/components/BlockClear', () => ({
  ClearBlockButton: vi.fn(
    ({
      block,
      customerName,
    }: {
      block: { canonicalCustomerId?: string | null } | null
      customerName?: string
    }) => (
      <div
        data-testid="clear-block-btn-stub"
        data-canonical-id={block?.canonicalCustomerId ?? 'none'}
        data-customer-name={customerName ?? ''}
      />
    ),
  ),
}))

// ─── Test data ────────────────────────────────────────────────────────────────

const CLEARABLE = CLEARABLE_REASONS[0]
const CANONICAL_ID = 'cust-canon-abc-123'

function makeCustomer(blockOverride?: Record<string, unknown> | null) {
  return {
    id: 'payload-doc-id-1',
    customerId: CANONICAL_ID,
    fullName: 'Alex Testerton',
    firstName: 'Alex',
    lastName: 'Testerton',
    preferredName: null,
    emailAddress: 'alex@example.com',
    mobilePhoneNumber: null,
    dateOfBirth: null,
    identityVerified: false,
    staffFlag: false,
    investorFlag: false,
    founderFlag: false,
    vulnerableFlag: false,
    residentialAddress: null,
    identityVerification: null,
    loanAccounts: [],
    reapplicationBlock: blockOverride !== undefined ? blockOverride : null,
  }
}

// ─── Lazy import (after all vi.mock declarations) ─────────────────────────────

async function getServicingView() {
  const { ServicingView } = await import('@/components/ServicingView/ServicingView')
  return ServicingView
}

async function getUseCustomerMock() {
  const mod = await import('@/hooks/queries/useCustomer')
  return vi.mocked(mod.useCustomer)
}

afterEach(() => cleanup())

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ServicingView — ClearBlockButton wiring (BTB-202)', () => {
  it('renders ClearBlockButton with canonicalCustomerId equal to customer.customerId', async () => {
    const ServicingView = await getServicingView()
    const useCustomerMock = await getUseCustomerMock()
    useCustomerMock.mockReturnValue({
      data: makeCustomer({ reason: CLEARABLE, clearStatus: null, clearedAt: null }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useCustomerMock>)

    render(<ServicingView customerId={CANONICAL_ID} />)

    const stub = screen.getByTestId('clear-block-btn-stub')
    expect(stub).toBeInTheDocument()
    expect(stub).toHaveAttribute('data-canonical-id', CANONICAL_ID)
  })

  it('passes customerName (fullName) to ClearBlockButton', async () => {
    const ServicingView = await getServicingView()
    const useCustomerMock = await getUseCustomerMock()
    useCustomerMock.mockReturnValue({
      data: makeCustomer({ reason: CLEARABLE, clearStatus: null, clearedAt: null }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useCustomerMock>)

    render(<ServicingView customerId={CANONICAL_ID} />)

    const stub = screen.getByTestId('clear-block-btn-stub')
    expect(stub).toHaveAttribute('data-customer-name', 'Alex Testerton')
  })

  it('renders ClearBlockButton with null block when customer has no reapplicationBlock', async () => {
    const ServicingView = await getServicingView()
    const useCustomerMock = await getUseCustomerMock()
    useCustomerMock.mockReturnValue({
      data: makeCustomer(null),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useCustomerMock>)

    render(<ServicingView customerId={CANONICAL_ID} />)

    // Stub still renders (ClearBlockButton self-gates, not ServicingView)
    const stub = screen.getByTestId('clear-block-btn-stub')
    expect(stub).toHaveAttribute('data-canonical-id', 'none')
  })
})
