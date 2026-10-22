/**
 * Nightly copy of the ledger's portfolio figures into reporting.snap_portfolio
 * (BTB-504).
 *
 * Money of record belongs to the ledger, so reports read these copied figures
 * and never sum balances themselves. Amounts arrive from gRPC as decimal
 * strings and are stored as `numeric` from the string, never through a
 * JavaScript number.
 */
import type { PortfolioSummaryResponse } from '@/server/grpc-client'

export interface PortfolioSnapshotRow {
  asAtDate: string
  totalActiveAccounts: number
  principalReceivable: string
  feesReceivable: string
  totalReceivables: string
  ledgerGeneratedAt: Date | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DECIMAL_RE = /^-?\d+(\.\d+)?$/

/**
 * Validate a ledger portfolio summary and shape it as a snapshot row.
 *
 * @throws Error when the ledger returns a malformed date or amount, so a bad
 *   response is reported rather than stored.
 */
export function toSnapshotRow(
  summary: PortfolioSummaryResponse,
  requestedDate: string,
): PortfolioSnapshotRow {
  const asAtDate = summary.asOfDate || requestedDate
  if (!DATE_RE.test(asAtDate)) {
    throw new Error(`ledger returned an invalid as_of_date: ${JSON.stringify(asAtDate)}`)
  }
  for (const [name, value] of [
    ['principal_receivable', summary.principalReceivable],
    ['fees_receivable', summary.feesReceivable],
    ['total_receivables', summary.totalReceivables],
  ] as const) {
    if (!DECIMAL_RE.test(value ?? '')) {
      throw new Error(`ledger returned an invalid ${name}: ${JSON.stringify(value)}`)
    }
  }
  const totalActiveAccounts = Number(summary.totalActiveAccounts)
  if (!Number.isInteger(totalActiveAccounts) || totalActiveAccounts < 0) {
    throw new Error(
      `ledger returned an invalid total_active_accounts: ${JSON.stringify(summary.totalActiveAccounts)}`,
    )
  }
  const seconds = summary.generatedAt?.seconds
  return {
    asAtDate,
    totalActiveAccounts,
    principalReceivable: summary.principalReceivable,
    feesReceivable: summary.feesReceivable,
    totalReceivables: summary.totalReceivables,
    ledgerGeneratedAt: seconds ? new Date(Number(seconds) * 1000) : null,
  }
}

export interface SnapshotPool {
  query: (text: string, params?: unknown[]) => Promise<unknown>
}

/** Store a snapshot; a re-run for the same day replaces that day's row. */
export async function saveSnapshot(pool: SnapshotPool, row: PortfolioSnapshotRow): Promise<void> {
  await pool.query(
    `INSERT INTO reporting.snap_portfolio
       (as_at_date, total_active_accounts, principal_receivable, fees_receivable,
        total_receivables, ledger_generated_at, captured_at)
     VALUES ($1, $2, $3::numeric, $4::numeric, $5::numeric, $6, now())
     ON CONFLICT (as_at_date) DO UPDATE SET
       total_active_accounts = EXCLUDED.total_active_accounts,
       principal_receivable  = EXCLUDED.principal_receivable,
       fees_receivable       = EXCLUDED.fees_receivable,
       total_receivables     = EXCLUDED.total_receivables,
       ledger_generated_at   = EXCLUDED.ledger_generated_at,
       captured_at           = now()`,
    [
      row.asAtDate,
      row.totalActiveAccounts,
      row.principalReceivable,
      row.feesReceivable,
      row.totalReceivables,
      row.ledgerGeneratedAt,
    ],
  )
}
