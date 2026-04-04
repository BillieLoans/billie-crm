'use client'

import React, { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAccountConductAssessment, useServiceabilityAssessment } from '@/hooks/queries/useAssessments'
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

/**
 * AssessmentDetailView renders the full credit assessment report from S3.
 *
 * Displays:
 * - Overall decision (PASS/FAIL)
 * - Individual rule results with pass/fail indicators (FR17, FR18)
 * - Scoring details
 * - Breadcrumb back to conversation detail
 * - Escape to return
 * - "No data available" when S3 key is null
 * - staleTime: Infinity (immutable data — fetched once)
 *
 * Story 3.4: Credit Assessment Detail Pages (NFR5 < 3s load)
 */
export function AssessmentDetailView({
  conversationId,
  type,
  customerName,
  applicationNumber,
}: AssessmentDetailViewProps) {
  const router = useRouter()
  const title = TITLE_MAP[type]

  // Escape back to conversation detail
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
      {/* Breadcrumb */}
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/admin/applications" className={styles.breadcrumbLink}>
          Applications
        </Link>
        <span className={styles.breadcrumbSep} aria-hidden="true">›</span>
        <Link
          href={`/admin/applications/${conversationId}`}
          className={styles.breadcrumbLink}
        >
          {customerName ?? conversationId}
          {applicationNumber ? ` › ${applicationNumber}` : ''}
        </Link>
        <span className={styles.breadcrumbSep} aria-hidden="true">›</span>
        <span>{title}</span>
      </nav>

      <h1 className={styles.title}>{title}</h1>

      {isLoading && (
        <div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={styles.skeleton} aria-hidden="true" />
          ))}
        </div>
      )}

      {!isLoading && (assessment === null || error) && (
        <div className={styles.notAvailable}>
          <p>No assessment data available for this conversation.</p>
        </div>
      )}

      {!isLoading && assessment && (
        <AssessmentContent assessment={assessment} type={type} />
      )}
    </div>
  )
}

interface AssessmentContentProps {
  assessment: Record<string, unknown>
  type: AssessmentType
}

function AssessmentContent({ assessment, type }: AssessmentContentProps) {
  const decision = (assessment.decision ?? assessment.outcome ?? assessment.result) as string | undefined
  const isPass = decision?.toUpperCase() === 'PASS'

  // Extract rule results: try common keys
  const rules =
    (assessment.rules as Array<Record<string, unknown>> | undefined) ??
    (assessment.ruleResults as Array<Record<string, unknown>> | undefined) ??
    (assessment.checks as Array<Record<string, unknown>> | undefined) ??
    []

  // For serviceability: extract monthly metrics
  const monthlyMetrics =
    type === 'serviceability'
      ? ((assessment.monthlyMetrics ?? assessment.monthly_metrics) as Record<string, unknown> | undefined)
      : undefined

  // Files processed
  const files =
    (assessment.files as Array<unknown> | undefined) ??
    (assessment.processedFiles as Array<unknown> | undefined) ??
    []

  return (
    <div>
      {decision && (
        <p className={`${styles.decision} ${isPass ? styles.pass : styles.fail}`}>
          Overall: {decision.toUpperCase()}
        </p>
      )}

      {rules.length > 0 && (
        <table className={styles.rulesTable}>
          <thead>
            <tr>
              <th>Rule</th>
              <th>Result</th>
              {rules[0]?.score != null && <th>Score</th>}
              {rules[0]?.message != null && <th>Detail</th>}
            </tr>
          </thead>
          <tbody>
            {rules.map((rule, i) => {
              const ruleName = (rule.name ?? rule.rule ?? rule.id ?? `Rule ${i + 1}`) as string
              const result = (rule.result ?? rule.status ?? rule.outcome ?? '') as string
              const isPASS = result.toUpperCase() === 'PASS'
              return (
                <tr key={i}>
                  <td>{ruleName}</td>
                  <td className={isPASS ? styles.rulePASS : styles.ruleFAIL}>
                    {result.toUpperCase()}
                  </td>
                  {rules[0]?.score != null && <td>{String(rule.score ?? '—')}</td>}
                  {rules[0]?.message != null && <td>{String(rule.message ?? '—')}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {monthlyMetrics && (
        <div>
          <h3 className={styles.rawTitle}>Monthly Metrics</h3>
          <pre className={styles.rawJson}>{JSON.stringify(monthlyMetrics, null, 2)}</pre>
        </div>
      )}

      {files.length > 0 && (
        <div>
          <h3 className={styles.rawTitle}>Processed Files ({files.length})</h3>
          <pre className={styles.rawJson}>{JSON.stringify(files, null, 2)}</pre>
        </div>
      )}

      <div className={styles.rawSection}>
        <h3 className={styles.rawTitle}>Full Assessment Data</h3>
        <pre className={styles.rawJson}>{JSON.stringify(assessment, null, 2)}</pre>
      </div>
    </div>
  )
}
