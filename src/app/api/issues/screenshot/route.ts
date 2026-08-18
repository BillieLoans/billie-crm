/**
 * API Route: POST /api/issues/screenshot
 *
 * Accepts a problem-report screenshot and uploads it to S3 server-side.
 * Replaces the presign flow so the browser never talks to AWS directly.
 *
 * Request:
 * - Content-Type header: 'image/jpeg' | 'image/png'
 * - Body: the raw image bytes (max 5MB)
 *
 * Response:
 * - s3Uri: Full S3 URI (s3://bucket/key) to persist on the issue document
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { uploadObject, buildS3Uri } from '@/server/s3-client'
import {
  readBodyWithLimit,
  matchesMagicBytes,
  ISSUE_SCREENSHOT_MAX_BYTES,
} from '@/server/uploads'
import { requireAuth } from '@/lib/auth'
import { canReportIssue } from '@/lib/access'
import { IssueScreenshotUploadSchema } from '@/lib/schemas/api'

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(canReportIssue)
    if ('error' in auth) return auth.error

    const parseResult = IssueScreenshotUploadSchema.safeParse({
      contentType: request.headers.get('content-type') ?? '',
    })
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Screenshots must be JPEG or PNG.',
          },
        },
        { status: 400 },
      )
    }
    const { contentType } = parseResult.data

    const body = await readBodyWithLimit(request, ISSUE_SCREENSHOT_MAX_BYTES)
    if (body === 'TOO_LARGE') {
      return NextResponse.json(
        { error: { code: 'TOO_LARGE', message: 'Screenshot exceeds the 5MB limit.' } },
        { status: 413 },
      )
    }
    if (body.byteLength === 0 || !matchesMagicBytes(body, contentType)) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Image content does not match its declared type.',
          },
        },
        { status: 400 },
      )
    }

    // Key: issues/{yyyy-mm}/{uuid}.{jpg|png} — month prefix keeps the bucket
    // listing manageable and makes lifecycle rules easy to target.
    const now = new Date()
    const yyyy = now.getUTCFullYear()
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
    const s3Key = `issues/${yyyy}-${mm}/${randomUUID()}.${EXTENSIONS[contentType]}`

    await uploadObject(s3Key, contentType, body)

    return NextResponse.json({ s3Uri: buildS3Uri(s3Key) })
  } catch (error) {
    console.error('[POST /api/issues/screenshot] Error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to upload screenshot.' } },
      { status: 500 },
    )
  }
}
