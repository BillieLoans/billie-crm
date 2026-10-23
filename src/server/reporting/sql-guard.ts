/**
 * Static checks on report SQL (BTB-506).
 *
 * This check exists to give an author a useful message; it is not the
 * control. The controls are in the runner: the query is sent with the
 * extended protocol (Postgres refuses more than one statement), wrapped in a
 * subquery (a data-modifying CTE is an error), and run in a read-only
 * transaction by the `reporting_reader` login, which can read the
 * `reporting` schema and nothing else.
 *
 * Pure and dependency-free: Payload runs field validation in the browser too.
 */

export type SqlCheck =
  | { ok: true; sql: string; placeholders: number[] }
  | { ok: false; error: string }

export const MAX_SQL_LENGTH = 20_000

/** Same-length filler, so offsets in the stripped text match the original. */
function blank(text: string): string {
  return text.replace(/[^\n]/g, ' ')
}

/**
 * Blank out comments and quoted text so keywords and semicolons inside them
 * are not mistaken for code. The result has the same length as the input.
 * Returns null if a quote or comment is left open.
 */
export function stripLiterals(sql: string): string | null {
  let out = ''
  let i = 0
  const n = sql.length
  while (i < n) {
    const c = sql[i]
    const next = sql[i + 1]
    if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i)
      const stop = end === -1 ? n : end
      out += blank(sql.slice(i, stop))
      i = stop
      continue
    }
    if (c === '/' && next === '*') {
      // Postgres block comments nest.
      const start = i
      let depth = 1
      i += 2
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++
          i += 2
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--
          i += 2
        } else i++
      }
      if (depth > 0) return null
      out += blank(sql.slice(start, i))
      continue
    }
    if (c === "'") {
      // E'...' strings allow backslash escapes; plain strings double the quote.
      const escaped = i > 0 && /[eE]/.test(sql[i - 1]) && !/[\w$]/.test(sql[i - 2] ?? '')
      const start = i
      i++
      let closed = false
      while (i < n) {
        if (escaped && sql[i] === '\\') {
          i += 2
          continue
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2
            continue
          }
          closed = true
          i++
          break
        }
        i++
      }
      if (!closed) return null
      out += `'${blank(sql.slice(start + 1, i - 1))}'`
      continue
    }
    if (c === '"') {
      const end = sql.indexOf('"', i + 1)
      if (end === -1) return null
      out += `"${'x'.repeat(end - i - 1)}"`
      i = end + 1
      continue
    }
    if (c === '$' && !/[A-Za-z0-9_$\u0080-\uffff]/.test(sql[i - 1] ?? '')) {
      // $tag$ ... $tag$ — but $1 is a parameter, not a quote, and a `$`
      // inside an identifier (x$$, a$b) is part of the name.
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length)
        if (end === -1) return null
        const stop = end + tag[0].length
        out += `'${blank(sql.slice(i + 1, stop - 1))}'`
        i = stop
        continue
      }
    }
    out += c
    i++
  }
  return out
}

/**
 * Check that SQL is one SELECT or WITH statement and list its `$N`
 * placeholders.
 */
export function checkReportSql(sql: unknown): SqlCheck {
  if (typeof sql !== 'string' || !sql.trim()) return { ok: false, error: 'Enter the SQL' }
  if (sql.length > MAX_SQL_LENGTH) {
    return {
      ok: false,
      error: `SQL must be ${MAX_SQL_LENGTH.toLocaleString('en-AU')} characters or fewer`,
    }
  }
  const code = stripLiterals(sql)
  if (code === null) return { ok: false, error: 'A quote or comment is not closed' }

  // Allow trailing semicolons; anything after one is a second statement.
  const trailing = /;[\s;]*$/.exec(code)
  const body = trailing ? code.slice(0, trailing.index) : code
  if (body.includes(';')) return { ok: false, error: 'Use a single statement (remove the ";")' }

  const first = /^\s*\(*\s*([A-Za-z]+)/.exec(body)?.[1]?.toUpperCase()
  if (first !== 'SELECT' && first !== 'WITH') {
    return { ok: false, error: 'Start the query with SELECT or WITH' }
  }

  const placeholders = [...new Set([...body.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])))].sort(
    (a, b) => a - b,
  )
  const cleaned = trailing ? sql.slice(0, trailing.index) : sql
  return { ok: true, sql: cleaned.trimEnd(), placeholders }
}

/**
 * Check that the SQL uses exactly `$1..$count`, one per parameter, so every
 * parameter is bound and none is missing.
 */
export function checkPlaceholders(placeholders: readonly number[], count: number): string | null {
  for (let k = 1; k <= count; k++) {
    if (!placeholders.includes(k)) return `The SQL does not use $${k} (parameter ${k})`
  }
  const extra = placeholders.find((p) => p < 1 || p > count)
  if (extra !== undefined) {
    return `The SQL uses $${extra} but the report has ${count} parameter${count === 1 ? '' : 's'}`
  }
  return null
}
