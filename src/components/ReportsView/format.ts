import type { ReportColumn } from '@/lib/schemas/reports'
import { formatDateOnly, formatDateShort, formatNumber } from '@/lib/formatters'

/**
 * Display text for a result cell. Dates arrive as `YYYY-MM-DD` and
 * timestamps as ISO 8601 UTC (see runner.ts); both render in en-AU.
 */
export function formatCell(value: unknown, kind: ReportColumn['kind']): string {
  if (value === null || value === undefined) return ''
  switch (kind) {
    case 'number':
      return formatNumber(value as number | string)
    case 'date':
      // Midday UTC keeps the calendar date whatever the browser's zone.
      return typeof value === 'string' ? formatDateOnly(`${value}T12:00:00Z`) : String(value)
    case 'datetime':
      return typeof value === 'string' ? formatDateShort(value) : String(value)
    case 'boolean':
      return value ? 'Yes' : 'No'
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
}

/** A readable header from a column name: `approval_rate` → `Approval rate`. */
export function columnLabel(name: string): string {
  const spaced = name.replace(/_/g, ' ').trim()
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : name
}
