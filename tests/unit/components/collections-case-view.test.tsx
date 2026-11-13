/**
 * Unit tests for CollectionsCaseView (BTB-197 WS4): the dedicated
 * collections case view — Operational / Accounting + Economics / Contact +
 * Actions panels, sourced from `useCollectionsCase` plus the economics and
 * contact-log read routes, with the four operator-action mutation hooks
 * (Flag hardship / Resume / Stop contact / Advance to next step).
 *
 * Mocking follows the C9 harness (tests/unit/components/collections-view.test.tsx):
 * hoisted `mock`-prefixed vi.fn() spies wired through `vi.mock` factories,
 * global.fetch mocked per test for the economics/contact-log routes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import type { CollectionsCaseRow } from '@/types/collections'

// ─── Mocks ──────────────────────────────────────────────────────────────

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

const mockUseCollectionsCase = vi.fn()
vi.mock('@/hooks/queries/useCollectionsCase', () => ({
  useCollectionsCase: (accountId: string | null) => mockUseCollectionsCase(accountId),
}))

const mockUseCustomer = vi.fn()
vi.mock('@/hooks/queries/useCustomer', () => ({
  useCustomer: (customerId: string) => mockUseCustomer(customerId),
}))

const mockUseFlagHardship = vi.fn()
vi.mock('@/hooks/mutations/useFlagHardship', () => ({
  useFlagHardship: () => mockUseFlagHardship(),
}))

const mockUseResumeHardship = vi.fn()
vi.mock('@/hooks/mutations/useResumeHardship', () => ({
  useResumeHardship: () => mockUseResumeHardship(),
}))

const mockUseApplyStopContact = vi.fn()
vi.mock('@/hooks/mutations/useApplyStopContact', () => ({
  useApplyStopContact: () => mockUseApplyStopContact(),
}))

const mockUseAdvanceToNextStep = vi.fn()
vi.mock('@/hooks/mutations/useAdvanceToNextStep', () => ({
  useAdvanceToNextStep: () => mockUseAdvanceToNextStep(),
}))

// CommunicationsPanel pulls in its own data fetching (contact notes +
// notifications) that isn't relevant to this component's own logic — stub it
// so we can assert it mounts (or doesn't) with the right ids.
vi.mock('@/components/ServicingView/Communications/CommunicationsPanel', () => ({
  CommunicationsPanel: (props: {
    customerDocId: string
    customerBusinessId: string
    selectedAccountId: string | null
  }) => (
    <div data-testid="communications-panel-stub">
      customerDocId={props.customerDocId} customerBusinessId={props.customerBusinessId}{' '}
      selectedAccountId={props.selectedAccountId}
    </div>
  ),
}))

// The stored message body is fetched per notification — stub the renderer so
// the reminder modal can be asserted without the body route.
vi.mock('@/components/ServicingView/Communications/NotificationBodyModal', () => ({
  NotificationBodyContent: (props: { notificationId: string }) => (
    <div data-testid={`notification-body-stub-${props.notificationId}`}>body</div>
  ),
}))

import { CollectionsCaseView } from '@/components/CollectionsView/CollectionsCaseView'

// ─── Test data / helpers ───────────────────────────────────────────────────

function makeCase(overrides: Partial<CollectionsCaseRow> = {}): CollectionsCaseRow {
  return {
    accountId: 'acc-1',
    customerId: 'cust-1',
    customerName: 'Jane Doe',
    accountNumber: 'ACC-0001',
    state: 'open',
    rung: 2,
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
    aging: { dpd: 10, bucket: 'early_arrears', totalOverdue: '150.75' },
    ...overrides,
  }
}

const PASS_ECONOMICS = {
  economics: {
    accountId: 'acc-1',
    amountOwed: '200.00',
    costOfNextStep: '3.50',
    expectedNetRecovery: '196.50',
    gateResult: { status: 'PASS', reason: '' },
    costLedger: [{ label: 'SMS send', amount: '0.05', category: 'production', recoverable: false }],
    nextStepPreview: {
      rung: 3,
      channel: 'email',
      template: 'overdue_email_v2',
      subject: 'Your payment is overdue',
      body: 'Hi Jane, your instalment is overdue. Please pay as soon as possible.',
    },
  },
}

const CONTACT_LOG = {
  contactLog: {
    accountId: 'acc-1',
    entries: [{ sentAt: '2026-06-10T09:00:00.000Z', channel: 'email', template: 'overdue_email_v1', outcome: 'sent' }],
    contactCapStatus: { sent7d: 2, cap7d: 3, sentMonth: 6, capMonth: 10 },
  },
}

function makeReminder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n-1',
    notificationId: 'notif-1',
    idempotencyKey: 'overdue:acc-1:2026-06-01:1',
    customerId: 'cust-1',
    status: 'sent',
    channel: 'email',
    templateName: 'overdue_email_v1',
    provider: 'ses',
    eventAt: '2026-06-01T01:00:00.000Z',
    sentAt: '2026-06-01T01:00:00.000Z',
    tags: { category: 'servicing', reason: 'overdue', step: 1 },
    failure: null,
    createdAt: '2026-06-01T01:00:00.000Z',
    updatedAt: '2026-06-01T01:00:00.000Z',
    ...overrides,
  }
}

const REMINDERS = {
  docs: [
    makeReminder(),
    // Another account of the same customer — must not show on this case.
    makeReminder({ id: 'n-2', notificationId: 'notif-2', idempotencyKey: 'overdue:acc-9:2026-06-01:2' }),
    makeReminder({
      id: 'n-3',
      notificationId: 'notif-3',
      idempotencyKey: 'predue:acc-1:3:0',
      templateName: 'pre_due_email_first',
      tags: { category: 'servicing', reason: 'pre_due', step: null },
    }),
  ],
}

const CUSTOMER = {
  id: 'cdoc-1',
  customerId: 'cust-1',
  fullName: 'Jane Doe',
  firstName: 'Jane',
  preferredName: null,
  emailAddress: 'jane@example.com',
  mobilePhoneNumber: '0400 000 000',
  residentialAddress: { fullAddress: '1 Test St, Sydney NSW 2000' },
  vulnerableFlag: false,
  loanAccounts: [],
}

function defaultMutationReturn(overrides: Record<string, unknown> = {}) {
  return {
    isPending: false,
    isLoading: false,
    isSuccess: false,
    isError: false,
    error: null,
    isReadOnlyMode: false,
    ...overrides,
  }
}

function fetchImplFor(opts: {
  economics?: unknown
  contactLog?: unknown
  economicsOk?: boolean
  contactLogOk?: boolean
  reminders?: unknown
}) {
  const {
    economics = PASS_ECONOMICS,
    contactLog = CONTACT_LOG,
    economicsOk = true,
    contactLogOk = true,
    reminders = REMINDERS,
  } = opts
  return vi.fn((url: string) => {
    if (url.startsWith('/api/notifications?')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => reminders })
    }
    if (url.includes('/economics')) {
      return Promise.resolve({ ok: economicsOk, status: economicsOk ? 200 : 500, json: async () => economics })
    }
    if (url.includes('/contact-log')) {
      return Promise.resolve({ ok: contactLogOk, status: contactLogOk ? 200 : 500, json: async () => contactLog })
    }
    throw new Error(`Unexpected fetch url in test: ${url}`)
  })
}

function renderView(props: { accountId?: string; userRole?: 'admin' | 'supervisor' | 'operations' | 'readonly' } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(CollectionsCaseView, { accountId: props.accountId ?? 'acc-1', userRole: props.userRole }),
    ),
  )
}

beforeEach(() => {
  mockUseCollectionsCase.mockReset()
  mockUseCustomer.mockReset()
  mockUseFlagHardship.mockReset()
  mockUseResumeHardship.mockReset()
  mockUseApplyStopContact.mockReset()
  mockUseAdvanceToNextStep.mockReset()

  mockUseCollectionsCase.mockReturnValue({ data: makeCase(), isLoading: false })
  mockUseCustomer.mockReturnValue({ data: CUSTOMER, isLoading: false, isError: false })
  mockUseFlagHardship.mockReturnValue({
    flagHardship: vi.fn(),
    flagHardshipAsync: vi.fn().mockResolvedValue({ accountId: 'acc-1', newState: 'hardship_paused', emittedEventId: 'evt-1' }),
    ...defaultMutationReturn(),
  })
  mockUseResumeHardship.mockReturnValue({
    resumeHardship: vi.fn(),
    resumeHardshipAsync: vi.fn(),
    ...defaultMutationReturn(),
  })
  mockUseApplyStopContact.mockReturnValue({
    applyStopContact: vi.fn(),
    applyStopContactAsync: vi.fn().mockResolvedValue({ accountId: 'acc-1', newState: 'stopped_contact', emittedEventId: 'evt-2' }),
    ...defaultMutationReturn(),
  })
  mockUseAdvanceToNextStep.mockReturnValue({
    advanceToNextStep: vi.fn(),
    advanceToNextStepAsync: vi.fn().mockResolvedValue({ accountId: 'acc-1', newState: 'open', emittedEventId: 'evt-3' }),
    ...defaultMutationReturn(),
  })

  global.fetch = fetchImplFor({})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('CollectionsCaseView (BTB-197 WS4)', () => {
  it('renders the three panels from mocked hooks/fetch', async () => {
    renderView({ userRole: 'supervisor' })

    // Operational panel
    expect(screen.getByText('ACC-0001')).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByTestId('rung-step-2')).toBeInTheDocument()

    // Accounting + economics panel (async — waits on the economics fetch)
    await waitFor(() => expect(screen.getByText('200.00')).toBeInTheDocument())
    expect(screen.getByText('150.75')).toBeInTheDocument() // live ledger, from caseRow.aging
    expect(screen.getByText('3.50')).toBeInTheDocument()
    expect(screen.getByText('196.50')).toBeInTheDocument()
    expect(screen.getByTestId('gate-badge')).toHaveTextContent('PASS')
    expect(screen.getByTestId('cost-ledger-table')).toBeInTheDocument()
    expect(screen.getByText('SMS send')).toBeInTheDocument()

    // Contact + actions panel
    await waitFor(() => expect(screen.getByTestId('contact-log-table')).toBeInTheDocument())
    expect(screen.getByTestId('contact-cap-line')).toHaveTextContent('2 of 3 this week')
    expect(screen.getByTestId('contact-cap-line')).toHaveTextContent('6 of 10 this month')
    expect(screen.getByTestId('flag-hardship-button')).toBeInTheDocument()
    expect(screen.getByTestId('resume-button')).toBeInTheDocument()
    expect(screen.getByTestId('stop-contact-button')).toBeInTheDocument()
    expect(screen.getByTestId('advance-button')).toBeInTheDocument()

    // Communications timeline mounted with both customer ids and this account
    expect(screen.getByTestId('communications-panel-stub')).toHaveTextContent(
      'customerDocId=cdoc-1 customerBusinessId=cust-1 selectedAccountId=acc-1',
    )
  })

  it('links the case title and customer ID to the customer view with this account selected', () => {
    renderView()

    const href = '/admin/servicing/cust-1?accountId=acc-1'
    expect(screen.getByTestId('case-title-link')).toHaveAttribute('href', href)
    expect(screen.getByTestId('case-customer-link')).toHaveAttribute('href', href)
    expect(screen.getByTestId('case-customer-link')).toHaveTextContent('cust-1')
  })

  it('shows the customer name, address and contact details', () => {
    renderView()

    const card = screen.getByTestId('case-customer-card')
    expect(card).toHaveTextContent('Jane Doe')
    expect(screen.getByTestId('case-customer-mobile')).toHaveTextContent('0400 000 000')
    expect(screen.getByTestId('case-customer-email')).toHaveTextContent('jane@example.com')
    expect(screen.getByTestId('case-customer-address')).toHaveTextContent(
      '1 Test St, Sydney NSW 2000',
    )
  })

  it('falls back to the loan-account name while the customer record loads', () => {
    mockUseCustomer.mockReturnValue({ data: undefined, isLoading: true, isError: false })

    renderView()

    expect(screen.getByTestId('case-customer-card')).toHaveTextContent('Jane Doe')
    expect(screen.getByTestId('case-customer-email')).toHaveTextContent('Loading…')
    expect(screen.getByTestId('communications-pending')).toBeInTheDocument()
  })

  it('clicking a sent reminder rung opens its send details and message body', async () => {
    renderView()

    fireEvent.click(screen.getByTestId('rung-step-1'))

    const modal = await screen.findByTestId('reminder-detail-modal')
    await waitFor(() => expect(screen.getByTestId('reminder-send-n-1')).toBeInTheDocument())
    expect(modal).toHaveTextContent('Reminder 1')
    expect(modal).toHaveTextContent('Sent')
    expect(modal).toHaveTextContent('EMAIL')
    expect(modal).toHaveTextContent('overdue_email_v1')
    // Newest send opens with its body showing
    expect(screen.getByTestId('notification-body-stub-notif-1')).toBeInTheDocument()
    // Another account's reminder is not attributed to this case
    expect(screen.queryByTestId('reminder-send-n-2')).not.toBeInTheDocument()
  })

  it('clicking the pre-due rung shows pre-due reminders for this account', async () => {
    renderView()

    fireEvent.click(screen.getByTestId('rung-step-0'))

    await waitFor(() => expect(screen.getByTestId('reminder-send-n-3')).toBeInTheDocument())
    expect(screen.queryByTestId('reminder-send-n-1')).not.toBeInTheDocument()
  })

  it('clicking the unsent next rung shows the engine preview', async () => {
    renderView()
    await waitFor(() => expect(screen.getByTestId('gate-badge')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('rung-step-3'))

    const preview = await screen.findByTestId('reminder-preview')
    expect(preview).toHaveTextContent('Your payment is overdue')
    expect(preview).toHaveTextContent('Hi Jane, your instalment is overdue.')
  })

  it('clicking an unsent rung with no preview says nothing was sent', async () => {
    renderView()
    await waitFor(() => expect(screen.getByTestId('gate-badge')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('rung-step-5'))

    expect(await screen.findByTestId('reminder-none')).toHaveTextContent('Nothing has been sent')
  })

  it('renders only non-null lifecycle timestamps and flag chips', async () => {
    mockUseCollectionsCase.mockReturnValue({
      data: makeCase({
        openedAt: '2026-06-01T00:00:00.000Z',
        curedAt: '2026-06-15T00:00:00.000Z',
        pausedAt: null,
        resumedAt: null,
        stopContactAt: null,
        exhaustedAt: null,
        hardshipPaused: true,
        stoppedContact: false,
      }),
      isLoading: false,
    })

    renderView()

    expect(screen.getByText('Opened')).toBeInTheDocument()
    expect(screen.getByText('Cured')).toBeInTheDocument()
    expect(screen.queryByText('Paused')).not.toBeInTheDocument()
    expect(screen.queryByText('Resumed')).not.toBeInTheDocument()
    expect(screen.queryByText('Stop-contact applied')).not.toBeInTheDocument()
    expect(screen.queryByText('Exhausted')).not.toBeInTheDocument()
    expect(screen.getByText('Hardship')).toBeInTheDocument()
  })

  it('marks the awaiting_human ladder position with an "escalation candidate" tag', () => {
    mockUseCollectionsCase.mockReturnValue({ data: makeCase({ state: 'awaiting_human' }), isLoading: false })

    renderView()

    expect(screen.getByTestId('escalation-candidate-tag')).toBeInTheDocument()
    expect(screen.getByTestId('rung-step-3')).toContainElement(screen.getByTestId('escalation-candidate-tag'))
  })

  it('economics NOT_APPLICABLE → pending placeholder with the reason', async () => {
    global.fetch = fetchImplFor({
      economics: {
        economics: {
          accountId: 'acc-1',
          amountOwed: '0',
          costOfNextStep: '0',
          expectedNetRecovery: '0',
          gateResult: { status: 'NOT_APPLICABLE', reason: 'Cost-of-recovery engine not yet deployed (BTB-194)' },
          costLedger: [],
          nextStepPreview: null,
        },
      },
    })

    renderView()

    await waitFor(() => expect(screen.getByTestId('economics-pending')).toBeInTheDocument())
    expect(screen.getByTestId('economics-pending')).toHaveTextContent('Economics pending')
    expect(screen.getByTestId('economics-pending')).toHaveTextContent(
      'Cost-of-recovery engine not yet deployed (BTB-194)',
    )
  })

  it('economics unavailable=true → pending placeholder', async () => {
    global.fetch = fetchImplFor({ economics: { economics: null, unavailable: true } })

    renderView()

    await waitFor(() => expect(screen.getByTestId('economics-pending')).toBeInTheDocument())
  })

  it('gate FAIL → Advance disabled with the gate reason as the title', async () => {
    global.fetch = fetchImplFor({
      economics: {
        economics: {
          ...PASS_ECONOMICS.economics,
          gateResult: { status: 'FAIL', reason: 'Expected net recovery is negative' },
        },
      },
    })

    renderView({ userRole: 'supervisor' })

    await waitFor(() => expect(screen.getByTestId('gate-badge')).toHaveTextContent('FAIL'))

    const advanceButton = screen.getByTestId('advance-button')
    expect(advanceButton).toBeDisabled()
    expect(advanceButton).toHaveAttribute('title', 'Expected net recovery is negative')
  })

  it('advance confirm modal shows the next-step preview subject/body', async () => {
    renderView({ userRole: 'supervisor' })

    await waitFor(() => expect(screen.getByTestId('advance-button')).not.toBeDisabled())

    fireEvent.click(screen.getByTestId('advance-button'))

    expect(screen.getByTestId('advance-confirm-modal')).toBeInTheDocument()
    expect(screen.getByText('Your payment is overdue')).toBeInTheDocument()
    expect(
      screen.getByText('Hi Jane, your instalment is overdue. Please pay as soon as possible.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('advance-confirm-button'))

    await waitFor(() =>
      expect(mockUseAdvanceToNextStep().advanceToNextStepAsync).toHaveBeenCalledWith({ accountId: 'acc-1' }),
    )
  })

  it('flag-hardship dialog calls the mutation with the entered reason', async () => {
    renderView({ userRole: 'operations' })

    fireEvent.click(screen.getByTestId('flag-hardship-button'))
    expect(screen.getByTestId('flag-hardship-dialog')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('hardship-reason-input'), {
      target: { value: 'Customer lost their job' },
    })
    fireEvent.click(screen.getByTestId('hardship-submit-button'))

    await waitFor(() =>
      expect(mockUseFlagHardship().flagHardshipAsync).toHaveBeenCalledWith({
        accountId: 'acc-1',
        reason: 'Customer lost their job',
      }),
    )
  })

  it('non-supervisor → Advance is not actionable', async () => {
    renderView({ userRole: 'operations' })

    await waitFor(() => expect(screen.getByTestId('gate-badge')).toBeInTheDocument())

    const advanceButton = screen.getByTestId('advance-button')
    expect(advanceButton).toBeDisabled()
    expect(advanceButton).toHaveAttribute('title', 'Advancing a case requires supervisor approval')

    fireEvent.click(advanceButton)
    expect(screen.queryByTestId('advance-confirm-modal')).not.toBeInTheDocument()
  })

  it('readonly user → Flag hardship/Resume/Stop contact are disabled with a role-reason title (final-review Fix 3)', async () => {
    renderView({ userRole: 'readonly' })

    await waitFor(() => expect(screen.getByTestId('gate-badge')).toBeInTheDocument())

    const flagButton = screen.getByTestId('flag-hardship-button')
    const resumeButton = screen.getByTestId('resume-button')
    const stopButton = screen.getByTestId('stop-contact-button')

    for (const button of [flagButton, resumeButton, stopButton]) {
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('title', 'Requires operations role')
    }

    fireEvent.click(flagButton)
    expect(screen.queryByTestId('flag-hardship-dialog')).not.toBeInTheDocument()
  })

  it('operations user → Flag hardship/Resume/Stop contact remain actionable (canService, not gated like Advance)', async () => {
    renderView({ userRole: 'operations' })

    await waitFor(() => expect(screen.getByTestId('gate-badge')).toBeInTheDocument())

    expect(screen.getByTestId('flag-hardship-button')).not.toBeDisabled()
    expect(screen.getByTestId('resume-button')).not.toBeDisabled()
    expect(screen.getByTestId('stop-contact-button')).not.toBeDisabled()
  })

  it('case null (404) → not-found state with a back-to-queue link', () => {
    mockUseCollectionsCase.mockReturnValue({ data: null, isLoading: false })

    renderView()

    expect(screen.getByText('No collections case for this account')).toBeInTheDocument()
    const link = screen.getByText('← Back to queue')
    expect(link).toHaveAttribute('href', '/admin/collections-queue')
  })

  it('shows a loading state while the case is still loading', () => {
    mockUseCollectionsCase.mockReturnValue({ data: undefined, isLoading: true })

    renderView()

    expect(screen.getByText('Loading case...')).toBeInTheDocument()
    expect(screen.queryByText('No collections case for this account')).not.toBeInTheDocument()
  })

  it('a null-state case renders without crashing, with an "Unknown" state badge (final-review Fix 1)', async () => {
    // `state` is nullable on the projection — a case row from an
    // out-of-order flag event (hardship_paused/resumed/stop_contact_applied/
    // step_advanced with no prior `opened`) has no state yet. Before this
    // fix, `STATE_CONFIG[caseRow.state]` was `undefined` and `.className`
    // on it threw, blanking the whole case view.
    mockUseCollectionsCase.mockReturnValue({ data: makeCase({ state: null }), isLoading: false })

    renderView()

    expect(screen.getByText('ACC-0001')).toBeInTheDocument()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })
})
