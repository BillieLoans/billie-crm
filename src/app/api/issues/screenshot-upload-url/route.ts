/**
 * API Route: POST /api/issues/screenshot-upload-url
 *
 * Generates a presigned S3 PUT URL for a problem-report screenshot so the
 * browser can upload directly to S3 without the image passing through the app.
 *
 * Request body:
 * - contentType (required): 'image/jpeg' | 'image/png'
 *
 * Response:
 * - uploadUrl: Presigned PUT URL for direct browser-to-S3 upload
 * - s3Uri: Full S3 URI (s3://bucket/key) to persist on the issue document
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { generatePresignedUploadUrl, buildS3Uri } from '@/server/s3-client'
import { requireAuth } from '@/lib/auth'
import { canReportIssue } from '@/lib/access'
import { IssueScreenshotPresignSchema } from '@/lib/schemas/api'

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(canReportIssue)
    if ('error' in auth) return auth.error

    const body = await request.json()
    const parseResult = IssueScreenshotPresignSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Validation failed',
            details: parseResult.error.flatten().fieldErrors,
          },
        },
        { status: 400 },
      )
    }
    const { contentType } = parseResult.data

    // Build S3 key: issues/{yyyy-mm}/{uuid}.{jpg|png} — month prefix keeps the
    // bucket listing manageable and makes lifecycle rules easy to target.
    const now = new Date()
    const yyyy = now.getUTCFullYear()
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
    const s3Key = `issues/${yyyy}-${mm}/${randomUUID()}.${EXTENSIONS[contentType]}`

    // Generate presigned URL (5 minute expiry)
    const uploadUrl = await generatePresignedUploadUrl(s3Key, contentType, 300)
    const s3Uri = buildS3Uri(s3Key)

    return NextResponse.json({
      uploadUrl,
      s3Uri,
    })
  } catch (error) {
    console.error('[POST /api/issues/screenshot-upload-url] Error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to generate upload URL.' } },
      { status: 500 },
    )
  }
}
