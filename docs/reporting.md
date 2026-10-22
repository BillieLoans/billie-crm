# Reporting

Epic: [BTB-503](https://billie-team.atlassian.net/browse/BTB-503). R&D trail:
[CRM Reporting and AI-Authored Reports](https://billie-team.atlassian.net/wiki/spaces/Technology/pages/252248066).

Reports read one schema, `reporting`, and nothing else. This page is the
contract for that schema and the runbook for the jobs around it.

## Rules

- The schema holds ids, categories, amounts and dates. It never holds names,
  contact details, addresses, free text or conversation content. Review any new
  column against this rule.
- Money figures of record come from the ledger. `snap_portfolio` copies them;
  no report sums balances to produce a figure of record.
- Business dates are Australia/Sydney. Every view has `*_on` date columns
  computed with `reporting.sydney_date()`.

## Schema (BTB-504)

Defined in `src/server/reporting/schema.ts`. Every statement is idempotent.

| Object | Kind | One row per | Source |
|---|---|---|---|
| `application` | view | conversation (an application attempt) | `conversations`, `loan_accounts` |
| `decision` | view | conversation, its latest decision event | `decision_event` |
| `loan` | view | loan account, with the source of its application | `loan_accounts`, `application` |
| `instalment` | view | scheduled instalment | `loan_accounts_repayment_schedule_payments` |
| `decision_event` | table | `final_credit_decision` event, revisions included | event processor, S3 back-fill |
| `snap_portfolio` | table | Sydney business day | ledger `GetPortfolioSummary` |
| `decline_reason_category` | table | reason-code prefix | seeded from BTB-462 comment 11579 |

Functions:

- `sydney_date(timestamptz)`: the Sydney calendar date of an instant.
- `acquisition_channel(attribution jsonb)`: `paid`, `organic`, `llm`, `social`,
  `referral`, `email`, `sms`, `other` or `direct`. Same rules as the BTB-500
  marketing feed.
- `decline_category(reason text)`: `capacity`, `character`, `identity`,
  `eligibility` or `other`, by longest matching prefix in
  `decline_reason_category`. Unmapped reasons are `other`. Change the mapping by
  editing the seed in `schema.ts`; it applies to history because categories are
  computed on read.

Why views over the projection and not fact tables written from events: the
projection already encodes the domain rules (a loan counts as disbursed on the
`pending_disbursement` to `active` transition, terminal statuses are sticky,
schedule rows upsert on `(_parent_id, payment_number)`). Re-deriving facts from
raw events would duplicate those rules. The views also carry the full history
of the CRM, which the S3 archive does not. The schema still isolates reports
from Payload: when a Payload column changes, the view definition changes and
report SQL does not.

`decision_event` is the exception because the conversation row keeps only the
latest decision and has no decision time.

### How the schema is applied

- Deployed environments: the `20261023_090000_reporting_schema` migration,
  run by `make -C infra/fly deploy` as the owner role.
- Dev and test: Payload uses `push`, which ignores this schema and cannot
  alter a column a view depends on. A `beforeSchemaInit` hook in
  `payload.config.ts` drops the views before the push, and the `onInit` hook
  applies the whole schema again after it. Both are skipped when
  `NODE_ENV=production`.

### Changing a column a view uses

Postgres refuses to alter or drop a column a view depends on. A migration that
does so must `DROP VIEW` the dependent views first and run
`REPORTING_SCHEMA_STATEMENTS` again at the end, as the reporting migration does.
In dev and test the hooks above handle it.

### Roles and grants

The schema script grants itself to every role that can already insert into
`public.conversations`, so the runtime role gets access without its name being
in the repo. That role can read the schema and write `decision_event` and
`snap_portfolio`.

`reporting_reader` is the read-only role the report runner uses (BTB-506). It
can read the `reporting` views and tables and nothing in `public`. Create it
once per environment as the owner role, then re-run the migration or the grant
block:

```sql
CREATE ROLE reporting_reader LOGIN PASSWORD '<generated>';
ALTER ROLE reporting_reader SET default_transaction_read_only = on;
ALTER ROLE reporting_reader SET statement_timeout = '15s';
ALTER ROLE reporting_reader SET search_path = reporting;
```

## Decision events (BTB-504, BTB-505)

`handle_final_decision` appends every `final_credit_decision` to
`reporting.decision_event`, keyed by the producer `event_id` (the live inbox
copy and the archived chatLedger copy share it), so redeliveries and back-fills
write nothing new. It stores the outcome, reason code, retry flag,
`ruleset_version`, `build_sha`, `mock_origin` and the BTB-484
`assessment_record_location` when present. `decided_at` is the producer's
stamp (BTB-505); events from before the stamp use the archived stream time in
the back-fill and the processing time live. A failed reporting write is logged
and does not fail the projection update; the back-fill recovers the row.

The conversation row also gets `decision_detail_ruleset_version`, shown as
"Credit ruleset …" on the decision banner. A payload carrying a null ruleset
(a mock approval) clears it; a payload without the key leaves it alone.

### Back-fill from the S3 archive

```bash
aws s3 sync s3://billie-events-prod-<account>/chatLedger/ ./chatLedger --profile billie-prod
# from event-processor/, with PYTHONPATH=src
python3 -m billie_servicing.scripts.backfill_decision_events --source ./chatLedger
python3 -m billie_servicing.scripts.backfill_decision_events --source ./chatLedger --apply
```

The dry run prints how many decisions it found and the earliest one. Record
that date: it is where reporting history for decision events starts. The script
writes only to `decision_event`, never to the projection, and is safe to re-run.

## Portfolio snapshot (BTB-504)

`POST /api/reports/jobs/portfolio-snapshot` copies the ledger's
`GetPortfolioSummary` into `snap_portfolio`. Amounts are stored from the
ledger's decimal strings. A re-run for the same day replaces that day's row.
`?asOfDate=YYYY-MM-DD` re-takes a past day.

It authenticates with `Authorization: Bearer $REPORTING_JOB_TOKEN`; with no
token configured every call is refused. Calls through Cloudflare also need the
`x-origin-secret` header like any other request. Schedule it daily at 23:50
Australia/Sydney.

## Reports (BTB-506)

A report is a document in the `report-definitions` collection, not code:
SQL over the `reporting` schema, a parameter list, an optional chart and the
roles that may run it. Publishing a new version changes the report with no
deploy. Staff run reports at `/admin/reports`; authors (admin, supervisor)
edit them at `/admin/collections/report-definitions`.

### Writing a report

- One `SELECT` or `WITH` statement. Unqualified names resolve in `reporting`.
- Parameter N is `$N`, in the order the parameters are listed. Every
  parameter must be used and nothing beyond them. Cast where Postgres cannot
  infer the type: `$1::date`.
- Parameters: `{name, label, type, required, default, options, help}`. Types
  `date`, `text`, `integer`, `number`, `select`, `boolean`. Date defaults are
  `today`, `today-N` or `YYYY-MM-DD`, resolved in Sydney when the report
  runs. A report whose parameters all have defaults runs as soon as it opens.
- Chart (optional): `{type: line | bar | area, x, series: [{column, label}],
  stacked}`. One y-axis; up to eight series; series must be numeric columns.
- Save as a draft and try it in the Reports view (see Drafts below), then
  publish. Viewers only ever run the published version.

### The runner

`src/server/reporting/runner.ts` is the only path a report query takes. Each
run:

1. passes `sql-guard.ts`, a single SELECT or WITH statement. This check gives
   authors a clear message; it is not the control;
2. checks it is logged in as `reporting_reader` and refuses any other login.
   That role is the control: it can read the `reporting` schema and nothing
   else, so no SQL trick (dynamic SQL, `set_config`, `RESET ROLE`) has a
   stronger role to return to;
3. opens a `READ ONLY` transaction with `statement_timeout` 15 s and
   `search_path` `reporting`;
4. sends the query with the extended protocol, so Postgres refuses a second
   statement, and binds parameters, never interpolating them;
5. wraps the SQL as `SELECT * FROM (…) LIMIT 50001`, which caps the rows at
   50,000 (the view says when it cut) and makes a data-modifying CTE an
   error;
6. rolls back.

Every run, refused and not-found ones included, is logged to `report-runs`:
report, published version id (or `draft`), user, outcome, duration, rows and
the report's declared parameters as bound (text cut to 100 characters). Only
admins can read the log; nobody can change it through the API. Database
error text is shown to authors only. Report SQL and drafts are readable by
authors only, versions included.

### Drafts

Authors (admin, supervisor) see draft-only reports in the list, marked
"(draft)", and can run them. For a published report with a newer draft,
"Run the latest draft" switches the form and chart to the draft's, so a
changed parameter list can be tried before it is published.

### Connection

The runner connects with `REPORTING_DATABASE_URI` in every environment and
answers "Reporting is not configured" without it.

| Environment | `REPORTING_DATABASE_URI` |
|---|---|
| prod, demo | the Neon read replica, logged in as `reporting_reader` |
| dev | the local database, logged in as `reporting_reader` |
| test | the integration tests create the role and log in as it |

Setting up an environment (once, as the owner role):

1. Deployed environments: in Neon, add a read replica (read-only compute) to
   the CRM project.
2. Create `reporting_reader` with a generated password (see "Roles and
   grants" above), then re-run the reporting migration's grant block. In dev,
   restarting the app re-applies the grants.
3. Set `REPORTING_DATABASE_URI=postgresql://reporting_reader:…@<host>/<db>`
   (`?sslmode=verify-full` for Neon): a Fly secret on the CRM app, or `.env`
   in dev.

## Environment

| Variable | Used by | Notes |
|---|---|---|
| `REPORTING_JOB_TOKEN` | scheduled jobs | Long random string, Fly secret |
| `REPORTING_DATABASE_URI` | report runner | Logged in as `reporting_reader`; the Neon read replica in deployed environments. Required everywhere |
