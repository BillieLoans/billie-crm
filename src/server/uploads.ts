/**
 * Server-side upload helpers for the proxied S3 upload routes.
 *
 * Uploads flow browser → app server → S3 (never browser → S3 directly), so
 * these helpers enforce the limits the browser can't be trusted with: a hard
 * byte cap while reading the request body, and magic-byte validation so the
 * stored object matches its declared content type.
 */

export const DISBURSEMENT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
export const ISSUE_SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024

/**
 * Replace any character outside [a-zA-Z0-9._-] with '_' so user-supplied
 * values can never introduce path separators into an S3 key.
 */
export function sanitizeS3PathSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/**
 * Disbursement attachments live in the same customer-keyed tree the
 * origination platform writes documents to (customer/{customerId}/{DocType}/,
 * alongside LoanAgreement, CreditAssessment, statements, etc.). A customer
 * can hold many accounts, so the account number keys a subfolder within
 * Disbursements.
 */
export function buildDisbursementAttachmentKey(
  customerId: string,
  accountNumber: string,
  fileName: string,
  timestamp: number,
): string {
  const customer = sanitizeS3PathSegment(customerId)
  const account = sanitizeS3PathSegment(accountNumber)
  const file = sanitizeS3PathSegment(fileName)
  return `customer/${customer}/Disbursements/${account}/${timestamp}-${file}`
}

type Signature = { offset: number; bytes: number[] }

// null = type is allowed but has no reliable signature (plain text formats).
const MAGIC_BYTES: Record<string, Signature[] | null> = {
  'application/pdf': [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }], // %PDF
  'image/jpeg': [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  'image/png': [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  'image/webp': [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // WEBP
  ],
  // xlsx is a zip container
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    { offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },
  ],
  // legacy xls is an OLE compound document
  'application/vnd.ms-excel': [
    { offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  ],
  'text/csv': null,
}

/**
 * True when the byte content matches the declared content type's file
 * signature. Types without a signature (text/csv) always pass; types not in
 * the table always fail — callers gate on their own allowlist first.
 */
export function matchesMagicBytes(bytes: Uint8Array, contentType: string): boolean {
  if (!(contentType in MAGIC_BYTES)) return false
  const signatures = MAGIC_BYTES[contentType]
  if (signatures === null) return true
  return signatures.every(({ offset, bytes: expected }) => {
    if (bytes.length < offset + expected.length) return false
    return expected.every((b, i) => bytes[offset + i] === b)
  })
}

/**
 * Read a request body into memory, aborting as soon as it exceeds maxBytes so
 * an oversized (or unbounded chunked) upload can never exhaust the heap. A
 * declared Content-Length over the limit is rejected without reading at all.
 */
export async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | 'TOO_LARGE'> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return 'TOO_LARGE'

  if (!request.body) return new Uint8Array(0)

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return 'TOO_LARGE'
    }
    chunks.push(value)
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}
