/**
 * API Route: GET /api/marketing/contacts/[contactId]/referrals
 *
 * Resolves both directions of a contact's referral graph for the contact-detail
 * Referrals panel: who referred THIS contact (`referrer`, from the contact's
 * `referredByContactId`), and the contacts THIS one referred (`referred`, plus a
 * total `referredCount`). Read-only; gated on `canReadMarketing`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canReadMarketing } from '@/lib/access'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  const auth = await requireAuth(canReadMarketing)
  if ('error' in auth) return auth.error
  const { payload, user } = auth
  const { contactId } = await params

  const selfRes = await payload.find({
    collection: 'contacts',
    where: { contactId: { equals: contactId } },
    limit: 1,
    depth: 0,
    overrideAccess: false,
    user,
  })
  const self = selfRes.docs[0]

  let referrer: { contactId: string; firstName: string | null } | null = null
  if (self?.referredByContactId) {
    const refRes = await payload.find({
      collection: 'contacts',
      where: { contactId: { equals: self.referredByContactId } },
      limit: 1,
      depth: 0,
      overrideAccess: false,
      user,
    })
    const r = refRes.docs[0]
    if (r) referrer = { contactId: r.contactId, firstName: r.firstName ?? null }
  }

  const referredRes = await payload.find({
    collection: 'contacts',
    where: { referredByContactId: { equals: contactId } },
    limit: 100,
    depth: 0,
    sort: '-observedAt',
    overrideAccess: false,
    user,
  })

  const referred = referredRes.docs.map((d) => ({
    contactId: d.contactId,
    firstName: d.firstName ?? null,
    derivedStage: d.derivedStage ?? null,
  }))

  return NextResponse.json({
    referrer,
    referred,
    referredCount: referredRes.totalDocs,
  })
}
