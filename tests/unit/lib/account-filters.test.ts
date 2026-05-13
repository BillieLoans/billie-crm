import { describe, test, expect } from 'vitest'
import {
  buildPayloadWhere,
  filtersSchema,
  filtersToQueryString,
  queryStringToFilters,
} from '@/lib/account-filters'

describe('account-filters: queryStringToFilters', () => {
  test('returns defaults for an empty query string', () => {
    const filters = queryStringToFilters('')
    expect(filters.page).toBe(1)
    expect(filters.limit).toBe(50)
    expect(filters.status).toBeUndefined()
  })

  test('parses single status', () => {
    const filters = queryStringToFilters('status=in_arrears')
    expect(filters.status).toEqual(['in_arrears'])
  })

  test('parses comma-separated multi-status', () => {
    const filters = queryStringToFilters('status=in_arrears,active')
    expect(filters.status).toEqual(['in_arrears', 'active'])
  })

  test('parses numeric balance range', () => {
    const filters = queryStringToFilters('min_balance=500&max_balance=2000')
    expect(filters.minBalance).toBe(500)
    expect(filters.maxBalance).toBe(2000)
  })

  test('parses ISO date params', () => {
    const filters = queryStringToFilters(
      'opened_from=2026-01-01&opened_to=2026-05-13&closed_from=2026-04-13',
    )
    expect(filters.openedFrom).toBe('2026-01-01')
    expect(filters.openedTo).toBe('2026-05-13')
    expect(filters.closedFrom).toBe('2026-04-13')
  })

  test('rejects an invalid status enum value', () => {
    expect(() => queryStringToFilters('status=bogus')).toThrow()
  })

  test('rejects a malformed date', () => {
    expect(() => queryStringToFilters('opened_from=not-a-date')).toThrow()
  })

  test('rejects an unsupported sort key', () => {
    expect(() => queryStringToFilters('sort=-customer.weight')).toThrow()
  })

  test('rejects sub-3-char search query', () => {
    expect(() => queryStringToFilters('q=ab')).toThrow()
  })

  test('round-trips through queryString → state → queryString', () => {
    const input =
      'view=arrears&status=in_arrears,active&min_balance=500&sort=-balances.totalOutstanding&page=2'
    const state = queryStringToFilters(input)
    const qs = filtersToQueryString(state)
    const parsed = new URLSearchParams(qs)
    expect(parsed.get('view')).toBe('arrears')
    expect(parsed.get('status')).toBe('in_arrears,active')
    expect(parsed.get('min_balance')).toBe('500')
    expect(parsed.get('sort')).toBe('-balances.totalOutstanding')
    expect(parsed.get('page')).toBe('2')
  })

  test('omits default values from the query string', () => {
    const qs = filtersToQueryString({ page: 1, limit: 50, view: 'all' })
    const params = new URLSearchParams(qs)
    expect(params.has('page')).toBe(false)
    expect(params.has('limit')).toBe(false)
    expect(params.get('view')).toBe('all')
  })
})

describe('account-filters: filtersSchema', () => {
  test('applies defaults for page and limit', () => {
    const parsed = filtersSchema.parse({})
    expect(parsed.page).toBe(1)
    expect(parsed.limit).toBe(50)
  })

  test('rejects limit above maximum', () => {
    expect(() => filtersSchema.parse({ limit: 5000 })).toThrow()
  })

  test('rejects negative balance', () => {
    expect(() => filtersSchema.parse({ minBalance: -1 })).toThrow()
  })

  test('accepts a valid signed sort', () => {
    const parsed = filtersSchema.parse({ sort: '-createdAt' })
    expect(parsed.sort).toBe('-createdAt')
  })

  test('accepts an unsigned sort', () => {
    const parsed = filtersSchema.parse({ sort: 'lastPayment.date' })
    expect(parsed.sort).toBe('lastPayment.date')
  })
})

describe('account-filters: buildPayloadWhere', () => {
  test('empty filters produce an empty where', () => {
    const where = buildPayloadWhere(filtersSchema.parse({}), null)
    expect(where).toEqual({})
  })

  test('single status produces an `in` clause', () => {
    const where = buildPayloadWhere(
      filtersSchema.parse({ status: ['in_arrears'] }),
      null,
    )
    expect(where).toEqual({ accountStatus: { in: ['in_arrears'] } })
  })

  test('multiple filters compose into an `and` clause', () => {
    const where = buildPayloadWhere(
      filtersSchema.parse({ status: ['in_arrears'], minBalance: 500 }),
      null,
    )
    expect(where).toHaveProperty('and')
    expect(Array.isArray((where as { and: unknown[] }).and)).toBe(true)
    expect((where as { and: unknown[] }).and.length).toBe(2)
  })

  test('text search produces an `or` over the three search fields', () => {
    const where = buildPayloadWhere(filtersSchema.parse({ q: 'smith' }), null)
    expect(where).toEqual({
      or: [
        { accountNumber: { contains: 'smith' } },
        { loanAccountId: { contains: 'smith' } },
        { customerName: { contains: 'smith' } },
      ],
    })
  })

  test('customerIdIn list adds an `in` clause on customerIdString', () => {
    const where = buildPayloadWhere(filtersSchema.parse({}), ['cust-1', 'cust-2'])
    expect(where).toEqual({ customerIdString: { in: ['cust-1', 'cust-2'] } })
  })

  test('an empty customerIdIn list contributes no clause (caller short-circuits)', () => {
    const where = buildPayloadWhere(filtersSchema.parse({}), [])
    expect(where).toEqual({})
  })

  test('balance range produces gte + lte', () => {
    const where = buildPayloadWhere(
      filtersSchema.parse({ minBalance: 100, maxBalance: 500 }),
      null,
    ) as { and: Array<Record<string, unknown>> }
    expect(where.and).toContainEqual({
      'balances.totalOutstanding': { greater_than_equal: 100 },
    })
    expect(where.and).toContainEqual({
      'balances.totalOutstanding': { less_than_equal: 500 },
    })
  })

  test('date "to" expands to next-day midnight so full days match', () => {
    // The bug this guards: openedTo='2026-05-13' must include accounts opened
    // at 2026-05-13T14:30:00Z, not just exactly 2026-05-13T00:00:00Z.
    const where = buildPayloadWhere(
      filtersSchema.parse({ openedFrom: '2026-05-13', openedTo: '2026-05-13' }),
      null,
    ) as { and: Array<Record<string, unknown>> }
    expect(where.and).toContainEqual({
      'loanTerms.openedDate': { greater_than_equal: '2026-05-13T00:00:00.000Z' },
    })
    expect(where.and).toContainEqual({
      'loanTerms.openedDate': { less_than: '2026-05-14T00:00:00.000Z' },
    })
  })

  test('lastPmtBefore uses the day\'s start as an exclusive upper bound', () => {
    const where = buildPayloadWhere(
      filtersSchema.parse({ lastPmtBefore: '2026-05-13' }),
      null,
    )
    expect(where).toEqual({
      'lastPayment.date': { less_than: '2026-05-13T00:00:00.000Z' },
    })
  })

  test('isInArrears=true filters on the aging projection', () => {
    const where = buildPayloadWhere(filtersSchema.parse({ isInArrears: true }), null)
    expect(where).toEqual({ 'aging.isInArrears': { equals: true } })
  })

  test('isInArrears=false is also expressible (e.g. "not in arrears" view)', () => {
    const where = buildPayloadWhere(filtersSchema.parse({ isInArrears: false }), null)
    expect(where).toEqual({ 'aging.isInArrears': { equals: false } })
  })

  test('aging bucket multi-select produces an `in` clause', () => {
    const where = buildPayloadWhere(
      filtersSchema.parse({ agingBucket: ['late_arrears', 'default'] }),
      null,
    )
    expect(where).toEqual({ 'aging.bucket': { in: ['late_arrears', 'default'] } })
  })

  test('minDpd produces an aging.currentDPD >= clause', () => {
    const where = buildPayloadWhere(filtersSchema.parse({ minDpd: 30 }), null)
    expect(where).toEqual({ 'aging.currentDPD': { greater_than_equal: 30 } })
  })
})

describe('account-filters: aging URL params', () => {
  test('parses is_in_arrears=true', () => {
    const filters = queryStringToFilters('is_in_arrears=true')
    expect(filters.isInArrears).toBe(true)
  })

  test('parses is_in_arrears=false', () => {
    const filters = queryStringToFilters('is_in_arrears=false')
    expect(filters.isInArrears).toBe(false)
  })

  test('ignores nonsense is_in_arrears values', () => {
    const filters = queryStringToFilters('is_in_arrears=maybe')
    expect(filters.isInArrears).toBeUndefined()
  })

  test('parses aging_bucket multi-select', () => {
    const filters = queryStringToFilters('aging_bucket=late_arrears,default')
    expect(filters.agingBucket).toEqual(['late_arrears', 'default'])
  })

  test('parses min_dpd', () => {
    const filters = queryStringToFilters('min_dpd=15')
    expect(filters.minDpd).toBe(15)
  })

  test('aging params round-trip', () => {
    const state = queryStringToFilters('is_in_arrears=true&aging_bucket=late_arrears&min_dpd=30')
    const qs = filtersToQueryString(state)
    const parsed = new URLSearchParams(qs)
    expect(parsed.get('is_in_arrears')).toBe('true')
    expect(parsed.get('aging_bucket')).toBe('late_arrears')
    expect(parsed.get('min_dpd')).toBe('30')
  })

  test('aging.currentDPD is an accepted sort key', () => {
    expect(() => queryStringToFilters('sort=-aging.currentDPD')).not.toThrow()
  })
})
