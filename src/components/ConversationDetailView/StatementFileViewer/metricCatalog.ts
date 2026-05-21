/**
 * Catalog of BASIQ affordability metrics emitted by the categoriser.
 *
 * Source of truth: billieChat/categoriser/categoriser/src/transformer/metrics/README.md
 * (kept in sync manually — if the categoriser adds new MEs, list them here
 * with a label and a `kind` so the viewer formats values correctly.)
 */

export type MetricKind = 'money' | 'percent' | 'integer' | 'boolean'

export type MetricCategory =
  | 'Income Sources'
  | 'Expenses'
  | 'Financial Commitments'
  | 'Government Services'
  | 'Risk Flags'
  | 'Risk Metrics'

export interface MetricMeta {
  id: string
  label: string
  kind: MetricKind
  category: MetricCategory
}

export const METRIC_CATALOG: Record<string, MetricMeta> = {
  // Expenses
  ME012: { id: 'ME012', label: 'Monthly spend on non-discretionary expenses', kind: 'money', category: 'Expenses' },
  ME013: { id: 'ME013', label: '% of spend on non-discretionary expenses', kind: 'percent', category: 'Expenses' },
  ME014: { id: 'ME014', label: 'Monthly spend on discretionary expenses', kind: 'money', category: 'Expenses' },
  ME015: { id: 'ME015', label: '% of spend on discretionary expenses', kind: 'percent', category: 'Expenses' },
  ME016: { id: 'ME016', label: 'Monthly spend on other expenses', kind: 'money', category: 'Expenses' },
  ME034: { id: 'ME034', label: 'Average outgoings monthly', kind: 'money', category: 'Expenses' },
  ME039: { id: 'ME039', label: 'Average outgoings excl. liabilities', kind: 'money', category: 'Expenses' },

  // Income Sources
  ME001: { id: 'ME001', label: '# of identified salary sources', kind: 'integer', category: 'Income Sources' },
  ME002: { id: 'ME002', label: 'Average monthly amount from salary', kind: 'money', category: 'Income Sources' },
  ME003: { id: 'ME003', label: 'Salary stable for (months)', kind: 'integer', category: 'Income Sources' },
  ME004: { id: 'ME004', label: 'Other possible income monthly', kind: 'money', category: 'Income Sources' },
  ME033: { id: 'ME033', label: 'Average income monthly (salary only)', kind: 'money', category: 'Income Sources' },
  ME035: { id: 'ME035', label: 'Total income stable for (months)', kind: 'integer', category: 'Income Sources' },
  ME036: { id: 'ME036', label: 'Median monthly amount from salary', kind: 'money', category: 'Income Sources' },
  ME037: { id: 'ME037', label: 'Median income monthly (salary only)', kind: 'money', category: 'Income Sources' },
  ME040: { id: 'ME040', label: 'Average monthly credits (all income)', kind: 'money', category: 'Income Sources' },
  ME041: { id: 'ME041', label: 'Average monthly debits', kind: 'money', category: 'Income Sources' },
  ME042: { id: 'ME042', label: '# of recent income sources', kind: 'integer', category: 'Income Sources' },
  ME043: { id: 'ME043', label: '# of ongoing regular income sources', kind: 'integer', category: 'Income Sources' },
  ME045: { id: 'ME045', label: 'Total income secure for (months)', kind: 'integer', category: 'Income Sources' },
  ME063: { id: 'ME063', label: 'Average monthly credits (extended)', kind: 'money', category: 'Income Sources' },
  ME065: { id: 'ME065', label: 'Total credits (period)', kind: 'money', category: 'Income Sources' },

  // Financial Commitments
  ME008: { id: 'ME008', label: 'Average monthly amount to lenders', kind: 'money', category: 'Financial Commitments' },
  ME009: { id: 'ME009', label: '# of identified lending companies', kind: 'integer', category: 'Financial Commitments' },
  ME010: { id: 'ME010', label: 'Total credit card limit', kind: 'money', category: 'Financial Commitments' },
  ME011: { id: 'ME011', label: 'Total credit card balance', kind: 'money', category: 'Financial Commitments' },
  ME046: { id: 'ME046', label: 'Average ongoing monthly amount to lenders', kind: 'money', category: 'Financial Commitments' },
  ME048: { id: 'ME048', label: 'Ongoing monthly mortgage repayment', kind: 'money', category: 'Financial Commitments' },

  // Government Services
  ME005: { id: 'ME005', label: 'Youth Allowance monthly', kind: 'money', category: 'Government Services' },
  ME006: { id: 'ME006', label: 'Rental Assistance monthly', kind: 'money', category: 'Government Services' },
  ME007: { id: 'ME007', label: 'Misc government services monthly', kind: 'money', category: 'Government Services' },
  ME064: { id: 'ME064', label: 'Government benefits monthly', kind: 'money', category: 'Government Services' },

  // Risk Flags
  ME022: { id: 'ME022', label: 'Recent changes to salary circumstances', kind: 'boolean', category: 'Risk Flags' },
  ME023: { id: 'ME023', label: 'Received crisis support payments', kind: 'boolean', category: 'Risk Flags' },
  ME024: { id: 'ME024', label: 'Has superannuation credits', kind: 'boolean', category: 'Risk Flags' },
  ME025: { id: 'ME025', label: 'Has cash advances', kind: 'boolean', category: 'Risk Flags' },
  ME026: { id: 'ME026', label: 'Has redraws', kind: 'boolean', category: 'Risk Flags' },
  ME027: { id: 'ME027', label: 'Has high-cost finance', kind: 'boolean', category: 'Risk Flags' },
  ME028: { id: 'ME028', label: 'Missing non-discretionary: groceries', kind: 'boolean', category: 'Risk Flags' },
  ME029: { id: 'ME029', label: 'Missing non-discretionary: telecommunications', kind: 'boolean', category: 'Risk Flags' },
  ME030: { id: 'ME030', label: 'Missing non-discretionary: utilities', kind: 'boolean', category: 'Risk Flags' },
  ME031: { id: 'ME031', label: 'Has unemployment benefit', kind: 'boolean', category: 'Risk Flags' },
  ME032: { id: 'ME032', label: 'Receives child support', kind: 'boolean', category: 'Risk Flags' },
  ME047: { id: 'ME047', label: 'Has unshared mortgage account', kind: 'boolean', category: 'Risk Flags' },

  // Risk Metrics
  ME017: { id: 'ME017', label: '# of SACC loans', kind: 'integer', category: 'Risk Metrics' },
  ME018: { id: 'ME018', label: '% of income withdrawn via ATM', kind: 'percent', category: 'Risk Metrics' },
  ME019: { id: 'ME019', label: '# of financial dishonours', kind: 'integer', category: 'Risk Metrics' },
  ME020: { id: 'ME020', label: '% of income spent on high-risk activities', kind: 'percent', category: 'Risk Metrics' },
  ME021: { id: 'ME021', label: 'Total spend on high-risk activities', kind: 'money', category: 'Risk Metrics' },
  ME049: { id: 'ME049', label: '# of high-risk SACC indicators', kind: 'integer', category: 'Risk Metrics' },
  ME050: { id: 'ME050', label: '# of high-risk gambling indicators', kind: 'integer', category: 'Risk Metrics' },
  ME051: { id: 'ME051', label: 'Average SACC repayment monthly', kind: 'money', category: 'Risk Metrics' },
  ME052: { id: 'ME052', label: 'Average gambling spend monthly', kind: 'money', category: 'Risk Metrics' },
  ME053: { id: 'ME053', label: 'SACC repayment as % of income', kind: 'percent', category: 'Risk Metrics' },
  ME054: { id: 'ME054', label: '# of BNPL providers', kind: 'integer', category: 'Risk Metrics' },
  ME055: { id: 'ME055', label: '# of BNPL transactions', kind: 'integer', category: 'Risk Metrics' },
  ME056: { id: 'ME056', label: 'SACC repayment burden as % of income', kind: 'percent', category: 'Risk Metrics' },
  ME057: { id: 'ME057', label: '# of cash-advance indicators', kind: 'integer', category: 'Risk Metrics' },
  ME058: { id: 'ME058', label: '# of redraw indicators', kind: 'integer', category: 'Risk Metrics' },
  ME059: { id: 'ME059', label: 'Days since last dishonour', kind: 'integer', category: 'Risk Metrics' },
  ME061: { id: 'ME061', label: 'Garnishee pattern count', kind: 'integer', category: 'Risk Metrics' },
  ME062: { id: 'ME062', label: 'Court-fine pattern count', kind: 'integer', category: 'Risk Metrics' },
}

export const METRIC_CATEGORY_ORDER: MetricCategory[] = [
  'Income Sources',
  'Expenses',
  'Financial Commitments',
  'Government Services',
  'Risk Flags',
  'Risk Metrics',
]
