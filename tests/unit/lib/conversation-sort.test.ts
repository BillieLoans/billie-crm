/**
 * Unit tests for the Applications list sort + keyset cursor helpers.
 *
 * GET /api/conversations sorts by a whitelisted row-level column and pages with
 * a (sort value, id) keyset cursor. Postgres orders nulls FIRST on DESC and
 * LAST on ASC (the adapter emits plain ASC/DESC), so the cursor's where-clause
 * must place the null band explicitly or paging through a nullable column
 * (decisionStatus, lastUtteranceTime) skips or repeats rows.
 */
import { describe, it, expect } from 'vitest'
import {
  parseConversationSort,
  payloadSort,
  encodeCursor,
  decodeCursor,
  cursorWhere,
  DEFAULT_CONVERSATION_SORT,
} from '@/lib/conversation-sort'

describe('parseConversationSort', () => {
  it('defaults to updatedAt descending when no sort is given', () => {
    expect(parseConversationSort(undefined)).toEqual({ field: 'updatedAt', dir: 'desc' })
    expect(parseConversationSort('')).toEqual(DEFAULT_CONVERSATION_SORT)
  })

  it('reads a leading dash as descending', () => {
    expect(parseConversationSort('-startedAt')).toEqual({ field: 'startedAt', dir: 'desc' })
  })

  it('reads a bare field as ascending', () => {
    expect(parseConversationSort('applicationNumber')).toEqual({
      field: 'applicationNumber',
      dir: 'asc',
    })
  })

  it.each(['customerIdString', 'status', 'decisionStatus'])(
    'accepts whitelisted row column %s',
    (field) => {
      expect(parseConversationSort(field)).toEqual({ field, dir: 'asc' })
    },
  )

  it.each(['loanAmount', 'messageCount', 'lastUtteranceTime', 'utterances', '-id', 'drop table'])(
    'rejects non-whitelisted sort %s',
    (raw) => {
      expect(parseConversationSort(raw)).toBeNull()
    },
  )
})

describe('payloadSort', () => {
  // An array, not 'a,b': the Local API does not split comma-joined sort strings
  // (only REST does) and silently falls back to -createdAt for the whole thing.
  it('appends id in the same direction as a tiebreaker, as an array', () => {
    expect(payloadSort({ field: 'startedAt', dir: 'desc' })).toEqual(['-startedAt', '-id'])
    expect(payloadSort({ field: 'startedAt', dir: 'asc' })).toEqual(['startedAt', 'id'])
  })
})

describe('cursor encoding', () => {
  it('round-trips a sort value and id', () => {
    const cursor = encodeCursor({ value: '2026-10-10T00:00:00.000Z', id: 'abc' })
    expect(decodeCursor(cursor)).toEqual({ value: '2026-10-10T00:00:00.000Z', id: 'abc' })
  })

  it('round-trips a null sort value', () => {
    const cursor = encodeCursor({ value: null, id: 'abc' })
    expect(decodeCursor(cursor)).toEqual({ value: null, id: 'abc' })
  })

  it('still reads the pre-sort cursor shape issued before this change', () => {
    const legacy = Buffer.from(
      JSON.stringify({ updatedAt: '2026-10-10T00:00:00.000Z', id: 'abc' }),
      'utf8',
    ).toString('base64url')
    expect(decodeCursor(legacy)).toEqual({ value: '2026-10-10T00:00:00.000Z', id: 'abc' })
  })

  it('returns null for garbage', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull()
    expect(decodeCursor(Buffer.from('{"nope":1}').toString('base64url'))).toBeNull()
  })
})

describe('cursorWhere', () => {
  const desc = { field: 'decisionStatus', dir: 'desc' } as const
  const asc = { field: 'decisionStatus', dir: 'asc' } as const

  it('descending after a value: smaller values, or equal value with smaller id', () => {
    expect(cursorWhere(desc, { value: 'declined', id: 'c1' })).toEqual({
      or: [
        { decisionStatus: { less_than: 'declined' } },
        { and: [{ decisionStatus: { equals: 'declined' } }, { id: { less_than: 'c1' } }] },
      ],
    })
  })

  it('descending after a null: rest of the null band (nulls come first), then every non-null', () => {
    expect(cursorWhere(desc, { value: null, id: 'c1' })).toEqual({
      or: [
        { and: [{ decisionStatus: { exists: false } }, { id: { less_than: 'c1' } }] },
        { decisionStatus: { exists: true } },
      ],
    })
  })

  it('ascending after a value: larger values, equal value with larger id, then the null band', () => {
    expect(cursorWhere(asc, { value: 'approved', id: 'c1' })).toEqual({
      or: [
        { decisionStatus: { greater_than: 'approved' } },
        { and: [{ decisionStatus: { equals: 'approved' } }, { id: { greater_than: 'c1' } }] },
        { decisionStatus: { exists: false } },
      ],
    })
  })

  it('ascending after a null: only the rest of the null band (nulls come last)', () => {
    expect(cursorWhere(asc, { value: null, id: 'c1' })).toEqual({
      and: [{ decisionStatus: { exists: false } }, { id: { greater_than: 'c1' } }],
    })
  })
})
