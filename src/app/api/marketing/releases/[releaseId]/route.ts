/** GET /api/marketing/releases/[releaseId] — release detail + grant rows. */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { canReadMarketing } from '@/lib/access'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ releaseId: string }> },
) {
  const auth = await requireAuth(canReadMarketing)
  if ('error' in auth) return auth.error
  const { payload, user } = auth
  const { releaseId } = await params

  const releases = await payload.find({
    collection: 'release-batches',
    where: { releaseId: { equals: releaseId } } as never,
    limit: 1,
    overrideAccess: false,
    user,
  })
  const release = releases.docs[0] ?? null
  const grants = await payload.find({
    collection: 'release-grants',
    where: { releaseId: { equals: releaseId } } as never,
    page: Number(request.nextUrl.searchParams.get('page') ?? 1),
    limit: 100,
    sort: 'mobileE164',
    overrideAccess: false,
    user,
  })
  return NextResponse.json({ release, grants })
}
