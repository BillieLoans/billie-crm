'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAccountConductAssessment, useServiceabilityAssessment } from '@/hooks/queries/useAssessments'
import { formatCurrency } from '@/lib/formatters'
import styles from './styles.module.css'

type AssessmentType = 'account-conduct' | 'serviceability'

interface AssessmentDetailViewProps {
  conversationId: string
  type: AssessmentType
  customerName?: string
  applicationNumber?: string
}

const TITLE_MAP: Record<AssessmentType, string> = {
  'account-conduct': 'Account Conduct Assessment',
  'serviceability': 'Serviceability Assessment',
}

export function AssessmentDetailView({
  conversationId,
  type,
  customerName,
  applicationNumber,
}: AssessmentDetailViewProps) {
  const router = useRouter()
  const title = TITLE_MAP[type]

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') router.push(`/admin/applications/${conversationId}`)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [router, conversationId])

  const conductQuery = useAccountConductAssessment(
    type === 'account-conduct' ? conversationId : undefined,
  )
  const serviceabilityQuery = useServiceabilityAssessment(
    type === 'serviceability' ? conversationId : undefined,
  )
  const query = type === 'account-conduct' ? conductQuery : serviceabilityQuery
  const { data: assessment, isLoading, error } = query

  return (
    <div className={styles.container}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/admin/applications" className={styles.breadcrumbLink}>Applications</Link>
        <span className={styles.breadcrumbSep} aria-hidden="true">›</span>
        <Link href={`/admin/applications/${conversationId}`} className={styles.breadcrumbLink}>
          {customerName ?? conversationId}
          {applicationNumber ? ` · ${applicationNumber}` : ''}
        </Link>
        <span className={styles.breadcrumbSep} aria-hidden="true">›</span>
        <span>{title}</span>
      </nav>

      <h1 className={styles.title}>{title}</h1>

      {isLoading && (
        <div className={styles.skeletonWrap}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={styles.skeleton} aria-hidden="true" />
          ))}
        </div>
      )}

      {!isLoading && (assessment === null || error) && (
        <div className={styles.notAvailable}>
          <span className={styles.notAvailableIcon} aria-hidden="true">○</span>
          <p>No assessment data available for this conversation.</p>
          <Link href={`/admin/applications/${conversationId}`} className={styles.backLink}>
            ← Back to conversation
          </Link>
        </div>
      )}

      {!isLoading && assessment && (
        <AssessmentContent assessment={assessment} type={type} />
      )}
    </div>
  )
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function decisonClass(d: string) {
  const u = d.toUpperCase()
  if (['PASS', 'APPROVED', 'ACCEPT'].includes(u)) return styles.decisionPass
  if (['FAIL', 'DECLINED', 'REJECT', 'HARD_DECLINE'].includes(u)) return styles.decisionFail
  return styles.decisionRefer
}

function decisionIcon(d: string) {
  const u = d.toUpperCase()
  if (['PASS', 'APPROVED', 'ACCEPT'].includes(u)) return '✓'
  if (['FAIL', 'DECLINED', 'REJECT', 'HARD_DECLINE'].includes(u)) return '✗'
  return '!'
}

function ruleResultClass(r: string) {
  const u = r.toUpperCase()
  if (['PASS', 'APPROVED', 'ACCEPT', 'TRUE', 'OK'].includes(u)) return styles.badgePass
  if (['FAIL', 'DECLINED', 'REJECT', 'FALSE', 'ERROR'].includes(u)) return styles.badgeFail
  return styles.badgeRefer
}

function fmtCondition(c: string | undefined | null) {
  if (!c) return '—'
  return c.replace(/>=/g, '≥').replace(/<=/g, '≤').replace(/==/g, '=')
}

function fmtDataValue(
  value: number | string | undefined | null,
  description: string | undefined | null,
  condition: string | undefined | null,
): string {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'string') return value
  const desc = description ?? ''
  const cond = condition ?? ''
  const isPercent =
    desc.includes('%') ||
    desc.toLowerCase().includes('ratio') ||
    cond.includes('%')
  if (isPercent) return `${value.toFixed(2)}%`
  if (Number.isInteger(value)) return String(value)
  // Dollar-like: negative or large with decimals
  if (Math.abs(value) > 10 && !Number.isInteger(value)) {
    try { return formatCurrency(value) } catch { /* fall through */ }
  }
  return value.toFixed(2)
}

function s3Filename(uri: string | undefined | null): string {
  if (!uri) return '—'
  return uri.split('/').pop() ?? uri
}

// ─── Format detection ─────────────────────────────────────────────────────────

function isAccConductFormat(a: Record<string, unknown>): boolean {
  const ac = a.account_conduct as Record<string, unknown> | undefined
  return typeof ac === 'object' && ac !== null && Array.isArray(ac.rule_results)
}

function isSvcFormat(a: Record<string, unknown>): boolean {
  return Array.isArray(a.rule_results) && typeof a.monthly_metrics === 'object'
}

// ─── Shared decision banner ───────────────────────────────────────────────────

function DecisionBanner({ decision, meta }: { decision: string; meta?: React.ReactNode }) {
  return (
    <div className={`${styles.decisionBanner} ${decisonClass(decision)}`}>
      <span className={styles.decisionIcon} aria-hidden="true">{decisionIcon(decision)}</span>
      <div>
        <div className={styles.decisionLabel}>Overall Decision</div>
        <div className={styles.decisionValue}>{decision.toUpperCase()}</div>
      </div>
      {meta && <div className={styles.decisionMeta}>{meta}</div>}
    </div>
  )
}

// ─── Raw JSON toggle ──────────────────────────────────────────────────────────

function RawJsonSection({ assessment }: { assessment: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.rawSection}>
      <button
        type="button"
        className={styles.rawToggle}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        Raw JSON data
        <span className={`${styles.rawChevron} ${open ? styles.rawChevronOpen : ''}`} aria-hidden="true">▶</span>
      </button>
      {open && (
        <pre className={styles.rawJson}>{JSON.stringify(assessment, null, 2)}</pre>
      )}
    </div>
  )
}

// ─── Top-level dispatcher ─────────────────────────────────────────────────────

interface AssessmentContentProps {
  assessment: Record<string, unknown>
  type: AssessmentType
}

function AssessmentContent({ assessment, type }: AssessmentContentProps) {
  const decision = (assessment.decision ?? assessment.outcome ?? assessment.result) as string | undefined

  if (type === 'account-conduct' && isAccConductFormat(assessment)) {
    return <AccountConductContent assessment={assessment} />
  }
  if (type === 'serviceability' && isSvcFormat(assessment)) {
    return <ServiceabilityContent assessment={assessment} />
  }
  // Generic fallback
  return <GenericContent assessment={assessment} type={type} decision={decision} />
}

// ══════════════════════════════════════════════════════════════════════════════
// Account Conduct renderer
// ══════════════════════════════════════════════════════════════════════════════

interface AccConductRule {
  rule_id: string
  metric_id?: string
  description: string
  data_value?: number | string
  condition: string
  result: string
  hard_rule: boolean
  details?: Record<string, unknown>
  reason?: string
  warning?: boolean
  warning_message?: string
  info_only?: boolean
  total_score?: number
  component_results?: Array<{
    metric_id: string
    description: string
    metric_value: boolean
    score: number
  }>
}

interface AccConductData {
  application_number?: string
  decision: string
  account_conduct: {
    rule_results: AccConductRule[]
    warnings?: string[]
  }
  affordability_report_location?: string
}

function AccountConductContent({ assessment }: { assessment: Record<string, unknown> }) {
  const data = assessment as unknown as AccConductData
  const ac = data.account_conduct
  const rules = ac.rule_results ?? []
  const warnings = ac.warnings ?? []

  const hardFails = rules.filter((r) => r.result === 'fail' && r.hard_rule)
  const softFails = rules.filter((r) => r.result === 'fail' && !r.hard_rule)
  const passes = rules.filter((r) => r.result === 'pass')

  return (
    <div className={styles.content}>
      <DecisionBanner
        decision={data.decision}
        meta={
          <div className={styles.summaryStats}>
            {hardFails.length > 0 && (
              <span className={styles.statFail}>{hardFails.length} hard fail{hardFails.length !== 1 ? 's' : ''}</span>
            )}
            {softFails.length > 0 && (
              <span className={styles.statWarn}>{softFails.length} soft fail{softFails.length !== 1 ? 's' : ''}</span>
            )}
            <span className={styles.statPass}>{passes.length} passed</span>
          </div>
        }
      />

      {/* Warnings callout */}
      {warnings.length > 0 && (
        <div className={styles.warningsBox}>
          <div className={styles.warningsTitle}>⚠ Warnings</div>
          <ul className={styles.warningsList}>
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* Hard fails highlighted first */}
      {hardFails.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>
            Failed Checks — Hard Rules
            <span className={`${styles.ruleCount} ${styles.ruleCountFail}`}>{hardFails.length}</span>
          </h2>
          <ConductRulesTable rules={hardFails} />
        </div>
      )}

      {/* Soft fails / warnings */}
      {softFails.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>
            Failed Checks — Soft Rules
            <span className={`${styles.ruleCount} ${styles.ruleCountWarn}`}>{softFails.length}</span>
          </h2>
          <ConductRulesTable rules={softFails} />
        </div>
      )}

      {/* Passing rules */}
      {passes.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>
            Passed Checks
            <span className={`${styles.ruleCount} ${styles.ruleCountPass}`}>{passes.length}</span>
          </h2>
          <ConductRulesTable rules={passes} />
        </div>
      )}

      <RawJsonSection assessment={assessment} />
    </div>
  )
}

function ConductRulesTable({ rules }: { rules: AccConductRule[] }) {
  return (
    <table className={styles.rulesTable}>
      <thead>
        <tr>
          <th>Check</th>
          <th>Value</th>
          <th>Required</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        {rules.map((rule, i) => (
          <ConductRuleRow key={rule.rule_id ?? i} rule={rule} />
        ))}
      </tbody>
    </table>
  )
}

function ConductRuleRow({ rule }: { rule: AccConductRule }) {
  const isPass = rule.result === 'pass'
  const hasMonthlyRatios =
    rule.details &&
    typeof rule.details.monthly_ratios === 'object' &&
    rule.details.monthly_ratios !== null

  return (
    <>
      <tr className={
        rule.info_only
          ? styles.rowInfo
          : isPass
            ? styles.rowPass
            : rule.hard_rule
              ? styles.rowFail
              : styles.rowWarn
      }>
        <td className={styles.ruleName}>
          {rule.description}
          {rule.metric_id && (
            <span className={styles.metricId}>{rule.metric_id}</span>
          )}
          {rule.info_only && <span className={styles.infoTag}>info</span>}
          {rule.warning && !rule.info_only && <span className={styles.warnTag}>warning</span>}
        </td>
        <td className={styles.ruleValue}>
          {fmtDataValue(rule.data_value, rule.description, rule.condition)}
        </td>
        <td className={styles.ruleCondition}>{fmtCondition(rule.condition)}</td>
        <td>
          <span className={`${styles.resultBadge} ${ruleResultClass(rule.result)}`}>
            {rule.result.toUpperCase()}
          </span>
        </td>
      </tr>

      {/* Reason row */}
      {rule.reason && (
        <tr className={styles.reasonRow}>
          <td colSpan={4} className={styles.reasonCell}>
            {rule.reason}
          </td>
        </tr>
      )}

      {/* Warning message row */}
      {rule.warning_message && !rule.reason && (
        <tr className={styles.reasonRow}>
          <td colSpan={4} className={styles.warnCell}>
            {rule.warning_message}
          </td>
        </tr>
      )}

      {/* Composite components sub-table (RULE_009 style) */}
      {rule.component_results && rule.component_results.length > 0 && (
        <tr className={styles.subRow}>
          <td colSpan={4} className={styles.subCell}>
            <table className={styles.subTable}>
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Present</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {rule.component_results.map((c, i) => (
                  <tr key={i}>
                    <td>{c.description}</td>
                    <td>
                      <span className={c.metric_value ? styles.badgeFail : styles.badgePass}>
                        {c.metric_value ? 'Missing' : 'Present'}
                      </span>
                    </td>
                    <td className={c.score > 0 ? styles.scorePos : styles.scoreNeg}>
                      {c.score > 0 ? `+${c.score}` : String(c.score)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rule.total_score != null && (
              <div className={styles.totalScore}>
                Total score: <strong>{rule.total_score}</strong> {fmtCondition(rule.condition)}
              </div>
            )}
          </td>
        </tr>
      )}

      {/* Monthly ratios sub-table (RULE_012 style) */}
      {hasMonthlyRatios && (
        <tr className={styles.subRow}>
          <td colSpan={4} className={styles.subCell}>
            <MonthlyRatiosTable details={rule.details!} />
          </td>
        </tr>
      )}
    </>
  )
}

function MonthlyRatiosTable({ details }: { details: Record<string, unknown> }) {
  const months = (details.months_checked as string[]) ?? []
  const ratios = (details.monthly_ratios as Record<string, { ratio: number; numerator: number; denominator: number }>) ?? {}
  const threshold = 51 // RULE_012 threshold — salary must be ≥ 51%

  return (
    <table className={styles.subTable}>
      <thead>
        <tr>
          <th>Month</th>
          <th>Salary</th>
          <th>Total Income</th>
          <th>Ratio</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {months.map((m) => {
          const r = ratios[m]
          if (!r) return null
          const pass = r.ratio >= threshold
          return (
            <tr key={m}>
              <td>{m}</td>
              <td>{formatCurrency(r.numerator)}</td>
              <td>{formatCurrency(r.denominator)}</td>
              <td className={pass ? styles.scorePos : styles.scoreNeg}>
                {r.ratio.toFixed(1)}%
              </td>
              <td>
                <span className={`${styles.resultBadge} ${pass ? styles.badgePass : styles.badgeFail}`}>
                  {pass ? 'PASS' : 'FAIL'}
                </span>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Serviceability renderer
// ══════════════════════════════════════════════════════════════════════════════

interface SvcDetails {
  avg_daily_income?: number
  avg_daily_expenses?: number
  avg_daily_loan_repayment?: number
  days_loan_term?: number
  cash_savings?: number
}

interface SvcRule {
  rule_id: string
  description: string
  result: string
  data_value: number
  condition: string
  hard_rule: boolean
  details?: SvcDetails
  reason?: string
}

interface SvcData {
  application_number?: string
  decision: string
  assessment_date?: string
  monthly_metrics: {
    avg_daily_loan_repayment: number
    days_loan_term: number
    cash_savings: number
  }
  rule_results: SvcRule[]
  files_processed?: string[]
}

function ServiceabilityContent({ assessment }: { assessment: Record<string, unknown> }) {
  const data = assessment as unknown as SvcData
  const term = data.monthly_metrics?.days_loan_term
  const cashSavings = data.monthly_metrics?.cash_savings ?? 0
  const assessmentDate = data.assessment_date
    ? new Date(data.assessment_date).toLocaleDateString('en-AU', { dateStyle: 'medium' })
    : null

  // Pull financial details from first rule's details (SERVICEABILITY_RULE_001)
  const primaryRule = data.rule_results?.[0]
  const details: SvcDetails = primaryRule?.details ?? {}
  const dailyIncome = details.avg_daily_income
  const dailyExpenses = details.avg_daily_expenses
  const dailyRepayment = details.avg_daily_loan_repayment ?? data.monthly_metrics?.avg_daily_loan_repayment
  const termDays = details.days_loan_term ?? term ?? 0
  const surplus = primaryRule?.data_value

  // Compute totals over term
  const incomeOverTerm = dailyIncome != null ? dailyIncome * termDays : null
  const expensesOverTerm = dailyExpenses != null ? dailyExpenses * termDays : null
  const repaymentOverTerm = dailyRepayment != null ? dailyRepayment * termDays : null
  const surplusNegative = typeof surplus === 'number' && surplus < 0

  const files = data.files_processed ?? []

  return (
    <div className={styles.content}>
      <DecisionBanner
        decision={data.decision}
        meta={assessmentDate ? (
          <div className={styles.assessmentDate}>
            <div className={styles.decisionLabel}>Assessment date</div>
            <div className={styles.dateValue}>{assessmentDate}</div>
          </div>
        ) : undefined}
      />

      {/* Cash flow over loan term */}
      {(incomeOverTerm != null || expensesOverTerm != null || surplus != null) && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>
            Cash Flow Over Loan Term
            {termDays > 0 && <span className={styles.termChip}>{termDays} days</span>}
          </h2>
          <div className={styles.cashFlowGrid}>
            {incomeOverTerm != null && (
              <div className={styles.cashCard}>
                <div className={styles.cashLabel}>Income</div>
                <div className={styles.cashValue}>{formatCurrency(incomeOverTerm)}</div>
                {dailyIncome != null && (
                  <div className={styles.cashDaily}>{formatCurrency(dailyIncome)}/day</div>
                )}
              </div>
            )}
            {expensesOverTerm != null && (
              <div className={styles.cashCard}>
                <div className={styles.cashLabel}>Living Expenses</div>
                <div className={styles.cashValue}>{formatCurrency(expensesOverTerm)}</div>
                {dailyExpenses != null && (
                  <div className={styles.cashDaily}>{formatCurrency(dailyExpenses)}/day</div>
                )}
              </div>
            )}
            {repaymentOverTerm != null && (
              <div className={styles.cashCard}>
                <div className={styles.cashLabel}>Loan Repayment</div>
                <div className={styles.cashValue}>{formatCurrency(repaymentOverTerm)}</div>
                {dailyRepayment != null && (
                  <div className={styles.cashDaily}>{formatCurrency(dailyRepayment)}/day</div>
                )}
              </div>
            )}
            {cashSavings != null && (
              <div className={styles.cashCard}>
                <div className={styles.cashLabel}>Cash Savings</div>
                <div className={styles.cashValue}>{formatCurrency(cashSavings)}</div>
              </div>
            )}
            {typeof surplus === 'number' && (
              <div className={`${styles.cashCard} ${styles.cashSurplus} ${surplusNegative ? styles.cashSurplusNeg : styles.cashSurplusPos}`}>
                <div className={styles.cashLabel}>Net Surplus</div>
                <div className={styles.cashValue}>{formatCurrency(surplus)}</div>
                <div className={styles.cashDaily}>over {termDays}-day term</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rule results */}
      {data.rule_results?.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Serviceability Checks</h2>
          <table className={styles.rulesTable}>
            <thead>
              <tr>
                <th>Check</th>
                <th>Value</th>
                <th>Required</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {data.rule_results.map((rule, i) => (
                <React.Fragment key={rule.rule_id ?? i}>
                  <tr className={rule.result === 'pass' ? styles.rowPass : styles.rowFail}>
                    <td className={styles.ruleName}>{rule.description}</td>
                    <td className={styles.ruleValue}>
                      {fmtDataValue(rule.data_value, rule.description, rule.condition)}
                    </td>
                    <td className={styles.ruleCondition}>{fmtCondition(rule.condition)}</td>
                    <td>
                      <span className={`${styles.resultBadge} ${ruleResultClass(rule.result)}`}>
                        {rule.result.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                  {rule.reason && (
                    <tr className={styles.reasonRow}>
                      <td colSpan={4} className={styles.reasonCell}>{rule.reason}</td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Files processed */}
      {files.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>
            Files Processed
            <span className={styles.ruleCount}>{files.length}</span>
          </h2>
          <ul className={styles.fileList}>
            {files.map((f, i) => (
              <li key={i} className={styles.fileItem}>
                <span className={styles.fileName}>{s3Filename(f)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <RawJsonSection assessment={assessment} />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Generic fallback renderer (handles any unknown shape)
// ══════════════════════════════════════════════════════════════════════════════

const GENERIC_SKIP = new Set([
  'decision', 'outcome', 'result', 'rules', 'ruleResults', 'checks',
  'monthlyMetrics', 'monthly_metrics', 'files', 'processedFiles',
  's3Key', 'file_location', 'flags', 'reasons', 'reason',
  'totalScore', 'score',
])

function formatFieldName(key: string | undefined | null): string {
  if (!key) return '—'
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\s/, '')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') {
    if (Math.abs(value) >= 10 && !Number.isInteger(value)) {
      try { return formatCurrency(value) } catch { /* fall through */ }
    }
    return String(value)
  }
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

interface GenericContentProps {
  assessment: Record<string, unknown>
  type: AssessmentType
  decision: string | undefined
}

function GenericContent({ assessment, type, decision }: GenericContentProps) {
  const rules: Array<Record<string, unknown>> =
    (assessment.rules as Array<Record<string, unknown>> | undefined) ??
    (assessment.ruleResults as Array<Record<string, unknown>> | undefined) ??
    (assessment.checks as Array<Record<string, unknown>> | undefined) ??
    []

  const monthlyMetrics =
    type === 'serviceability'
      ? ((assessment.monthlyMetrics ?? assessment.monthly_metrics) as Record<string, unknown> | undefined)
      : undefined

  const files: Array<unknown> =
    (assessment.files as Array<unknown> | undefined) ??
    (assessment.processedFiles as Array<unknown> | undefined) ??
    []

  const flags: Array<unknown> = (assessment.flags as Array<unknown> | undefined) ?? []

  const score = assessment.totalScore ?? assessment.score
  const reasons: string[] = (() => {
    const r = assessment.reasons ?? assessment.reason
    if (!r) return []
    if (Array.isArray(r)) return r.map(String)
    return [String(r)]
  })()

  const otherFields = Object.entries(assessment).filter(([k]) => !GENERIC_SKIP.has(k))

  return (
    <div className={styles.content}>
      {decision && (
        <div className={`${styles.decisionBanner} ${decisonClass(decision)}`}>
          <span className={styles.decisionIcon} aria-hidden="true">{decisionIcon(decision)}</span>
          <div>
            <div className={styles.decisionLabel}>Overall Decision</div>
            <div className={styles.decisionValue}>{decision.toUpperCase()}</div>
          </div>
          {score != null && (
            <div className={styles.decisionScore}>
              <div className={styles.decisionLabel}>Score</div>
              <div className={styles.decisionValue}>{String(score)}</div>
            </div>
          )}
        </div>
      )}

      {reasons.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Reason{reasons.length > 1 ? 's' : ''}</h2>
          <ul className={styles.reasonList}>
            {reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      {flags.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Flags</h2>
          <div className={styles.flagsRow}>
            {flags.map((f, i) => (
              <span key={i} className={styles.flagChip}>{String(f)}</span>
            ))}
          </div>
        </div>
      )}

      {monthlyMetrics && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Monthly Financial Summary</h2>
          <dl className={styles.detailGrid}>
            {Object.entries(monthlyMetrics).map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className={styles.detailLabel}>{formatFieldName(k)}</dt>
                <dd className={styles.detailValue}>{formatFieldValue(v)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      )}

      {rules.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>
            Checks
            <span className={styles.ruleCount}>{rules.length}</span>
          </h2>
          <table className={styles.rulesTable}>
            <thead>
              <tr>
                <th>Check</th>
                <th>Result</th>
                {rules[0]?.score != null && <th>Score</th>}
                {rules[0]?.message != null && <th>Detail</th>}
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, i) => {
                const name = (rule.name ?? rule.rule ?? rule.id ?? `Rule ${i + 1}`) as string
                const resRaw = rule.result ?? rule.status ?? rule.outcome ?? rule.passed
                const res = resRaw == null ? '' : typeof resRaw === 'boolean' ? (resRaw ? 'PASS' : 'FAIL') : String(resRaw)
                return (
                  <tr key={i}>
                    <td className={styles.ruleName}>{formatFieldName(String(name))}</td>
                    <td>
                      {res && (
                        <span className={`${styles.resultBadge} ${ruleResultClass(res)}`}>
                          {res.toUpperCase()}
                        </span>
                      )}
                    </td>
                    {rules[0]?.score != null && <td>{String(rule.score ?? '—')}</td>}
                    {rules[0]?.message != null && <td>{String(rule.message ?? '—')}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {otherFields.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Assessment Details</h2>
          <dl className={styles.detailGrid}>
            {otherFields.map(([key, val]) => (
              <React.Fragment key={key}>
                <dt className={styles.detailLabel}>{formatFieldName(key)}</dt>
                <dd className={styles.detailValue}>
                  {typeof val === 'object' && val !== null
                    ? <pre className={styles.inlineJson}>{JSON.stringify(val, null, 2)}</pre>
                    : formatFieldValue(val)}
                </dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      )}

      {files.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>
            Files Processed
            <span className={styles.ruleCount}>{files.length}</span>
          </h2>
          <ul className={styles.fileList}>
            {files.map((f, i) => (
              <li key={i} className={styles.fileItem}>
                <span className={styles.fileName}>
                  {typeof f === 'string' ? s3Filename(f) : String(f)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <RawJsonSection assessment={assessment} />
    </div>
  )
}
