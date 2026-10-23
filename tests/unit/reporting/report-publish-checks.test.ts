/**
 * A publish over the API runs the Ask Claude checks (the run on the
 * defaults included) and is refused on any error, whatever the browser did.
 * Drafts and the Local API (seed migrations) are not re-run.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const checkAndPreview = vi.fn()
vi.mock('@/server/reporting/ask/preview', () => ({
  checkAndPreview: (...a: unknown[]) => checkAndPreview(...a),
}))

import { checksBeforePublish } from '@/collections/ReportDefinitions'

const collection = { slug: 'report-definitions' }
const run = (
  data: Record<string, unknown>,
  payloadAPI: string,
  originalDoc?: unknown,
  query: Record<string, unknown> = {},
) =>
  checksBeforePublish({
    data,
    originalDoc,
    req: { payloadAPI, query },
    collection,
    operation: 'update',
  } as never)

beforeEach(() => {
  checkAndPreview.mockReset().mockResolvedValue({ issues: [] })
})

describe('checksBeforePublish', () => {
  it('runs the checks on the whole report when it is published over the API', async () => {
    await run({ _status: 'published', sql: 'SELECT 2' }, 'REST', {
      title: 'T',
      sql: 'SELECT 1',
      chart: { type: 'bar', x: 'a', series: [{ column: 'n' }] },
    })
    expect(checkAndPreview).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'T', sql: 'SELECT 2', chart: expect.any(Object) }),
    )
  })

  it('refuses a publish whose checks find an error, naming it', async () => {
    checkAndPreview.mockResolvedValue({
      issues: [
        { level: 'error', code: 'RUN', message: 'column "x" does not exist' },
        { level: 'warning', code: 'MOCK', message: 'no mock filter' },
      ],
    })
    await expect(run({ _status: 'published', title: 'T', sql: 'S' }, 'REST')).rejects.toMatchObject(
      { data: { errors: [{ path: 'sql', message: 'Not published: column "x" does not exist' }] } },
    )
  })

  it('treats a change to a published report that names no status as a publish', async () => {
    await run({ sql: 'SELECT 2' }, 'REST', { title: 'T', sql: 'SELECT 1', _status: 'published' })
    expect(checkAndPreview).toHaveBeenCalledTimes(1)
    // Saved as a draft, it is not.
    await run({ sql: 'SELECT 3' }, 'REST', { title: 'T', _status: 'published' }, { draft: 'true' })
    expect(checkAndPreview).toHaveBeenCalledTimes(1)
  })

  it('leaves drafts and the Local API alone', async () => {
    await run({ _status: 'draft', title: 'T', sql: 'S' }, 'REST')
    await run({ _status: 'published', title: 'T', sql: 'S' }, 'local')
    expect(checkAndPreview).not.toHaveBeenCalled()
  })
})
