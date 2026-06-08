/**
 * GET /api/conversations/:conversationId/assessments/post-identity-risk
 *
 * Fetches the post-identity risk check JSON from S3 and returns it to the client.
 * The event payload carries the S3 URI under `file_location` (or `s3Key` when
 * normalised by the handler) — accept either.
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

    const rateLimitKey = `assessment:${String(user.id)}`
    if (!checkRateLimit(rateLimitKey, ASSESSMENT_RATE_LIMIT)) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } },
        { status: 429 },
      )
    }

    const result = await payload.find({
      collection: 'conversations',
      where: { conversationId: { equals: conversationId } },
      limit: 1,
      select: { assessments: true },
    })

    const doc = result.docs[0]
    if (!doc) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Conversation not found.' } },
        { status: 404 },
      )
    }

    const assessments = doc.assessments as
      | { postIdentityRisk?: { s3Key?: string; file_location?: string } | null }
      | null
      | undefined
    const pir = assessments?.postIdentityRisk ?? null
    const s3Uri = pir?.s3Key ?? pir?.file_location
    if (!s3Uri) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Assessment not available.' } },
        { status: 404 },
      )
    }

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

    const object = await getObjectByUri(s3Uri)
    if (!object) {
      console.error('[GET /api/conversations/:id/assessments/post-identity-risk] S3 object not found', {
        conversationId,
        s3Uri,
      })
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Assessment data not found in storage.' } },
        { status: 404 },
      )
    }

    const reader = object.body as unknown as { transformToString: () => Promise<string> }
    const text = await reader.transformToString()
    const assessment = JSON.parse(text)

    return NextResponse.json({ assessment })
  } catch (error) {
    console.error('[GET /api/conversations/:id/assessments/post-identity-risk] Error:', {
      conversationId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to load assessment.' } },
      { status: 500 },
    )
  }
}
