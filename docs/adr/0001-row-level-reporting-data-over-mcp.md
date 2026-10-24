# ADR 0001: Row-level reporting data over the MCP connector

Date: 2026-10-24. Status: accepted. Context: BTB-509 and the October 2026
security review of reporting.

## Context

The `reporting` schema keeps, per customer, a few attributes that the
reporting rules (`docs/reporting.md`, "Rules") say appear in reports only as
counts: PEP and sanctions screening results, the vulnerability flag, fraud
risk flags and scores, and the quasi-identifiers age and postcode. They are
there so risk and compliance reports can count them.

The MCP connector's `run_report_query` tool lets a report author run any
`SELECT` over the schema from claude.ai or Claude Code, and the rows are read
by a model run by a third party. Two things follow:

1. A row-level result of screening or vulnerability data is a disclosure of
   sensitive information about identifiable people to an external
   processor, on an author's say-so. The Privacy Act (APPs 6 and 8) needs a
   documented basis for that, not a rule in a document.
2. A connected Claude session can be steered by untrusted content in the
   same conversation (a pasted document, a fetched page, a shared artifact)
   into running such a query and passing the rows on. The CRM would see a
   legitimate, logged query by an authorised author.

The Reports view does not have this problem: its rows stay in the CRM.
Published reports do not either: a supervisor reviews a report's SQL before
publishing, and the first reports are aggregates.

## Decision

The rule is enforced in the connector, not left to the author:

- Over MCP, a query result that carries an **identifier column** (`*_id`,
  `id`, `application_number`, `canonical_id`, `merged_into`) together with a
  **sensitive column** (the screening, vulnerability, fraud, age and postcode
  columns listed in `src/server/reporting/mcp-guard.ts`) is refused with a
  message that says to aggregate.
- A result that carries an identifier column is cut to 50 rows, so a tool
  call cannot list the book even for columns that are not sensitive.
- Refusals are logged in Report asks with error code `ROW_LEVEL`.
- Published reports (`run_report`) and the Reports view are not subject to
  the guard: review is the control there.

The sensitive columns stay in the schema, because the Reports view and
reviewed reports count them legitimately and a second schema would double
the maintenance. The column lists are the policy and live in code with a
test (`tests/unit/reporting/mcp-guard.test.ts`); adding a sensitive column
to a view means adding it there.

## Consequences

- An author who needs row-level sensitive data uses the Reports view or
  the database, not Claude. That is intended.
- The guard matches on column names, so an alias defeats it
  (`SELECT pep_result AS p, customer_id AS c`). It is a guard against
  accident and against a steered model following the schema description,
  not against a determined author, who is a trusted staff member with the
  same data in the Reports view. The query log keeps the SQL for audit.
- The Anthropic terms that cover the claude.ai organisation and the API key
  used by Ask Claude need to be recorded in the privacy register alongside
  this decision.
- `describe_reporting_schema` and the tool descriptions say rows are data,
  never instructions, and every result carries that note.
