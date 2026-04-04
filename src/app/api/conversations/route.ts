/**
 * GET /api/conversations
 *
 * Returns a paginated, filterable list of conversations for the monitoring grid.
 * Supports cursor-based pagination using updatedAt + _id.
 *
 * Query params:
 *   status    - conversation status filter (active, paused, etc.)
 *   decision  - decision status filter (approved, declined, no_decision)
 *   from      - ISO date string — updatedAt >= from
 *   to        - ISO date string — updatedAt <= to
 *   q         - text search on customerIdString / applicationNumber
 *   limit     - page size (1-100, default 20)
 *   cursor    - opaque cursor from previous response
 *
 * Story 1.4: Conversations List & Search API Route
 */

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { headers } from 'next/headers'
import configPromise from '@payload-config'
import { hasAnyRole } from '@/lib/access'
import { ensureConversationIndexes } from '@/lib/db/ensureConversationIndexes'
import { ConversationsQuerySchema, type ConversationsListResponse } from '@/lib/schemas/conversations'

export async function GET(request: NextRequest) {
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

    // 2. Parse query params
    const rawParams = Object.fromEntries(request.nextUrl.searchParams)
    const parseResult = ConversationsQuerySchema.safeParse(rawParams)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters.' } },
        { status: 400 },
      )
    }
    const { status, decision, from, to, q, limit, cursor } = parseResult.data

    // 3. Ensure indexes exist (idempotent, no-op after first call)
    await ensureConversationIndexes()

    // 4. Build MongoDB query directly for complex filtering
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (payload.db as any).connection?.db
    if (!db) {
      return NextResponse.json(
        { error: { code: 'INTERNAL_ERROR', message: 'Database unavailable.' } },
        { status: 500 },
      )
    }
    const collection = db.collection('conversations')

    // Build filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: Record<string, any> = {}

    if (status) {
      filter.status = status
    }

    if (decision) {
      if (decision === 'no_decision') {
        filter.decisionStatus = { $in: [null, 'no_decision', undefined] }
      } else {
        filter.decisionStatus = decision
      }
    }

    if (from || to) {
      filter.updatedAt = {}
      if (from) filter.updatedAt.$gte = new Date(from)
      if (to) filter.updatedAt.$lte = new Date(to)
    }

    if (q && q.trim()) {
      const escaped = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(escaped, 'i')
      filter.$or = [
        { customerIdString: regex },
        { applicationNumber: regex },
        { 'customer.fullName': regex },
      ]
    }

    // Cursor-based pagination: cursor encodes { updatedAt, _id }
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
        filter.$or = filter.$or
          ? [
              { $and: [filter.$or ? { $or: filter.$or } : {}, { updatedAt: { $lt: new Date(decoded.updatedAt) } }] },
              { $and: [filter.$or ? { $or: filter.$or } : {}, { updatedAt: { $eq: new Date(decoded.updatedAt) }, _id: { $lt: decoded._id } }] },
            ]
          : [
              { updatedAt: { $lt: new Date(decoded.updatedAt) } },
              { updatedAt: { $eq: new Date(decoded.updatedAt) }, _id: { $lt: decoded._id } },
            ]
      } catch {
        // Invalid cursor — ignore and return from start
      }
    }

    // 5. Execute queries in parallel: data + total count
    const [docs, total] = await Promise.all([
      collection
        .find(filter)
        .sort({ updatedAt: -1, _id: -1 })
        .limit(limit + 1) // fetch one extra to detect hasMore
        .toArray(),
      collection.countDocuments(filter),
    ])

    const hasMore = docs.length > limit
    const results = hasMore ? docs.slice(0, limit) : docs

    // 5b. Bulk-fetch customer full names (one query for the page, not N+1)
    const customerIds = [...new Set(results.map((d: Record<string, unknown>) => d.customerIdString as string | undefined).filter(Boolean))] as string[]
    const customerNameMap = new Map<string, string>()
    if (customerIds.length > 0) {
      const customerDocs = await db
        .collection('customers')
        .find({ customerId: { $in: customerIds } }, { projection: { customerId: 1, fullName: 1 } })
        .toArray()
      for (const c of customerDocs) {
        if (c.customerId && c.fullName) customerNameMap.set(c.customerId as string, c.fullName as string)
      }
    }

    // 6. Build cursor from last document
    let nextCursor: string | null = null
    if (hasMore && results.length > 0) {
      const last = results[results.length - 1]
      nextCursor = Buffer.from(
        JSON.stringify({
          updatedAt: last.updatedAt instanceof Date ? last.updatedAt.toISOString() : (last.updatedAt as string) ?? null,
          _id: String(last._id),
        }),
        'utf8',
      ).toString('base64url')
    }

    // 7. Shape response
    const conversations = results.map((doc: Record<string, unknown>) => {
      const appDataRaw = doc.applicationData as Record<string, unknown> | undefined
      const appData = (appDataRaw?.payload as Record<string, unknown> | undefined) ?? appDataRaw
      const loanAmount =
        typeof appData?.loan_amount === 'number'
          ? appData.loan_amount
          : typeof appData?.loanAmount === 'number'
            ? appData.loanAmount
            : null

      const utterances = Array.isArray(doc.utterances) ? doc.utterances : []
      const lastUtterance = utterances[utterances.length - 1]

      return {
        conversationId: String(doc.conversationId ?? ''),
        customer: {
          fullName: customerNameMap.get(doc.customerIdString as string) ?? (doc.customerFullName as string) ?? null,
          customerId: (doc.customerIdString as string) ?? null,
        },
        applicationNumber: (doc.applicationNumber as string) ?? null,
        status: (doc.status as string) ?? null,
        decisionStatus: (doc.decisionStatus as string) ?? null,
        application: {
          loanAmount: typeof loanAmount === 'number' ? loanAmount : null,
          purpose: (appData?.loan_purpose ?? appData?.loanPurpose ?? appData?.purpose) as string | null,
        },
        messageCount: utterances.length,
        lastMessageAt:
          (doc.lastUtteranceTime instanceof Date
            ? doc.lastUtteranceTime.toISOString()
            : typeof doc.lastUtteranceTime === 'string'
              ? doc.lastUtteranceTime
              : null) ??
          (lastUtterance?.createdAt instanceof Date
            ? (lastUtterance.createdAt as Date).toISOString()
            : typeof lastUtterance?.createdAt === 'string'
              ? (lastUtterance.createdAt as string)
              : null),
        updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : (doc.updatedAt as string) ?? null,
        startedAt: doc.startedAt instanceof Date ? doc.startedAt.toISOString() : (doc.startedAt as string) ?? null,
      }
    })

    const response: ConversationsListResponse = {
      conversations,
      cursor: nextCursor,
      hasMore,
      total,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[GET /api/conversations] Error:', error)
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to load conversations.' } },
      { status: 500 },
    )
  }
}
