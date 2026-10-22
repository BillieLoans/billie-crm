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

/** Views, in dependency order (dropped in reverse). */
const VIEW_NAMES = ['application', 'decision', 'loan', 'instalment'] as const

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
     c.status::text                                   AS status,
     COALESCE(c.decision_status::text, 'no_decision') AS decision_status,
     -- Funnel stages (BTB-507). Submitted: bank statements shared, or
     -- decided (a block-decline is decided without statements).
     COALESCE(c.statement_capture->>'consentStatus' = 'complete', false)
       OR c.decision_status::text IN ('approved', 'declined', 'referred')
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
     COALESCE(a.channel, 'direct')                          AS channel
   FROM public.loan_accounts la
   LEFT JOIN LATERAL (
     SELECT ap.conversation_id, ap.source, ap.medium, ap.channel
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
