'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@payloadcms/ui'
import { Modal } from '@/components/ui/Modal'
import { captureScreenshot, collectDiagnostics } from '@/lib/issue-diagnostics'
import { useReportIssue } from '@/hooks'
import { useUIStore } from '@/stores/ui'
import styles from './styles.module.css'

const MAX_DESCRIPTION = 5000
const DESCRIPTION_ID = 'issue-reporter-description'
const DESCRIPTION_ERROR_ID = 'issue-reporter-description-error'
const DESCRIPTION_COUNT_ID = 'issue-reporter-description-count'

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const
type ScreenshotContentType = (typeof ALLOWED_IMAGE_TYPES)[number]

// Must stay in sync with ISSUE_SCREENSHOT_MAX_BYTES enforced by /api/issues/screenshot
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024

const contentTypeOf = (blob: Blob): ScreenshotContentType =>
  blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'

export interface IssueReporterModalProps {
  /**
   * The reporter's root element. Hidden (visibility, so layout doesn't reflow)
   * for the duration of the capture — otherwise every screenshot shows the
   * launcher button, and the modal itself once it renders.
   */
  reporterRootRef: React.RefObject<HTMLDivElement | null>
}

/**
 * The report form.
 *
 * Mounting order matters: the screenshot is taken BEFORE any form chrome
 * renders, with the reporter root hidden, so what the operator sees in the
 * preview is the page as it was when they hit "Report issue".
 */
export const IssueReporterModal: React.FC<IssueReporterModalProps> = ({ reporterRootRef }) => {
  const { user } = useAuth()
  const closeReportIssue = useUIStore((state) => state.closeReportIssue)
  const reportIssueTrigger = useUIStore((state) => state.reportIssueTrigger)
  const { mutate, isPending } = useReportIssue()

  const [capturing, setCapturing] = useState(true)
  const [captureFailed, setCaptureFailed] = useState(false)
  const [screenshotBlob, setScreenshotBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [includeScreenshot, setIncludeScreenshot] = useState(false)
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  const errorSummaryRef = useRef<HTMLDivElement>(null)
  // Object URLs are revoked through a ref so a replaced preview is released
  // immediately rather than waiting for unmount.
  const previewUrlRef = useRef<string | null>(null)

  const setPreview = useCallback((blob: Blob | null) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
    const url = blob ? URL.createObjectURL(blob) : null
    previewUrlRef.current = url
    setPreviewUrl(url)
    setScreenshotBlob(blob)
  }, [])

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
    }
  }, [])

  // Capture pass — runs once, before the form is rendered.
  useEffect(() => {
    let cancelled = false
    const root = reporterRootRef.current
    const previousVisibility = root?.style.visibility ?? ''
    if (root) root.style.visibility = 'hidden'

    const run = async () => {
      // Two frames: one for the style write to land, one for the paint.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

      let blob: Blob | null = null
      try {
        blob = await captureScreenshot()
      } catch {
        blob = null
      }

      if (root) root.style.visibility = previousVisibility
      if (cancelled) return

      if (blob) {
        setPreview(blob)
        setIncludeScreenshot(true)
      } else {
        setCaptureFailed(true)
      }
      setCapturing(false)
    }

    void run()

    return () => {
      cancelled = true
      if (root) root.style.visibility = previousVisibility
    }
  }, [reporterRootRef, setPreview])

  const handleClose = useCallback(() => {
    if (isPending) return
    closeReportIssue()
  }, [isPending, closeReportIssue])

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      if (!ALLOWED_IMAGE_TYPES.includes(file.type as ScreenshotContentType)) {
        setFileError('Choose a JPEG or PNG image.')
        setPreview(null)
        setIncludeScreenshot(false)
        e.target.value = ''
        return
      }

      if (file.size > MAX_SCREENSHOT_BYTES) {
        setFileError('Screenshot must be 5MB or less.')
        setPreview(null)
        setIncludeScreenshot(false)
        e.target.value = ''
        return
      }

      setFileError(null)
      setPreview(file)
      setIncludeScreenshot(true)
    },
    [setPreview],
  )

  const handleRemoveScreenshot = useCallback(() => {
    setPreview(null)
    setIncludeScreenshot(false)
    setFileError(null)
  }, [setPreview])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (isPending) return

      const trimmed = description.trim()
      if (trimmed.length === 0) {
        setError('Enter a description of the problem.')
        // Error summary first (ux-standards.md §3), then the operator follows
        // the in-page link to the field.
        requestAnimationFrame(() => errorSummaryRef.current?.focus())
        return
      }

      setError(null)

      const blobToSend = includeScreenshot ? screenshotBlob : null

      mutate(
        {
          description: trimmed,
          diagnostics: collectDiagnostics(
            user
              ? {
                  id: user.id,
                  email: user.email,
                  role: (user as { role?: string | null }).role ?? null,
                }
              : null,
          ),
          screenshotBlob: blobToSend,
          screenshotContentType: blobToSend ? contentTypeOf(blobToSend) : undefined,
          triggerReason: reportIssueTrigger,
        },
        {
          onSuccess: () => {
            setDescription('')
            setPreview(null)
            setIncludeScreenshot(false)
            closeReportIssue()
          },
        },
      )
    },
    [
      isPending,
      description,
      includeScreenshot,
      screenshotBlob,
      mutate,
      user,
      reportIssueTrigger,
      setPreview,
      closeReportIssue,
    ],
  )

  // Nothing renders while the page is being captured — the form must not appear
  // in its own screenshot.
  if (capturing) return null

  return (
    <Modal
      title="Report an issue"
      onClose={handleClose}
      dismissOnBackdropClick={!isPending}
      dismissOnEscape={!isPending}
      closeDisabled={isPending}
      testId="issue-reporter-modal"
      maxWidth="560px"
    >
      <form onSubmit={handleSubmit} noValidate>
        <div className={styles.modalBody}>
          <p className={styles.intro}>
            Tell us what went wrong. We attach the page you were on, your recent actions and any
            errors the browser recorded — never the values you typed.
          </p>

          {error && (
            <div
              ref={errorSummaryRef}
              className={styles.errorSummary}
              role="alert"
              tabIndex={-1}
              data-testid="issue-reporter-error-summary"
            >
              <h3 className={styles.errorSummaryTitle}>There is a problem</h3>
              <ul className={styles.errorSummaryList}>
                <li>
                  <a href={`#${DESCRIPTION_ID}`}>{error}</a>
                </li>
              </ul>
            </div>
          )}

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel} htmlFor={DESCRIPTION_ID}>
              What happened? *
            </label>
            <textarea
              id={DESCRIPTION_ID}
              className={`${styles.textarea} ${error ? styles.textareaInvalid : ''}`.trim()}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={MAX_DESCRIPTION}
              rows={5}
              disabled={isPending}
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={
                error ? `${DESCRIPTION_ERROR_ID} ${DESCRIPTION_COUNT_ID}` : DESCRIPTION_COUNT_ID
              }
              data-testid="issue-reporter-description"
            />
            {error && (
              <p id={DESCRIPTION_ERROR_ID} className={styles.fieldError}>
                {error}
              </p>
            )}
            <div id={DESCRIPTION_COUNT_ID} className={styles.charCount} aria-live="polite">
              {description.length}/{MAX_DESCRIPTION} characters
            </div>
          </div>

          <div className={styles.fieldGroup}>
            {captureFailed && !screenshotBlob ? (
              <>
                <label className={styles.fieldLabel} htmlFor="issue-reporter-file">
                  Attach a screenshot (optional)
                </label>
                <p className={styles.hint}>
                  We couldn&apos;t capture the screen automatically. You can attach one yourself.
                </p>
                <input
                  id="issue-reporter-file"
                  type="file"
                  accept="image/jpeg,image/png"
                  className={styles.fileInput}
                  onChange={handleFileChange}
                  disabled={isPending}
                  aria-describedby={fileError ? 'issue-reporter-file-error' : undefined}
                  aria-invalid={fileError ? true : undefined}
                  data-testid="issue-reporter-file"
                />
                {fileError && (
                  <p id="issue-reporter-file-error" className={styles.fieldError}>
                    {fileError}
                  </p>
                )}
              </>
            ) : (
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={includeScreenshot}
                  onChange={(e) => setIncludeScreenshot(e.target.checked)}
                  disabled={isPending || !screenshotBlob}
                  data-testid="issue-reporter-include-screenshot"
                />
                Include screenshot
              </label>
            )}

            {previewUrl && (
              <div className={styles.previewWrap}>
                {/* eslint-disable-next-line @next/next/no-img-element -- object URL of an in-memory blob; next/image cannot handle it */}
                <img
                  src={previewUrl}
                  alt="Screenshot of the page as it appeared when you reported the issue"
                  className={styles.previewImage}
                  data-testid="issue-reporter-preview"
                />
                <button
                  type="button"
                  className={styles.removeBtn}
                  onClick={handleRemoveScreenshot}
                  disabled={isPending}
                  data-testid="issue-reporter-remove-screenshot"
                >
                  Remove screenshot
                </button>
              </div>
            )}
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={handleClose}
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={isPending}
            data-testid="issue-reporter-submit"
          >
            {isPending ? 'Sending…' : 'Send report'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default IssueReporterModal
