import { describe, it, expect } from 'vitest'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  decodeCaseActionResponse,
  decodeCaseEconomics,
  decodeContactLog,
  timestampToIso,
  isNotFound,
  isFailedPrecondition,
  isResourceExhausted,
} from '@/server/collections-service-client'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROTO_PATH = path.resolve(__dirname, '../../../proto/collections_service.proto')

describe('collections-service-client mappers', () => {
  describe('decodeCaseActionResponse', () => {
    it('maps fields with defaults for missing values', () => {
      expect(decodeCaseActionResponse({})).toEqual({
        accountId: '',
        newState: '',
        emittedEventId: '',
      })
    })

    it('maps a full response', () => {
      expect(
        decodeCaseActionResponse({
          accountId: 'acc_1',
          newState: 'paused_hardship',
          emittedEventId: 'evt_1',
        }),
      ).toEqual({
        accountId: 'acc_1',
        newState: 'paused_hardship',
        emittedEventId: 'evt_1',
      })
    })
  })

  describe('decodeCaseEconomics', () => {
    it('maps NOT_APPLICABLE gate result with an empty preview to null (Phase 2 not deployed)', () => {
      const raw = {
        accountId: 'acc_1',
        amountOwed: '100.00',
        costOfNextStep: '0.00',
        expectedNetRecovery: '0.00',
        gateResult: { status: 'NOT_APPLICABLE', reason: 'cost-of-recovery engine not deployed' },
        costLedger: [],
        nextStepPreview: {},
      }
      const result = decodeCaseEconomics(raw)
      expect(result.gateResult).toEqual({
        status: 'NOT_APPLICABLE',
        reason: 'cost-of-recovery engine not deployed',
      })
      expect(result.nextStepPreview).toBeNull()
      expect(result.costLedger).toEqual([])
    })

    it('maps a PASS gate result with a populated preview and cost ledger', () => {
      const raw = {
        accountId: 'acc_2',
        amountOwed: '250.50',
        costOfNextStep: '1.20',
        expectedNetRecovery: '200.00',
        gateResult: { status: 'PASS', reason: 'expected recovery exceeds cost' },
        costLedger: [
          { label: 'SMS', amount: '0.05', category: 'production', recoverable: false },
          { label: 'Collections agent time', amount: '1.15', category: 'hard', recoverable: true },
        ],
        nextStepPreview: {
          rung: 3,
          channel: 'sms',
          template: 'rung3_sms',
          subject: '',
          body: 'Your payment is overdue.',
        },
      }
      const result = decodeCaseEconomics(raw)
      expect(result.gateResult.status).toBe('PASS')
      expect(result.nextStepPreview).toEqual({
        rung: 3,
        channel: 'sms',
        template: 'rung3_sms',
        subject: '',
        body: 'Your payment is overdue.',
      })
      expect(result.costLedger).toEqual([
        { label: 'SMS', amount: '0.05', category: 'production', recoverable: false },
        { label: 'Collections agent time', amount: '1.15', category: 'hard', recoverable: true },
      ])
    })

    it('treats a null/undefined nextStepPreview as null', () => {
      expect(
        decodeCaseEconomics({ accountId: 'acc_3', nextStepPreview: null }).nextStepPreview,
      ).toBeNull()
      expect(
        decodeCaseEconomics({ accountId: 'acc_3', nextStepPreview: undefined }).nextStepPreview,
      ).toBeNull()
    })

    it('falls back to GATE_UNSPECIFIED for an unknown/missing gate status', () => {
      expect(decodeCaseEconomics({}).gateResult).toEqual({ status: 'GATE_UNSPECIFIED', reason: '' })
      expect(
        decodeCaseEconomics({ gateResult: { status: 'SOME_UNKNOWN_VALUE' } }).gateResult.status,
      ).toBe('GATE_UNSPECIFIED')
    })

    it('defaults category to "production" unless the wire value is exactly "hard"', () => {
      const result = decodeCaseEconomics({
        costLedger: [{ label: 'x', amount: '1.00', category: 'unexpected', recoverable: false }],
      })
      expect(result.costLedger[0].category).toBe('production')
    })
  })

  describe('timestampToIso', () => {
    it('returns null for null/undefined input', () => {
      expect(timestampToIso(null)).toBeNull()
      expect(timestampToIso(undefined)).toBeNull()
    })

    it('returns null when seconds is zero/falsy (unset proto timestamp)', () => {
      expect(timestampToIso({ seconds: 0, nanos: 0 })).toBeNull()
      expect(timestampToIso({ seconds: '0' })).toBeNull()
    })

    it('converts seconds + nanos to an ISO string', () => {
      expect(timestampToIso({ seconds: '1735689600', nanos: 0 })).toBe('2025-01-01T00:00:00.000Z')
    })

    it('accepts numeric seconds as well as string seconds', () => {
      expect(timestampToIso({ seconds: 1735689600, nanos: 500_000_000 })).toBe(
        '2025-01-01T00:00:00.500Z',
      )
    })
  })

  describe('decodeContactLog', () => {
    it('maps entries with sentAt via timestampToIso and defaults contactCapStatus', () => {
      const raw = {
        accountId: 'acc_1',
        entries: [
          {
            sentAt: { seconds: '1735689600', nanos: 0 },
            channel: 'sms',
            template: 'rung1_sms',
            outcome: 'sent',
          },
          { sentAt: null, channel: 'email', template: 'rung2_email', outcome: 'skipped' },
        ],
        // Wire keys as they actually arrive from @grpc/proto-loader (keepCase:false does
        // NOT camelCase an underscore followed by a digit): sent_7d / cap_7d, but
        // sent_month / cap_month DO camelCase normally.
        contactCapStatus: { sent_7d: 2, cap_7d: 3, sentMonth: 6, capMonth: 10 },
      }
      const result = decodeContactLog(raw)
      expect(result.accountId).toBe('acc_1')
      expect(result.entries).toEqual([
        {
          sentAt: '2025-01-01T00:00:00.000Z',
          channel: 'sms',
          template: 'rung1_sms',
          outcome: 'sent',
        },
        { sentAt: null, channel: 'email', template: 'rung2_email', outcome: 'skipped' },
      ])
      expect(result.contactCapStatus).toEqual({ sent7d: 2, cap7d: 3, sentMonth: 6, capMonth: 10 })
    })

    it('defaults to empty entries and zeroed cap status when fields are missing', () => {
      const result = decodeContactLog({ accountId: 'acc_2' })
      expect(result.entries).toEqual([])
      expect(result.contactCapStatus).toEqual({ sent7d: 0, cap7d: 0, sentMonth: 0, capMonth: 0 })
    })

    it('round-trips a real ContactLog through the actual proto wire encoding (catches proto-loader camelCase surprises like sent_7d/cap_7d)', () => {
      // Load the real .proto with the exact options the client uses, so this test
      // fails the moment the wire shape and decodeContactCapStatus's key names diverge —
      // rather than relying on hand-built fixtures that can silently encode the same bug.
      const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
        keepCase: false,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      })
      const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any
      const ContactLogType = protoDescriptor.billie.collections.v1.ContactLog

      // Sanity check on the descriptor itself: sent_7d/cap_7d must NOT have been
      // camelCased away by proto-loader (unlike sent_month/cap_month, which do).
      const capStatusFields = protoDescriptor.billie.collections.v1.ContactCapStatus.type.field.map(
        (f: { name: string }) => f.name,
      )
      expect(capStatusFields).toEqual(['sent_7d', 'cap_7d', 'sentMonth', 'capMonth'])

      const input = {
        accountId: 'acc_1',
        entries: [
          {
            sentAt: { seconds: '1735689600', nanos: 0 },
            channel: 'sms',
            template: 'rung1_sms',
            outcome: 'sent',
          },
        ],
        contactCapStatus: { sent_7d: 2, cap_7d: 3, sentMonth: 6, capMonth: 10 },
      }

      // Serialize to real protobuf wire bytes and deserialize back — this is the exact
      // shape a gRPC client callback receives, wire keys and all.
      const wireBytes = ContactLogType.serialize(input)
      const wireObject = ContactLogType.deserialize(wireBytes)

      const result = decodeContactLog(wireObject)
      expect(result.contactCapStatus).toEqual({ sent7d: 2, cap7d: 3, sentMonth: 6, capMonth: 10 })
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].sentAt).toBe('2025-01-01T00:00:00.000Z')
    })
  })

  describe('error helpers', () => {
    it('isNotFound matches gRPC code 5 (NOT_FOUND) only', () => {
      expect(grpc.status.NOT_FOUND).toBe(5)
      expect(isNotFound({ code: grpc.status.NOT_FOUND })).toBe(true)
      expect(isNotFound({ code: grpc.status.FAILED_PRECONDITION })).toBe(false)
      expect(isNotFound(null)).toBe(false)
      expect(isNotFound(undefined)).toBe(false)
      expect(isNotFound('not an object')).toBe(false)
    })

    it('isFailedPrecondition matches gRPC code 9 (FAILED_PRECONDITION) only', () => {
      expect(grpc.status.FAILED_PRECONDITION).toBe(9)
      expect(isFailedPrecondition({ code: grpc.status.FAILED_PRECONDITION })).toBe(true)
      expect(isFailedPrecondition({ code: grpc.status.NOT_FOUND })).toBe(false)
      expect(isFailedPrecondition(null)).toBe(false)
    })

    it('isResourceExhausted matches gRPC code 8 (RESOURCE_EXHAUSTED) only', () => {
      expect(grpc.status.RESOURCE_EXHAUSTED).toBe(8)
      expect(isResourceExhausted({ code: grpc.status.RESOURCE_EXHAUSTED })).toBe(true)
      expect(isResourceExhausted({ code: grpc.status.FAILED_PRECONDITION })).toBe(false)
      expect(isResourceExhausted(null)).toBe(false)
    })
  })
})
