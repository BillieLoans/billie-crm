/**
 * API Route: GET /api/marketing/feedback
 *
 * Lists the feedback queue from the read-only `feedback` projection, filterable
 * by `status` and `product_area`. Gated on `canReadMarketing`.
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

  const result = await payload.find({
    collection: 'feedback',
    where: where as never,
    page: Number(sp.get('page') ?? 1),
    limit: 50,
    sort: '-receivedAt',
    overrideAccess: false,
    user,
  })

  return NextResponse.json(result)
}
