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
| `application` | view | conversation (an application attempt), with funnel flags `submitted`, `decided`, `approved`, `funded` and `acquisition` | `conversations`, `loan_accounts` |
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
  marketing feed. The `channel` columns use it as is.
- The `acquisition` columns are `channel`, except that a conversation from
  before attribution capture (6 October 2026) reads `not recorded` rather than
  `direct`. Reports group by `acquisition`. `referral` means the visitor came
  from another website, not the referral programme.
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
`x-origin-secret` header, which Cloudflare adds. `.github/workflows/scheduled-reports.yml`
calls it nightly for the Sydney day just ended (see Scheduling below).

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

## First reports (BTB-507)

Delivered as data by the `20261025_100000_first_reports` migration, which
publishes each one whose slug is free. After that, authors own them in the
admin. The definitions are in `src/server/reporting/definitions/first-reports.ts`
and are checked against TEST data in `tests/int/first-reports.int.spec.ts`.

| Report | Slug | Roles | For |
|---|---|---|---|
| Decline rate and reasons | `decline-rate` | admin, supervisor | BTB-462: by source or ruleset version, with reason categories and a total. Emailed Monday |
| Application funnel by source | `application-funnel` | admin, supervisor, operations | BTB-500's split in the CRM: started, submitted, decided, approved, funded |
| Go-to-market numbers | `gtm-numbers` | admin, supervisor | BTB-460: share of starts, pass rate, funded rate, median hours to money, repayment health, with an All sources row |

"Submitted" means bank statements were shared, or the application was decided
(a block-decline is decided without statements). Declines with no recorded
reason count as "other". Mock decisions, and loans from them, are excluded from
all three. Not answerable yet, and listed in the GTM report rather than
approximated: referral-programme share (applications are not linked to
referring contacts), cash cost per funded customer (needs ad spend) and place
turnover (needs queue data).

## Monday email (BTB-507)

`POST /api/reports/jobs/scheduled?schedule=weekly_monday` runs every published
report whose schedule is "Weekly, Monday morning" on its parameter defaults
(so each parameter needs one) and sends one email to all supervisors: a
summary, a link to the report and the CSV attached (not attached above 5 MB).

At most once per report per Sydney day. Before running, a delivery claims its
day by inserting a `sending` run with `scheduledFor`, which is unique with the
report slug; a concurrent or repeated call finds the claim and sends nothing.
A failed run or send releases the claim, so the next call retries. The email
also carries a Resend idempotency key. If a process dies mid-send, the run
stays `sending` and holds the day: delete that run in Report runs to let the
day send again.

Email goes through `src/server/email/staff-email.ts`, which calls Resend
directly (`RESEND_API_KEY`), the provider platform-services already uses. It is
not Payload's email adapter on purpose: configuring one would also make
Payload's forgot-password email live for staff accounts. The notification
dispatcher could not be used: it emails customers by customer id and has no
attachments. Without the key the job refuses to run.

Set `REPORTS_EMAIL_LABEL=DEMO` on demo so its emails say `[DEMO]` in the
subject and are not mistaken for production figures.

## Scheduling

`.github/workflows/scheduled-reports.yml` calls both jobs. GitHub cron is UTC
and can run late or not at all, so each job fires more than once and the CRM
makes repeats harmless:

- Weekly email, prod only on schedule: three runs on Monday morning, each
  with `?notBeforeSydneyHour=8`. A call sends only on a Sydney Monday at or
  after 08:00, so a late run still sends, and the claim stops the others.
- Portfolio snapshot, demo and prod: two runs between midnight and 03:00
  Sydney, each with `?asOfDate=` the Sydney day just ended. The snapshot is an
  upsert, so the second run rewrites the same row.

"Run workflow" in GitHub runs either job now for demo or prod; a manual email
run ignores the Monday 08:00 rule but still sends at most once a day.

Repository secrets (an environment is skipped while its URL is unset):

| Secret | Value |
|---|---|
| `CRM_URL_DEMO`, `CRM_URL_PROD` | e.g. `https://crm.billie.loans` |
| `REPORTING_JOB_TOKEN_DEMO`, `_PROD` | the app's `REPORTING_JOB_TOKEN` |

Cloudflare adds the `x-origin-secret` header to requests itself, so the
workflow does not hold `CF_SECRET`.

## Environment

| Variable | Used by | Notes |
|---|---|---|
| `REPORTING_JOB_TOKEN` | scheduled jobs | Long random string, Fly secret |
| `RESEND_API_KEY` | Monday email | Resend API key; the job refuses to run without it |
| `RESEND_FROM_ADDRESS` | Monday email | Defaults to `noreply@billie.loans`, the verified sender platform-services uses |
| `NEXT_PUBLIC_APP_URL` | Monday email | Already set for Payload; used for the report link |
| `REPORTS_EMAIL_LABEL` | Monday email | `DEMO` on demo; unset on prod |
| `REPORTING_DATABASE_URI` | report runner | Logged in as `reporting_reader`; the Neon read replica in deployed environments. Required everywhere |
