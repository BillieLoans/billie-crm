/**
 * Unit tests for what the report editor shows before publishing: the SQL
 * line diff, JSON equality and the list of changed settings.
 */
import { describe, expect, it } from 'vitest'
import { changedFields, lineDiff, sameJson } from '@/lib/reports/diff'

describe('lineDiff', () => {
  it('marks removed and added lines around the common ones', () => {
    expect(lineDiff('SELECT a\nFROM t\nWHERE x', 'SELECT a, b\nFROM t\nWHERE x')).toEqual([
      { type: 'remove', text: 'SELECT a' },
      { type: 'add', text: 'SELECT a, b' },
      { type: 'same', text: 'FROM t' },
      { type: 'same', text: 'WHERE x' },
    ])
  })

  it('handles an empty side and identical text', () => {
    expect(lineDiff('', 'a')).toEqual([
      { type: 'remove', text: '' },
      { type: 'add', text: 'a' },
    ])
    expect(lineDiff('a\nb', 'a\nb').every((l) => l.type === 'same')).toBe(true)
  })

  it('gives up on very long text rather than block the page', () => {
    expect(lineDiff('x\n'.repeat(2_001), 'y')).toBeNull()
  })
})

describe('sameJson', () => {
  it('ignores key order and undefined keys, not array order', () => {
    expect(sameJson({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1, c: undefined })).toBe(true)
    expect(sameJson([1, 2], [2, 1])).toBe(false)
    expect(sameJson(null, undefined)).toBe(true)
    expect(sameJson({ a: 1 }, [1])).toBe(false)
  })
})

describe('changedFields', () => {
  const published = {
    title: 'T',
    sql: 'SELECT 1',
    roles: ['admin', 'supervisor'],
    chart: null,
    headline: [],
  }

  it('names the settings that changed, by their labels, in a fixed order', () => {
    expect(
      changedFields(published, {
        ...published,
        sql: 'SELECT 2',
        title: 'U',
        roles: ['supervisor', 'admin'],
      }),
    ).toEqual(['Title', 'SQL'])
  })

  it('treats missing and empty as the same, and a new report as new', () => {
    expect(changedFields(published, { ...published, description: undefined })).toEqual([])
    expect(changedFields(null, published)).toEqual(['New report'])
  })
})
