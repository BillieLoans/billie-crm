/**
 * Tests for assessment UI components.
 *
 * Covers:
 * - AssessmentPanel: identity decision display (FR12), term label fix
 * - AssessmentDetailView: decision banner colours, rules table, financial
 *   metrics, raw JSON toggle, loading/null states (FR17, FR18)
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import React from 'react'
import { AssessmentPanel } from '@/components/ConversationDetailView/AssessmentPanel'
import { AssessmentDetailView } from '@/components/ConversationDetailView/AssessmentDetailView'
import type { ConversationDetail } from '@/lib/schemas/conversations'

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.PropsWithChildren<{ href: string; [k: string]: unknown }>) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('@/hooks/queries/useAssessments', () => ({
  useAccountConductAssessment: vi.fn(),
  useServiceabilityAssessment: vi.fn(),
}))

import { useAccountConductAssessment, useServiceabilityAssessment } from '@/hooks/queries/useAssessments'

// ─── helpers ──────────────────────────────────────────────────────────────────

function baseConversation(overrides: Partial<ConversationDetail> = {}): ConversationDetail {
  return {
    conversationId: 'conv-001',
    applicationNumber: 'APP-001',
    status: 'active',
    decisionStatus: null,
    finalDecision: null,
    customer: { fullName: 'Jane Smith', customerId: 'CUS-001' },
    application: { loanAmount: 5000, purpose: 'New car', term: 10 },
    utterances: [],
    noticeboard: [],
    assessments: {},
    messageCount: 5,
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AssessmentPanel
// ─────────────────────────────────────────────────────────────────────────────

describe('AssessmentPanel — identity summary', () => {
  afterEach(() => cleanup())

  it('shows ✓ Verified when identityRisk.decision is APPROVED', () => {
    const conversation = baseConversation({
      assessments: { identityRisk: { decision: 'APPROVED' } },
    })
    render(<AssessmentPanel conversation={conversation} conversationId="conv-001" />)
    expect(screen.getAllByText(/✓ Verified/).length).toBeGreaterThan(0)
  })

  it('shows ✓ Verified when identityRisk.decision is PASS', () => {
    const conversation = baseConversation({
      assessments: { identityRisk: { decision: 'PASS' } },
    })
    render(<AssessmentPanel conversation={conversation} conversationId="conv-001" />)
    expect(screen.getAllByText(/✓ Verified/).length).toBeGreaterThan(0)
  })

  it('shows ✓ Verified case-insensitively (approved lowercase)', () => {
    const conversation = baseConversation({
      assessments: { identityRisk: { decision: 'approved' } },
    })
    render(<AssessmentPanel conversation={conversation} conversationId="conv-001" />)
    expect(screen.getAllByText(/✓ Verified/).length).toBeGreaterThan(0)
  })

  it('shows ⚠ Refer when identityRisk.decision is DECLINED', () => {
    const conversation = baseConversation({
      assessments: { identityRisk: { decision: 'DECLINED' } },
    })
    render(<AssessmentPanel conversation={conversation} conversationId="conv-001" />)
    expect(screen.getAllByText(/⚠ Refer/).length).toBeGreaterThan(0)
  })

  it('shows ⚠ Refer when identityRisk.decision is an unknown value', () => {
    const conversation = baseConversation({
      assessments: { identityRisk: { decision: 'MANUAL_REVIEW' } },
    })
    render(<AssessmentPanel conversation={conversation} conversationId="conv-001" />)
    expect(screen.getAllByText(/⚠ Refer/).length).toBeGreaterThan(0)
  })

  it('shows "No data" when identityRisk is absent', () => {
    const conversation = baseConversation({ assessments: {} })
    render(<AssessmentPanel conversation={conversation} conversationId="conv-001" />)
    expect(screen.getAllByText('No data').length).toBeGreaterThan(0)
  })
})

describe('AssessmentPanel — application term label', () => {
  afterEach(() => cleanup())

  it('summary chip uses "d" suffix (e.g. "10d")', () => {
    const conversation = baseConversation({
      application: { loanAmount: 5000, purpose: 'Car', term: 10 },
    })
    const { container } = render(
      <AssessmentPanel conversation={conversation} conversationId="conv-001" />,
    )
    expect(container.textContent).toContain('10d')
  })

  it('expanded term row shows "days" label', async () => {
    const conversation = baseConversation({
      application: { loanAmount: 5000, purpose: 'Car', term: 10 },
    })
    render(<AssessmentPanel conversation={conversation} conversationId="conv-001" />)
    // Expand the Application section
    const appBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('Application'),
    )
    expect(appBtn).toBeTruthy()
    fireEvent.click(appBtn!)
    expect(screen.getAllByText(/10 days/).length).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AssessmentDetailView — loading / null states
// ─────────────────────────────────────────────────────────────────────────────

describe('AssessmentDetailView — loading and null states', () => {
  afterEach(() => cleanup())

  it('renders skeletons while loading', () => {
    vi.mocked(useAccountConductAssessment).mockReturnValue({
      data: undefined, isLoading: true, error: null,
    } as ReturnType<typeof useAccountConductAssessment>)
    vi.mocked(useServiceabilityAssessment).mockReturnValue({
      data: undefined, isLoading: true, error: null,
    } as ReturnType<typeof useServiceabilityAssessment>)

    const { container } = render(
      <AssessmentDetailView
        conversationId="conv-001"
        type="account-conduct"
        customerName="Jane Smith"
      />,
    )
    // Skeleton divs are present and the main content is not
    const skeletons = container.querySelectorAll('[aria-hidden="true"]')
    expect(skeletons.length).toBeGreaterThan(0)
    expect(screen.queryByText('PASS')).toBeNull()
  })

  it('shows "No assessment data" when assessment is null', () => {
    vi.mocked(useAccountConductAssessment).mockReturnValue({
      data: null, isLoading: false, error: null,
    } as ReturnType<typeof useAccountConductAssessment>)
    vi.mocked(useServiceabilityAssessment).mockReturnValue({
      data: undefined, isLoading: false, error: null,
    } as ReturnType<typeof useServiceabilityAssessment>)

    render(
      <AssessmentDetailView conversationId="conv-001" type="account-conduct" />,
    )
    expect(screen.getByText(/No assessment data available/)).toBeTruthy()
  })

  it('shows "No assessment data" when query errors', () => {
    vi.mocked(useAccountConductAssessment).mockReturnValue({
      data: undefined, isLoading: false, error: new Error('S3 error'),
    } as ReturnType<typeof useAccountConductAssessment>)
    vi.mocked(useServiceabilityAssessment).mockReturnValue({
      data: undefined, isLoading: false, error: null,
    } as ReturnType<typeof useServiceabilityAssessment>)

    render(
      <AssessmentDetailView conversationId="conv-001" type="account-conduct" />,
    )
    expect(screen.getByText(/No assessment data available/)).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AssessmentDetailView — decision banner
// ─────────────────────────────────────────────────────────────────────────────

describe('AssessmentDetailView — decision banner', () => {
  afterEach(() => cleanup())

  function renderWithDecision(decision: string, type: 'account-conduct' | 'serviceability' = 'account-conduct') {
    const assessment = { decision, rules: [] }
    if (type === 'account-conduct') {
      vi.mocked(useAccountConductAssessment).mockReturnValue({
        data: assessment, isLoading: false, error: null,
      } as ReturnType<typeof useAccountConductAssessment>)
      vi.mocked(useServiceabilityAssessment).mockReturnValue({
        data: undefined, isLoading: false, error: null,
      } as ReturnType<typeof useServiceabilityAssessment>)
    } else {
      vi.mocked(useServiceabilityAssessment).mockReturnValue({
        data: assessment, isLoading: false, error: null,
      } as ReturnType<typeof useServiceabilityAssessment>)
      vi.mocked(useAccountConductAssessment).mockReturnValue({
        data: undefined, isLoading: false, error: null,
      } as ReturnType<typeof useAccountConductAssessment>)
    }
    return render(
      <AssessmentDetailView conversationId="conv-001" type={type} />,
    )
  }

  it('shows decision value in uppercase', () => {
    renderWithDecision('pass')
    expect(screen.getByText('PASS')).toBeTruthy()
  })

  it('PASS decision applies green (decisionPass) class', () => {
    const { container } = renderWithDecision('PASS')
    const banner = container.querySelector('[class*="decisionBanner"]')
    expect(banner?.className).toContain('decisionPass')
  })

  it('APPROVED decision applies green (decisionPass) class', () => {
    const { container } = renderWithDecision('APPROVED')
    const banner = container.querySelector('[class*="decisionBanner"]')
    expect(banner?.className).toContain('decisionPass')
  })

  it('DECLINED decision applies red (decisionFail) class', () => {
    const { container } = renderWithDecision('DECLINED')
    const banner = container.querySelector('[class*="decisionBanner"]')
    expect(banner?.className).toContain('decisionFail')
  })

  it('FAIL decision applies red (decisionFail) class', () => {
    const { container } = renderWithDecision('FAIL')
    const banner = container.querySelector('[class*="decisionBanner"]')
    expect(banner?.className).toContain('decisionFail')
  })

  it('HARD_DECLINE decision applies red (decisionFail) class', () => {
    const { container } = renderWithDecision('HARD_DECLINE')
    const banner = container.querySelector('[class*="decisionBanner"]')
    expect(banner?.className).toContain('decisionFail')
  })

  it('REFER decision applies amber (decisionRefer) class', () => {
    const { container } = renderWithDecision('REFER')
    const banner = container.querySelector('[class*="decisionBanner"]')
    expect(banner?.className).toContain('decisionRefer')
  })

  it('shows score when present', () => {
    const assessment = { decision: 'PASS', totalScore: 85, rules: [] }
    vi.mocked(useAccountConductAssessment).mockReturnValue({
      data: assessment, isLoading: false, error: null,
    } as ReturnType<typeof useAccountConductAssessment>)
    vi.mocked(useServiceabilityAssessment).mockReturnValue({
      data: undefined, isLoading: false, error: null,
    } as ReturnType<typeof useServiceabilityAssessment>)

    render(<AssessmentDetailView conversationId="conv-001" type="account-conduct" />)
    expect(screen.getByText('85')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AssessmentDetailView — rules table
// ─────────────────────────────────────────────────────────────────────────────

describe('AssessmentDetailView — rules table', () => {
  afterEach(() => cleanup())

  function renderWithRules(rules: Record<string, unknown>[]) {
    vi.mocked(useAccountConductAssessment).mockReturnValue({
      data: { decision: 'PASS', rules },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useAccountConductAssessment>)
    vi.mocked(useServiceabilityAssessment).mockReturnValue({
      data: undefined, isLoading: false, error: null,
    } as ReturnType<typeof useServiceabilityAssessment>)
    return render(
      <AssessmentDetailView conversationId="conv-001" type="account-conduct" />,
    )
  }

  it('renders each rule name', () => {
    renderWithRules([
      { name: 'creditHistoryCheck', result: 'PASS' },
      { name: 'defaultCheck', result: 'FAIL' },
    ])
    // formatFieldName converts camelCase to "Credit History Check"
    expect(screen.getByText(/Credit History Check/i)).toBeTruthy()
    expect(screen.getByText(/Default Check/i)).toBeTruthy()
  })

  it('PASS rule applies badgePass class', () => {
    const { container } = renderWithRules([{ name: 'rule1', result: 'PASS' }])
    const badge = container.querySelector('[class*="badgePass"]')
    expect(badge).toBeTruthy()
    expect(badge?.textContent).toBe('PASS')
  })

  it('FAIL rule applies badgeFail class', () => {
    const { container } = renderWithRules([{ name: 'rule1', result: 'FAIL' }])
    const badge = container.querySelector('[class*="badgeFail"]')
    expect(badge).toBeTruthy()
    expect(badge?.textContent).toBe('FAIL')
  })

  it('boolean true result maps to PASS badge', () => {
    const { container } = renderWithRules([{ name: 'rule1', passed: true }])
    const badge = container.querySelector('[class*="badgePass"]')
    expect(badge).toBeTruthy()
  })

  it('boolean false result maps to FAIL badge', () => {
    const { container } = renderWithRules([{ name: 'rule1', passed: false }])
    const badge = container.querySelector('[class*="badgeFail"]')
    expect(badge).toBeTruthy()
  })

  it('shows rule count badge', () => {
    const { container } = renderWithRules([
      { name: 'r1', result: 'PASS' },
      { name: 'r2', result: 'FAIL' },
      { name: 'r3', result: 'PASS' },
    ])
    const countBadge = container.querySelector('[class*="ruleCount"]')
    expect(countBadge?.textContent).toBe('3')
  })

  it('does not render rules section when rules array is empty', () => {
    renderWithRules([])
    // Section title "Conduct Checks" should not appear
    expect(screen.queryByText(/Conduct Checks/i)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AssessmentDetailView — serviceability financial metrics
// ─────────────────────────────────────────────────────────────────────────────

describe('AssessmentDetailView — serviceability financial metrics', () => {
  afterEach(() => cleanup())

  // Real serviceability format (matches actual S3 JSON structure)
  function makeSvcAssessment(surplusValue: number) {
    return {
      application_number: 'APP-001',
      decision: surplusValue >= 0 ? 'PASS' : 'DECLINED',
      assessment_date: '2026-04-04T03:03:35.826395',
      monthly_metrics: { avg_daily_loan_repayment: 20.48, days_loan_term: 10, cash_savings: 0 },
      rule_results: [{
        rule_id: 'SERVICEABILITY_RULE_001',
        description: 'Net income surplus must be non-negative',
        result: surplusValue >= 0 ? 'pass' : 'fail',
        data_value: surplusValue,
        condition: '>= 0',
        hard_rule: true,
        details: {
          avg_daily_income: 92.04,
          avg_daily_expenses: 135.33,
          avg_daily_loan_repayment: 20.48,
          days_loan_term: 10,
          cash_savings: 0,
        },
        reason: surplusValue < 0 ? `Net income surplus (${surplusValue}) is below threshold` : undefined,
      }],
      files_processed: [],
    }
  }

  function renderServiceability(assessment: Record<string, unknown>) {
    vi.mocked(useServiceabilityAssessment).mockReturnValue({
      data: assessment, isLoading: false, error: null,
    } as ReturnType<typeof useServiceabilityAssessment>)
    vi.mocked(useAccountConductAssessment).mockReturnValue({
      data: undefined, isLoading: false, error: null,
    } as ReturnType<typeof useAccountConductAssessment>)
    return render(
      <AssessmentDetailView conversationId="conv-001" type="serviceability" />,
    )
  }

  it('renders Cash Flow Over Loan Term section', () => {
    renderServiceability(makeSvcAssessment(500))
    expect(screen.getByText('Cash Flow Over Loan Term')).toBeTruthy()
  })

  it('shows Income, Living Expenses, Loan Repayment and Net Surplus labels', () => {
    renderServiceability(makeSvcAssessment(500))
    expect(screen.getByText('Income')).toBeTruthy()
    expect(screen.getByText('Living Expenses')).toBeTruthy()
    expect(screen.getByText('Net Surplus')).toBeTruthy()
  })

  it('positive surplus applies cashSurplusPos class', () => {
    const { container } = renderServiceability(makeSvcAssessment(500))
    const surplusCard = container.querySelector('[class*="cashSurplusPos"]')
    expect(surplusCard).toBeTruthy()
  })

  it('negative surplus applies cashSurplusNeg class', () => {
    const { container } = renderServiceability(makeSvcAssessment(-637.7))
    const surplusCard = container.querySelector('[class*="cashSurplusNeg"]')
    expect(surplusCard).toBeTruthy()
  })

  it('does not render cash flow section for account-conduct type', () => {
    vi.mocked(useAccountConductAssessment).mockReturnValue({
      data: { decision: 'PASS', account_conduct: { rule_results: [], warnings: [] } },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useAccountConductAssessment>)
    vi.mocked(useServiceabilityAssessment).mockReturnValue({
      data: undefined, isLoading: false, error: null,
    } as ReturnType<typeof useServiceabilityAssessment>)

    render(<AssessmentDetailView conversationId="conv-001" type="account-conduct" />)
    expect(screen.queryByText('Cash Flow Over Loan Term')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AssessmentDetailView — raw JSON toggle
// ─────────────────────────────────────────────────────────────────────────────

describe('AssessmentDetailView — raw JSON toggle', () => {
  afterEach(() => cleanup())

  it('raw JSON is hidden by default', () => {
    vi.mocked(useAccountConductAssessment).mockReturnValue({
      data: { decision: 'PASS' }, isLoading: false, error: null,
    } as ReturnType<typeof useAccountConductAssessment>)
    vi.mocked(useServiceabilityAssessment).mockReturnValue({
      data: undefined, isLoading: false, error: null,
    } as ReturnType<typeof useServiceabilityAssessment>)

    render(<AssessmentDetailView conversationId="conv-001" type="account-conduct" />)
    // The <pre> with raw JSON should not be present
    expect(screen.queryByText(/"decision": "PASS"/)).toBeNull()
  })

  it('raw JSON is visible after toggle', () => {
    vi.mocked(useAccountConductAssessment).mockReturnValue({
      data: { decision: 'PASS' }, isLoading: false, error: null,
    } as ReturnType<typeof useAccountConductAssessment>)
    vi.mocked(useServiceabilityAssessment).mockReturnValue({
      data: undefined, isLoading: false, error: null,
    } as ReturnType<typeof useServiceabilityAssessment>)

    render(<AssessmentDetailView conversationId="conv-001" type="account-conduct" />)
    const toggleBtn = screen.getByText(/Raw JSON data/)
    fireEvent.click(toggleBtn)
    expect(screen.getByText(/"decision": "PASS"/)).toBeTruthy()
  })

  it('raw JSON hides again after second toggle', () => {
    vi.mocked(useAccountConductAssessment).mockReturnValue({
      data: { decision: 'PASS' }, isLoading: false, error: null,
    } as ReturnType<typeof useAccountConductAssessment>)
    vi.mocked(useServiceabilityAssessment).mockReturnValue({
      data: undefined, isLoading: false, error: null,
    } as ReturnType<typeof useServiceabilityAssessment>)

    render(<AssessmentDetailView conversationId="conv-001" type="account-conduct" />)
    const toggleBtn = screen.getByText(/Raw JSON data/)
    fireEvent.click(toggleBtn)
    fireEvent.click(toggleBtn)
    expect(screen.queryByText(/"decision": "PASS"/)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AssessmentDetailView — flags and reasons
// ─────────────────────────────────────────────────────────────────────────────

describe('AssessmentDetailView — flags and decline reasons', () => {
  afterEach(() => cleanup())

  it('renders flags as chips', () => {
    vi.mocked(useAccountConductAssessment).mockReturnValue({
      data: { decision: 'FAIL', flags: ['DEFAULT_HISTORY', 'BANKRUPTCY'] },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useAccountConductAssessment>)
    vi.mocked(useServiceabilityAssessment).mockReturnValue({
      data: undefined, isLoading: false, error: null,
    } as ReturnType<typeof useServiceabilityAssessment>)

    const { container } = render(
      <AssessmentDetailView conversationId="conv-001" type="account-conduct" />,
    )
    const chips = container.querySelectorAll('[class*="flagChip"]')
    expect(chips.length).toBe(2)
    expect(chips[0].textContent).toBe('DEFAULT_HISTORY')
  })

  it('renders decline reasons', () => {
    vi.mocked(useAccountConductAssessment).mockReturnValue({
      data: { decision: 'DECLINED', reasons: ['Insufficient income', 'High debt'] },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useAccountConductAssessment>)
    vi.mocked(useServiceabilityAssessment).mockReturnValue({
      data: undefined, isLoading: false, error: null,
    } as ReturnType<typeof useServiceabilityAssessment>)

    render(<AssessmentDetailView conversationId="conv-001" type="account-conduct" />)
    expect(screen.getByText('Insufficient income')).toBeTruthy()
    expect(screen.getByText('High debt')).toBeTruthy()
  })

  it('renders single string reason', () => {
    vi.mocked(useAccountConductAssessment).mockReturnValue({
      data: { decision: 'DECLINED', reason: 'Previous default' },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useAccountConductAssessment>)
    vi.mocked(useServiceabilityAssessment).mockReturnValue({
      data: undefined, isLoading: false, error: null,
    } as ReturnType<typeof useServiceabilityAssessment>)

    render(<AssessmentDetailView conversationId="conv-001" type="account-conduct" />)
    expect(screen.getByText('Previous default')).toBeTruthy()
  })
})
