import type { Payload } from 'payload'
import type { PeriodClosePreview } from '@/hooks/mutations/usePeriodClosePreview'
import type { FinalizeResponse } from '@/hooks/mutations/useFinalizePeriodClose'

/** Parse a Decimal-as-string (or number) into a finite number, defaulting to 0. */
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Map the raw AccountingLedger `previewPeriodClose` gRPC response (proto fields
 * camelCased by proto-loader, money/rates as Decimal strings, movement nested under
 * `eclMovement`) into the CRM's flat PeriodClosePreview shape.
 */
export async function mapPreviewResponse(r: any, payload: Payload): Promise<PeriodClosePreview> {
  const m = r?.eclMovement
  const recon = r?.reconciliation
  const anomalies = Array.isArray(r?.anomalies) ? r.anomalies : []

  // Enrich each anomaly with its account's customerIdString so the UI can link to the
  // customer-keyed servicing route (anomaly.accountId is a loan-account id, not a customer id).
  const accountIds = [...new Set(anomalies.map((a: any) => a?.accountId).filter(Boolean))]
  let customerByAccount: Record<string, string> = {}
  if (accountIds.length > 0) {
    const accts = await payload.find({
      collection: 'loan-accounts',
      where: { loanAccountId: { in: accountIds } },
      limit: accountIds.length,
      depth: 0,
      pagination: false,
      overrideAccess: true,
    })
    customerByAccount = Object.fromEntries(
      accts.docs.map((d: any) => [d.loanAccountId, d.customerIdString]).filter(([, c]) => c),
    )
  }
  const enrichedAnomalies = anomalies.map((a: any) => ({
    ...a,
    customerIdString: customerByAccount[a?.accountId] ?? undefined,
  }))

  // BTB-249 dollar-integrity vs account-set-parity discriminator.
  //
  // `integrity_passed` / `integrity_discrepancy_count` (ReconciliationResult
  // proto fields 8/9) are plain proto3 scalars with NO presence tracking, so a
  // platform server that predates BTB-249 is wire-indistinguishable from one
  // that explicitly reports integrityPassed=false, integrityDiscrepancyCount=0.
  //
  // The platform invariant (verified in the platform review) is: a genuine
  // integrity failure always carries discrepancyCount >= 1 — integrity_passed
  // is derived from IntegrityResult.is_valid, which is False only when there is
  // at least one discrepancy, and the platform sets
  // integrity_discrepancy_count = len(discrepancies). So a real failure can
  // never report a count of 0.
  //
  // Therefore: `integrityPassed !== true && integrityDiscrepancyCount === 0` is
  // only reachable via the legacy/unset default (old server, or field omitted
  // in a hand-built response) — never a genuine failure — and is treated as
  // LEGACY/UNKNOWN here (`integrity: undefined`), so the wizard falls back to
  // today's single reconciliation banner instead of asserting a false failure.
  const integrityDiscrepancyCount = num(recon?.integrityDiscrepancyCount)
  const isKnownIntegrityResult = recon?.integrityPassed === true || integrityDiscrepancyCount > 0

  return {
    previewId: r?.previewId ?? '',
    periodDate: r?.periodDate ?? '',
    expiresAt: r?.expiresAt ?? '',
    status: 'ready',
    totalAccounts: r?.totalAccounts ?? 0,
    totalAccruedYield: num(r?.totalAccruedYield),
    totalECLAllowance: num(r?.totalEclAllowance),
    totalCarryingAmount: num(r?.totalCarryingAmount),
    eclByBucket: (Array.isArray(r?.eclByBucket) ? r.eclByBucket : []).map((b: any) => ({
      bucket: b?.bucket ?? '',
      accountCount: b?.accountCount ?? 0,
      eclAmount: num(b?.totalEcl),
      carryingAmount: num(b?.totalCarryingAmount),
      pdRate: num(b?.averagePdRate),
    })),
    priorPeriodECL: m ? num(m.priorTotalEcl) : undefined,
    eclChange: m ? num(m.netChange) : undefined,
    eclChangePercent: m ? num(m.changePercent) : undefined,
    movementByCause: (Array.isArray(m?.byCause) ? m.byCause : []).map((c: any) => ({
      cause: c?.cause ?? '',
      amount: num(c?.amount),
      accountCount: 0, // ledger does not provide a per-cause account count
    })),
    movementByBucket: (Array.isArray(m?.byBucket) ? m.byBucket : []).map((b: any) => ({
      bucket: b?.bucket ?? '',
      inCount: b?.accountsEntered ?? 0,
      outCount: b?.accountsExited ?? 0,
      netChange: num(b?.netChange),
    })),
    anomalies: enrichedAnomalies, // gRPC anomaly objects already use anomalyId/anomalyType (matches PeriodCloseAnomaly)
    anomalyCount: anomalies.length,
    acknowledgedCount: anomalies.filter((a: any) => a?.acknowledged).length,
    reconciled: recon?.isReconciled ?? false,
    reconciliationNotes: undefined,
    accountSetDiscrepancyCount: num(recon?.discrepancyCount),
    integrity: isKnownIntegrityResult
      ? { passed: recon?.integrityPassed === true, discrepancyCount: integrityDiscrepancyCount }
      : undefined,
    journalEntries: [], // ledger returns journal entries only at finalize, not preview
  }
}

/**
 * Map the raw `finalizePeriodClose` gRPC response (JournalEntry uses entryId/entryType,
 * totals are Decimal strings, total_ecl_allowance -> totalEclAllowance) into FinalizeResponse.
 */
export function mapFinalizeResponse(r: any): FinalizeResponse {
  return {
    success: r?.success ?? false,
    periodDate: r?.periodDate ?? '',
    finalizedAt: r?.finalizedAt ?? '',
    totalAccounts: r?.totalAccounts ?? 0,
    totalECLAllowance: num(r?.totalEclAllowance),
    totalAccruedYield: num(r?.totalAccruedYield),
    journalEntries: (Array.isArray(r?.journalEntries) ? r.journalEntries : []).map((j: any) => ({
      id: j?.entryId ?? '',
      type: j?.entryType ?? '',
      description: j?.description ?? '',
      debitAccount: j?.debitAccount ?? '',
      creditAccount: j?.creditAccount ?? '',
      amount: num(j?.amount),
      createdAt: j?.createdAt ?? '',
    })),
  }
}
