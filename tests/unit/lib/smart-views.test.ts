import { describe, test, expect } from 'vitest'
import {
  SMART_VIEWS,
  SMART_VIEW_IDS,
  applySmartViewDefaults,
  getSmartView,
} from '@/lib/smart-views'
import { buildPayloadWhere, filtersSchema } from '@/lib/account-filters'

const FIXED_NOW = new Date('2026-05-13T12:00:00Z')

describe('smart-views: catalog', () => {
  test('every view has a unique, kebab-case id', () => {
    const ids = SMART_VIEWS.map((v) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/)
    }
  })

  test('SMART_VIEW_IDS matches the catalog', () => {
    expect(SMART_VIEW_IDS).toEqual(SMART_VIEWS.map((v) => v.id))
  })

  test('getSmartView returns the right view by id', () => {
    expect(getSmartView('arrears')?.label).toBe('Arrears')
    expect(getSmartView('unknown')).toBeUndefined()
    expect(getSmartView(null)).toBeUndefined()
    expect(getSmartView(undefined)).toBeUndefined()
  })
})

describe('smart-views: every view resolves to a valid Payload `where`', () => {
  for (const view of SMART_VIEWS) {
    test(`${view.id} resolves and validates`, () => {
      const resolved = view.resolve(FIXED_NOW)
      // Apply schema to ensure no view emits invalid defaults.
      const validated = filtersSchema.parse({ ...resolved, view: view.id })
      // And the where builder must run without throwing.
      expect(() => buildPayloadWhere(validated, null)).not.toThrow()
    })
  }
})

describe('smart-views: applySmartViewDefaults', () => {
  test('no-op when no view is set', () => {
    const filters = filtersSchema.parse({ minBalance: 100 })
    expect(applySmartViewDefaults(filters, FIXED_NOW)).toEqual(filters)
  })

  test('arrears view supplies isInArrears + DPD sort when user didn\'t', () => {
    const filters = filtersSchema.parse({ view: 'arrears' })
    const merged = applySmartViewDefaults(filters, FIXED_NOW)
    expect(merged.isInArrears).toBe(true)
    expect(merged.sort).toBe('-aging.currentDPD')
  })

  test('user-supplied isInArrears overrides view default', () => {
    const filters = filtersSchema.parse({ view: 'arrears', isInArrears: false })
    const merged = applySmartViewDefaults(filters, FIXED_NOW)
    expect(merged.isInArrears).toBe(false)
  })

  test('user sort overrides view default', () => {
    const filters = filtersSchema.parse({
      view: 'high-value-at-risk',
      sort: 'accountNumber',
    })
    const merged = applySmartViewDefaults(filters, FIXED_NOW)
    expect(merged.sort).toBe('accountNumber')
  })

  test('disbursed-today resolves @today to the given date', () => {
    const filters = filtersSchema.parse({ view: 'disbursed-today' })
    const merged = applySmartViewDefaults(filters, FIXED_NOW)
    expect(merged.openedFrom).toBe('2026-05-13')
    expect(merged.openedTo).toBe('2026-05-13')
  })

  test('written-off-30d resolves @30d_ago relative to now', () => {
    const filters = filtersSchema.parse({ view: 'written-off-30d' })
    const merged = applySmartViewDefaults(filters, FIXED_NOW)
    expect(merged.closureReason).toBe('WRITTEN_OFF')
    expect(merged.closedFrom).toBe('2026-04-13')
  })

  test('deceased view sets customerStatus=DECEASED', () => {
    const filters = filtersSchema.parse({ view: 'deceased' })
    const merged = applySmartViewDefaults(filters, FIXED_NOW)
    expect(merged.customerStatus).toBe('DECEASED')
  })
})
