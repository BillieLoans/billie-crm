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
     c.attribution->>'utm_source'                     AS source,
     c.attribution->>'utm_medium'                     AS medium,
     c.attribution->>'utm_campaign'                   AS campaign,
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
          THEN c.decision_detail_reason END           AS decline_reason,
     CASE WHEN c.decision_status::text = 'declined'
          THEN reporting.decline_category(c.decision_detail_reason) END
                                                      AS decline_category,
     c.decision_detail_ruleset_version                AS ruleset_version,
     f.funded_at,
     reporting.sydney_date(f.funded_at)               AS funded_on,
     (f.funded_at IS NOT NULL)                        AS funded
   FROM public.conversations c
   LEFT JOIN LATERAL (
     SELECT MIN(la.loan_terms_disbursed_date) AS funded_at
       FROM public.loan_accounts la
      WHERE la.application_number = NULLIF(c.application_number, '')
   ) f ON true`,

  // Latest decision per conversation, from the event history.
  `CREATE VIEW reporting.decision AS
   SELECT DISTINCT ON (d.conversation_id)
     d.conversation_id,
     d.application_number,
     d.decision,
     d.reason,
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
   LEFT JOIN LATERAL (
     SELECT ap.conversation_id, ap.source, ap.medium, ap.channel, ap.acquisition
       FROM reporting.application ap
      WHERE ap.application_number = NULLIF(la.application_number, '')
      ORDER BY ap.started_at DESC
      LIMIT 1
   ) a ON true`,

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
     cu.reapplication_block_reason                            AS block_reason,
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
          THEN ARRAY(SELECT jsonb_array_elements_text(r.reasons)) END AS reasons,
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
