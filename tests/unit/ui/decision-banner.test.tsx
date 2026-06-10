import { describe, test, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { DecisionBanner } from '@/components/ConversationDetailView/DecisionBanner'
import type { ConversationDetail } from '@/lib/schemas/conversations'

const createConversation = (overrides: Partial<ConversationDetail> = {}): ConversationDetail =>
  ({
    conversationId: 'conv-1',
    applicationNumber: 'A3CD3461-11F',
    status: 'active',
    decisionStatus: null,
    finalDecision: null,
    customer: { fullName: 'Alex Brown', customerId: '22F0652F', payloadId: 'p1' },
    utterances: [],
    noticeboard: [],
    messageCount: 0,
    ...overrides,
  }) as ConversationDetail

describe('DecisionBanner states', () => {
  afterEach(cleanup)

  test('renders neutral slot before any decision', () => {
    render(<DecisionBanner conversation={createConversation()} />)
    expect(screen.getByTestId('decision-banner')).toBeInTheDocument()
    expect(screen.getByText('○ No decision yet')).toBeInTheDocument()
  })

  test('renders approved state', () => {
    render(<DecisionBanner conversation={createConversation({ finalDecision: 'APPROVED' })} />)
    expect(screen.getByText('✓ Approved')).toBeInTheDocument()
  })

  test('renders referred state', () => {
    render(<DecisionBanner conversation={createConversation({ finalDecision: 'REFERRED' })} />)
    expect(screen.getByText('→ Referred')).toBeInTheDocument()
  })

  test('legacy decline (no reason) renders the banner only', () => {
    render(<DecisionBanner conversation={createConversation({ finalDecision: 'DECLINED' })} />)
    expect(screen.getByText('✗ Declined')).toBeInTheDocument()
    expect(screen.queryByText('Reason')).not.toBeInTheDocument()
  })

  test('assessment-based decline shows the raw reason in the headline', () => {
    render(
      <DecisionBanner
        conversation={createConversation({
          finalDecision: 'DECLINED',
          decisionDetail: { reason: 'SERVICEABILITY_FAILED' },
        })}
      />,
    )
    expect(screen.getByText('✗ Declined · SERVICEABILITY_FAILED')).toBeInTheDocument()
  })
})

describe('DecisionBanner block-decline detail', () => {
  afterEach(cleanup)

  const blockConversation = createConversation({
    finalDecision: 'DECLINED',
    decisionDetail: {
      reason: 'REAPPLICATION_BLOCK:ID_VERIFICATION',
      retryEligible: false,
      sourceApplicationNumber: '871CE08C-8B6',
      blockedUntil: '2026-12-10T01:02:21+00:00',
    },
    reapplicationBlock: {
      reason: 'ID_VERIFICATION',
      messageVariant: 'ID_VERIFICATION',
      stopMessage: "Oh bother! It seems you're not eligible for a loan with Billie at this time.",
      sourceApplicationNumber: '871CE08C-8B6',
      sourceAccountId: null,
      sourceDecidedAt: '2026-06-10T01:02:21+00:00',
      blockedUntil: '2026-12-10T01:02:21+00:00',
      blockedAt: '2026-06-10T07:08:40+00:00',
      canonicalCustomerId: '22F0652F',
    },
    sourceConversationId: 'conv-source-1',
  })

  test('renders block headline and humanized reason', () => {
    render(<DecisionBanner conversation={blockConversation} />)
    expect(screen.getByText('✗ Declined · Re-application block')).toBeInTheDocument()
    expect(screen.getByText('ID verification')).toBeInTheDocument()
  })

  test('renders the exclusion window', () => {
    render(<DecisionBanner conversation={blockConversation} />)
    expect(screen.getByText(/until 10 December 2026/)).toBeInTheDocument()
  })

  test('links the source decline to its conversation', () => {
    render(<DecisionBanner conversation={blockConversation} />)
    const link = screen.getByRole('link', { name: /871CE08C-8B6/ })
    expect(link).toHaveAttribute('href', '/admin/applications/conv-source-1')
  })

  test('falls back to plain text when the source conversation is unknown', () => {
    render(
      <DecisionBanner
        conversation={{ ...blockConversation, sourceConversationId: null }}
      />,
    )
    expect(screen.queryByRole('link', { name: /871CE08C-8B6/ })).not.toBeInTheDocument()
    expect(screen.getByText('871CE08C-8B6')).toBeInTheDocument()
  })

  test('shows the stop message the customer saw', () => {
    render(<DecisionBanner conversation={blockConversation} />)
    expect(screen.getByText(/Oh bother!/)).toBeInTheDocument()
  })

  test('permanent block (PEP, null blockedUntil) reads permanent', () => {
    render(
      <DecisionBanner
        conversation={createConversation({
          finalDecision: 'DECLINED',
          reapplicationBlock: { reason: 'PEP', blockedUntil: null },
        })}
      />,
    )
    expect(screen.getByText('✗ Declined · Re-application block')).toBeInTheDocument()
    expect(screen.getByText(/permanent/)).toBeInTheDocument()
  })

  test('ACTIVE_LOAN block links the source account into servicing', () => {
    render(
      <DecisionBanner
        conversation={createConversation({
          finalDecision: 'DECLINED',
          reapplicationBlock: {
            reason: 'ACTIVE_LOAN',
            sourceAccountId: 'LA-001',
            blockedUntil: null,
          },
        })}
      />,
    )
    expect(screen.getByText(/while loan open/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /LA-001/ })
    expect(link).toHaveAttribute('href', '/admin/servicing/22F0652F?accountId=LA-001')
  })

  test('block-decline from decision detail alone (event 1 not yet projected)', () => {
    render(
      <DecisionBanner
        conversation={createConversation({
          finalDecision: 'DECLINED',
          decisionDetail: {
            reason: 'REAPPLICATION_BLOCK:SERVICEABILITY',
            sourceApplicationNumber: '871CE08C-8B6',
            blockedUntil: '2027-06-10T01:02:21+00:00',
          },
        })}
      />,
    )
    expect(screen.getByText('✗ Declined · Re-application block')).toBeInTheDocument()
    expect(screen.getByText('Serviceability')).toBeInTheDocument()
    expect(screen.getByText(/until 10 June 2027/)).toBeInTheDocument()
  })
})
