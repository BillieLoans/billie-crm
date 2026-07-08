/**
 * API Route: GET /api/marketing/feedback/export
 *
 * CSV export of the feedback queue (same status/product_area filters as the
 * list route). Gated on `canReadMarketing`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canReadMarketing } from '@/lib/access'

const EXPORT_CAP = 10_000
const PAGE_SIZE = 500

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
  if (sp.get('status')) where.status = { equals: sp.get('status') }
  if (sp.get('product_area')) where.productArea = { equals: sp.get('product_area') }

  const lines = [
    [
      'feedback_id',
      'contact_id',
      'type',
      'severity',
      'body',
      'product_area',
      'status',
      'status_note',
      'received_at',
      'status_changed_at',
    ].join(','),
  ]
  let page = 1
  let total = 0
  for (;;) {
    const result = await payload.find({
      collection: 'feedback',
      where: where as never,
      page,
      limit: PAGE_SIZE,
      sort: '-receivedAt',
      overrideAccess: false,
      user,
    })
    for (const f of result.docs) {
      lines.push(
        [
          f.feedbackId,
          f.contactIdString,
          f.feedbackType,
          f.severity,
          f.body,
          f.productArea,
          f.status,
          f.statusNote,
          f.receivedAt,
          f.statusChangedAt,
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
      'content-disposition': `attachment; filename="feedback-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
