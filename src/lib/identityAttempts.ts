/**
 * Identity verification attempts (billieChat spec 2026-09-15).
 *
 * The event-processor stores one entry per LAB verify call in
 * `conversations.identity_verification_attempts` — a jsonb OBJECT keyed by
 * LAB request id (or `attempt-<n>` without one), merged from
 * `identity_verification.attempt.v1` and
 * `identity_verification.report.archived.v1`. These helpers shape that object
 * into the sorted, browser-safe array the APIs return: S3 locations are
 * replaced by availability booleans and file names.
 */

export interface IdentityAttempt {
  /** Attempt entry key — LAB request id, or `attempt-<n>` (mock mode). */
  key: string
  attemptNumber: number
  /** This call was the one-document step-up re-run. */
  stepUp: boolean
  /** This call failed identity and a further document was requested. */
  stepUpRequested: boolean
  /** Document TYPE names sent on this call; empty = electronic only. */
  documentTypes: string[]
  decision: string | null
  identityVerificationFailed: boolean
  screeningHit: boolean
  pepResult: string | null
  sanctionsResult: string | null
  /** Verbatim LAB block for this call (legacy EVS or v1 envelope). */
  labVerification: Record<string, unknown> | null
  labRequestId: string | null
  checkedAt: string | null
  reportAvailable: boolean
  reportFileName: string | null
  rawResponseAvailable: boolean
  rawResponseFileName: string | null
  /** LAB API v1 only: the screening check's own report PDF for this call. */
  screeningReportAvailable: boolean
  screeningReportFileName: string | null
  archivedAt: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const str = (value: unknown): string | null =>
  value == null ? null : typeof value === 'string' ? value : String(value)

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
      ? Number(value)
      : fallback

/**
 * Shape the stored attempts object into a browser-safe array sorted by
 * attempt number (ties by checkedAt). Tolerates null / malformed input.
 */
export function shapeAttempts(raw: unknown): IdentityAttempt[] {
  if (!isRecord(raw)) return []
  const attempts: IdentityAttempt[] = []
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue
    const documentTypes = Array.isArray(value.document_types)
      ? value.document_types.filter((t): t is string => typeof t === 'string')
      : []
    attempts.push({
      key,
      attemptNumber: num(value.attempt_number, Number.MAX_SAFE_INTEGER),
      stepUp: value.step_up === true,
      stepUpRequested: value.step_up_requested === true,
      documentTypes,
      decision: str(value.decision),
      identityVerificationFailed: value.identity_verification_failed === true,
      screeningHit: value.screening_hit === true,
      pepResult: str(value.pep_result),
      sanctionsResult: str(value.sanctions_result),
      labVerification: isRecord(value.lab_verification) ? value.lab_verification : null,
      labRequestId: str(value.lab_request_id),
      checkedAt: str(value.checked_at),
      reportAvailable: Boolean(value.report_file_location),
      reportFileName: str(value.report_file_name),
      rawResponseAvailable: Boolean(value.raw_response_file_location),
      rawResponseFileName: str(value.raw_response_file_name),
      screeningReportAvailable: Boolean(value.screening_report_file_location),
      screeningReportFileName: str(value.screening_report_file_name),
      archivedAt: str(value.archived_at),
    })
  }
  return attempts.sort(
    (a, b) =>
      a.attemptNumber - b.attemptNumber || (a.checkedAt ?? '').localeCompare(b.checkedAt ?? ''),
  )
}

/** Human label for a billieChat identity document type. */
export function documentTypeLabel(type: string | null | undefined): string {
  switch ((type ?? '').toUpperCase()) {
    case 'DRIVERS_LICENCE':
      return 'Driver licence'
    case 'PASSPORT':
      return 'Passport'
    case 'MEDICARE':
      return 'Medicare card'
    default:
      return type ? type.toLowerCase().replace(/_/g, ' ') : 'Document'
  }
}

/** "Driver licence + Passport", or "Electronic only" when no document was sent. */
export function attemptDocumentsLabel(types: string[]): string {
  return types.length ? types.map(documentTypeLabel).join(' + ') : 'Electronic only'
}

/** The attempt whose artifacts the given key names, if any. */
export function findAttempt(attempts: IdentityAttempt[], key: string): IdentityAttempt | undefined {
  return attempts.find((a) => a.key === key)
}
