/**
 * The reviewer test packet (BTB-508): can a supervisor reviewing a drafted
 * definition catch a semantic error before publishing it?
 *
 * Writes the 20 `REVIEWER_SET` definitions (ten correct, ten with a seeded
 * error) in a fixed shuffled order to `packet.md`, for the reviewer, and the
 * answers to `answer-key.md`, for whoever scores it. Give the reviewer only
 * the packet. No database or Claude call.
 *
 *   pnpm exec tsx scripts/report-benchmark/reviewer-packet.ts --out bench-out
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { QUESTIONS, REVIEWER_SET, type SeededDefinition } from './questions'

/** A fixed shuffle, so every reviewer sees the same order. */
export function shuffled<T>(items: readonly T[], seed = 508): T[] {
  const out = [...items]
  let a = seed >>> 0
  const next = () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0
    return a / 4294967296
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function buildPacket(set: readonly SeededDefinition[] = REVIEWER_SET): {
  packet: string
  answerKey: string
} {
  const order = shuffled(set)
  const packet = [
    '# Report review exercise',
    '',
    'Each item is a question and the SQL drafted to answer it over the reporting schema ' +
      '(see docs/reporting.md and the schema description in the Ask panel). Some are correct; ' +
      'some answer the question wrongly. For each, mark **publish** or **reject**, and for a ' +
      'rejection say what is wrong in one line. Do not run the queries. Note how long the whole ' +
      'packet takes.',
    '',
  ]
  const key = [
    '# Answer key (do not give to the reviewer)',
    '',
    '| Item | Question | Correct? | Seeded error |',
    '|---|---|---|---|',
  ]
  order.forEach((d, i) => {
    const question = QUESTIONS.find((q) => q.id === d.questionId)?.question ?? d.questionId
    packet.push(
      `## Item ${i + 1}`,
      '',
      `**Question:** ${question}`,
      '',
      '```sql',
      d.sql.trim(),
      '```',
      '',
      'Publish / Reject: ____  Why: ______________________________',
      '',
    )
    key.push(
      `| ${i + 1} | ${d.questionId} | ${d.seededError ? 'No' : 'Yes'} | ${d.seededError ?? ''} |`,
    )
  })
  key.push(
    '',
    'Score: errors caught (rejected for the right reason) out of 10, and correct definitions ' +
      'wrongly rejected out of 10.',
  )
  return { packet: packet.join('\n'), answerKey: key.join('\n') + '\n' }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: 'string', default: 'bench-out' } } })
  const { packet, answerKey } = buildPacket()
  await mkdir(values.out, { recursive: true })
  await writeFile(join(values.out, 'packet.md'), packet)
  await writeFile(join(values.out, 'answer-key.md'), answerKey)
  console.log(`Wrote ${join(values.out, 'packet.md')} and ${join(values.out, 'answer-key.md')}`)
}

if (process.argv[1]?.endsWith('reviewer-packet.ts')) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
