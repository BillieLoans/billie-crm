/**
 * The AI-authored reports benchmark (BTB-508): does the annotated schema
 * description plus the validator (H1) beat raw DDL (H0)?
 *
 * For each arm, each question and each run it asks Claude for a definition,
 * runs the generated SQL on its defaults and the reference SQL through the
 * report runner as `reporting_reader`, and compares the results with
 * `compare.ts`. Every attempt is written to `attempts.jsonl` with its model,
 * effort, prompt and schema versions and tokens; `summary.md` holds the
 * metrics against the ticket's targets.
 *
 * - H0: the Ask prompt with the schema as raw DDL read from the catalog
 *   (column names and types, function signatures; no descriptions or
 *   business rules), and no validator: the first draft is final.
 * - H1: the live Ask prompt (annotated description), then the validator;
 *   a draft with errors gets one revision, as the Ask panel offers.
 *
 * Both arms are scored the same way. The checks are run on H0's drafts too,
 * for scoring only (H0 never sees them), so "silent-wrong" means the same
 * in both: ran, wrong, and the checks raised nothing.
 *
 * It costs money (about 40 questions × runs × arms Claude calls), so it
 * never runs in CI. Run it on a Neon branch seeded by `seed.ts`:
 *
 *   BENCH_DATABASE_URI=postgresql://owner@…/branch \
 *   BENCH_READER_URI=postgresql://reporting_reader@…/branch \
 *   ANTHROPIC_API_KEY=… \
 *   pnpm exec tsx scripts/report-benchmark/run.ts --runs 3 --out bench-out
 *
 * `--settings` compares model and effort settings for H1, with latency
 * beside accuracy, to choose the fastest setting that keeps the targets:
 *
 *   … run.ts --arms H1 --settings opus:high,opus:medium,opus:low,sonnet:medium
 *
 * `--dry-run` prints the plan and both prompts' sizes without calling Claude.
 */
import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { Pool } from 'pg'
import { bindParameters } from '@/lib/schemas/reports'
import { ReportRunError, runReportSql, type ReportRunResult } from '@/server/reporting/runner'
import {
  ASK_EFFORT,
  ASK_MODEL,
  ASK_PROMPT_VERSION,
  type AskEffort,
  ASK_SYSTEM_PROMPT,
  askClaude,
  buildSystemPrompt,
  toDraftDefinition,
  type AskUsage,
} from '@/server/reporting/ask/claude'
import { checkAndPreview } from '@/server/reporting/ask/draft'
import {
  validateResult,
  validateStatic,
  type DraftDefinition,
  type ValidationIssue,
} from '@/server/reporting/ask/validate'
import { SCHEMA_DESCRIPTION_VERSION } from '@/server/reporting/schema-description'
import { resultsEquivalent } from './compare'
import { QUESTIONS, type BenchmarkQuestion } from './questions'

type Arm = 'H0' | 'H1'
type Row = Record<string, unknown>

/** A model and effort to run H1 with. */
export interface Setting {
  label: string
  model: string
  effort: AskEffort
}

const MODELS: Record<string, string> = {
  opus: ASK_MODEL,
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
}

/** `opus:high,sonnet:medium` → settings. The default is the live setting. */
export function parseSettings(text: string | undefined): Setting[] {
  if (!text) return [{ label: `live (${ASK_EFFORT})`, model: ASK_MODEL, effort: ASK_EFFORT }]
  return text.split(',').map((part) => {
    const [name, effort] = part.trim().split(':')
    const model = MODELS[name] ?? name
    if (effort !== 'low' && effort !== 'medium' && effort !== 'high') {
      throw new Error(`--settings: "${part}" needs an effort of low, medium or high`)
    }
    return { label: part.trim(), model, effort }
  })
}

/** The value below which a share p of the sorted values fall. */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]
}

const H0_SCHEMA_VERSION = 'reporting-ddl-v1'

/** The targets in BTB-508, for H1. */
export const TARGETS = { executionSuccess: 0.98, equivalent: 0.9, silentWrong: 0.02 }

export interface Attempt {
  arm: Arm
  /** The model and effort, for H1 runs that compare settings. */
  setting: string
  questionId: string
  run: number
  /** What Claude returned. */
  status: 'ok' | 'unanswerable' | 'refused' | 'invalid_output' | 'api_error'
  /** For an answerable question: did the final SQL run on its defaults? */
  executed: boolean
  /** Ran, and its result matches the reference. */
  equivalent: boolean
  /** The checks raised an error or warning (in H0, scored but not shown to Claude). */
  flagged: boolean
  /** Ran, wrong, and not flagged: the case a reviewer would have to catch. */
  silentWrong: boolean
  /** For the unanswerable question(s): did Claude say so? */
  correctlyUnanswerable: boolean | null
  revised: boolean
  issues: ValidationIssue[]
  runError?: string
  definition?: DraftDefinition
  usage: AskUsage[]
}

/**
 * The reporting schema as raw DDL: what a model would see with no
 * annotations. Read from the catalog, so it matches the database.
 */
export async function readRawDdl(db: Pick<Pool, 'query'>): Promise<string> {
  const { rows: columns } = await db.query<{
    table_name: string
    table_type: string
    column_name: string
    data_type: string
  }>(
    `SELECT c.table_name, t.table_type, c.column_name,
            format_type(a.atttypid, a.atttypmod) AS data_type
       FROM information_schema.columns AS c
       JOIN information_schema.tables AS t USING (table_schema, table_name)
       JOIN pg_attribute AS a
         ON a.attrelid = format('%I.%I', c.table_schema, c.table_name)::regclass
        AND a.attname = c.column_name
      WHERE c.table_schema = 'reporting'
      ORDER BY c.table_name, c.ordinal_position`,
  )
  const { rows: functions } = await db.query<{ signature: string; returns: string }>(
    `SELECT format('%I(%s)', p.proname, pg_get_function_arguments(p.oid)) AS signature,
            pg_get_function_result(p.oid) AS returns
       FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'reporting'
      ORDER BY 1`,
  )
  const byTable = new Map<string, { type: string; cols: string[] }>()
  for (const c of columns) {
    const entry = byTable.get(c.table_name) ?? { type: c.table_type, cols: [] }
    entry.cols.push(`  ${c.column_name} ${c.data_type}`)
    byTable.set(c.table_name, entry)
  }
  const parts = ['Schema: reporting', '']
  for (const [name, { type, cols }] of byTable) {
    parts.push(`CREATE ${type === 'VIEW' ? 'VIEW' : 'TABLE'} ${name} (\n${cols.join(',\n')}\n);`)
  }
  for (const f of functions) parts.push(`FUNCTION ${f.signature} RETURNS ${f.returns};`)
  return parts.join('\n')
}

async function runDefinition(
  definition: DraftDefinition,
  reader: Pool,
): Promise<{ result?: ReportRunResult; error?: string }> {
  const bound = bindParameters(definition.parameters as never, {})
  if (!bound.ok) return { error: `parameters: ${JSON.stringify(bound.errors)}` }
  try {
    return { result: await runReportSql(definition.sql, bound.values, { pool: reader }) }
  } catch (error) {
    return {
      error: error instanceof ReportRunError ? `${error.code}: ${error.message}` : String(error),
    }
  }
}

/** One attempt at one question in one arm. */
export async function attempt(
  arm: Arm,
  question: BenchmarkQuestion,
  run: number,
  reference: Row[] | null,
  reader: Pool,
  h0Prompt: string,
  setting: Setting = parseSettings(undefined)[0],
): Promise<Attempt> {
  const base = {
    arm,
    setting: arm === 'H0' ? 'live' : setting.label,
    questionId: question.id,
    run,
    executed: false,
    equivalent: false,
    flagged: false,
    silentWrong: false,
    revised: false,
    issues: [] as ValidationIssue[],
    usage: [] as AskUsage[],
  }
  const ask = (request: Parameters<typeof askClaude>[0]) =>
    arm === 'H0'
      ? askClaude(request, {
          systemPrompt: h0Prompt,
          promptVersion: `${ASK_PROMPT_VERSION}+ddl`,
          schemaVersion: H0_SCHEMA_VERSION,
        })
      : askClaude(request, { model: setting.model, effort: setting.effort })

  let answer
  try {
    answer = await ask({ question: question.question })
  } catch (error) {
    return { ...base, status: 'api_error', correctlyUnanswerable: null, runError: String(error) }
  }
  base.usage.push(answer.usage)
  const unanswerable = question.referenceSql === null
  if (answer.status !== 'ok') {
    return { ...base, status: answer.status, correctlyUnanswerable: unanswerable ? false : null }
  }
  if (!answer.output.answerable) {
    return { ...base, status: 'unanswerable', correctlyUnanswerable: unanswerable ? true : null }
  }
  if (unanswerable) return { ...base, status: 'ok', correctlyUnanswerable: false }

  let definition = toDraftDefinition(answer.output)
  let issues: ValidationIssue[] = []
  let result: ReportRunResult | undefined
  let runError: string | undefined

  if (arm === 'H1') {
    let checked = await checkAndPreview(definition, { pool: reader })
    if (checked.issues.some((i) => i.level === 'error')) {
      base.revised = true
      try {
        const revision = await ask({
          question: question.question,
          previous: {
            definition,
            refinement: 'Fix the problems found when checking it.',
            issues: checked.issues,
          },
        })
        base.usage.push(revision.usage)
        if (revision.status === 'ok' && revision.output.answerable) {
          definition = toDraftDefinition(revision.output)
          checked = await checkAndPreview(definition, { pool: reader })
        }
      } catch {
        // Keep the first draft's outcome.
      }
    }
    issues = checked.issues
    result = checked.preview
    runError = issues.find((i) => i.code === 'RUN')?.message
  } else {
    ;({ result, error: runError } = await runDefinition(definition, reader))
    // Scored only: H0 has no validator and is never revised.
    issues = [
      ...validateStatic(definition).issues,
      ...(result ? validateResult(result.columns, result.rows) : []),
    ]
  }

  const executed = result !== undefined
  const equivalent = executed && reference !== null && resultsEquivalent(reference, result!.rows)
  const flagged = issues.length > 0
  return {
    ...base,
    status: 'ok',
    executed,
    equivalent,
    flagged,
    silentWrong: executed && !equivalent && !flagged,
    correctlyUnanswerable: null,
    issues,
    runError,
    definition,
  }
}

const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`)

/** Metrics per arm as a Markdown report. */
export function summarise(attempts: Attempt[], questions: readonly BenchmarkQuestion[]): string {
  const answerable = new Set(questions.filter((q) => q.referenceSql !== null).map((q) => q.id))
  const lines = [
    '# AI-authored reports benchmark',
    '',
    `Live setting: ${ASK_MODEL}, effort ${ASK_EFFORT}. Questions: ${questions.length} (${answerable.size} answerable).`,
    `H1 targets: execution ≥ ${TARGETS.executionSuccess * 100}%, equivalent ≥ ${TARGETS.equivalent * 100}%, silent-wrong ≤ ${TARGETS.silentWrong * 100}%.`,
    '',
    '| Arm | Setting | Attempts | Executed | Equivalent | Silent-wrong | Revised | Unanswerable caught | False refusals | Draft p50 | Draft p95 | Input tokens | Output tokens |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ]
  const groups = [...new Set(attempts.map((a) => `${a.arm}|${a.setting}`))].sort()
  for (const group of groups) {
    const [arm, setting] = group.split('|')
    const mine = attempts.filter((a) => a.arm === arm && a.setting === setting)
    const scored = mine.filter((a) => answerable.has(a.questionId))
    const unanswerable = mine.filter((a) => !answerable.has(a.questionId))
    const tokens = (k: 'inputTokens' | 'outputTokens') =>
      mine.flatMap((a) => a.usage).reduce((s, u) => s + u[k], 0)
    // The first draft's latency: what the person waits for before a preview.
    const latencies = mine.map((a) => a.usage[0]?.latencyMs).filter((v): v is number => v != null)
    const seconds = (v: number | null) => (v === null ? 'n/a' : `${(v / 1000).toFixed(1)}s`)
    lines.push(
      `| ${arm} | ${setting} | ${mine.length} | ${pct(scored.filter((a) => a.executed).length, scored.length)} | ` +
        `${pct(scored.filter((a) => a.equivalent).length, scored.length)} | ` +
        `${pct(scored.filter((a) => a.silentWrong).length, scored.length)} | ` +
        `${scored.filter((a) => a.revised).length} | ` +
        `${unanswerable.filter((a) => a.correctlyUnanswerable).length}/${unanswerable.length} | ` +
        `${scored.filter((a) => a.status === 'unanswerable').length} | ` +
        `${seconds(percentile(latencies, 0.5))} | ${seconds(percentile(latencies, 0.95))} | ` +
        `${tokens('inputTokens')} | ${tokens('outputTokens')} |`,
    )
  }
  lines.push(
    '',
    '## Per question (equivalent runs / runs)',
    '',
    '| Question | H0 | H1 |',
    '|---|---|---|',
  )
  for (const q of questions) {
    const cell = (arm: Arm) => {
      const mine = attempts.filter((a) => a.arm === arm && a.questionId === q.id)
      if (!mine.length) return '–'
      const ok =
        q.referenceSql === null
          ? mine.filter((a) => a.correctlyUnanswerable).length
          : mine.filter((a) => a.equivalent).length
      return `${ok}/${mine.length}`
    }
    lines.push(`| ${q.id} | ${cell('H0')} | ${cell('H1')} |`)
  }
  const unreviewed = questions.filter((q) => !q.reviewed).length
  if (unreviewed) {
    lines.push(
      '',
      `**${unreviewed} of ${questions.length} reference queries are unreviewed drafts.** ` +
        'Per the R&D protocol these results do not count until a second engineer has reviewed each.',
    )
  }
  return lines.join('\n') + '\n'
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      arms: { type: 'string', default: 'H0,H1' },
      runs: { type: 'string', default: '3' },
      questions: { type: 'string' },
      out: { type: 'string', default: 'bench-out' },
      concurrency: { type: 'string', default: '4' },
      settings: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  const arms = values.arms.split(',').map((a) => a.trim()) as Arm[]
  if (arms.some((a) => a !== 'H0' && a !== 'H1')) throw new Error('--arms takes H0, H1 or both')
  const runs = Number(values.runs)
  const settings = parseSettings(values.settings)
  const wanted = values.questions?.split(',').map((s) => s.trim())
  const questions = wanted ? QUESTIONS.filter((q) => wanted.includes(q.id)) : QUESTIONS

  const ownerUri = process.env.BENCH_DATABASE_URI
  const readerUri = process.env.BENCH_READER_URI
  if (!ownerUri || !readerUri) {
    throw new Error(
      'Set BENCH_DATABASE_URI (owner, for the catalog) and BENCH_READER_URI (reporting_reader)',
    )
  }
  const owner = new Pool({ connectionString: ownerUri, max: 1 })
  const reader = new Pool({ connectionString: readerUri, max: Number(values.concurrency) })
  try {
    const ddl = await readRawDdl(owner)
    const h0Prompt = buildSystemPrompt(ddl)
    const calls =
      questions.length * runs * arms.reduce((n, a) => n + (a === 'H1' ? settings.length : 1), 0)
    console.log(
      `${questions.length} questions × ${runs} runs × ${arms.join('+')} = ${calls} Claude calls ` +
        `(plus up to one revision each in H1). Prompts: H0 ${h0Prompt.length} chars, H1 ${ASK_SYSTEM_PROMPT.length} chars.`,
    )
    if (values['dry-run']) return

    const references = new Map<string, Row[] | null>()
    for (const q of questions) {
      references.set(
        q.id,
        q.referenceSql ? (await runReportSql(q.referenceSql, [], { pool: reader })).rows : null,
      )
    }

    await mkdir(values.out, { recursive: true })
    const log = join(values.out, 'attempts.jsonl')
    await writeFile(log, '')
    const jobs = arms.flatMap((arm) =>
      (arm === 'H1' ? settings : settings.slice(0, 1)).flatMap((setting) =>
        questions.flatMap((q) =>
          Array.from({ length: runs }, (_, run) => ({ arm, setting, q, run: run + 1 })),
        ),
      ),
    )
    const attempts: Attempt[] = []
    let next = 0
    const worker = async () => {
      while (next < jobs.length) {
        const { arm, setting, q, run } = jobs[next++]
        const a = await attempt(
          arm,
          q,
          run,
          references.get(q.id) ?? null,
          reader,
          h0Prompt,
          setting,
        )
        attempts.push(a)
        await appendFile(
          log,
          JSON.stringify({
            ...a,
            schemaVersion: arm === 'H0' ? H0_SCHEMA_VERSION : SCHEMA_DESCRIPTION_VERSION,
          }) + '\n',
        )
        console.log(`${arm} ${a.setting} ${q.id} #${run}: ${a.status}${a.equivalent ? ' ✓' : ''}`)
      }
    }
    await Promise.all(Array.from({ length: Number(values.concurrency) }, worker))
    await writeFile(join(values.out, 'summary.md'), summarise(attempts, questions))
    console.log(`Wrote ${log} and ${join(values.out, 'summary.md')}`)
  } finally {
    await owner.end()
    await reader.end()
  }
}

if (process.argv[1]?.endsWith('run.ts')) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
