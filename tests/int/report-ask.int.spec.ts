/**
 * Integration coverage for the Ask Claude flow (BTB-508), with Claude
 * mocked: drafts are checked and previewed through the runner as
 * reporting_reader, every request is logged with its usage, hand-edited
 * SQL is re-checked without Claude, and saving creates an unpublished draft
 * with the user as author. TEST data only.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import { getDashboardPool } from '@/lib/dashboard-aggregates'
import { listReports } from '@/server/reporting/run-report'
import { reportingReaderPool } from '../utils/reportingReader'

const askClaude = vi.fn()
vi.mock('@/server/reporting/ask/claude', async () => {
  const actual = await vi.importActual<typeof import('@/server/reporting/ask/claude')>(
    '@/server/reporting/ask/claude',
  )
  return { ...actual, askClaude: (...args: unknown[]) => askClaude(...args) }
})

import {
  checkEditedDefinition,
  draftFromQuestion,
  loadOwnAsk,
  saveDraft,
} from '@/server/reporting/ask/draft'

let payload: Payload
let pool: Pool
let reader: Pool
const P = 'TEST-BTB508'
const users: Record<string, { id: string; role: string; collection: 'users' }> = {}

const USAGE = {
  model: 'claude-opus-5-5',
  effort: 'high' as const,
  promptVersion: 'ask-v1',
  schemaVersion: 'reporting-desc-v1',
  inputTokens: 5000,
  outputTokens: 700,
  cacheReadTokens: 4500,
  cacheWriteTokens: 0,
  latencyMs: 1234,
}

const GOOD = {
  answerable: true,
  not_answerable_reason: null,
  title: `${P} decisions by outcome`,
  plan: ['Count decisions since the date', 'Split by outcome'],
  assumptions: ['Counts each application once, by its latest decision'],
  description: 'TEST: decisions by outcome since a date.',
  category: 'credit' as const,
  sql: `SELECT d.decision, count(*) AS decided
          FROM decision AS d
         WHERE d.decided_on >= $1::date AND NOT d.mock_origin
           AND d.conversation_id LIKE '${P}%'
         GROUP BY 1 ORDER BY 1`,
  parameters: [
    {
      name: 'from',
      label: 'From',
      type: 'date' as const,
      required: true,
      default: '2001-01-01',
      options: null,
      help: null,
    },
  ],
  charts: [
    {
      type: 'bar-horizontal' as const,
      x: 'decision',
      series: [{ column: 'decided', label: 'Decided' }],
      stacked: false,
    },
  ],
  headline: [
    {
      column: 'decided',
      label: 'Decisions',
      value: 'sum' as const,
      numerator: null,
      denominator: null,
      better: 'neutral' as const,
    },
  ],
  columns: [],
}

async function cleanup() {
  await pool.query(`DELETE FROM reporting.decision_event WHERE conversation_id LIKE '${P}%'`)
  await pool.query(`DELETE FROM report_asks WHERE question LIKE '${P}%'`)
  await payload.delete({
    collection: 'report-definitions',
    where: { title: { like: P } },
    overrideAccess: true,
  })
  await pool.query(`DELETE FROM users WHERE email LIKE 'test-btb508-%'`)
}

beforeAll(async () => {
  payload = await getPayload({ config })
  pool = getDashboardPool(payload) as unknown as Pool
  reader = await reportingReaderPool(pool)
  await cleanup()
  for (const [suffix, decision] of [
    ['1', 'APPROVED'],
    ['2', 'DECLINED'],
    ['3', 'DECLINED'],
  ]) {
    await pool.query(
      `INSERT INTO reporting.decision_event (decision_key, conversation_id, decision, decided_at)
       VALUES ($1, $2, $3, '2001-04-02T03:00:00Z')`,
      [`${P}-${suffix}`, `${P}-C${suffix}`, decision],
    )
  }
  for (const role of ['supervisor', 'operations']) {
    const u = await payload.create({
      collection: 'users',
      data: {
        email: `test-btb508-${role}-${Date.now()}@billie.loans`,
        password: 'Test1234!',
        role: role as 'supervisor',
        firstName: 'Test',
        lastName: role,
      },
    })
    users[role] = { id: String(u.id), role, collection: 'users' }
  }
}, 60_000)

afterAll(async () => {
  await cleanup()
  await reader?.end()
})

beforeEach(() => {
  askClaude.mockReset().mockResolvedValue({ status: 'ok', output: GOOD, usage: USAGE })
})

async function lastAsk() {
  const asks = await payload.find({
    collection: 'report-asks',
    where: { question: { like: P } },
    sort: '-createdAt',
    limit: 1,
    overrideAccess: true,
  })
  return asks.docs[0]
}

describe('Ask Claude', () => {
  it('drafts, checks and previews a definition, and logs the request', async () => {
    const outcome = await draftFromQuestion(
      payload,
      users.supervisor,
      { question: `${P} how many decisions of each kind?` },
      { pool: reader },
    )
    expect(outcome.status).toBe('ok')
    expect(outcome.issues).toEqual([])
    expect(outcome.preview?.rows).toEqual([
      { decision: 'APPROVED', decided: 1 },
      { decision: 'DECLINED', decided: 2 },
    ])
    expect(outcome.assumptions).toEqual(GOOD.assumptions)
    expect(outcome.plan).toEqual(GOOD.plan)
    expect(outcome.definition).toMatchObject({
      category: 'credit',
      chart: [{ type: 'bar-horizontal', x: 'decision' }],
      headline: [{ column: 'decided', value: 'sum' }],
    })

    expect(await lastAsk()).toMatchObject({
      kind: 'ask',
      outcome: 'ok',
      model: 'claude-opus-5-5',
      promptVersion: 'ask-v1',
      inputTokens: 5000,
      outputTokens: 700,
      cacheReadTokens: 4500,
      latencyMs: 1234,
      errorCount: 0,
    })
  })

  it('reports an unanswerable question without running anything', async () => {
    askClaude.mockResolvedValue({
      status: 'ok',
      output: { ...GOOD, answerable: false, not_answerable_reason: 'No ad spend data' },
      usage: USAGE,
    })
    const outcome = await draftFromQuestion(
      payload,
      users.supervisor,
      { question: `${P} cost per funded customer?` },
      { pool: reader },
    )
    expect(outcome).toMatchObject({
      status: 'unanswerable',
      notAnswerableReason: 'No ad spend data',
    })
    expect(outcome.preview).toBeUndefined()
    expect(await lastAsk()).toMatchObject({ outcome: 'unanswerable' })
  })

  it('catches a draft that reads outside the reporting schema, statically and at run time', async () => {
    const outcome = await checkEditedDefinition(
      payload,
      users.supervisor,
      `${P} edited`,
      {
        title: `${P} sneaky`,
        description: '',
        sql: 'SELECT email FROM public.users WHERE $1::date IS NOT NULL',
        parameters: GOOD.parameters.map((p) => ({ ...p, default: p.default })),
        chart: null,
      },
      { pool: reader },
    )
    expect(outcome.issues.map((i) => i.code)).toContain('SCHEMA')
    expect(outcome.preview).toBeUndefined()

    // An unqualified name that is not in reporting fails at run time.
    const unqualified = await checkEditedDefinition(
      payload,
      users.supervisor,
      `${P} edited`,
      {
        title: `${P} sneaky`,
        description: '',
        sql: 'SELECT email FROM users WHERE $1::date IS NOT NULL',
        parameters: [{ name: 'from', label: 'From', type: 'date', default: '2001-01-01' }],
        chart: null,
      },
      { pool: reader },
    )
    expect(unqualified.issues).toContainEqual(
      expect.objectContaining({ level: 'error', code: 'RUN' }),
    )
    expect(await lastAsk()).toMatchObject({ kind: 'check', outcome: 'invalid' })
  })

  it('flags a rate outside [0, 1] in the preview', async () => {
    const outcome = await checkEditedDefinition(
      payload,
      users.supervisor,
      `${P} rate`,
      {
        title: `${P} rate`,
        description: '',
        sql: `SELECT 100.0 * count(*) FILTER (WHERE decision = 'DECLINED') / count(*) AS decline_rate
                FROM decision WHERE decided_on >= $1::date AND NOT mock_origin AND conversation_id LIKE '${P}%'`,
        parameters: [{ name: 'from', label: 'From', type: 'date', default: '2001-01-01' }],
        chart: null,
      },
      { pool: reader },
    )
    expect(outcome.issues).toContainEqual(expect.objectContaining({ code: 'RATE_RANGE' }))
  })

  it('saves a checked draft unpublished, authored by the user, and hidden from viewers', async () => {
    const outcome = await draftFromQuestion(
      payload,
      users.supervisor,
      { question: `${P} save me` },
      { pool: reader },
    )
    const saved = await saveDraft(
      payload,
      users.supervisor,
      outcome.definition!,
      {},
      { pool: reader },
    )
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    const doc = await payload.findByID({
      collection: 'report-definitions',
      id: saved.id,
      draft: true,
      depth: 0,
      overrideAccess: true,
    })
    expect(doc).toMatchObject({
      _status: 'draft',
      origin: 'ask',
      author: users.supervisor.id,
      roles: ['admin', 'supervisor'],
    })
    const viewerList = await listReports(payload, users.operations)
    expect(viewerList.find((r) => r.slug === saved.slug)).toBeUndefined()
    const authorList = await listReports(payload, users.supervisor)
    expect(authorList.find((r) => r.slug === saved.slug)).toMatchObject({ published: false })
  })

  it('refuses to save for someone who is not a report author', async () => {
    await expect(
      saveDraft(
        payload,
        users.operations,
        {
          title: `${P} not mine`,
          description: '',
          sql: GOOD.sql,
          parameters: [{ name: 'from', label: 'From', type: 'date', default: '2001-01-01' }],
          chart: null,
        },
        {},
        { pool: reader },
      ),
    ).rejects.toThrow()
  })

  it('does not save a definition that fails its checks, static or on its result', async () => {
    const broken = await saveDraft(
      payload,
      users.supervisor,
      {
        title: `${P} broken`,
        description: '',
        sql: 'DELETE FROM decision',
        parameters: [],
        chart: null,
      },
      {},
      { pool: reader },
    )
    expect(broken.ok).toBe(false)
    // Passes the static checks, but its rate is a percentage.
    const badRate = await saveDraft(
      payload,
      users.supervisor,
      {
        title: `${P} bad rate`,
        description: '',
        sql: `SELECT 100.0 AS decline_rate FROM decision WHERE decided_on >= $1::date AND NOT mock_origin LIMIT 1`,
        parameters: [{ name: 'from', label: 'From', type: 'date', default: '2001-01-01' }],
        chart: null,
      },
      {},
      { pool: reader },
    )
    expect(badRate).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ code: 'RATE_RANGE' })],
    })
  })

  it('does not let an author set author or origin through the API', async () => {
    const doc = await payload.create({
      collection: 'report-definitions',
      data: {
        title: `${P} forged`,
        slug: 'test-btb508-forged',
        sql: GOOD.sql,
        parameters: GOOD.parameters,
        roles: ['admin'],
        origin: 'ask',
        author: users.operations.id,
        _status: 'draft',
      } as never,
      draft: true,
      overrideAccess: false,
      user: users.supervisor as never,
    })
    expect(doc.origin).toBe('manual')
    const author = doc.author as { id: string } | string | null
    expect(typeof author === 'object' ? author?.id : author).toBe(users.supervisor.id)
  })

  it('streams the plan and the stages, and records the time to the first text', async () => {
    askClaude.mockImplementation(
      async (_req: unknown, options: { onText?: (t: string) => void }) => {
        options.onText?.('{"answerable":true,"not_answerable_reason":null,"title":"Decisions"')
        options.onText?.(
          '{"answerable":true,"not_answerable_reason":null,"title":"Decisions","plan":["Count them"],"assumptions":[],"description":"d","category":"credit","parameters":[],"sql":"SEL',
        )
        return { status: 'ok', output: GOOD, usage: { ...USAGE, firstOutputMs: 321 } }
      },
    )
    const events: unknown[] = []
    const outcome = await draftFromQuestion(
      payload,
      users.supervisor,
      { question: `${P} streamed` },
      { pool: reader },
      { onProgress: (e) => events.push(e) },
    )
    expect(outcome.status).toBe('ok')
    expect(events).toEqual([
      { type: 'stage', stage: 'planning', atMs: 0 },
      {
        type: 'partial',
        draft: { title: 'Decisions', plan: [], assumptions: [], writingSql: false },
      },
      {
        type: 'partial',
        draft: { title: 'Decisions', plan: ['Count them'], assumptions: [], writingSql: true },
      },
      { type: 'stage', stage: 'writing_sql', atMs: expect.any(Number) },
      { type: 'stage', stage: 'checking', atMs: expect.any(Number) },
    ])
    expect(await lastAsk()).toMatchObject({ firstOutputMs: 321, totalMs: expect.any(Number) })
  })

  it('logs a cancelled draft as cancelled', async () => {
    const abort = new AbortController()
    abort.abort()
    askClaude.mockRejectedValueOnce(
      Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' }),
    )
    await expect(
      draftFromQuestion(
        payload,
        users.supervisor,
        { question: `${P} cancelled` },
        { pool: reader },
        { signal: abort.signal },
      ),
    ).rejects.toThrow()
    expect(await lastAsk()).toMatchObject({ outcome: 'cancelled' })
  })

  it('refuses a headline or chart that reads a column the result does not have', async () => {
    const outcome = await checkEditedDefinition(
      payload,
      users.supervisor,
      `${P} headline`,
      {
        title: `${P} headline`,
        description: '',
        sql: GOOD.sql,
        parameters: [{ name: 'from', label: 'From', type: 'date', default: '2001-01-01' }],
        chart: [{ type: 'bar', x: 'decision', series: [{ column: 'missing' }] }],
        headline: [{ column: 'nope', label: 'Nope' }],
        columnSettings: [],
        category: 'credit',
      },
      { pool: reader },
    )
    expect(outcome.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['CHART', 'HEADLINE']))
    const saved = await saveDraft(
      payload,
      users.supervisor,
      outcome.definition!,
      {},
      { pool: reader },
    )
    expect(saved.ok).toBe(false)
  })

  it('publishes straight away to the chosen roles and area, and changes a report in place', async () => {
    const outcome = await draftFromQuestion(
      payload,
      users.supervisor,
      { question: `${P} publish me` },
      { pool: reader },
    )
    const published = await saveDraft(
      payload,
      users.supervisor,
      outcome.definition!,
      { publish: true, roles: ['admin', 'supervisor', 'operations'], category: 'operations' },
      { pool: reader },
    )
    if (!published.ok) throw new Error(JSON.stringify(published.issues))
    expect(published.published).toBe(true)
    const viewerList = await listReports(payload, users.operations)
    expect(viewerList.find((r) => r.slug === published.slug)).toMatchObject({
      published: true,
      category: 'operations',
    })

    // A change saved as a draft leaves the published version as it was.
    const changed = await saveDraft(
      payload,
      users.supervisor,
      { ...outcome.definition!, title: `${P} publish me, changed` },
      { reportId: published.id },
      { pool: reader },
    )
    expect(changed).toMatchObject({
      ok: true,
      id: published.id,
      slug: published.slug,
      published: false,
    })
    const live = (await listReports(payload, users.operations)).find(
      (r) => r.slug === published.slug,
    )
    expect(live?.title).toBe(`${P} decisions by outcome`)
    const authorView = (await listReports(payload, users.supervisor)).find(
      (r) => r.slug === published.slug,
    )
    expect(authorView?.draft?.title).toBe(`${P} publish me, changed`)
  })

  it('logs a request that failed at the API', async () => {
    askClaude.mockRejectedValueOnce(new Error('overloaded'))
    await expect(
      draftFromQuestion(payload, users.supervisor, { question: `${P} fails` }, { pool: reader }),
    ).rejects.toThrow('overloaded')
    expect(await lastAsk()).toMatchObject({ kind: 'ask', outcome: 'error', question: `${P} fails` })
  })
})

describe('reopening a draft by reference', () => {
  it('finds only the user’s own logged draft', async () => {
    const outcome = await draftFromQuestion(
      payload,
      users.operations,
      { question: `${P} mine` },
      { pool: reader },
    )
    expect(outcome.askId).toBeTruthy()
    const mine = await loadOwnAsk(payload, users.operations.id, outcome.askId!)
    expect(mine?.definition.sql).toBe(GOOD.sql)
    expect(await loadOwnAsk(payload, users.supervisor.id, outcome.askId!)).toBeNull()
  })
})
