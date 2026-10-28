/**
 * The `reporting` schema (BTB-504): the contract every report reads.
 *
 * Reports never read Payload's tables directly. They read this schema, which
 * holds:
 *
 *   - Views over the CRM projection (`application`, `loan`, `instalment`,
 *     `decision`). The projection already encodes the domain rules (when a
 *     loan counts as disbursed, terminal statuses, schedule upserts), so the
 *     views reuse them rather than re-deriving facts from raw events. They
 *     carry the full history of the CRM. When a Payload column changes, the
 *     view definition here changes with it and report SQL does not.
 *   - `decision_event`: append-only, one row per `final_credit_decision`
 *     event. Written by the event processor and back-filled from the S3
 *     archive. It keeps every decision, including revisions that the
 *     conversation row overwrites, with the ruleset that made it (BTB-505).
 *   - `snap_portfolio`: the ledger's own portfolio figures, one row per
 *     Sydney business day. Money of record is copied from the ledger, never
 *     recomputed.
 *   - `decline_reason_category`: reason-code prefix to the five BTB-462
 *     categories, read through `decline_category()` so a mapping change
 *     applies to history.
 *   - `restricted_finding_summary`, `customer_risk_summary`: counts of the
 *     restricted findings (PEP, sanctions, vulnerability, fraud), with small
 *     counts hidden, for the MCP connector's role (ADR 0002).
 *   - `credit_rule`: credit rule id to its family and a short label, read
 *     through `decline_reason_label()` so a decline can be reported by the
 *     rule that failed (for example "Data quality gate G4"), not only by the
 *     component that declined. The rule ids come from billieChat's
 *     `credit_assessment_*_result` events (`failed_rules`).
 *
 * Rule: ids, categories, amounts and dates only. No names, contact details,
 * addresses, free text or conversation content.
 *
 * Applied by the `reporting_schema` migration in deployed environments and by
 * `applyReportingSchema` at init where Payload uses `push` (dev, test). Every
 * statement is idempotent. Views are dropped and recreated so a definition
 * can change shape; grants are re-applied at the end.
 *
 * Note for future migrations: Postgres refuses to alter a column a view
 * depends on. A migration that changes a column used below must drop the
 * dependent view first and re-run `REPORTING_SCHEMA_SQL` afterwards.
 */

import { MCP_READER_ROLE } from './runner'
import { REPORTING_TABLES, isRestrictedColumn } from './schema-description'

/**
 * Re-application block reasons that read `IDENTITY` for the MCP connector's
 * login (ADR 0002): a PEP block must not be told apart from the others.
 */
const IDENTITY_BLOCK_REASONS = ['PEP', 'ID_VERIFICATION', 'IDENTITY_CONFLICT'] as const

/** Counts of a restricted finding below this read NULL in the summary views. */
export const SUPPRESS_BELOW = 5

/**
 * `GRANT SELECT (columns)` on every described table and view, leaving out
 * the restricted columns (ADR 0002). Postgres checks column privileges
 * wherever a column is named, so the connector's role cannot select, filter,
 * join, group or sort on a restricted column. A column the description does
 * not list is not granted (and the description test fails), so a new column
 * is closed until someone describes it.
 */
export function mcpReaderGrants(role: string = MCP_READER_ROLE): string[] {
  return REPORTING_TABLES.map((table) => {
    const open = table.columns
      .filter((c) => !isRestrictedColumn(table.name, c.name))
      .map((c) => `"${c.name}"`)
    return `GRANT SELECT (${open.join(', ')}) ON reporting.${table.name} TO ${role}`
  })
}

/** BTB-462 decline categories. */
export type DeclineCategory = 'capacity' | 'character' | 'identity' | 'eligibility' | 'other'

/**
 * Reason-code prefix to category (BTB-462 comment 11579). The longest matching
 * prefix wins and an unmapped reason is `other`. Edit here; the schema script
 * rewrites the table to match.
 */
export const DECLINE_REASON_CATEGORIES: ReadonlyArray<readonly [string, DeclineCategory]> = [
  ['CREDIT_ASSESSMENT:SERVICEABILITY', 'capacity'],
  ['CREDIT_ASSESSMENT:ACCOUNT_CONDUCT', 'character'],
  ['CREDIT_ASSESSMENT:ID_VERIFICATION', 'identity'],
  ['CREDIT_ASSESSMENT:PEP', 'identity'],
  ['CREDIT_ASSESSMENT:IDENTITYRISK', 'identity'],
  ['CREDIT_ASSESSMENT:POST_IDENTITY_RISK', 'identity'],
  ['CREDIT_ASSESSMENT:FINAL_RULE', 'other'],
  ['BUSINESS_ACCOUNT', 'eligibility'],
  ['NO_PERSONAL_ACCOUNT', 'eligibility'],
  ['REAPPLICATION_BLOCK:', 'eligibility'],
  ['PERSONAL_CHECK_FAILED', 'other'],
  ['SYSTEM_FAILURE:', 'other'],
  ['G5_TIMEOUT:', 'other'],
]

/** Families of credit rules, as billieChat names their rule files. */
export type CreditRuleFamily =
  | 'account_conduct'
  | 'serviceability'
  | 'statement_check'
  | 'post_identity_risk'
  | 'final_decision'

/**
 * Credit rule ids (billieChat `businessRules/*.json`) to their family and a
 * short label. billieChat's `credit_assessment_accountConduct_result` and
 * `credit_assessment_serviceability_result` events list the ids of the rules
 * that failed (`failed_rules`); the labels here are how reports show them.
 * A rule not listed is shown by its id, so a new rule never hides a decline.
 * Edit here; the schema script rewrites the table to match.
 */
export const CREDIT_RULES: ReadonlyArray<readonly [string, CreditRuleFamily, string]> = [
  ['ACCOUNT_CONDUCT_RULE_001', 'account_conduct', 'No pay income source'],
  ['ACCOUNT_CONDUCT_RULE_002', 'account_conduct', 'Pay income not in every month'],
  ['ACCOUNT_CONDUCT_RULE_003', 'account_conduct', 'Too many concurrent SACC lenders'],
  ['ACCOUNT_CONDUCT_RULE_004', 'account_conduct', 'Financial dishonours'],
  ['ACCOUNT_CONDUCT_RULE_005', 'account_conduct', 'Gambling spend too high'],
  ['ACCOUNT_CONDUCT_RULE_006', 'account_conduct', 'Data quality gate G4, leakage ratio'],
  ['ACCOUNT_CONDUCT_RULE_007', 'account_conduct', 'Salary not stable for 4 months'],
  ['ACCOUNT_CONDUCT_RULE_008', 'account_conduct', 'Collection agency activity'],
  ['ACCOUNT_CONDUCT_RULE_009', 'account_conduct', 'Data quality gate G3, living expenses'],
  ['ACCOUNT_CONDUCT_RULE_010', 'account_conduct', 'Payments to insolvency firms'],
  ['ACCOUNT_CONDUCT_RULE_011', 'account_conduct', 'Government benefits too high a share of income'],
  ['ACCOUNT_CONDUCT_RULE_012', 'account_conduct', 'Salary under half of regular income'],
  ['ACCOUNT_CONDUCT_RULE_013', 'account_conduct', 'NILS activity'],
  ['ACCOUNT_CONDUCT_RULE_020', 'account_conduct', 'SACC repayment burden too high'],
  ['ACCOUNT_CONDUCT_RULE_023', 'account_conduct', 'Payments to debt management firms'],
  ['ACCOUNT_CONDUCT_RULE_024', 'account_conduct', 'Garnishee pattern'],
  ['ACCOUNT_CONDUCT_RULE_025', 'account_conduct', 'Court fine patterns'],
  ['ACCOUNT_CONDUCT_RULE_026', 'account_conduct', 'Categoriser coverage'],
  ['SERVICEABILITY_RULE_001', 'serviceability', 'Net income surplus negative'],
  ['STATEMENT_CHECK_RULE_001', 'statement_check', 'No transaction account'],
  ['POST_ID_RISK_CHECK_RULE_002', 'post_identity_risk', 'Statement name does not match identity'],
  ['FINAL_DECISION_RULE_001', 'final_decision', 'Final decision rule (G5)'],
]

/** A single-quoted SQL literal. Only used for the constants above. */
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Acquisition channel of a conversation's `attribution` (BTB-500). The single
 * definition: the SQL function below and the marketing dashboard feed both use
 * this text.
 */
export const ACQUISITION_CHANNEL_SQL = (column: string): string => `CASE
  WHEN ${column} IS NULL THEN 'direct'
  WHEN ${column}->>'gclid' IS NOT NULL
    OR ${column}->>'gbraid' IS NOT NULL
    OR ${column}->>'wbraid' IS NOT NULL
    OR LOWER(${column}->>'utm_medium') IN ('cpc', 'ppc', 'paid', 'paid_search', 'paidsearch', 'display')
    THEN 'paid'
  WHEN LOWER(${column}->>'utm_medium') IN ('organic', 'llm', 'social', 'referral', 'email', 'sms')
    THEN LOWER(${column}->>'utm_medium')
  ELSE 'other'
END`

/**
 * Loan purpose categories, in the order they are tried: the first whose
 * pattern matches the lowercased purpose wins, and anything else is 'other'.
 * The chat records the purpose in the customer's words, which can carry
 * health and family details, so reporting exposes only this category.
 * Patterns are Postgres regular expressions (\m and \M mark word edges).
 */
export const LOAN_PURPOSE_CATEGORIES: ReadonlyArray<readonly [string, string]> = [
  [
    'health',
    String.raw`medic|dental|dentist|doctor|hospital|pharmac|prescription|tablets|\msick|\mvet\M|optom|glasses`,
  ],
  ['family_and_gifts', String.raw`birthday|present|gift|christmas|wedding|funeral|baby`],
  ['rent_and_housing', String.raw`\mrent\M|\mrental|housing|\mbond\M|mortgage|moving house`],
  ['fuel', String.raw`fuel|petrol|diesel`],
  [
    'transport',
    String.raw`\mcars?\M|\mrego\M|registration|vehicle|tyre|mechanic|bicycle|\mbike|\muber\M|transport|\mtrain\M|\mbus\M`,
  ],
  ['education', String.raw`school|tuition|\mcourse|education|textbook|\muni\M|university`],
  ['work_and_tools', String.raw`\mtools?\M|\mwork\M|monitor|laptop|computer|equipment|uniform`],
  ['bills_and_utilities', String.raw`bill|utilit|electric|\mpower\M|\mwater\M|internet|\mphone`],
  [
    'groceries_and_living',
    String.raw`grocer|\mfood|shopping|living|everyday|personal|expens|expans`,
  ],
  [
    'social_and_dining',
    String.raw`dinner|lunch|restaurant|takeaway|\mwine\M|\mbeer|party|holiday|concert`,
  ],
]

/**
 * The first Sydney day attribution was captured (BTB-404). Earlier
 * conversations have no attribution at all, which is not the same as a
 * direct visit.
 */
export const ATTRIBUTION_CAPTURE_START = '2026-10-06'

/** Views, in dependency order (dropped in reverse). */
const VIEW_NAMES = [
  'application',
  'decision',
  'loan',
  'instalment',
  'customer',
  'collection_case',
  'write_off',
  'block_clear_request',
  'notification',
  'llm_cost',
  'contact_note',
  'data_freshness',
  'restricted_finding_summary',
  'customer_risk_summary',
] as const

/** Statements, in order. Each is safe to re-run. */
export const REPORTING_SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE SCHEMA IF NOT EXISTS reporting`,

  // ── Helpers ──────────────────────────────────────────────────────────────
  `CREATE OR REPLACE FUNCTION reporting.sydney_date(ts timestamptz)
   RETURNS date LANGUAGE sql IMMUTABLE PARALLEL SAFE
   AS $$ SELECT (ts AT TIME ZONE 'Australia/Sydney')::date $$`,

  `CREATE OR REPLACE FUNCTION reporting.acquisition_channel(attribution jsonb)
   RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
   AS $$ SELECT ${ACQUISITION_CHANNEL_SQL('attribution')} $$`,

  // Lenient readers for values inside JSON: NULL instead of an error, so one
  // malformed event cannot break every report on a view.
  `CREATE OR REPLACE FUNCTION reporting.as_numeric(value text)
   RETURNS numeric LANGUAGE sql IMMUTABLE PARALLEL SAFE
   AS $$ SELECT CASE WHEN value ~ '^\\s*-?[0-9]+(\\.[0-9]+)?\\s*$' THEN value::numeric END $$`,
  `CREATE OR REPLACE FUNCTION reporting.as_boolean(value text)
   RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE
   AS $$ SELECT CASE lower(trim(value)) WHEN 'true' THEN true WHEN 'false' THEN false END $$`,
  `CREATE OR REPLACE FUNCTION reporting.as_timestamptz(value text)
   RETURNS timestamptz LANGUAGE plpgsql STABLE PARALLEL SAFE
   AS $$ BEGIN
     -- ISO only: Postgres would also read words such as 'yesterday' or 'now'.
     IF value !~ '^\\s*[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN RETURN NULL; END IF;
     RETURN value::timestamptz;
   EXCEPTION WHEN others THEN RETURN NULL;
   END $$`,

  // Attribution text (utm_* values) is set by whoever writes a link to the
  // public site, so it is untrusted: keep printable ASCII that a campaign
  // name needs, drop the rest, cut at 80. Reports and the MCP connector show
  // these values to staff and to a model.
  `CREATE OR REPLACE FUNCTION reporting.attribution_text(value text)
   RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
   AS $$ SELECT NULLIF(left(trim(regexp_replace(value, '[^A-Za-z0-9 ._/()+&:=|-]', '', 'g')), 80), '') $$`,

  // Category of a free-text loan purpose; see LOAN_PURPOSE_CATEGORIES.
  `CREATE OR REPLACE FUNCTION reporting.loan_purpose_category(purpose text)
   RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
   AS $$ SELECT CASE
     WHEN NULLIF(trim(purpose), '') IS NULL THEN NULL
     ${LOAN_PURPOSE_CATEGORIES.map(([c, re]) => `WHEN lower(purpose) ~ ${sqlString(re)} THEN ${sqlString(c)}`).join('\n     ')}
     ELSE 'other' END $$`,

  // ── Decline reason categories (BTB-462 comment 11579) ────────────────────
  `CREATE TABLE IF NOT EXISTS reporting.decline_reason_category (
     prefix   text PRIMARY KEY,
     category text NOT NULL
       CHECK (category IN ('capacity', 'character', 'identity', 'eligibility', 'other'))
   )`,
  // The seed is authoritative: re-applying the schema rewrites changed
  // categories and removes prefixes no longer listed.
  `DELETE FROM reporting.decline_reason_category
    WHERE prefix NOT IN (${DECLINE_REASON_CATEGORIES.map(([p]) => sqlString(p)).join(', ')})`,
  `INSERT INTO reporting.decline_reason_category (prefix, category) VALUES
     ${DECLINE_REASON_CATEGORIES.map(([p, c]) => `(${sqlString(p)}, ${sqlString(c)})`).join(',\n     ')}
   ON CONFLICT (prefix) DO UPDATE SET category = EXCLUDED.category`,
  // Longest matching prefix wins; an unmapped reason is 'other'.
  `CREATE OR REPLACE FUNCTION reporting.decline_category(reason text)
   RETURNS text LANGUAGE sql STABLE PARALLEL SAFE
   AS $$ SELECT CASE WHEN reason IS NULL OR reason = '' THEN NULL ELSE COALESCE(
     (SELECT category FROM reporting.decline_reason_category
       WHERE starts_with(reason, prefix)
       ORDER BY length(prefix) DESC LIMIT 1),
     'other') END $$`,

  // ── Credit rules: id to family and label ─────────────────────────────────
  `CREATE TABLE IF NOT EXISTS reporting.credit_rule (
     rule_id text PRIMARY KEY,
     family  text NOT NULL
       CHECK (family IN ('account_conduct', 'serviceability', 'statement_check',
                         'post_identity_risk', 'final_decision')),
     label   text NOT NULL
   )`,
  // The seed is authoritative, as for decline_reason_category.
  `DELETE FROM reporting.credit_rule
    WHERE rule_id NOT IN (${CREDIT_RULES.map(([id]) => sqlString(id)).join(', ')})`,
  `INSERT INTO reporting.credit_rule (rule_id, family, label) VALUES
     ${CREDIT_RULES.map(([id, f, l]) => `(${sqlString(id)}, ${sqlString(f)}, ${sqlString(l)})`).join(',\n     ')}
   ON CONFLICT (rule_id) DO UPDATE SET family = EXCLUDED.family, label = EXCLUDED.label`,
  // A reason code's tail as words: 'review:proof_conflict' -> 'review, proof conflict'.
  `CREATE OR REPLACE FUNCTION reporting.reason_words(code text)
   RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
   AS $$ SELECT lower(replace(replace(code, '_', ' '), ':', ', ')) $$`,
  // How a decline reads in a report: by the rule that failed when one is
  // given (its family and label, or the bare id for an unlisted rule),
  // otherwise by the reason code in words. One definition, so the detail
  // report and the trend report name a reason the same way.
  `CREATE OR REPLACE FUNCTION reporting.decline_reason_label(p_reason text, p_rule text)
   RETURNS text LANGUAGE sql STABLE PARALLEL SAFE
   AS $$ SELECT CASE
     WHEN p_rule IS NOT NULL THEN COALESCE(
       (SELECT upper(left(r.family, 1)) || substr(replace(r.family, '_', ' '), 2) || ': ' || r.label
          FROM reporting.credit_rule r WHERE r.rule_id = p_rule),
       p_rule)
     WHEN p_reason IS NULL OR p_reason = '' THEN '(no reason recorded)'
     WHEN p_reason = 'CREDIT_ASSESSMENT:ACCOUNT_CONDUCT' THEN 'Account conduct (rule not recorded)'
     WHEN p_reason = 'CREDIT_ASSESSMENT:SERVICEABILITY' THEN 'Serviceability (rule not recorded)'
     WHEN starts_with(p_reason, 'CREDIT_ASSESSMENT:')
       THEN 'Credit assessment: ' || reporting.reason_words(substr(p_reason, 19))
     WHEN starts_with(p_reason, 'REAPPLICATION_BLOCK:')
       THEN 'Re-application block: ' || reporting.reason_words(substr(p_reason, 21))
     WHEN starts_with(p_reason, 'SYSTEM_FAILURE:')
       THEN 'System failure: ' || reporting.reason_words(substr(p_reason, 16))
     WHEN starts_with(p_reason, 'G5_TIMEOUT:')
       THEN 'Timed out: ' || reporting.reason_words(substr(p_reason, 12))
     ELSE upper(left(reporting.reason_words(p_reason), 1)) || substr(reporting.reason_words(p_reason), 2)
   END $$`,
  // A decline's reason, or when none was recorded (decisions from before
  // BTB-462), the first assessment component that declined, in the order
  // billieChat's final decision rule inspects them. The same precedence
  // billieChat uses to derive the reason it now records.
  `CREATE OR REPLACE FUNCTION reporting.effective_decline_reason(
     p_reason text, p_account_conduct text, p_serviceability text,
     p_identity_risk text, p_post_identity_risk text)
   RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
   AS $$ SELECT COALESCE(NULLIF(p_reason, ''), CASE
     WHEN p_account_conduct = 'DECLINED' THEN 'CREDIT_ASSESSMENT:ACCOUNT_CONDUCT'
     WHEN p_serviceability = 'DECLINED' THEN 'CREDIT_ASSESSMENT:SERVICEABILITY'
     WHEN p_identity_risk = 'DECLINED' THEN 'CREDIT_ASSESSMENT:IDENTITYRISK_ASSESSMENT'
     WHEN p_post_identity_risk = 'DECLINED' THEN 'CREDIT_ASSESSMENT:POST_IDENTITY_RISK_CHECKS'
   END) $$`,

  // ── Restricted findings over the MCP connector (ADR 0002) ───────────────
  // A decline or block reason can name a PEP match. For the connector's
  // login, every identity-category reason reads as one generic code, so a
  // PEP decline cannot be told from an ID-verification one, by value or by
  // filter. Every other login sees the reason as recorded.
  `CREATE OR REPLACE FUNCTION reporting.reason_for_session(p_reason text)
   RETURNS text LANGUAGE sql STABLE PARALLEL SAFE
   AS $$ SELECT CASE
     WHEN session_user <> ${sqlString(MCP_READER_ROLE)} THEN p_reason
     WHEN reporting.decline_category(p_reason) = 'identity' THEN 'CREDIT_ASSESSMENT:IDENTITY'
     WHEN p_reason IN (${IDENTITY_BLOCK_REASONS.map((r) => sqlString(`REAPPLICATION_BLOCK:${r}`)).join(', ')})
       THEN 'REAPPLICATION_BLOCK:IDENTITY'
     ELSE p_reason
   END $$`,
  `CREATE OR REPLACE FUNCTION reporting.block_reason_for_session(p_reason text)
   RETURNS text LANGUAGE sql STABLE PARALLEL SAFE
   AS $$ SELECT CASE
     WHEN session_user = ${sqlString(MCP_READER_ROLE)}
      AND p_reason IN (${IDENTITY_BLOCK_REASONS.map(sqlString).join(', ')}) THEN 'IDENTITY'
     ELSE p_reason
   END $$`,
  // A count of a restricted finding, with 1 to 4 hidden, so a narrow group
  // in a summary view cannot single out a person.
  `CREATE OR REPLACE FUNCTION reporting.suppress_small(n bigint)
   RETURNS bigint LANGUAGE sql IMMUTABLE PARALLEL SAFE
   AS $$ SELECT CASE WHEN n BETWEEN 1 AND ${SUPPRESS_BELOW - 1} THEN NULL ELSE n END $$`,

  // ── Decision events (append-only) ────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS reporting.decision_event (
     decision_key       text PRIMARY KEY,
     event_id           text,
     conversation_id    text NOT NULL,
     application_number text,
     decision           text NOT NULL,
     reason             text,
     retry_eligible     boolean,
     ruleset_version    text,
     build_sha          text,
     mock_origin        boolean NOT NULL DEFAULT false,
     -- BTB-484: S3 location of the consolidated assessment record, when the
     -- producer wrote one. A pointer for drill-down, not report data.
     assessment_record_location text,
     decided_at         timestamptz NOT NULL,
     decided_on         date GENERATED ALWAYS AS
                          ((decided_at AT TIME ZONE 'Australia/Sydney')::date) STORED,
     recorded_at        timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS decision_event_conversation_idx
     ON reporting.decision_event (conversation_id, decided_at DESC)`,
  `CREATE INDEX IF NOT EXISTS decision_event_decided_on_idx
     ON reporting.decision_event (decided_on)`,

  // ── Portfolio snapshot (copied from the ledger) ──────────────────────────
  `CREATE TABLE IF NOT EXISTS reporting.snap_portfolio (
     as_at_date            date PRIMARY KEY,
     total_active_accounts integer NOT NULL,
     principal_receivable  numeric NOT NULL,
     fees_receivable       numeric NOT NULL,
     total_receivables     numeric NOT NULL,
     ledger_generated_at   timestamptz,
     captured_at           timestamptz NOT NULL DEFAULT now()
   )`,

  // ── Views over the projection ────────────────────────────────────────────
  ...[...VIEW_NAMES].reverse().map((v) => `DROP VIEW IF EXISTS reporting.${v}`),

  // One row per conversation (an application attempt).
  `CREATE VIEW reporting.application AS
   SELECT
     c.conversation_id,
     NULLIF(c.application_number, '')                 AS application_number,
     c.customer_id_string                             AS customer_id,
     c.started_at,
     reporting.sydney_date(c.started_at)              AS started_on,
     reporting.attribution_text(c.attribution->>'utm_source')   AS source,
     reporting.attribution_text(c.attribution->>'utm_medium')   AS medium,
     reporting.attribution_text(c.attribution->>'utm_campaign') AS campaign,
     reporting.acquisition_channel(c.attribution)     AS channel,
     -- channel, except that a conversation from before attribution capture
     -- reads 'not recorded' rather than 'direct'. Reports group by this.
     CASE WHEN c.attribution IS NULL
               AND reporting.sydney_date(c.started_at) < DATE '${ATTRIBUTION_CAPTURE_START}'
          THEN 'not recorded'
          ELSE reporting.acquisition_channel(c.attribution) END
                                                      AS acquisition,
     c.status::text                                   AS status,
     COALESCE(c.decision_status::text, 'no_decision') AS decision_status,
     -- Funnel stages (BTB-507). Submitted: bank statements shared, or
     -- decided (a block-decline is decided without statements).
     COALESCE(c.statement_capture->>'consentStatus' = 'complete'
              OR c.decision_status::text IN ('approved', 'declined', 'referred'), false)
                                                      AS submitted,
     COALESCE(c.decision_status::text IN ('approved', 'declined', 'referred'), false)
                                                      AS decided,
     COALESCE(c.decision_status::text = 'approved', false) AS approved,
     CASE WHEN c.decision_status::text = 'declined'
          THEN reporting.reason_for_session(c.decision_detail_reason) END AS decline_reason,
     CASE WHEN c.decision_status::text = 'declined'
          THEN reporting.decline_category(c.decision_detail_reason) END
                                                      AS decline_category,
     c.decision_detail_ruleset_version                AS ruleset_version,
     f.funded_at,
     reporting.sydney_date(f.funded_at)               AS funded_on,
     (f.funded_at IS NOT NULL)                        AS funded,
     -- What was applied for. The applications row when there is one, else
     -- the scalar keys of application_data (the rest of it is personal data).
     -- The category only: the purpose itself is the customer's own words.
     reporting.loan_purpose_category(
       COALESCE(app.loan_purpose, c.application_data->>'loanPurpose'))
                                                      AS loan_purpose_category,
     COALESCE(app.loan_amount, reporting.as_numeric(c.application_data->>'loanAmount'))
                                                      AS requested_amount,
     COALESCE(app.loan_fee, reporting.as_numeric(c.application_data->>'loanFee'))
                                                      AS requested_fee,
     COALESCE(app.loan_total_payable, reporting.as_numeric(c.application_data->>'loanTotalPayable'))
                                                      AS requested_total_payable,
     COALESCE(app.loan_term, reporting.as_numeric(c.application_data->>'loanTerm'))::integer
                                                      AS loan_term,
     app.customer_attestation_acceptance              AS attestation_accepted,
     app.statement_capture_consent_provided           AS statement_consent_provided,
     app.product_offer_acceptance                     AS offer_accepted,
     app.application_outcome::text                    AS application_outcome,
     app.application_process_current_process_stage    AS process_stage,
     app.application_process_current_process_step     AS process_step,
     date_part('year', age(reporting.sydney_date(c.started_at),
                           reporting.sydney_date(cu.date_of_birth)))::integer
                                                      AS age_at_application,
     reporting.attribution_text(c.attribution->>'utm_content')  AS content,
     reporting.attribution_text(c.attribution->>'matchtype')    AS match_type,
     reporting.attribution_text(c.attribution->>'utm_term')     AS keyword,
     -- Which ad click id the visit carried. The id itself is left out: it
     -- links the application to one person's click in the ad platform.
     CASE WHEN c.attribution->>'gclid' IS NOT NULL THEN 'gclid'
          WHEN c.attribution->>'gbraid' IS NOT NULL THEN 'gbraid'
          WHEN c.attribution->>'wbraid' IS NOT NULL THEN 'wbraid' END
                                                      AS click_id_type,
     reporting.as_timestamptz(c.attribution->>'captured_at') AS attribution_captured_at,
     NULLIF(c.network->>'country', '')                AS country,
     c.last_utterance_time                            AS last_activity_at,
     -- Statement capture: progress and counts only (names and account
     -- numbers in the affordability report are not read).
     c.statement_capture->>'consentStatus'            AS statement_consent_status,
     COALESCE(reporting.as_boolean(c.statement_capture->>'retrievalComplete'), false)
                                                      AS statements_retrieved,
     COALESCE(reporting.as_boolean(c.statement_capture->>'checksComplete'), false)
                                                      AS statement_checks_complete,
     reporting.as_numeric(c.statement_capture #>> '{affordabilityReport,summary,total_accounts}')::integer
                                                      AS bank_accounts,
     reporting.as_numeric(c.statement_capture #>> '{affordabilityReport,summary,salary_summary,number_of_salary_sources}')::integer
                                                      AS salary_sources,
     -- Assessment outcomes (their figures are not in the CRM).
     c.assessments_identity_risk->>'decision'         AS identity_risk_decision,
     reporting.as_boolean(c.assessments_identity_risk->>'pep_hit') AS pep_hit,
     reporting.as_boolean(c.assessments_identity_risk->>'identity_verification_failed')
                                                      AS identity_verification_failed,
     reporting.as_boolean(c.assessments_identity_risk->>'manual_verification')
                                                      AS manual_verification,
     (c.assessments_identity_risk->>'idv_reused_from' IS NOT NULL) AS identity_check_reused,
     (SELECT count(*)::integer FROM jsonb_object_keys(
        CASE WHEN jsonb_typeof(c.identity_verification_attempts) = 'object'
             THEN c.identity_verification_attempts ELSE '{}'::jsonb END))
                                                      AS identity_attempts,
     c.assessments_post_identity_risk->>'decision'    AS post_identity_risk_decision,
     c.assessments_account_conduct->>'decision'       AS account_conduct_decision,
     -- Rule ids only (billieChat's failed_rules); the figures stay in S3.
     CASE WHEN jsonb_typeof(c.assessments_account_conduct->'failed_rules') = 'array'
          THEN ARRAY(SELECT jsonb_array_elements_text(c.assessments_account_conduct->'failed_rules'))
     END                                              AS account_conduct_failed_rules,
     c.assessments_serviceability->>'decision'        AS serviceability_decision,
     CASE WHEN jsonb_typeof(c.assessments_serviceability->'failed_rules') = 'array'
          THEN ARRAY(SELECT jsonb_array_elements_text(c.assessments_serviceability->'failed_rules'))
     END                                              AS serviceability_failed_rules,
     reporting.as_numeric(c.assessments_fraud_check #>> '{latest,final_score}') AS fraud_score,
     c.assessments_fraud_check #>> '{latest,severity}' AS fraud_severity,
     CASE WHEN jsonb_typeof(c.assessments_fraud_check #> '{latest,categories}') = 'array'
          THEN ARRAY(SELECT jsonb_array_elements_text(c.assessments_fraud_check #> '{latest,categories}'))
     END                                              AS fraud_categories,
     reporting.as_numeric(c.assessments_fraud_check->>'peak_score') AS fraud_peak_score,
     c.assessments_fraud_check->>'peak_severity'      AS fraud_peak_severity,
     reporting.as_numeric(c.assessments_fraud_check->>'turns_assessed')::integer AS fraud_turns_assessed,
     reporting.as_numeric(c.assessments_fraud_check->>'flagged_count')::integer AS fraud_flagged_turns,
     reporting.as_boolean(c.assessments_fraud_check #>> '{latest,would_halt}') AS fraud_would_halt,
     c.decision_metadata->>'component'                AS decision_component,
     CASE WHEN jsonb_typeof(c.decision_metadata->'declined_components') = 'array'
          THEN ARRAY(SELECT jsonb_array_elements_text(c.decision_metadata->'declined_components'))
     END                                              AS declined_components,
     c.decision_detail_retry_eligible                 AS retry_eligible,
     -- Re-application block (the stop message and justification are free text).
     reporting.block_reason_for_session(c.reapplication_block_reason) AS block_reason,
     reporting.block_reason_for_session(c.reapplication_block_message_variant)
                                                      AS block_message_variant,
     c.reapplication_block_disposition_kind           AS block_disposition,
     c.reapplication_block_manual_review_candidate    AS block_manual_review,
     c.reapplication_block_blocked_at                 AS blocked_at,
     COALESCE(c.reapplication_block_blocked_until, c.decision_detail_blocked_until)
                                                      AS blocked_until,
     c.reapplication_block_clear_status               AS block_clear_status,
     c.reapplication_block_cleared_at                 AS block_cleared_at,
     NULLIF(c.reapplication_block_cleared_by, '')     AS block_cleared_by,
     NULLIF(c.reapplication_block_clear_request_id, '') AS block_clear_request_id,
     c.identity_resolution #>> '{link,reason}'        AS identity_link_reason,
     c.identity_resolution #>> '{review_case,band}'   AS identity_review_band,
     c.identity_resolution #>> '{review_case,disposition}' AS identity_review_disposition,
     -- Ended early: staff or system kills (not their notes) and cancellations.
     (c.kill_record IS NOT NULL)                      AS killed,
     c.kill_record->>'reason_category'                AS kill_reason,
     CASE WHEN c.kill_record->>'actor' LIKE 'user:%' THEN 'staff'
          ELSE NULLIF(c.kill_record->>'actor', '') END AS killed_by,
     reporting.as_timestamptz(c.kill_record->>'killed_at')       AS killed_at,
     (c.cancellation_record IS NOT NULL)              AS cancelled,
     c.cancellation_record->>'reason'                 AS cancel_reason,
     c.cancellation_record->>'category'               AS cancel_category,
     reporting.as_timestamptz(c.cancellation_record->>'cancelled_at') AS cancelled_at,
     c.data_quality_alert->>'gate'                    AS data_quality_gate,
     reporting.as_numeric(c.data_quality_alert->>'earned_source_count')::integer AS earned_income_sources,
     reporting.as_numeric(c.data_quality_alert->>'benefit_source_count')::integer AS benefit_income_sources,
     c.llm_cost_total_usd                             AS llm_cost_usd,
     c.llm_call_count::integer                        AS llm_calls,
     c.llm_unpriced_count::integer                    AS llm_unpriced_calls
   FROM public.conversations c
   LEFT JOIN LATERAL (
     SELECT MIN(la.loan_terms_disbursed_date) AS funded_at
       FROM public.loan_accounts la
      WHERE la.application_number = NULLIF(c.application_number, '')
   ) f ON true
   LEFT JOIN public.applications app
     ON app.application_number = NULLIF(c.application_number, '')
   LEFT JOIN public.customers cu ON cu.customer_id = c.customer_id_string`,

  // Latest decision per conversation, from the event history.
  `CREATE VIEW reporting.decision AS
   SELECT DISTINCT ON (d.conversation_id)
     d.conversation_id,
     d.application_number,
     d.decision,
     reporting.reason_for_session(d.reason) AS reason,
     reporting.decline_category(CASE WHEN d.decision = 'DECLINED' THEN d.reason END)
                         AS decline_category,
     d.retry_eligible,
     d.ruleset_version,
     d.build_sha,
     d.mock_origin,
     d.decided_at,
     d.decided_on
   FROM reporting.decision_event d
   ORDER BY d.conversation_id, d.decided_at DESC, d.decision_key DESC`,

  // One row per loan account, with the acquisition source of its application.
  `CREATE VIEW reporting.loan AS
   SELECT
     la.loan_account_id,
     NULLIF(la.application_number, '')                      AS application_number,
     la.customer_id_string                                  AS customer_id,
     la.loan_terms_loan_amount                              AS loan_amount,
     la.loan_terms_loan_fee                                 AS loan_fee,
     la.loan_terms_total_payable                            AS total_payable,
     la.loan_terms_disbursed_date                           AS disbursed_at,
     reporting.sydney_date(la.loan_terms_disbursed_date)    AS disbursed_on,
     la.account_status::text                                AS account_status,
     la.aging_bucket::text                                  AS aging_bucket,
     la.aging_current_d_p_d                                 AS dpd,
     la.aging_is_in_arrears                                 AS in_arrears,
     la.balances_total_outstanding                          AS total_outstanding,
     la.balances_total_paid                                 AS total_paid,
     la.closure_reason::text                                AS closure_reason,
     la.closure_closed_date                                 AS closed_at,
     a.conversation_id,
     a.source,
     a.medium,
     COALESCE(a.channel, 'direct')                          AS channel,
     COALESCE(a.acquisition, 'not recorded')                AS acquisition,
     la.loan_terms_opened_date                              AS opened_at,
     reporting.sydney_date(la.loan_terms_opened_date)       AS opened_on,
     reporting.sydney_date(la.commencement_date)            AS commencement_on,
     la.repayment_schedule_payment_frequency::text          AS payment_frequency,
     la.repayment_schedule_number_of_payments::integer      AS number_of_payments,
     la.balances_current_balance                            AS current_balance,
     la.last_payment_date                                   AS last_payment_at,
     reporting.sydney_date(la.last_payment_date)            AS last_payment_on,
     la.last_payment_amount,
     la.aging_last_updated                                  AS aging_updated_at,
     reporting.sydney_date(la.closure_closed_date)          AS closed_on,
     la.closure_previous_status                             AS status_before_closure,
     la.closure_final_balance                               AS final_balance,
     la.closure_total_paid                                  AS total_paid_at_closure
   FROM public.loan_accounts la
   -- Find the conversation on the raw column, so the lookup uses
   -- conversations_application_number_idx; matching the application view's
   -- NULLIF'd column scanned every conversation once per loan.
   LEFT JOIN LATERAL (
     SELECT c.conversation_id
       FROM public.conversations c
      WHERE c.application_number = la.application_number
        AND la.application_number <> ''
      ORDER BY c.started_at DESC
      LIMIT 1
   ) lc ON true
   LEFT JOIN reporting.application a ON a.conversation_id = lc.conversation_id`,

  // One row per scheduled instalment.
  `CREATE VIEW reporting.instalment AS
   SELECT
     la.loan_account_id,
     p.payment_number::integer              AS payment_number,
     p.due_date,
     reporting.sydney_date(p.due_date)      AS due_on,
     p.amount,
     p.status::text                         AS status,
     p.amount_paid,
     p.amount_remaining,
     p.paid_date,
     reporting.sydney_date(p.paid_date)     AS paid_on
   FROM public.loan_accounts_repayment_schedule_payments p
   JOIN public.loan_accounts la ON la.id = p._parent_id`,

  // One row per customer: identity, verification and risk, never contact
  // details. Age in whole years and the residential state and postcode only.
  `CREATE VIEW reporting.customer AS
   SELECT
     cu.customer_id,
     NULLIF(cu.canonical_id, '')                              AS canonical_id,
     cu.customer_id_status,
     NULLIF(cu.merged_into, '')                               AS merged_into,
     cu.created_at,
     reporting.sydney_date(cu.created_at)                     AS created_on,
     date_part('year', age(current_date, reporting.sydney_date(cu.date_of_birth)))::integer
                                                              AS age,
     NULLIF(UPPER(TRIM(cu.residential_address_state)), '')    AS state,
     NULLIF(TRIM(cu.residential_address_postcode), '')        AS postcode,
     NULLIF(UPPER(TRIM(cu.residential_address_country)), '')  AS country,
     cu.identity_verified,
     cu.ekyc_status::text                                     AS ekyc_status,
     cu.individual_status::text                               AS individual_status,
     cu.identity_verification_provider                        AS verification_provider,
     cu.identity_verification_overall_result                  AS verification_result,
     cu.identity_verification_identity_outcome                AS identity_outcome,
     cu.identity_verification_screening_outcome               AS screening_outcome,
     cu.identity_verification_pep_result                      AS pep_result,
     cu.identity_verification_sanctions_result                AS sanctions_result,
     cu.identity_verification_checked_at                      AS verification_checked_at,
     cu.staff_flag,
     cu.investor_flag,
     cu.founder_flag,
     cu.vulnerable_flag,
     cu.fraud_risk_active,
     cu.fraud_risk_severity,
     cu.fraud_risk_score,
     CASE WHEN jsonb_typeof(cu.fraud_risk_categories) = 'array'
          THEN ARRAY(SELECT jsonb_array_elements_text(cu.fraud_risk_categories)) END
                                                              AS fraud_risk_categories,
     cu.fraud_risk_flagged_at,
     reporting.block_reason_for_session(cu.reapplication_block_reason) AS block_reason,
     cu.reapplication_block_blocked_at                        AS blocked_at,
     cu.reapplication_block_blocked_until                     AS blocked_until,
     cu.reapplication_block_clear_status                      AS block_clear_status,
     cu.reapplication_block_cleared_at                        AS block_cleared_at,
     cu.email_tier,
     cu.email_source,
     (cu.email_verified_at IS NOT NULL)                       AS email_verified,
     cu.mobile_phone_tier,
     cu.mobile_phone_source,
     (cu.mobile_phone_verified_at IS NOT NULL)                AS mobile_verified
   FROM public.customers cu`,

  // One row per collections case on a loan.
  `CREATE VIEW reporting.collection_case AS
   SELECT
     cc.account_id                              AS loan_account_id,
     cc.customer_id,
     cc.state::text                             AS state,
     cc.hardship_paused,
     cc.stopped_contact,
     cc.overdue_amount,
     cc.days_overdue::integer                   AS days_overdue,
     cc.last_step::integer                      AS last_step,
     cc.rung::integer                           AS rung,
     cc.due_date,
     reporting.sydney_date(cc.due_date)         AS due_on,
     cc.opened_at,
     reporting.sydney_date(cc.opened_at)        AS opened_on,
     cc.cured_at,
     reporting.sydney_date(cc.cured_at)         AS cured_on,
     cc.exhausted_at,
     cc.paused_at,
     cc.resumed_at,
     cc.stop_contact_at,
     cc.updated_at
   FROM public.collection_cases cc`,

  // One row per write-off request. Staff appear as user ids, never names.
  `CREATE VIEW reporting.write_off AS
   SELECT
     w.request_id,
     w.request_number,
     w.loan_account_id,
     w.customer_id,
     w.amount,
     w.original_balance,
     w.reason::text                                      AS reason,
     w.status::text                                      AS status,
     w.priority::text                                    AS priority,
     w.requires_senior_approval,
     w.requested_by_id::text                             AS requested_by,
     w.requested_at,
     reporting.sydney_date(w.requested_at)               AS requested_on,
     w.approval_details_decided_by_id::text              AS decided_by,
     w.approval_details_decided_at                       AS decided_at,
     NULLIF(w.approval_details_approved_by, '')          AS approved_by,
     w.approval_details_approved_at                      AS approved_at,
     reporting.sydney_date(w.approval_details_approved_at) AS approved_on,
     NULLIF(w.approval_details_rejected_by, '')          AS rejected_by,
     w.approval_details_rejected_at                      AS rejected_at,
     NULLIF(w.cancellation_details_cancelled_by, '')     AS cancelled_by,
     w.cancellation_details_cancelled_at                 AS cancelled_at
   FROM public.write_off_requests w`,

  // One row per request to clear a re-application block.
  `CREATE VIEW reporting.block_clear_request AS
   SELECT
     r.request_id,
     r.request_number,
     r.canonical_customer_id                             AS customer_id,
     r.conversation_id,
     CASE WHEN jsonb_typeof(r.reasons) = 'array'
          THEN ARRAY(SELECT reporting.block_reason_for_session(x)
                       FROM jsonb_array_elements_text(r.reasons) AS x) END AS reasons,
     r.status::text                                      AS status,
     r.requested_by_id::text                             AS requested_by,
     r.requested_at,
     reporting.sydney_date(r.requested_at)               AS requested_on,
     NULLIF(r.approval_details_approved_by, '')          AS approved_by,
     r.approval_details_approved_at                      AS approved_at,
     NULLIF(r.approval_details_rejected_by, '')          AS rejected_by,
     r.approval_details_rejected_at                      AS rejected_at,
     NULLIF(r.cancellation_details_cancelled_by, '')     AS cancelled_by,
     r.cancellation_details_cancelled_at                 AS cancelled_at
   FROM public.reapplication_block_clear_requests r`,

  // One row per customer notification (email, SMS). No recipient, no content.
  `CREATE VIEW reporting.notification AS
   SELECT
     n.notification_id,
     n.customer_id,
     n.status::text                              AS status,
     n.channel::text                             AS channel,
     n.template_name,
     n.provider,
     n.tags_category                             AS category,
     n.tags_reason                               AS reason,
     n.tags_step::integer                        AS step,
     n.event_at,
     n.sent_at,
     reporting.sydney_date(n.sent_at)            AS sent_on,
     n.failure_failed_at                         AS failed_at,
     n.failure_error_type::text                  AS error_type,
     n.failure_attempt::integer                  AS attempt,
     n.failure_fallback_suggested                AS fallback_suggested,
     n.statement_account_id                      AS statement_loan_account_id,
     n.statement_period_start,
     n.statement_period_end,
     n.statement_dispatched_at,
     n.suppression_mode::text                    AS suppression_mode,
     n.suppression_set_at,
     n.suppression_expires_at,
     n.created_at,
     reporting.sydney_date(n.created_at)         AS created_on
   FROM public.notifications n`,

  // One row per LLM call in a conversation, with its cost.
  `CREATE VIEW reporting.llm_cost AS
   SELECT
     l.conversation_id,
     l.seq::integer                        AS seq,
     l.model,
     l.agent_name,
     l.service_tier,
     l.prompt_tokens::bigint               AS prompt_tokens,
     l.completion_tokens::bigint           AS completion_tokens,
     l.cached_tokens::bigint               AS cached_tokens,
     l.reasoning_tokens::bigint            AS reasoning_tokens,
     l.total_tokens::bigint                AS total_tokens,
     l.response_time_ms::integer           AS response_time_ms,
     COALESCE(l.computed_cost_usd, l.logged_cost_usd) AS cost_usd,
     l.priced,
     l.has_usage,
     l.called_at,
     reporting.sydney_date(l.called_at)    AS called_on
   FROM public.llm_costs l`,

  // One row per staff contact note: what kind of contact, never its text.
  `CREATE VIEW reporting.contact_note AS
   SELECT
     cn.id::text                           AS note_id,
     cu.customer_id,
     la.loan_account_id,
     cv.conversation_id,
     cn.channel::text                      AS channel,
     cn.topic::text                        AS topic,
     cn.contact_direction::text            AS direction,
     cn.priority::text                     AS priority,
     cn.sentiment::text                    AS sentiment,
     cn.status::text                       AS status,
     cn.created_by_id::text                AS created_by,
     cn.amends_note_id::text               AS amends_note_id,
     cn.created_at,
     reporting.sydney_date(cn.created_at)  AS created_on
   FROM public.contact_notes cn
   LEFT JOIN public.customers cu ON cu.id = cn.customer_id
   LEFT JOIN public.loan_accounts la ON la.id = cn.loan_account_id
   LEFT JOIN public.conversations cv ON cv.id = cn.conversation_id`,

  // How fresh the reporting data is: the latest application started or loan
  // changed. Both columns are indexed, so this is two index lookups. Reports
  // show it as "Data to 10:29 today".
  `CREATE VIEW reporting.data_freshness AS
   SELECT GREATEST(
     (SELECT max(created_at) FROM public.conversations),
     (SELECT max(updated_at) FROM public.loan_accounts)
   ) AS latest_change_at`,

  // ── Counts of restricted findings (ADR 0002) ─────────────────────────────
  // The connector's role cannot read the restricted columns; these views
  // count them for it, at a fixed grain, with small counts hidden. They read
  // the raw reason columns of the underlying tables, not the generalised ones.
  `CREATE VIEW reporting.restricted_finding_summary AS
   SELECT
     date_trunc('month', a.started_on)::date AS started_month,
     a.acquisition,
     a.decision_status AS outcome,
     count(*) AS applications,
     reporting.suppress_small(count(*) FILTER (WHERE a.pep_hit)) AS pep_hits,
     reporting.suppress_small(count(*) FILTER (
       WHERE a.decision_status = 'declined' AND d.mock_origin IS NOT TRUE
         AND c.decision_detail_reason LIKE '%:PEP')) AS pep_declines,
     reporting.suppress_small(count(*) FILTER (WHERE c.reapplication_block_reason = 'PEP'))
                                                     AS pep_blocks,
     reporting.suppress_small(count(*) FILTER (WHERE a.fraud_severity IN ('HIGH', 'CRITICAL')))
                                                     AS fraud_high_or_critical,
     reporting.suppress_small(count(*) FILTER (WHERE a.fraud_would_halt))
                                                     AS fraud_would_halt,
     reporting.suppress_small(count(*) FILTER (WHERE a.kill_reason = 'fraud_abuse'))
                                                     AS fraud_kills
   FROM reporting.application a
   JOIN public.conversations c ON c.conversation_id = a.conversation_id
   LEFT JOIN reporting.decision d ON d.conversation_id = a.conversation_id
   WHERE d.mock_origin IS NOT TRUE
   GROUP BY 1, 2, 3`,

  `CREATE VIEW reporting.customer_risk_summary AS
   SELECT
     date_trunc('month', c.created_on)::date AS created_month,
     c.state,
     count(*) AS customers,
     reporting.suppress_small(count(*) FILTER (
       WHERE c.pep_result IS NOT NULL AND c.pep_result <> 'no_match')) AS pep_matches,
     reporting.suppress_small(count(*) FILTER (
       WHERE c.sanctions_result IS NOT NULL AND c.sanctions_result <> 'no_match'))
                                                     AS sanctions_matches,
     reporting.suppress_small(count(*) FILTER (
       WHERE c.screening_outcome IS NOT NULL AND c.screening_outcome <> 'pass'))
                                                     AS screening_not_passed,
     reporting.suppress_small(count(*) FILTER (WHERE c.vulnerable_flag)) AS vulnerable,
     reporting.suppress_small(count(*) FILTER (WHERE c.fraud_risk_active)) AS fraud_risk_active,
     reporting.suppress_small(count(*) FILTER (
       WHERE c.fraud_risk_severity IN ('HIGH', 'CRITICAL'))) AS fraud_risk_high_or_critical
   FROM reporting.customer c
   WHERE c.merged_into IS NULL
   GROUP BY 1, 2`,

  // ── Grants ───────────────────────────────────────────────────────────────
  // The runtime role is DML-only and named outside this repo, so grant the
  // reporting schema to every role that can already write conversations.
  // `reporting_reader`, when it exists, is the read-only role the report
  // runner connects as (BTB-506): it can read the views and nothing else.
  `DO $$
   DECLARE r record;
   BEGIN
     FOR r IN
       SELECT rolname FROM pg_roles
        WHERE rolname <> current_user
          AND rolname NOT LIKE 'pg\\_%'
          AND NOT rolsuper
          AND has_table_privilege(oid, 'public.conversations', 'INSERT')
     LOOP
       EXECUTE format('GRANT USAGE ON SCHEMA reporting TO %I', r.rolname);
       EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO %I', r.rolname);
       EXECUTE format(
         'GRANT INSERT, UPDATE ON reporting.decision_event, reporting.snap_portfolio TO %I',
         r.rolname);
     END LOOP;
     IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_reader') THEN
       GRANT USAGE ON SCHEMA reporting TO reporting_reader;
       GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO reporting_reader;
     END IF;
   END $$`,
  // The MCP connector's role (ADR 0002): column by column, never the
  // restricted columns. Revoked first, so a column that became restricted
  // loses its grant.
  `DO $$
   BEGIN
     IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${sqlString(MCP_READER_ROLE)}) THEN
       REVOKE ALL ON ALL TABLES IN SCHEMA reporting FROM ${MCP_READER_ROLE};
       GRANT USAGE ON SCHEMA reporting TO ${MCP_READER_ROLE};
       ${mcpReaderGrants().join(';\n       ')};
     END IF;
   END $$`,
]

/** The whole schema as one script. */
export const REPORTING_SCHEMA_SQL = REPORTING_SCHEMA_STATEMENTS.map((s) => `${s};`).join('\n\n')

/** Anything with a node-pg style `query(text)`. */
export interface QueryRunner {
  query: (text: string) => Promise<unknown>
}

/**
 * Apply the reporting schema. Idempotent.
 *
 * Sent as one multi-statement query, so it runs on one connection and in one
 * implicit transaction: a failure leaves the previous definitions in place.
 */
export async function applyReportingSchema(runner: QueryRunner): Promise<void> {
  await runner.query(REPORTING_SCHEMA_SQL)
}

/**
 * Drop the reporting views before Payload's dev `push` (BTB-504).
 *
 * Postgres refuses to alter a column a view depends on, so a push that
 * changes a column the views read would fail. Dropping them first lets the
 * push run; `onInit` recreates them afterwards. Uses its own short-lived
 * connection because the adapter has not connected yet. Failures (for
 * example, no database yet) are logged and ignored.
 */
export async function dropReportingViews(connectionString: string): Promise<void> {
  const { Client } = await import('pg')
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000 })
  try {
    await client.connect()
    await client.query(
      [...VIEW_NAMES]
        .reverse()
        .map((v) => `DROP VIEW IF EXISTS reporting.${v};`)
        .join('\n'),
    )
  } catch (err) {
    console.warn('[reporting] could not drop views before push:', (err as Error).message)
  } finally {
    await client.end().catch(() => undefined)
  }
}
