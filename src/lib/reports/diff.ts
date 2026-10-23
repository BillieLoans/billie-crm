/**
 * What changed between the published version of a report and the one about
 * to replace it: which settings, and a line diff of the SQL. Shown before
 * an author publishes. Pure functions only.
 */

export interface DiffLine {
  type: 'same' | 'add' | 'remove'
  text: string
}

/** Above this many lines on either side, show the change without a line diff. */
const MAX_DIFF_LINES = 2_000

/** A line-by-line diff (longest common subsequence). */
export function lineDiff(before: string, after: string): DiffLine[] | null {
  const a = before.split('\n')
  const b = after.split('\n')
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) return null
  // lcs[i][j]: common lines of a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: 'remove', text: a[i++] })
    } else {
      out.push({ type: 'add', text: b[j++] })
    }
  }
  while (i < a.length) out.push({ type: 'remove', text: a[i++] })
  while (j < b.length) out.push({ type: 'add', text: b[j++] })
  return out
}

/** Structural equality for JSON values; object key order does not matter. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return (a ?? null) === (b ?? null)
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keysA = Object.keys(a as object).filter(
    (k) => (a as Record<string, unknown>)[k] !== undefined,
  )
  const keysB = Object.keys(b as object).filter(
    (k) => (b as Record<string, unknown>)[k] !== undefined,
  )
  return (
    keysA.length === keysB.length &&
    keysA.every((k) =>
      sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  )
}

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  category: 'Area',
  featured: 'Featured on the Reports home',
  sql: 'SQL',
  parameters: 'Parameters',
  chart: 'Charts',
  headline: 'Headline numbers',
  columnSettings: 'Column settings',
  roles: 'Who can run it',
  schedule: 'Schedule',
}

/** The settings that differ, by their names on the page, in a fixed order. */
export function changedFields(
  published: Record<string, unknown> | null,
  next: Record<string, unknown>,
): string[] {
  if (!published) return ['New report']
  const orderless = (v: unknown) => (Array.isArray(v) ? [...v].map(String).sort() : v)
  return Object.keys(FIELD_LABELS)
    .filter((key) => {
      const a = key === 'roles' ? orderless(published[key]) : published[key]
      const b = key === 'roles' ? orderless(next[key]) : next[key]
      return !sameJson(a ?? null, b ?? null)
    })
    .map((key) => FIELD_LABELS[key])
}
