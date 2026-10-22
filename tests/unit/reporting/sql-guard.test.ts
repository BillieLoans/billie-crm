/**
 * Unit tests for the report SQL guard (BTB-506): one SELECT or WITH
 * statement, literals and comments cannot hide a second statement, and
 * placeholders line up with the parameters.
 */
import { describe, test, expect } from 'vitest'
import { checkPlaceholders, checkReportSql, stripLiterals } from '@/server/reporting/sql-guard'

function rejects(sql: string, message: RegExp) {
  const check = checkReportSql(sql)
  expect(check.ok).toBe(false)
  if (!check.ok) expect(check.error).toMatch(message)
}

describe('checkReportSql', () => {
  test('accepts SELECT and WITH, and lists placeholders', () => {
    const check = checkReportSql(
      'select count(*) from application where started_on >= $1 and x = $2',
    )
    expect(check).toEqual({
      ok: true,
      sql: 'select count(*) from application where started_on >= $1 and x = $2',
      placeholders: [1, 2],
    })
    expect(checkReportSql('WITH a AS (SELECT 1) SELECT * FROM a').ok).toBe(true)
    expect(checkReportSql('(SELECT 1)').ok).toBe(true)
  })

  test('drops trailing semicolons and a trailing comment after them', () => {
    const check = checkReportSql('SELECT 1;  ;\n-- done')
    expect(check.ok && check.sql).toBe('SELECT 1')
  })

  test.each([
    ['INSERT INTO application VALUES (1)', /SELECT or WITH/],
    ['DELETE FROM decision_event', /SELECT or WITH/],
    ['UPDATE x SET y = 1', /SELECT or WITH/],
    ['DROP TABLE x', /SELECT or WITH/],
    ['SET ROLE postgres', /SELECT or WITH/],
    ['COPY x TO STDOUT', /SELECT or WITH/],
    ['  ', /Enter the SQL/],
  ])('rejects %s', (sql, message) => rejects(sql, message))

  test('rejects a second statement', () => {
    rejects('SELECT 1; DROP TABLE application', /single statement/)
    rejects('SELECT 1; SELECT 2', /single statement/)
  })

  test('a semicolon inside a literal or comment is not a statement break', () => {
    expect(checkReportSql("SELECT 'a;b' AS x").ok).toBe(true)
    expect(checkReportSql('SELECT 1 /* ; */ AS x').ok).toBe(true)
    expect(checkReportSql('SELECT 1 -- ;\nAS x').ok).toBe(true)
    expect(checkReportSql('SELECT $q$ ; $q$ AS x').ok).toBe(true)
    expect(checkReportSql('SELECT $$;$$ AS x').ok).toBe(true)
    expect(checkReportSql('SELECT 1 AS "a;b"').ok).toBe(true)
    expect(checkReportSql("SELECT E'it\\'s;' AS x").ok).toBe(true)
  })

  test('a literal cannot smuggle a statement past the check', () => {
    // The quote closes before the semicolon, so the DROP is code.
    rejects("SELECT 'it''s'; DROP TABLE x", /single statement/)
    rejects('SELECT 1 /* /* nested */ ; */; DROP TABLE x', /single statement/)
  })

  test('rejects an unclosed quote or comment', () => {
    rejects("SELECT 'open", /not closed/)
    rejects('SELECT 1 /* open', /not closed/)
    rejects('SELECT $tag$ open', /not closed/)
    rejects('SELECT "open', /not closed/)
  })

  test('$1 is a parameter, not a dollar quote', () => {
    const check = checkReportSql('SELECT $1::date AS d, $2 AS n')
    expect(check.ok && check.placeholders).toEqual([1, 2])
  })

  test('placeholders inside literals do not count', () => {
    const check = checkReportSql("SELECT '$3' AS x, $1 AS y")
    expect(check.ok && check.placeholders).toEqual([1])
  })

  test('refuses set_config, however it is spelt', () => {
    rejects("SELECT set_config('role', 'postgres', false)", /set_config/)
    rejects(`SELECT "set_config"('role', 'postgres', false)`, /set_config/)
    rejects(`SELECT pg_catalog.SET_CONFIG('statement_timeout', '0', true)`, /set_config/)
    rejects(`SELECT U&"\\0073et_config"('role', 'x', false)`, /U& escapes/)
  })

  test('stripping keeps offsets aligned with the original', () => {
    const sql = 'SELECT \'x;y\' /* c */ AS "q" -- z\n, $$t$$'
    const stripped = stripLiterals(sql)
    expect(stripped).not.toBeNull()
    expect(stripped!.length).toBe(sql.length)
    expect(stripped).not.toContain(';')
  })
})

describe('checkPlaceholders', () => {
  test('every parameter must be used, and nothing beyond them', () => {
    expect(checkPlaceholders([1, 2], 2)).toBeNull()
    expect(checkPlaceholders([], 0)).toBeNull()
    expect(checkPlaceholders([1], 2)).toMatch(/does not use \$2/)
    expect(checkPlaceholders([1, 3], 2)).toMatch(/does not use \$2/)
    expect(checkPlaceholders([1, 2, 3], 2)).toMatch(/uses \$3 but the report has 2 parameters/)
    expect(checkPlaceholders([1], 0)).toMatch(/uses \$1 but the report has 0 parameters/)
  })
})
