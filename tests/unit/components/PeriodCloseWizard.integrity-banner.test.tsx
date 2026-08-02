/**
 * PeriodCloseWizard — dollar-integrity vs account-set-parity banner split
 * (BTB-249 crm half).
 *
 * The preview step used to render a single reconciliation banner sourced
 * from `preview.reconciled` (which folds together two independent platform
 * signals: dollar-level GL integrity and account-set parity). The platform
 * now reports them separately (ReconciliationResult.integrity_passed /
 * integrity_discrepancy_count, mapped by period-close-mapper.ts into
 * `preview.integrity`). This suite locks in the wizard's rendering of the
 * split banners:
 *   - integrity known + passed  -> neutral "Dollar integrity: PASSED" banner
 *   - integrity known + failed  -> critical "Dollar integrity: FAILED (N
 *     discrepancies)" banner (the authoritative signal)
 *   - account-set parity drifted -> an additional informational note,
 *     independent of the integrity outcome
 *   - integrity unknown (legacy platform server, preview.integrity
 *     undefined) -> falls back to today's single reconciled/pending banner
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { toast } from 'sonner'
import { PeriodCloseWizard } from '@/components/PeriodCloseView/PeriodCloseWizard'
import type { PeriodClosePreview } from '@/hooks/mutations/usePeriodClosePreview'

// ─── next/navigation ────────────────────────────────────────────────────
const PATHNAME = '/admin/period-close'
const mockReplace = vi.fn()
const mockPush = vi.fn()
const mockBack = vi.fn()
let mockSearch = ''

vi.mock('next/navigation', () => ({
  usePathname: () => PATHNAME,
  useRouter: () => ({ replace: mockReplace, push: mockPush, back: mockBack }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}))

// ─── sonner ─────────────────────────────────────────────────────────────
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

// ─── Wizard's data hooks ────────────────────────────────────────────────
const mockGeneratePreview = vi.fn()
const mockAcknowledgeAnomaly = vi.fn()
const mockFinalizePeriodClose = vi.fn()

vi.mock('@/hooks/queries/useClosedPeriods', () => ({
  useClosedPeriods: () => ({
    data: { periods: [], lastClosedPeriod: undefined },
    isLoading: false,
    isFallback: false,
    fallbackMessage: undefined,
  }),
}))

vi.mock('@/hooks/mutations/usePeriodClosePreview', () => ({
  usePeriodClosePreview: () => ({
    generatePreview: mockGeneratePreview,
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
}))

vi.mock('@/hooks/mutations/useAcknowledgeAnomaly', () => ({
  useAcknowledgeAnomaly: () => ({
    acknowledgeAnomaly: mockAcknowledgeAnomaly,
    isPending: false,
  }),
}))

vi.mock('@/hooks/mutations/useFinalizePeriodClose', () => ({
  useFinalizePeriodClose: () => ({
    finalizePeriodClose: mockFinalizePeriodClose,
    isPending: false,
    error: null,
  }),
}))

const PERIOD = '2026-04-30'
const FUTURE_EXPIRY = '2099-01-01T00:00:00.000Z'

const buildPreview = (overrides: Partial<PeriodClosePreview> = {}): PeriodClosePreview => ({
  previewId: 'preview-1',
  periodDate: PERIOD,
  expiresAt: FUTURE_EXPIRY,
  status: 'ready',
  totalAccounts: 10,
  totalAccruedYield: 100,
  totalECLAllowance: 200,
  totalCarryingAmount: 900,
  eclByBucket: [],
  anomalies: [],
  anomalyCount: 0,
  acknowledgedCount: 0,
  reconciled: true,
  journalEntries: [],
  ...overrides,
})

const storageKey = (period: string) => `periodClose:${period}`

const seedPreviewStep = (preview: PeriodClosePreview) => {
  sessionStorage.setItem(
    storageKey(PERIOD),
    JSON.stringify({
      currentStep: 'preview',
      preview,
      localAnomalies: [],
      periodDate: PERIOD,
    })
  )
}

const renderWizard = () => render(<PeriodCloseWizard userId="user-1" userName="Test User" />)

beforeEach(() => {
  sessionStorage.clear()
  mockSearch = `step=preview&period=${PERIOD}`
  mockReplace.mockClear()
  mockPush.mockClear()
  mockBack.mockClear()
  mockGeneratePreview.mockReset()
  mockAcknowledgeAnomaly.mockReset()
  mockFinalizePeriodClose.mockReset()
  vi.mocked(toast.error).mockClear()
})

describe('PeriodCloseWizard — dollar-integrity vs account-set-parity banners (BTB-249)', () => {
  it('passed: renders the neutral "Dollar integrity: PASSED" banner and no parity note when parity is clean', async () => {
    seedPreviewStep(
      buildPreview({
        integrity: { passed: true, discrepancyCount: 0 },
        accountSetDiscrepancyCount: 0,
      })
    )

    renderWizard()

    expect(await screen.findByText('✓ Dollar integrity: PASSED')).toBeInTheDocument()
    expect(screen.queryByText(/Account-set parity:/)).not.toBeInTheDocument()
    // The legacy single-banner text must not also render.
    expect(screen.queryByText('✓ Reconciliation check passed')).not.toBeInTheDocument()
    expect(screen.queryByText('⚠️ Reconciliation check pending')).not.toBeInTheDocument()
  })

  it('failed: renders the critical "Dollar integrity: FAILED (N discrepancies)" banner — the authoritative signal', async () => {
    seedPreviewStep(
      buildPreview({
        reconciled: false,
        integrity: { passed: false, discrepancyCount: 3 },
        accountSetDiscrepancyCount: 0,
      })
    )

    renderWizard()

    expect(await screen.findByText('Dollar integrity: FAILED (3 discrepancies)')).toBeInTheDocument()
    expect(screen.queryByText('✓ Dollar integrity: PASSED')).not.toBeInTheDocument()
    expect(screen.queryByText('⚠️ Reconciliation check pending')).not.toBeInTheDocument()
  })

  it('failed: singularizes the count when there is exactly one discrepancy', async () => {
    seedPreviewStep(
      buildPreview({
        reconciled: false,
        integrity: { passed: false, discrepancyCount: 1 },
        accountSetDiscrepancyCount: 0,
      })
    )

    renderWizard()

    expect(await screen.findByText('Dollar integrity: FAILED (1 discrepancy)')).toBeInTheDocument()
  })

  it('drifted parity: renders the informational account-set parity note alongside a PASSED integrity banner', async () => {
    seedPreviewStep(
      buildPreview({
        integrity: { passed: true, discrepancyCount: 0 },
        accountSetDiscrepancyCount: 5,
      })
    )

    renderWizard()

    await screen.findByText('✓ Dollar integrity: PASSED')
    expect(screen.getByText(/Account-set parity: 5 account-set discrepancies/)).toBeInTheDocument()
    expect(
      screen.getByText(
        /Informational only — accrual rows are removed once fee accrual completes/
      )
    ).toBeInTheDocument()
  })

  it('drifted parity: also renders alongside a FAILED integrity banner (the two signals are independent)', async () => {
    seedPreviewStep(
      buildPreview({
        reconciled: false,
        integrity: { passed: false, discrepancyCount: 2 },
        accountSetDiscrepancyCount: 1,
      })
    )

    renderWizard()

    await screen.findByText('Dollar integrity: FAILED (2 discrepancies)')
    expect(screen.getByText(/Account-set parity: 1 account-set discrepancy\b/)).toBeInTheDocument()
  })

  it('legacy fallback: preview.integrity undefined -> renders today\'s single "passed" banner, not the split banners', async () => {
    seedPreviewStep(buildPreview({ integrity: undefined, reconciled: true }))

    renderWizard()

    expect(await screen.findByText('✓ Reconciliation check passed')).toBeInTheDocument()
    expect(screen.queryByText(/Dollar integrity:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Account-set parity:/)).not.toBeInTheDocument()
  })

  it('legacy fallback: preview.integrity undefined + reconciled=false -> renders today\'s "pending" banner', async () => {
    seedPreviewStep(buildPreview({ integrity: undefined, reconciled: false }))

    renderWizard()

    expect(await screen.findByText('⚠️ Reconciliation check pending')).toBeInTheDocument()
    expect(screen.queryByText(/Dollar integrity:/)).not.toBeInTheDocument()
  })
})
