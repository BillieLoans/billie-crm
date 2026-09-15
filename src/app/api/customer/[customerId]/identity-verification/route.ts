/**
 * GET /api/customer/:customerId/identity-verification
 *
 * The latest identity risk assessment for a customer, in the same shape the
 * application view renders (`IdentityVerificationDetail`): the verbatim
 * `identityRisk_assessment` payload (incl. the LAB `lab_verification` block)
 * plus archived-artifact availability. Resolved from the customer's most
 * recent conversation that carries an identity assessment — the verbatim block
 * lives on the conversation, the customer row only holds the summary mirror.
 *
 * 404 when the customer has no assessed conversation.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { checkRateLimit, ASSESSMENT_RATE_LIMIT } from '@/lib/utils/rateLimit'

interface RouteParams {
  params: Promise<{ customerId: string }>
}

const toIso = (value: unknown): string | null => {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' ? value : null
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { customerId } = await params

  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error
    const { user, payload } = auth

    if (!checkRateLimit(`identity-verification:${String(user.id)}`, ASSESSMENT_RATE_LIMIT)) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } },
        { status: 429 },
      )
    }

    const result = await payload.find({
      collection: 'conversations',
      where: {
        and: [
          { customerIdString: { equals: customerId } },
          { 'assessments.identityRisk': { exists: true } },
        ],
      },
      sort: '-updatedAt',
      limit: 1,
      select: {
        conversationId: true,
        applicationNumber: true,
        updatedAt: true,
        assessments: true,
        identityVerificationReport: true,
      },
    })

    const doc = result.docs[0]
    const assessments = doc?.assessments as Record<string, unknown> | null | undefined
    const identity = assessments?.identityRisk
    if (!doc || !identity || typeof identity !== 'object') {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'No identity verification for this customer.' } },
        { status: 404 },
      )
    }

    const ivr = doc.identityVerificationReport as Record<string, unknown> | null | undefined
    return NextResponse.json({
      conversationId: String(doc.conversationId ?? ''),
      applicationNumber: (doc.applicationNumber as string) ?? null,
      assessedAt: toIso(doc.updatedAt),
      identity,
      // Same shape as the conversation-detail API's identityVerificationReport.
      report: {
        labRequestId: (ivr?.labRequestId as string) ?? null,
        providerReference: (ivr?.providerReference as string) ?? null,
        reportAvailable: Boolean(ivr?.reportFileLocation),
        reportFileName: (ivr?.reportFileName as string) ?? null,
        rawResponseAvailable: Boolean(ivr?.rawResponseFileLocation),
        rawResponseFileName: (ivr?.rawResponseFileName as string) ?? null,
        verificationNumber: (ivr?.verificationNumber as string) ?? null,
        screeningReportAvailable: Boolean(ivr?.screeningReportFileLocation),
        screeningReportFileName: (ivr?.screeningReportFileName as string) ?? null,
        archivedAt: toIso(ivr?.archivedAt),
      },
    })
  } catch (error) {
    console.error('[identity-verification] Error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to load identity verification.' } },
      { status: 500 },
    )
  }
}
