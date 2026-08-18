/**
 * API Route: GET /api/issues/[id]/screenshot
 *
 * Streams the screenshot attached to a problem report from S3. Admin only —
 * the S3 URI is resolved server-side from the issue document so storage
 * locations never reach the browser.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { isAdmin } from '@/lib/access'
import { getObjectByUri, parseS3Uri } from '@/server/s3-client'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params

  try {
    const auth = await requireAuth(isAdmin)
    if ('error' in auth) return auth.error
    const { user, payload } = auth

    const issue = await payload.findByID({
      collection: 'issues',
      id,
      overrideAccess: false,
      user,
      depth: 0,
      disableErrors: true,
    })

    const s3Uri = issue?.screenshotUri
    if (!s3Uri || typeof s3Uri !== 'string') {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Screenshot not available.' } },
        { status: 404 },
      )
    }

    try {
      const { key } = parseS3Uri(s3Uri)
      if (!key.startsWith('issues/')) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Screenshot not available.' } },
          { status: 404 },
        )
      }
    } catch {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Screenshot not available.' } },
        { status: 404 },
      )
    }

    const object = await getObjectByUri(s3Uri)
    if (!object) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Screenshot not found in storage.' } },
        { status: 404 },
      )
    }

    return new NextResponse(object.body, {
      status: 200,
      headers: {
        'Content-Type': object.contentType,
        'Content-Disposition': 'inline',
        ...(object.contentLength != null ? { 'Content-Length': String(object.contentLength) } : {}),
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (error) {
    console.error('[GET /api/issues/:id/screenshot] Error:', {
      id,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to load screenshot.' } },
      { status: 500 },
    )
  }
}
