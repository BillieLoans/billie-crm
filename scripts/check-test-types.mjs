/**
 * Type-checks the test files against a ratcheting baseline (BTB-536).
 *
 * `pnpm typecheck` uses tsconfig.check.json, which excludes tests/**, so a type
 * error in a test file went uncaught: vitest strips types without checking
 * them. Turning the check on outright was not possible, because the test files
 * already held 119 errors across 23 files.
 *
 * So this runs `tsc -p tsconfig.tests.json`, counts the errors per file, and
 * compares that with scripts/test-types-baseline.json:
 *
 *   - a file with MORE errors than its baseline, or any error in a file that
 *     is not in the baseline, fails;
 *   - a file with FEWER errors than its baseline also fails, with the command
 *     to lower the baseline, so the allowance can only ever shrink;
 *   - otherwise it passes.
 *
 * Counts per file, not line numbers: they survive unrelated edits to the file.
 *
 *   node scripts/check-test-types.mjs            check against the baseline
 *   node scripts/check-test-types.mjs --update   rewrite the baseline from tsc
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_PATH = path.join(root, 'scripts/test-types-baseline.json')
const ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/

/** Run tsc over the test files and return its output, whatever its exit code. */
function runTsc() {
  try {
    return execFileSync(
      'pnpm',
      ['exec', 'tsc', '--noEmit', '--pretty', 'false', '-p', 'tsconfig.tests.json'],
      {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
  } catch (error) {
    // tsc exits non-zero when it reports errors; that output is what we want.
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`
    if (!output.trim()) throw error
    return output
  }
}

/** Parse tsc output into { file: [messages] }, with repo-relative POSIX paths. */
export function errorsByFile(output) {
  const byFile = {}
  let unparsed = 0
  for (const line of output.split('\n')) {
    const match = ERROR_LINE.exec(line.trim())
    if (!match) {
      if (/error TS\d+/.test(line)) unparsed += 1
      continue
    }
    const file = match[1].split(path.sep).join('/')
    ;(byFile[file] ??= []).push(`${file}(${match[2]},${match[3]}): ${match[4]} ${match[5]}`)
  }
  return { byFile, unparsed }
}

/** Compare current counts with the baseline. */
export function compare(counts, baseline) {
  const worse = []
  const better = []
  for (const file of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
    const now = counts[file] ?? 0
    const allowed = baseline[file] ?? 0
    if (now > allowed) worse.push({ file, now, allowed })
    else if (now < allowed) better.push({ file, now, allowed })
  }
  const byName = (a, b) => a.file.localeCompare(b.file)
  return { worse: worse.sort(byName), better: better.sort(byName) }
}

function main() {
  const update = process.argv.includes('--update')
  const { byFile, unparsed } = errorsByFile(runTsc())
  if (unparsed > 0) {
    // A config or global error has no file position. Never treat it as clean.
    console.error(`tsc reported ${unparsed} error(s) with no file position; fix those first.`)
    process.exit(1)
  }
  const counts = Object.fromEntries(
    Object.keys(byFile)
      .sort()
      .map((file) => [file, byFile[file].length]),
  )
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)

  if (update) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(counts, null, 2)}\n`)
    console.log(`Baseline written: ${total} error(s) in ${Object.keys(counts).length} file(s).`)
    return
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  const { worse, better } = compare(counts, baseline)

  if (worse.length > 0) {
    console.error('New type errors in test files:\n')
    for (const { file, now, allowed } of worse) {
      console.error(`  ${file}: ${now} error(s), baseline allows ${allowed}`)
      for (const message of byFile[file]) console.error(`    ${message}`)
    }
    console.error('\nFix them. The baseline only exists for errors that were already there.')
    process.exit(1)
  }
  if (better.length > 0) {
    console.error('Test files now have fewer type errors than the baseline allows:\n')
    for (const { file, now, allowed } of better) {
      console.error(`  ${file}: ${now} error(s), baseline allows ${allowed}`)
    }
    console.error('\nLower the baseline so they cannot come back:  pnpm typecheck:tests --update')
    process.exit(1)
  }
  console.log(`Test files type-check against the baseline (${total} known error(s) remain).`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
