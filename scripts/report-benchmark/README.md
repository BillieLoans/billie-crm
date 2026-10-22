# AI-authored reports benchmark (BTB-508)

Hypothesis: describing the reporting schema to Claude with annotations and
business rules, and checking each draft, gets correct report definitions far
more often than raw DDL. R&D trail: [CRM Reporting and AI-Authored
Reports](https://billie-team.atlassian.net/wiki/spaces/Technology/pages/252248066).

| File                 | What it is                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `questions.ts`       | 40 questions (BTB-460, BTB-462, PRD, staff) with reference SQL; the 20-item reviewer set                               |
| `seed.ts`            | Deterministic synthetic TEST data, Sep–Oct 2026, with the traps (DST, revisions, duplicates, mocks, attribution start) |
| `compare.ts`         | Result equivalence: same rows, values matched at 2 dp, column names and extra columns ignored                          |
| `run.ts`             | The experiment: H0 (raw DDL, no checks) against H1 (annotated description, checks, one revision)                       |
| `reviewer-packet.ts` | The supervisor review test: packet and separate answer key                                                             |

`tests/int/report-benchmark.int.spec.ts` seeds the data in the test database,
runs every reference query as `reporting_reader`, proves every seeded error
changes the answer, and checks the scoring with Claude mocked. That runs in
CI; the experiment does not.

## Before results count

The reference SQL was drafted with Claude Code. Per the R&D protocol, each
query needs an author and a second-engineer review: check it against the
question and the seeded data, then set `author`, `reviewer` and
`reviewed: true` in `questions.ts`. `summary.md` says how many are
unreviewed.

## Running it

It calls Claude about 240 times for 3 runs of both arms (more with H1
revisions), so it costs money. Use a Neon branch, never production:

1. Create a branch of the CRM demo project with no data, and run the Payload
   migrations on it (or a local database with `push`).
2. Create `reporting_reader` with a password (see `docs/reporting.md`,
   "Roles and grants"), then re-run the reporting migration's grant block:
   the role must exist when the grants are applied, or every query fails
   with PERMISSION.
3. Seed it. The seeder refuses a database holding any non-TEST conversation
   or loan, and replaces the branch's portfolio snapshots for September and
   October 2026.

   ```bash
   BENCH_DATABASE_URI=postgresql://owner:…@…/branch pnpm exec tsx scripts/report-benchmark/seed.ts
   ```

4. Check the plan without spending anything, then run:

   ```bash
   export BENCH_DATABASE_URI=postgresql://owner:…@…/branch
   export BENCH_READER_URI=postgresql://reporting_reader:…@…/branch
   export ANTHROPIC_API_KEY=…
   pnpm exec tsx scripts/report-benchmark/run.ts --dry-run
   pnpm exec tsx scripts/report-benchmark/run.ts --runs 3 --out bench-out
   ```

   `--arms H1`, `--questions Q01,Q02` and `--concurrency` narrow a run.

5. Make the reviewer packet and give a supervisor `packet.md` only:

   ```bash
   pnpm exec tsx scripts/report-benchmark/reviewer-packet.ts --out bench-out
   ```

`bench-out/` is git-ignored. Attach `summary.md` and `attempts.jsonl` to the
Confluence page with the model, effort and prompt and schema versions they
record.

## Metrics

Over the answerable questions, per arm:

- **Executed**: the final SQL ran on its defaults. H1 target ≥ 98%.
- **Equivalent**: it ran and its result matches the reference (see
  `compare.ts`). H1 target ≥ 90%.
- **Silent-wrong**: it ran, its result is wrong, and the checks raised no
  error or warning. The dangerous case. H1 target ≤ 2%. The checks are run
  on H0's drafts for scoring only (H0 never sees them), so the measure is
  the same in both arms.

Also reported: unanswerable questions correctly declined, false refusals,
revisions and tokens.
