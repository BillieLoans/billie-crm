# ADR 0002: Restricted reporting columns over the MCP connector

Date: 2026-10-28. Status: proposed (needs sign-off from the privacy register
owner). Supersedes: ADR 0001. Context: BTB-509, the reporting connector live
in prod since 28 October 2026.

## Context

ADR 0001 guards ad-hoc query results over MCP (`run_report_query`) by column
name: an identifier column beside a sensitive one is refused, and any result
with an identifier is cut to 50 rows (`src/server/reporting/mcp-guard.ts`).
Using the connector in prod showed three problems with that.

1. **It does not hold.** It inspects the result, not the query. A sensitive
   column used anywhere but the select list passes untouched:
   `SELECT conversation_id FROM application WHERE pep_hit` returns only an
   identifier and is a list of PEP matches. So do `ORDER BY fraud_score`, a
   join on a sensitive column, and a query re-run with a parameter that
   narrows to one person. An alias (`pep_result AS p`) defeats it outright;
   ADR 0001 accepted that, but not the filter case, which is the same leak
   without even renaming anything.
2. **It restricts the wrong things.** Identifiers are what staff need to act
   on an analysis: open the application, contact the customer, review the
   account. The schema description told authors never to select
   `customer_id` or `application_number`, while the guard allowed both, so
   the two disagreed and the description won in practice. Age and postcode
   are weak quasi-identifiers at Billie's volume and matter mostly next to
   the flags below.
3. **A restriction that blocks the logged path pushes people to an unlogged
   one.** If Claude cannot hand over an application number, staff export a
   CSV and paste it into Claude: the same disclosure, with less control and
   no query log.

The threat that justifies a hard control is narrow. A connected Claude
session can be steered by untrusted content in the conversation (a pasted
document, a fetched page) and usually also holds tools that write outside
the CRM (cloud drives, email, published pages). The harm that matters is a
steered session producing **a list of named people tied to a finding about
them**: that they are a politically exposed person, on a sanctions list,
flagged vulnerable, or suspected of fraud. For a regulated lender that is a
serious incident. A leak of "conversation X asked for $200 for car repairs"
is not of the same order.

Everything in the reporting schema is personal information under the
Privacy Act, identifiers included: a `customer_id` identifies a person
inside Billie. This ADR does not say otherwise. It says which disclosures to
Anthropic, as processor, the connector permits by role and log (most of the
schema), and which it prevents outright (the restricted columns below). The
schema already leaves out names, contact details, date of birth and street
address.

## Decision

### Restricted columns, enforced by the database

The connector runs ad-hoc queries as a separate Postgres **login** role,
`reporting_mcp_reader`, with its own connection string
(`REPORTING_MCP_DATABASE_URI`). The runner already relies on the login role
as the control (no `SET ROLE`), so a second login role, not a `SET ROLE`
inside the existing one, keeps that property.

The role is granted `SELECT` on each reporting view **column by column**,
never on the whole view, and is never granted the restricted columns.
Postgres checks column privileges wherever a column is referenced (select
list, `WHERE`, `JOIN`, `ORDER BY`, `GROUP BY`, function arguments), so no
form of query can read them.

Restricted columns are those that state, or directly reveal, one of the four
findings:

| Finding | Columns |
|---|---|
| Politically exposed person, sanctions | `application.pep_hit`; `customer.pep_result`, `sanctions_result`, `screening_outcome` |
| Vulnerability | `customer.vulnerable_flag` |
| Fraud | `application.fraud_score`, `fraud_severity`, `fraud_categories`, `fraud_peak_score`, `fraud_peak_severity`, `fraud_flagged_turns`, `fraud_would_halt`; `customer.fraud_risk_active`, `fraud_risk_severity`, `fraud_risk_score`, `fraud_risk_categories`, `fraud_risk_flagged_at` |
| Columns that reveal the above by value | `application.kill_reason`, `killed_by` (`fraud_abuse`, `system:fraudRiskAgent`); `application.block_reason`, `block_disposition`, `customer.block_reason` (a block can be for fraud) |

The last row is the part most easily missed: a column is restricted if one
of its values discloses a finding, even when most of its values do not.
`fraud_turns_assessed` (how many messages were assessed) is open; it says
nothing about the result.

**Fail closed.** Every column in the reporting schema is classified in code
as open or restricted, and the schema build fails on a column with no
classification. A new view column is therefore never readable over MCP
until someone has decided which it is. Grants are re-applied from that
classification whenever the schema is rebuilt, because recreating a view
drops its column grants.

### Counts of restricted findings: aggregate views

Counting restricted findings is legitimate and was needed in the first real
analysis over the connector (share of declines with a PEP hit or a fraud
score). A small set of aggregate views exposes them as counts only, for
example screening and fraud-severity counts by Sydney day, acquisition and
decision outcome. The views read the restricted columns with their owner's
privileges; `reporting_mcp_reader` can read the views, not the columns
behind them. A count below 5 is shown as suppressed, so a narrow filter
cannot single out one person. The views fix the grouping, so nobody can
group by an identifier.

### Everything else: open, with the existing limits

- All identifiers (`customer_id`, `application_number`, `conversation_id`,
  `loan_account_id` and the rest), age, postcode, state and every other
  open column can be read over MCP.
- A result carrying an identifier column is still cut to 50 rows, so a tool
  call cannot list the book. The cap stays name-based; an alias gets around
  it, and the query log is the control for that, as in ADR 0001.
- The schema description given to MCP clients lists only what
  `reporting_mcp_reader` can read, plus the aggregate views, and drops the
  "never select identifiers" rule.

### Acting on a restricted finding: published reports, in the CRM

A worklist of people by restricted finding (a PEP review queue, accounts
flagged for fraud) is a published report: a supervisor reviews its SQL once
and staff run it in the Reports view, where the rows stay in the CRM beside
the actions. Over MCP, Claude can report the count and name the report to
run.

`run_report` over MCP runs published reports as the existing
`reporting_reader`, unguarded, because review is the control there. A report
that selects a restricted column is therefore marked not runnable over MCP
by default; a supervisor can allow it when publishing.

### The name-based guard

`mcp-guard.ts` keeps its identifier-plus-sensitive check, narrowed to the
restricted columns, only to return a clear "aggregate instead" message before
Postgres's "permission denied". It is no longer the control.

## Consequences

- A new login role and connection string per environment, created in Neon
  like `reporting_reader` (see the runbook in `docs/reporting.md`), and a
  second pool in the runner for MCP queries.
- The column classification is maintained by hand when views change. That is
  the price of failing closed, and the schema build makes it impossible to
  forget.
- Ad-hoc analysis over MCP can no longer filter, sort or join on a restricted
  column, even to produce an aggregate the aggregate views do not cover. Such
  a question becomes a new aggregate view or a published report.
- Age, postcode and identifiers become readable over MCP where ADR 0001
  refused them beside sensitive columns. That is a deliberate widening and
  is the main thing the privacy register owner is signing off.
- Tests run against the test Postgres (`tests/utils/globalSetup.ts`):
  for each restricted column, `reporting_mcp_reader` gets a permission
  error whether the column is selected, filtered, joined, grouped or
  sorted on; the aggregate views suppress small counts; and the build fails
  on an unclassified column.
- The Anthropic terms covering the claude.ai organisation still need
  recording in the privacy register, as ADR 0001 noted.
