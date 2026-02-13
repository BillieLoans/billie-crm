'use client'

import React, { useState, useRef } from 'react'
import styles from './styles.module.css'

interface DisburseLoanModalProps {
  loanAccountId: string
  accountNumber: string
  defaultAmount: number | null
  onClose: () => void
  onSuccess: () => void
}

interface PresignedUrlResponse {
  uploadUrl: string
  s3Key: string
  s3Uri: string
}

export const DisburseLoanModal: React.FC<DisburseLoanModalProps> = ({
  loanAccountId,
  accountNumber,
  defaultAmount,
  onClose,
  onSuccess,
}) => {
  const [disbursementAmount, setDisbursementAmount] = useState(
    defaultAmount ? defaultAmount.toFixed(2) : '',
  )
  const [bankReference, setBankReference] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer')
  const [notes, setNotes] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [successMessage, setSuccessMessage] = useState('Loan disbursed successfully!')
  const [result, setResult] = useState<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null
    if (file) {
      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        setError('File size must be 10MB or less')
        setSelectedFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }
      setError(null)
    }
    setSelectedFile(file)
  }

  /**
   * Upload the selected file to S3 via presigned URL.
   * Returns the S3 URI on success, or throws on failure.
   */
  const uploadFileToS3 = async (file: File): Promise<string> => {
    setUploadProgress('Requesting upload URL...')

    // 1. Get presigned URL
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

    // 2. Upload file directly to S3
    setUploadProgress('Uploading file...')

    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    })

    if (!uploadRes.ok) {
      throw new Error('Failed to upload file to storage')
    }

    setUploadProgress(null)
    return s3Uri
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Upload file to S3 if provided
      let attachmentLocation = ''
      if (selectedFile) {
        attachmentLocation = await uploadFileToS3(selectedFile)
      }

      // Call the disburse API
      setUploadProgress('Processing disbursement...')

      const res = await fetch('/api/ledger/disburse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loanAccountId,
          disbursementAmount: disbursementAmount || undefined,
          bankReference,
          paymentMethod,
          attachmentLocation,
          notes: notes || undefined,
        }),
      })

      const data = await res.json()

      if (res.status === 409 && data.error === 'ALREADY_DISBURSED') {
        setSuccess(true)
        setSuccessMessage(data.message || 'This account has already been disbursed.')
        setResult(null)
        setUploadProgress(null)
        setTimeout(() => {
          onSuccess()
        }, 1500)
        return
      }

      if (!res.ok) {
        throw new Error(data.message || data.error || 'Failed to disburse loan')
      }

      setResult(data)
      setSuccess(true)
      setSuccessMessage('Loan disbursed successfully!')
      setUploadProgress(null)
      setTimeout(() => {
        onSuccess()
      }, 2000)
    } catch (err: any) {
      setError(err.message)
      setUploadProgress(null)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value: string) => {
    const num = parseFloat(value || '0')
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
    }).format(num)
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>🏦 Disburse Loan</h2>
          <button className={styles.closeBtn} onClick={onClose}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            {error && <div className={styles.errorMessage}>{error}</div>}

            {success && result && (
              <div className={styles.successMessage}>
                {successMessage}
                <div className={styles.allocationPreview}>
                  <div className={styles.allocationRow}>
                    <span>Disbursement Transaction:</span>
                    <span>{result.disbursementTransactionId}</span>
                  </div>
                  {result.feeTransactionId && (
                    <div className={styles.allocationRow}>
                      <span>Fee Transaction:</span>
                      <span>{result.feeTransactionId}</span>
                    </div>
                  )}
                  <div className={styles.allocationRow}>
                    <span>Event ID:</span>
                    <span>{result.eventId}</span>
                  </div>
                </div>
              </div>
            )}

            {success && !result && (
              <div className={styles.successMessage}>
                {successMessage}
              </div>
            )}

            {!success && (
              <>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Disbursement Amount</label>
                  <input
                    type="number"
                    className={styles.formInput}
                    value={disbursementAmount}
                    onChange={(e) => setDisbursementAmount(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    min="0.01"
                  />
                  <p className={styles.formHint}>
                    Leave as-is to disburse the full loan amount
                    {defaultAmount ? ` (${formatCurrency(defaultAmount.toFixed(2))})` : ''}
                  </p>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Bank Reference *</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    value={bankReference}
                    onChange={(e) => setBankReference(e.target.value)}
                    placeholder="e.g., TRF-20260213-001"
                    required
                  />
                  <p className={styles.formHint}>
                    Reference number from the bank transfer
                  </p>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Payment Method</label>
                  <select
                    className={styles.formSelect}
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                  >
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="direct_credit">Direct Credit</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Proof of Payment</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className={styles.formInput}
                    onChange={handleFileChange}
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.csv"
                  />
                  <p className={styles.formHint}>
                    Upload proof of payment (PDF, image, or spreadsheet). Max 10MB.
                  </p>
                  {selectedFile && (
                    <p className={styles.formHint}>
                      Selected: {selectedFile.name} (
                      {(selectedFile.size / 1024).toFixed(1)} KB)
                    </p>
                  )}
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Notes</label>
                  <textarea
                    className={styles.formInput}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional notes about the disbursement"
                    rows={3}
                    maxLength={1000}
                  />
                </div>

                {uploadProgress && (
                  <div className={styles.formHint}>
                    <strong>{uploadProgress}</strong>
                  </div>
                )}
              </>
            )}
          </div>

          <div className={styles.modalFooter}>
            <button type="button" className={styles.btnCancel} onClick={onClose}>
              {success ? 'Close' : 'Cancel'}
            </button>
            {!success && (
              <button
                type="submit"
                className={styles.btnSubmit}
                disabled={loading || !bankReference}
              >
                {loading ? 'Processing...' : 'Disburse Loan'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
