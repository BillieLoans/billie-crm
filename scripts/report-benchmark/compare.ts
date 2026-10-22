/**
 * Result equivalence for the AI-authored reports benchmark (BTB-508).
 *
 * A generated result is equivalent to the reference when each reference
 * column can be mapped to its own generated column so that the rows match
 * one to one. Column names and order are ignored, and extra generated
 * columns are allowed (a draft may add a denominator), but a column's values
 * must stay together: swapping two counts between columns is not a match.
 *
 * Cells compare as follows: numbers within 0.005 absolute or 0.1% relative
 * (so a rate rounded to two places matches the same rate to four, but 0.24
 * does not match 0.235); dates as YYYY-MM-DD, including a timestamp at
 * midnight (`date_trunc('week', …)`); NULL as null; text trimmed.
 */

type Row = Record<string, unknown>
type Cell = { kind: 'number'; value: number } | { kind: 'text'; value: string }

const NUMBER = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i
const MIDNIGHT = /^(\d{4}-\d{2}-\d{2})[T ]00:00:00(\.0+)?(Z|[+-]\d{2}(:?\d{2})?)?$/

/** A comparable form of one cell. */
export function normaliseCell(value: unknown): Cell {
  if (value === null || value === undefined) return { kind: 'text', value: 'null' }
  if (typeof value === 'number') return { kind: 'number', value }
  if (typeof value === 'bigint') return { kind: 'number', value: Number(value) }
  if (typeof value === 'boolean') return { kind: 'text', value: value ? 'true' : 'false' }
  if (value instanceof Date) return { kind: 'text', value: value.toISOString().slice(0, 10) }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (NUMBER.test(trimmed)) return { kind: 'number', value: Number(trimmed) }
    const midnight = MIDNIGHT.exec(trimmed)
    if (midnight) return { kind: 'text', value: midnight[1] }
    return { kind: 'text', value: trimmed }
  }
  return { kind: 'text', value: JSON.stringify(value) }
}

export function cellsEqual(a: Cell, b: Cell): boolean {
  if (a.kind === 'number' && b.kind === 'number') {
    const diff = Math.abs(a.value - b.value)
    return diff <= 0.005 || diff <= 0.001 * Math.max(Math.abs(a.value), Math.abs(b.value))
  }
  return a.kind === b.kind && a.value === b.value
}

/** Columns as lists of normalised cells, in row order. */
function columnsOf(rows: Row[]): Cell[][] {
  const names = rows.length ? Object.keys(rows[0]) : []
  return names.map((name) => rows.map((r) => normaliseCell(r[name])))
}

/** Same values in any order: a necessary condition for mapping one column to another. */
function sameValues(a: Cell[], b: Cell[]): boolean {
  const key = (c: Cell) => (c.kind === 'number' ? c.value : Number.NaN)
  const nums = (cells: Cell[]) =>
    cells
      .filter((c) => c.kind === 'number')
      .map(key)
      .sort((x, y) => x - y)
  const texts = (cells: Cell[]) =>
    cells
      .filter((c) => c.kind === 'text')
      .map((c) => c.value as string)
      .sort()
  const [na, nb, ta, tb] = [nums(a), nums(b), texts(a), texts(b)]
  if (na.length !== nb.length || ta.length !== tb.length) return false
  if (ta.some((v, i) => v !== tb[i])) return false
  return na.every((v, i) =>
    cellsEqual({ kind: 'number', value: v }, { kind: 'number', value: nb[i] }),
  )
}

/** A perfect matching of reference rows to generated rows (augmenting paths). */
function rowsMatch(ref: Cell[][], gen: Cell[][], mapping: number[]): boolean {
  const n = ref[0]?.length ?? 0
  const rowEq = (i: number, j: number) => mapping.every((g, r) => cellsEqual(ref[r][i], gen[g][j]))
  const matchOf = new Array<number>(n).fill(-1)
  const tryRow = (i: number, seen: boolean[]): boolean => {
    for (let j = 0; j < n; j++) {
      if (seen[j] || !rowEq(i, j)) continue
      seen[j] = true
      if (matchOf[j] === -1 || tryRow(matchOf[j], seen)) {
        matchOf[j] = i
        return true
      }
    }
    return false
  }
  for (let i = 0; i < n; i++) {
    if (!tryRow(i, new Array<boolean>(n).fill(false))) return false
  }
  return true
}

export function resultsEquivalent(reference: Row[], generated: Row[]): boolean {
  if (reference.length !== generated.length) return false
  if (reference.length === 0) return true
  const ref = columnsOf(reference)
  const gen = columnsOf(generated)
  if (gen.length < ref.length) return false
  const candidates = ref.map((r) => gen.flatMap((g, j) => (sameValues(r, g) ? [j] : [])))
  // Try each one-to-one assignment of columns (candidates are few in practice).
  const mapping: number[] = []
  const used = new Set<number>()
  const assign = (r: number): boolean => {
    if (r === ref.length) return rowsMatch(ref, gen, mapping)
    for (const j of candidates[r]) {
      if (used.has(j)) continue
      used.add(j)
      mapping[r] = j
      if (assign(r + 1)) return true
      used.delete(j)
    }
    return false
  }
  return assign(0)
}
