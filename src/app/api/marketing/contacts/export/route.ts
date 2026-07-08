/**
 * API Route: GET /api/marketing/contacts/export
 *
 * One-click CSV export of the contact grid, honouring the same filters as the
 * list route. Streams up to EXPORT_CAP rows (paged reads) — a deliberate,
 * visible cap rather than a silent truncation: the row count and cap are
 * included as a trailing comment row when the cap is hit. Gated on
 * `canReadMarketing` like every marketing read.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canReadMarketing } from '@/lib/access'
import { getMarketingConsentGranted } from '@/lib/marketing'

const EXPORT_CAP = 10_000
const PAGE_SIZE = 500

const HEADER = [
  'contact_id',
  'first_name',
  'email',
  'mobile',
  'stage',
  'loan_status',
  'source',
  'city',
  'postcode',
  'batch_id',
  'needs_review',
  'consent_marketing',
  'customer_id',
  'created_at',
]

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(canReadMarketing)
  if ('error' in auth) return auth.error
  const { payload, user } = auth

  const sp = request.nextUrl.searchParams
  const where: Record<string, unknown> = {}
  if (sp.get('stage')) where.derivedStage = { equals: sp.get('stage') }
  if (sp.get('source')) where.source = { equals: sp.get('source') }
  if (sp.get('city')) where.city = { like: sp.get('city') }
  if (sp.get('batch')) where.batchId = { equals: sp.get('batch') }
  if (sp.get('needs_review') === 'true') where.needsReview = { equals: true }
  if (sp.get('loan_status')) where.loanStatus = { equals: sp.get('loan_status') }
  const q = sp.get('q')?.trim()
  if (q) {
    where.or = [{ firstName: { like: q } }, { email: { like: q } }, { mobileE164: { like: q } }]
  }

  const lines = [HEADER.join(',')]
  let page = 1
  let total = 0
  for (;;) {
    const result = await payload.find({
      collection: 'contacts',
      where: where as never,
      page,
      limit: PAGE_SIZE,
      sort: '-updatedAt',
      overrideAccess: false,
      user,
    })
    for (const c of result.docs) {
      lines.push(
        [
          c.contactId,
          c.firstName,
          c.email,
          c.mobileE164,
          c.derivedStage,
          c.loanStatus,
          c.source,
          c.city,
          c.postcode,
          c.batchId,
          c.needsReview ? 'true' : '',
          getMarketingConsentGranted(c.consent) === true ? 'granted' : '',
          c.customerId,
          c.createdAt,
        ]
          .map(csvCell)
          .join(','),
      )
    }
    total += result.docs.length
    if (!result.hasNextPage || total >= EXPORT_CAP) {
      if (result.hasNextPage) {
        lines.push(`# truncated at ${EXPORT_CAP} rows — narrow the filters for a full export`)
      }
      break
    }
    page += 1
  }

  return new NextResponse(lines.join('\n') + '\n', {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
