'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ContextDrawer } from '@/components/ui/ContextDrawer'
import { useStatementDeletionPreview } from '@/hooks/queries/useStatementDeletion'
import {
  useDeleteStatementFiles,
  type DeleteStatementFilesParams,
} from '@/hooks/mutations/useDeleteStatementFiles'
import { CONFIRM_WORD, DELETION_WARNING_COPY, KEPT_DATA_COPY } from '@/lib/statement-deletion'
import type {
  ApplicationPreview,
  ApplicationResult,
  DeletionScope,
} from '@/server/statement-deletion'
import styles from './DeleteStatementFilesDrawer.module.css'

export interface DeleteStatementFilesDrawerProps {
  isOpen: boolean
  onClose: () => void
  scope: DeletionScope
  title: string
}

type Step = 'review' | 'confirm' | 'result'

const REASON_MAX = 500

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

const appLabel = (app: ApplicationPreview) => app.applicationNumber ?? 'No application number'

/** "{N} files across {M} applications will be permanently deleted. They can't be recovered." */
export function irreversibleWarning(files: number, applications: number): string {
  return `${plural(files, 'file')} across ${plural(applications, 'application')} will be permanently deleted. They can't be recovered.`
}

function outcomeText(result: ApplicationResult): string {
  if (result.status === 'deleted') return `Deleted (${plural(result.filesDeleted, 'file')})`
  if (result.status === 'nothing_found') return 'Nothing to delete'
  if (result.fileCount === 0) return 'Failed'
  const remain = result.fileCount === 1 ? 'file remains' : 'files remain'
  return `Failed — ${result.failedCount} of ${result.fileCount} ${remain}`
}

/** The delete request: the scope's own fields and the reason, never file keys. */
function requestFor(scope: DeletionScope, reason: string): DeleteStatementFilesParams {
  return scope.scope === 'application'
    ? { scope: 'application', conversationId: scope.conversationId, reason }
    : { scope: 'customer', customerIdString: scope.customerIdString, reason }
}

/**
 * Permanently delete a customer's bank-statement files from S3, for one
 * application or every application the customer has. Admin or supervisor only:
 * the button that opens this checks, and the routes check again.
 *
 * A stepped flow, as docs/ux-standards.md asks of an irreversible action:
 * 1. Review: what each application holds, its warnings, what is kept, and a
 *    required reason.
 * 2. Confirm: how many files go, then type DELETE.
 * 3. Result: what happened to each application, with Retry if any failed.
 *
 * The preview is only for the operator to read. The delete sends the scope and
 * the reason; the route resolves the scope and lists the bucket itself.
 */
export function DeleteStatementFilesDrawer({
  isOpen,
  onClose,
  scope,
  title,
}: DeleteStatementFilesDrawerProps) {
  // The delete lives out here so the drawer can refuse to close while it is in
  // flight: closing would unmount the flow, and the operator would never see
  // which files went.
  const deletion = useDeleteStatementFiles()

  // ContextDrawer renders its children only while open, so each opening mounts
  // a fresh flow: back at the review, with a fresh preview.
  return (
    <ContextDrawer
      isOpen={isOpen}
      onClose={onClose}
      closeDisabled={deletion.isPending}
      title={title}
      maxWidth="560px"
    >
      <DeletionFlow scope={scope} onClose={onClose} deletion={deletion} />
    </ContextDrawer>
  )
}

interface DeletionFlowProps {
  scope: DeletionScope
  onClose: () => void
  deletion: ReturnType<typeof useDeleteStatementFiles>
}

function DeletionFlow({ scope, onClose, deletion }: DeletionFlowProps) {
  const [step, setStep] = useState<Step>('review')
  const [reason, setReason] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [results, setResults] = useState<ApplicationResult[] | null>(null)
  const [requestError, setRequestError] = useState<{ message: string; at: number } | null>(null)

  const preview = useStatementDeletionPreview(scope)

  const ids = useId()
  const reasonId = `${ids}-reason`
  const reasonHintId = `${ids}-reason-hint`
  const confirmId = `${ids}-confirm`
  const errorTitleId = `${ids}-error-title`

  const headingRef = useRef<HTMLHeadingElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const shownStep = useRef<Step>('review')

  // A new step takes focus to its heading, so a screen reader starts there.
  useEffect(() => {
    if (shownStep.current === step) return
    shownStep.current = step
    headingRef.current?.focus()
  }, [step])

  const applications = preview.data ?? null
  // The review never shows counts from before a re-check that is still out.
  const reviewApplications = preview.isFetching ? null : applications
  const reviewTotal = reviewApplications?.reduce((sum, app) => sum + app.fileCount, 0) ?? 0
  const totalFiles = applications?.reduce((sum, app) => sum + app.fileCount, 0) ?? 0
  const applicationsWithFiles = applications?.filter((app) => app.fileCount > 0).length ?? 0
  const trimmedReason = reason.trim()
  const canContinue = trimmedReason.length > 0 && reviewTotal > 0
  const canDelete = confirmText === CONFIRM_WORD && totalFiles > 0 && !deletion.isPending

  const errorMessage =
    step === 'review'
      ? (preview.error?.message ?? null)
      : step === 'confirm'
        ? (requestError?.message ?? null)
        : null

  // An error from something the operator did takes focus to the summary. A
  // failed delete always is. A failed preview is only when the operator asked
  // for it (opening, Check again, Retry): a background re-check that fails is
  // announced by role="alert" but leaves focus where it is, say in Reason.
  // Declared after the heading effect, so an error wins over the heading.
  useEffect(() => {
    if (requestError) errorRef.current?.focus()
  }, [requestError])

  const operatorAskedForPreview = useRef(true)
  useEffect(() => {
    if (step !== 'review' || preview.isFetching) return
    const focusError = operatorAskedForPreview.current && preview.isError
    operatorAskedForPreview.current = false
    if (focusError) errorRef.current?.focus()
  }, [step, preview.isFetching, preview.isError, preview.errorUpdatedAt])

  const submit = () => {
    if (!canDelete) return
    setRequestError(null)
    deletion.mutate(requestFor(scope, trimmedReason), {
      onSuccess: (res) => {
        setResults(res)
        setStep('result')
      },
      onError: (error) => setRequestError({ message: error.message, at: Date.now() }),
    })
  }

  // The delete settling has already re-checked the bucket (the hook
  // invalidates the preview), so Retry only goes back to the review.
  const retry = () => {
    operatorAskedForPreview.current = true
    setConfirmText('')
    setResults(null)
    setRequestError(null)
    setStep('review')
  }

  const errorSummary = errorMessage ? (
    <div
      ref={errorRef}
      className={styles.errorSummary}
      role="alert"
      aria-labelledby={errorTitleId}
      tabIndex={-1}
    >
      <p id={errorTitleId} className={styles.errorSummaryTitle}>
        There is a problem
      </p>
      <p className={styles.errorSummaryText}>{errorMessage}</p>
    </div>
  ) : null

  const anyFailed =
    results?.some((r) => r.status !== 'deleted' && r.status !== 'nothing_found') ?? false
  const nothingDeleted = results?.every((r) => r.status === 'nothing_found') ?? false

  return (
    <>
      {step === 'review' && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault()
            if (canContinue) setStep('confirm')
          }}
        >
          <h3 ref={headingRef} tabIndex={-1} className={styles.stepHeading}>
            Review files to delete
          </h3>
          {errorSummary}
          {preview.isError && (
            <div>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={() => {
                  operatorAskedForPreview.current = true
                  void preview.refetch()
                }}
              >
                Check again
              </button>
            </div>
          )}
          {preview.isFetching && (
            <p className={styles.hint} role="status">
              Checking for statement files…
            </p>
          )}
          {reviewApplications && (
            <ul className={styles.apps}>
              {reviewApplications.map((app) => (
                <li key={app.conversationId} className={styles.app}>
                  <p className={styles.appLine}>
                    {`${appLabel(app)} · ${app.fileCount > 0 ? plural(app.fileCount, 'file') : 'No files'}`}
                  </p>
                  {app.warnings.map((warning) => (
                    <p key={warning} className={styles.warning}>
                      <strong className={styles.flag}>Warning: </strong>
                      <span>{DELETION_WARNING_COPY[warning]}</span>
                    </p>
                  ))}
                  {app.error && (
                    <p className={styles.appError}>
                      <strong className={styles.flag}>Error: </strong>
                      <span>{app.error}</span>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {reviewApplications && reviewTotal === 0 && (
            <p className={styles.info}>No statement files found.</p>
          )}
          <p className={styles.kept}>{KEPT_DATA_COPY}</p>

          <div className={styles.field}>
            <label htmlFor={reasonId} className={styles.label}>
              Reason
            </label>
            <p id={reasonHintId} className={styles.hint}>
              Why these files are being deleted. It is kept in the deletion log.
            </p>
            <textarea
              id={reasonId}
              className={styles.textarea}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={REASON_MAX}
              required
              aria-describedby={reasonHintId}
            />
          </div>

          <div className={styles.actions}>
            <button type="button" className={styles.secondaryBtn} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.primaryBtn} disabled={!canContinue}>
              Continue
            </button>
          </div>
        </form>
      )}

      {step === 'confirm' && (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <h3 ref={headingRef} tabIndex={-1} className={styles.stepHeading}>
            Confirm deletion
          </h3>
          {errorSummary}
          <p className={styles.irreversible}>
            {irreversibleWarning(totalFiles, applicationsWithFiles)}
          </p>
          <dl className={styles.reasonSummary}>
            <dt>Reason</dt>
            <dd>{trimmedReason}</dd>
          </dl>

          <div className={styles.field}>
            <label htmlFor={confirmId} className={styles.label}>
              Type {CONFIRM_WORD} to confirm
            </label>
            <input
              id={confirmId}
              className={styles.input}
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={deletion.isPending}
            />
          </div>

          {deletion.isPending && (
            <p className={styles.hint} role="status">
              Deleting files. Keep this drawer open.
            </p>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => {
                setConfirmText('')
                setRequestError(null)
                setStep('review')
              }}
              disabled={deletion.isPending}
            >
              Back
            </button>
            <button type="submit" className={styles.dangerBtn} disabled={!canDelete}>
              {`Delete ${plural(totalFiles, 'file')}`}
            </button>
          </div>
        </form>
      )}

      {step === 'result' && results && (
        <div className={styles.form}>
          <h3 ref={headingRef} tabIndex={-1} className={styles.stepHeading}>
            {anyFailed
              ? 'Some files could not be deleted'
              : nothingDeleted
                ? 'Nothing to delete'
                : 'Statement files deleted'}
          </h3>
          <ul className={styles.apps}>
            {results.map((result) => (
              <li key={result.conversationId} className={styles.app}>
                <p className={styles.appLine}>{`${appLabel(result)} · ${outcomeText(result)}`}</p>
                {result.error && (
                  <p className={styles.appError}>
                    <strong className={styles.flag}>Error: </strong>
                    <span>{result.error}</span>
                  </p>
                )}
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            {anyFailed && (
              <button type="button" className={styles.secondaryBtn} onClick={retry}>
                Retry
              </button>
            )}
            <button type="button" className={styles.secondaryBtn} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  )
}
