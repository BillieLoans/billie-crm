/**
 * API Route: GET /api/marketing/contacts/[contactId]/identity
 *
 * The identity graph for one contact: every other contact record the system
 * believes is the same person, and why. A sibling qualifies by any of:
 *   - same_customer — linked to the same platform customer_id
 *   - same_mobile   — identical normalised mobile
 *   - same_email    — identical normalised email
 * A sibling can match on several bases at once; all are returned so the UI
 * can say HOW each connection was arrived at. Non-erased contacts only.
 * Gated on `canReadMarketing` like the rest of the read surface.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canReadMarketing } from '@/lib/access'
import { siblingBases, type SiblingBasis } from '@/lib/marketing'
import type { Contact } from '@/payload-types'

interface Sibling {
  contactId: string
  firstName: string | null
  mobileE164: string | null
  email: string | null
  derivedStage: string | null
  customerId: string | null
  bases: SiblingBasis[]
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  const auth = await requireAuth(canReadMarketing)
  if ('error' in auth) return auth.error
  const { payload, user } = auth
  const { contactId } = await params

  const contactResult = await payload.find({
    collection: 'contacts',
    where: { contactId: { equals: contactId } },
    limit: 1,
    overrideAccess: false,
    user,
  })
  const contact = contactResult.docs[0]
  if (!contact) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Contact not found' } },
      { status: 404 },
    )
  }

  const or: Record<string, unknown>[] = []
  if (contact.customerId) or.push({ customerId: { equals: contact.customerId } })
  if (contact.mobileE164) or.push({ mobileE164: { equals: contact.mobileE164 } })
  if (contact.email) or.push({ email: { equals: contact.email } })

  let siblings: Sibling[] = []
  if (or.length > 0) {
    const result = await payload.find({
      collection: 'contacts',
      where: {
        and: [
          { or },
          { contactId: { not_equals: contactId } },
          { erased: { not_equals: true } },
        ],
      } as never,
      limit: 20,
      sort: '-updatedAt',
      overrideAccess: false,
      user,
    })

    siblings = result.docs.map((doc: Contact) => {
      const bases: SiblingBasis[] = siblingBases(contact, doc)
      return {
        contactId: doc.contactId,
        firstName: doc.firstName ?? null,
        mobileE164: doc.mobileE164 ?? null,
        email: doc.email ?? null,
        derivedStage: doc.derivedStage ?? null,
        customerId: doc.customerId ?? null,
        bases,
      }
    })
  }

  return NextResponse.json({
    contactId,
    customerId: contact.customerId ?? null,
    siblings,
  })
}
