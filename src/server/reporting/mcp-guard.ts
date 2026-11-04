/**
 * Row cap on ad-hoc query results over the MCP connector (ADR 0002).
 *
 * The restricted findings (PEP and sanctions screening, the vulnerability
 * flag, fraud, kill reasons) are kept from the connector by the database:
 * its login, `reporting_mcp_reader`, has no grant on those columns, so no
 * query can read them, by alias, filter or join. See `mcpReaderGrants` in
 * `schema.ts`. What is left here is volume: a result that carries an
 * identifier column (`customer_id`, `conversation_id`, any `*_id`,
 * `application_number`…) is cut to `MCP_IDENTIFIER_ROW_CAP` rows, so a tool
 * call cannot list the book. It matches on column names, so an alias gets
 * around the cap; the query log keeps the SQL.
 *
 * Published reports (`run_report`) are reviewed before they are published
 * and are not capped here. Neither is the Reports view, whose rows stay in
 * the CRM.
 */

/** Rows a tool call may return when the result identifies people, accounts or applications. */
export const MCP_IDENTIFIER_ROW_CAP = 50

/** Columns that identify a customer, application, loan, case or staff member. */
const IDENTIFIER_NAMES = new Set(['id', 'application_number', 'merged_into', 'canonical_id'])
const IDENTIFIER_SUFFIX = /(^|_)id$/i

export const isIdentifierColumn = (name: string): boolean =>
  IDENTIFIER_NAMES.has(name.toLowerCase()) || IDENTIFIER_SUFFIX.test(name)

export interface McpResultCheck {
  rows: Array<Record<string, unknown>>
  cut: boolean
  identifiers: string[]
}

/** Cut a result that identifies people or accounts to the identifier row cap. */
export function checkMcpResult(
  columns: ReadonlyArray<{ name: string }>,
  rows: Array<Record<string, unknown>>,
): McpResultCheck {
  const identifiers = columns.map((c) => c.name).filter(isIdentifierColumn)
  if (identifiers.length > 0 && rows.length > MCP_IDENTIFIER_ROW_CAP) {
    return { rows: rows.slice(0, MCP_IDENTIFIER_ROW_CAP), cut: true, identifiers }
  }
  return { rows, cut: false, identifiers }
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
