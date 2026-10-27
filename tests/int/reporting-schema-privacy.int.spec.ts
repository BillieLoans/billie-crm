/**
 * The reporting schema carries the CRM's data without the personal parts.
 *
 * Seeds one customer journey with distinctive personal details everywhere the
 * CRM keeps them, including inside the JSON the views read (the customer block
 * of application_data, account holders and BSBs in the affordability report,
 * fraud signals quoting the customer, a staff kill note, an IP address), then
 * checks that the views expose the non-personal fields and that no row of any
 * reporting view contains a single one of those details. Also checks that a
 * malformed JSON value reads as NULL instead of breaking the view.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { getDashboardPool, type QueryablePool } from '@/lib/dashboard-aggregates'

let payload: Payload
let pool: QueryablePool
let staffId = ''

const P = 'RPTPII'

/** Details that must never appear in reporting. */
const PERSONAL = {
  first: 'Zebedee',
  last: 'Quixotic',
  email: 'zebedee.quixotic@example.test',
  phone: '+61400111222',
  street: 'Wombat Wobble Way',
  suburb: 'Yarrawonga',
  dob: '1990-02-14',
  bsb: '062-913',
  account: '99887766',
  ip: '203.0.113.77',
  signal: 'my cousin will lend me the deposit',
  note: 'Customer said she is moving to Perth',
  holder: 'Z QUIXOTIC',
  payer: 'name:z quixotic senior',
  clickId: 'Cj0KCQjwRPTPIIclick',
  purpose: 'tablets for my sick mother',
}

async function cleanup() {
  await pool.query(`DELETE FROM contact_notes WHERE subject LIKE $1`, [`${P}%`])
  await pool.query(`DELETE FROM notifications WHERE notification_id LIKE $1`, [`${P}%`])
  await pool.query(`DELETE FROM llm_costs WHERE stream_id LIKE $1`, [`${P}%`])
  await pool.query(`DELETE FROM write_off_requests WHERE request_id LIKE $1`, [`${P}%`])
  await pool.query(`DELETE FROM reapplication_block_clear_requests WHERE request_id LIKE $1`, [
    `${P}%`,
  ])
  await pool.query(`DELETE FROM collection_cases WHERE account_id LIKE $1`, [`${P}%`])
  await pool.query(`DELETE FROM loan_accounts WHERE loan_account_id LIKE $1`, [`${P}%`])
  await pool.query(`DELETE FROM conversations WHERE conversation_id LIKE $1`, [`${P}%`])
  await pool.query(`DELETE FROM applications WHERE application_number LIKE $1`, [`${P}%`])
  await pool.query(`DELETE FROM customers WHERE customer_id LIKE $1`, [`${P}%`])
  await pool.query(`DELETE FROM users WHERE email LIKE 'rptpii-%'`)
}

beforeAll(async () => {
  payload = await getPayload({ config })
  pool = getDashboardPool(payload) as QueryablePool
  await cleanup()
  const staff = await payload.create({
    collection: 'users',
    data: {
      email: `rptpii-${Date.now()}@billie.loans`,
      password: 'Test1234!',
      role: 'supervisor',
      firstName: 'Staff',
      lastName: 'Member',
    },
  })
  staffId = String(staff.id)

  const customer = `${P}-CUS`
  const { rows: cus } = await pool.query(
    `INSERT INTO customers
       (customer_id, first_name, last_name, full_name, email_address, mobile_phone_number,
        date_of_birth, residential_address_street, residential_address_suburb,
        residential_address_state, residential_address_postcode, residential_address_full_address,
        identity_verified, vulnerable_flag, fraud_risk_categories, fraud_risk_score)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, 'nsw', '2714', $10, true, true,
             '["PROMPT_INJECTION"]'::jsonb, 80)
     RETURNING id`,
    [
      customer,
      PERSONAL.first,
      PERSONAL.last,
      `${PERSONAL.first} ${PERSONAL.last}`,
      PERSONAL.email,
      PERSONAL.phone,
      PERSONAL.dob,
      PERSONAL.street,
      PERSONAL.suburb,
      `${PERSONAL.street}, ${PERSONAL.suburb}`,
    ],
  )
  await pool.query(
    `INSERT INTO applications (application_number, loan_purpose, loan_amount, loan_term)
     VALUES ($1, $2, 400, 4)`,
    [`${P}-APP`, PERSONAL.purpose],
  )
  const customerBlock = {
    firstName: PERSONAL.first,
    lastName: PERSONAL.last,
    emailAddress: PERSONAL.email,
    mobilePhoneNumber: PERSONAL.phone,
    dateOfBirth: PERSONAL.dob,
    residentialAddress: { street: PERSONAL.street, suburb: PERSONAL.suburb },
  }
  const { rows: conv } = await pool.query(
    `INSERT INTO conversations
       (conversation_id, application_number, customer_id_string, status, started_at, version,
        attribution, network, application_data, statement_capture, assessments_identity_risk,
        assessments_fraud_check, kill_record, cancellation_record, data_quality_alert,
        statement_account_holders, identity_verification_attempts)
     VALUES ($1, $2, $3, 'hard_end', '2026-10-20T01:00:00Z', 1, $4, $5, $6, $7, $8, $9, $10,
             $11, $12, $13, $14)
     RETURNING id`,
    [
      `${P}-CONV`,
      `${P}-APP`,
      customer,
      JSON.stringify({
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_content: 'ad-1',
        utm_term: 'pay advance',
        gclid: PERSONAL.clickId,
        captured_at: '2026-10-20T01:00:05Z',
      }),
      JSON.stringify({ ip: PERSONAL.ip, country: 'AU', asn: '1221' }),
      JSON.stringify({
        loanPurpose: PERSONAL.purpose,
        loanAmount: 'lots',
        customer: customerBlock,
      }),
      JSON.stringify({
        consentStatus: 'complete',
        retrievalComplete: true,
        accountHolders: [PERSONAL.holder],
        affordabilityReport: {
          summary: {
            total_accounts: 2,
            account_holders: [PERSONAL.holder],
            salary_summary: {
              number_of_salary_sources: 1,
              accounts: {
                a1: {
                  details: { holder: PERSONAL.holder, number: PERSONAL.account, bsb: PERSONAL.bsb },
                },
              },
            },
          },
        },
      }),
      JSON.stringify({
        decision: 'APPROVED',
        pep_hit: false,
        identity_verification_failed: 'not-a-boolean',
        checkedCustomer: customerBlock,
      }),
      JSON.stringify({
        latest: {
          final_score: 72,
          severity: 'HIGH',
          categories: ['PROMPT_INJECTION'],
          would_halt: true,
          rationale: `Says ${PERSONAL.signal}`,
          signals: [PERSONAL.signal],
        },
        peak_score: 72,
        turns_assessed: 5,
        flagged_count: 2,
      }),
      JSON.stringify({
        reason_category: 'fraud_abuse',
        actor: `user:${staffId}`,
        note: PERSONAL.note,
        killed_at: 'yesterday',
      }),
      JSON.stringify({ reason: 'CUSTOMER_DECLINED', category: 'customer_declined' }),
      JSON.stringify({
        gate: 'me001_implausibility',
        earned_source_count: 0,
        sources: [{ payer: PERSONAL.payer, credits: 4, total: 289 }],
      }),
      PERSONAL.holder,
      JSON.stringify({ 'lab-1': { attempt_number: 1 }, 'lab-2': { attempt_number: 2 } }),
    ],
  )
  // The credit assessment results and decision evidence: only the rule ids
  // and component names may reach the schema.
  await pool.query(
    `UPDATE conversations
        SET assessments_account_conduct = $2::jsonb,
            assessments_serviceability = $3::jsonb,
            decision_metadata = $4::jsonb
      WHERE conversation_id = $1`,
    [
      `${P}-CONV`,
      JSON.stringify({
        decision: 'DECLINED',
        failed_rules: ['ACCOUNT_CONDUCT_RULE_006'],
        file_location: `s3://assessments/${PERSONAL.first}/account_conduct.json`,
        notes: PERSONAL.note,
      }),
      JSON.stringify({
        decision: 'DECLINED',
        failed_rules: ['SERVICEABILITY_RULE_001'],
        file_location: `s3://assessments/${PERSONAL.first}/serviceability.json`,
      }),
      JSON.stringify({
        component: 'account_conduct',
        declined_components: ['account_conduct', 'serviceability'],
        detail_location: `s3://assessments/${PERSONAL.first}/decision.json`,
        account_names: [PERSONAL.holder],
      }),
    ],
  )
  const { rows: loan } = await pool.query(
    `INSERT INTO loan_accounts
       (loan_account_id, account_number, customer_id_string, account_status, application_number,
        disbursement_account_holder, disbursement_account_bsb, disbursement_account_number,
        repayment_schedule_payment_frequency, repayment_schedule_number_of_payments)
     VALUES ($1, 'ACC-RPTPII', $2, 'active', $3, $4, $5, $6, 'fortnightly', 4)
     RETURNING id`,
    [`${P}-LOAN`, customer, `${P}-APP`, PERSONAL.holder, PERSONAL.bsb, PERSONAL.account],
  )
  await pool.query(
    `INSERT INTO collection_cases (account_id, customer_id, state, overdue_amount, days_overdue)
     VALUES ($1, $2, 'open', 120, 9)`,
    [`${P}-LOAN`, customer],
  )
  await pool.query(
    `INSERT INTO write_off_requests
       (request_id, loan_account_id, customer_id, customer_name, account_number, amount,
        reason, status, notes, requested_by_id, requested_by_name, approval_details_comment)
     VALUES ($1, $2, $3, $4, $5, 50, 'hardship', 'pending', $6, $7, 'Staff Member', $6)`,
    [
      `${P}-WO`,
      `${P}-LOAN`,
      customer,
      `${PERSONAL.first} ${PERSONAL.last}`,
      PERSONAL.account,
      PERSONAL.note,
      staffId,
    ],
  )
  await pool.query(
    `INSERT INTO reapplication_block_clear_requests
       (request_id, canonical_customer_id, conversation_id, customer_name, reasons,
        justification, status, requested_by_id, requested_by_name)
     VALUES ($1, $2, $3, $4, '["SERVICEABILITY"]'::jsonb, $5, 'pending', $6, 'Staff Member')`,
    [`${P}-BCR`, customer, `${P}-CONV`, PERSONAL.first, PERSONAL.note, staffId],
  )
  await pool.query(
    `INSERT INTO notifications
       (notification_id, customer_id, status, channel, template_name, event_at, sent_at,
        recipient_hash, failure_error_message, suppression_reason)
     VALUES ($1, $2, 'sent', 'sms', 'reminder', now(), now(), 'hash-of-phone', $3, $3)`,
    [`${P}-N1`, customer, `Could not reach ${PERSONAL.phone}`],
  )
  await pool.query(
    `INSERT INTO llm_costs (stream_id, conversation_id, model, total_tokens, computed_cost_usd, called_at)
     VALUES ($1, $2, 'claude', 1000, 0.02, now())`,
    [`${P}-S1`, `${P}-CONV`],
  )
  await pool.query(
    `INSERT INTO contact_notes
       (subject, content, topic, channel, created_by_id, customer_id, loan_account_id, conversation_id)
     VALUES ($1, $2::jsonb, 'collections', 'phone', $3, $4, $5, $6)`,
    [
      `${P} ${PERSONAL.note}`,
      JSON.stringify({ text: PERSONAL.note }),
      staffId,
      cus[0].id,
      loan[0].id,
      conv[0].id,
    ],
  )
}, 60_000)

afterAll(async () => {
  await cleanup()
})

describe('reporting schema privacy', () => {
  it('exposes the non-personal fields of the journey', async () => {
    const { rows: app } = await pool.query(
      `SELECT * FROM reporting.application WHERE conversation_id = $1`,
      [`${P}-CONV`],
    )
    expect(app[0]).toMatchObject({
      loan_purpose_category: 'health',
      requested_amount: '400',
      loan_term: 4,
      content: 'ad-1',
      keyword: 'pay advance',
      click_id_type: 'gclid',
      country: 'AU',
      statement_consent_status: 'complete',
      statements_retrieved: true,
      bank_accounts: 2,
      salary_sources: 1,
      identity_risk_decision: 'APPROVED',
      pep_hit: false,
      identity_attempts: 2,
      account_conduct_failed_rules: ['ACCOUNT_CONDUCT_RULE_006'],
      serviceability_failed_rules: ['SERVICEABILITY_RULE_001'],
      decision_component: 'account_conduct',
      declined_components: ['account_conduct', 'serviceability'],
      fraud_score: '72',
      fraud_severity: 'HIGH',
      fraud_categories: ['PROMPT_INJECTION'],
      fraud_would_halt: true,
      killed: true,
      kill_reason: 'fraud_abuse',
      killed_by: 'staff',
      cancelled: true,
      cancel_category: 'customer_declined',
      data_quality_gate: 'me001_implausibility',
      earned_income_sources: 0,
    })
    expect(new Date(app[0].attribution_captured_at).toISOString()).toBe('2026-10-20T01:00:05.000Z')
    // 36 on 20 Oct 2026, from a 14 Feb 1990 date of birth.
    expect(app[0].age_at_application).toBe(36)

    const { rows: cus } = await pool.query(
      `SELECT * FROM reporting.customer WHERE customer_id = $1`,
      [`${P}-CUS`],
    )
    expect(cus[0]).toMatchObject({
      state: 'NSW',
      postcode: '2714',
      identity_verified: true,
      vulnerable_flag: true,
      fraud_risk_categories: ['PROMPT_INJECTION'],
    })

    const { rows: wo } = await pool.query(
      `SELECT requested_by, reason, status FROM reporting.write_off WHERE request_id = $1`,
      [`${P}-WO`],
    )
    expect(wo[0]).toEqual({ requested_by: staffId, reason: 'hardship', status: 'pending' })
    const { rows: bcr } = await pool.query(
      `SELECT reasons FROM reporting.block_clear_request WHERE request_id = $1`,
      [`${P}-BCR`],
    )
    expect(bcr[0].reasons).toEqual(['SERVICEABILITY'])
    const { rows: note } = await pool.query(
      `SELECT topic, loan_account_id, created_by FROM reporting.contact_note WHERE conversation_id = $1`,
      [`${P}-CONV`],
    )
    expect(note[0]).toEqual({
      topic: 'collections',
      loan_account_id: `${P}-LOAN`,
      created_by: staffId,
    })
  })

  it('reads a malformed JSON value as NULL instead of failing', async () => {
    const { rows } = await pool.query(
      `SELECT identity_verification_failed, killed_at FROM reporting.application
        WHERE conversation_id = $1`,
      [`${P}-CONV`],
    )
    // 'not-a-boolean' and 'yesterday' in the source.
    expect(rows[0]).toEqual({ identity_verification_failed: null, killed_at: null })
  })

  it('never exposes a personal detail, in any view', async () => {
    const { rows: views } = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'reporting'`,
    )
    for (const { table_name: view } of views as Array<{ table_name: string }>) {
      const { rows } = await pool.query(
        `SELECT string_agg(row_to_json(v)::text, '\n') AS text FROM reporting.${view} v`,
      )
      const text = String(rows[0]?.text ?? '')
      for (const [kind, value] of Object.entries(PERSONAL)) {
        expect([view, kind, text.includes(value)]).toEqual([view, kind, false])
      }
      // Dates of birth only appear as an age.
      expect([view, text.includes('1990-02-14')]).toEqual([view, false])
    }
  })
})
