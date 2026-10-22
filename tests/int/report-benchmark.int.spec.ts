/**
 * Integration coverage for the BTB-508 benchmark harness: the synthetic
 * TEST data seeds into the reporting schema, every reference query runs
 * through the runner as reporting_reader and returns rows, and every seeded
 * error in the reviewer set really changes the answer (a `.replace` that
 * silently misses would make the "wrong" definition identical to the right
 * one). The runner's scoring is checked with Claude mocked. TEST data only.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import { getDashboardPool } from '@/lib/dashboard-aggregates'
import { runReportSql } from '@/server/reporting/runner'
import { BUSINESS_RULES } from '@/server/reporting/schema-description'
import { reportingReaderPool } from '../utils/reportingReader'
import { clearBenchmark, seedBenchmark } from '../../scripts/report-benchmark/seed'
import { QUESTIONS, REVIEWER_SET } from '../../scripts/report-benchmark/questions'
import { resultsEquivalent } from '../../scripts/report-benchmark/compare'

const askClaude = vi.fn()
vi.mock('@/server/reporting/ask/claude', async () => {
  const actual = await vi.importActual<typeof import('@/server/reporting/ask/claude')>(
    '@/server/reporting/ask/claude',
  )
  return { ...actual, askClaude: (...args: unknown[]) => askClaude(...args) }
})

import { attempt, readRawDdl, summarise } from '../../scripts/report-benchmark/run'

let payload: Payload
let pool: Pool
let reader: Pool

beforeAll(async () => {
  payload = await getPayload({ config: await config })
  pool = getDashboardPool(payload) as unknown as Pool
  reader = await reportingReaderPool(pool)
  await seedBenchmark(pool)
}, 120_000)

afterAll(async () => {
  await clearBenchmark(pool)
  await reader?.end()
})

describe('benchmark question set', () => {
  it('has 40 uniquely numbered questions, at least one unanswerable', () => {
    expect(QUESTIONS).toHaveLength(40)
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(40)
    expect(QUESTIONS.some((q) => q.referenceSql === null)).toBe(true)
  })

  it.each(QUESTIONS.filter((q) => q.referenceSql !== null).map((q) => [q.id, q] as const))(
    '%s reference SQL runs as reporting_reader and returns rows',
    async (_id, question) => {
      const result = await runReportSql(question.referenceSql as string, [], { pool: reader })
      expect(result.rowCount).toBeGreaterThan(0)
    },
  )
})

describe('reviewer set', () => {
  it('mixes ten correct definitions with ten seeded errors', () => {
    expect(REVIEWER_SET).toHaveLength(20)
    expect(REVIEWER_SET.filter((d) => d.seededError === null)).toHaveLength(10)
  })

  it.each(
    REVIEWER_SET.filter((d) => d.seededError !== null).map(
      (d) => [d.questionId, d.seededError, d] as const,
    ),
  )('%s (%s) gives a different answer from the reference', async (questionId, _error, d) => {
    const reference = QUESTIONS.find((q) => q.id === questionId)?.referenceSql as string
    expect(d.sql).not.toBe(reference)
    const [right, wrong] = await Promise.all([
      runReportSql(reference, [], { pool: reader }),
      runReportSql(d.sql, [], { pool: reader }),
    ])
    expect(resultsEquivalent(right.rows, wrong.rows)).toBe(false)
  })
})

const USAGE = {
  model: 'claude-opus-5-5',
  effort: 'high' as const,
  promptVersion: 'ask-v1',
  schemaVersion: 'reporting-desc-v1',
  inputTokens: 100,
  outputTokens: 10,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  latencyMs: 1,
}

const draft = (sql: string, answerable = true) => ({
  status: 'ok' as const,
  usage: USAGE,
  output: {
    answerable,
    not_answerable_reason: answerable ? null : 'No ad spend in the schema',
    title: 'TEST benchmark draft',
    description: 'TEST',
    sql,
    parameters: [],
    chart: null,
    assumptions: [],
  },
})

describe('benchmark runner', () => {
  const question = (id: string) => QUESTIONS.find((q) => q.id === id)!
  const reference = async (id: string) =>
    (await runReportSql(question(id).referenceSql!, [], { pool: reader })).rows

  it('describes the schema as bare DDL, without descriptions or business rules', async () => {
    const ddl = await readRawDdl(pool)
    expect(ddl).toContain('CREATE VIEW decision (')
    expect(ddl).toContain('CREATE TABLE decision_event (')
    expect(ddl).toMatch(/FUNCTION sydney_date\(/)
    for (const rule of BUSINESS_RULES) expect(ddl).not.toContain(rule.slice(0, 40))
  })

  it('scores a correct H1 draft as equivalent', async () => {
    askClaude.mockReset().mockResolvedValueOnce(draft(question('Q01').referenceSql!))
    const a = await attempt('H1', question('Q01'), 1, await reference('Q01'), reader, '')
    expect(a).toMatchObject({ status: 'ok', executed: true, equivalent: true, silentWrong: false })
  })

  it('scores a seeded error in H0 as silent-wrong', async () => {
    const wrong = REVIEWER_SET.find((d) => d.questionId === 'Q24')!.sql
    askClaude.mockReset().mockResolvedValueOnce(draft(wrong))
    const a = await attempt('H0', question('Q24'), 1, await reference('Q24'), reader, 'H0 prompt')
    expect(a).toMatchObject({ executed: true, equivalent: false, silentWrong: true })
    expect(askClaude.mock.calls[0][1]).toMatchObject({
      systemPrompt: 'H0 prompt',
      schemaVersion: 'reporting-ddl-v1',
    })
  })

  it('gives an H1 draft with errors one revision', async () => {
    askClaude
      .mockReset()
      .mockResolvedValueOnce(draft('SELECT * FROM public.users'))
      .mockResolvedValueOnce(draft(question('Q01').referenceSql!))
    const a = await attempt('H1', question('Q01'), 1, await reference('Q01'), reader, '')
    expect(a).toMatchObject({ revised: true, executed: true, equivalent: true })
    expect(a.usage).toHaveLength(2)
    expect(askClaude.mock.calls[1][0].previous.issues.length).toBeGreaterThan(0)
  })

  it('credits saying an unanswerable question cannot be answered, and summarises', async () => {
    askClaude.mockReset().mockResolvedValueOnce(draft('SELECT 1 WHERE false', false))
    const a = await attempt('H1', question('Q40'), 1, null, reader, '')
    expect(a.correctlyUnanswerable).toBe(true)
    const summary = summarise([a], [question('Q40')])
    expect(summary).toContain('| H1 | 1 |')
    expect(summary).toContain('1/1')
    expect(summary).toContain('unreviewed drafts')
  })
})
