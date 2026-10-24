/**
 * Row-level guard on ad-hoc query results over the MCP connector (security
 * review M1; ADR 0001).
 *
 * The reporting schema keeps a few attributes per customer that the
 * reporting rules say appear in reports only as counts: PEP and sanctions
 * screening results, the vulnerability flag, fraud risk, and the
 * quasi-identifiers age and postcode. Over MCP, result rows are read by a
 * model outside the CRM, so the rule is enforced here rather than left to
 * the author:
 *
 * - a result that carries an identifier column (`customer_id`,
 *   `conversation_id`, any `*_id`, `application_number`…) together with a
 *   sensitive column is refused: aggregate instead;
 * - a result that carries an identifier column is cut to
 *   `MCP_IDENTIFIER_ROW_CAP` rows, so a tool call cannot list the book.
 *
 * Published reports (`run_report`) are reviewed by a supervisor before they
 * are published and are not subject to this guard. Neither is the Reports
 * view, whose rows stay in the CRM.
 */

/** Rows a tool call may return when the result identifies people, accounts or applications. */
export const MCP_IDENTIFIER_ROW_CAP = 50

/** Columns that identify a customer, application, loan, case or staff member. */
const IDENTIFIER_NAMES = new Set(['id', 'application_number', 'merged_into', 'canonical_id'])
const IDENTIFIER_SUFFIX = /(^|_)id$/i

/** Columns the reporting rules allow only as counts. */
export const SENSITIVE_COLUMNS: ReadonlySet<string> = new Set([
  'age',
  'age_at_application',
  'postcode',
  'pep_result',
  'pep_hit',
  'sanctions_result',
  'screening_outcome',
  'vulnerable_flag',
  'fraud_risk_active',
  'fraud_risk_severity',
  'fraud_risk_score',
  'fraud_risk_categories',
  'fraud_risk_flagged_at',
  'fraud_score',
  'fraud_severity',
  'fraud_categories',
  'fraud_peak_score',
  'fraud_peak_severity',
  'fraud_would_halt',
  'block_reason',
])

export const isIdentifierColumn = (name: string): boolean =>
  IDENTIFIER_NAMES.has(name.toLowerCase()) || IDENTIFIER_SUFFIX.test(name)

export const isSensitiveColumn = (name: string): boolean =>
  SENSITIVE_COLUMNS.has(name.toLowerCase())

export type McpResultCheck =
  | { ok: true; rows: Array<Record<string, unknown>>; cut: boolean; identifiers: string[] }
  | { ok: false; code: 'ROW_LEVEL'; message: string }

/**
 * Apply the guard to a result. Refuses identifier-plus-sensitive results;
 * caps identifier-bearing ones.
 */
export function checkMcpResult(
  columns: ReadonlyArray<{ name: string }>,
  rows: Array<Record<string, unknown>>,
): McpResultCheck {
  const identifiers = columns.map((c) => c.name).filter(isIdentifierColumn)
  const sensitive = columns.map((c) => c.name).filter(isSensitiveColumn)
  if (identifiers.length > 0 && sensitive.length > 0) {
    return {
      ok: false,
      code: 'ROW_LEVEL',
      message:
        `The result lists ${sensitive.join(', ')} per ${identifiers.join(', ')}. ` +
        'Screening, vulnerability, fraud, age and postcode are reported as counts only: ' +
        'group by a category or period and count, and leave the identifier out.',
    }
  }
  if (identifiers.length > 0 && rows.length > MCP_IDENTIFIER_ROW_CAP) {
    return { ok: true, rows: rows.slice(0, MCP_IDENTIFIER_ROW_CAP), cut: true, identifiers }
  }
  return { ok: true, rows, cut: false, identifiers }
}

/**
 * One ad-hoc query in flight per actor (a key or a connection), so one agent
 * cannot hold every connection in the MCP pool.
 */
const inFlight = new Set<string>()

export function acquireQuerySlot(actor: string): boolean {
  if (inFlight.has(actor)) return false
  inFlight.add(actor)
  return true
}

export function releaseQuerySlot(actor: string): void {
  inFlight.delete(actor)
}
