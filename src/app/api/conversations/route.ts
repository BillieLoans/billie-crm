/**
 * GET /api/conversations
 *
 * Returns a paginated, filterable list of conversations for the monitoring grid.
 * Supports cursor-based pagination using (updatedAt, id).
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
import { getPayload, type Where } from 'payload'
import { headers } from 'next/headers'
import configPromise from '@payload-config'
import { hasAnyRole } from '@/lib/access'
import { ConversationsQuerySchema, type ConversationsListResponse } from '@/lib/schemas/conversations'

export async function GET(request: NextRequest) {
  try {
    const payload = await getPayload({ config: configPromise })
    const headersList = await headers()

    // 1. Authenticate
    const { user } = await payload.auth({
      headers: new Headers(Array.from(headersList.entries())),
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

    // 3. Build Payload `where` clause. Each constraint is AND'd together.
    const filters: Where[] = []

    if (status) {
      filters.push({ status: { equals: status } })
    }

    if (decision) {
      if (decision === 'no_decision') {
        filters.push({
          or: [
            { decisionStatus: { exists: false } },
            { decisionStatus: { equals: 'no_decision' } },
          ],
        })
      } else {
        filters.push({ decisionStatus: { equals: decision } })
      }
    }

    if (from) {
      filters.push({ updatedAt: { greater_than_equal: from } })
    }
    if (to) {
      filters.push({ updatedAt: { less_than_equal: to } })
    }

    if (q && q.trim()) {
      const term = q.trim()

      // Search by customer name requires resolving fullName → customerId(s) first,
      // since conversations only store customerIdString. Cap the lookup to avoid
      // huge IN clauses on broad terms.
      const customerMatches = await payload.find({
        collection: 'customers',
        where: { fullName: { like: term } },
        limit: 200,
        select: { customerId: true },
        depth: 0,
      })
      const matchedCustomerIds = customerMatches.docs
        .map((c) => (c as { customerId?: string }).customerId)
        .filter((v): v is string => Boolean(v))

      const orClauses: Where[] = [
        { customerIdString: { like: term } },
        { applicationNumber: { like: term } },
      ]
      if (matchedCustomerIds.length > 0) {
        orClauses.push({ customerIdString: { in: matchedCustomerIds } })
      }
      filters.push({ or: orClauses })
    }

    // Cursor: keyset pagination over (updatedAt DESC, id DESC).
    // Walk to the next page with: (updatedAt < cursor.updatedAt)
    //                          OR (updatedAt = cursor.updatedAt AND id < cursor.id)
    let cursorTuple: { updatedAt: string; id: string } | null = null
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
        if (decoded?.updatedAt && decoded?.id) {
          cursorTuple = { updatedAt: String(decoded.updatedAt), id: String(decoded.id) }
        }
      } catch {
        // Invalid cursor — ignore and return from start
      }
    }
    if (cursorTuple) {
      filters.push({
        or: [
          { updatedAt: { less_than: cursorTuple.updatedAt } },
          {
            and: [
              { updatedAt: { equals: cursorTuple.updatedAt } },
              { id: { less_than: cursorTuple.id } },
            ],
          },
        ],
      })
    }

    const where: Where = filters.length > 0 ? { and: filters } : {}

    // 4. Execute the paginated query. Fetch one extra to detect hasMore.
    const findResult = await payload.find({
      collection: 'conversations',
      where,
      sort: '-updatedAt,-id',
      limit: limit + 1,
      depth: 0,
    })

    const hasMore = findResult.docs.length > limit
    const results = hasMore ? findResult.docs.slice(0, limit) : findResult.docs
    const total = findResult.totalDocs

    // 5. Bulk-fetch customer full names (one query for the page, not N+1).
    const customerIds = [
      ...new Set(
        results
          .map((d) => (d as { customerIdString?: string }).customerIdString)
          .filter((v): v is string => Boolean(v)),
      ),
    ]
    const customerNameMap = new Map<string, string>()
    if (customerIds.length > 0) {
      const custResult = await payload.find({
        collection: 'customers',
        where: { customerId: { in: customerIds } },
        limit: customerIds.length,
        select: { customerId: true, fullName: true },
        depth: 0,
      })
      for (const c of custResult.docs as Array<{ customerId?: string; fullName?: string | null }>) {
        if (c.customerId && c.fullName) customerNameMap.set(c.customerId, c.fullName)
      }
    }

    // 6. Build cursor from last document
    let nextCursor: string | null = null
    if (hasMore && results.length > 0) {
      const last = results[results.length - 1] as { updatedAt?: string | Date; id?: string }
      const updatedAt =
        last.updatedAt instanceof Date
          ? last.updatedAt.toISOString()
          : typeof last.updatedAt === 'string'
            ? last.updatedAt
            : null
      if (updatedAt && last.id) {
        nextCursor = Buffer.from(
          JSON.stringify({ updatedAt, id: String(last.id) }),
          'utf8',
        ).toString('base64url')
      }
    }

    // 7. Shape response
    const conversations = results.map((d) => {
      const doc = d as unknown as Record<string, unknown>
      const appDataRaw = doc.applicationData as Record<string, unknown> | undefined
      const appData = (appDataRaw?.payload as Record<string, unknown> | undefined) ?? appDataRaw
      const loanAmount =
        typeof appData?.loan_amount === 'number'
          ? appData.loan_amount
          : typeof appData?.loanAmount === 'number'
            ? appData.loanAmount
            : null

      const utterances = Array.isArray(doc.utterances) ? doc.utterances : []
      const lastUtterance = utterances[utterances.length - 1] as
        | { createdAt?: string | Date }
        | undefined

      return {
        conversationId: String(doc.conversationId ?? ''),
        customer: {
          fullName: customerNameMap.get(doc.customerIdString as string) ?? null,
          customerId: (doc.customerIdString as string) ?? null,
        },
        applicationNumber: (doc.applicationNumber as string) ?? null,
        status: (doc.status as string) ?? null,
        decisionStatus: (doc.decisionStatus as string) ?? null,
        application: {
          loanAmount: typeof loanAmount === 'number' ? loanAmount : null,
          purpose: (appData?.loan_purpose ?? appData?.loanPurpose ?? appData?.purpose) as
            | string
            | null,
        },
        messageCount: utterances.length,
        lastMessageAt:
          (doc.lastUtteranceTime instanceof Date
            ? doc.lastUtteranceTime.toISOString()
            : typeof doc.lastUtteranceTime === 'string'
              ? doc.lastUtteranceTime
              : null) ??
          (lastUtterance?.createdAt instanceof Date
            ? lastUtterance.createdAt.toISOString()
            : typeof lastUtterance?.createdAt === 'string'
              ? lastUtterance.createdAt
              : null),
        updatedAt:
          doc.updatedAt instanceof Date
            ? doc.updatedAt.toISOString()
            : (doc.updatedAt as string) ?? null,
        startedAt:
          doc.startedAt instanceof Date
            ? doc.startedAt.toISOString()
            : (doc.startedAt as string) ?? null,
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
