/**
 * Unit tests for reading a half-written definition as it streams: only
 * complete strings are shown.
 */
import { describe, expect, it } from 'vitest'
import { readPartialDraft } from '@/server/reporting/ask/partial'

describe('readPartialDraft', () => {
  it('reads nothing from nothing', () => {
    expect(readPartialDraft('')).toEqual({ plan: [], assumptions: [], writingSql: false })
  })

  it('takes the title once its string is complete, and plan steps one by one', () => {
    expect(
      readPartialDraft('{"answerable":true,"not_answerable_reason":null,"title":"Appro'),
    ).toEqual({
      plan: [],
      assumptions: [],
      writingSql: false,
    })
    const text =
      '{"answerable":true,"not_answerable_reason":null,"title":"Approval rate by \\"source\\"",' +
      '"plan":["Count decided applications per week","Split by acquisition sou'
    expect(readPartialDraft(text)).toEqual({
      title: 'Approval rate by "source"',
      plan: ['Count decided applications per week'],
      assumptions: [],
      writingSql: false,
    })
  })

  it('reads the assumptions, and notices when the SQL has started', () => {
    const text =
      '{"title":"T","plan":["a","b"],"assumptions":["Weeks start Monday"],' +
      '"description":"d","category":"credit","parameters":[],"sql":"SELECT'
    expect(readPartialDraft(text)).toEqual({
      title: 'T',
      plan: ['a', 'b'],
      assumptions: ['Weeks start Monday'],
      writingSql: true,
    })
  })
})
