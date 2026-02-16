/**
 * API Route: GET /api/loan-agreement?accountId=xxx
 *
 * Fetches the signed loan agreement from S3 for the given loan account
 * and streams it to the client (PDF or HTML). Opens in a new window.
 * Server retrieves the file from the S3 bucket referenced by the account's
 * signedLoanAgreementUrl.
 */

import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import configPromise from '@payload-config'
import { getPayload } from 'payload'
import { getObjectByUri } from '@/server/s3-client'

export async function GET(request: NextRequest) {
  try {
    const accountId = request.nextUrl.searchParams.get('accountId')
    if (!accountId?.trim()) {
      return NextResponse.json(
        { error: 'accountId query parameter is required' },
        { status: 400 }
      )
    }

    const payload = await getPayload({ config: configPromise })
    const headersList = await headers()
    const cookieHeader = headersList.get('cookie') ?? ''

    const { user } = await payload.auth({
      headers: new Headers({ cookie: cookieHeader }),
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const result = await payload.find({
      collection: 'loan-accounts',
      where: { loanAccountId: { equals: accountId.trim() } },
      limit: 1,
    })

    const account = result.docs[0]
    const s3Uri = account?.signedLoanAgreementUrl

    if (!s3Uri || typeof s3Uri !== 'string') {
      return NextResponse.json(
        { error: 'Loan agreement not found for this account' },
        { status: 404 }
      )
    }

    const object = await getObjectByUri(s3Uri)
    if (!object) {
      return NextResponse.json(
        { error: 'Could not retrieve loan agreement from storage' },
        { status: 502 }
      )
    }

    const responseHeaders: Record<string, string> = {
      'Content-Type': object.contentType,
      'Content-Disposition': 'inline',
    }
    if (object.contentLength != null) {
      responseHeaders['Content-Length'] = String(object.contentLength)
    }

    return new NextResponse(object.body as BodyInit, {
      status: 200,
      headers: responseHeaders,
    })
  } catch (err) {
    console.error('[loan-agreement] Error:', err)
    return NextResponse.json(
      { error: 'Failed to load loan agreement' },
      { status: 500 }
    )
  }
}
