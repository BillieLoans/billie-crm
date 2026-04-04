/**
 * GET /api/conversations/:conversationId/assessments/serviceability
 *
 * Fetches the serviceability assessment JSON from S3 and returns it to the client.
 * S3 pre-signed URLs are never returned to the client (NFR8).
 * Rate-limited: 30 requests per minute per user (NFR9).
 *
 * Story 1.6: Credit Assessment S3 Proxy API Routes
 */

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { headers } from 'next/headers'
import configPromise from '@payload-config'
import { hasAnyRole } from '@/lib/access'
import { getObjectByUri, parseS3Uri } from '@/server/s3-client'
import { checkRateLimit, ASSESSMENT_RATE_LIMIT } from '@/lib/utils/rateLimit'

interface RouteParams {
  params: Promise<{ conversationId: string }>
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { conversationId } = await params

  try {
    const payload = await getPayload({ config: configPromise })
    const headersList = await headers()
    const cookieHeader = headersList.get('cookie') || ''

    // 1. Authenticate
    const { user } = await payload.auth({
      headers: new Headers({ cookie: cookieHeader }),
    })
    if (!user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue.' } },
        { status: 401 },
      )
    }
    if (!hasAnyRole(user)) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } },
        { status: 403 },
      )
    }

    // 2. Rate limit
    const rateLimitKey = `assessment:${String(user.id)}`
    if (!checkRateLimit(rateLimitKey, ASSESSMENT_RATE_LIMIT)) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } },
        { status: 429 },
      )
    }

    // 3. Look up conversation to get S3 key
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (payload.db as any).connection?.db
    if (!db) {
      return NextResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Database unavailable.' } },
        { status: 500 },
      )
    }

    const doc = await db
      .collection('conversations')
      .findOne({ conversationId }, { projection: { assessments: 1 } })

    if (!doc) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Conversation not found.' } },
        { status: 404 },
      )
    }

    const s3Uri = doc.assessments?.serviceability?.s3Key as string | undefined
    if (!s3Uri) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Assessment not available.' } },
        { status: 404 },
      )
    }

    // 4. Validate URI — prevent path traversal (NFR8)
    try {
      const { key } = parseS3Uri(s3Uri)
      if (key.includes('..')) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'Invalid assessment key.' } },
          { status: 403 },
        )
      }
    } catch {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Invalid assessment key.' } },
        { status: 403 },
      )
    }

    // 5. Fetch from S3 server-side via URI (never return pre-signed URL to client — NFR8)
    const object = await getObjectByUri(s3Uri)
    if (!object) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Assessment data not found in storage.' } },
        { status: 404 },
      )
    }

    const reader = (object.body as unknown as { transformToString: () => Promise<string> })
    const text = await reader.transformToString()
    const assessment = JSON.parse(text)

    return NextResponse.json({ assessment })
  } catch (error) {
    console.error('[GET /api/conversations/:id/assessments/serviceability] Error:', {
      conversationId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to load assessment.' } },
      { status: 500 },
    )
  }
}
