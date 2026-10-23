/**
 * Unit tests for a report's link: parameters by name, and the view's own
 * keys, read back the same way.
 */
import { describe, expect, it } from 'vitest'
import { initialValues, reportQuery } from '@/components/ReportsView/ReportPanel'
import type { ReportParameter } from '@/lib/schemas/reports'

describe('report links', () => {
  const params: ReportParameter[] = [
    { name: 'from', label: 'From', type: 'date', required: true, default: '2026-10-01' },
    {
      name: 'exclude_closed',
      label: 'Exclude closed',
      type: 'boolean',
      required: true,
      default: true,
    },
    { name: 'code', label: 'Code', type: 'text', required: false },
  ]

  it('writes a false yes/no out, so a link reopens exactly as shared', () => {
    const query = reportQuery(
      { from: '2026-10-05', exclude_closed: false, code: '' },
      { compare: true, draft: false },
    )
    expect(query).toBe('from=2026-10-05&exclude_closed=false&_compare=1')
    expect(initialValues(params, new URLSearchParams(query))).toEqual({
      from: '2026-10-05',
      exclude_closed: false,
      code: '',
    })
  })

  it('falls back to defaults for what the link leaves out', () => {
    expect(initialValues(params, new URLSearchParams())).toEqual({
      from: '2026-10-01',
      exclude_closed: true,
      code: '',
    })
  })
})
