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

  // Reconciliation
  reconciled: boolean
  reconciliationNotes?: string

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
