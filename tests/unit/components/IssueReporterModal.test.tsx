import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import React from 'react'

// -----------------------------------------------------------------------------
// Mocks (must be declared before the component import)
// -----------------------------------------------------------------------------

const mockCaptureScreenshot = vi.fn()
const mockCollectDiagnostics = vi.fn()

vi.mock('@/lib/issue-diagnostics', () => ({
  captureScreenshot: () => mockCaptureScreenshot(),
  collectDiagnostics: (user: unknown) => mockCollectDiagnostics(user),
  NO_TRACK_ATTR: 'data-issue-no-track',
  ISSUE_5XX_EVENT: 'issue-reporter:5xx',
}))

const mockMutate = vi.fn()
let mockIsPending = false

vi.mock('@/hooks', () => ({
  useReportIssue: () => ({ mutate: mockMutate, isPending: mockIsPending }),
}))

const mockUser: { id: string; email: string; role?: string | null } | null = {
  id: 'user-1',
  email: 'ash.crick@example.com',
  role: 'operations',
}

vi.mock('@payloadcms/ui', () => ({
  useAuth: () => ({ user: mockUser }),
}))

const mockCloseReportIssue = vi.fn()
let mockTrigger: string | null = null

vi.mock('@/stores/ui', () => ({
  useUIStore: (
    selector: (state: {
      closeReportIssue: typeof mockCloseReportIssue
      reportIssueTrigger: string | null
    }) => unknown,
  ) =>
    selector({
      closeReportIssue: mockCloseReportIssue,
      reportIssueTrigger: mockTrigger,
    }),
}))

// Import after mocks
import { IssueReporterModal } from '@/components/IssueReporter/IssueReporterModal'

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const DIAGNOSTICS = { context: { route: '/admin/dashboard' } }

const renderModal = () => {
  const Harness = () => {
    const ref = React.useRef<HTMLDivElement>(null)
    return (
      <div ref={ref}>
        <IssueReporterModal reporterRootRef={ref} />
      </div>
    )
  }
  return render(<Harness />)
}

/** Render and wait for the capture pass to finish and the form to appear. */
const renderAndSettle = async () => {
  const result = renderModal()
  await waitFor(() => expect(screen.getByTestId('issue-reporter-modal')).toBeInTheDocument())
  return result
}

const typeDescription = (value: string) =>
  fireEvent.change(screen.getByTestId('issue-reporter-description'), { target: { value } })

describe('IssueReporterModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsPending = false
    mockTrigger = null
    mockCaptureScreenshot.mockResolvedValue(null)
    mockCollectDiagnostics.mockReturnValue(DIAGNOSTICS)

    // jsdom implements neither of these.
    URL.createObjectURL = vi.fn(() => 'blob:mock-preview-url')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    cleanup()
  })

  describe('capture pass', () => {
    it('renders nothing while the screenshot is being captured', () => {
      let resolveCapture: (blob: Blob | null) => void = () => {}
      mockCaptureScreenshot.mockReturnValue(
        new Promise<Blob | null>((resolve) => {
          resolveCapture = resolve
        }),
      )

      renderModal()

      expect(screen.queryByTestId('issue-reporter-modal')).not.toBeInTheDocument()
      resolveCapture(null)
    })

    it('renders the form once the capture settles', async () => {
      await renderAndSettle()

      expect(screen.getByTestId('issue-reporter-description')).toBeInTheDocument()
      expect(screen.getByTestId('issue-reporter-submit')).toBeInTheDocument()
    })

    it('falls back to the file input when captureScreenshot rejects', async () => {
      mockCaptureScreenshot.mockRejectedValue(new Error('canvas tainted'))

      await renderAndSettle()

      expect(screen.getByTestId('issue-reporter-file')).toBeInTheDocument()
    })
  })

  describe('screenshot available', () => {
    beforeEach(() => {
      mockCaptureScreenshot.mockResolvedValue(new Blob(['png-bytes'], { type: 'image/png' }))
    })

    it('shows the preview and a checked include-screenshot checkbox', async () => {
      await renderAndSettle()

      const preview = screen.getByTestId('issue-reporter-preview')
      expect(preview).toBeInTheDocument()
      expect(preview).toHaveAttribute('src', 'blob:mock-preview-url')

      const checkbox = screen.getByTestId('issue-reporter-include-screenshot')
      expect(checkbox).toBeInTheDocument()
      expect(checkbox).toBeChecked()
      expect(checkbox).toBeEnabled()
    })

    it('does not show the file-input fallback', async () => {
      await renderAndSettle()

      expect(screen.queryByTestId('issue-reporter-file')).not.toBeInTheDocument()
    })

    it('gives the preview a descriptive alt text', async () => {
      await renderAndSettle()

      expect(screen.getByTestId('issue-reporter-preview')).toHaveAttribute(
        'alt',
        expect.stringContaining('Screenshot'),
      )
    })

    it('drops the preview when the screenshot is removed', async () => {
      await renderAndSettle()

      fireEvent.click(screen.getByTestId('issue-reporter-remove-screenshot'))

      expect(screen.queryByTestId('issue-reporter-preview')).not.toBeInTheDocument()
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-preview-url')
    })

    it('sends the blob when the checkbox stays checked', async () => {
      await renderAndSettle()
      typeDescription('Repayment failed silently')
      fireEvent.click(screen.getByTestId('issue-reporter-submit'))

      expect(mockMutate).toHaveBeenCalledTimes(1)
      const payload = mockMutate.mock.calls[0][0]
      expect(payload.screenshotBlob).toBeInstanceOf(Blob)
      expect(payload.screenshotContentType).toBe('image/png')
    })

    it('omits the blob when the checkbox is unchecked', async () => {
      await renderAndSettle()

      fireEvent.click(screen.getByTestId('issue-reporter-include-screenshot'))
      typeDescription('Repayment failed silently')
      fireEvent.click(screen.getByTestId('issue-reporter-submit'))

      expect(mockMutate.mock.calls[0][0].screenshotBlob).toBeNull()
      expect(mockMutate.mock.calls[0][0].screenshotContentType).toBeUndefined()
    })
  })

  describe('capture unavailable', () => {
    beforeEach(() => {
      mockCaptureScreenshot.mockResolvedValue(null)
    })

    it('shows the file-input fallback instead of the checkbox', async () => {
      await renderAndSettle()

      expect(screen.getByTestId('issue-reporter-file')).toBeInTheDocument()
      expect(screen.queryByTestId('issue-reporter-include-screenshot')).not.toBeInTheDocument()
      expect(screen.queryByTestId('issue-reporter-preview')).not.toBeInTheDocument()
    })

    it('accepts only JPEG and PNG', async () => {
      await renderAndSettle()

      expect(screen.getByTestId('issue-reporter-file')).toHaveAttribute(
        'accept',
        'image/jpeg,image/png',
      )
    })

    it('previews a chosen PNG file', async () => {
      await renderAndSettle()

      const file = new File(['bytes'], 'shot.png', { type: 'image/png' })
      fireEvent.change(screen.getByTestId('issue-reporter-file'), { target: { files: [file] } })

      expect(await screen.findByTestId('issue-reporter-preview')).toBeInTheDocument()
    })

    it('rejects a non-image file with a field error', async () => {
      await renderAndSettle()

      const file = new File(['bytes'], 'notes.pdf', { type: 'application/pdf' })
      const input = screen.getByTestId('issue-reporter-file')
      fireEvent.change(input, { target: { files: [file] } })

      expect(await screen.findByText('Choose a JPEG or PNG image.')).toBeInTheDocument()
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(screen.queryByTestId('issue-reporter-preview')).not.toBeInTheDocument()
    })
  })

  describe('validation', () => {
    it('blocks submit and shows the error summary for an empty description', async () => {
      await renderAndSettle()

      fireEvent.click(screen.getByTestId('issue-reporter-submit'))

      expect(mockMutate).not.toHaveBeenCalled()

      const summary = await screen.findByTestId('issue-reporter-error-summary')
      expect(summary).toHaveAttribute('role', 'alert')
      expect(summary).toHaveTextContent('There is a problem')
      expect(
        screen.getAllByText('Enter a description of the problem.').length,
      ).toBeGreaterThanOrEqual(1)
    })

    it('marks the textarea invalid and describes it by the error', async () => {
      await renderAndSettle()

      fireEvent.click(screen.getByTestId('issue-reporter-submit'))

      const textarea = await screen.findByTestId('issue-reporter-description')
      await waitFor(() => expect(textarea).toHaveAttribute('aria-invalid', 'true'))
      expect(textarea.getAttribute('aria-describedby')).toContain(
        'issue-reporter-description-error',
      )
    })

    it('links the error summary to the description field', async () => {
      await renderAndSettle()

      fireEvent.click(screen.getByTestId('issue-reporter-submit'))

      const summary = await screen.findByTestId('issue-reporter-error-summary')
      expect(summary.querySelector('a')).toHaveAttribute('href', '#issue-reporter-description')
    })

    it('blocks submit for a whitespace-only description', async () => {
      await renderAndSettle()

      typeDescription('    \n  ')
      fireEvent.click(screen.getByTestId('issue-reporter-submit'))

      expect(mockMutate).not.toHaveBeenCalled()
      expect(await screen.findByTestId('issue-reporter-error-summary')).toBeInTheDocument()
    })

    it('clears the error once a valid description is submitted', async () => {
      await renderAndSettle()

      fireEvent.click(screen.getByTestId('issue-reporter-submit'))
      expect(await screen.findByTestId('issue-reporter-error-summary')).toBeInTheDocument()

      typeDescription('Now with detail')
      fireEvent.click(screen.getByTestId('issue-reporter-submit'))

      await waitFor(() =>
        expect(screen.queryByTestId('issue-reporter-error-summary')).not.toBeInTheDocument(),
      )
      expect(mockMutate).toHaveBeenCalledTimes(1)
    })
  })

  describe('submission', () => {
    it('calls mutate with the trimmed description, diagnostics and trigger reason', async () => {
      mockTrigger = 'api-5xx'
      await renderAndSettle()

      typeDescription('  The balance shown is wrong  ')
      fireEvent.click(screen.getByTestId('issue-reporter-submit'))

      expect(mockMutate).toHaveBeenCalledTimes(1)
      expect(mockMutate.mock.calls[0][0]).toMatchObject({
        description: 'The balance shown is wrong',
        diagnostics: DIAGNOSTICS,
        triggerReason: 'api-5xx',
      })
    })

    it('collects diagnostics with the authenticated reporter identity', async () => {
      await renderAndSettle()

      typeDescription('Something broke')
      fireEvent.click(screen.getByTestId('issue-reporter-submit'))

      expect(mockCollectDiagnostics).toHaveBeenCalledWith({
        id: 'user-1',
        email: 'ash.crick@example.com',
        role: 'operations',
      })
    })

    it('passes a null trigger reason when the reporter was opened manually', async () => {
      mockTrigger = null
      await renderAndSettle()

      typeDescription('Manual report')
      fireEvent.click(screen.getByTestId('issue-reporter-submit'))

      expect(mockMutate.mock.calls[0][0].triggerReason).toBeNull()
    })

    it('closes the modal on success', async () => {
      await renderAndSettle()

      typeDescription('Something broke')
      fireEvent.click(screen.getByTestId('issue-reporter-submit'))

      const options = mockMutate.mock.calls[0][1]
      options.onSuccess()

      expect(mockCloseReportIssue).toHaveBeenCalledTimes(1)
    })

    it('does not submit while a report is already in flight', async () => {
      mockIsPending = true
      await renderAndSettle()

      expect(screen.getByTestId('issue-reporter-submit')).toBeDisabled()
      expect(screen.getByTestId('issue-reporter-submit')).toHaveTextContent('Sending…')

      fireEvent.submit(screen.getByTestId('issue-reporter-description').closest('form') as Element)

      expect(mockMutate).not.toHaveBeenCalled()
    })

    it('does not close while a report is in flight', async () => {
      mockIsPending = true
      await renderAndSettle()

      fireEvent.click(screen.getByText('Cancel'))

      expect(mockCloseReportIssue).not.toHaveBeenCalled()
    })

    it('closes when Cancel is clicked and nothing is in flight', async () => {
      await renderAndSettle()

      fireEvent.click(screen.getByText('Cancel'))

      expect(mockCloseReportIssue).toHaveBeenCalledTimes(1)
    })
  })

  describe('description field', () => {
    it('caps the description length and shows a live character count', async () => {
      await renderAndSettle()

      const textarea = screen.getByTestId('issue-reporter-description')
      expect(textarea).toHaveAttribute('maxLength', '5000')

      typeDescription('abcde')

      expect(screen.getByText('5/5000 characters')).toBeInTheDocument()
    })
  })
})
