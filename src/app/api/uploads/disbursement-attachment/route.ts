/**
 * API Route: POST /api/uploads/disbursement-attachment
 *
 * Accepts a disbursement proof-of-payment file and uploads it to S3
 * server-side. Replaces the presigned-URL flow: the browser never talks to
 * AWS, so the CSP stays connect-src 'self' and size/content rules are
 * enforced where the client can't bypass them.
 *
 * Request:
 * - Query params: accountNumber (required), fileName (required)
 * - Content-Type header: MIME type of the file
 * - Body: the raw file bytes (max 10MB)
 *
 * Response:
 * - s3Uri: Full S3 URI (s3://bucket/key), persisted as attachmentLocation
 * - s3Key: The object key in S3
 */

import { NextRequest, NextResponse } from 'next/server'
import { uploadObject, buildS3Uri } from '@/server/s3-client'
import {
  readBodyWithLimit,
  matchesMagicBytes,
  buildDisbursementAttachmentKey,
  DISBURSEMENT_ATTACHMENT_MAX_BYTES,
} from '@/server/uploads'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'
import { DisbursementAttachmentSchema } from '@/lib/schemas/api'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error
    const { payload } = auth

    const searchParams = new URL(request.url).searchParams
    const parseResult = DisbursementAttachmentSchema.safeParse({
      accountNumber: searchParams.get('accountNumber') ?? '',
      fileName: searchParams.get('fileName') ?? '',
      contentType: request.headers.get('content-type') ?? '',
    })
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const data = parseResult.data

    // Verify the account exists, and resolve its customer ID server-side —
    // the S3 tree is keyed by customer (a customer can hold many accounts)
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
    const customerId = accountResult.docs[0].customerIdString
    if (!customerId || typeof customerId !== 'string') {
      return NextResponse.json(
        { error: 'Loan account has no customer ID to store the attachment under' },
        { status: 422 },
      )
    }

    const body = await readBodyWithLimit(request, DISBURSEMENT_ATTACHMENT_MAX_BYTES)
    if (body === 'TOO_LARGE') {
      return NextResponse.json(
        { error: 'File exceeds the 10MB limit' },
        { status: 413 },
      )
    }
    if (body.byteLength === 0) {
      return NextResponse.json(
        { error: 'File is empty' },
        { status: 400 },
      )
    }
    if (!matchesMagicBytes(body, data.contentType)) {
      return NextResponse.json(
        { error: 'File content does not match its declared type' },
        { status: 400 },
      )
    }

    const s3Key = buildDisbursementAttachmentKey(
      customerId,
      data.accountNumber,
      data.fileName,
      Date.now(),
    )
    await uploadObject(s3Key, data.contentType, body)

    return NextResponse.json({
      s3Uri: buildS3Uri(s3Key),
      s3Key,
    })
  } catch (error) {
    console.error('[Disbursement Attachment API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to upload attachment' },
      { status: 500 },
    )
  }
}
