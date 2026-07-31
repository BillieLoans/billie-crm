import { useMutation, useQueryClient } from '@tanstack/react-query'

/**
 * Anomaly detected during period close preview
 */
export interface PeriodCloseAnomaly {
  // gRPC (previewPeriodClose) returns these as camelCase of the proto fields
  // anomaly_id / anomaly_type (keepCase:false) — NOT `id` / `type`.
  anomalyId: string
  anomalyType: string
  severity: string
  accountId: string
  customerIdString?: string
  accountNumber?: string
  description: string
  acknowledged: boolean
  acknowledgedBy?: string
  acknowledgedAt?: string
}

/**
 * ECL bucket breakdown
 */
export interface ECLBucketSummary {
  bucket: string
  accountCount: number
  eclAmount: number
  carryingAmount: number
  pdRate: number
}

/**
 * Period close preview response from the Ledger service
 */
export interface PeriodClosePreview {
  previewId: string
  periodDate: string
  expiresAt: string // ISO timestamp, preview TTL (4 hours)
  status: 'pending' | 'ready' | 'expired'

  // Summary totals
  totalAccounts: number
  totalAccruedYield: number
  totalECLAllowance: number
  totalCarryingAmount: number

  // ECL breakdown
  eclByBucket: ECLBucketSummary[]

  // Movement from prior period
  priorPeriodECL?: number
  eclChange?: number
  eclChangePercent?: number
  movementByCause?: {
    cause: string
    amount: number
    accountCount: number
  }[]
  movementByBucket?: {
    bucket: string
    inCount: number
    outCount: number
    netChange: number
  }[]

  // Anomalies
  anomalies: PeriodCloseAnomaly[]
  anomalyCount: number
  acknowledgedCount: number

  // Reconciliation — split per BTB-249 into two independent signals that the
  // platform's ReconciliationResult proto now reports separately:
  //   1. `integrity` — dollar-level GL integrity (Σ customer sub-ledger balances
  //      vs portfolio control accounts). This is the AUTHORITATIVE correctness
  //      signal: a real integrity failure means the books don't balance.
  //   2. `accountSetDiscrepancyCount` — account-SET parity (accounts present in
  //      the ECL index but not the accrual index, or vice versa). This drifts
  //      routinely and is informational only — accrual rows are removed once fee
  //      accrual completes, so a nonzero count here does not imply a dollar
  //      problem.
  reconciled: boolean
  reconciliationNotes?: string
  /**
   * Account-set parity discrepancy count (see field 2 above). The mapper always
   * populates this (defaults to 0) — this field predates BTB-249 and existing
   * platform servers already send it. Optional on the type only so
   * hand-constructed fixtures/back-compat callers that predate this field don't
   * need updating; treat a missing value as 0.
   */
  accountSetDiscrepancyCount?: number
  /**
   * Dollar-level GL integrity result (see field 1 above). `undefined` when the
   * platform server predates BTB-249: `integrity_passed`/
   * `integrity_discrepancy_count` are plain proto3 scalars with no presence
   * tracking, so an old server's absent fields are wire-indistinguishable from
   * an explicit `integrityPassed=false, integrityDiscrepancyCount=0`. The
   * platform guarantees a genuine integrity failure always carries
   * `discrepancyCount >= 1` (IntegrityResult.is_valid=False requires at least
   * one discrepancy), so `passed !== true && discrepancyCount === 0` can only be
   * the legacy/unset case — never a real failure — and is mapped to `undefined`
   * here so the wizard falls back to the single legacy banner.
   */
  integrity?: {
    passed: boolean
    discrepancyCount: number
  }

  // Journal preview
  journalEntries: {
    type: string
    description: string
    debitAccount: string
    creditAccount: string
    amount: number
  }[]
}

interface PreviewRequest {
  periodDate: string // ISO date, e.g. "2026-01-31"
  requestedBy: string
}

/**
 * Mutation hook to generate a period close preview.
 *
 * @example
 * ```tsx
 * const { generatePreview, isPending } = usePeriodClosePreview()
 *
 * const handleGenerate = async () => {
 *   const preview = await generatePreview({
 *     periodDate: '2026-01-31',
 *     requestedBy: userId
 *   })
 *   setPreview(preview)
 * }
 * ```
 */
export function usePeriodClosePreview() {
  const queryClient = useQueryClient()

  const mutation = useMutation<PeriodClosePreview, Error, PreviewRequest>({
    mutationFn: async (request) => {
      const res = await fetch('/api/period-close/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.message || 'Failed to generate preview')
      }
      return res.json()
    },
    onSuccess: () => {
      // Invalidate closed periods in case this affects display
      queryClient.invalidateQueries({ queryKey: ['period-close'] })
    },
  })

  return {
    generatePreview: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  }
}

export default usePeriodClosePreview
