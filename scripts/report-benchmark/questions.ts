/**
 * The AI-authored reports benchmark question set (BTB-508).
 *
 * 40 questions from BTB-460 (go-to-market), BTB-462 (decline reasons), the
 * PRD and staff requests, each with reference SQL over the reporting schema
 * and the TEST data in `seed.ts`. Units are stated in each question so
 * equivalence (`compare.ts`) is unambiguous.
 *
 * Status: DRAFT. Per the R&D protocol, each reference query must be written
 * by one engineer and reviewed by a second before results count. These were
 * drafted with Claude Code; record `author` and `reviewer` as each is
 * checked, and set `reviewed: true`.
 */

export type QuestionSource = 'BTB-460' | 'BTB-462' | 'PRD' | 'staff'

export interface BenchmarkQuestion {
  id: string
  source: QuestionSource
  question: string
  /** Reference SQL with literal dates, or null when the schema cannot answer it. */
  referenceSql: string | null
  author: string
  reviewer: string | null
  reviewed: boolean
}

const DRAFT = { author: 'Claude Code (draft)', reviewer: null, reviewed: false }

const q = (
  id: string,
  source: QuestionSource,
  question: string,
  referenceSql: string | null,
): BenchmarkQuestion => ({ id, source, question, referenceSql, ...DRAFT })

/** Decisions with mock decisions removed. */
const DECIDED = 'FROM decision AS d WHERE NOT d.mock_origin'

export const QUESTIONS: readonly BenchmarkQuestion[] = [
  // ── BTB-462: declines ────────────────────────────────────────────────
  q(
    'Q01',
    'BTB-462',
    'What was the decline rate, as a fraction of decided applications, for decisions made in September 2026?',
    `SELECT round(count(*) FILTER (WHERE d.decision = 'DECLINED')::numeric / count(*), 4) AS decline_rate
       ${DECIDED} AND d.decided_on BETWEEN '2026-09-01' AND '2026-09-30'`,
  ),
  q(
    'Q02',
    'BTB-462',
    'Decline rate by acquisition group for decisions made in October 2026, as a fraction of decided applications.',
    `SELECT a.acquisition,
            round(count(*) FILTER (WHERE d.decision = 'DECLINED')::numeric / count(*), 4) AS decline_rate
       FROM decision AS d JOIN application AS a USING (conversation_id)
      WHERE NOT d.mock_origin AND d.decided_on BETWEEN '2026-10-01' AND '2026-10-31'
      GROUP BY 1`,
  ),
  q(
    'Q03',
    'BTB-462',
    'How many declines were there in each decline reason category for decisions made in September 2026? Count declines with no recorded reason as other.',
    `SELECT COALESCE(d.decline_category, 'other') AS category, count(*) AS declines
       ${DECIDED} AND d.decision = 'DECLINED' AND d.decided_on BETWEEN '2026-09-01' AND '2026-09-30'
      GROUP BY 1`,
  ),
  q(
    'Q04',
    'BTB-462',
    'Decline rate by credit ruleset version across all decisions, as a fraction of decided applications.',
    `SELECT d.ruleset_version,
            round(count(*) FILTER (WHERE d.decision = 'DECLINED')::numeric / count(*), 4) AS decline_rate
       ${DECIDED}
      GROUP BY 1`,
  ),
  q(
    'Q05',
    'BTB-462',
    'The five most common decline reason codes for decisions made in October 2026, with how many declines each had.',
    `SELECT d.reason, count(*) AS declines
       ${DECIDED} AND d.decision = 'DECLINED' AND d.reason IS NOT NULL
        AND d.decided_on BETWEEN '2026-10-01' AND '2026-10-31'
      GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5`,
  ),
  q(
    'Q06',
    'BTB-462',
    'Of the declines decided in October 2026, what fraction were marked eligible to retry?',
    `SELECT round(count(*) FILTER (WHERE d.retry_eligible)::numeric / count(*), 4) AS retry_eligible_share
       ${DECIDED} AND d.decision = 'DECLINED' AND d.decided_on BETWEEN '2026-10-01' AND '2026-10-31'`,
  ),
  q(
    'Q07',
    'BTB-462',
    'How many applications had their credit decision revised (decided more than once) in September or October 2026?',
    `SELECT count(*) AS revised_applications FROM (
       SELECT conversation_id FROM decision_event
        WHERE NOT mock_origin AND decided_on BETWEEN '2026-09-01' AND '2026-10-31'
        GROUP BY 1 HAVING count(*) > 1) AS r`,
  ),
  q(
    'Q08',
    'BTB-462',
    'Median minutes from starting an application to its latest decision, for decisions made in October 2026, to one decimal place.',
    `SELECT round(percentile_cont(0.5) WITHIN GROUP (
              ORDER BY extract(epoch FROM d.decided_at - a.started_at) / 60)::numeric, 1) AS median_minutes
       FROM decision AS d JOIN application AS a USING (conversation_id)
      WHERE NOT d.mock_origin AND d.decided_on BETWEEN '2026-10-01' AND '2026-10-31'`,
  ),
  q(
    'Q09',
    'BTB-462',
    'Decline rate for each Sydney day from 1 to 7 October 2026, as a fraction of that day’s decisions.',
    `SELECT d.decided_on,
            round(count(*) FILTER (WHERE d.decision = 'DECLINED')::numeric / count(*), 4) AS decline_rate
       ${DECIDED} AND d.decided_on BETWEEN '2026-10-01' AND '2026-10-07'
      GROUP BY 1`,
  ),
  q(
    'Q10',
    'BTB-462',
    'Number of decisions and declines by deployed build for decisions made in October 2026.',
    `SELECT d.build_sha, count(*) AS decided, count(*) FILTER (WHERE d.decision = 'DECLINED') AS declined
       ${DECIDED} AND d.decided_on BETWEEN '2026-10-01' AND '2026-10-31'
      GROUP BY 1`,
  ),

  // ── BTB-460: go-to-market ────────────────────────────────────────────
  q(
    'Q11',
    'BTB-460',
    'How many applications were started on each Sydney day in September 2026?',
    `SELECT a.started_on, count(*) AS started
       FROM application AS a LEFT JOIN decision AS d USING (conversation_id)
      WHERE d.mock_origin IS NOT TRUE AND a.started_on BETWEEN '2026-09-01' AND '2026-09-30' GROUP BY 1`,
  ),
  q(
    'Q12',
    'BTB-460',
    'Pass rate (approved as a fraction of decided) by acquisition group for applications started in October 2026, excluding mock decisions.',
    `SELECT a.acquisition,
            round(count(*) FILTER (WHERE d.decision = 'APPROVED')::numeric / count(*), 4) AS pass_rate
       FROM application AS a JOIN decision AS d USING (conversation_id)
      WHERE NOT d.mock_origin AND a.started_on BETWEEN '2026-10-01' AND '2026-10-31'
      GROUP BY 1`,
  ),
  q(
    'Q13',
    'BTB-460',
    'Funded rate (funded as a fraction of started) by acquisition group for applications started in September and October 2026, excluding mock decisions.',
    `SELECT a.acquisition, round(count(*) FILTER (WHERE a.funded)::numeric / count(*), 4) AS funded_rate
       FROM application AS a LEFT JOIN decision AS d USING (conversation_id)
      WHERE d.mock_origin IS NOT TRUE AND a.started_on BETWEEN '2026-09-01' AND '2026-10-31'
      GROUP BY 1`,
  ),
  q(
    'Q14',
    'BTB-460',
    'What fraction of applications started in October 2026 came from a referring website?',
    `SELECT round(count(*) FILTER (WHERE a.acquisition = 'referral')::numeric / count(*), 4) AS referral_share
       FROM application AS a LEFT JOIN decision AS d USING (conversation_id)
      WHERE d.mock_origin IS NOT TRUE AND a.started_on BETWEEN '2026-10-01' AND '2026-10-31'`,
  ),
  q(
    'Q15',
    'BTB-460',
    'Median hours from starting an application to the money being paid out, for loans funded in October 2026, to one decimal place. Exclude mock approvals.',
    `SELECT round(percentile_cont(0.5) WITHIN GROUP (
              ORDER BY extract(epoch FROM a.funded_at - a.started_at) / 3600)::numeric, 1) AS median_hours
       FROM application AS a LEFT JOIN decision AS d USING (conversation_id)
      WHERE a.funded AND d.mock_origin IS NOT TRUE
        AND a.funded_on BETWEEN '2026-10-01' AND '2026-10-31'`,
  ),
  q(
    'Q16',
    'BTB-460',
    'Applications started in October 2026 by campaign, for applications that had a campaign.',
    `SELECT a.campaign, count(*) AS started
       FROM application AS a LEFT JOIN decision AS d USING (conversation_id)
      WHERE d.mock_origin IS NOT TRUE AND a.campaign IS NOT NULL AND a.started_on BETWEEN '2026-10-01' AND '2026-10-31' GROUP BY 1`,
  ),
  q(
    'Q17',
    'BTB-460',
    'For applications started in October 2026, how many were started, submitted, decided, approved and funded? Exclude mock decisions.',
    `SELECT count(*) AS started, count(*) FILTER (WHERE a.submitted) AS submitted,
            count(*) FILTER (WHERE a.decided) AS decided, count(*) FILTER (WHERE a.approved) AS approved,
            count(*) FILTER (WHERE a.funded) AS funded
       FROM application AS a LEFT JOIN decision AS d USING (conversation_id)
      WHERE d.mock_origin IS NOT TRUE AND a.started_on BETWEEN '2026-10-01' AND '2026-10-31'`,
  ),
  q(
    'Q18',
    'BTB-460',
    'How many applications started in October 2026 were approved but have not been funded? Exclude mock approvals.',
    `SELECT count(*) AS approved_not_funded
       FROM application AS a JOIN decision AS d USING (conversation_id)
      WHERE NOT d.mock_origin AND a.approved AND NOT a.funded
        AND a.started_on BETWEEN '2026-10-01' AND '2026-10-31'`,
  ),
  q(
    'Q19',
    'BTB-460',
    'Applications started per week (weeks starting Monday, Sydney dates) in September and October 2026, with the Monday of each week.',
    `SELECT date_trunc('week', a.started_on)::date AS week_start, count(*) AS started
       FROM application AS a LEFT JOIN decision AS d USING (conversation_id)
      WHERE d.mock_origin IS NOT TRUE AND a.started_on BETWEEN '2026-09-01' AND '2026-10-31' GROUP BY 1`,
  ),
  q(
    'Q20',
    'BTB-460',
    'Applications started in October 2026 by acquisition group, distinguishing applications before attribution was recorded.',
    `SELECT a.acquisition, count(*) AS started
       FROM application AS a LEFT JOIN decision AS d USING (conversation_id)
      WHERE d.mock_origin IS NOT TRUE AND a.started_on BETWEEN '2026-10-01' AND '2026-10-31' GROUP BY 1`,
  ),

  // ── PRD ──────────────────────────────────────────────────────────────
  q(
    'Q21',
    'PRD',
    'Total principal disbursed on each Sydney day in October 2026, excluding loans from mock approvals.',
    `SELECT l.disbursed_on, sum(l.loan_amount) AS principal
       FROM loan AS l LEFT JOIN decision AS d ON d.conversation_id = l.conversation_id
      WHERE d.mock_origin IS NOT TRUE AND l.disbursed_on BETWEEN '2026-10-01' AND '2026-10-31'
      GROUP BY 1`,
  ),
  q(
    'Q22',
    'PRD',
    'Number of loans disbursed and average loan amount (two decimals) by acquisition group, for loans disbursed in September and October 2026, excluding mock approvals.',
    `SELECT l.acquisition, count(*) AS loans, round(avg(l.loan_amount), 2) AS average_amount
       FROM loan AS l LEFT JOIN decision AS d ON d.conversation_id = l.conversation_id
      WHERE d.mock_origin IS NOT TRUE AND l.disbursed_on BETWEEN '2026-09-01' AND '2026-10-31'
      GROUP BY 1`,
  ),
  q(
    'Q23',
    'PRD',
    'How many loans are in arrears now, by aging bucket?',
    `SELECT l.aging_bucket, count(*) AS loans
       FROM loan AS l LEFT JOIN decision AS d ON d.conversation_id = l.conversation_id
      WHERE d.mock_origin IS NOT TRUE AND l.in_arrears GROUP BY 1`,
  ),
  q(
    'Q24',
    'PRD',
    'For loans disbursed in September 2026, what fraction are in arrears now, by acquisition group? Exclude mock approvals.',
    `SELECT l.acquisition, round(count(*) FILTER (WHERE l.in_arrears)::numeric / count(*), 4) AS arrears_rate
       FROM loan AS l LEFT JOIN decision AS d ON d.conversation_id = l.conversation_id
      WHERE d.mock_origin IS NOT TRUE AND l.disbursed_on BETWEEN '2026-09-01' AND '2026-09-30'
      GROUP BY 1`,
  ),
  q(
    'Q25',
    'PRD',
    'How many instalments were due from 5 to 11 October 2026, and how many of them have been paid in full?',
    `SELECT count(*) AS due, count(*) FILTER (WHERE status = 'paid') AS paid
       FROM instalment WHERE due_on BETWEEN '2026-10-05' AND '2026-10-11'`,
  ),
  q(
    'Q26',
    'PRD',
    'Number of missed instalments by Sydney due day in October 2026.',
    `SELECT due_on, count(*) AS missed FROM instalment
      WHERE status = 'missed' AND due_on BETWEEN '2026-10-01' AND '2026-10-31' GROUP BY 1`,
  ),
  q(
    'Q27',
    'PRD',
    'Total receivables for each day in October 2026, from the ledger figures.',
    `SELECT as_at_date, total_receivables FROM snap_portfolio
      WHERE as_at_date BETWEEN '2026-10-01' AND '2026-10-31'`,
  ),
  q(
    'Q28',
    'PRD',
    'By how much did total receivables change between 1 October and 31 October 2026, per the ledger?',
    `SELECT (SELECT total_receivables FROM snap_portfolio WHERE as_at_date = '2026-10-31')
          - (SELECT total_receivables FROM snap_portfolio WHERE as_at_date = '2026-10-01') AS change`,
  ),
  q(
    'Q29',
    'PRD',
    'How many loans have been written off, and what principal did they have? Exclude mock approvals.',
    `SELECT count(*) AS loans, COALESCE(sum(l.loan_amount), 0) AS principal
       FROM loan AS l LEFT JOIN decision AS d ON d.conversation_id = l.conversation_id
      WHERE d.mock_origin IS NOT TRUE AND l.account_status = 'written_off'`,
  ),
  q(
    'Q30',
    'PRD',
    'Average days past due of loans currently in arrears, to one decimal place.',
    `SELECT round(avg(l.dpd), 1) AS average_dpd
       FROM loan AS l LEFT JOIN decision AS d ON d.conversation_id = l.conversation_id
      WHERE d.mock_origin IS NOT TRUE AND l.in_arrears`,
  ),

  // ── Staff requests ───────────────────────────────────────────────────
  q(
    'Q31',
    'staff',
    'How many applications were started on each Sydney day from 2 to 5 October 2026?',
    `SELECT a.started_on, count(*) AS started
       FROM application AS a LEFT JOIN decision AS d USING (conversation_id)
      WHERE d.mock_origin IS NOT TRUE AND a.started_on BETWEEN '2026-10-02' AND '2026-10-05' GROUP BY 1`,
  ),
  q(
    'Q32',
    'staff',
    'How many decisions in October 2026 were made between 22:00 and midnight Sydney time? Exclude mock decisions.',
    `SELECT count(*) AS late_decisions
       ${DECIDED} AND d.decided_on BETWEEN '2026-10-01' AND '2026-10-31'
        AND extract(hour FROM d.decided_at AT TIME ZONE 'Australia/Sydney') >= 22`,
  ),
  q(
    'Q33',
    'staff',
    'How many distinct customers started more than one application in September and October 2026?',
    `SELECT count(*) AS repeat_customers FROM (
       SELECT a.customer_id
         FROM application AS a LEFT JOIN decision AS d USING (conversation_id)
        WHERE d.mock_origin IS NOT TRUE AND a.customer_id IS NOT NULL
          AND a.started_on BETWEEN '2026-09-01' AND '2026-10-31'
        GROUP BY 1 HAVING count(*) > 1) AS r`,
  ),
  q(
    'Q34',
    'staff',
    'How many mock decisions were made in October 2026?',
    `SELECT count(*) AS mock_decisions FROM decision
      WHERE mock_origin AND decided_on BETWEEN '2026-10-01' AND '2026-10-31'`,
  ),
  q(
    'Q35',
    'staff',
    'Applications declined for capacity reasons in October 2026, by acquisition group.',
    `SELECT a.acquisition, count(*) AS capacity_declines
       FROM decision AS d JOIN application AS a USING (conversation_id)
      WHERE NOT d.mock_origin AND d.decision = 'DECLINED' AND d.decline_category = 'capacity'
        AND d.decided_on BETWEEN '2026-10-01' AND '2026-10-31'
      GROUP BY 1`,
  ),
  q(
    'Q36',
    'staff',
    'For instalments due in September 2026, what fraction of the amount due has been paid?',
    `SELECT round(sum(amount_paid) / sum(amount), 4) AS collected_fraction
       FROM instalment WHERE due_on BETWEEN '2026-09-01' AND '2026-09-30'`,
  ),
  q(
    'Q37',
    'staff',
    'How many loans have been paid off, by the month they were disbursed (first day of the month)? Exclude mock approvals.',
    `SELECT date_trunc('month', l.disbursed_on)::date AS month, count(*) AS paid_off
       FROM loan AS l LEFT JOIN decision AS d ON d.conversation_id = l.conversation_id
      WHERE d.mock_origin IS NOT TRUE AND l.account_status = 'paid_off'
      GROUP BY 1`,
  ),
  q(
    'Q38',
    'staff',
    'Approval rate (approved as a fraction of decided) by Sydney weekday name for decisions made in October 2026.',
    `SELECT trim(to_char(d.decided_on, 'Day')) AS weekday,
            round(count(*) FILTER (WHERE d.decision = 'APPROVED')::numeric / count(*), 4) AS approval_rate
       ${DECIDED} AND d.decided_on BETWEEN '2026-10-01' AND '2026-10-31'
      GROUP BY 1`,
  ),
  q(
    'Q39',
    'staff',
    'How many applications decided in September and October 2026 were referred?',
    `SELECT count(*) AS referred ${DECIDED}
        AND d.decision = 'REFERRED' AND d.decided_on BETWEEN '2026-09-01' AND '2026-10-31'`,
  ),
  q(
    'Q40',
    'BTB-460',
    'What was the cash cost per funded customer in October 2026?',
    null, // Not answerable: no ad spend in the reporting schema.
  ),
]

/** Ten correct definitions mixed with ten carrying a seeded semantic error, for the reviewer test. */
export interface SeededDefinition {
  questionId: string
  sql: string
  /** null when correct; otherwise the error a reviewer should catch. */
  seededError: string | null
}

const ref = (id: string): string => QUESTIONS.find((x) => x.id === id)?.referenceSql ?? ''

export const REVIEWER_SET: readonly SeededDefinition[] = [
  { questionId: 'Q01', sql: ref('Q01'), seededError: null },
  {
    questionId: 'Q02',
    sql: ref('Q02').replace('NOT d.mock_origin AND ', ''),
    seededError: 'Mock decisions are counted',
  },
  { questionId: 'Q03', sql: ref('Q03'), seededError: null },
  {
    questionId: 'Q04',
    sql: ref('Q04').replace('FROM decision AS d', 'FROM decision_event AS d'),
    seededError: 'Counts every revision of a decision, not each application once',
  },
  { questionId: 'Q18', sql: ref('Q18'), seededError: null },
  {
    questionId: 'Q11',
    // Explicitly UTC, so the error does not depend on the session time zone.
    sql: ref('Q11')
      .replace(
        'SELECT a.started_on,',
        "SELECT (a.started_at AT TIME ZONE 'UTC')::date AS started_on,",
      )
      .replace(
        "a.started_on BETWEEN '2026-09-01' AND '2026-09-30' GROUP BY 1",
        "(a.started_at AT TIME ZONE 'UTC')::date BETWEEN '2026-09-01' AND '2026-09-30' GROUP BY 1",
      ),
    seededError: 'Groups by the UTC day, not the Sydney day',
  },
  { questionId: 'Q12', sql: ref('Q12'), seededError: null },
  {
    questionId: 'Q13',
    sql: ref('Q13').replace('FILTER (WHERE a.funded)', 'FILTER (WHERE a.approved)'),
    seededError: 'Treats approved as funded',
  },
  { questionId: 'Q15', sql: ref('Q15'), seededError: null },
  {
    questionId: 'Q14',
    sql: ref('Q14').replace(
      "a.acquisition = 'referral'",
      "a.channel = 'referral' OR a.acquisition = 'not recorded'",
    ),
    seededError: 'Counts pre-capture applications as referrals',
  },
  { questionId: 'Q21', sql: ref('Q21'), seededError: null },
  {
    questionId: 'Q22',
    sql: ref('Q22').replace('round(avg(l.loan_amount), 2)', 'round(avg(l.total_payable), 2)'),
    seededError: 'Averages the amount payable (with fee), not the loan amount',
  },
  { questionId: 'Q25', sql: ref('Q25'), seededError: null },
  {
    questionId: 'Q24',
    sql: ref('Q24').replace("'2026-09-30'", "'2026-10-31'"),
    seededError: 'Covers loans disbursed in October too',
  },
  { questionId: 'Q32', sql: ref('Q32'), seededError: null },
  {
    questionId: 'Q36',
    sql: ref('Q36').replace('sum(amount_paid) / sum(amount)', 'avg(amount_paid / amount)'),
    seededError: 'Averages per-instalment fractions instead of dividing totals',
  },
  { questionId: 'Q38', sql: ref('Q38'), seededError: null },
  {
    questionId: 'Q39',
    sql: ref('Q39').replace("d.decision = 'REFERRED'", "d.decision <> 'APPROVED'"),
    seededError: 'Counts declines as referrals',
  },
  { questionId: 'Q17', sql: ref('Q17'), seededError: null },
  {
    questionId: 'Q09',
    sql: ref('Q09').replace("'2026-10-07'", "'2026-10-08'"),
    seededError: 'Includes 8 October',
  },
]
