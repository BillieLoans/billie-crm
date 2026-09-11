/**
 * Typed accessors over the verbatim `lab_verification` block carried on the
 * `identityRisk_assessment` event (stored whole in
 * `conversations.assessments_identity_risk`).
 *
 * Two shapes exist on the ledger:
 *  - LAB Identity Verification API v1 `Verification` envelope (2026-09 →):
 *    `id`, `verificationNumber`, `status`, `result.checks[]`, `provider[]`.
 *  - Legacy LAB EVS block (→ 2026-09): flat `requestId`, `overallResult`,
 *    `pepResult`, `sanctionsResult`, `reportLink`.
 *
 * These helpers never throw on partial data — every field is optional and the
 * renderer degrades to whatever is present.
 */

export type LabOutcome = 'pass' | 'fail' | 'refer'

export interface LabReason {
  code?: string | null
  message?: string | null
  provider?: string | null
  retryable?: boolean | null
  suggestedAction?: string | null
  detail?: string | null
}

export interface IdentitySourceAttributes {
  name?: string | null
  address?: string | null
  dateOfBirth?: string | null
  documentIdentifier?: string | null
}

export interface IdentitySource {
  name?: string | null
  type?: 'data' | 'document' | string | null
  dataSource?: string | null
  isDvs?: boolean | null
  result?: string | null
  attributes?: IdentitySourceAttributes | null
  documentType?: string | null
  issuingRegion?: string | null
  failureReason?: string | null
}

export interface ScreeningListing {
  name?: string | null
  title?: string | null
  source?: string | null
  country?: string | null
  countryName?: string | null
  listedDate?: string | null
  lastUpdated?: string | null
  reference?: string | null
  version?: string | null
  attributes?: Record<string, string> | null
}

export interface ScreeningMatch {
  matchedOn?: string | null
  matchedTerm?: string | null
  listings?: ScreeningListing[] | null
}

export interface ScreeningCategory {
  result?: string | null
  sources?: { name?: string | null; result?: string | null }[] | null
  matches?: ScreeningMatch[] | null
}

export interface LabCheckProvider {
  provider?: string | null
  outcome?: string | null
  detail?: Record<string, unknown> | null
}

export interface LabCheck {
  checkType?: string | null
  outcome?: string | null
  reasons?: LabReason[] | null
  providers?: LabCheckProvider[] | null
  links?: { report?: string | null } | null
}

export interface LabVerificationV1 {
  id?: string | null
  verificationNumber?: string | null
  reference?: string | null
  status?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  result?: {
    outcome?: string | null
    reasons?: LabReason[] | null
    checks?: LabCheck[] | null
  } | null
  provider?: { name?: string | null; reference?: string | null }[] | null
  links?: { report?: string | null } | null
}

export interface LegacyLabBlock {
  requestId?: string | number | null
  requestDateTime?: string | null
  responseSucceeded?: boolean | null
  provider?: string | null
  providerReference?: string | null
  overallResult?: string | null
  sanctionsResult?: string | null
  sanctionsListResult?: string | null
  pepResult?: string | null
  eddResult?: string | null
  gwlResult?: string | null
  reportLink?: string | null
}

export type Tone = 'pass' | 'warn' | 'fail' | 'muted'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** True for a LAB API v1 `Verification` envelope. */
export function isLabV1Block(block: unknown): block is LabVerificationV1 {
  return isRecord(block) && 'id' in block && 'result' in block
}

/** True for the legacy EVS flat block. */
export function isLegacyLabBlock(block: unknown): block is LegacyLabBlock {
  return isRecord(block) && !isLabV1Block(block) && ('requestId' in block || 'overallResult' in block)
}

const CHECK_ORDER = ['identity', 'screening', 'deceased', 'biometric', 'death_certificate']

/** Checks in display order: identity, screening, then the rest as sent. */
export function getChecks(verification: LabVerificationV1): LabCheck[] {
  const checks = (verification.result?.checks ?? []).filter(isRecord) as LabCheck[]
  return [...checks].sort((a, b) => {
    const ia = CHECK_ORDER.indexOf(a.checkType ?? '')
    const ib = CHECK_ORDER.indexOf(b.checkType ?? '')
    return (ia === -1 ? CHECK_ORDER.length : ia) - (ib === -1 ? CHECK_ORDER.length : ib)
  })
}

/** Result-level reasons (processing failures) — carried on `result.reasons[]`. */
export function getResultReasons(verification: LabVerificationV1): LabReason[] {
  return (verification.result?.reasons ?? []).filter(isRecord) as LabReason[]
}

/** `detail.sources[]` from the first provider of an identity check. */
export function getIdentitySources(check: LabCheck): IdentitySource[] {
  for (const provider of check.providers ?? []) {
    const sources = provider?.detail?.sources
    if (Array.isArray(sources)) return sources.filter(isRecord) as IdentitySource[]
  }
  return []
}

/** `detail.pep` / `detail.sanctions` from the first provider of a screening check. */
export function getScreening(check: LabCheck): {
  pep?: ScreeningCategory
  sanctions?: ScreeningCategory
} {
  for (const provider of check.providers ?? []) {
    const detail = provider?.detail
    if (!isRecord(detail)) continue
    const pep = isRecord(detail.pep) ? (detail.pep as ScreeningCategory) : undefined
    const sanctions = isRecord(detail.sanctions)
      ? (detail.sanctions as ScreeningCategory)
      : undefined
    if (pep || sanctions) return { pep, sanctions }
  }
  return {}
}

/** Human label for a check type. */
export function checkLabel(checkType: string | null | undefined): string {
  switch (checkType) {
    case 'identity':
      return 'Identity'
    case 'screening':
      return 'Screening (PEP & sanctions)'
    case 'deceased':
      return 'Deceased register'
    case 'biometric':
      return 'Biometric'
    case 'death_certificate':
      return 'Death certificate'
    default:
      return checkType ? checkType.replace(/_/g, ' ') : 'Check'
  }
}

/** Tone for a pass / fail / refer outcome (null = no verdict). */
export function outcomeTone(outcome: string | null | undefined): Tone {
  switch ((outcome ?? '').toLowerCase()) {
    case 'pass':
      return 'pass'
    case 'fail':
      return 'fail'
    case 'refer':
      return 'warn'
    default:
      return 'muted'
  }
}

/**
 * Tone for a `SourceResult` (source / attribute level) or a
 * `ScreeningMatchOutcome` (category / watchlist level). One vocabulary covers
 * both: `match` on a *source* is good, `match` on a *screening category* is a
 * hit — pass `context` to disambiguate.
 */
export function resultTone(
  value: string | null | undefined,
  context: 'source' | 'screening' = 'source',
): Tone {
  const v = (value ?? '').toLowerCase()
  if (context === 'screening') {
    switch (v) {
      case 'no_match':
      case 'no-match':
      case 'clear':
        return 'pass'
      case 'match':
        return 'fail'
      case 'inconclusive':
        return 'warn'
      default:
        return 'muted'
    }
  }
  switch (v) {
    case 'match':
      return 'pass'
    case 'partial_match':
      return 'warn'
    case 'no_match':
      return 'fail'
    default:
      return 'muted'
  }
}

/** Tone for Billie's own APPROVED / DECLINED decision string. */
export function decisionTone(decision: string | null | undefined): Tone {
  const d = (decision ?? '').toUpperCase()
  if (['PASS', 'APPROVED', 'ACCEPT'].includes(d)) return 'pass'
  if (['FAIL', 'DECLINED', 'REJECT'].includes(d)) return 'fail'
  return d ? 'warn' : 'muted'
}

/** Short explanation shown as a tooltip on `undisclosed` / `not_checked` / `no_data`. */
export function resultHint(value: string | null | undefined): string | undefined {
  switch ((value ?? '').toLowerCase()) {
    case 'undisclosed':
      return 'Withheld: seeing DVS source results needs a DVS business-user registration. Not a failure.'
    case 'not_checked':
      return 'Nothing was compared for this source — not evidence about the identity.'
    case 'no_data':
      return 'The source held no data for this attribute.'
    case 'partial_match':
      return 'Fuzzy match (e.g. an abbreviation or alternate spelling).'
    case 'inconclusive':
      return 'The watchlist gave no usable answer — not evidence the subject is clear.'
    case 'not_performed':
      return 'This screening category was not included in the verification.'
    default:
      return undefined
  }
}

/** `match` → "match", `no_match` → "no match" — for display only. */
export function humanise(value: string | null | undefined): string {
  return value ? value.replace(/_/g, ' ') : '—'
}
