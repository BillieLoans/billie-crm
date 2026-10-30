import { describe, it, expect, vi } from 'vitest'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import path from 'path'
import { fileURLToPath } from 'url'

// Hermetic: grpc-base imports platform-auth, which reads PLATFORM_CLIENT_* env.
// Nothing here makes a call, but mirror the other grpc-base tests so a
// developer environment can never reach the signing code.
vi.mock('@/server/platform-auth', () => ({
  platformMetadata: vi.fn(async () => new grpc.Metadata()),
}))

import { PROTO_LOADER_OPTIONS, loadProtoService } from '@/server/grpc-base'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROTO_PATH = path.resolve(__dirname, '../../../proto/accounting_ledger.proto')
const SERVICE_PATH = 'billie.ledger.v1.AccountingLedgerService'
const PKG = 'billie.ledger.v1'

/**
 * proto/accounting_ledger.proto is VENDORED from billie-platform-services and
 * loaded at runtime (no codegen), so a stale copy fails silently: the CRM
 * would simply have no `cancelAccount` method. These tests load the real file
 * with the repo's own loader options (`PROTO_LOADER_OPTIONS`, keepCase:false)
 * and pin the BTB-517 surface so a bad re-sync is caught here.
 */
const packageDefinition = protoLoader.loadSync(PROTO_PATH, PROTO_LOADER_OPTIONS)

/** Round-trip a plain object through a message type's wire encoding. */
function roundTrip(typeName: string, value: Record<string, unknown>): any {
  const def = packageDefinition[`${PKG}.${typeName}`] as protoLoader.MessageTypeDefinition<object, object>
  expect(def, `${typeName} missing from vendored proto`).toBeDefined()
  const bytes = (def as any).serialize ? (def as any).serialize(value) : undefined
  expect(bytes).toBeDefined()
  return (def as any).deserialize(bytes)
}

function fieldNames(typeName: string): string[] {
  const def = packageDefinition[`${PKG}.${typeName}`] as protoLoader.MessageTypeDefinition<object, object>
  expect(def, `${typeName} missing from vendored proto`).toBeDefined()
  return (def.type as any).field.map((f: any) => f.name as string)
}

describe('vendored accounting_ledger.proto (BTB-517)', () => {
  const service = loadProtoService('accounting_ledger.proto', SERVICE_PATH)

  // grpc-js keys the service definition by proto method name (`CancelAccount`)
  // and exposes the camelCase `originalName` (`cancelAccount`) as the client method.
  const cancelAccount = service.service.CancelAccount

  it('exposes cancelAccount and disburseLoan on AccountingLedgerService', () => {
    expect(service.service.CancelAccount?.originalName).toBe('cancelAccount')
    expect(service.service.DisburseLoan?.originalName).toBe('disburseLoan')
    expect(cancelAccount.path).toBe(`/${SERVICE_PATH}/CancelAccount`)
    // The methods the CRM client actually invokes on the constructed stub.
    expect(typeof service.prototype.cancelAccount).toBe('function')
    expect(typeof service.prototype.disburseLoan).toBe('function')
  })

  it('round-trips a camelCase CancelAccountRequest through the wire encoding', () => {
    const request = {
      loanAccountId: 'acc_123',
      reasonCode: 'mutual_cancellation',
      note: 'Customer asked to cancel before funds were released.',
      evidenceRef: 'evd_456',
      actorId: 'user_789',
      actorName: 'Sam Supervisor',
      idempotencyKey: 'idem-abc',
    }

    // Through the service method definition the CRM client actually calls.
    const bytes: Buffer = cancelAccount.requestSerialize(request)
    expect(Buffer.isBuffer(bytes)).toBe(true)
    expect(cancelAccount.requestDeserialize(bytes)).toMatchObject(request)

    // And through the message type directly.
    expect(roundTrip('CancelAccountRequest', request)).toMatchObject(request)
  })

  it('round-trips a CancelAccountResponse (camelCase)', () => {
    const response = {
      success: true,
      message: 'cancelled',
      eventId: 'evt_1',
      cancelledAt: '2026-10-30T01:02:03Z',
    }
    expect(
      cancelAccount.responseDeserialize(
        cancelAccount.responseSerialize(response),
      ),
    ).toMatchObject(response)
  })

  it('exposes checkDisbursable, the read-only gate for the payment panel', () => {
    const checkDisbursable = service.service.CheckDisbursable
    expect(checkDisbursable?.originalName).toBe('checkDisbursable')
    expect(checkDisbursable.path).toBe(`/${SERVICE_PATH}/CheckDisbursable`)
    expect(typeof service.prototype.checkDisbursable).toBe('function')
    // Unary: the CRM client promisifies it like the other reads.
    expect(checkDisbursable.requestStream).toBe(false)
    expect(checkDisbursable.responseStream).toBe(false)
  })

  it('round-trips a camelCase CheckDisbursableRequest and CheckDisbursableResponse', () => {
    const checkDisbursable = service.service.CheckDisbursable
    expect(fieldNames('CheckDisbursableRequest')).toEqual(['loanAccountId'])
    expect(fieldNames('CheckDisbursableResponse')).toEqual([
      'disbursable',
      'reason',
      'status',
      'message',
    ])

    const request = { loanAccountId: 'acc_123' }
    expect(
      checkDisbursable.requestDeserialize(checkDisbursable.requestSerialize(request)),
    ).toMatchObject(request)

    const response = {
      disbursable: false,
      reason: 'CANCELLED',
      status: 'CANCELLED',
      message: 'Loan is CANCELLED — cannot disburse.',
    }
    expect(
      checkDisbursable.responseDeserialize(checkDisbursable.responseSerialize(response)),
    ).toMatchObject(response)
  })

  it('ScheduleSummary carries voidCount', () => {
    expect(fieldNames('ScheduleSummary')).toContain('voidCount')

    const summary = roundTrip('ScheduleSummary', { totalInstalments: 4, voidCount: 4 })
    expect(summary.voidCount).toBe(4)
    expect(summary.totalInstalments).toBe(4)
  })

  it('period close messages carry cancelledBeforeDisbursementCount', () => {
    expect(fieldNames('PreviewPeriodCloseResponse')).toContain('cancelledBeforeDisbursementCount')
    expect(fieldNames('PeriodCloseResponse')).toContain('cancelledBeforeDisbursementCount')

    expect(
      roundTrip('PreviewPeriodCloseResponse', { cancelledBeforeDisbursementCount: 2 })
        .cancelledBeforeDisbursementCount,
    ).toBe(2)
    expect(
      roundTrip('PeriodCloseResponse', { cancelledBeforeDisbursementCount: 3 })
        .cancelledBeforeDisbursementCount,
    ).toBe(3)
  })
})
