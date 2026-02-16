'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { ContextDrawer } from '@/components/ui/ContextDrawer'
import styles from './styles.module.css'

export interface DisburseLoanDrawerProps {
  isOpen: boolean
  onClose: () => void
  loanAccountId: string
  accountNumber: string
  loanAmount: number
  /** When set, show a link to view the signed loan agreement (opens in new window) */
  signedLoanAgreementUrl?: string | null
  onSuccess?: () => void
}

const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'direct_credit', label: 'Direct Credit' },
  { value: 'cheque', label: 'Cheque' },
] as const

const currencyFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
})

interface PresignedUrlResponse {
  uploadUrl: string
  s3Key: string
  s3Uri: string
}

/**
 * DisburseLoanDrawer - Slide-over form for disbursing loan funds.
 *
 * Uploads proof-of-payment to S3 via presigned URL, then calls
 * the DisburseLoan gRPC endpoint via /api/ledger/disburse.
 */
export const DisburseLoanDrawer: React.FC<DisburseLoanDrawerProps> = ({
  isOpen,
  onClose,
  loanAccountId,
  accountNumber,
  loanAmount,
  signedLoanAgreementUrl,
  onSuccess,
}) => {
  const [disbursementAmount, setDisbursementAmount] = useState('')
  const [bankReference, setBankReference] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer')
  const [notes, setNotes] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [progressMessage, setProgressMessage] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [successMessage, setSuccessMessage] = useState('Loan disbursed successfully. Account is now active.')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reset form when drawer opens
  useEffect(() => {
    if (isOpen) {
      setDisbursementAmount(loanAmount ? loanAmount.toFixed(2) : '')
      setBankReference('')
      setPaymentMethod('bank_transfer')
      setNotes('')
      setSelectedFile(null)
      setValidationError(null)
      setProgressMessage(null)
      setSuccess(false)
      setSuccessMessage('Loan disbursed successfully. Account is now active.')
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [isOpen, loanAmount])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        setValidationError('File size must be 10MB or less')
        setSelectedFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }
      setValidationError(null)
    }
    setSelectedFile(file)
  }, [])

  const uploadFileToS3 = async (file: File): Promise<string> => {
    setProgressMessage('Requesting upload URL...')

    const presignedRes = await fetch('/api/uploads/presigned-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountNumber,
        fileName: file.name,
        contentType: file.type,
      }),
    })

    if (!presignedRes.ok) {
      const data = await presignedRes.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to get upload URL')
    }

    const { uploadUrl, s3Uri }: PresignedUrlResponse = await presignedRes.json()

    setProgressMessage('Uploading attachment...')

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    })

    if (!uploadRes.ok) {
      throw new Error('Failed to upload file to storage')
    }

    return s3Uri
  }

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setValidationError(null)

      if (!bankReference.trim()) {
        setValidationError('Bank reference is required')
        return
      }

      setIsPending(true)

      try {
        // Upload file to S3 if provided
        let attachmentLocation = ''
        if (selectedFile) {
          attachmentLocation = await uploadFileToS3(selectedFile)
        }

        // Call disburse API
        setProgressMessage('Processing disbursement...')

        const res = await fetch('/api/ledger/disburse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loanAccountId,
            disbursementAmount: disbursementAmount || undefined,
            bankReference: bankReference.trim(),
            paymentMethod,
            attachmentLocation,
            notes: notes.trim() || undefined,
          }),
        })

        const data = await res.json()

        if (res.status === 409 && data.error === 'ALREADY_DISBURSED') {
          setSuccess(true)
          setSuccessMessage(
            data.message || 'This account has already been disbursed. Refreshing account status.',
          )
          setProgressMessage(null)
          onSuccess?.()
          setTimeout(() => {
            onClose()
          }, 1500)
          return
        }

        if (!res.ok) {
          throw new Error(data.message || data.error || 'Failed to disburse loan')
        }

        setSuccess(true)
        setProgressMessage(null)
        onSuccess?.()

        // Close drawer after brief success message
        setTimeout(() => {
          onClose()
        }, 1500)
      } catch (err: any) {
        setValidationError(err.message)
        setProgressMessage(null)
      } finally {
        setIsPending(false)
      }
    },
    [
      loanAccountId,
      accountNumber,
      disbursementAmount,
      bankReference,
      paymentMethod,
      notes,
      selectedFile,
      onClose,
      onSuccess,
    ],
  )

  const isFormValid = bankReference.trim() && !validationError

  return (
    <ContextDrawer isOpen={isOpen} onClose={onClose} title="Disburse Loan">
      <form onSubmit={handleSubmit} className={styles.repaymentForm}>
        {/* Success message */}
        {success && (
          <div className={styles.disbursementSuccess} role="alert">
            <span>{successMessage}</span>
          </div>
        )}

        {/* Loan amount context */}
        <div className={styles.repaymentBalance}>
          <span className={styles.repaymentBalanceLabel}>Loan Amount</span>
          <span className={styles.repaymentBalanceValue}>
            {currencyFormatter.format(loanAmount)}
          </span>
        </div>

        {/* View signed loan agreement - when available */}
        {signedLoanAgreementUrl && (
          <div className={styles.repaymentField}>
            <a
              href={`/api/loan-agreement?accountId=${encodeURIComponent(loanAccountId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.repaymentLink}
              data-testid="disburse-view-loan-agreement"
            >
              📄 View signed loan agreement
            </a>
          </div>
        )}

        {/* Validation error */}
        {validationError && (
          <div className={styles.repaymentError} role="alert">
            {validationError}
          </div>
        )}

        {/* Progress indicator */}
        {progressMessage && (
          <div className={styles.pendingWarning} role="status">
            <span className={styles.pendingIcon}>⏳</span>
            <span>{progressMessage}</span>
          </div>
        )}

        {!success && (
          <>
            {/* Disbursement Amount field */}
            <div className={styles.repaymentField}>
              <label htmlFor="disbursement-amount" className={styles.repaymentLabel}>
                Disbursement Amount
              </label>
              <div className={styles.repaymentInputWrapper}>
                <span className={styles.repaymentInputPrefix}>$</span>
                <input
                  id="disbursement-amount"
                  type="number"
                  className={styles.repaymentInput}
                  value={disbursementAmount}
                  onChange={(e) => setDisbursementAmount(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0.01"
                  disabled={isPending}
                />
              </div>
              <p className={styles.repaymentHint}>
                Defaults to loan amount + establishment fee if left unchanged
              </p>
            </div>

            {/* Bank Reference field */}
            <div className={styles.repaymentField}>
              <label htmlFor="bank-reference" className={styles.repaymentLabel}>
                Bank Reference <span className={styles.required}>*</span>
              </label>
              <input
                id="bank-reference"
                type="text"
                className={styles.repaymentTextInput}
                value={bankReference}
                onChange={(e) => setBankReference(e.target.value)}
                placeholder="e.g., TRF-20260213-001"
                disabled={isPending}
                required
              />
            </div>

            {/* Payment Method dropdown */}
            <div className={styles.repaymentField}>
              <label htmlFor="disburse-method" className={styles.repaymentLabel}>
                Payment Method
              </label>
              <select
                id="disburse-method"
                className={styles.repaymentSelect}
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                disabled={isPending}
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method.value} value={method.value}>
                    {method.label}
                  </option>
                ))}
              </select>
            </div>

            {/* File upload field */}
            <div className={styles.repaymentField}>
              <label htmlFor="disbursement-attachment" className={styles.repaymentLabel}>
                Proof of Payment
              </label>
              <input
                ref={fileInputRef}
                id="disbursement-attachment"
                type="file"
                className={styles.repaymentTextInput}
                onChange={handleFileChange}
                accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.csv"
                disabled={isPending}
              />
              <p className={styles.repaymentHint}>
                PDF, image, or spreadsheet. Max 10MB.
              </p>
              {selectedFile && (
                <p className={styles.repaymentHint}>
                  {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>

            {/* Notes field */}
            <div className={styles.repaymentField}>
              <label htmlFor="disbursement-notes" className={styles.repaymentLabel}>
                Notes
              </label>
              <textarea
                id="disbursement-notes"
                className={styles.repaymentTextarea}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes about this disbursement..."
                rows={2}
                disabled={isPending}
                maxLength={1000}
              />
            </div>
          </>
        )}

        {/* Actions */}
        {!success && (
          <div className={styles.repaymentActions}>
            <button type="button" className={styles.repaymentCancelBtn} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className={styles.repaymentSubmitBtn}
              disabled={!isFormValid || isPending}
            >
              {isPending ? 'Processing...' : 'Disburse Loan'}
            </button>
          </div>
        )}
      </form>
    </ContextDrawer>
  )
}
