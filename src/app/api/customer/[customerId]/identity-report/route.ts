/**
 * GET /api/customer/:customerId/identity-report?artifact=<report|screening|raw>&disposition=<inline|attachment>[&attempt=<key>]
 *
 * Streams an archived identity verification artifact from S3. The S3 URI is
 * resolved server-side — S3 locations never reach the browser.
 *
 * Without `attempt`: from the customer's most recent conversation carrying an
 * `identityVerificationReport` (populated by the Python handler from the
 * `identity_verification.report.archived.v1` event) — the LATEST verification.
 *
 * With `attempt=<key>` (billieChat spec 2026-09-15): from the matching entry of
 * `identityVerificationAttempts` on the customer's most recent conversation
 * holding that key — one specific LAB call (e.g. the failed first attempt
 * behind a step-up). Per-attempt artifacts are `report` and `raw` only.
 *
 * artifact=report (default): the identity-check verification report PDF.
 * artifact=screening: the screening-check report PDF (LAB API v1, per-check reports).
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
  // LAB API v1: the screening check has its own PDF.
  screening: 'screeningReportFileLocation',
  raw: 'rawResponseFileLocation',
} as const
type Artifact = keyof typeof ARTIFACTS

/** Stored file-name field and fallback name per artifact (drives Content-Type). */
const FILE_NAMES: Record<Artifact, readonly [string, string]> = {
  report: ['reportFileName', 'verification_report.pdf'],
  screening: ['screeningReportFileName', 'verification_report_screening.pdf'],
  raw: ['rawResponseFileName', 'verify_response.json'],
}

/** Per-attempt entries are written by the event-processor in snake_case. */
const ATTEMPT_ARTIFACTS: Partial<Record<Artifact, readonly [string, string]>> = {
  report: ['report_file_location', 'report_file_name'],
  raw: ['raw_response_file_location', 'raw_response_file_name'],
}

const ATTEMPT_KEY = /^[A-Za-z0-9_-]{1,64}$/
/** How many recent conversations to scan for an attempt key. */
const ATTEMPT_SCAN_LIMIT = 20

interface RouteParams {
  params: Promise<{ customerId: string }>
}

type Resolved = { s3Uri: string; filename: string } | null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { customerId } = await params
  const artifact = (request.nextUrl.searchParams.get('artifact') ?? 'report') as Artifact
  const disposition = request.nextUrl.searchParams.get('disposition') ?? 'inline'
  const attemptKey = request.nextUrl.searchParams.get('attempt')

  if (!Object.hasOwn(ARTIFACTS, artifact)) {
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
  const attemptArtifact = ATTEMPT_ARTIFACTS[artifact]
  if (attemptKey !== null && (!ATTEMPT_KEY.test(attemptKey) || !attemptArtifact)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid attempt.' } },
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

    let resolved: Resolved = null
    if (attemptKey !== null && attemptArtifact) {
      // Per-attempt: scan the customer's recent conversations for the key.
      // (`identity_verification.attempt.v1` joins on the conversation;
      // conversations carry the canonical customer id after identity merges.)
      const [locationKey, nameKey] = attemptArtifact
      const result = await payload.find({
        collection: 'conversations',
        where: { and: [{ customerIdString: { equals: customerId } }] },
        sort: '-updatedAt',
        limit: ATTEMPT_SCAN_LIMIT,
        select: { identityVerificationAttempts: true },
      })
      for (const doc of result.docs) {
        const attempts = (doc as Record<string, unknown>).identityVerificationAttempts
        const entry = isRecord(attempts) ? attempts[attemptKey] : undefined
        const s3Uri = isRecord(entry) ? entry[locationKey] : undefined
        if (typeof s3Uri === 'string' && s3Uri) {
          const name = isRecord(entry) ? entry[nameKey] : undefined
          resolved = {
            s3Uri,
            filename:
              (typeof name === 'string' && name) ||
              s3Uri.split('/').pop() ||
              FILE_NAMES[artifact][1],
          }
          break
        }
      }
    } else {
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
      if (s3Uri) {
        const [nameField, fallbackName] = FILE_NAMES[artifact]
        resolved = {
          s3Uri,
          filename: ivr?.[nameField] || s3Uri.split('/').pop() || fallbackName,
        }
      }
    }

    if (!resolved) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Identity verification artifact not available.' } },
        { status: 404 },
      )
    }
    const { s3Uri, filename } = resolved

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
