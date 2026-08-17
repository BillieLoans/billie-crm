/**
 * Unit tests for the server-side API error helpers (P1-4).
 *
 * Focus: `handleApiError` must map gRPC status codes deterministically —
 * a business-rule rejection (code 9) is a non-retryable 422, not a 500 — while
 * keeping the legacy message-substring behaviour as a fallback.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleApiError, createValidationError } from '@/lib/utils/api-error'
import { ERROR_CODES, isRetryableErrorCode } from '@/lib/errors/codes'
import { parseApiError } from '@/lib/utils/error'

/** Shape of a gRPC ServiceError as rejected by the grpc-client promisify wrapper. */
const grpcError = (code: number, details?: string) =>
  Object.assign(new Error(details || `gRPC error ${code}`), { code, details })

const read = async (res: Response) => ({ status: res.status, body: await res.json() })

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('handleApiError — gRPC status codes', () => {
  it('maps 9 FAILED_PRECONDITION to a 422 with the ledger detail as the message', async () => {
    const res = handleApiError(grpcError(9, 'Fee cap exceeded (NCC s31A)'), {
      action: 'apply-late-fee',
      accountId: 'LA-1',
    })
    const { status, body } = await read(res as unknown as Response)

    expect(status).toBe(422)
    expect(body.error).toBe(ERROR_CODES.LEDGER_REJECTED)
    expect(body.message).toBe('Fee cap exceeded (NCC s31A)')
    expect(body.details).toMatchObject({
      action: 'apply-late-fee',
      accountId: 'LA-1',
      grpcCode: 9,
    })
  })

  it('falls back to a default message when code 9 carries no details', async () => {
    const err = Object.assign(new Error('rejected'), { code: 9 })
    const { status, body } = await read(handleApiError(err) as unknown as Response)

    expect(status).toBe(422)
    expect(body.error).toBe(ERROR_CODES.LEDGER_REJECTED)
    expect(body.message).toBe('The ledger rejected this operation due to a business rule.')
  })

  it('maps 6 ALREADY_EXISTS to a 409', async () => {
    const { status, body } = await read(
      handleApiError(grpcError(6, 'Already disbursed')) as unknown as Response,
    )

    expect(status).toBe(409)
    expect(body.error).toBe(ERROR_CODES.DUPLICATE_OPERATION)
    expect(body.message).toBe('Already disbursed')
  })

  it('maps 5 NOT_FOUND to a 404', async () => {
    const { status, body } = await read(
      handleApiError(grpcError(5, 'no such account'), {
        accountId: 'LA-9',
      }) as unknown as Response,
    )

    expect(status).toBe(404)
    expect(body.error).toBe(ERROR_CODES.ACCOUNT_NOT_FOUND)
    expect(body.details).toMatchObject({ accountId: 'LA-9', grpcCode: 5 })
  })

  it('maps 14 UNAVAILABLE to a retryable 503', async () => {
    const { status, body } = await read(
      handleApiError(grpcError(14, 'no connection established')) as unknown as Response,
    )

    expect(status).toBe(503)
    expect(body.error).toBe(ERROR_CODES.LEDGER_UNAVAILABLE)
    expect(body.details).toMatchObject({ service: 'ledger', grpcCode: 14 })
  })

  it('maps 4 DEADLINE_EXCEEDED to a retryable 503 with safe-to-retry copy', async () => {
    const { status, body } = await read(
      handleApiError(grpcError(4, 'Deadline exceeded'), {
        action: 'record-repayment',
        accountId: 'LA-4',
      }) as unknown as Response,
    )

    expect(status).toBe(503)
    expect(body.error).toBe(ERROR_CODES.LEDGER_TIMEOUT)
    expect(body.message).toBe(
      'The ledger did not respond in time — the outcome is unknown. It is safe to retry this action.',
    )
    expect(body.details).toMatchObject({
      action: 'record-repayment',
      accountId: 'LA-4',
      service: 'ledger',
      grpcCode: 4,
    })
    expect(isRetryableErrorCode(body.error)).toBe(true)
  })

  it('parses a code 4 response into a retryable client AppError', async () => {
    const res = handleApiError(grpcError(4, 'Deadline exceeded')) as unknown as Response
    const appError = await parseApiError(res)

    expect(appError.code).toBe(ERROR_CODES.LEDGER_TIMEOUT)
    expect(appError.statusCode).toBe(503)
    expect(appError.isRetryable()).toBe(true)
    expect(appError.isSystemError()).toBe(true)
    expect(appError.details).toMatchObject({ grpcCode: 4 })
  })

  it('ignores a non-numeric code and falls through to the substring path', async () => {
    const err = Object.assign(new Error('Account not found'), { code: 'NOT_FOUND' })
    const { status, body } = await read(handleApiError(err) as unknown as Response)

    expect(status).toBe(404)
    expect(body.error).toBe(ERROR_CODES.ACCOUNT_NOT_FOUND)
  })

  it('falls through to 500 for an unmapped gRPC code', async () => {
    const { status, body } = await read(
      handleApiError(grpcError(13, 'boom')) as unknown as Response,
    )

    expect(status).toBe(500)
    expect(body.error).toBe(ERROR_CODES.UNKNOWN_ERROR)
  })
})

describe('handleApiError — message substring fallback (unchanged)', () => {
  it('maps "unavailable" to LEDGER_UNAVAILABLE (503)', async () => {
    const { status, body } = await read(
      handleApiError(new Error('Ledger unavailable')) as unknown as Response,
    )

    expect(status).toBe(503)
    expect(body.error).toBe(ERROR_CODES.LEDGER_UNAVAILABLE)
  })

  it('maps "not found" to ACCOUNT_NOT_FOUND (404)', async () => {
    const { status, body } = await read(
      handleApiError(new Error('Account not found')) as unknown as Response,
    )

    expect(status).toBe(404)
    expect(body.error).toBe(ERROR_CODES.ACCOUNT_NOT_FOUND)
  })

  it('maps "permission" to INSUFFICIENT_PRIVILEGES (403)', async () => {
    const { status, body } = await read(
      handleApiError(new Error('permission denied')) as unknown as Response,
    )

    expect(status).toBe(403)
    expect(body.error).toBe(ERROR_CODES.INSUFFICIENT_PRIVILEGES)
  })

  it('defaults to UNKNOWN_ERROR (500)', async () => {
    const { status, body } = await read(
      handleApiError(new Error('something odd')) as unknown as Response,
    )

    expect(status).toBe(500)
    expect(body.error).toBe(ERROR_CODES.UNKNOWN_ERROR)
  })

  it('handles non-Error throwables', async () => {
    const { status, body } = await read(handleApiError('nope') as unknown as Response)

    expect(status).toBe(500)
    expect(body.error).toBe(ERROR_CODES.UNKNOWN_ERROR)
  })
})

describe('createValidationError', () => {
  it('returns the routes’ conventional 400 body', async () => {
    const { status, body } = await read(
      createValidationError({ amount: ['Required'] }) as unknown as Response,
    )

    expect(status).toBe(400)
    expect(body).toEqual({ error: 'Validation failed', details: { amount: ['Required'] } })
  })
})
