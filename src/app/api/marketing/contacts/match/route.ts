/**
 * API Route: GET /api/marketing/contacts/match?mobile=…&email=…
 *
 * Natural-key duplicate pre-check for the staff New-contact flow. Mirrors the
 * platform's UpsertContact resolution exactly — normalised AU mobile first,
 * then case-insensitive email, non-erased contacts only — so the UI can warn
 * "this will update an existing contact" BEFORE the upsert silently takes
 * over that identity. Read-only; gated like contact creation (canMarketing).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canMarketing } from '@/lib/access'
import { normaliseAuMobile, normaliseEmail } from '@/lib/marketing'
import type { Contact } from '@/payload-types'

function summarise(contact: Contact, matchedOn: 'mobile' | 'email') {
  return {
    contactId: contact.contactId,
    firstName: contact.firstName ?? null,
    mobileE164: contact.mobileE164 ?? null,
    email: contact.email ?? null,
    derivedStage: contact.derivedStage ?? null,
    matchedOn,
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(canMarketing)
  if ('error' in auth) return auth.error
  const { payload } = auth

  const sp = request.nextUrl.searchParams
  const mobile = normaliseAuMobile(sp.get('mobile'))
  const email = normaliseEmail(sp.get('email'))

  if (!mobile && !email) return NextResponse.json({ match: null })

  if (mobile) {
    const byMobile = await payload.find({
      collection: 'contacts',
      where: { mobileE164: { equals: mobile }, erased: { not_equals: true } } as never,
      limit: 1,
      overrideAccess: false,
      user: auth.user,
    })
    if (byMobile.docs[0]) {
      return NextResponse.json({ match: summarise(byMobile.docs[0], 'mobile') })
    }
  }

  if (email) {
    const byEmail = await payload.find({
      collection: 'contacts',
      where: { email: { equals: email }, erased: { not_equals: true } } as never,
      limit: 1,
      overrideAccess: false,
      user: auth.user,
    })
    if (byEmail.docs[0]) {
      return NextResponse.json({ match: summarise(byEmail.docs[0], 'email') })
    }
  }

  return NextResponse.json({ match: null })
}
