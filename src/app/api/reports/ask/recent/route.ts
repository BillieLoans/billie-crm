/**
 * GET /api/reports/ask/recent — the signed-in user's recent questions that
 * produced a draft, newest first. With `?id=…`, that one question and its
 * definition, to reopen it (the panel re-checks it; no Claude call).
 * Only ever the user's own.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { errorResponse } from '@/server/reporting/route-auth'

const RECENT = 15

export async function GET(request: NextRequest) {
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  const id = request.nextUrl.searchParams.get('id')
  const mine = { user: { equals: auth.user.id } }
  if (id) {
    const found = await auth.payload.find({
      collection: 'report-asks',
      where: { and: [mine, { id: { equals: id } }] },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const ask = found.docs[0]
    if (!ask?.definition)
      return errorResponse(404, 'NOT_FOUND', 'That question is not yours or has no draft.')
    return NextResponse.json({ id: ask.id, question: ask.question, definition: ask.definition })
  }
  const found = await auth.payload.find({
    collection: 'report-asks',
    where: {
      and: [mine, { kind: { in: ['ask', 'refine'] } }, { outcome: { in: ['ok', 'invalid'] } }],
    },
    sort: '-createdAt',
    limit: RECENT,
    depth: 0,
    overrideAccess: true,
  })
  return NextResponse.json({
    recent: found.docs.map((d) => ({
      id: d.id,
      question: d.question,
      title: (d.definition as { title?: string } | null)?.title ?? null,
      createdAt: d.createdAt,
    })),
  })
}
