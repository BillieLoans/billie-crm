'use client'

import React, { useState } from 'react'
import { formatDateMedium } from '@/lib/formatters'
import type { ConversationDetail } from '@/lib/schemas/conversations'
import { CopyButton } from '@/components/ui'
import {
  checkLabel,
  decisionTone,
  getChecks,
  getIdentitySources,
  getResultReasons,
  getScreening,
  humanise,
  isLabV1Block,
  isLegacyLabBlock,
  outcomeTone,
  resultHint,
  resultTone,
  type IdentitySource,
  type LabCheck,
  type LabReason,
  type LabVerificationV1,
  type LegacyLabBlock,
  type ScreeningCategory,
  type Tone,
} from '@/lib/identityVerification'
import styles from './IdentityVerificationDetail.module.css'

type IdentityReport = NonNullable<ConversationDetail['identityVerificationReport']>

export interface IdentityVerificationDetailProps {
  /** The verbatim `identityRisk_assessment` payload (`assessments.identityRisk`). */
  identity: Record<string, unknown>
  /** Archived artifact availability for this conversation. */
  report?: IdentityReport | null
  /** Customer id — the report download route is customer-scoped. */
  customerId?: string | null
}

const toneClass = (tone: Tone, prefix: 'tone' | 'badge' | 'chip') =>
  styles[`${prefix}${tone.charAt(0).toUpperCase()}${tone.slice(1)}`]

const toneIcon = (tone: Tone) => (tone === 'pass' ? '✓' : tone === 'fail' ? '✗' : '!')

function Badge({ value, tone }: { value: string | null | undefined; tone: Tone }) {
  return <span className={`${styles.badge} ${toneClass(tone, 'badge')}`}>{value ?? 'no verdict'}</span>
}

function Chip({
  value,
  context = 'source',
}: {
  value: string | null | undefined
  context?: 'source' | 'screening'
}) {
  const tone = resultTone(value, context)
  return (
    <span className={`${styles.chip} ${toneClass(tone, 'chip')}`} title={resultHint(value)}>
      {humanise(value)}
    </span>
  )
}

function MetaItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.metaItem}>
      <span className={styles.metaLabel}>{label}</span>
      <span className={styles.metaValue}>{children}</span>
    </div>
  )
}

function Reasons({ reasons, outcome }: { reasons: LabReason[]; outcome?: string | null }) {
  if (reasons.length === 0) return null
  const tone = outcomeTone(outcome)
  return (
    <ul className={styles.reasonList} data-testid="identity-reasons">
      {reasons.map((reason, i) => (
        <li
          key={`${reason.code ?? 'reason'}-${i}`}
          className={`${styles.reason} ${tone === 'fail' ? styles.reasonFail : tone === 'warn' ? styles.reasonWarn : ''}`}
        >
          {reason.code && <span className={styles.reasonCode}>{reason.code}</span>}
          {reason.provider && <span className={styles.sourceMeta}>{reason.provider}</span>}
          {reason.retryable && <span className={`${styles.chip} ${styles.chipMuted}`}>retryable</span>}
          {reason.message && <span className={styles.reasonMessage}>{reason.message}</span>}
          {reason.suggestedAction && (
            <span className={styles.reasonAction}>{reason.suggestedAction}</span>
          )}
          {reason.detail && <span className={styles.reasonDetail}>{reason.detail}</span>}
        </li>
      ))}
    </ul>
  )
}

function sourceKind(source: IdentitySource): string {
  if (source.type === 'document') {
    const parts = [humanise(source.documentType) !== '—' ? humanise(source.documentType) : 'document']
    if (source.issuingRegion) parts.push(source.issuingRegion)
    return parts.join(' · ')
  }
  return source.dataSource ? `data · ${source.dataSource}` : 'data'
}

function IdentitySources({ sources }: { sources: IdentitySource[] }) {
  if (sources.length === 0) return <p className={styles.note}>No source detail returned.</p>
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} data-testid="identity-sources">
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">DVS</th>
            <th scope="col">Result</th>
            <th scope="col">Name</th>
            <th scope="col">Address</th>
            <th scope="col">DOB</th>
            <th scope="col">Doc ID</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((source, i) => (
            <tr key={`${source.name ?? 'source'}-${i}`}>
              <td>
                <div className={styles.sourceName}>{source.name ?? '—'}</div>
                <div className={styles.sourceMeta}>{sourceKind(source)}</div>
                {source.failureReason && (
                  <div className={styles.failureReason}>{source.failureReason}</div>
                )}
              </td>
              <td>{source.isDvs ? 'Yes' : 'No'}</td>
              <td>
                <Chip value={source.result} />
              </td>
              <td>
                <Chip value={source.attributes?.name} />
              </td>
              <td>
                <Chip value={source.attributes?.address} />
              </td>
              <td>
                <Chip value={source.attributes?.dateOfBirth} />
              </td>
              <td>
                <Chip value={source.attributes?.documentIdentifier} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ScreeningCategoryPanel({
  title,
  category,
}: {
  title: string
  category?: ScreeningCategory
}) {
  const result = category?.result
  const sources = category?.sources ?? []
  const matches = category?.matches ?? []
  return (
    <div className={styles.category} data-testid={`screening-${title.toLowerCase()}`}>
      <div className={styles.categoryHeader}>
        <span>{title}</span>
        <Chip value={result ?? 'not_performed'} context="screening" />
      </div>
      {sources.length > 0 && (
        <div>
          <div className={styles.subTitle}>Watchlists screened</div>
          <ul className={styles.coverageList}>
            {sources.map((source, i) => (
              <li key={`${source.name ?? 'list'}-${i}`} className={styles.coverageRow}>
                <span>{source.name ?? '—'}</span>
                <Chip value={source.result} context="screening" />
              </li>
            ))}
          </ul>
        </div>
      )}
      {matches.length > 0 &&
        matches.map((match, i) => (
          <div key={`match-${i}`} className={styles.match}>
            <div className={styles.subTitle}>
              Matched on {match.matchedOn ?? '—'}:{' '}
              <span className={styles.matchTerm}>{match.matchedTerm ?? '—'}</span>
            </div>
            {(match.listings ?? []).length > 0 ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Listed name</th>
                      <th scope="col">Title</th>
                      <th scope="col">List</th>
                      <th scope="col">Country</th>
                      <th scope="col">Listed</th>
                      <th scope="col">Updated</th>
                      <th scope="col">Ref / version</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(match.listings ?? []).map((listing, j) => (
                      <tr key={`${listing.reference ?? 'listing'}-${j}`}>
                        <td>
                          <div className={styles.sourceName}>{listing.name ?? '—'}</div>
                          {listing.attributes && Object.keys(listing.attributes).length > 0 && (
                            <dl className={styles.attrList}>
                              {Object.entries(listing.attributes).map(([k, v]) => (
                                <React.Fragment key={k}>
                                  <dt>{k}</dt>
                                  <dd>{typeof v === 'string' ? v : JSON.stringify(v)}</dd>
                                </React.Fragment>
                              ))}
                            </dl>
                          )}
                        </td>
                        <td>{listing.title ?? '—'}</td>
                        <td>{listing.source ?? '—'}</td>
                        <td>{listing.countryName ?? listing.country ?? '—'}</td>
                        <td>{listing.listedDate ?? '—'}</td>
                        <td>{listing.lastUpdated ?? '—'}</td>
                        <td>
                          {listing.reference ?? '—'}
                          {listing.version ? ` / ${listing.version}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.note}>No listing detail supplied.</p>
            )}
          </div>
        ))}
      {result === 'match' && matches.length === 0 && (
        <p className={styles.note}>Match detail not supplied by provider — the match stands.</p>
      )}
    </div>
  )
}

function CheckCard({
  check,
  reportHref,
}: {
  check: LabCheck
  reportHref?: string | null
}) {
  const tone = outcomeTone(check.outcome)
  const providers = (check.providers ?? []).map((p) => p.provider).filter(Boolean).join(', ')
  const reasons = (check.reasons ?? []).filter(Boolean) as LabReason[]
  const type = check.checkType ?? ''
  return (
    <section className={styles.checkCard} data-testid={`identity-check-${type || 'unknown'}`}>
      <header className={styles.checkHeader}>
        <span className={styles.checkTitle}>{checkLabel(type)}</span>
        <Badge value={check.outcome} tone={tone} />
        {providers && <span className={styles.checkProvider}>{providers}</span>}
        <span className={styles.checkSpacer} />
        {reportHref && (
          <a
            href={reportHref}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.reportLink}
            data-testid={`identity-check-${type}-report`}
          >
            Report ⤢
          </a>
        )}
      </header>
      <div className={styles.checkBody}>
        <Reasons reasons={reasons} outcome={check.outcome} />
        {type === 'identity' && <IdentitySources sources={getIdentitySources(check)} />}
        {type === 'screening' &&
          (() => {
            const { pep, sanctions } = getScreening(check)
            return (
              <div className={styles.screeningGrid}>
                <ScreeningCategoryPanel title="PEP" category={pep} />
                <ScreeningCategoryPanel title="Sanctions" category={sanctions} />
              </div>
            )
          })()}
      </div>
    </section>
  )
}

function RawJson({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.rawSection}>
      <button
        type="button"
        className={styles.rawToggle}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="identity-raw-json"
      >
        Raw JSON data
        <span className={`${styles.rawChevron} ${open ? styles.rawChevronOpen : ''}`} aria-hidden="true">
          ▶
        </span>
      </button>
      {open && (
        <pre id="identity-raw-json" className={styles.rawJson}>
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  )
}

function Banner({
  decision,
  subtitle,
  children,
}: {
  decision: string | null | undefined
  subtitle?: string
  children?: React.ReactNode
}) {
  const tone = decisionTone(decision)
  return (
    <div className={`${styles.banner} ${toneClass(tone, 'tone')}`} data-testid="identity-decision">
      <span className={styles.bannerIcon} aria-hidden="true">
        {toneIcon(tone)}
      </span>
      <div>
        <div className={styles.bannerLabel}>Billie decision</div>
        <div className={styles.bannerValue}>{decision ?? 'No decision'}</div>
        {subtitle && <div className={styles.bannerSub}>{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}

function reportBase(customerId: string | null | undefined): string | null {
  return customerId ? `/api/customer/${encodeURIComponent(customerId)}/identity-report` : null
}

function V1Detail({
  identity,
  lab,
  report,
  customerId,
}: {
  identity: Record<string, unknown>
  lab: LabVerificationV1
  report?: IdentityReport | null
  customerId?: string | null
}) {
  const decision = identity.decision as string | undefined
  const overall = lab.result?.outcome ?? null
  const provider = lab.provider?.[0]
  const base = reportBase(customerId)
  const hrefFor = (checkType: string | null | undefined): string | null => {
    if (!base) return null
    if (checkType === 'identity' && report?.reportAvailable) return `${base}?artifact=report`
    if (checkType === 'screening' && report?.screeningReportAvailable) {
      return `${base}?artifact=screening`
    }
    return null
  }
  const checks = getChecks(lab)
  const resultReasons = getResultReasons(lab)
  const subtitle = overall
    ? `LAB outcome: ${overall}${lab.status && lab.status !== 'completed' ? ` (${lab.status})` : ''}`
    : lab.status
      ? `LAB status: ${lab.status}`
      : undefined

  return (
    <div className={styles.root}>
      <Banner decision={decision} subtitle={subtitle} />
      <div className={styles.meta}>
        <MetaItem label="Verification">
          {lab.verificationNumber ? (
            <>
              <span>{lab.verificationNumber}</span>
              <CopyButton value={lab.verificationNumber} label="Copy verification number" />
            </>
          ) : (
            '—'
          )}
        </MetaItem>
        <MetaItem label="Provider">
          {provider?.name ?? '—'}
          {provider?.reference ? ` · ${provider.reference}` : ''}
        </MetaItem>
        <MetaItem label="Checked">{lab.createdAt ? formatDateMedium(lab.createdAt) : '—'}</MetaItem>
        <MetaItem label="Verification id">
          {lab.id ? (
            <>
              <span>{lab.id}</span>
              <CopyButton value={lab.id} label="Copy verification id" />
            </>
          ) : (
            '—'
          )}
        </MetaItem>
        {base && report?.rawResponseAvailable && (
          <MetaItem label="Raw response">
            <a
              href={`${base}?artifact=raw&disposition=attachment`}
              className={styles.reportLink}
              data-testid="identity-raw-download"
            >
              Download JSON ⤓
            </a>
          </MetaItem>
        )}
      </div>
      {resultReasons.length > 0 && (
        <section className={styles.checkCard}>
          <header className={styles.checkHeader}>
            <span className={styles.checkTitle}>Processing</span>
            <Badge value={overall} tone={outcomeTone(overall)} />
          </header>
          <div className={styles.checkBody}>
            <Reasons reasons={resultReasons} outcome={overall ?? 'fail'} />
          </div>
        </section>
      )}
      {checks.length === 0 && resultReasons.length === 0 && (
        <p className={styles.note}>No checks were returned for this verification.</p>
      )}
      {checks.map((check, i) => (
        <CheckCard
          key={`${check.checkType ?? 'check'}-${i}`}
          check={check}
          reportHref={hrefFor(check.checkType)}
        />
      ))}
      <RawJson data={identity} />
    </div>
  )
}

const LEGACY_ROWS: { key: keyof LegacyLabBlock; label: string; screening?: boolean }[] = [
  { key: 'overallResult', label: 'Overall result' },
  { key: 'provider', label: 'Provider' },
  { key: 'providerReference', label: 'Provider reference' },
  { key: 'requestId', label: 'Request ID' },
  { key: 'requestDateTime', label: 'Requested' },
  { key: 'pepResult', label: 'PEP', screening: true },
  { key: 'sanctionsResult', label: 'Sanctions', screening: true },
  { key: 'sanctionsListResult', label: 'Sanctions list', screening: true },
  { key: 'eddResult', label: 'EDD', screening: true },
  { key: 'gwlResult', label: 'Global watchlist', screening: true },
]

function LegacyDetail({
  identity,
  lab,
  report,
  customerId,
}: {
  identity: Record<string, unknown>
  lab: LegacyLabBlock
  report?: IdentityReport | null
  customerId?: string | null
}) {
  const base = reportBase(customerId)
  return (
    <div className={styles.root}>
      <Banner
        decision={identity.decision as string | undefined}
        subtitle="Legacy LAB EVS result (pre-2026-09 API)"
      />
      <div data-testid="identity-legacy">
        {LEGACY_ROWS.map(({ key, label, screening }) => {
          const value = lab[key]
          return (
            <div key={key} className={styles.kvRow}>
              <span className={styles.kvLabel}>{label}</span>
              <span className={styles.kvValue}>
                {screening ? (
                  <Chip value={value == null ? null : String(value)} context="screening" />
                ) : value == null || value === '' ? (
                  '—'
                ) : (
                  String(value)
                )}
              </span>
            </div>
          )
        })}
        {base && report?.reportAvailable && (
          <div className={styles.kvRow}>
            <span className={styles.kvLabel}>Report</span>
            <span className={styles.kvValue}>
              <a
                href={`${base}?artifact=report`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.reportLink}
                data-testid="identity-check-identity-report"
              >
                View report ⤢
              </a>
            </span>
          </div>
        )}
      </div>
      <RawJson data={identity} />
    </div>
  )
}

function NoBlockDetail({ identity }: { identity: Record<string, unknown> }) {
  const manual = identity.manual_verification === true
  const basis = identity.manual_verification_basis as string | undefined
  const reviewer = identity.manual_verification_reviewed_by as string | undefined
  const pep = identity.pepResult as string | null | undefined
  const sanctions = identity.sanctionsResult as string | null | undefined
  return (
    <div className={styles.root}>
      <Banner
        decision={identity.decision as string | undefined}
        subtitle={manual ? 'Manual verification by a reviewer (no LAB call)' : undefined}
      />
      <div className={styles.meta} data-testid="identity-no-block">
        {manual && (
          <>
            <MetaItem label="Reviewed by">{reviewer || '—'}</MetaItem>
            <MetaItem label="Basis">{basis || '—'}</MetaItem>
          </>
        )}
        {(pep != null || sanctions != null) && (
          <>
            <MetaItem label="PEP">
              <Chip value={pep} context="screening" />
            </MetaItem>
            <MetaItem label="Sanctions">
              <Chip value={sanctions} context="screening" />
            </MetaItem>
          </>
        )}
        {!manual && pep == null && sanctions == null && (
          <MetaItem label="Detail">No LAB verification detail on this assessment.</MetaItem>
        )}
      </div>
      <RawJson data={identity} />
    </div>
  )
}

/**
 * Structured rendering of the identity risk assessment: Billie's decision
 * plus the LAB verification evidence (per-check outcomes, identity sources,
 * PEP/sanctions coverage and matches, reason codes, per-check reports), with
 * the raw JSON kept as a collapsed escape hatch.
 */
export function IdentityVerificationDetail({
  identity,
  report,
  customerId,
}: IdentityVerificationDetailProps) {
  const lab = identity.lab_verification
  if (isLabV1Block(lab)) {
    return <V1Detail identity={identity} lab={lab} report={report} customerId={customerId} />
  }
  if (isLegacyLabBlock(lab)) {
    return <LegacyDetail identity={identity} lab={lab} report={report} customerId={customerId} />
  }
  return <NoBlockDetail identity={identity} />
}
