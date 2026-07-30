/**
 * PeriodCloseWizard — finalize step tells the truth about what will post
 * (Task 28 / review finding F11).
 *
 * The finalize step used to have the operator confirm against "closing
 * balances" that are not the posted amounts (the engine posts
 * movement-basis journals computed at finalize) and rendered an
 * always-empty "Journal Entries to Generate" table (the mapper hard-codes
 * `journalEntries: []` on preview — real entries only exist post-finalize).
 * This suite locks in the fix: the finalize step relabels the balance
 * tiles as review-only, surfaces the actual movement-basis figure that will
 * post (from `preview.eclChange`, already mapped from `eclMovement`), and
 * drops the empty journal table. The post-finalize success screen (which
 * renders the REAL entries from FinalizeResponse) is unchanged — covered
 * here only by a regression test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { toast } from 'sonner'
import { PeriodCloseWizard } from '@/components/PeriodCloseView/PeriodCloseWizard'
import { formatCurrency } from '@/lib/formatters'
import type { PeriodClosePreview } from '@/hooks/mutations/usePeriodClosePreview'
import type { FinalizeResponse } from '@/hooks/mutations/useFinalizePeriodClose'

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

const seedFinalizeStep = (preview: PeriodClosePreview) => {
  sessionStorage.setItem(
    storageKey(PERIOD),
    JSON.stringify({
      currentStep: 'finalize',
      preview,
      localAnomalies: [],
      periodDate: PERIOD,
    })
  )
}

const renderWizard = () => render(<PeriodCloseWizard userId="user-1" userName="Test User" />)

beforeEach(() => {
  sessionStorage.clear()
  mockSearch = `step=finalize&period=${PERIOD}`
  mockReplace.mockClear()
  mockPush.mockClear()
  mockBack.mockClear()
  mockGeneratePreview.mockReset()
  mockAcknowledgeAnomaly.mockReset()
  mockFinalizePeriodClose.mockReset()
  vi.mocked(toast.error).mockClear()
})

describe('PeriodCloseWizard — finalize step is honest about movement-basis posting (Task 28 / F11)', () => {
  it('(a) relabels the closing balance tiles as review-only, not the posted amounts', async () => {
    seedFinalizeStep(buildPreview())

    renderWizard()

    expect(
      await screen.findByText('Closing balances (for review — not the posted amounts)')
    ).toBeInTheDocument()
  })

  it('(b) shows the movement-basis ECL charge to be posted, from preview.eclChange, with the caveat line', async () => {
    seedFinalizeStep(buildPreview({ eclChange: 500 }))

    renderWizard()

    expect(await screen.findByText('To be posted (movement basis)')).toBeInTheDocument()
    expect(screen.getByText(/ECL provision movement \(charge\):/)).toBeInTheDocument()
    expect(screen.getByText(formatCurrency(500))).toBeInTheDocument()
    expect(
      screen.getByText(
        'Final amounts are computed at finalization from live state; write-off utilisation and late-arrival accruals may adjust them.'
      )
    ).toBeInTheDocument()
  })

  it('(b) labels a negative eclChange as a release, showing the absolute amount', async () => {
    seedFinalizeStep(buildPreview({ eclChange: -300 }))

    renderWizard()

    expect(await screen.findByText(/ECL provision movement \(release\):/)).toBeInTheDocument()
    expect(screen.getByText(formatCurrency(300))).toBeInTheDocument()
  })

  it('(c) never renders the "Journal Entries to Generate" table pre-finalize, even if preview.journalEntries is non-empty', async () => {
    seedFinalizeStep(
      buildPreview({
        eclChange: 500,
        journalEntries: [
          {
            type: 'ECL_CHARGE',
            description: 'ECL provision movement',
            debitAccount: 'ECL-EXPENSE',
            creditAccount: 'ECL-ALLOWANCE',
            amount: 500,
          },
        ],
      })
    )

    renderWizard()

    await screen.findByText('To be posted (movement basis)')
    expect(screen.queryByText('Journal Entries to Generate')).not.toBeInTheDocument()
  })

  it('(d) the confirmation phrase states journals post on a movement basis, not that balances above are the posted amounts', async () => {
    seedFinalizeStep(buildPreview())

    const { container } = renderWizard()

    await screen.findByText('To be posted (movement basis)')
    const code = container.querySelector('code')
    expect(code?.textContent).toMatch(/^I CONFIRM FINALIZATION OF PERIOD .+; JOURNALS WILL POST ON A MOVEMENT BASIS$/)
  })

  it('regression: the post-finalize success screen still renders the REAL journal entries from FinalizeResponse', async () => {
    seedFinalizeStep(buildPreview({ eclChange: 500 }))

    const finalizeResponse: FinalizeResponse = {
      success: true,
      periodDate: PERIOD,
      finalizedAt: '2026-05-01T00:00:00.000Z',
      totalAccounts: 10,
      totalECLAllowance: 200,
      totalAccruedYield: 100,
      journalEntries: [
        {
          id: 'je-1',
          type: 'ECL_CHARGE',
          description: 'ECL provision movement',
          debitAccount: 'ECL-EXPENSE',
          creditAccount: 'ECL-ALLOWANCE',
          amount: 500,
          createdAt: '2026-05-01T00:00:00.000Z',
        },
      ],
    }
    mockFinalizePeriodClose.mockResolvedValueOnce(finalizeResponse)

    const { container } = renderWizard()

    await screen.findByText('To be posted (movement basis)')
    const code = container.querySelector('code')
    expect(code?.textContent).toBeTruthy()

    const confirmInput = screen.getByTestId('confirm-input')
    fireEvent.change(confirmInput, { target: { value: code!.textContent as string } })

    const finalizeBtn = await screen.findByTestId('finalize-btn')
    await waitFor(() => expect(finalizeBtn).not.toBeDisabled())
    fireEvent.click(finalizeBtn)

    expect(await screen.findByRole('heading', { name: 'Period Close Complete' })).toBeInTheDocument()
    expect(screen.getByText('Generated Journal Entries')).toBeInTheDocument()
    expect(screen.getByText(`ECL_CHARGE: ${formatCurrency(500)}`)).toBeInTheDocument()
  })
})
