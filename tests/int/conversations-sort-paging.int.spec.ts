/**
 * Integration tests for Applications list sorting — keyset paging against the
 * real Postgres container.
 *
 * Replicates the GET /api/conversations composition for a non-default sort:
 * payloadSort(sort) + cursorWhere(sort, cursor) + encode/decode of the
 * (sort value, id) cursor. Walks every page with a tiny page size and checks
 * the walk is complete, duplicate-free and in order — including across the
 * null band of a nullable column (decisionStatus) and over an enum column
 * (status), where Postgres compares by declaration order, not alphabetically.
 */

import { describe, test, expect, beforeAll } from 'vitest'
import configPromise from '@payload-config'
import { getPayload, Payload, type Where } from 'payload'
import {
  cursorWhere,
  decodeCursor,
  encodeCursor,
  payloadSort,
  sortValueOf,
  type ConversationSort,
} from '@/lib/conversation-sort'

const PREFIX = 'CONV-SORTPG-'

const SEED: Array<{
  suffix: string
  status: string
  decisionStatus: string | null
  startedAt: string
}> = [
  {
    suffix: 'A',
    status: 'declined',
    decisionStatus: 'declined',
    startedAt: '2026-10-01T00:00:00.000Z',
  },
  { suffix: 'B', status: 'hard_end', decisionStatus: null, startedAt: '2026-10-02T00:00:00.000Z' },
  { suffix: 'C', status: 'active', decisionStatus: null, startedAt: '2026-10-03T00:00:00.000Z' },
  {
    suffix: 'D',
    status: 'approved',
    decisionStatus: 'approved',
    startedAt: '2026-10-04T00:00:00.000Z',
  },
  { suffix: 'E', status: 'cancelled', decisionStatus: null, startedAt: '2026-10-05T00:00:00.000Z' },
  {
    suffix: 'F',
    status: 'declined',
    decisionStatus: 'declined',
    startedAt: '2026-10-06T00:00:00.000Z',
  },
  {
    suffix: 'G',
    status: 'paused',
    decisionStatus: 'referred',
    startedAt: '2026-10-07T00:00:00.000Z',
  },
]

async function seed(payload: Payload) {
  for (const row of SEED) {
    const conversationId = PREFIX + row.suffix
    const existing = await payload.find({
      collection: 'conversations',
      where: { conversationId: { equals: conversationId } },
      limit: 1,
      depth: 0,
    })
    if (existing.docs.length === 0) {
      await payload.create({
        collection: 'conversations',
        data: {
          conversationId,
          applicationNumber: `APP-${conversationId}`,
          customerIdString: `CUST-${row.suffix}`,
          status: row.status as 'active',
          decisionStatus: row.decisionStatus as 'approved' | null,
          startedAt: row.startedAt,
        },
      })
    }
  }
}

/** Mirrors the route: walk every page of `limit` rows under `sort`. */
async function walkPages(payload: Payload, sort: ConversationSort, limit: number) {
  const base: Where = { conversationId: { like: PREFIX } }
  const seen: Array<{ conversationId: string; value: string | null }> = []
  let cursor: string | null = null
  for (let guard = 0; guard < 20; guard++) {
    const filters: Where[] = [base]
    const decoded = cursor ? decodeCursor(cursor) : null
    if (decoded) filters.push(cursorWhere(sort, decoded))
    const result = await payload.find({
      collection: 'conversations',
      where: { and: filters },
      sort: payloadSort(sort),
      limit: limit + 1,
      depth: 0,
    })
    const hasMore = result.docs.length > limit
    const page = hasMore ? result.docs.slice(0, limit) : result.docs
    for (const d of page) {
      const doc = d as unknown as Record<string, unknown>
      seen.push({ conversationId: String(doc.conversationId), value: sortValueOf(doc, sort.field) })
    }
    if (!hasMore) break
    const last = page[page.length - 1] as unknown as Record<string, unknown>
    cursor = encodeCursor({ value: sortValueOf(last, sort.field), id: String(last.id) })
  }
  return seen
}

/** The same rows in one unpaged query — the order paging must reproduce. */
async function unpaged(payload: Payload, sort: ConversationSort) {
  const result = await payload.find({
    collection: 'conversations',
    where: { conversationId: { like: PREFIX } },
    sort: payloadSort(sort),
    limit: 100,
    depth: 0,
  })
  return result.docs.map((d) => String((d as unknown as Record<string, unknown>).conversationId))
}

describe('Conversations list sort — keyset paging', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getPayload({ config: configPromise })
    await seed(payload)
  })

  const cases: Array<[string, ConversationSort]> = [
    ['decisionStatus asc (nulls last)', { field: 'decisionStatus', dir: 'asc' }],
    ['decisionStatus desc (nulls first)', { field: 'decisionStatus', dir: 'desc' }],
    ['status asc (enum column)', { field: 'status', dir: 'asc' }],
    ['status desc (enum column)', { field: 'status', dir: 'desc' }],
    ['startedAt asc', { field: 'startedAt', dir: 'asc' }],
    ['startedAt desc', { field: 'startedAt', dir: 'desc' }],
    ['applicationNumber asc', { field: 'applicationNumber', dir: 'asc' }],
    ['updatedAt desc (default)', { field: 'updatedAt', dir: 'desc' }],
  ]

  test.each(cases)('paging by %s visits every seeded row once, in order', async (_label, sort) => {
    const expected = await unpaged(payload, sort)
    expect(expected).toHaveLength(SEED.length)

    for (const limit of [1, 2, 3]) {
      const seen = await walkPages(payload, sort, limit)
      expect(seen.map((s) => s.conversationId)).toEqual(expected)
    }
  })

  test('decisionStatus asc puts the null band last; desc puts it first', async () => {
    const asc = await walkPages(payload, { field: 'decisionStatus', dir: 'asc' }, 2)
    const firstNullAsc = asc.findIndex((s) => s.value === null)
    expect(asc.slice(firstNullAsc).every((s) => s.value === null)).toBe(true)
    expect(asc.slice(0, firstNullAsc).every((s) => s.value !== null)).toBe(true)

    const desc = await walkPages(payload, { field: 'decisionStatus', dir: 'desc' }, 2)
    const nullCount = SEED.filter((s) => s.decisionStatus === null).length
    expect(desc.slice(0, nullCount).every((s) => s.value === null)).toBe(true)
    expect(desc.slice(nullCount).every((s) => s.value !== null)).toBe(true)
  })
})
