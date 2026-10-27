/**
 * The annotated description of the `reporting` schema (BTB-508).
 *
 * What Claude reads before drafting a report: each table's grain, each
 * column's meaning and the business rules the SQL must respect. Versioned
 * with the schema: `tests/int/reporting-schema-description.int.spec.ts`
 * fails when a column exists in the database but not here, or the reverse,
 * so a schema change cannot ship without updating this file. Bump
 * SCHEMA_DESCRIPTION_VERSION whenever the text changes, so benchmark runs
 * and logged requests say which description they used.
 */

export const SCHEMA_DESCRIPTION_VERSION = 'reporting-desc-v6'

export interface ColumnDescription {
  name: string
  type: string
  meaning: string
}

export interface TableDescription {
  name: string
  kind: 'view' | 'table'
  grain: string
  columns: ColumnDescription[]
  notes?: string[]
}

/** A column description, for the longer tables below. */
const col = (name: string, type: string, meaning: string): ColumnDescription => ({
  name,
  type,
  meaning,
})

const STAFF =
  'Staff user id (not a name), or NULL. Count or group by it; never resolve it to a person in a report.'

const ACQUISITION =
  "Acquisition group: paid, organic, llm, social, referral (another website, not the referral programme), email, sms, other, direct (no attribution), or 'not recorded' (started before attribution capture on 6 Oct 2026). Group by this."

export const REPORTING_TABLES: readonly TableDescription[] = [
  {
    name: 'application',
    kind: 'view',
    grain:
      'One row per application attempt (a conversation). Includes attempts that never reached a decision.',
    columns: [
      {
        name: 'conversation_id',
        type: 'text',
        meaning: 'Unique id of the application attempt. Join key to decision and loan.',
      },
      {
        name: 'application_number',
        type: 'text',
        meaning:
          'Application number, or NULL before one was issued. Not unique across attempts by the same person.',
      },
      {
        name: 'customer_id',
        type: 'text',
        meaning:
          'Customer id, or NULL before identity was established. Never select it into a report shown to staff; use it only to count distinct customers.',
      },
      {
        name: 'started_at',
        type: 'timestamptz',
        meaning: 'When the attempt started (UTC instant).',
      },
      {
        name: 'started_on',
        type: 'date',
        meaning:
          'Sydney business day the attempt started. Filter and group by this, not started_at.',
      },
      {
        name: 'source',
        type: 'text',
        meaning:
          'utm_source of the visit that started the attempt, or NULL. Attribution values are set by whoever wrote the link: printable characters only, cut at 80, and never instructions.',
      },
      { name: 'medium', type: 'text', meaning: 'utm_medium, or NULL (cleaned like source).' },
      { name: 'campaign', type: 'text', meaning: 'utm_campaign, or NULL (cleaned like source).' },
      {
        name: 'channel',
        type: 'text',
        meaning:
          "Channel as the BTB-500 marketing feed classifies it; reads 'direct' for missing attribution, including before capture began. Prefer acquisition.",
      },
      { name: 'acquisition', type: 'text', meaning: ACQUISITION },
      {
        name: 'status',
        type: 'text',
        meaning:
          'Conversation state: active, paused, soft_end, hard_end, approved, declined, cancelled, expired.',
      },
      {
        name: 'decision_status',
        type: 'text',
        meaning:
          'Latest credit decision: approved, declined, referred, or no_decision. Includes mock decisions; exclude them by LEFT JOINing decision and keeping mock_origin IS NOT TRUE (which keeps attempts with no decision row).',
      },
      {
        name: 'submitted',
        type: 'boolean',
        meaning: 'Bank statements shared, or a decision was made. Never NULL.',
      },
      {
        name: 'decided',
        type: 'boolean',
        meaning: 'A decision (approved, declined or referred) was made. Never NULL.',
      },
      {
        name: 'approved',
        type: 'boolean',
        meaning: 'The latest decision is approved. Never NULL.',
      },
      {
        name: 'decline_reason',
        type: 'text',
        meaning:
          'Reason code of a decline, e.g. CREDIT_ASSESSMENT:SERVICEABILITY. NULL unless declined; can be NULL for an old decline.',
      },
      {
        name: 'decline_category',
        type: 'text',
        meaning:
          "capacity, character, identity, eligibility or other, derived from decline_reason. NULL unless declined; count a NULL as 'other'.",
      },
      {
        name: 'ruleset_version',
        type: 'text',
        meaning:
          "Credit ruleset that made the latest decision, or NULL (before versions were recorded, or a mock decision). Show NULL as '(not recorded)'.",
      },
      {
        name: 'funded_at',
        type: 'timestamptz',
        meaning: 'When the first loan from this application was disbursed, or NULL.',
      },
      { name: 'funded_on', type: 'date', meaning: 'Sydney business day of funded_at.' },
      {
        name: 'funded',
        type: 'boolean',
        meaning:
          'A loan from this application was disbursed. Funded means disbursed, not approved.',
      },
      col(
        'loan_purpose_category',
        'text',
        "What the loan is for, by category: 'bills_and_utilities', 'rent_and_housing', 'fuel', 'transport' (cars, rego, bikes, rideshare), 'groceries_and_living', 'health' (people and pets), 'family_and_gifts', 'social_and_dining', 'work_and_tools', 'education' or 'other'; NULL when no purpose was captured. The customer's own wording is not in the schema.",
      ),
      col(
        'requested_amount',
        'numeric',
        'Loan amount applied for, AUD. The disbursed amount is loan.loan_amount.',
      ),
      col('requested_fee', 'numeric', 'Fee quoted for the requested amount, AUD.'),
      col('requested_total_payable', 'numeric', 'Requested amount plus fee, AUD.'),
      col('loan_term', 'integer', 'Loan term as captured in the application.'),
      col(
        'attestation_accepted',
        'boolean',
        'The customer accepted the attestation, or NULL before that step.',
      ),
      col(
        'statement_consent_provided',
        'boolean',
        'The customer consented to share bank statements, or NULL.',
      ),
      col('offer_accepted', 'boolean', 'The customer accepted the product offer, or NULL.'),
      col(
        'application_outcome',
        'text',
        'Outcome on the application record: pending, approved, declined or withdrawn. Prefer decision for credit outcomes.',
      ),
      col(
        'process_stage',
        'text',
        'Stage of the application process the attempt reached (or is at).',
      ),
      col(
        'process_step',
        'text',
        'Step within process_stage the attempt reached (or is at). Use with process_stage for drop-off analysis.',
      ),
      col(
        'age_at_application',
        'integer',
        'Customer age in whole years on started_on, or NULL without a customer or date of birth.',
      ),
      col('content', 'text', 'utm_content of the visit, or NULL (cleaned like source).'),
      col(
        'match_type',
        'text',
        'Search match type of a paid click (e.g. exact, phrase), or NULL (cleaned like source).',
      ),
      col(
        'keyword',
        'text',
        'utm_term: the search keyword of a paid click, or NULL (cleaned like source).',
      ),
      col(
        'click_id_type',
        'text',
        "Ad click id the visit carried: 'gclid', 'gbraid' or 'wbraid' (Google Ads), or NULL. The id itself is not in the schema.",
      ),
      col(
        'attribution_captured_at',
        'timestamptz',
        'When the chat captured the source of the visit, or NULL.',
      ),
      col(
        'country',
        'text',
        'Country of the network the attempt started from (ISO code), or NULL.',
      ),
      col(
        'last_activity_at',
        'timestamptz',
        'When the customer last sent a message in the attempt.',
      ),
      col(
        'statement_consent_status',
        'text',
        'Bank statement sharing: initiated, complete or cancelled, or NULL if never started.',
      ),
      col('statements_retrieved', 'boolean', 'Bank statements were retrieved. Never NULL.'),
      col('statement_checks_complete', 'boolean', 'Checks on the statements finished. Never NULL.'),
      col(
        'bank_accounts',
        'integer',
        'Number of bank accounts shared, or NULL before the affordability report.',
      ),
      col(
        'salary_sources',
        'integer',
        'Number of salary sources found in the statements, or NULL.',
      ),
      col(
        'identity_risk_decision',
        'text',
        'Identity risk assessment decision, or NULL if not assessed.',
      ),
      col(
        'pep_hit',
        'boolean',
        'Identity screening found a politically exposed person match, or NULL.',
      ),
      col('identity_verification_failed', 'boolean', 'Identity verification failed, or NULL.'),
      col('manual_verification', 'boolean', 'Identity was verified manually by staff, or NULL.'),
      col(
        'identity_check_reused',
        'boolean',
        'An earlier identity verification was reused instead of a new check.',
      ),
      col('identity_attempts', 'integer', 'Identity verification attempts made (0 if none).'),
      col('post_identity_risk_decision', 'text', 'Post-identity risk check decision, or NULL.'),
      col(
        'account_conduct_decision',
        'text',
        'Account conduct assessment decision (APPROVED or DECLINED), or NULL.',
      ),
      col(
        'account_conduct_failed_rules',
        'text[]',
        'Ids of the account conduct rules that failed (e.g. ACCOUNT_CONDUCT_RULE_006, the G4 leakage gate), or NULL when the assessment did not record them. Label them with decline_reason_label(reason, rule_id) or join credit_rule; use unnest() to count by rule.',
      ),
      col(
        'serviceability_decision',
        'text',
        'Serviceability assessment decision (APPROVED or DECLINED), or NULL. The figures behind it are not in this schema.',
      ),
      col(
        'serviceability_failed_rules',
        'text[]',
        'Ids of the serviceability rules that failed, or NULL when the assessment did not record them. Label with decline_reason_label or credit_rule.',
      ),
      col('fraud_score', 'numeric', 'Latest fraud risk score (0 to 100), or NULL if not assessed.'),
      col(
        'fraud_severity',
        'text',
        'Latest fraud risk severity: LOW, MEDIUM, HIGH or CRITICAL, or NULL.',
      ),
      col(
        'fraud_categories',
        'text[]',
        'Latest fraud risk categories; use unnest() to count by category.',
      ),
      col('fraud_peak_score', 'numeric', 'Highest fraud score over the conversation.'),
      col('fraud_peak_severity', 'text', 'Highest fraud severity over the conversation.'),
      col('fraud_turns_assessed', 'integer', 'Messages assessed for fraud risk.'),
      col('fraud_flagged_turns', 'integer', 'Messages flagged for fraud risk.'),
      col(
        'fraud_would_halt',
        'boolean',
        'The latest fraud assessment would halt the conversation.',
      ),
      col(
        'decision_component',
        'text',
        'Credit component the latest decision came from (e.g. final_decision_rule, reapplication_block, g5_timeout_guard), or NULL.',
      ),
      col(
        'declined_components',
        'text[]',
        'Every credit component that declined (e.g. account_conduct, serviceability), not only the one the reason names, or NULL when not recorded. Use unnest() to count.',
      ),
      col('retry_eligible', 'boolean', 'The customer may reapply after this decision, if stated.'),
      col('block_reason', 'text', 'Why the attempt hit a re-application block, or NULL.'),
      col('block_message_variant', 'text', 'Which block message the customer was shown.'),
      col('block_disposition', 'text', 'How the block was resolved or classified, or NULL.'),
      col('block_manual_review', 'boolean', 'The block was flagged for manual review, or NULL.'),
      col('blocked_at', 'timestamptz', 'When the block was applied, or NULL.'),
      col('blocked_until', 'timestamptz', 'When the block ends, or NULL.'),
      col('block_clear_status', 'text', 'Status of clearing the block, or NULL.'),
      col('block_cleared_at', 'timestamptz', 'When the block was cleared, or NULL.'),
      col('block_cleared_by', 'text', 'Staff user id (not a name) who cleared the block, or NULL.'),
      col(
        'block_clear_request_id',
        'text',
        'Clear request for the block, or NULL. Join to block_clear_request.request_id.',
      ),
      col(
        'identity_link_reason',
        'text',
        'Why the attempt was linked to an existing customer (e.g. DOCUMENT_AGREE), or NULL.',
      ),
      col(
        'identity_review_band',
        'text',
        'Band of an identity review case opened for the attempt, or NULL.',
      ),
      col('identity_review_disposition', 'text', 'Outcome of that identity review case, or NULL.'),
      col('killed', 'boolean', 'Staff or the system ended the conversation. Never NULL.'),
      col(
        'kill_reason',
        'text',
        'Reason category of the kill (e.g. customer_request, fraud_abuse), or NULL.',
      ),
      col(
        'killed_by',
        'text',
        "'staff', or the system agent that ended it (e.g. system:fraudRiskAgent), or NULL.",
      ),
      col('killed_at', 'timestamptz', 'When it was ended, or NULL.'),
      col('cancelled', 'boolean', 'The application was cancelled. Never NULL.'),
      col('cancel_reason', 'text', 'Cancellation reason code, or NULL.'),
      col('cancel_category', 'text', 'customer_declined, abandoned or system_expired, or NULL.'),
      col('cancelled_at', 'timestamptz', 'When it was cancelled, or NULL.'),
      col(
        'data_quality_gate',
        'text',
        'Data quality gate that raised an alert on the statements, or NULL.',
      ),
      col(
        'earned_income_sources',
        'integer',
        'Earned income sources the data quality gate counted, or NULL.',
      ),
      col(
        'benefit_income_sources',
        'integer',
        'Benefit income sources the data quality gate counted, or NULL.',
      ),
      col(
        'llm_cost_usd',
        'numeric',
        'Total LLM cost of the conversation, USD. Per-call detail is in llm_cost.',
      ),
      col('llm_calls', 'integer', 'LLM calls made in the conversation.'),
      col('llm_unpriced_calls', 'integer', 'LLM calls with no price, so not in llm_cost_usd.'),
    ],
  },
  {
    name: 'decision',
    kind: 'view',
    grain:
      'One row per conversation that has a decision: its latest decision event. Use this for decision counts and rates.',
    columns: [
      {
        name: 'conversation_id',
        type: 'text',
        meaning: 'The application attempt. Join to application.conversation_id.',
      },
      {
        name: 'application_number',
        type: 'text',
        meaning: 'Application number, if the event carried one.',
      },
      { name: 'decision', type: 'text', meaning: 'APPROVED, DECLINED or REFERRED (upper case).' },
      { name: 'reason', type: 'text', meaning: 'Reason code; set on declines.' },
      {
        name: 'decline_category',
        type: 'text',
        meaning:
          "Category of a decline (see application.decline_category); NULL for other decisions or an unmapped NULL reason. Count NULL declines as 'other'.",
      },
      {
        name: 'retry_eligible',
        type: 'boolean',
        meaning: 'Whether the customer may reapply after this decline, if stated.',
      },
      { name: 'ruleset_version', type: 'text', meaning: 'Credit ruleset version, or NULL.' },
      {
        name: 'build_sha',
        type: 'text',
        meaning: 'Deployed build that made the decision, or NULL.',
      },
      {
        name: 'mock_origin',
        type: 'boolean',
        meaning:
          'A mock decision from a test path. Exclude from every business report: WHERE NOT mock_origin.',
      },
      {
        name: 'decided_at',
        type: 'timestamptz',
        meaning: 'When the decision was made (UTC instant).',
      },
      {
        name: 'decided_on',
        type: 'date',
        meaning: 'Sydney business day of the decision. Filter and group by this.',
      },
    ],
  },
  {
    name: 'decision_event',
    kind: 'table',
    grain:
      'One row per decision event, including revisions (a conversation can be decided more than once). Use only for revision or timing questions; for counts use decision.',
    columns: [
      {
        name: 'decision_key',
        type: 'text',
        meaning: 'Unique key of the event; duplicate deliveries are already removed.',
      },
      { name: 'event_id', type: 'text', meaning: 'Producer event id, or NULL for old events.' },
      { name: 'conversation_id', type: 'text', meaning: 'The application attempt.' },
      { name: 'application_number', type: 'text', meaning: 'Application number, if carried.' },
      { name: 'decision', type: 'text', meaning: 'APPROVED, DECLINED or REFERRED.' },
      { name: 'reason', type: 'text', meaning: 'Reason code.' },
      { name: 'retry_eligible', type: 'boolean', meaning: 'Reapply flag, if stated.' },
      { name: 'ruleset_version', type: 'text', meaning: 'Credit ruleset version, or NULL.' },
      { name: 'build_sha', type: 'text', meaning: 'Deployed build, or NULL.' },
      { name: 'mock_origin', type: 'boolean', meaning: 'Mock decision; exclude.' },
      {
        name: 'assessment_record_location',
        type: 'text',
        meaning: 'Storage location of the assessment record. Never select it into a report.',
      },
      { name: 'decided_at', type: 'timestamptz', meaning: 'When the decision was made.' },
      { name: 'decided_on', type: 'date', meaning: 'Sydney business day of the decision.' },
      {
        name: 'recorded_at',
        type: 'timestamptz',
        meaning: 'When the CRM recorded the event (not a business time).',
      },
    ],
  },
  {
    name: 'loan',
    kind: 'view',
    grain: 'One row per loan account, with the acquisition of the application it came from.',
    columns: [
      { name: 'loan_account_id', type: 'text', meaning: 'Unique loan account id.' },
      {
        name: 'application_number',
        type: 'text',
        meaning: 'Application the loan came from, or NULL.',
      },
      {
        name: 'customer_id',
        type: 'text',
        meaning: 'Customer id. Only for counting distinct customers.',
      },
      { name: 'loan_amount', type: 'numeric', meaning: 'Principal in AUD.' },
      { name: 'loan_fee', type: 'numeric', meaning: 'Fee in AUD.' },
      { name: 'total_payable', type: 'numeric', meaning: 'Principal plus fee in AUD.' },
      {
        name: 'disbursed_at',
        type: 'timestamptz',
        meaning: 'When the money was paid out, or NULL if not yet.',
      },
      {
        name: 'disbursed_on',
        type: 'date',
        meaning: 'Sydney business day of disbursement. Filter and group by this.',
      },
      {
        name: 'account_status',
        type: 'text',
        meaning: 'pending_disbursement, active, paid_off, in_arrears, written_off.',
      },
      {
        name: 'aging_bucket',
        type: 'text',
        meaning: 'current, early_arrears, late_arrears, default, closed.',
      },
      { name: 'dpd', type: 'numeric', meaning: 'Days past due now (not as at a past date).' },
      {
        name: 'in_arrears',
        type: 'boolean',
        meaning: 'In arrears now; can be NULL before aging first ran (treat as not in arrears).',
      },
      {
        name: 'total_outstanding',
        type: 'numeric',
        meaning:
          'Balance outstanding now, AUD, from the projection. Not a figure of record; use snap_portfolio for portfolio totals.',
      },
      { name: 'total_paid', type: 'numeric', meaning: 'Total repaid so far, AUD.' },
      {
        name: 'closure_reason',
        type: 'text',
        meaning: 'PAID_OFF, WRITTEN_OFF or ADMIN_CLOSED, or NULL while open.',
      },
      { name: 'closed_at', type: 'timestamptz', meaning: 'When the account closed, or NULL.' },
      {
        name: 'conversation_id',
        type: 'text',
        meaning:
          'The application attempt the loan came from, or NULL. Join to decision to exclude mock loans: LEFT JOIN decision ... WHERE mock_origin IS NOT TRUE.',
      },
      { name: 'source', type: 'text', meaning: 'utm_source of the originating application.' },
      { name: 'medium', type: 'text', meaning: 'utm_medium of the originating application.' },
      {
        name: 'channel',
        type: 'text',
        meaning: "As application.channel; 'direct' when no application matched.",
      },
      {
        name: 'acquisition',
        type: 'text',
        meaning: `${ACQUISITION} 'not recorded' also when no application matched.`,
      },
      col('opened_at', 'timestamptz', 'When the loan account was opened.'),
      col('opened_on', 'date', 'Sydney day the account was opened.'),
      col('commencement_on', 'date', 'Sydney day the loan contract commenced, or NULL.'),
      col('payment_frequency', 'text', 'Repayment frequency: weekly, fortnightly or monthly.'),
      col('number_of_payments', 'integer', 'Number of scheduled repayments.'),
      col(
        'current_balance',
        'numeric',
        'Current balance, AUD, from the projection. An operational figure, not of record.',
      ),
      col('last_payment_at', 'timestamptz', 'When the last repayment was received, or NULL.'),
      col('last_payment_on', 'date', 'Sydney day of the last repayment.'),
      col('last_payment_amount', 'numeric', 'Amount of the last repayment, AUD.'),
      col('aging_updated_at', 'timestamptz', 'When dpd and the aging bucket were last computed.'),
      col('closed_on', 'date', 'Sydney day the account closed, or NULL while open.'),
      col('status_before_closure', 'text', 'Account status just before it closed, or NULL.'),
      col('final_balance', 'numeric', 'Balance at closure, AUD, or NULL while open.'),
      col('total_paid_at_closure', 'numeric', 'Total repaid by closure, AUD, or NULL while open.'),
    ],
  },
  {
    name: 'instalment',
    kind: 'view',
    grain: 'One row per scheduled repayment instalment of a loan.',
    columns: [
      {
        name: 'loan_account_id',
        type: 'text',
        meaning: 'Loan the instalment belongs to. Join to loan.',
      },
      { name: 'payment_number', type: 'integer', meaning: '1-based instalment number.' },
      { name: 'due_date', type: 'timestamptz', meaning: 'Due date as stored.' },
      {
        name: 'due_on',
        type: 'date',
        meaning: 'Sydney day the instalment is due. Filter and group by this.',
      },
      { name: 'amount', type: 'numeric', meaning: 'Amount due, AUD.' },
      { name: 'status', type: 'text', meaning: 'scheduled, paid, missed, partial.' },
      { name: 'amount_paid', type: 'numeric', meaning: 'Amount paid against it, AUD.' },
      { name: 'amount_remaining', type: 'numeric', meaning: 'Amount still due, AUD.' },
      { name: 'paid_date', type: 'timestamptz', meaning: 'When it was paid, or NULL.' },
      { name: 'paid_on', type: 'date', meaning: 'Sydney day it was paid.' },
    ],
  },
  {
    name: 'customer',
    kind: 'view',
    grain:
      'One row per customer: identity verification, risk flags, age and location. No names, contact details, date of birth or street address.',
    columns: [
      col(
        'customer_id',
        'text',
        'Customer id. Join key to application, loan and the other views; never select it into a report.',
      ),
      col(
        'canonical_id',
        'text',
        'The customer this record resolves to after identity matching, or NULL.',
      ),
      col(
        'customer_id_status',
        'text',
        'Status of the customer id after identity resolution, as recorded.',
      ),
      col(
        'merged_into',
        'text',
        'Customer id this record was merged into, or NULL. Exclude merged records when counting customers.',
      ),
      col('created_at', 'timestamptz', 'When the CRM first recorded the customer.'),
      col('created_on', 'date', 'Sydney day the customer was first recorded.'),
      col(
        'age',
        'integer',
        'Age in whole years today, or NULL without a date of birth. Use application.age_at_application for age when applying.',
      ),
      col('state', 'text', 'Residential state, upper case (e.g. NSW), or NULL.'),
      col('postcode', 'text', 'Residential postcode, or NULL.'),
      col('country', 'text', 'Residential country, upper case, or NULL.'),
      col('identity_verified', 'boolean', 'Identity has been verified.'),
      col('ekyc_status', 'text', 'Electronic KYC status: successful, failed or pending.'),
      col('individual_status', 'text', 'LIVING, DECEASED or MISSING.'),
      col('verification_provider', 'text', 'Identity verification provider, or NULL.'),
      col(
        'verification_result',
        'text',
        'Overall identity verification result, as the provider reported it.',
      ),
      col('identity_outcome', 'text', 'Identity check outcome.'),
      col('screening_outcome', 'text', 'Watch-list screening outcome.'),
      col('pep_result', 'text', 'Politically exposed person screening result.'),
      col('sanctions_result', 'text', 'Sanctions screening result.'),
      col('verification_checked_at', 'timestamptz', 'When identity was last verified.'),
      col('staff_flag', 'boolean', 'The customer is Billie staff.'),
      col('investor_flag', 'boolean', 'The customer is a Billie investor.'),
      col('founder_flag', 'boolean', 'The customer is a Billie founder.'),
      col(
        'vulnerable_flag',
        'boolean',
        'The customer is flagged as vulnerable. Sensitive: report counts only.',
      ),
      col('fraud_risk_active', 'boolean', 'A fraud risk flag is active.'),
      col('fraud_risk_severity', 'text', 'Severity of the fraud risk flag, or NULL.'),
      col('fraud_risk_score', 'numeric', 'Fraud risk score, or NULL.'),
      col(
        'fraud_risk_categories',
        'text[]',
        'Fraud risk categories; use unnest() to count by category.',
      ),
      col('fraud_risk_flagged_at', 'timestamptz', 'When fraud risk was flagged.'),
      col('block_reason', 'text', 'Reason the customer is blocked from reapplying, or NULL.'),
      col('blocked_at', 'timestamptz', 'When the re-application block started.'),
      col('blocked_until', 'timestamptz', 'When the re-application block ends, or NULL.'),
      col('block_clear_status', 'text', 'Status of clearing the block, or NULL.'),
      col('block_cleared_at', 'timestamptz', 'When the block was cleared, or NULL.'),
      col(
        'email_tier',
        'text',
        'How strongly the email is established (verification tier), or NULL. The email itself is not in this schema.',
      ),
      col('email_source', 'text', 'Where the current email came from, or NULL.'),
      col('email_verified', 'boolean', 'The email has been verified.'),
      col('mobile_phone_tier', 'text', 'Verification tier of the mobile number, or NULL.'),
      col('mobile_phone_source', 'text', 'Where the current mobile number came from, or NULL.'),
      col('mobile_verified', 'boolean', 'The mobile number has been verified.'),
    ],
  },
  {
    name: 'collection_case',
    kind: 'view',
    grain: 'One row per collections case on a loan.',
    columns: [
      col('loan_account_id', 'text', 'The loan in collections. Join to loan.'),
      col('customer_id', 'text', 'Customer id; only for counting distinct customers.'),
      col('state', 'text', 'open, awaiting_human or cured.'),
      col('hardship_paused', 'boolean', 'Collections paused for hardship.'),
      col('stopped_contact', 'boolean', 'The customer asked collections to stop contacting them.'),
      col('overdue_amount', 'numeric', 'Amount overdue, AUD, as at the last update.'),
      col('days_overdue', 'integer', 'Days overdue as at the last update.'),
      col('last_step', 'integer', 'Last collections step taken.'),
      col('rung', 'integer', 'Collections ladder rung the case is on.'),
      col('due_date', 'timestamptz', 'Due date of the missed instalment that opened the case.'),
      col('due_on', 'date', 'Sydney day of due_date.'),
      col('opened_at', 'timestamptz', 'When the case opened.'),
      col('opened_on', 'date', 'Sydney day the case opened. Filter and group by this.'),
      col('cured_at', 'timestamptz', 'When the arrears were cured, or NULL.'),
      col('cured_on', 'date', 'Sydney day the arrears were cured.'),
      col('exhausted_at', 'timestamptz', 'When the collections ladder was exhausted, or NULL.'),
      col('paused_at', 'timestamptz', 'When the case was last paused, or NULL.'),
      col('resumed_at', 'timestamptz', 'When the case last resumed, or NULL.'),
      col('stop_contact_at', 'timestamptz', 'When contact was stopped, or NULL.'),
      col('updated_at', 'timestamptz', 'When the case last changed.'),
    ],
  },
  {
    name: 'write_off',
    kind: 'view',
    grain: 'One row per write-off request, whatever its outcome.',
    columns: [
      col('request_id', 'text', 'Unique id of the request.'),
      col('request_number', 'text', 'Human-readable request number.'),
      col('loan_account_id', 'text', 'Loan to write off. Join to loan.'),
      col('customer_id', 'text', 'Customer id; only for counting distinct customers.'),
      col('amount', 'numeric', 'Amount requested to write off, AUD.'),
      col('original_balance', 'numeric', 'Balance when the request was made, AUD.'),
      col(
        'reason',
        'text',
        'hardship, bankruptcy, deceased, unable_to_locate, fraud_victim, disputed, aged_debt or other.',
      ),
      col(
        'status',
        'text',
        'pending, approved, rejected or cancelled. Only approved requests were written off.',
      ),
      col('priority', 'text', 'normal, high or urgent.'),
      col('requires_senior_approval', 'boolean', 'The amount needed senior approval.'),
      col('requested_by', 'text', STAFF),
      col('requested_at', 'timestamptz', 'When the request was made.'),
      col('requested_on', 'date', 'Sydney day of the request.'),
      col('decided_by', 'text', STAFF),
      col('decided_at', 'timestamptz', 'When it was approved or rejected, or NULL.'),
      col('approved_by', 'text', STAFF),
      col('approved_at', 'timestamptz', 'When it was approved, or NULL.'),
      col('approved_on', 'date', 'Sydney day it was approved: the write-off date.'),
      col('rejected_by', 'text', STAFF),
      col('rejected_at', 'timestamptz', 'When it was rejected, or NULL.'),
      col('cancelled_by', 'text', STAFF),
      col('cancelled_at', 'timestamptz', 'When it was cancelled, or NULL.'),
    ],
  },
  {
    name: 'block_clear_request',
    kind: 'view',
    grain: "One row per request to clear a customer's re-application block.",
    columns: [
      col('request_id', 'text', 'Unique id of the request.'),
      col('request_number', 'text', 'Human-readable request number.'),
      col('customer_id', 'text', 'Canonical customer id; only for counting distinct customers.'),
      col(
        'conversation_id',
        'text',
        'Application attempt that was blocked, or NULL. Join to application.',
      ),
      col(
        'reasons',
        'text[]',
        'Block reasons the request clears (e.g. SERVICEABILITY); use unnest() to count.',
      ),
      col('status', 'text', 'pending, approved, rejected or cancelled.'),
      col('requested_by', 'text', STAFF),
      col('requested_at', 'timestamptz', 'When the request was made.'),
      col('requested_on', 'date', 'Sydney day of the request.'),
      col('approved_by', 'text', STAFF),
      col('approved_at', 'timestamptz', 'When it was approved, or NULL.'),
      col('rejected_by', 'text', STAFF),
      col('rejected_at', 'timestamptz', 'When it was rejected, or NULL.'),
      col('cancelled_by', 'text', STAFF),
      col('cancelled_at', 'timestamptz', 'When it was cancelled, or NULL.'),
    ],
  },
  {
    name: 'notification',
    kind: 'view',
    grain:
      'One row per notification event to a customer (email or SMS): sends, failures, blocks, statements and suppression changes. No recipient or content.',
    columns: [
      col('notification_id', 'text', 'Unique id of the notification.'),
      col('customer_id', 'text', 'Customer id; only for counting distinct customers.'),
      col(
        'status',
        'text',
        "sent, failed, blocked, statement or suppression_change. Count sends with status = 'sent'.",
      ),
      col('channel', 'text', 'email or sms.'),
      col('template_name', 'text', 'Template used.'),
      col('provider', 'text', 'Delivery provider.'),
      col('category', 'text', 'Notification category (e.g. collections, servicing).'),
      col('reason', 'text', 'Why it was sent, as tagged by the sender.'),
      col('step', 'integer', 'Collections step it belongs to, or NULL.'),
      col('event_at', 'timestamptz', 'When the notification event happened.'),
      col('sent_at', 'timestamptz', 'When it was sent, or NULL.'),
      col('sent_on', 'date', 'Sydney day it was sent. Filter and group by this.'),
      col('failed_at', 'timestamptz', 'When sending failed, or NULL.'),
      col(
        'error_type',
        'text',
        'Failure type: transient, permanent, auth, template, contact_missing, opt_out or suppressed.',
      ),
      col('attempt', 'integer', 'Attempt number of a failure.'),
      col('fallback_suggested', 'text', 'Channel suggested after a failure, or NULL.'),
      col('statement_loan_account_id', 'text', 'Loan a statement was for, or NULL. Join to loan.'),
      col('statement_period_start', 'timestamptz', 'Start of a statement period.'),
      col('statement_period_end', 'timestamptz', 'End of a statement period.'),
      col('statement_dispatched_at', 'timestamptz', 'When a statement was dispatched.'),
      col(
        'suppression_mode',
        'text',
        'Suppression set by a suppression_change: all, non_essential, marketing_only, panic_button or off.',
      ),
      col('suppression_set_at', 'timestamptz', 'When the suppression was set.'),
      col('suppression_expires_at', 'timestamptz', 'When the suppression ends, or NULL.'),
      col('created_at', 'timestamptz', 'When the CRM recorded it.'),
      col('created_on', 'date', 'Sydney day the CRM recorded it.'),
    ],
  },
  {
    name: 'llm_cost',
    kind: 'view',
    grain: 'One row per LLM call made in an application conversation.',
    columns: [
      col('conversation_id', 'text', 'Application attempt. Join to application.'),
      col('seq', 'integer', 'Order of the call within its log stream.'),
      col('model', 'text', 'Model called.'),
      col('agent_name', 'text', 'Agent that made the call.'),
      col('service_tier', 'text', 'Service tier of the call, or NULL.'),
      col('prompt_tokens', 'bigint', 'Input tokens.'),
      col('completion_tokens', 'bigint', 'Output tokens.'),
      col('cached_tokens', 'bigint', 'Input tokens served from cache.'),
      col('reasoning_tokens', 'bigint', 'Reasoning tokens.'),
      col('total_tokens', 'bigint', 'All tokens.'),
      col('response_time_ms', 'integer', 'Response time in milliseconds.'),
      col(
        'cost_usd',
        'numeric',
        'Cost in USD (computed from the rate card, else as logged). NULL when unpriced.',
      ),
      col('priced', 'boolean', 'A price was found for the model.'),
      col('has_usage', 'boolean', 'The call reported token usage.'),
      col('called_at', 'timestamptz', 'When the call was made.'),
      col('called_on', 'date', 'Sydney day of the call. Filter and group by this.'),
    ],
  },
  {
    name: 'contact_note',
    kind: 'view',
    grain: 'One row per staff contact note: the kind of contact, never its subject or text.',
    columns: [
      col('note_id', 'text', 'Unique id of the note.'),
      col('customer_id', 'text', 'Customer id; only for counting distinct customers.'),
      col('loan_account_id', 'text', 'Loan the note is about, or NULL.'),
      col('conversation_id', 'text', 'Application attempt the note is about, or NULL.'),
      col('channel', 'text', 'phone, email, sms, internal or system.'),
      col(
        'topic',
        'text',
        'general_enquiry, complaint, escalation, internal_note, account_update or collections.',
      ),
      col('direction', 'text', 'inbound or outbound, or NULL.'),
      col('priority', 'text', 'low, normal, high or urgent.'),
      col('sentiment', 'text', 'positive, neutral, negative or escalation, or NULL.'),
      col('status', 'text', 'active, or amended (superseded by a later note).'),
      col('created_by', 'text', STAFF),
      col(
        'amends_note_id',
        'text',
        'Note this one amends, or NULL. Count only active notes to avoid double counting.',
      ),
      col('created_at', 'timestamptz', 'When the note was written.'),
      col('created_on', 'date', 'Sydney day the note was written. Filter and group by this.'),
    ],
  },
  {
    name: 'snap_portfolio',
    kind: 'table',
    grain:
      'One row per Sydney business day: the ledger portfolio figures as at that day. The figures of record for balances.',
    columns: [
      { name: 'as_at_date', type: 'date', meaning: 'Sydney business day the figures are as at.' },
      {
        name: 'total_active_accounts',
        type: 'integer',
        meaning: 'Active loan accounts per the ledger.',
      },
      { name: 'principal_receivable', type: 'numeric', meaning: 'Principal receivable, AUD.' },
      { name: 'fees_receivable', type: 'numeric', meaning: 'Fees receivable, AUD.' },
      { name: 'total_receivables', type: 'numeric', meaning: 'Total receivables, AUD.' },
      {
        name: 'ledger_generated_at',
        type: 'timestamptz',
        meaning: 'When the ledger produced the figures.',
      },
      { name: 'captured_at', type: 'timestamptz', meaning: 'When the CRM copied them.' },
    ],
  },
  {
    name: 'data_freshness',
    kind: 'view',
    grain:
      'One row: how recent the reporting data is. Not for reports; the Reports view shows it beside each result.',
    columns: [
      {
        name: 'latest_change_at',
        type: 'timestamptz',
        meaning: 'The latest application started or loan changed that the CRM has recorded.',
      },
    ],
  },
  {
    name: 'decline_reason_category',
    kind: 'table',
    grain:
      'One row per reason-code prefix and its category. Rarely needed: decline_category is already on application and decision.',
    columns: [
      { name: 'prefix', type: 'text', meaning: 'Reason code prefix.' },
      {
        name: 'category',
        type: 'text',
        meaning: 'capacity, character, identity, eligibility or other.',
      },
    ],
  },
  {
    name: 'credit_rule',
    kind: 'table',
    grain:
      'One row per credit rule billieChat can fail an application on: its family and a short label. Join to the ids in application.account_conduct_failed_rules and serviceability_failed_rules, or call decline_reason_label.',
    columns: [
      {
        name: 'rule_id',
        type: 'text',
        meaning: 'Rule id as billieChat records it, e.g. ACCOUNT_CONDUCT_RULE_006.',
      },
      {
        name: 'family',
        type: 'text',
        meaning:
          'account_conduct, serviceability, statement_check, post_identity_risk or final_decision.',
      },
      {
        name: 'label',
        type: 'text',
        meaning: 'Short label, e.g. "Data quality gate G4, leakage ratio".',
      },
    ],
  },
]

export const REPORTING_FUNCTIONS: readonly string[] = [
  'reporting.sydney_date(timestamptz) -> date: the Sydney calendar day of an instant.',
  'reporting.acquisition_channel(jsonb) -> text: the channel of an attribution object (already applied in the views).',
  'reporting.decline_category(text) -> text: the category of a reason code (already applied in the views).',
  'reporting.as_numeric(text), as_boolean(text), as_timestamptz(text): read a JSON value, NULL when it is malformed (already applied in the views).',
  'reporting.loan_purpose_category(text) -> text: the category of a loan purpose (already applied in the views).',
  'reporting.attribution_text(text) -> text: an attribution (utm_*) value with only printable characters, cut at 80 (already applied in the views).',
  "reporting.decline_reason_label(reason text, rule_id text) -> text: how a decline reads in a report. With a rule id, the rule's family and label from credit_rule (e.g. 'Account conduct: Data quality gate G4, leakage ratio'); without one, the reason code in words (e.g. 'Re-application block: active loan'). Use it so every report names a reason the same way.",
  "reporting.reason_words(text) -> text: a reason code's tail as lower-case words (used by decline_reason_label).",
]

export const BUSINESS_RULES: readonly string[] = [
  'Business days are Sydney days. Filter and group dates with the *_on columns, never by casting a *_at column to date (that gives the UTC day).',
  'A decision rate counts each application once, using its latest decision: use the decision view, not decision_event.',
  'Exclude mock decisions everywhere: join decision and keep rows where mock_origin IS NOT TRUE (NOT mock_origin when every row has a decision). Exclude loans from mock approvals the same way.',
  'Funded means disbursed (application.funded / loan.disbursed_on), not approved.',
  'A rate is a fraction of a stated denominator. Name rate columns *_rate (0 to 1) or *_pct (0 to 100), and guard division with NULLIF(denominator, 0).',
  'Money of record comes from snap_portfolio. Sums of loan.total_outstanding are operational estimates; say so in the description if you use them.',
  'Never select names, contact details, customer_id, application_number, staff user ids or storage locations into a result; count or group them instead. Sensitive flags (vulnerable_flag, pep_hit, fraud) are reported as counts, never per customer.',
  'Acquisition: group by the acquisition column. referral means another website referred the visitor; the referral programme is not in this schema.',
  'When grouping, add a total row only if every listed column can be summed or recomputed for the total; label it All.',
]

/** The description as text, for the prompt. */
export function renderSchemaDescription(): string {
  const lines: string[] = [
    `# The reporting schema (${SCHEMA_DESCRIPTION_VERSION})`,
    '',
    'Reports read only this schema. Unqualified names resolve in it; you may also write reporting.<name>.',
    '',
    '## Business rules',
    ...BUSINESS_RULES.map((r) => `- ${r}`),
    '',
    '## Functions',
    ...REPORTING_FUNCTIONS.map((f) => `- ${f}`),
    '',
  ]
  for (const table of REPORTING_TABLES) {
    lines.push(`## ${table.name} (${table.kind})`, table.grain, '')
    for (const c of table.columns) lines.push(`- ${c.name} ${c.type}: ${c.meaning}`)
    for (const n of table.notes ?? []) lines.push(`- Note: ${n}`)
    lines.push('')
  }
  return lines.join('\n')
}
