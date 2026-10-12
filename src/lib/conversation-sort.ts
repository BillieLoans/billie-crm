import type { Where } from 'payload'

/**
 * Sort + keyset cursor helpers for GET /api/conversations (Applications list view).
 *
 * Only columns stored on the conversation row are sortable — customer name,
 * loan amount, purpose and message count are derived (customers table, the
 * applicationData JSON, utterances length) and would need new projected
 * columns from the event processor before Postgres could order by them.
 *
 * Paging is a (sort value, id) keyset. The pg adapter emits plain ASC/DESC,
 * so Postgres puts nulls FIRST on DESC and LAST on ASC; `cursorWhere` places
 * the null band explicitly so a page boundary inside or beside the band of a
 * nullable column (decisionStatus) neither skips nor repeats rows.
 */

export const CONVERSATION_SORT_FIELDS = [
  'updatedAt',
  'startedAt',
  'status',
  'decisionStatus',
  'applicationNumber',
  'customerIdString',
] as const

export type ConversationSortField = (typeof CONVERSATION_SORT_FIELDS)[number]
export type SortDir = 'asc' | 'desc'

export interface ConversationSort {
  field: ConversationSortField
  dir: SortDir
}

export const DEFAULT_CONVERSATION_SORT: ConversationSort = { field: 'updatedAt', dir: 'desc' }

export interface SortCursor {
  /** The sort column's value on the last row served; null when that row's value is null. */
  value: string | null
  id: string
}

const isSortField = (v: string): v is ConversationSortField =>
  (CONVERSATION_SORT_FIELDS as readonly string[]).includes(v)

/**
 * Parse the `sort` query param (`field` asc, `-field` desc). Empty → default.
 * Returns null for anything outside the whitelist so the route can 400.
 */
export function parseConversationSort(raw: string | undefined): ConversationSort | null {
  if (!raw) return { ...DEFAULT_CONVERSATION_SORT }
  const dir: SortDir = raw.startsWith('-') ? 'desc' : 'asc'
  const field = dir === 'desc' ? raw.slice(1) : raw
  if (!isSortField(field)) return null
  return { field, dir }
}

/**
 * Payload `sort` with `id` as a same-direction tiebreaker. An array on purpose:
 * the Local API does not split a comma-joined string (only the REST layer
 * does) — `'-updatedAt,-id'` fails column lookup and the adapter silently
 * falls back to `-createdAt`.
 */
export function payloadSort(sort: ConversationSort): string[] {
  const prefix = sort.dir === 'desc' ? '-' : ''
  return [`${prefix}${sort.field}`, `${prefix}id`]
}

export function encodeCursor(cursor: SortCursor): string {
  return Buffer.from(JSON.stringify({ v: cursor.value, id: cursor.id }), 'utf8').toString(
    'base64url',
  )
}

/**
 * Decode a cursor. Accepts the current `{ v, id }` shape and the pre-sort
 * `{ updatedAt, id }` shape so a client mid-scroll across a deploy keeps paging.
 */
export function decodeCursor(raw: string): SortCursor | null {
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >
    if (!decoded || typeof decoded !== 'object' || !decoded.id) return null
    const id = String(decoded.id)
    if ('v' in decoded) {
      return { value: decoded.v == null ? null : String(decoded.v), id }
    }
    if (typeof decoded.updatedAt === 'string') {
      return { value: decoded.updatedAt, id }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Where-clause selecting rows strictly after `cursor` in `sort` order.
 *
 * DESC order is: null band (id desc) → values desc.
 * ASC order is:  values asc → null band (id asc).
 */
export function cursorWhere(sort: ConversationSort, cursor: SortCursor): Where {
  const f = sort.field
  if (sort.dir === 'desc') {
    if (cursor.value === null) {
      return {
        or: [
          { and: [{ [f]: { exists: false } }, { id: { less_than: cursor.id } }] },
          { [f]: { exists: true } },
        ],
      }
    }
    return {
      or: [
        { [f]: { less_than: cursor.value } },
        { and: [{ [f]: { equals: cursor.value } }, { id: { less_than: cursor.id } }] },
      ],
    }
  }
  if (cursor.value === null) {
    return { and: [{ [f]: { exists: false } }, { id: { greater_than: cursor.id } }] }
  }
  return {
    or: [
      { [f]: { greater_than: cursor.value } },
      { and: [{ [f]: { equals: cursor.value } }, { id: { greater_than: cursor.id } }] },
      { [f]: { exists: false } },
    ],
  }
}

/** Read the sort column off a fetched doc as the string the cursor carries. */
export function sortValueOf(
  doc: Record<string, unknown>,
  field: ConversationSortField,
): string | null {
  const v = doc[field]
  if (v == null) return null
  if (v instanceof Date) return v.toISOString()
  return String(v)
}
