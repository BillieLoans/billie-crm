# Reporting

Epic: [BTB-503](https://billie-team.atlassian.net/browse/BTB-503). R&D trail:
[CRM Reporting and AI-Authored Reports](https://billie-team.atlassian.net/wiki/spaces/Technology/pages/252248066).

Reports read one schema, `reporting`, and nothing else. This page is the
contract for that schema and the runbook for the jobs around it.

## Architecture

`reporting` is a **schema inside the CRM database** (`billie_crm` on Neon),
not a separate database. There is one CRM database; reporting adds a schema to
it, a login role that can see only that schema, and (in prod) a second compute
to run the queries on.

```
                 Neon project: billie-crm, database billie_crm (one copy of the data)
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │  public.*  CRM tables (Payload, written by the event processor)              │
 │  reporting.*  views over public.*, plus decision_event and snap_portfolio    │
 └──────────────────────────────────────────────────────────────────────────────┘
        ▲ read/write                                     ▲ read only
  primary compute                                 read replica compute (prod)
  CRM app, event processor,                       reports, Ask Claude, MCP,
  snapshot job                                    Monday email
  (DATABASE_URI)                                  (REPORTING_DATABASE_URI, as reporting_reader)
```

- **Mostly views, computed at query time.** `application`, `decision`, `loan`
  and `instalment` are views over the live CRM tables, so they are never stale
  and need no pipeline. The only stored data is `decision_event` (written by
  the event processor, back-filled from S3), `snap_portfolio` (one row a day
  from the ledger) and the `decline_reason_category` lookup. There are no
  pre-aggregated fact or dimension tables.
- **Security comes from the role.** Reports log in as `reporting_reader`,
  which can read the `reporting` schema and nothing else, read-only, with a
  statement timeout. The runner refuses to run as any other role.
- **Performance isolation comes from the read replica.** A Neon read replica
  is a second compute on the same storage: it sees the same data a few seconds
  behind and has its own CPU and memory, so a heavy report cannot slow the CRM
  for staff. The replica is not a copy of the data and costs only compute time
  while it is awake. Prod uses one; demo can point `REPORTING_DATABASE_URI` at
  the primary while load is light, since the role still gives the security
  boundary.
- **Writes go to the primary.** `decision_event` and `snap_portfolio` are
  written over the app's own connection (`getDashboardPool`), never the
  replica.
- **If it outgrows this:** materialized views for slow reports first; a
  separate warehouse only when reports need data from other services (ledger
  history, chat), which this schema does not try to hold.

## Rules

- The schema holds the CRM's data except the personal parts: ids, categories,
  amounts, scores, flags and dates. It never holds names, contact details, a
  date of birth (age in whole years instead), a street address or suburb
  (state and postcode instead), identity documents, bank account numbers or
  BSBs, IP addresses, ad click ids (`click_id_type` says which kind a visit
  carried), the loan purpose in the customer's words (`loan_purpose_category`
  instead, from `LOAN_PURPOSE_CATEGORIES` in `schema.ts`), free text (notes, comments, justifications, error messages) or
  conversation content. Staff appear as user ids, never names.
  JSON columns are read key by key, never copied whole, because most of them
  mix both kinds. Review any new column against this rule;
  `tests/int/reporting-schema-privacy.int.spec.ts` seeds personal details
  everywhere the CRM keeps them and fails if any view shows one.
- Sensitive flags (`vulnerable_flag`, PEP and sanctions results, fraud risk)
  are in the schema for risk and compliance reporting. Reports show them as
  counts, never per customer.
- Money figures of record come from the ledger. `snap_portfolio` copies them;
  no report sums balances to produce a figure of record.
- Business dates are Australia/Sydney. Every view has `*_on` date columns
  computed with `reporting.sydney_date()`.

## Schema (BTB-504)

Defined in `src/server/reporting/schema.ts`. Every statement is idempotent.

| Object | Kind | One row per | Source |
|---|---|---|---|
| `application` | view | conversation (an application attempt): funnel flags `submitted`, `decided`, `approved`, `funded`, `acquisition`; what was applied for (loan purpose category, amount, term); age at application; statement capture progress; identity, conduct, serviceability and fraud assessment outcomes; re-application block, kill and cancellation; LLM cost | `conversations`, `applications`, `customers`, `loan_accounts` |
| `decision` | view | conversation, its latest decision event | `decision_event` |
| `loan` | view | loan account, with the source of its application, repayment frequency, last payment and closure | `loan_accounts`, `application` |
| `instalment` | view | scheduled instalment | `loan_accounts_repayment_schedule_payments` |
| `customer` | view | customer: identity verification and screening, risk flags, fraud risk, re-application block, contact verification levels, age, state and postcode | `customers` |
| `collection_case` | view | collections case | `collection_cases` |
| `write_off` | view | write-off request, staff as user ids | `write_off_requests` |
| `block_clear_request` | view | request to clear a re-application block | `reapplication_block_clear_requests` |
| `notification` | view | notification event (no recipient or content) | `notifications` |
| `llm_cost` | view | LLM call | `llm_costs` |
| `contact_note` | view | staff contact note, its kind only (no subject or text) | `contact_notes` |
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
- `as_numeric(text)`, `as_boolean(text)`, `as_timestamptz(text)`: read a value
  from JSON, NULL when it is malformed (timestamps must be ISO), so one bad
  event cannot break a view. The views use them for every JSON value.
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

Not in the schema at all: the conversation transcript and extracted facts,
identity documents, the marketing CRM (contacts, interactions), staff users,
and the CRM's own configuration. Affordability figures (income, expenses,
surplus) are not in the CRM either: the credit agents write them to S3, and
their events carry only the decision.

### How the schema is applied

- Deployed environments: migrations, run by `make -C infra/fly deploy` as the
  owner role. `20261023_090000_reporting_schema` created the schema;
  `20261028_090000_reporting_all_data` re-applies it with the expanded views.
  A schema change ships the same way: change `schema.ts` and the description,
  then add a migration that re-runs `REPORTING_SCHEMA_STATEMENTS` (copy the
  latest one). The statements are idempotent and recreate every view.
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
write them in the report editor (`/admin/reports/new`, and "Edit report" on a
report: `/admin/reports/<slug>/edit`). Versions and history stay at
`/admin/collections/report-definitions`.

### Writing a report

The report editor has the SQL in a highlighting editor (CodeMirror, bundled
with the app; Ctrl/Cmd+Enter runs the preview) beside a live preview on the
defaults, and form builders for the parameters, charts, headline numbers and
column settings. "Publish…" first runs the same checks as a Claude draft
(below) and refuses on any error, then shows what changed against the
published version: the settings by name and a line diff of the SQL. A
change is written through Payload's REST API, so access and validation are
the collection's. In the Payload admin the same fields are plain text boxes
(its code editor loads from a CDN the admin's Content-Security-Policy
blocks).

- One `SELECT` or `WITH` statement. Unqualified names resolve in `reporting`.
- Parameter N is `$N`, in the order the parameters are listed. Every
  parameter must be used and nothing beyond them. Cast where Postgres cannot
  infer the type: `$1::date`.
- Parameters: `{name, label, type, required, default, options, help}`. Types
  `date`, `text`, `integer`, `number`, `select`, `boolean`. Date defaults are
  `today`, `today-N` or `YYYY-MM-DD`, resolved in Sydney when the report
  runs. A report whose parameters all have defaults runs as soon as it opens.
- Charts (optional, up to two): `{type, x, series: [{column, label}], stacked,
  sort, rollingAverage, drill}`. Types `line`, `area`, `bar`,
  `bar-horizontal` (ranked) and `stacked-100` (mix as shares). One y-axis; up
  to eight series, numeric columns only. Categories sort largest first unless
  `sort: "none"`; daily lines over three weeks get a 7-day average unless
  `rollingAverage: 0`; `drill: {report, parameter}` opens another report with
  the clicked category. An All/Total row is pinned below the table and drawn
  as a reference line, not a bar.
- Headline (optional, up to four): `{column, label, value, better}`, where
  `value` is `total` (the All/Total row, or the sum of a count), `sum`,
  `average`, `max`, `min`, `first`, `last` or `ratio` (with `numerator` and
  `denominator`). They lead the page with their change on the previous period
  and one or two sentences that read them, built in code from the result:
  nothing about the results goes to Claude.
- Column settings (optional): `{name, label, format, base, minBase,
  description, better}`. Without them a column's format follows its name
  (`*_rate` a 0–1 share, `*_pct` 0–100, money names in dollars, then hours and
  days). A rate with a `base` count is marked when the base is under `minBase`
  (20) and its tooltip gives a 95% interval.
- Area (`category`) places the report in the catalogue; `featured` puts its
  first headline number on the Reports home.
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
| prod | the Neon read replica, logged in as `reporting_reader` |
| demo | the read replica, or the primary while load is light, logged in as `reporting_reader` |
| dev | the local database, logged in as `reporting_reader` |
| test | the integration tests create the role and log in as it |

Setting up an environment (once per environment: demo, then prod). Use the
environment's **owner** connection for steps 1 and 5: `MIGRATE_DATABASE_URI`
in `infra/fly/env/.env.<env>` where it is set (prod: `neondb_owner`), else
`DATABASE_URI` (dev and demo, where `billie_crm` owns the database).

1. **Create the role on the primary, in SQL.** Do not create it in the Neon
   console: console-made roles join `neon_superuser`, which can read every
   table. Generate a URL-safe password (`openssl rand -hex 24`), then:

   ```sql
   CREATE ROLE reporting_reader LOGIN PASSWORD '<generated>';
   ALTER ROLE reporting_reader SET default_transaction_read_only = on;
   ALTER ROLE reporting_reader SET statement_timeout = '15s';
   ALTER ROLE reporting_reader SET search_path = reporting;
   ```

   `permission denied to alter role` on the `ALTER`s means the role was made
   some other way, usually in the console. Check
   `SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid WHERE m.member = 'reporting_reader'::regrole;`:
   if it lists `neon_superuser`, delete the role in the console (Roles), then
   run the four statements above in one SQL session. If the console refuses
   because of existing grants, revoke them first as the owner:
   `REVOKE ALL ON ALL TABLES IN SCHEMA reporting FROM reporting_reader; REVOKE USAGE ON SCHEMA reporting FROM reporting_reader;`.

2. **Add a read replica** (prod; optional on demo, skip it to use the
   primary) in the Neon console: the CRM project → Branches → the branch the
   environment's `DATABASE_URI` points at → Add read replica (a read-only
   compute on the same storage, so it sees the same roles and data seconds
   behind the primary). 0.25–1 CU with scale to zero is enough; it is billed
   as compute hours only while awake, and the first query after a suspend
   takes a moment longer.
3. **Build the connection string** from the replica's **direct** host (Connect
   → choose the read replica compute, or the primary if you skipped step 2;
   the host has no `-pooler`):
   `postgresql://reporting_reader:<pwd>@ep-<replica>.ap-southeast-2.aws.neon.tech/billie_crm?sslmode=verify-full`.
   Put it in `.env.<env>` as `REPORTING_DATABASE_URI` and run
   `make -C infra/fly secrets ENV=<env>`.
4. **Deploy.** The reporting migration grants the schema to
   `reporting_reader` when the role exists, so creating it first means there is
   nothing more to do.
5. **Only if the role was created after the reporting migration ran**, grant
   it by hand (owner connection, on the primary):

   ```sql
   GRANT USAGE ON SCHEMA reporting TO reporting_reader;
   GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO reporting_reader;
   ```

6. **Check it**, connected with `REPORTING_DATABASE_URI`:

   ```sql
   SELECT session_user, current_setting('default_transaction_read_only');  -- reporting_reader | on
   SELECT count(*) FROM reporting.decision;   -- a number
   SELECT count(*) FROM public.users;         -- ERROR: permission denied
   SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
    WHERE m.member = 'reporting_reader'::regrole;  -- no rows
   ```

   Then open any report under Reports in the CRM.

To change the password: `ALTER ROLE reporting_reader PASSWORD '<new>'` on the
primary, update `REPORTING_DATABASE_URI`, and run `make secrets` again.

Dev without Neon: create the role in the local database the same way and point
`REPORTING_DATABASE_URI` at it; restarting the app re-applies the grants.

## Finding reports

The Reports home (`/admin/reports`) leads with the headline number of each
featured report (on its default period, with its change and a sparkline;
`/api/reports/home`, cached for a minute across users, access checked per
person), then the person's pinned and recently opened reports, then every
report by area. Search matches titles, descriptions and areas; the sidebar
groups and filters the same list, and Cmd+K finds reports from anywhere in
the CRM. Pins are per person (`report-preferences`, up to 20). Searches,
downloads and copies are logged to `report-events` for the usage page.

A report's period, settings and comparison are kept in its link
(`?from=…&to=…&_compare=1`), so a view can be shared with "Copy link".
Changing a setting re-runs the report after 300 ms.

## First reports (BTB-507)

Delivered as data by the `20261026_100000_first_reports` migration, which
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

## Ask Claude (BTB-508)

Any staff member can open **Reports → Ask Claude for a report**
(`/admin/reports/ask`), describe a report in words, and get a draft
definition: title, plan, assumptions, description, SQL, parameters, charts,
headline and column settings. Published reports that already answer the
question are offered first, with no Claude call. The answer streams: the
stages, then the title and plan as Claude writes them, so the wait shows
progress; "Cancel" stops it and the call to Claude. A question uses high
effort and a change medium.

Staff who are not authors see the preview marked "Not reviewed", without the
SQL; they cannot save, have 20 questions a day and one draft in progress at a
time, and can check or change only a draft Claude gave them (by its logged
`askId`). Authors can also "Save and publish" in one step, after confirming
the area and who can run it. Claude is sent the
question and the schema description in
`src/server/reporting/schema-description.ts`, never result rows; a refinement
also sends the draft and what the checks found, with result values and
database errors replaced by fixed text (`issuesForClaude`). The panel asks
staff not to type customer names or contact details. The draft is then
checked, run on its defaults through the runner as `reporting_reader`, and
previewed. The author can ask for a change in words, or edit the SQL and
"Check the edited SQL" (no Claude call). "Save as a draft report" creates an
unpublished `report-definitions` draft with `origin: ask` and the author
recorded; a supervisor publishes it from its edit page as usual. Nothing
Claude writes runs anywhere but the runner, and nothing is published without
a person.

Checks (`src/server/reporting/ask/validate.ts`). Errors block saving, and the
save route runs every check again (including the run on the defaults), so the
browser cannot skip them:

| Code | Error when |
|---|---|
| `TITLE`, `DESCRIPTION`, `PARAMETERS`, `CHART` | the field is missing or invalid |
| `SQL`, `SCHEMA` | the SQL fails the runner's static check, or names a schema other than `reporting` |
| `PLACEHOLDERS` | `$n` placeholders and parameters do not match one to one |
| `RUN` | the query fails on its defaults |
| `RATE_RANGE` | a `*_rate` column falls outside 0–1 or a `*_pct` outside 0–100 |

Warnings are shown before saving: a parameter with no default (`NO_DEFAULT`),
filtering on a `*_at` timestamp instead of the Sydney `*_on` date
(`DATE_COLUMN`), reading `decision_event` (every revision) rather than
`decision` (`DECISION_EVENT`), no `mock_origin` filter where decisions,
applications or loans are read (`MOCK`), and an All/Total row that is not the
sum of the other rows (`TOTAL`).

Every request (ask, refine, check) is logged to **Report asks** (admin only):
user, question, outcome, model, effort, prompt and schema-description
versions, tokens, latency and the definition. A request that fails at the API
is logged too, with outcome `error`. The model call is in
`src/server/reporting/ask/claude.ts`: structured output against the
definition schema, the system prompt cached, server-side fallback on.
Change `ASK_PROMPT_VERSION` or `SCHEMA_DESCRIPTION_VERSION` whenever the
prompt or description changes, so logged results stay comparable. A call
times out after 85 seconds with no retry (`ASK_TIMEOUT_MS`), inside
Cloudflare's 100-second limit, so a slow draft fails visibly instead of being
paid for and never shown. A streamed call, which sends a heartbeat every 10
seconds, may run to 150 seconds (`ASK_STREAM_TIMEOUT_MS`). The log records
the time to the first output and to the finished draft, and cancellations.

Without `ANTHROPIC_API_KEY` the panel answers that Ask is not configured; the
rest of Reports is unaffected.

### When the schema changes

`schema-description.ts` must describe every view, table and column the
reporting schema has; `tests/int/reporting-schema-description.int.spec.ts`
fails when they drift. Describe what a column means and how to use it, not
just its type, and add business rules there rather than in the prompt.

### The benchmark

`scripts/report-benchmark/` holds the R&D experiment: 40 questions with
reference SQL, synthetic TEST data, a runner comparing raw DDL (H0) with the
annotated description plus checks (H1), and a reviewer packet. It costs
money to run and never runs in CI; see its README. The reference queries are
drafts until a second engineer reviews each.

## MCP connector (BTB-509)

`POST /api/mcp` is a Model Context Protocol server (Streamable HTTP) for
Claude Code, Claude chat and Claude artifacts, built on
`@payloadcms/plugin-mcp` and configured in `src/server/reporting/mcp.ts`. It
reaches the same governed path as the Reports view: report SQL only ever runs
through the runner as `reporting_reader`.

| Tool | Does |
|---|---|
| `list_reports` | Lists the published reports the key can run, with their parameters |
| `describe_reporting_schema` | Returns the schema description and business rules Ask Claude uses |
| `run_report_query` | Runs one SELECT through the runner, `$n` parameters bound, at most 1,000 rows (and 200,000 characters). The whole statement is logged in Report asks as `mcp_query` |
| `run_report` | Runs a published report by slug on its parameters, with the same caps. Logged in Report runs with trigger `mcp`. Dashboards use this, so they show reviewed, aggregate reports |
| `findReportDefinitions`, `createReportDefinitions` | The plugin's tools for `report-definitions`. Reads are always depth 0, so no user record reaches Claude. A new report is a draft with `origin: mcp` and the key's person as author |
| `update_report_draft` | Changes a report by id and saves a new draft version; the published report is unchanged until a supervisor publishes. Never overrides an editor's lock. (The plugin's own update tool is off: it takes a server file path that it reads before any hook runs) |

Every write over MCP is a draft (`mcpDraftsOnly` in `ReportDefinitions.ts`);
bulk updates and deletes are refused. Reports keep up to 500 versions, so
drafting does not push published versions out of the history. The tools use
their own pool of two reporting connections, so a busy agent cannot hold up
the Reports view or the scheduled jobs.

Keys:

- An admin creates one per person in **Reporting → MCP API keys**, for report
  authors (admin, supervisor) only. The key is generated on save and can be
  read on the key's page for 15 minutes: copy it to the person then. If it
  is lost, delete the key and create another. Delete a key to revoke it.
- The plugin's report tools (find, create) are off on a new key; tick the
  ones the person needs. The custom tools are on; untick any a key should
  not have (for example, a dashboard key needs only `run_report`).
- Every request re-checks that the key's person is still a report author.
  When someone stops being one, or is deleted, their keys are deleted
  (`mcp-keys.ts`), so promoting them again later does not revive an old
  key.
- Keys are not Payload logins. The plugin makes its key collection an auth
  collection; `restrictApiKeys` removes that, so a key works at `/api/mcp`
  and nowhere else. It is stored encrypted with `PAYLOAD_SECRET`, and found
  by an HMAC of it.

Over MCP, Claude sees query results. That is why only the `reporting` schema
is reachable and rows are capped. Ask for aggregates; never pull
customer-level rows you do not need.

Every key is rate-limited per server process: 120 requests a minute for a
personal key, 300 for a dashboard key, 120 per person over OAuth.

### Signing in with OAuth (claude.ai and Claude Code)

The usual way in. `/api/mcp` is also an OAuth 2.1 resource server and the
CRM its own authorization server (`src/server/reporting/mcp-oauth.ts`,
following the MCP authorization spec): a person adds the connector, signs in
to the CRM in the window Claude opens, and approves the connection. No key
changes hands.

- **What a connection can do** follows the person's CRM role on every
  request, not at sign-in: report authors (admin, supervisor) get every
  reporting tool; operations and read-only staff get `list_reports` and
  `run_report`, for the published reports their role may run. Marketing and
  service accounts cannot connect.
- **Discovery.** A request without a valid token gets a 401 whose
  `WWW-Authenticate` names `/.well-known/oauth-protected-resource/api/mcp`;
  that names the CRM as authorization server
  (`/.well-known/oauth-authorization-server`). Both are rewrites in
  `next.config.mjs` to `/api/oauth/*`.
- **Clients register themselves** at `/api/oauth/register`, but only for the
  claude.ai and claude.com callbacks, loopback addresses (Claude Code) and
  any exact URI in `MCP_OAUTH_REDIRECT_URIS` (comma-separated). Registering
  grants nothing.
- **Sign-in.** `/api/oauth/authorize` checks the request and hands it, signed,
  to the sign-in page `/oauth/authorize`, which goes through the CRM login
  (password or Google; both return to the page) and shows the app's name,
  where the person will be sent back to, the environment and what Claude will
  be able to do. PKCE (S256) is required; tokens are only issued for this
  CRM's `/api/mcp`.
- **Tokens** are opaque and stored as HMACs. Access tokens last an hour;
  refresh tokens rotate on every use and lapse after 30 days unused. A code
  used twice revokes the connection. So does the refresh token before the
  current one when it comes back more than a minute after it was rotated;
  within the minute (a retried refresh, two sessions refreshing at once) it is
  only refused. The access token a refresh replaced works until it expires.
  Deleting a registered client (admins, via the API) ends its connections.
- **Revoking.** Each approval is an MCP connection (Reporting → MCP
  connections, admins only). Delete one to cut it off at once. A person's
  connections are deleted when they are, or when they lose every staff role.

claude.ai, per person or for the organisation: Settings → Connectors → Add
custom connector, with the URL `https://<crm host>/api/mcp` and no OAuth
client id or secret (claude.ai registers itself). Name it after the
environment, since dashboards call the connector by name:
**Billie CRM reporting** for prod, **Billie CRM reporting Demo** for demo.
Turn on artifact connectors (Capabilities) to use it from dashboards.

Claude Code:

```bash
claude mcp add --transport http billie-reporting https://crm.billie.loans/api/mcp
# then /mcp in Claude Code to sign in
```

A personal key still works there, for scripts:

```bash
claude mcp add --transport http billie-reporting https://crm.billie.loans/api/mcp \
  --header "Authorization: Bearer $BILLIE_REPORTING_KEY"
```

### Dashboards

The first dashboard is `docs/dashboards/application-funnel.html`: the
application funnel by acquisition group and by source/medium, read live from
`run_report` on `application-funnel`. It holds no data: each viewer reads
through their own connector, so they need a CRM role that can run the report.
Two meta tags set the environment: `billie:connector` (the connector's name
in claude.ai) and `billie:environment` (a label such as `DEMO`, shown on the
page and in its title; empty for prod). Publish one copy per environment as
an artifact with the `mcp` capability for that connector and its
`run_report` tool, then share it with its viewers in the Claude
organisation. Publishing needs the connector added first.

### Dashboard keys (static header, without OAuth)

For a claude.ai organisation that has the static request header beta and
wants one shared connector instead of personal sign-ins. A request header is
one key shared by every member, so it is a **dashboard key**: read-only,
`list_reports` and `run_report` only, for the published reports an admin
ticks on the key. No ad-hoc SQL, no schema, no drafts; the sidebar switches
do not apply to it. Access then follows sharing in the Claude organisation,
not CRM roles, which is why only reviewed, aggregate reports go on the key.

1. In **Reporting → MCP API keys**, create a key with scope **Dashboard**,
   owner an admin or supervisor (accountable for it; the key goes when they
   stop being an author), and tick the reports it may run. Copy the key
   within 15 minutes.
2. A claude.ai organisation owner adds a custom connector with the request
   header `authorization` set to `Bearer <key>` and no sign-in.

To rotate the key, create a new dashboard key, update the connector's header
(remove and re-add the connector; members reconnect), then delete the old key.

## Report emails and alerts

On a published report, "Email me this…" sends it to the person daily, on
Monday mornings or on the 1st of the month, with the settings on screen and
a period (a preset such as "Last 7 days") that moves forward each time. The
email leads with the headline numbers, their change and the sentence that
reads them, then the first chart as an image and the data as a CSV. "Alert
me…" watches one number (a row, or the headline figure) and emails when it
goes above or below a threshold; it is checked each morning and sends only
when the condition starts to hold. Report authors can send either to the
shared Slack channel (`REPORTS_SLACK_WEBHOOK_URL`). People manage theirs at
**Your emails and alerts** (`/admin/reports/subscriptions`).

The deliveries job (`POST /api/reports/jobs/deliveries`,
`src/server/reporting/deliveries.ts`) runs each due subscription **as its
subscriber**, so someone who loses access to a report stops receiving it
(the page then says why). Each delivery first claims
`<subscription>:<day | month | alert:day>` in `report-deliveries` (unique),
so repeated calls send nothing; a failed run or send releases the claim for
the next call, and a claim left `sending` for 15 minutes by a call that died
is taken over. Subscribers to the same report and settings share one run and
one chart. A Resend 409 on the idempotency key counts as sent.

The chart is drawn as SVG (`src/server/reporting/chart-image.ts`) from the
same prepared data as the page's chart and rasterised with sharp; the
runtime images install `fontconfig` and `ttf-dejavu` so its text renders.

## Boards

A board (`/admin/reports/boards/<slug>`, collection `report-boards`) puts up
to twelve reports on one page with one period, for a team's regular review.
Each tile shows its report's headline numbers and first chart (or whichever
the report has) and links to the report on the same period. Staff see only
the tiles for reports they can run; a board with none is not found for them,
and the raw collection is readable by authors only. Authors make boards at
`/admin/reports/boards`, put a report on one from its page ("Add to board",
keeping its settings but not its period), and reorder, change or remove
tiles. A change is written only if the board is still the version it was
read at, in one conditional `UPDATE`, so an editor open on an old copy is
asked to reload rather than undoing someone else's change. Tile runs are
logged with trigger `board`.

## Usage

Authors see how Reports is used at `/admin/reports/usage`
(`src/server/reporting/usage.ts`, aggregates over the last 30 days): people
and reads in each of the last eight Sydney weeks; each report's reads,
people, CSV downloads per read, people it is emailed to and last open;
published reports nobody opened; Ask Claude's median and 95th percentile
time to first output and to a finished draft, and the share of answered
questions saved as reports; and searches with no report opened within ten
minutes, grouped by what was typed.

A read is a run from a report page or a board that succeeded: not a
scheduled email, an author's draft, or the previous-period run made for a
comparison (`report-runs.comparison`). A search is the last query a person
typed before a two-minute pause, so "chu", "churn" counts once. Saves are
recorded by the save route, not the browser, and a report saved twice
counts once.

## Scheduling

`.github/workflows/scheduled-reports.yml` calls the jobs. GitHub cron is UTC
and can run late or not at all, so each job fires more than once and the CRM
makes repeats harmless:

- Weekly email, prod only on schedule: three runs on Monday morning, each
  with `?notBeforeSydneyHour=8`. A call sends only on a Sydney Monday at or
  after 08:00, so a late run still sends, and the claim stops the others.
- Report emails and alerts, prod only on schedule: three runs each morning,
  each with `?notBeforeSydneyHour=7`. Each delivery is claimed once (above).
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
| `RESEND_API_KEY` | Monday email, report emails and alerts | Resend API key; the job refuses to run without it |
| `RESEND_FROM_ADDRESS` | Monday email | Defaults to `noreply@billie.loans`, the verified sender platform-services uses |
| `NEXT_PUBLIC_APP_URL` | Monday email | Already set for Payload; used for the report link |
| `REPORTS_EMAIL_LABEL` | Monday email, report emails | `DEMO` on demo; unset on prod |
| `REPORTS_SLACK_WEBHOOK_URL` | report emails and alerts | Slack incoming webhook for the shared channel; unset = Slack not offered |
| `REPORTING_DATABASE_URI` | report runner | Logged in as `reporting_reader`; the Neon read replica in deployed environments. Required everywhere |
| `ANTHROPIC_API_KEY` | Ask Claude | Fly secret on the CRM app; Ask is unavailable without it |
