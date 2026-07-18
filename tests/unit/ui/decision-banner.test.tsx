import { describe, test, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// Mock @payloadcms/ui (same pattern as ClearBlockButton.test) — importing the
// real package pulls a .css file through Node's ESM loader, which jsdom tests
// cannot load. DecisionBanner reaches it via ClearBlockButton's useAuth.
// Readonly role: these tests cover the banner copy, not the clear-block
// action, and the button's react-query tree needs a provider these renders
// don't have (ClearBlockButton has its own dedicated test file).
vi.mock('@payloadcms/ui', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'ro-1', role: 'readonly' },
  })),
}))

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

  test('an explicit block disposition still renders the red eligibility-block panel', () => {
    render(
      <DecisionBanner
        conversation={createConversation({
          finalDecision: 'DECLINED',
          reapplicationBlock: {
            reason: 'ACTIVE_LOAN',
            dispositionKind: 'block',
            blockedUntil: null,
            sourceAccountId: 'LA-9',
          },
        })}
      />,
    )
    expect(screen.getByText('✗ Declined · Re-application block')).toBeInTheDocument()
    expect(screen.getByText(/while loan open/)).toBeInTheDocument()
    expect(screen.queryByText(/Flagged for manual review/)).not.toBeInTheDocument()
  })
})

describe('DecisionBanner review halt (recognition)', () => {
  afterEach(cleanup)

  const reviewConversation = createConversation({
    // Held for manual review — not decided. The review panel must render
    // regardless of the (absent) credit decision.
    finalDecision: null,
    status: 'paused',
    reapplicationBlock: {
      reason: 'review',
      dispositionKind: 'review',
      manualReviewCandidate: true,
      stopMessage:
        'Thanks for sending that through! We just need to take a closer look before we can continue.',
      blockedUntil: null,
      blockedAt: '2026-06-18T04:15:30Z',
      canonicalCustomerId: null,
      recognition: {
        band: 'review',
        posterior: 0.989831,
        case_id: '4494ed09-25c3-4095-9dc5-a34f5e6db584',
        candidates: [
          {
            candidate_id: 'C5C7DD3A',
            posterior: 0.98,
            concealment: false,
            per_signal_bits: { email: 10.0, bank: 8.94, address: 5.0, name: -5.06, dob: -5.64 },
          },
        ],
      },
    },
  })

  test('labels the halt as manual review, not a decline or a permanent block', () => {
    render(<DecisionBanner conversation={reviewConversation} />)
    expect(screen.getByText(/Flagged for manual review/)).toBeInTheDocument()
    expect(screen.queryByText(/permanent/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/✗ Declined/)).not.toBeInTheDocument()
  })

  test('surfaces the overall match confidence and the case id', () => {
    render(<DecisionBanner conversation={reviewConversation} />)
    expect(screen.getByText('98.98%')).toBeInTheDocument()
    expect(screen.getByText(/4494ed09-25c3-4095-9dc5-a34f5e6db584/)).toBeInTheDocument()
  })

  test('lists each potential match with its own match score', () => {
    render(<DecisionBanner conversation={reviewConversation} />)
    expect(screen.getByText('C5C7DD3A')).toBeInTheDocument()
    expect(screen.getByText('98.00%')).toBeInTheDocument()
  })

  test('groups per-signal evidence into identity-core vs corroborating', () => {
    render(<DecisionBanner conversation={reviewConversation} />)
    expect(screen.getByText('Identity core')).toBeInTheDocument()
    expect(screen.getByText('Corroborating')).toBeInTheDocument()
  })

  test('colours each signal by whether it agrees or disagrees', () => {
    render(<DecisionBanner conversation={reviewConversation} />)
    // Disagreeing identity core — the "different identity" tell.
    const nameChip = screen.getByTestId('signal-chip-name')
    expect(nameChip.className).toMatch(/disagrees/)
    expect(nameChip).toHaveTextContent('Name')
    expect(nameChip).toHaveTextContent('-5.1')
    // Agreeing corroborating hint.
    const emailChip = screen.getByTestId('signal-chip-email')
    expect(emailChip.className).toMatch(/agrees/)
    expect(emailChip).toHaveTextContent('+10.0')
  })

  test('keeps the stop message the customer saw', () => {
    render(<DecisionBanner conversation={reviewConversation} />)
    expect(screen.getByText(/Thanks for sending that through/)).toBeInTheDocument()
  })

  test('does not show a concealment flag when the candidate is not concealing', () => {
    render(<DecisionBanner conversation={reviewConversation} />)
    expect(screen.queryByText(/concealment/i)).not.toBeInTheDocument()
  })

  test('flags concealment when a candidate is concealing the prior identity', () => {
    render(
      <DecisionBanner
        conversation={createConversation({
          reapplicationBlock: {
            reason: 'review',
            dispositionKind: 'review',
            recognition: {
              band: 'review',
              posterior: 0.5,
              case_id: 'case-conceal',
              candidates: [
                {
                  candidate_id: 'X1',
                  posterior: 0.5,
                  concealment: true,
                  per_signal_bits: { name: 2.0 },
                },
              ],
            },
          },
        })}
      />,
    )
    expect(screen.getByText(/concealment/i)).toBeInTheDocument()
  })

  test('does not break when recognition is absent (older review events)', () => {
    render(
      <DecisionBanner
        conversation={createConversation({
          reapplicationBlock: {
            reason: 'review',
            dispositionKind: 'review',
            stopMessage: 'We just need to take a closer look.',
            recognition: null,
          },
        })}
      />,
    )
    expect(screen.getByText(/Flagged for manual review/)).toBeInTheDocument()
    expect(screen.getByText(/We just need to take a closer look/)).toBeInTheDocument()
    // No matches table, but no crash.
    expect(screen.queryByText('Potential matches')).not.toBeInTheDocument()
  })
})
