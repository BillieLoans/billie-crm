/**
 * GET /api/customer/:customerId/identity-report?artifact=<report|raw>&disposition=<inline|attachment>
 *
 * Streams an archived identity verification artifact from S3. The S3 URI is
 * resolved server-side from the customer's most recent conversation carrying an
 * `identityVerificationReport` (populated by the Python handler from the
 * `identity_verification.report.archived.v1` event) — S3 locations never reach
 * the browser.
 *
 * artifact=report (default): the verification report PDF.
 * artifact=raw: the raw verify-response JSON.
 * disposition=inline (default) renders in the browser; attachment downloads.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { getObjectByUri, parseS3Uri } from '@/server/s3-client'
import { checkRateLimit, ASSESSMENT_RATE_LIMIT } from '@/lib/utils/rateLimit'

const ARTIFACTS = {
  report: 'reportFileLocation',
  raw: 'rawResponseFileLocation',
} as const
type Artifact = keyof typeof ARTIFACTS

interface RouteParams {
  params: Promise<{ customerId: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { customerId } = await params
  const artifact = (request.nextUrl.searchParams.get('artifact') ?? 'report') as Artifact
  const disposition = request.nextUrl.searchParams.get('disposition') ?? 'inline'

  if (!(artifact in ARTIFACTS)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid artifact.' } },
      { status: 400 },
    )
  }
  if (disposition !== 'inline' && disposition !== 'attachment') {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid disposition.' } },
      { status: 400 },
    )
  }

  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error
    const { user, payload } = auth

    if (!checkRateLimit(`identity-report:${String(user.id)}`, ASSESSMENT_RATE_LIMIT)) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } },
        { status: 429 },
      )
    }

    // Most recent conversation for this customer that has the requested
    // artifact archived. (`identity_verification.report.archived.v1` joins on
    // application_number; conversations carry the canonical customer id after
    // identity merges.)
    const locationField = ARTIFACTS[artifact]
    const result = await payload.find({
      collection: 'conversations',
      where: {
        and: [
          { customerIdString: { equals: customerId } },
          { [`identityVerificationReport.${locationField}`]: { exists: true } },
        ],
      },
      sort: '-updatedAt',
      limit: 1,
      select: { identityVerificationReport: true },
    })

    const doc = result.docs[0]
    const ivr = doc?.identityVerificationReport as
      | Record<string, string | null | undefined>
      | null
      | undefined
    const s3Uri = ivr?.[locationField]
    if (!s3Uri) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Identity verification artifact not available.' } },
        { status: 404 },
      )
    }

    try {
      const { key } = parseS3Uri(s3Uri)
      if (key.includes('..')) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'Invalid file key.' } },
          { status: 403 },
        )
      }
    } catch {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Invalid file key.' } },
        { status: 403 },
      )
    }

    const object = await getObjectByUri(s3Uri)
    if (!object) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'File not found in storage.' } },
        { status: 404 },
      )
    }

    const fallbackName = artifact === 'report' ? 'verification_report.pdf' : 'verify_response.json'
    const filename =
      (artifact === 'report' ? ivr?.reportFileName : ivr?.rawResponseFileName) ||
      s3Uri.split('/').pop() ||
      fallbackName
    const contentType = filename.toLowerCase().endsWith('.json')
      ? 'application/json'
      : filename.toLowerCase().endsWith('.pdf')
        ? 'application/pdf'
        : object.contentType

    return new NextResponse(object.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `${disposition}; filename="${filename}"`,
        ...(object.contentLength != null
          ? { 'Content-Length': String(object.contentLength) }
          : {}),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    console.error('[GET /api/customer/:id/identity-report] Error:', {
      customerId,
      artifact,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to load identity report.' } },
      { status: 500 },
    )
  }
}
