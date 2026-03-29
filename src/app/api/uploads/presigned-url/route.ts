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
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'
import { PresignedUrlSchema } from '@/lib/schemas/api'

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
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error
    const { payload } = auth

    const body = await request.json()
    const parseResult = PresignedUrlSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const data = parseResult.data

    // Verify the account exists
    const accountResult = await payload.find({
      collection: 'loan-accounts',
      where: { accountNumber: { equals: data.accountNumber } },
      limit: 1,
    })
    if (accountResult.docs.length === 0) {
      return NextResponse.json(
        { error: 'Loan account not found' },
        { status: 404 },
      )
    }

    // Sanitize file name: keep alphanumeric, hyphens, underscores, dots
    const sanitizedFileName = data.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')

    // Sanitize account number to prevent S3 path traversal
    const sanitizedAccountNumber = data.accountNumber.replace(/[^a-zA-Z0-9._-]/g, '_')

    // Build S3 key: {account_number}/docs/{timestamp}-{fileName}
    const timestamp = Date.now()
    const s3Key = `${sanitizedAccountNumber}/docs/${timestamp}-${sanitizedFileName}`

    // Generate presigned URL (5 minute expiry)
    const uploadUrl = await generatePresignedUploadUrl(s3Key, data.contentType, 300)
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
