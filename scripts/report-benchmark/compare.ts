/**
 * Result equivalence for the AI-authored reports benchmark (BTB-508).
 *
 * A generated result is equivalent to the reference when it has the same
 * number of rows and every reference row can be matched to a distinct
 * generated row containing all of the reference row's values. Column names
 * and order are ignored, and extra columns in the generated result are
 * allowed (a draft may add a denominator). Numbers compare at two decimal
 * places, dates as YYYY-MM-DD, NULL as null.
 */

type Row = Record<string, unknown>

/** A comparable form of one cell. */
export function normaliseCell(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') return (Math.round(value * 100) / 100).toFixed(2)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'string') {
    if (/^-?\d+(\.\d+)?$/.test(value)) return (Math.round(Number(value) * 100) / 100).toFixed(2)
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value
    return value.trim()
  }
  return JSON.stringify(value)
}

function cells(row: Row): string[] {
  return Object.values(row).map(normaliseCell)
}

/** True when every value in `needle` appears in `haystack` as often or more. */
function contains(haystack: string[], needle: string[]): boolean {
  const counts = new Map<string, number>()
  for (const v of haystack) counts.set(v, (counts.get(v) ?? 0) + 1)
  for (const v of needle) {
    const n = counts.get(v) ?? 0
    if (n === 0) return false
    counts.set(v, n - 1)
  }
  return true
}

export function resultsEquivalent(reference: Row[], generated: Row[]): boolean {
  if (reference.length !== generated.length) return false
  const remaining = generated.map(cells)
  // Match the most specific reference rows first.
  const refs = reference.map(cells).sort((a, b) => b.length - a.length)
  for (const ref of refs) {
    const i = remaining.findIndex((g) => contains(g, ref))
    if (i === -1) return false
    remaining.splice(i, 1)
  }
  return true
}
