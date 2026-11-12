/**
 * Permanently delete a customer's bank-statement files from S3.
 *
 * The scope (one application, or every application for a customer) is always
 * resolved here from the conversations projection, and S3 is always listed
 * here: callers never supply keys. Each application's files are deleted
 * version by version, then the prefixes are listed again so the reported
 * counts reflect what is actually left in the bucket, not what DeleteObjects
 * claimed. One append-only `statement-file-deletions` row is written per
 * application, whatever the outcome.
 *
 * Authorisation is the route's job; every Local API call here overrides access.
 */
import type { Payload, Where } from 'payload'
import {
  isKeyWithinPrefixes,
  isValidApplicationNumber,
  statementPrefixes,
  type DeletionStatus,
  type DeletionWarning,
} from '@/lib/statement-deletion'
import {
  deleteObjectVersions,
  getStatementBaseFolder,
  listObjectVersionsUnderPrefix,
  type ObjectVersionRef,
} from '@/server/s3-client'

export type DeletionScope =
  | { scope: 'application'; conversationId: string }
  | { scope: 'customer'; customerIdString: string }

export interface ApplicationPreview {
  conversationId: string
  applicationNumber: string | null
  /** Object versions (delete markers included) found under the application's prefixes. */
  fileCount: number
  warnings: DeletionWarning[]
  error?: string
}

export interface ApplicationResult extends ApplicationPreview {
  status: DeletionStatus
  /** Versions confirmed gone by re-listing after the delete. */
  filesDeleted: number
  /** Versions found that are still there. */
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
 * Every version under the application's prefixes, re-checked key by key: a
 * listing that strays outside the prefixes (e.g. APP-10 for APP-1) is dropped
 * and reported, never deleted.
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

const versionId = (r: ObjectVersionRef) => `${r.key}\u0000${r.versionId}`
const distinctKeys = (refs: Array<{ key: string }>) => [...new Set(refs.map((r) => r.key))]

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
        const refs = await listApplicationVersions(
          statementPrefixes(baseFolder, conv.applicationNumber),
        )
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
  deletedKeys: string[]
  failedKeys: string[]
  error?: string
}

const failedOutcome = (error: string): Outcome => ({
  status: 'failed',
  filesFound: 0,
  filesDeleted: 0,
  deletedKeys: [],
  failedKeys: [],
  error,
})

async function deleteApplication(baseFolder: string, conv: ConversationRow): Promise<Outcome> {
  if (!isValidApplicationNumber(conv.applicationNumber)) {
    return failedOutcome(INVALID_APPLICATION_NUMBER)
  }
  const prefixes = statementPrefixes(baseFolder, conv.applicationNumber)

  let found: ObjectVersionRef[]
  try {
    found = await listApplicationVersions(prefixes)
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
      deletedKeys: [],
      failedKeys: [],
    }
  }

  let failed: Array<ObjectVersionRef & { message: string }>
  try {
    ;({ failed } = await deleteObjectVersions(found))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    failed = found.map((r) => ({ ...r, message }))
  }
  if (failed.length > 0) {
    console.error('[statement-deletion] some versions could not be deleted', {
      conversationId: conv.conversationId,
      failed,
    })
  }

  // Verify against the bucket rather than trusting the delete response.
  let remaining: ObjectVersionRef[] = []
  let stillThere: Set<string>
  let error: string | undefined
  try {
    remaining = await listApplicationVersions(prefixes)
    stillThere = new Set(remaining.map(versionId))
  } catch (err) {
    // Without a re-list, fall back to what S3 reported as failed, and never
    // let the outcome read as a clean delete.
    console.error('[statement-deletion] verification listing failed', {
      conversationId: conv.conversationId,
      err,
    })
    error = shortMessage('Could not confirm deletion', err)
    stillThere = new Set(failed.map(versionId))
  }

  const gone = found.filter((r) => !stillThere.has(versionId(r)))
  const filesDeleted = gone.length

  const failedKeys = distinctKeys([...remaining, ...failed])
  const failedKeySet = new Set(failedKeys)
  const deletedKeys = distinctKeys(gone).filter((k) => !failedKeySet.has(k))

  let status: DeletionStatus
  if (remaining.length === 0 && failed.length === 0 && !error) status = 'deleted'
  else if (filesDeleted === 0) status = 'failed'
  else status = 'partial'

  return { status, filesFound: found.length, filesDeleted, deletedKeys, failedKeys, error }
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
    // than deleting more files with no audit row.
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
        occurredAt: new Date().toISOString(),
      },
    })

    const result: ApplicationResult = {
      conversationId: conv.conversationId,
      applicationNumber: conv.applicationNumber,
      fileCount: outcome.filesFound,
      warnings,
      status: outcome.status,
      filesDeleted: outcome.filesDeleted,
      failedCount: outcome.filesFound - outcome.filesDeleted,
    }
    if (outcome.error) result.error = outcome.error
    results.push(result)
  }

  return results
}

/** The newest deletion that actually removed files, for the conversation's Files block. */
export async function latestDeletion(
  payload: Payload,
  conversationId: string,
): Promise<LatestDeletion | null> {
  const { docs } = await payload.find({
    collection: 'statement-file-deletions',
    where: {
      conversationId: { equals: conversationId },
      status: { in: ['deleted', 'partial'] },
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
  return {
    occurredAt: row.occurredAt,
    actorName: row.actorName ?? null,
    actorEmail: row.actorEmail ?? null,
    filesDeleted: row.filesDeleted,
    reason: row.reason,
    status: row.status,
  }
}
