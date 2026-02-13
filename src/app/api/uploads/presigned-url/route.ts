/**
 * API Route: POST /api/uploads/presigned-url
 *
 * Generates a presigned S3 PUT URL for uploading disbursement attachments.
 *
 * Request body:
 * - accountNumber (required): Loan account number (used as S3 path prefix)
 * - fileName (required): Original file name
 * - contentType (required): MIME type of the file
 *
 * Response:
 * - uploadUrl: Presigned PUT URL for direct browser-to-S3 upload
 * - s3Key: The object key in S3
 * - s3Uri: Full S3 URI (s3://bucket/key)
 */

import { NextRequest, NextResponse } from 'next/server'
import { generatePresignedUploadUrl, buildS3Uri } from '@/server/s3-client'

interface PresignedUrlRequestBody {
  accountNumber: string
  fileName: string
  contentType: string
}

/** Allowed MIME types for attachments */
const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls
  'text/csv',
]

/** Max file name length */
const MAX_FILENAME_LENGTH = 255

export async function POST(request: NextRequest) {
  try {
    const body: PresignedUrlRequestBody = await request.json()

    // Validation
    if (!body.accountNumber) {
      return NextResponse.json(
        { error: 'accountNumber is required' },
        { status: 400 },
      )
    }
    if (!body.fileName) {
      return NextResponse.json(
        { error: 'fileName is required' },
        { status: 400 },
      )
    }
    if (!body.contentType) {
      return NextResponse.json(
        { error: 'contentType is required' },
        { status: 400 },
      )
    }

    if (!ALLOWED_CONTENT_TYPES.includes(body.contentType)) {
      return NextResponse.json(
        {
          error: `Unsupported file type: ${body.contentType}. Allowed types: PDF, JPEG, PNG, WebP, Excel, CSV.`,
        },
        { status: 400 },
      )
    }

    if (body.fileName.length > MAX_FILENAME_LENGTH) {
      return NextResponse.json(
        { error: `File name must be ${MAX_FILENAME_LENGTH} characters or fewer` },
        { status: 400 },
      )
    }

    // Sanitize file name: keep alphanumeric, hyphens, underscores, dots
    const sanitizedFileName = body.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')

    // Build S3 key: {account_number}/docs/{timestamp}-{fileName}
    const timestamp = Date.now()
    const s3Key = `${body.accountNumber}/docs/${timestamp}-${sanitizedFileName}`

    // Generate presigned URL (5 minute expiry)
    const uploadUrl = await generatePresignedUploadUrl(s3Key, body.contentType, 300)
    const s3Uri = buildS3Uri(s3Key)

    return NextResponse.json({
      uploadUrl,
      s3Key,
      s3Uri,
    })
  } catch (error) {
    console.error('[Presigned URL API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to generate upload URL' },
      { status: 500 },
    )
  }
}
