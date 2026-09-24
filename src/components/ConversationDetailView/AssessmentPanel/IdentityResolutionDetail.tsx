'use client'

import React, { useId, useState } from 'react'
import Link from 'next/link'
import { formatDateMedium } from '@/lib/formatters'
import type { IdentityResolution, ResolverAssessment } from '@/lib/schemas/conversations'
import styles from './IdentityResolutionDetail.module.css'

/**
 * The platform's identity decision for this journey (BTB-392): the link
 * outcome and its reason code, the resolver agent's assessments (shadow or
 * enforced), and any recognition review case. Ids, codes and scores only.
 */

export interface IdentityResolutionDetailProps {
  resolution: IdentityResolution | null | undefined
  /** The id this conversation arrived under before a link moved it, if any. */
  originCustomerId?: string | null
}

function when(value: string | null | undefined): string {
  if (!value) return '—'
  try {
    return formatDateMedium(value)
  } catch {
    return value
  }
}

function yesNo(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return value ? 'Yes' : 'No'
}

function Outcome({
  title,
  outcome,
  originCustomerId,
}: {
  title: string
  outcome: NonNullable<IdentityResolution['link']>
  originCustomerId?: string | null
}) {
  return (
    <section className={styles.block} aria-label={title}>
      <h4 className={styles.blockTitle}>{title}</h4>
      <dl className={styles.facts}>
        <dt>Canonical</dt>
        <dd>
          {outcome.canonicalId ? (
            <Link href={`/admin/servicing/${encodeURIComponent(outcome.canonicalId)}`}>
              {outcome.canonicalId}
            </Link>
          ) : (
            '—'
          )}
        </dd>
        <dt>Reason</dt>
        <dd>
          <code>{outcome.reason ?? '—'}</code>
        </dd>
        <dt>When</dt>
        <dd>{when(outcome.at)}</dd>
        <dt>Link id</dt>
        <dd>
          <code>{outcome.linkId ?? '—'}</code>
        </dd>
        {originCustomerId && (
          <>
            <dt>Applied to this journey</dt>
            <dd>
              Yes — arrived as <code>{originCustomerId}</code>
            </dd>
          </>
        )}
      </dl>
    </section>
  )
}

function Factors({ factors }: { factors: string[] }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  if (factors.length === 0) return <span className={styles.muted}>none</span>
  return (
    <div>
      <button
        type="button"
        className={styles.disclosure}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> {factors.length} factor
        {factors.length === 1 ? '' : 's'}
      </button>
      {open && (
        <ul id={id} className={styles.factorList}>
          {factors.map((f) => (
            <li key={f}>
              <code>{f}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Assessments({ assessments }: { assessments: ResolverAssessment[] }) {
  return (
    <section className={styles.block} aria-label="Resolver assessments">
      <h4 className={styles.blockTitle}>Resolver assessments</h4>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Assessed</th>
            <th scope="col">Candidate</th>
            <th scope="col">Verdict</th>
            <th scope="col">Confidence</th>
            <th scope="col">Mode</th>
            <th scope="col">Applied</th>
            <th scope="col">Platform reason</th>
            <th scope="col">Latency</th>
            <th scope="col">Factors</th>
          </tr>
        </thead>
        <tbody>
          {assessments.map((a) => (
            <tr key={a.eventId} data-testid="resolver-assessment-row">
              <td>{when(a.assessedAt)}</td>
              <td>
                <code>{a.candidateId ?? '—'}</code>
              </td>
              <td>
                <code>{a.verdict ?? '—'}</code>
              </td>
              <td>{a.confidence !== null ? a.confidence.toFixed(2) : '—'}</td>
              <td>{a.mode ?? '—'}</td>
              <td>{yesNo(a.applied)}</td>
              <td>
                <code>{a.platformReasonCode ?? '—'}</code>
              </td>
              <td>{a.latencyMs !== null ? `${a.latencyMs} ms` : '—'}</td>
              <td>
                <Factors factors={a.factors} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {assessments.some((a) => a.model) && (
        <p className={styles.muted}>
          Model: {[...new Set(assessments.map((a) => a.model).filter(Boolean))].join(', ')}
        </p>
      )}
    </section>
  )
}

function ReviewCase({ reviewCase }: { reviewCase: NonNullable<IdentityResolution['reviewCase']> }) {
  return (
    <section className={styles.block} aria-label="Recognition review case">
      <h4 className={styles.blockTitle}>Recognition review case</h4>
      <dl className={styles.facts}>
        <dt>Case</dt>
        <dd>
          <code>{reviewCase.caseId ?? '—'}</code>
        </dd>
        <dt>Band</dt>
        <dd>{reviewCase.band ?? '—'}</dd>
        <dt>Posterior</dt>
        <dd>{reviewCase.posterior !== null ? reviewCase.posterior.toFixed(3) : '—'}</dd>
        <dt>Flags</dt>
        <dd>
          {reviewCase.flags.length ? reviewCase.flags.map((f) => <code key={f}>{f} </code>) : '—'}
        </dd>
        <dt>Candidates</dt>
        <dd>{reviewCase.candidateIds.length}</dd>
        <dt>Recommendation</dt>
        <dd>{reviewCase.recommendation ?? '—'}</dd>
        <dt>Disposition</dt>
        <dd>
          <code>{reviewCase.disposition ?? '—'}</code>
        </dd>
        <dt>Opened</dt>
        <dd>{when(reviewCase.openedAt)}</dd>
      </dl>
    </section>
  )
}

export function IdentityResolutionDetail({
  resolution,
  originCustomerId,
}: IdentityResolutionDetailProps) {
  if (!resolution) {
    return <p data-testid="identity-resolution-empty">No identity resolution recorded.</p>
  }
  return (
    <div className={styles.root} data-testid="identity-resolution">
      {resolution.link && (
        <Outcome title="Link" outcome={resolution.link} originCustomerId={originCustomerId} />
      )}
      {resolution.merge && <Outcome title="Merge" outcome={resolution.merge} />}
      {resolution.resolverAssessments.length > 0 && (
        <Assessments assessments={resolution.resolverAssessments} />
      )}
      {resolution.reviewCase && <ReviewCase reviewCase={resolution.reviewCase} />}
    </div>
  )
}
