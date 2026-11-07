/**
 * Account conduct drill-through: a rule's figure opens the categories behind
 * it, and each category opens its categorised transactions.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import React from 'react'
import { AssessmentContent } from '@/components/ConversationDetailView/AssessmentDetailView'
import {
  CATEGORY_NAMES,
  DRILL_BY_RULE,
  breakdownByCategory,
  drillSpecFor,
  rebuildRatio,
  toDrillTransactions,
} from '@/components/ConversationDetailView/AssessmentDetailView/conductDrill'
import type { CsvData } from '@/hooks/queries/useStatementFile'

vi.mock('@/hooks/queries/useStatementFile', () => ({
  useStatementFile: vi.fn(),
}))

import { useStatementFile } from '@/hooks/queries/useStatementFile'

const mockedUseStatementFile = vi.mocked(useStatementFile)

// ─── fixtures ────────────────────────────────────────────────────────────────

const HEADERS = [
  'date',
  'description',
  'amount',
  'balance',
  'basiq_category',
  'basiq_confidence',
  'categorization_source',
  'income_pay_marker',
  'account_label',
  'dishonour_event_id',
  'debit_reversal',
  'tx_type',
  'rail_source',
  'bs_category',
  'bank_name',
  'account_number',
  'account_type',
]

function row(
  date: string,
  description: string,
  amount: number,
  category: string,
  opts: { source?: string; label?: string } = {},
): string[] {
  const r = HEADERS.map(() => '')
  r[HEADERS.indexOf('date')] = date
  r[HEADERS.indexOf('description')] = description
  r[HEADERS.indexOf('amount')] = String(amount)
  r[HEADERS.indexOf('basiq_category')] = category
  r[HEADERS.indexOf('categorization_source')] = opts.source ?? 'tier1'
  r[HEADERS.indexOf('account_label')] = opts.label ?? 'personal'
  r[HEADERS.indexOf('bank_name')] = 'Westpac'
  r[HEADERS.indexOf('account_number')] = 'xxxx1234'
  return r
}

function csv(rows: string[][], extra: Partial<CsvData> = {}): CsvData {
  return { headers: HEADERS, rows, totalRows: rows.length, truncated: false, ...extra }
}

// Leakage numerator: $300 ATM + $150 external transfer = $450 of debits.
// Denominator: all debits except EXP-071 = $450 + $550 groceries = $1,000.
const LEAKAGE_ROWS = [
  row('2026-10-01T09:00:00', 'ATM WITHDRAWAL', -200, 'EXP-001'),
  row('2026-10-05T09:00:00', 'ATM WITHDRAWAL', -100, 'EXP-001'),
  row('2026-10-03T09:00:00', 'TFR TO J SMITH', -150, 'EXP-013'),
  row('2026-10-02T09:00:00', 'WOOLWORTHS', -550, 'EXP-016'),
  row('2026-10-04T09:00:00', 'TFR TO OWN SAVER', -5000, 'EXP-071'),
  row('2026-10-06T09:00:00', 'SALARY ACME', 3000, 'INC-009'),
  // Business account: outside the assessment, must not count.
  row('2026-10-07T09:00:00', 'ATM BUSINESS', -900, 'EXP-001', { label: 'business' }),
]

// ─── pure logic ──────────────────────────────────────────────────────────────

describe('conduct drill — rows', () => {
  it('keeps personal and unlabelled rows and drops business or undetermined accounts', () => {
    const data = toDrillTransactions(
      csv([
        row('2026-10-01', 'A', -1, 'EXP-001', { label: 'personal' }),
        row('2026-10-01', 'B', -1, 'EXP-001', { label: '' }),
        row('2026-10-01', 'C', -1, 'EXP-001', { label: 'business' }),
        row('2026-10-01', 'D', -1, 'EXP-001', { label: 'undetermined' }),
      ]),
    )
    expect(data.rows.map((r) => r.description)).toEqual(['A', 'B'])
    expect(data.outOfScope).toBe(2)
  })

  it('reads columns by header name, not position', () => {
    const data = toDrillTransactions({
      headers: ['amount', 'basiq_category', 'date', 'description'],
      rows: [['-12.5', 'EXP-014', '2026-09-01', 'SPORTSBET']],
      totalRows: 1,
      truncated: false,
    })
    expect(data.rows[0]).toMatchObject({
      amount: -12.5,
      category: 'EXP-014',
      date: '2026-09-01',
      description: 'SPORTSBET',
    })
  })
})

describe('conduct drill — leakage ratio (G4)', () => {
  const spec = DRILL_BY_RULE.ACCOUNT_CONDUCT_RULE_006
  const { rows } = toDrillTransactions(csv(LEAKAGE_ROWS))

  it('rebuilds numerator and denominator from debit dollars, excluding EXP-071', () => {
    const ratio = rebuildRatio(rows, spec.ratio!)
    expect(ratio.numerator).toBe(450)
    expect(ratio.denominator).toBe(1000)
    expect(ratio.percent).toBeCloseTo(45, 5)
  })

  it('lists every leakage category, including one with no transactions', () => {
    const breakdown = breakdownByCategory(rows, spec.rows)
    expect(breakdown.map((b) => [b.category, b.transactions.length, b.total])).toEqual([
      ['EXP-001', 2, -300],
      ['EXP-013', 1, -150],
      ['EXP-062', 0, 0],
    ])
  })

  it('orders a category’s transactions newest first', () => {
    const atm = breakdownByCategory(rows, spec.rows).find((b) => b.category === 'EXP-001')!
    expect(atm.transactions.map((t) => t.date)).toEqual([
      '2026-10-05T09:00:00',
      '2026-10-01T09:00:00',
    ])
  })

  it('returns a null percentage when there are no debits', () => {
    expect(rebuildRatio([], spec.ratio!).percent).toBeNull()
  })
})

describe('conduct drill — source-prefix rules', () => {
  it('matches court-fine rows by categorisation source and keeps debits only', () => {
    const { rows } = toDrillTransactions(
      csv([
        row('2026-09-01', 'REVENUE NSW', -120, 'EXP-015', {
          source: 'risk_detector:CourtFine:RevenueNSW',
        }),
        row('2026-09-02', 'REVENUE NSW REFUND', 120, 'INC-032', {
          source: 'risk_detector:CourtFine:RevenueNSW',
        }),
        row('2026-09-03', 'COUNCIL RATES', -300, 'EXP-015'),
      ]),
    )
    const breakdown = breakdownByCategory(rows, DRILL_BY_RULE.ACCOUNT_CONDUCT_RULE_025.rows)
    expect(breakdown).toHaveLength(1)
    expect(breakdown[0].category).toBe('EXP-015')
    expect(breakdown[0].transactions.map((t) => t.description)).toEqual(['REVENUE NSW'])
  })
})

describe('conduct drill — rule lookup', () => {
  it('finds a spec by rule id', () => {
    expect(drillSpecFor({ rule_id: 'ACCOUNT_CONDUCT_RULE_008' })?.rows.categories).toEqual([
      'EXP-005',
    ])
  })

  it('falls back to the metric id when the rule id is unknown', () => {
    expect(drillSpecFor({ rule_id: 'RENUMBERED_RULE', metric_id: 'ME017' })).toBe(
      DRILL_BY_RULE.ACCOUNT_CONDUCT_RULE_003,
    )
  })

  it('returns nothing for a rule it has no mapping for', () => {
    expect(drillSpecFor({ rule_id: 'UNKNOWN', metric_id: 'ME999' })).toBeUndefined()
  })

  it('has a name for every category a rule reads', () => {
    const codes = Object.values(DRILL_BY_RULE).flatMap((s) => [
      ...(s.rows.categories ?? []),
      ...(s.ratio?.numerator.categories ?? []),
      ...(s.ratio?.denominator.excludeCategories ?? []),
    ])
    for (const code of codes) expect(CATEGORY_NAMES[code], code).toBeTruthy()
  })
})

// ─── UI ──────────────────────────────────────────────────────────────────────

const conductAssessment = {
  decision: 'DECLINED',
  account_conduct: {
    warnings: [],
    rule_results: [
      {
        rule_id: 'ACCOUNT_CONDUCT_RULE_006',
        description: 'DATA QUALITY GATE G4 — LEAKAGE ratio',
        data_value: 45,
        condition: '<= 30%',
        result: 'fail',
        hard_rule: true,
      },
      {
        rule_id: 'ACCOUNT_CONDUCT_RULE_999',
        description: 'A RULE WITH NO DRILL MAPPING',
        data_value: 3,
        condition: '>= 1',
        result: 'pass',
        hard_rule: true,
      },
    ],
  },
}

function mockCsv(data: CsvData | null, extra: { isLoading?: boolean; error?: Error } = {}) {
  mockedUseStatementFile.mockReturnValue({
    data: data ? { kind: 'csv', filename: 'x_categorized.csv', data } : data,
    isLoading: extra.isLoading ?? false,
    error: extra.error ?? null,
  } as unknown as ReturnType<typeof useStatementFile>)
}

function renderConduct(conversationId?: string) {
  return render(
    <AssessmentContent
      assessment={conductAssessment}
      type="account-conduct"
      conversationId={conversationId}
    />,
  )
}

describe('AssessmentContent — account conduct drill-through', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('makes a mapped figure a collapsed toggle and leaves an unmapped one as text', () => {
    mockCsv(csv(LEAKAGE_ROWS))
    renderConduct('conv-1')
    const toggle = screen.getByRole('button', { name: 'Breakdown for 45.00%' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Breakdown for 3' })).toBeNull()
    expect(screen.queryByTestId('conduct-drill')).toBeNull()
  })

  it('opens the categories, then a category’s transactions', () => {
    mockCsv(csv(LEAKAGE_ROWS))
    renderConduct('conv-1')

    const toggle = screen.getByRole('button', { name: 'Breakdown for 45.00%' })
    const ruleGroup = toggle.closest('[data-testid="conduct-rule"]')!
    expect(ruleGroup.className).not.toContain('ruleGroupOpen')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    // The open rule is marked as a group, and its breakdown sits inside it.
    expect(ruleGroup.className).toContain('ruleGroupOpen')
    const drill = screen.getByTestId('conduct-drill')
    expect(ruleGroup.contains(drill)).toBe(true)
    expect(mockedUseStatementFile).toHaveBeenCalledWith('conv-1', 'categorizedTransactions')
    expect(within(drill).getByText(/Leakage is money moved/)).toBeInTheDocument()
    expect(drill.textContent).toContain('$450.00 ÷ $1,000.00 = 45.00%')
    expect(drill.textContent).toContain('1 transaction is from accounts outside the assessment')

    // Empty category is listed but not expandable.
    expect(within(drill).getByText('Credit Card Transfers')).toBeInTheDocument()
    expect(within(drill).queryByRole('button', { name: /Credit Card Transfers/ })).toBeNull()

    const atm = within(drill).getByRole('button', { name: /ATM Withdrawals/ })
    expect(within(drill).queryByText('ATM WITHDRAWAL')).toBeNull()
    fireEvent.click(atm)
    expect(atm).toHaveAttribute('aria-expanded', 'true')
    // The open category and its transactions share one group.
    const categoryGroup = atm.closest('tbody')!
    expect(categoryGroup.className).toContain('drillCatGroupOpen')
    expect(within(categoryGroup).getAllByText('ATM WITHDRAWAL')).toHaveLength(2)
    expect(within(drill).getAllByText('ATM WITHDRAWAL')).toHaveLength(2)
    expect(within(drill).queryByText('ATM BUSINESS')).toBeNull()
  })

  it('has no drill toggles when no application id is supplied', () => {
    mockCsv(csv(LEAKAGE_ROWS))
    renderConduct(undefined)
    expect(screen.queryByRole('button', { name: /^Breakdown for/ })).toBeNull()
  })

  it('says so when the categorised transactions file is missing', () => {
    mockCsv(null)
    renderConduct('conv-1')
    fireEvent.click(screen.getByRole('button', { name: /^Breakdown for/ }))
    expect(
      screen.getByText('The categorised transactions file is not available for this application.'),
    ).toBeInTheDocument()
  })

  it('warns that totals may be short when the file was truncated', () => {
    mockCsv(csv(LEAKAGE_ROWS, { totalRows: 2500, truncated: true }))
    renderConduct('conv-1')
    fireEvent.click(screen.getByRole('button', { name: /^Breakdown for/ }))
    expect(screen.getByTestId('conduct-drill').textContent).toContain(
      'Only the first 7 of 2,500 transactions are loaded',
    )
  })
})
