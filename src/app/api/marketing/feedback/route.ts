/**
 * API Route: GET /api/marketing/feedback
 *
 * Lists the feedback queue from the read-only `feedback` projection, filterable
 * by `status` and `product_area`. Gated on `canReadMarketing`.
 *
 * The projection stores only `contactIdString`; the queue UI wants a human
 * name, so each page is enriched with `contactName` via one batched contacts
 * lookup (no N+1). A missing contact leaves `contactName: null` — the UI
 * falls back to a shortened id.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canReadMarketing } from '@/lib/access'

export async function GET(request: NextRequest) {
  const auth = await requireAuth(canReadMarketing)
  if ('error' in auth) return auth.error
  const { payload, user } = auth

  const sp = request.nextUrl.searchParams
  const where: Record<string, unknown> = {}
  if (sp.get('status')) where.status = { equals: sp.get('status') }
  if (sp.get('product_area')) where.productArea = { equals: sp.get('product_area') }
  if (sp.get('contact_id')) where.contactIdString = { equals: sp.get('contact_id') }

  const result = await payload.find({
    collection: 'feedback',
    where: where as never,
    page: Number(sp.get('page') ?? 1),
    limit: 50,
    sort: '-receivedAt',
    overrideAccess: false,
    user,
  })

  const contactIds = Array.from(
    new Set(result.docs.map((d) => d.contactIdString).filter((v): v is string => !!v)),
  )
  const nameByContactId = new Map<string, string | null>()
  if (contactIds.length > 0) {
    const contacts = await payload.find({
      collection: 'contacts',
      where: { contactId: { in: contactIds } } as never,
      limit: contactIds.length,
      overrideAccess: false,
      user,
    })
    for (const c of contacts.docs) {
      if (c.contactId) nameByContactId.set(c.contactId, c.firstName ?? null)
    }
  }

  return NextResponse.json({
    ...result,
    docs: result.docs.map((d) => ({
      ...d,
      contactName: d.contactIdString ? (nameByContactId.get(d.contactIdString) ?? null) : null,
    })),
  })
}
