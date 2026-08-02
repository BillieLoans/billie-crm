/**
 * Guards CI against a silent zero-test `pnpm test:int` run passing green.
 *
 * Background: tests/utils/globalSetup.ts's dynamic `import()` of
 * src/payload.config.ts intermittently (~40% of local runs, root-caused to
 * an upstream Vite/vitest module-runner stall — see
 * .superpowers/sdd/2026-07-31-aria-live-announcements/ci-harness-report.md)
 * never settled, and with nothing else holding the event loop open, Node's
 * idle-exit detection quietly exited the whole process with code 0 before
 * any test file loaded. `.github/workflows/crm-ci.yml` had no floor on test
 * count, so a genuinely broken branch could merge with a green tick. That
 * root cause is now guarded against directly in globalSetup.ts, but this
 * check stays as defence in depth against *any* mechanism that produces a
 * clean exit with few or no tests (e.g. an `include` glob regression).
 *
 * `pnpm test:int` writes a JSON report (vitest-int-report.json, via
 * vitest's built-in `json` reporter) alongside its human-readable output.
 * Asserting a minimum test count against that structured report is more
 * durable than grepping the human-readable summary line.
 *
 * Floor of 2000: the suite currently runs ~2158 tests on main. 2000 leaves
 * ~7% headroom for normal churn (tests added/removed between deploys) while
 * still catching catastrophic loss — e.g. globalSetup dying before any file
 * loads, or the `include` glob in vitest.config.mts matching far fewer
 * files than expected.
 */
import { readFileSync } from 'node:fs'

const REPORT_PATH = process.argv[2] ?? './vitest-int-report.json'
const MIN_TESTS = Number(process.env.MIN_TEST_COUNT ?? 2000)

let raw
try {
  raw = readFileSync(REPORT_PATH, 'utf8')
} catch {
  console.error(
    `[check-test-count] No JSON report found at "${REPORT_PATH}".\n` +
      '  This usually means the vitest process exited before any test file was collected — ' +
      'a silent globalSetup failure rather than a normal test failure. Treating as a hard ' +
      'failure rather than letting the build pass with an unknown number of tests run.',
  )
  process.exit(1)
}

const report = JSON.parse(raw)
const total = report.numTotalTests ?? 0

if (total < MIN_TESTS) {
  console.error(
    `[check-test-count] Only ${total} tests ran (floor is ${MIN_TESTS}).\n` +
      '  The suite currently runs ~2158 tests on main — this large a drop almost certainly ' +
      'means the run aborted early or the test include glob regressed, not that ~2000 tests ' +
      'were legitimately deleted. Failing the build.',
  )
  process.exit(1)
}

console.log(`[check-test-count] ${total} tests ran (floor ${MIN_TESTS}) — OK.`)
