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

export const SCHEMA_DESCRIPTION_VERSION = 'reporting-desc-v1'

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
        meaning: 'utm_source of the visit that started the attempt, or NULL.',
      },
      { name: 'medium', type: 'text', meaning: 'utm_medium, or NULL.' },
      { name: 'campaign', type: 'text', meaning: 'utm_campaign, or NULL.' },
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
          'Latest credit decision: approved, declined, referred, or no_decision. Includes mock decisions; exclude them by joining decision and filtering NOT mock_origin (keep attempts with no decision row).',
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
]

export const REPORTING_FUNCTIONS: readonly string[] = [
  'reporting.sydney_date(timestamptz) -> date: the Sydney calendar day of an instant.',
  'reporting.acquisition_channel(jsonb) -> text: the channel of an attribution object (already applied in the views).',
  'reporting.decline_category(text) -> text: the category of a reason code (already applied in the views).',
]

export const BUSINESS_RULES: readonly string[] = [
  'Business days are Sydney days. Filter and group dates with the *_on columns, never by casting a *_at column to date (that gives the UTC day).',
  'A decision rate counts each application once, using its latest decision: use the decision view, not decision_event.',
  'Exclude mock decisions everywhere: join decision and keep rows where mock_origin IS NOT TRUE (NOT mock_origin when every row has a decision). Exclude loans from mock approvals the same way.',
  'Funded means disbursed (application.funded / loan.disbursed_on), not approved.',
  'A rate is a fraction of a stated denominator. Name rate columns *_rate (0 to 1) or *_pct (0 to 100), and guard division with NULLIF(denominator, 0).',
  'Money of record comes from snap_portfolio. Sums of loan.total_outstanding are operational estimates; say so in the description if you use them.',
  'Never select names, contact details, customer_id, application_number or storage locations into a result; count them instead.',
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
