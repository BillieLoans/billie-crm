/**
 * PeriodCloseWizard — URL-addressable step + sessionStorage resume (BTB-192).
 *
 * Navigating away from the wizard (e.g. to check something else in the CRM)
 * used to lose all progress. The wizard now reflects `step` + `period` in
 * the URL query string via `router.replace` (shallow, no data — privacy
 * rule: no data in query strings) and mirrors its in-progress state
 * (preview JSON + current step + localAnomalies) to sessionStorage under
 * `periodClose:{period}`, so returning to the same URL resumes where the
 * operator left off.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { toast } from 'sonner'
import { PeriodCloseWizard } from '@/components/PeriodCloseView/PeriodCloseWizard'
import type {
  PeriodClosePreview,
  PeriodCloseAnomaly,
} from '@/hooks/mutations/usePeriodClosePreview'

// ─── next/navigation ────────────────────────────────────────────────────
// vitest.setup.ts globally mocks next/navigation with fresh vi.fn()s per
// call (fine for components that don't assert on router calls). This
// wizard needs to assert on router.replace, so it overrides with a stable
// mock object + a mutable search string the individual tests can seed.
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
const PAST_EXPIRY = '2000-01-01T00:00:00.000Z'

const ANOMALY: PeriodCloseAnomaly = {
  anomalyId: 'anom-1',
  anomalyType: 'BALANCE_MISMATCH',
  severity: 'high',
  accountId: 'acc-1',
  description: 'Balance mismatch detected',
  acknowledged: false,
}

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
  anomalies: [ANOMALY],
  anomalyCount: 1,
  acknowledgedCount: 0,
  reconciled: true,
  journalEntries: [],
  ...overrides,
})

const storageKey = (period: string) => `periodClose:${period}`

const seedStorage = (overrides: Record<string, unknown> = {}) => {
  sessionStorage.setItem(
    storageKey(PERIOD),
    JSON.stringify({
      currentStep: 'anomalies',
      preview: buildPreview(),
      localAnomalies: [ANOMALY],
      periodDate: PERIOD,
      ...overrides,
    })
  )
}

const renderWizard = () => render(<PeriodCloseWizard userId="user-1" userName="Test User" />)

beforeEach(() => {
  sessionStorage.clear()
  mockSearch = ''
  mockReplace.mockClear()
  mockPush.mockClear()
  mockBack.mockClear()
  mockGeneratePreview.mockReset()
  mockAcknowledgeAnomaly.mockReset()
  mockFinalizePeriodClose.mockReset()
  vi.mocked(toast.error).mockClear()
})

describe('PeriodCloseWizard — URL-addressable step + session resume (BTB-192)', () => {
  it('(a) mounts on the Anomaly Review step when the URL and sessionStorage agree', async () => {
    mockSearch = `step=anomalies&period=${PERIOD}`
    seedStorage()

    renderWizard()

    expect(await screen.findByRole('heading', { name: 'Anomaly Review' })).toBeInTheDocument()
    expect(screen.getByText('Balance mismatch detected')).toBeInTheDocument()
  })

  it('(b) falls back to Select Period when the URL has step+period but no matching sessionStorage entry', async () => {
    mockSearch = `step=anomalies&period=${PERIOD}`
    // No sessionStorage seeded.

    renderWizard()

    expect(await screen.findByLabelText('Select Period End Date')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Anomaly Review' })).not.toBeInTheDocument()

    // URL is cleaned (no leftover step/period query params).
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(PATHNAME, { scroll: false }))
  })

  it('(c) advancing a step rewrites the query string', async () => {
    mockSearch = ''
    mockGeneratePreview.mockResolvedValueOnce(buildPreview())

    renderWizard()

    const select = screen.getByTestId('period-select') as HTMLSelectElement
    const periodOption = Array.from(select.querySelectorAll('option')).find(
      (opt) => opt.value && !opt.hasAttribute('disabled')
    ) as HTMLOptionElement
    expect(periodOption).toBeTruthy()
    const periodValue = periodOption.value

    fireEvent.change(select, { target: { value: periodValue } })

    const generateBtn = await screen.findByTestId('generate-preview-btn')
    await waitFor(() => expect(generateBtn).not.toBeDisabled())
    fireEvent.click(generateBtn)

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        `${PATHNAME}?step=preview&period=${encodeURIComponent(periodValue)}`,
        { scroll: false }
      )
    })
  })

  it('(d) clears sessionStorage and lands on Select Period when the stored preview has expired', async () => {
    mockSearch = `step=anomalies&period=${PERIOD}`
    seedStorage({ preview: buildPreview({ expiresAt: PAST_EXPIRY }) })

    renderWizard()

    expect(await screen.findByLabelText('Select Period End Date')).toBeInTheDocument()
    expect(sessionStorage.getItem(storageKey(PERIOD))).toBeNull()
    expect(toast.error).toHaveBeenCalled()
  })

  it('preserves acknowledged anomalies on restore (does not revert to the original preview.anomalies)', async () => {
    mockSearch = `step=anomalies&period=${PERIOD}`
    const acknowledged: PeriodCloseAnomaly = {
      ...ANOMALY,
      acknowledged: true,
      acknowledgedBy: 'Test User',
      acknowledgedAt: '2026-04-29T00:00:00.000Z',
    }
    seedStorage({ localAnomalies: [acknowledged] })

    renderWizard()

    expect(await screen.findByText(/Acknowledged by Test User/)).toBeInTheDocument()
  })

  it('regression: a restored preview:null/localAnomalies:[] snapshot must not swallow the next real preview\'s anomaly resync (ack gate stays honest)', async () => {
    // Reproduces the reviewer-found bug: restoring from a 'select'-step
    // snapshot (no preview generated yet) used to arm the "skip next
    // resync" guard on an empty localAnomalies array. When a real preview
    // with anomalies was then generated, the sync effect's one-shot skip
    // consumed itself on that resync instead of populating localAnomalies —
    // leaving it empty (and the un-acknowledged-anomaly gate silently
    // satisfied) even though the preview had a real, unacknowledged anomaly.
    mockSearch = `step=select&period=${PERIOD}`
    sessionStorage.setItem(
      storageKey(PERIOD),
      JSON.stringify({ currentStep: 'select', preview: null, localAnomalies: [], periodDate: PERIOD })
    )
    mockGeneratePreview.mockResolvedValueOnce(buildPreview({ anomalies: [ANOMALY], anomalyCount: 1 }))

    renderWizard()

    // Restored onto 'select' with the period already chosen from storage.
    const generateBtn = await screen.findByTestId('generate-preview-btn')
    await waitFor(() => expect(generateBtn).not.toBeDisabled())
    fireEvent.click(generateBtn)

    // preview step
    let continueBtn = await screen.findByRole('button', { name: 'Continue →' })
    await waitFor(() => expect(continueBtn).not.toBeDisabled())
    fireEvent.click(continueBtn)

    // movement step
    continueBtn = await screen.findByRole('button', { name: 'Continue →' })
    await waitFor(() => expect(continueBtn).not.toBeDisabled())
    fireEvent.click(continueBtn)

    // anomalies step — the real preview's anomaly must render...
    expect(await screen.findByText('Balance mismatch detected')).toBeInTheDocument()
    expect(screen.getByText('Acknowledged: 0 of 1')).toBeInTheDocument()

    // ...and the ack gate must NOT be silently satisfied by the stale
    // (empty) restored localAnomalies.
    continueBtn = screen.getByRole('button', { name: 'Continue →' })
    expect(continueBtn).toBeDisabled()
  })

  it('(low-1) cleans the URL when the query carries an unrecognized step id', async () => {
    mockSearch = `step=bogus&period=${PERIOD}`

    renderWizard()

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(PATHNAME, { scroll: false }))
  })

  it('(low-2a) treats an unparsable expiresAt on a stored preview as expired (fail closed)', async () => {
    mockSearch = `step=anomalies&period=${PERIOD}`
    seedStorage({ preview: buildPreview({ expiresAt: 'not-a-real-date' }) })

    renderWizard()

    expect(await screen.findByLabelText('Select Period End Date')).toBeInTheDocument()
    expect(sessionStorage.getItem(storageKey(PERIOD))).toBeNull()
    expect(toast.error).toHaveBeenCalled()
  })

  it('(low-2b) treats a missing expiresAt on a stored preview as expired (fail closed)', async () => {
    mockSearch = `step=anomalies&period=${PERIOD}`
    // JSON.stringify drops keys whose value is `undefined`, so this
    // genuinely omits expiresAt from the serialized preview — simulating a
    // corrupted/older storage entry rather than merely setting it falsy.
    const previewMissingExpiry = { ...buildPreview(), expiresAt: undefined }
    sessionStorage.setItem(
      storageKey(PERIOD),
      JSON.stringify({
        currentStep: 'anomalies',
        preview: previewMissingExpiry,
        localAnomalies: [ANOMALY],
        periodDate: PERIOD,
      })
    )

    renderWizard()

    expect(await screen.findByLabelText('Select Period End Date')).toBeInTheDocument()
    expect(sessionStorage.getItem(storageKey(PERIOD))).toBeNull()
    expect(toast.error).toHaveBeenCalled()
  })

  it('(low-3) persists the expected shape to sessionStorage after advancing a step', async () => {
    mockSearch = ''
    const preview = buildPreview()
    mockGeneratePreview.mockResolvedValueOnce(preview)

    renderWizard()

    const select = screen.getByTestId('period-select') as HTMLSelectElement
    const periodOption = Array.from(select.querySelectorAll('option')).find(
      (opt) => opt.value && !opt.hasAttribute('disabled')
    ) as HTMLOptionElement
    expect(periodOption).toBeTruthy()
    const periodValue = periodOption.value

    fireEvent.change(select, { target: { value: periodValue } })

    const generateBtn = await screen.findByTestId('generate-preview-btn')
    await waitFor(() => expect(generateBtn).not.toBeDisabled())
    fireEvent.click(generateBtn)

    // Wait for the transition to the 'preview' step to land.
    await screen.findByRole('button', { name: 'Continue →' })

    // The preview → localAnomalies sync runs in its own effect pass (one
    // render behind the step transition), so poll rather than reading
    // sessionStorage on the first write.
    await waitFor(() => {
      const raw = sessionStorage.getItem(storageKey(periodValue))
      expect(raw).toBeTruthy()
      const parsed = JSON.parse(raw as string)
      expect(parsed.localAnomalies).toHaveLength(1)
    })

    const raw = sessionStorage.getItem(storageKey(periodValue))
    const parsed = JSON.parse(raw as string)
    expect(parsed).toMatchObject({
      currentStep: 'preview',
      periodDate: periodValue,
      localAnomalies: [ANOMALY],
    })
    expect(parsed.preview).toMatchObject({
      previewId: preview.previewId,
      anomalyCount: preview.anomalyCount,
    })
  })
})
