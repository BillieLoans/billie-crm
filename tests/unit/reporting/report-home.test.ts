/**
 * Unit tests for the Reports home's headline numbers (server/reporting/home.ts),
 * pinned-report parsing and report search. The report list and runs are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listReports = vi.fn()
const runReport = vi.fn()
vi.mock('@/server/reporting/run-report', () => ({
  listReports: (...args: unknown[]) => listReports(...args),
  runReport: (...args: unknown[]) => runReport(...args),
}))

import { homeTiles, resetHomeCache } from '@/server/reporting/home'
import { parsePins, MAX_PINS } from '@/server/reporting/preferences'
import { matchReports } from '@/lib/reports/catalogue'

const DAILY = {
  id: '1',
  slug: 'daily-applications',
  title: 'Daily applications',
  description: 'Applications started each day.',
  category: 'acquisition',
  published: true,
  featured: true,
  parameters: [],
  charts: [{ type: 'line', x: 'day', series: [{ column: 'applications' }] }],
  columns: [],
  headline: [{ column: 'applications', label: 'Applications', value: 'sum', better: 'higher' }],
  excludesMock: true,
}
const ARREARS = {
  ...DAILY,
  id: '2',
  slug: 'arrears-balance',
  title: 'Arrears balance',
  category: 'arrears',
  charts: [{ type: 'bar', x: 'bucket', series: [{ column: 'outstanding' }] }],
  headline: [{ column: 'outstanding', label: 'In arrears', better: 'lower' }],
}

function ok(body: unknown) {
  return { status: 200, body }
}

beforeEach(() => {
  resetHomeCache()
  listReports.mockReset()
  runReport.mockReset()
})

describe('homeTiles', () => {
  it('gives each featured report its first headline, change and sparkline', async () => {
    listReports.mockResolvedValue([
      DAILY,
      ARREARS,
      { ...DAILY, slug: 'not-featured', featured: false },
      { ...DAILY, slug: 'draft-only', published: false },
    ])
    runReport.mockImplementation(async (_p: unknown, _u: unknown, slug: string) =>
      slug === 'daily-applications'
        ? ok({
            columns: [
              { name: 'day', kind: 'date' },
              { name: 'applications', kind: 'number' },
            ],
            rows: [
              { day: '2026-10-02', applications: 5 },
              { day: '2026-10-01', applications: 3 },
            ],
            previous: {
              from: '2026-09-29',
              to: '2026-09-30',
              rows: [{ day: '2026-09-29', applications: 4 }],
            },
          })
        : ok({
            columns: [
              { name: 'bucket', kind: 'text' },
              { name: 'outstanding', kind: 'number' },
            ],
            rows: [
              { bucket: '1-30', outstanding: 1200 },
              { bucket: 'All', outstanding: 1200 },
            ],
            previous: null,
          }),
    )
    const tiles = await homeTiles({} as never, { id: 'u' })
    expect(tiles).toEqual([
      expect.objectContaining({
        slug: 'daily-applications',
        label: 'Applications',
        text: '8',
        previousLabel: 'the previous 2 days',
        spark: [3, 5],
        change: expect.objectContaining({ text: 'up 100%', tone: 'good' }),
      }),
      expect.objectContaining({
        slug: 'arrears-balance',
        text: '$1,200',
        change: null,
        spark: null,
      }),
    ])
    expect(runReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'daily-applications',
      { parameters: {}, compare: true, trigger: 'home' },
      {},
    )
  })

  it('shares one run between requests that arrive together', async () => {
    listReports.mockResolvedValue([DAILY])
    let finish: (v: unknown) => void = () => undefined
    runReport.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const both = Promise.all([homeTiles({} as never, {}), homeTiles({} as never, {})])
    await new Promise((r) => setTimeout(r, 0))
    finish(
      ok({
        columns: [
          { name: 'day', kind: 'date' },
          { name: 'applications', kind: 'number' },
        ],
        rows: [{ day: '2026-10-01', applications: 3 }],
      }),
    )
    const [a, b] = await both
    expect(a).toEqual(b)
    expect(runReport).toHaveBeenCalledTimes(1)
  })

  it('never serves a cached result to a changed report', async () => {
    const body = ok({
      columns: [
        { name: 'day', kind: 'date' },
        { name: 'applications', kind: 'number' },
        { name: 'funded', kind: 'number' },
      ],
      rows: [{ day: '2026-10-01', applications: 3, funded: 1 }],
    })
    runReport.mockResolvedValue(body)
    listReports.mockResolvedValue([DAILY])
    await homeTiles({} as never, {})
    listReports.mockResolvedValue([
      { ...DAILY, headline: [{ column: 'funded', label: 'Funded', value: 'sum' }] },
    ])
    const [tile] = await homeTiles({} as never, {})
    expect(tile.label).toBe('Funded')
    expect(runReport).toHaveBeenCalledTimes(2)
  })

  it('reuses a result for a minute, and leaves out reports that fail', async () => {
    listReports.mockResolvedValue([DAILY, ARREARS])
    runReport.mockImplementation(async (_p: unknown, _u: unknown, slug: string) =>
      slug === 'arrears-balance'
        ? { status: 500, body: { error: { code: 'QUERY_FAILED' } } }
        : ok({
            columns: [
              { name: 'day', kind: 'date' },
              { name: 'applications', kind: 'number' },
            ],
            rows: [{ day: '2026-10-01', applications: 3 }],
          }),
    )
    expect((await homeTiles({} as never, {})).map((t) => t.slug)).toEqual(['daily-applications'])
    await homeTiles({} as never, {})
    expect(runReport.mock.calls.filter((c) => c[2] === 'daily-applications')).toHaveLength(1)
  })
})

describe('parsePins', () => {
  it('keeps report links once each, in order, leaving the limit to the route', () => {
    expect(parsePins(['b', 'a', 'b'])).toEqual(['b', 'a'])
    expect(parsePins(Array.from({ length: MAX_PINS + 5 }, (_, i) => `r-${i}`))).toHaveLength(
      MAX_PINS + 5,
    )
    expect(parsePins(Array.from({ length: 201 }, (_, i) => `r-${i}`))).toBeNull()
  })

  it('refuses anything that is not a list of report links', () => {
    expect(parsePins('a')).toBeNull()
    expect(parsePins(['ok', 'Not A Slug'])).toBeNull()
    expect(parsePins([1])).toBeNull()
  })
})

describe('matchReports', () => {
  const reports = [
    { title: 'Decline rate and reasons', description: 'By source.', category: 'credit' },
    { title: 'Loans funded', description: 'Money out each day.', category: 'loan_book' },
  ]

  it('matches every word against the title, description and area', () => {
    expect(matchReports(reports, 'decline source').map((r) => r.title)).toEqual([
      'Decline rate and reasons',
    ])
    expect(matchReports(reports, 'loan book').map((r) => r.title)).toEqual(['Loans funded'])
    expect(matchReports(reports, 'credit money')).toEqual([])
    expect(matchReports(reports, '  ')).toHaveLength(2)
  })
})
