import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: null }) }))

const mutations = vi.hoisted(() => ({
  preflight: {
    mutate: vi.fn(),
    data: undefined as unknown,
    isPending: false,
    isError: false,
    reset: vi.fn(),
  },
  create: { mutate: vi.fn(), isPending: false, isError: false, error: null },
}))
vi.mock('@/hooks', () => ({
  useReleasePreflight: () => mutations.preflight,
  useCreateRelease: () => mutations.create,
}))

import { NewReleaseModal } from '@/components/MarketingView/NewReleaseModal'

describe('NewReleaseModal', () => {
  test('step 1 renders three type cards; SMS checkbox disabled for open quota', () => {
    render(<NewReleaseModal onClose={() => {}} onSuccess={() => {}} />)
    expect(screen.getByText('Waitlist')).toBeTruthy()
    expect(screen.getByText('Phone list')).toBeTruthy()
    expect(screen.getByText('Open quota')).toBeTruthy()
    fireEvent.click(screen.getByText('Open quota'))
    const sms = screen.getByLabelText(/send invite sms/i) as HTMLInputElement
    expect(sms.disabled).toBe(true)
  })

  test('continue runs preflight and shows the partition', async () => {
    mutations.preflight.mutate.mockImplementation(
      (_vars: unknown, opts?: { onSuccess?: (d: unknown) => void }) =>
        opts?.onSuccess?.({
          counts: {
            granted_sms: 131,
            granted_no_sms: 9,
            skipped_already_customer: 6,
            skipped_already_released: 3,
            skipped_needs_review: 1,
            skipped_invalid_number: 0,
          },
          total: 150,
        }),
    )
    render(<NewReleaseModal onClose={() => {}} onSuccess={() => {}} />)
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'August wave 3' } })
    fireEvent.change(screen.getByLabelText(/count/i), { target: { value: '150' } })
    fireEvent.click(screen.getByText(/continue/i))
    await waitFor(() => expect(screen.getByText(/131/)).toBeTruthy())
    expect(screen.getByText(/release 140 grants/i)).toBeTruthy() // 131 + 9
  })

  test('truncated preflight shows a warning and disables the release button', async () => {
    mutations.preflight.mutate.mockImplementation(
      (_vars: unknown, opts?: { onSuccess?: (d: unknown) => void }) =>
        opts?.onSuccess?.({
          counts: {
            granted_sms: 5,
            granted_no_sms: 0,
            skipped_already_customer: 0,
            skipped_already_released: 0,
            skipped_needs_review: 0,
            skipped_invalid_number: 0,
          },
          total: 5,
          truncated: true,
        }),
    )
    render(<NewReleaseModal onClose={() => {}} onSuccess={() => {}} />)
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Truncated wave' } })
    fireEvent.change(screen.getByLabelText(/count/i), { target: { value: '5' } })
    fireEvent.click(screen.getByText(/continue/i))

    await waitFor(() =>
      expect(
        screen.getByText(/numbers may be incomplete.*do not release from this preflight/i),
      ).toBeTruthy(),
    )
    const releaseButton = screen.getByRole('button', { name: /release/i })
    expect(releaseButton).toBeDisabled()
  })
})
