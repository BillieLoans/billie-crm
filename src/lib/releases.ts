/**
 * Target resolution + preflight partition for applicant releases (spec §5).
 *
 * ONE implementation serves both the preflight display and the actual release
 * command — the numbers staff confirmed are, by construction, the numbers
 * released.
 */
import type { Payload } from 'payload'
import { getMarketingConsentGranted, normaliseAuMobile } from '@/lib/marketing'
import type { CreateReleaseCommand } from '@/lib/schemas/releases'

export type ReleaseBucket =
  | 'granted_sms'
  | 'granted_no_sms'
  | 'skipped_already_customer'
  | 'skipped_already_released'
  | 'skipped_needs_review'
  | 'skipped_invalid_number'

export interface ReleaseCandidate {
  mobileE164: string
  contactId: string | null
  sendSms: boolean
  bucket: ReleaseBucket
}

export interface ReleasePartition {
  candidates: ReleaseCandidate[]
  counts: Record<ReleaseBucket, number>
  /**
   * True when any of the underlying bulk reads (waitlist contacts,
   * actively-released release-batches, or their release-grants) hit its
   * page-size cap — the partition below is a possibly-incomplete slice, not
   * the whole population. Absent/false in the normal case. Counts are still
   * computed from whatever was fetched; callers should surface this to staff
   * rather than silently trust the numbers.
   */
  truncated?: boolean
}

interface PartitionArgs {
  payload: Payload
  user: unknown
  command: CreateReleaseCommand
}

const EMPTY_COUNTS: Record<ReleaseBucket, number> = {
  granted_sms: 0,
  granted_no_sms: 0,
  skipped_already_customer: 0,
  skipped_already_released: 0,
  skipped_needs_review: 0,
  skipped_invalid_number: 0,
}

interface ContactLite {
  contactId?: string | null
  mobileE164?: string | null
  consent?: unknown
  needsReview?: boolean | null
  customerId?: string | null
}

const WAITLIST_LIMIT = 10_000
const BATCHES_LIMIT = 1000
const GRANTS_LIMIT = 10_000

/**
 * Whether a `payload.find` page is a partial slice of a larger population.
 * `totalDocs` (Payload's pagination count) is authoritative when present;
 * falls back to "the page came back exactly full" when it isn't.
 */
function isTruncated(result: { docs: unknown[]; totalDocs?: number }, limit: number): boolean {
  if (typeof result.totalDocs === 'number') return result.totalDocs > limit
  return result.docs.length === limit
}

export async function computeReleasePartition({
  payload,
  user,
  command,
}: PartitionArgs): Promise<ReleasePartition> {
  if (command.type === 'open_quota') {
    return { candidates: [], counts: { ...EMPTY_COUNTS } }
  }

  const { mobiles: activeGrantMobiles, truncated: grantsTruncated } =
    await fetchActivelyReleasedMobiles(payload, user)
  let truncated = grantsTruncated
  const candidates: ReleaseCandidate[] = []

  if (command.type === 'waitlist') {
    const result = await payload.find({
      collection: 'contacts',
      where: {
        derivedStage: { equals: 'waitlist' },
        mobileE164: { exists: true },
        erased: { not_equals: true },
        mergedInto: { exists: false },
      } as never,
      sort: 'waitlistPosition,waitlistJoinedAt',
      limit: WAITLIST_LIMIT,
      depth: 0,
      overrideAccess: false,
      user,
    })
    if (isTruncated(result, WAITLIST_LIMIT)) {
      truncated = true
      console.warn(
        `[computeReleasePartition] waitlist contacts fetch truncated at limit=${WAITLIST_LIMIT} (totalDocs=${result.totalDocs})`,
      )
    }
    let taken = 0
    for (const doc of result.docs as ContactLite[]) {
      if (taken >= (command.count ?? 0)) break
      const candidate = bucketContact(doc, command.sendInviteSms, activeGrantMobiles)
      candidates.push(candidate)
      if (candidate.bucket === 'granted_sms' || candidate.bucket === 'granted_no_sms') taken++
    }
  } else {
    const seen = new Set<string>()
    for (const raw of command.mobiles ?? []) {
      const mobile = normaliseAuMobile(raw)
      if (!mobile) {
        candidates.push({
          mobileE164: raw,
          contactId: null,
          sendSms: false,
          bucket: 'skipped_invalid_number',
        })
        continue
      }
      if (seen.has(mobile)) continue
      seen.add(mobile)
      const match = await payload.find({
        collection: 'contacts',
        where: { mobileE164: { equals: mobile }, mergedInto: { exists: false } } as never,
        limit: 1,
        depth: 0,
        overrideAccess: false,
        user,
      })
      const contact = (match.docs[0] as ContactLite | undefined) ?? null
      candidates.push(
        bucketContact(
          contact ?? { mobileE164: mobile, contactId: null },
          command.sendInviteSms,
          activeGrantMobiles,
        ),
      )
    }
  }

  const counts = { ...EMPTY_COUNTS }
  for (const c of candidates) counts[c.bucket]++
  const partition: ReleasePartition = { candidates, counts }
  if (truncated) partition.truncated = true
  return partition
}

function bucketContact(
  contact: ContactLite,
  sendInviteSms: boolean,
  activeGrantMobiles: Set<string>,
): ReleaseCandidate {
  const mobile = contact.mobileE164 as string
  const base = { mobileE164: mobile, contactId: contact.contactId ?? null }
  if (contact.customerId) return { ...base, sendSms: false, bucket: 'skipped_already_customer' }
  if (activeGrantMobiles.has(mobile))
    return { ...base, sendSms: false, bucket: 'skipped_already_released' }
  if (contact.needsReview) return { ...base, sendSms: false, bucket: 'skipped_needs_review' }
  const consented = getMarketingConsentGranted(contact.consent as never) === true
  if (sendInviteSms && contact.contactId && consented) {
    return { ...base, sendSms: true, bucket: 'granted_sms' }
  }
  return { ...base, sendSms: false, bucket: 'granted_no_sms' }
}

async function fetchActivelyReleasedMobiles(
  payload: Payload,
  user: unknown,
): Promise<{ mobiles: Set<string>; truncated: boolean }> {
  const now = new Date().toISOString()
  const activeBatches = await payload.find({
    collection: 'release-batches',
    where: { status: { equals: 'active' }, expiresAt: { greater_than: now } } as never,
    limit: BATCHES_LIMIT,
    depth: 0,
    overrideAccess: false,
    user,
  })
  let truncated = false
  if (isTruncated(activeBatches, BATCHES_LIMIT)) {
    truncated = true
    console.warn(
      `[computeReleasePartition] release-batches fetch truncated at limit=${BATCHES_LIMIT} (totalDocs=${activeBatches.totalDocs})`,
    )
  }
  const ids = activeBatches.docs.map((d) => (d as { releaseId?: string }).releaseId).filter(Boolean)
  if (ids.length === 0) return { mobiles: new Set(), truncated }
  const grants = await payload.find({
    collection: 'release-grants',
    where: { releaseId: { in: ids }, status: { in: ['granted', 'claimed'] } } as never,
    limit: GRANTS_LIMIT,
    depth: 0,
    overrideAccess: false,
    user,
  })
  if (isTruncated(grants, GRANTS_LIMIT)) {
    truncated = true
    console.warn(
      `[computeReleasePartition] release-grants fetch truncated at limit=${GRANTS_LIMIT} (totalDocs=${grants.totalDocs})`,
    )
  }
  return {
    mobiles: new Set(grants.docs.map((d) => (d as { mobileE164?: string }).mobileE164 ?? '')),
    truncated,
  }
}
