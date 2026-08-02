import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

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
        const errorMessage =
          (typeof error.details === 'string' && error.details) ||
          (typeof error.error === 'string' && error.error) ||
          (typeof error.error?.message === 'string' && error.error.message) ||
          error.message ||
          'Failed to generate preview'
        throw new Error(errorMessage)
      }
      return res.json()
    },
    onSuccess: () => {
      // Invalidate closed periods in case this affects display
      queryClient.invalidateQueries({ queryKey: ['period-close'] })
    },
    onError: (error) => {
      // No success toast here: generating a preview is a read, not a commitment, and
      // the wizard already advances to a full "Preview Summary" step on success — an
      // unprompted success toast on every intermediate step of this flow would just be
      // noise a screen-reader user learns to tune out before the Finalize step matters.
      toast.error('Failed to load preview', {
        description: `${error.message} — choose a different period, or try again.`,
      })
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
