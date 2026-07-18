/**
 * Seed data for the marketing-module e2e suite (tests/e2e/marketing.e2e.spec.ts).
 *
 * Run against a disposable database before starting the app:
 *
 *   DATABASE_URI=postgresql://… PAYLOAD_SECRET=… pnpm exec tsx tests/e2e/seed-marketing.ts
 *
 * Idempotent: rows that already exist (matched on their natural keys) are
 * left untouched, so re-running against the same database is safe. Uses the
 * Payload Local API (overrideAccess) because the marketing collections are
 * read-only projections — in production only the event processor writes them.
 */
import { getPayload } from 'payload'
import config from '../../src/payload.config'

const payload = await getPayload({ config })

async function ensure(
  collection: string,
  where: Record<string, unknown>,
  data: Record<string, unknown>,
) {
  const existing = await payload.find({
    collection: collection as never,
    where: where as never,
    limit: 1,
  })
  if (existing.docs.length > 0) return existing.docs[0]
  return payload.create({ collection: collection as never, data: data as never })
}

const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

await ensure(
  'users',
  { email: { equals: 'e2e-admin@billie.test' } },
  {
    email: 'e2e-admin@billie.test',
    password: 'E2Epassw0rd!',
    role: 'admin',
    firstName: 'E2E',
    lastName: 'Admin',
  },
)

await ensure(
  'batches',
  { batchId: { equals: 'e2e-batch-1' } },
  {
    batchId: 'e2e-batch-1',
    name: 'Campus wave 1',
    criteria: { stage: 'waitlist', city: 'Sydney' },
    batchCreatedAt: days(10),
  },
)

await ensure(
  'contacts',
  { contactId: { equals: 'e2e-alice' } },
  {
    contactId: 'e2e-alice',
    firstName: 'Alice',
    email: 'alice@example.com',
    mobileE164: '+61400000001',
    city: 'Sydney',
    source: 'campus',
    derivedStage: 'waitlist',
    batchId: 'e2e-batch-1',
    consent: {
      marketing: { granted: true, channels: ['sms', 'whatsapp'], method: 'campus stall form' },
    },
  },
)

await ensure(
  'contacts',
  { contactId: { equals: 'e2e-bob' } },
  {
    contactId: 'e2e-bob',
    firstName: 'Bob',
    email: 'bob@example.com',
    mobileE164: '+61400000002',
    city: 'Melbourne',
    source: 'google',
    derivedStage: 'lead',
    consent: { marketing: { granted: false } },
  },
)

await ensure(
  'contacts',
  { contactId: { equals: 'e2e-carol' } },
  {
    contactId: 'e2e-carol',
    firstName: 'Carol',
    mobileE164: '+61400000003',
    city: 'Sydney',
    source: 'referral',
    derivedStage: 'waitlist',
    batchId: 'e2e-batch-1',
    needsReview: true,
    attributes: { needs_review_reason: 'Possible duplicate' },
  },
)

await ensure(
  'feedback',
  { feedbackId: { equals: 'e2e-fb-overdue' } },
  {
    feedbackId: 'e2e-fb-overdue',
    contactIdString: 'e2e-alice',
    feedbackType: 'complaint',
    body: 'The repayment reminder SMS arrived at 3am. This kept happening for two weeks.',
    status: 'new',
    receivedAt: days(30),
  },
)

await ensure(
  'feedback',
  { feedbackId: { equals: 'e2e-fb-new' } },
  {
    feedbackId: 'e2e-fb-new',
    contactIdString: 'e2e-bob',
    feedbackType: 'suggestion',
    body: 'It would be great to see my repayment schedule in the app.',
    status: 'new',
    receivedAt: days(1),
  },
)

await ensure(
  'feedback',
  { feedbackId: { equals: 'e2e-fb-resolved' } },
  {
    feedbackId: 'e2e-fb-resolved',
    contactIdString: 'e2e-alice',
    feedbackType: 'praise',
    body: 'Signup was quick.',
    status: 'resolved',
    statusNote: 'Thanked the contact.',
    receivedAt: days(5),
  },
)

console.log('marketing e2e seed complete')
process.exit(0)
