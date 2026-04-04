/**
 * GET /api/conversations/:conversationId
 *
 * Returns full conversation detail including utterances, assessments,
 * statement capture, noticeboard, customer, and application data.
 *
 * Story 1.5: Conversation Detail API Route
 */

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { headers } from 'next/headers'
import configPromise from '@payload-config'
import { hasAnyRole } from '@/lib/access'

/** Safely convert a MongoDB Date or ISO string to ISO string, or null. */
function toIso(val: unknown): string | null {
  if (val instanceof Date) return val.toISOString()
  if (typeof val === 'string' && val) return val
  return null
}

interface RouteParams {
  params: Promise<{ conversationId: string }>
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { conversationId } = await params

  try {
    const payload = await getPayload({ config: configPromise })
    const headersList = await headers()
    const cookieHeader = headersList.get('cookie') || ''

    // 1. Authenticate
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

    // 2. Fetch conversation directly from MongoDB (event processor writes raw docs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (payload.db as any).connection?.db
    if (!db) {
      return NextResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Database unavailable.' } },
        { status: 500 },
      )
    }

    const doc = await db
      .collection('conversations')
      .findOne({ conversationId })

    if (!doc) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Conversation not found.' } },
        { status: 404 },
      )
    }

    // 3. Optionally enrich with customer full name from customers collection
    let customerFullName: string | null = null
    let customerPayloadId: string | null = null
    if (doc.customerIdString) {
      const customerDoc = await db
        .collection('customers')
        .findOne({ customerId: doc.customerIdString }, { projection: { fullName: 1, _id: 1 } })
      if (customerDoc) {
        customerFullName = customerDoc.fullName ?? null
        customerPayloadId = customerDoc._id ? String(customerDoc._id) : null
      }
    }

    // 4. Shape response — no PII in logs (NFR11)
    const utterances = Array.isArray(doc.utterances) ? doc.utterances : []
    // applicationData may be flat {loanAmount, ...} (new format) or nested {payload: {loanAmount, ...}} (old format)
    const appDataRaw = doc.applicationData as Record<string, unknown> | undefined
    const appData = (appDataRaw?.payload as Record<string, unknown> | undefined) ?? appDataRaw

    const conversation = {
      conversationId: String(doc.conversationId ?? ''),
      applicationNumber: (doc.applicationNumber as string) ?? null,
      status: (doc.status as string) ?? null,
      decisionStatus: (doc.decisionStatus as string) ?? null,
      finalDecision: (doc.finalDecision as string) ?? null,
      startedAt: toIso(doc.startedAt),
      updatedAt: toIso(doc.updatedAt),
      lastMessageAt: toIso(doc.lastUtteranceTime),
      customer: {
        fullName: customerFullName,
        customerId: (doc.customerIdString as string) ?? null,
        payloadId: customerPayloadId,
      },
      application: {
        loanAmount:
          typeof appData?.loan_amount === 'number'
            ? appData.loan_amount
            : typeof appData?.loanAmount === 'number'
              ? appData.loanAmount
              : null,
        purpose: (appData?.loan_purpose ?? appData?.loanPurpose ?? appData?.purpose) as string | null,
        term:
          typeof appData?.loan_term === 'number'
            ? appData.loan_term
            : typeof appData?.loanTerm === 'number'
              ? appData.loanTerm
              : null,
      },
      utterances: utterances.map((u: Record<string, unknown>) => ({
        username: (u.username as string) ?? null,
        utterance: (u.utterance as string) ?? '',
        rationale: (u.rationale as string) ?? null,
        createdAt:
          u.createdAt instanceof Date
            ? u.createdAt.toISOString()
            : (u.createdAt as string) ?? null,
        answerInputType: (u.answerInputType as string) ?? null,
        endConversation: Boolean(u.endConversation),
        additionalData: u.additionalData ?? null,
      })),
      assessments: (doc.assessments as Record<string, unknown>) ?? {},
      statementCapture: doc.statementCapture ?? null,
      noticeboard: Array.isArray(doc.noticeboard)
        ? doc.noticeboard.map((n: Record<string, unknown>) => ({
            agentName: (n.agentName as string) ?? null,
            topic: (n.topic as string) ?? null,
            content: (n.content as string) ?? null,
            timestamp:
              n.timestamp instanceof Date
                ? n.timestamp.toISOString()
                : (n.timestamp as string) ?? null,
          }))
        : [],
      summary: {
        purpose: (doc.purpose as string) ?? null,
        facts: Array.isArray(doc.facts) ? doc.facts : [],
      },
      messageCount: utterances.length,
    }

    return NextResponse.json({ conversation })
  } catch (error) {
    // Log error without PII (NFR11)
    console.error('[GET /api/conversations/:id] Error fetching conversation:', {
      conversationId,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to load conversation.' } },
      { status: 500 },
    )
  }
}
