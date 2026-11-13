/**
 * Delete a customer's bank-statement files from S3.
 *
 * The scope (one application, or every application for a customer) is always
 * resolved here from the conversations projection, and S3 is always listed
 * here: callers never supply keys.
 *
 * Per application: list every version, place a delete marker on each key that
 * holds data (a plain delete, no VersionId), then delete the listed data
 * versions by VersionId. The marker comes first because replication carries
 * delete markers to the backup bucket but never version-specific deletes; the
 * marker makes the backup's copy noncurrent, and its lifecycle rule erases it.
 * A key whose marker was not placed keeps all its versions. Delete markers are
 * never deleted and never counted as files.
 *
 * Then the prefixes are listed again: the status and counts follow the data
 * versions actually left in the bucket, not what DeleteObjects claimed. If that
 * re-list fails, nothing is counted as deleted. One append-only
 * `statement-file-deletions` row is written per application, whatever the
 * outcome.
 *
 * One key is kept: the application's affordability report
 * (`AffordabilityReports/{app}_affordability.json`). The listing drops it, so it
 * is never counted, never gets a marker, is never version-deleted and never
 * reads as remaining; the marker and delete steps also refuse it outright.
 *
 * Authorisation is the route's job; every Local API call here overrides access.
 */
import type { Payload, Where } from 'payload'
import {
  isKeptKey,
  isKeyWithinPrefixes,
  isValidApplicationNumber,
  keptStatementKeys,
  statementPrefixes,
  UNCONFIRMED_DELETION_ERROR,
  type DeletionStatus,
  type DeletionWarning,
} from '@/lib/statement-deletion'
import {
  deleteObjectVersions,
  getStatementBaseFolder,
  listObjectVersionsUnderPrefix,
  placeDeleteMarkers,
  type ObjectVersionRef,
  type VersionedKey,
} from '@/server/s3-client'

export type DeletionScope =
  | { scope: 'application'; conversationId: string }
  | { scope: 'customer'; customerIdString: string }

export interface ApplicationPreview {
  conversationId: string
  applicationNumber: string | null
  /** Data versions found under the application's prefixes. Delete markers are not files. */
  fileCount: number
  warnings: DeletionWarning[]
  error?: string
}

export interface ApplicationResult extends ApplicationPreview {
  status: DeletionStatus
  /** Data versions confirmed gone by re-listing after the delete. */
  filesDeleted: number
  /**
   * Data versions still listed after the delete, including any written
   * mid-delete. When the re-list failed, every data version found (nothing is
   * confirmed gone).
   */
  failedCount: number
}

export interface LatestDeletion {
  occurredAt: string
  actorName: string | null
  actorEmail: string | null
  filesDeleted: number
  reason: string
  status: 'deleted' | 'partial'
}

const INVALID_APPLICATION_NUMBER = 'Missing or invalid application number'
const ERROR_MESSAGE_MAX = 200

/**
 * The deletion log row could not be written after the S3 work for an
 * application had run, so files may already be gone with no audit row.
 * The route tells the operator to check before retrying.
 */
export class DeletionLogWriteError extends Error {
  constructor(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause)
    super(`Could not write the deletion log row: ${message}`, { cause })
    this.name = 'DeletionLogWriteError'
  }
}

interface ConversationRow {
  conversationId: string
  applicationNumber: string | null
  customerIdString: string | null
  status: string | null
  statementCapture: unknown
}

async function resolveConversations(
  payload: Payload,
  scope: DeletionScope,
): Promise<ConversationRow[]> {
  const where: Where =
    scope.scope === 'application'
      ? { conversationId: { equals: scope.conversationId } }
      : { customerIdString: { equals: scope.customerIdString } }
  const { docs } = await payload.find({
    collection: 'conversations',
    where,
    overrideAccess: true,
    pagination: false,
    depth: 0,
    select: {
      conversationId: true,
      applicationNumber: true,
      customerIdString: true,
      status: true,
      statementCapture: true,
    },
  })
  return (docs as unknown as Array<Partial<ConversationRow>>).map((d) => ({
    conversationId: String(d.conversationId ?? ''),
    applicationNumber: d.applicationNumber ?? null,
    customerIdString: d.customerIdString ?? null,
    status: d.status ?? null,
    statementCapture: d.statementCapture ?? null,
  }))
}

function isInProgress(conv: ConversationRow): boolean {
  if (conv.status === 'active' || conv.status === 'paused') return true
  const sc = conv.statementCapture
  if (sc && typeof sc === 'object') {
    const capture = sc as { consentStatus?: unknown; checksComplete?: unknown }
    if (capture.consentStatus === 'complete' && capture.checksComplete !== true) return true
  }
  return false
}

async function hasFundedLoan(payload: Payload, applicationNumber: string | null): Promise<boolean> {
  if (typeof applicationNumber !== 'string' || applicationNumber === '') return false
  const { docs } = await payload.find({
    collection: 'loan-accounts',
    where: { applicationNumber: { equals: applicationNumber } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    select: { applicationNumber: true },
  })
  return docs.length > 0
}

async function warningsFor(payload: Payload, conv: ConversationRow): Promise<DeletionWarning[]> {
  const warnings: DeletionWarning[] = []
  if (isInProgress(conv)) warnings.push('in_progress')
  if (await hasFundedLoan(payload, conv.applicationNumber)) warnings.push('funded_loan')
  return warnings
}

/**
 * Every version and delete marker under the application's prefixes, re-checked
 * key by key: a listing that strays outside the prefixes (e.g. APP-10 for
 * APP-1) is dropped and reported, never deleted.
 */
async function listApplicationVersions(prefixes: string[]): Promise<ObjectVersionRef[]> {
  const refs: ObjectVersionRef[] = []
  for (const prefix of prefixes) {
    for (const ref of await listObjectVersionsUnderPrefix(prefix)) {
      if (isKeyWithinPrefixes(ref.key, prefixes)) {
        refs.push(ref)
      } else {
        console.error('[statement-deletion] dropped listed key outside the prefixes', {
          key: ref.key,
          prefixes,
        })
      }
    }
  }
  return refs
}

function shortMessage(prefix: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return `${prefix}: ${message}`.slice(0, ERROR_MESSAGE_MAX)
}

/** Where one application's deletable files live, and the keys that are never deleted. */
interface ApplicationScope {
  prefixes: string[]
  kept: string[]
}

function applicationScope(baseFolder: string, applicationNumber: string): ApplicationScope {
  return {
    prefixes: statementPrefixes(baseFolder, applicationNumber),
    kept: keptStatementKeys(baseFolder, applicationNumber),
  }
}

/**
 * The listed entries that can be deleted: data versions only (no delete
 * markers), and nothing on a kept key, whichever kind of entry it is.
 */
async function listApplicationData({
  prefixes,
  kept,
}: ApplicationScope): Promise<ObjectVersionRef[]> {
  return (await listApplicationVersions(prefixes)).filter(
    (r) => !r.isDeleteMarker && !isKeptKey(r.key, kept),
  )
}

/** Defence in depth: drop (and report) any kept key that reached a destructive step. */
function withoutKept<T>(items: T[], keyOf: (item: T) => string, kept: string[], step: string): T[] {
  const allowed = items.filter((item) => !isKeptKey(keyOf(item), kept))
  if (allowed.length !== items.length) {
    console.error('[statement-deletion] refused to act on a kept key', { step, kept })
  }
  return allowed
}

const versionId = (r: VersionedKey) => `${r.key}\u0000${r.versionId}`
const distinctKeys = (refs: Array<{ key: string }>) => [...new Set(refs.map((r) => r.key))]
const distinctMessages = (failures: Array<{ message: string }>) =>
  [...new Set(failures.map((f) => f.message))].join('; ')

export async function previewDeletion(
  payload: Payload,
  scope: DeletionScope,
): Promise<ApplicationPreview[]> {
  const baseFolder = getStatementBaseFolder()
  const conversations = await resolveConversations(payload, scope)
  const previews: ApplicationPreview[] = []

  for (const conv of conversations) {
    const preview: ApplicationPreview = {
      conversationId: conv.conversationId,
      applicationNumber: conv.applicationNumber,
      fileCount: 0,
      warnings: await warningsFor(payload, conv),
    }
    if (!isValidApplicationNumber(conv.applicationNumber)) {
      preview.error = INVALID_APPLICATION_NUMBER
    } else {
      try {
        const refs = await listApplicationData(applicationScope(baseFolder, conv.applicationNumber))
        preview.fileCount = refs.length
      } catch (err) {
        console.error('[statement-deletion] preview listing failed', {
          conversationId: conv.conversationId,
          err,
        })
        preview.error = shortMessage('Could not list files', err)
      }
    }
    previews.push(preview)
  }

  return previews
}

interface Outcome {
  status: DeletionStatus
  filesFound: number
  filesDeleted: number
  /** Data versions still listed after the delete (or all found, if that is unconfirmed). */
  failedCount: number
  deletedKeys: string[]
  failedKeys: string[]
  error?: string
}

const failedOutcome = (error: string): Outcome => ({
  status: 'failed',
  filesFound: 0,
  filesDeleted: 0,
  failedCount: 0,
  deletedKeys: [],
  failedKeys: [],
  error,
})

async function deleteApplication(baseFolder: string, conv: ConversationRow): Promise<Outcome> {
  if (!isValidApplicationNumber(conv.applicationNumber)) {
    return failedOutcome(INVALID_APPLICATION_NUMBER)
  }
  const scope = applicationScope(baseFolder, conv.applicationNumber)

  let found: ObjectVersionRef[]
  try {
    found = await listApplicationData(scope)
  } catch (err) {
    console.error('[statement-deletion] listing failed', {
      conversationId: conv.conversationId,
      err,
    })
    return failedOutcome(shortMessage('Could not list files', err))
  }

  if (found.length === 0) {
    return {
      status: 'nothing_found',
      filesFound: 0,
      filesDeleted: 0,
      failedCount: 0,
      deletedKeys: [],
      failedKeys: [],
    }
  }

  // Markers first. A key without its marker keeps every version: deleting them
  // by VersionId alone would never reach the backup bucket.
  const keys = withoutKept(distinctKeys(found), (k) => k, scope.kept, 'delete marker')
  let markerFailures: Array<{ key: string; message: string }>
  let placed: Set<string>
  try {
    const res = await placeDeleteMarkers(keys)
    placed = new Set(res.placed)
    markerFailures = res.failed
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    placed = new Set()
    markerFailures = keys.map((key) => ({ key, message }))
  }
  const reportedFailed = new Set(markerFailures.map((f) => f.key))
  for (const key of keys) {
    if (!placed.has(key) && !reportedFailed.has(key)) {
      markerFailures.push({ key, message: 'No result returned' })
    }
  }
  if (markerFailures.length > 0) {
    console.error('[statement-deletion] some delete markers could not be placed', {
      conversationId: conv.conversationId,
      markerFailures,
    })
  }
  const markerReason =
    markerFailures.length > 0
      ? `Could not place delete marker: ${distinctMessages(markerFailures)}`
      : undefined
  const markerFailedKeys = new Set(markerFailures.map((f) => f.key))

  // Only the data versions listed above, so the new markers (and any older
  // ones) are never deleted. A key is deleted only when its marker is
  // confirmed placed and not also reported failed.
  const toDelete: VersionedKey[] = withoutKept(
    found.filter((r) => placed.has(r.key) && !markerFailedKeys.has(r.key) && !r.isDeleteMarker),
    (r) => r.key,
    scope.kept,
    'version delete',
  ).map((r) => ({ key: r.key, versionId: r.versionId }))
  let failed: Array<VersionedKey & { message: string }> = []
  if (toDelete.length > 0) {
    try {
      ;({ failed } = await deleteObjectVersions(toDelete))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failed = toDelete.map((r) => ({ ...r, message }))
    }
  }
  if (failed.length > 0) {
    console.error('[statement-deletion] some versions could not be deleted', {
      conversationId: conv.conversationId,
      failed,
    })
  }

  // Verify against the bucket rather than trusting the delete response: the
  // data versions still listed are what remains, including any written
  // mid-delete. Delete markers, old and new, are not files.
  let remaining: ObjectVersionRef[]
  try {
    remaining = await listApplicationData(scope)
  } catch (err) {
    // Without a re-list nothing is confirmed gone, so nothing is counted as
    // deleted and the outcome never reads as a clean delete. The confirm prefix
    // stays first (the UI keys on it); marker failures follow for the audit row.
    console.error('[statement-deletion] verification listing failed', {
      conversationId: conv.conversationId,
      err,
    })
    return {
      status: 'partial',
      filesFound: found.length,
      filesDeleted: 0,
      failedCount: found.length,
      deletedKeys: [],
      failedKeys: distinctKeys(found),
      error: [shortMessage(UNCONFIRMED_DELETION_ERROR, err), markerReason]
        .filter(Boolean)
        .join('; ')
        .slice(0, ERROR_MESSAGE_MAX),
    }
  }

  const stillThere = new Set(remaining.map(versionId))
  const filesDeleted = found.filter((r) => !stillThere.has(versionId(r))).length
  const failedKeys = distinctKeys(remaining)
  const failedKeySet = new Set(failedKeys)
  const deletedKeys = distinctKeys(found).filter((k) => !failedKeySet.has(k))

  let status: DeletionStatus
  if (remaining.length === 0) status = 'deleted'
  else if (filesDeleted === 0) status = 'failed'
  else status = 'partial'

  // The marker and delete failures only explain what is still listed.
  const reasons: string[] = []
  if (markerReason) reasons.push(markerReason)
  if (failed.length > 0) reasons.push(`Could not delete: ${distinctMessages(failed)}`)
  const error =
    remaining.length > 0 && reasons.length > 0
      ? reasons.join('; ').slice(0, ERROR_MESSAGE_MAX)
      : undefined

  return {
    status,
    filesFound: found.length,
    filesDeleted,
    failedCount: remaining.length,
    deletedKeys,
    failedKeys,
    error,
  }
}

export async function executeDeletion(
  payload: Payload,
  scope: DeletionScope,
  reason: string,
  actor: { id: string; email?: string; name?: string },
): Promise<ApplicationResult[]> {
  const baseFolder = getStatementBaseFolder()
  const conversations = await resolveConversations(payload, scope)
  const results: ApplicationResult[] = []

  for (const conv of conversations) {
    const warnings = await warningsFor(payload, conv)
    const outcome = await deleteApplication(baseFolder, conv)

    // A failed write throws: stopping before the next application is better
    // than deleting more files with no audit row. The outcome is logged first so
    // the evidence of what was deleted survives in the logs.
    try {
      await payload.create({
        collection: 'statement-file-deletions',
        overrideAccess: true,
        data: {
          conversationId: conv.conversationId,
          applicationNumber: conv.applicationNumber,
          customerIdString: conv.customerIdString,
          scope: scope.scope,
          actorId: actor.id,
          actorEmail: actor.email ?? null,
          actorName: actor.name ?? null,
          reason,
          status: outcome.status,
          filesFound: outcome.filesFound,
          filesDeleted: outcome.filesDeleted,
          warnings,
          deletedKeys: outcome.deletedKeys,
          failedKeys: outcome.failedKeys,
          error: outcome.error ?? null,
          occurredAt: new Date().toISOString(),
        },
      })
    } catch (err) {
      console.error('[statement-deletion] could not write the deletion log row', {
        conversationId: conv.conversationId,
        applicationNumber: conv.applicationNumber,
        status: outcome.status,
        filesFound: outcome.filesFound,
        filesDeleted: outcome.filesDeleted,
        deletedKeys: outcome.deletedKeys,
        failedKeys: outcome.failedKeys,
        error: outcome.error,
        err,
      })
      throw new DeletionLogWriteError(err)
    }

    const result: ApplicationResult = {
      conversationId: conv.conversationId,
      applicationNumber: conv.applicationNumber,
      fileCount: outcome.filesFound,
      warnings,
      status: outcome.status,
      filesDeleted: outcome.filesDeleted,
      failedCount: outcome.failedCount,
    }
    if (outcome.error) result.error = outcome.error
    results.push(result)
  }

  return results
}

/**
 * The newest deletion that actually removed files, for the conversation's
 * Files block: a `deleted` or `partial` row with at least one file removed.
 * An unverified outcome (the post-delete re-list failed) is logged as
 * `partial` with nothing counted as deleted, so it never hides the files.
 */
export async function latestDeletion(
  payload: Payload,
  conversationId: string,
): Promise<LatestDeletion | null> {
  const { docs } = await payload.find({
    collection: 'statement-file-deletions',
    where: {
      conversationId: { equals: conversationId },
      status: { in: ['deleted', 'partial'] },
      filesDeleted: { greater_than: 0 },
    },
    sort: ['-occurredAt'],
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const row = docs[0] as
    | {
        occurredAt: string
        actorName?: string | null
        actorEmail?: string | null
        filesDeleted: number
        reason: string
        status: string
      }
    | undefined
  if (!row || (row.status !== 'deleted' && row.status !== 'partial')) return null
  if (!(row.filesDeleted > 0)) return null
  return {
    occurredAt: row.occurredAt,
    actorName: row.actorName ?? null,
    actorEmail: row.actorEmail ?? null,
    filesDeleted: row.filesDeleted,
    reason: row.reason,
    status: row.status,
  }
}
