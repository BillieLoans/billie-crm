/**
 * Drill-through for the account conduct assessment: which transaction
 * categories sit behind each rule, and which categorised transactions sit
 * behind each category.
 *
 * The assessment payload names a rule's metric (`metric_id`) but not the
 * categories that metric reads, so this file carries that mapping by hand —
 * the same arrangement as `StatementFileViewer/metricCatalog.ts`. Sources of
 * truth, all in billieChat:
 *   - rule config: backend/.../creditAssessmentAgent/businessRules/accountConductRules.json
 *   - metric inputs: categoriser/.../transformer/metrics/{income,risk_metrics}_calculator.py
 *   - category groups: categoriser/.../transformer/config/metrics_config.yaml
 *   - category names: categoriser/.../transformer/config/basiq_groups.yaml
 * If the engine changes which categories a rule reads, update DRILL_BY_RULE.
 *
 * The rows come from the categorised-transactions CSV. That file also holds
 * rows from accounts the engine leaves out of the assessment (BTB-496 business
 * or undetermined accounts), so `toDrillTransactions` drops them the same way
 * the categoriser's `in_scope` does.
 */

import type { CsvData } from '@/hooks/queries/useStatementFile'

// ─── Category names ──────────────────────────────────────────────────────────

export const CATEGORY_NAMES: Record<string, string> = {
  'EXP-001': 'ATM Withdrawals',
  'EXP-002': 'Automotive',
  'EXP-003': 'Cash Advances',
  'EXP-004': 'Childrens Retail and Gaming',
  'EXP-005': 'Collection Agencies',
  'EXP-006': 'Debt Interest Accrual',
  'EXP-007': 'Department Stores',
  'EXP-008': 'Dining Out',
  'EXP-009': 'Dishonours',
  'EXP-010': 'Donations',
  'EXP-011': 'Education and Childcare',
  'EXP-012': 'Entertainment',
  'EXP-013': 'External Transfers',
  'EXP-014': 'Gambling',
  'EXP-015': 'Government & Council Services',
  'EXP-016': 'Groceries',
  'EXP-017': 'Gyms and memberships',
  'EXP-018': 'Medical',
  'EXP-019': 'Home Improvement',
  'EXP-020': 'Insolvency',
  'EXP-021': 'Insurance',
  'EXP-023': 'Motor Finance',
  'EXP-024': 'Online Retail',
  'EXP-025': 'Other Finance',
  'EXP-026': 'Peer to Peer Finance',
  'EXP-027': 'Personal Care',
  'EXP-028': 'Pet Care',
  'EXP-029': 'Redraws',
  'EXP-030': 'Rent',
  'EXP-031': 'Retail',
  'EXP-032': 'Returns & Refunds',
  'EXP-033': 'Small Amount Lending',
  'EXP-034': 'Superannuation',
  'EXP-035': 'Subscription Media & Software',
  'EXP-036': 'Telecommunication',
  'EXP-038': 'Travel',
  'EXP-039': 'Uncategorised Debits',
  'EXP-040': 'Utilities',
  'EXP-041': 'Vehicle and Transport',
  'EXP-043': 'Charities and Donations',
  'EXP-051': 'Alcohol and Tobacco',
  'EXP-052': 'Sports and Hobbies',
  'EXP-054': 'Other Categorised',
  'EXP-055': 'Clothing and Footwear',
  'EXP-056': 'Mortgage Repayments',
  'EXP-057': 'Loan Repayments',
  'EXP-058': 'Mortgage Transfers',
  'EXP-061': 'Credit Card Repayments',
  'EXP-062': 'Credit Card Transfers',
  'EXP-063': 'Loan Transfers',
  'EXP-064': 'Debt Assistance',
  'EXP-065': 'Dishonour Refunds',
  'EXP-066': 'Wage Advance / Pay Advance / BNPL',
  'EXP-067': 'No Interest Loans (NILS)',
  'EXP-068': 'ADI Bank',
  'EXP-069': 'Other Lenders',
  'EXP-070': 'Broker Services',
  'EXP-071': 'Internal/Debt-Account Debit (ignored)',
  'INC-001': 'Benefits',
  'INC-002': 'Child Support Income',
  'INC-003': 'Insurance Credits',
  'INC-004': 'Interest Income',
  'INC-005': 'Investment Income',
  'INC-006': 'Other Earnings',
  'INC-007': 'Other Credits',
  'INC-008': 'Rent & Board Income',
  'INC-009': 'Salary',
  'INC-010': 'Superannuation Credits',
  'INC-011': 'Other Lender Proceeds',
  'INC-012': 'Youth Allowance',
  'INC-013': 'Rental Assistance',
  'INC-014': 'Centrelink',
  'INC-015': 'Medicare',
  'INC-016': 'Jobseeker',
  'INC-017': 'Disability Support',
  'INC-018': 'Pension',
  'INC-019': 'Carers',
  'INC-020': 'Education',
  'INC-021': 'Crisis Support',
  'INC-022': 'Gambling Winnings',
  'INC-023': 'SACC Loan Proceeds',
  'INC-024': 'BNPL Credits',
  'INC-025': 'Mortgage Draws',
  'INC-026': 'High-Risk Lender Proceeds',
  'INC-027': 'Collection Agency Credits',
  'INC-028': 'Insolvency Credits',
  'INC-029': 'Debt Assistance Credits',
  'INC-030': 'Cash Deposits',
  'INC-031': 'Gig Economy Income',
  'INC-032': 'Refunds & Reversals',
  'INC-033': 'Credit Card Credit (ignored)',
  'INC-034': 'Internal/Debt-Account Credit (ignored)',
  'INC-035': 'Non-Commercial Credit (ignored)',
  'OTH-001': 'Notification',
}

export function categoryName(code: string): string {
  return CATEGORY_NAMES[code] ?? 'Unknown category'
}

// ─── Rule → categories ───────────────────────────────────────────────────────

/** Which categorised rows count towards a figure. */
export interface RowMatch {
  /** Rows in any of these categories. Ignored when `allCategories` is set. */
  categories?: readonly string[]
  /** Rows in every category (less `excludeCategories`). */
  allCategories?: boolean
  excludeCategories?: readonly string[]
  /** Rows whose `categorization_source` starts with this prefix. */
  sourcePrefix?: string
  /** Debits are negative amounts, credits positive. Omit for both. */
  sign?: 'debit' | 'credit'
}

export interface ConductDrillSpec {
  /** How the listed rows relate to the rule's figure. */
  note: string
  /** The contributing rows, grouped by category in the breakdown. */
  rows: RowMatch
  /**
   * Set when the figure is a dollar ratio the CRM can rebuild from the rows.
   * The breakdown then shows numerator ÷ denominator.
   */
  ratio?: { numerator: RowMatch; denominator: RowMatch }
}

// PAY income (CLEAN spec Rule #1): metrics_config.yaml `pay_income_groups`.
const PAY_INCOME = ['INC-006', 'INC-007', 'INC-009', 'INC-031'] as const

// The 11 government benefit codes behind ME064 (government_services_calculator.py).
const GOVERNMENT_BENEFITS = [
  'INC-001',
  'INC-012',
  'INC-013',
  'INC-014',
  'INC-015',
  'INC-016',
  'INC-017',
  'INC-018',
  'INC-019',
  'INC-020',
  'INC-021',
] as const

const SACC_REPAYMENTS: RowMatch = { categories: ['EXP-033'], sign: 'debit' }

const ALL_DEBITS: RowMatch = { allCategories: true, sign: 'debit' }

/** Keyed by `rule_id` as it appears in `account_conduct.rule_results`. */
export const DRILL_BY_RULE: Record<string, ConductDrillSpec> = {
  ACCOUNT_CONDUCT_RULE_001: {
    note: 'The figure counts distinct payers among PAY-income credits. Every credit in a PAY category is listed. The engine also drops a few rows by their bank-supplied category, so payers and rows may not line up exactly.',
    rows: { categories: PAY_INCOME, sign: 'credit' },
  },
  ACCOUNT_CONDUCT_RULE_002: {
    note: 'The figure counts how many of the last 3 complete calendar months hold at least one PAY-income credit. Every credit in a PAY category is listed.',
    rows: { categories: PAY_INCOME, sign: 'credit' },
  },
  ACCOUNT_CONDUCT_RULE_003: {
    note: 'The figure is the most distinct SACC lenders repaid in any one calendar month. Every SACC repayment is listed, newest first, so the busiest month can be read off the dates.',
    rows: SACC_REPAYMENTS,
  },
  ACCOUNT_CONDUCT_RULE_004: {
    note: 'The figure counts dishonour events. A bounced debit, its reversal and its fee count once. Dishonour fees and dishonour refunds are listed.',
    rows: { categories: ['EXP-009', 'EXP-065'] },
  },
  ACCOUNT_CONDUCT_RULE_005: {
    note: 'The figure is gambling spend as a share of total income across the window. Gambling debits are listed.',
    rows: { categories: ['EXP-014'], sign: 'debit' },
  },
  ACCOUNT_CONDUCT_RULE_006: {
    note: 'Leakage is money moved to accounts we cannot see: ATM cash, external transfers and credit-card transfers, as a share of all debits except netted internal transfers.',
    rows: { categories: ['EXP-001', 'EXP-013', 'EXP-062'], sign: 'debit' },
    ratio: {
      numerator: { categories: ['EXP-001', 'EXP-013', 'EXP-062'], sign: 'debit' },
      denominator: { allCategories: true, excludeCategories: ['EXP-071'], sign: 'debit' },
    },
  },
  ACCOUNT_CONDUCT_RULE_008: {
    note: 'Any transaction in this category fails the check.',
    rows: { categories: ['EXP-005'] },
  },
  ACCOUNT_CONDUCT_RULE_009: {
    note: 'The check needs transactions in at least 3 of these living-expense categories.',
    rows: {
      categories: [
        'EXP-002',
        'EXP-011',
        'EXP-015',
        'EXP-016',
        'EXP-018',
        'EXP-021',
        'EXP-030',
        'EXP-036',
        'EXP-040',
        'EXP-041',
      ],
    },
  },
  ACCOUNT_CONDUCT_RULE_010: {
    note: 'Any transaction in this category fails the check.',
    rows: { categories: ['EXP-020'] },
  },
  ACCOUNT_CONDUCT_RULE_011: {
    note: 'The figure is government benefit credits divided by total income across the window. Benefit credits are listed.',
    rows: { categories: GOVERNMENT_BENEFITS, sign: 'credit' },
  },
  ACCOUNT_CONDUCT_RULE_013: {
    note: 'Any transaction in this category fails the check.',
    rows: { categories: ['EXP-067'] },
  },
  ACCOUNT_CONDUCT_RULE_020: {
    note: 'The figure is the worst single month of SACC repayments as a share of that month’s income. Every SACC repayment is listed.',
    rows: SACC_REPAYMENTS,
  },
  ACCOUNT_CONDUCT_RULE_023: {
    note: 'Any transaction in this category fails the check.',
    rows: { categories: ['EXP-064'] },
  },
  ACCOUNT_CONDUCT_RULE_024: {
    note: 'Rows the categoriser matched as garnishee or wage-attachment orders.',
    rows: { sourcePrefix: 'risk_detector:Garnishee:' },
  },
  ACCOUNT_CONDUCT_RULE_025: {
    note: 'The figure counts distinct fines, so instalments of one fine to one agency count once. Every court-fine payment is listed.',
    rows: { sourcePrefix: 'risk_detector:CourtFine:', sign: 'debit' },
  },
  ACCOUNT_CONDUCT_RULE_026: {
    note: 'Uncategorised debit dollars as a share of all debit dollars.',
    rows: { categories: ['EXP-039'], sign: 'debit' },
    ratio: {
      numerator: { categories: ['EXP-039'], sign: 'debit' },
      denominator: ALL_DEBITS,
    },
  },
}

/**
 * Fallback for payloads whose rule ids differ from today's config but still
 * name the metric — keeps the drill working across rule renumbering.
 */
const DRILL_BY_METRIC: Record<string, string> = {
  ME001: 'ACCOUNT_CONDUCT_RULE_001',
  ME003: 'ACCOUNT_CONDUCT_RULE_002',
  ME017: 'ACCOUNT_CONDUCT_RULE_003',
  ME068: 'ACCOUNT_CONDUCT_RULE_004',
  ME020: 'ACCOUNT_CONDUCT_RULE_005',
  ME056: 'ACCOUNT_CONDUCT_RULE_020',
  ME061: 'ACCOUNT_CONDUCT_RULE_024',
  ME062: 'ACCOUNT_CONDUCT_RULE_025',
}

export function drillSpecFor(rule: {
  rule_id?: string
  metric_id?: string
}): ConductDrillSpec | undefined {
  if (rule.rule_id && DRILL_BY_RULE[rule.rule_id]) return DRILL_BY_RULE[rule.rule_id]
  const viaMetric = rule.metric_id ? DRILL_BY_METRIC[rule.metric_id] : undefined
  return viaMetric ? DRILL_BY_RULE[viaMetric] : undefined
}

// ─── Rows ────────────────────────────────────────────────────────────────────

export interface DrillTransaction {
  date: string
  description: string
  amount: number
  category: string
  source: string
  account: string
}

export interface DrillTransactions {
  rows: DrillTransaction[]
  /** Rows dropped because their account is outside the assessment. */
  outOfScope: number
}

/**
 * Turn the parsed CSV into typed rows, keeping only the rows the engine
 * assessed. The categoriser's `in_scope` keeps a row when its account is
 * labelled `personal` or carries no label; `business` and `undetermined`
 * accounts are left out.
 */
export function toDrillTransactions(csv: CsvData): DrillTransactions {
  const col = (name: string) => csv.headers.indexOf(name)
  const iDate = col('date')
  const iDesc = col('description')
  const iAmount = col('amount')
  const iCategory = col('basiq_category')
  const iSource = col('categorization_source')
  const iLabel = col('account_label')
  const iBank = col('bank_name')
  const iAccount = col('account_number')

  const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '')

  const rows: DrillTransaction[] = []
  let outOfScope = 0
  for (const row of csv.rows) {
    const label = cell(row, iLabel).toLowerCase()
    if (label !== '' && label !== 'personal') {
      outOfScope += 1
      continue
    }
    const amount = parseFloat(cell(row, iAmount))
    rows.push({
      date: cell(row, iDate),
      description: cell(row, iDesc),
      amount: Number.isFinite(amount) ? amount : 0,
      category: cell(row, iCategory),
      source: cell(row, iSource),
      account: [cell(row, iBank), cell(row, iAccount)].filter(Boolean).join(' '),
    })
  }
  return { rows, outOfScope }
}

export function matches(tx: DrillTransaction, m: RowMatch): boolean {
  if (m.sign === 'debit' && !(tx.amount < 0)) return false
  if (m.sign === 'credit' && !(tx.amount > 0)) return false
  if (m.sourcePrefix && !tx.source.startsWith(m.sourcePrefix)) return false
  if (m.excludeCategories?.includes(tx.category)) return false
  if (m.allCategories) return true
  if (m.categories) return m.categories.includes(tx.category)
  // A source-prefix match with no category list takes any category.
  return Boolean(m.sourcePrefix)
}

export interface CategoryBreakdown {
  category: string
  transactions: DrillTransaction[]
  /** Signed sum of the rows' amounts. */
  total: number
}

/**
 * Group the matching rows by category, newest transaction first. Categories a
 * rule names are always listed, so an empty one reads as "none found" rather
 * than disappearing; a source-prefix rule lists only the categories it hit.
 */
export function breakdownByCategory(rows: DrillTransaction[], m: RowMatch): CategoryBreakdown[] {
  const byCategory = new Map<string, DrillTransaction[]>()
  if (!m.allCategories) for (const c of m.categories ?? []) byCategory.set(c, [])
  for (const tx of rows) {
    if (!matches(tx, m)) continue
    const key = tx.category || '—'
    const list = byCategory.get(key) ?? []
    list.push(tx)
    byCategory.set(key, list)
  }
  return Array.from(byCategory, ([category, transactions]) => ({
    category,
    transactions: [...transactions].sort(byDateDesc),
    total: transactions.reduce((sum, tx) => sum + tx.amount, 0),
  }))
}

function byDateDesc(a: DrillTransaction, b: DrillTransaction): number {
  return b.date.localeCompare(a.date)
}

export interface RebuiltRatio {
  numerator: number
  denominator: number
  /** Percentage, or null when the denominator is zero. */
  percent: number | null
}

/** Dollar ratio from absolute sums, matching the engine's debit-dollar ratios. */
export function rebuildRatio(
  rows: DrillTransaction[],
  ratio: { numerator: RowMatch; denominator: RowMatch },
): RebuiltRatio {
  const sum = (m: RowMatch) =>
    rows.reduce((acc, tx) => (matches(tx, m) ? acc + Math.abs(tx.amount) : acc), 0)
  const numerator = sum(ratio.numerator)
  const denominator = sum(ratio.denominator)
  return {
    numerator,
    denominator,
    percent: denominator > 0 ? (numerator / denominator) * 100 : null,
  }
}
