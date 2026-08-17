import { describe, it, expect, afterEach, vi } from 'vitest'
import { isPlaintextAddress, getDeadlineMs, promisifyGrpcCall } from '@/server/grpc-base'

/**
 * src/server/grpc-base.ts is the single source of truth for two things that
 * previously existed as four hand-copied variants across the ledger,
 * collections, notification-dispatcher and marketing clients:
 *
 *  1. the insecure-vs-TLS address predicate (the `.platform` clause had been
 *     added to only two of the four, so pointing the ledger at a plaintext
 *     `.platform` host would have attempted TLS and failed);
 *  2. the promisify wrapper, which now always attaches a deadline so a hung
 *     upstream can't pin a Next.js worker forever on a money route.
 *
 * These tests exercise the real exported helpers — not a re-implementation —
 * so drift in the source is caught here.
 */

const ENV_KEYS = [
  'GRPC_READ_DEADLINE_MS',
  'GRPC_WRITE_DEADLINE_MS',
  'GRPC_BATCH_DEADLINE_MS',
] as const

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
  vi.useRealTimers()
})

describe('isPlaintextAddress', () => {
  it('treats Fly.io .internal addresses as plaintext (already WireGuard-encrypted)', () => {
    expect(isPlaintextAddress('billie-platform-services-prod.internal:50051')).toBe(true)
    expect(isPlaintextAddress('my-service.internal:443')).toBe(true)
    expect(isPlaintextAddress('service.internal')).toBe(true)
    expect(isPlaintextAddress('deep.nested.internal:50051')).toBe(true)
  })

  it('treats .platform service-discovery names as plaintext (no TLS listener)', () => {
    // The regression this unification fixes: only the collections and
    // notification clients carried this clause, so a ledger pointed at a
    // .platform host attempted TLS against a plaintext port.
    expect(isPlaintextAddress('ledger.platform:50051')).toBe(true)
    expect(isPlaintextAddress('collections-service.platform:50053')).toBe(true)
    expect(isPlaintextAddress('notification-dispatcher.platform')).toBe(true)
  })

  it('treats localhost and 127.x as plaintext', () => {
    expect(isPlaintextAddress('localhost:50051')).toBe(true)
    expect(isPlaintextAddress('localhost')).toBe(true)
    expect(isPlaintextAddress('127.0.0.1:50051')).toBe(true)
    expect(isPlaintextAddress('127.0.0.1')).toBe(true)
  })

  it('requires TLS for public addresses', () => {
    expect(isPlaintextAddress('api.example.com:443')).toBe(false)
    expect(isPlaintextAddress('ledger.billie.loans:50051')).toBe(false)
    // Must not match a host that merely starts with a similar string.
    expect(isPlaintextAddress('notlocalhost:50051')).toBe(false)
    // .internal / .platform only count as the trailing label, not mid-host.
    expect(isPlaintextAddress('internal.example.com:443')).toBe(false)
    expect(isPlaintextAddress('platform.example.com:443')).toBe(false)
  })

  it('lets an explicit TLS flag override the address heuristic in both directions', () => {
    // Force TLS on an address the regex would call plaintext.
    expect(isPlaintextAddress('ledger.platform:50051', 'true')).toBe(false)
    expect(isPlaintextAddress('localhost:50051', '1')).toBe(false)
    // Force plaintext on an address the regex would call TLS.
    expect(isPlaintextAddress('ledger.billie.loans:50051', 'false')).toBe(true)
    expect(isPlaintextAddress('ledger.billie.loans:50051', 'insecure')).toBe(true)
  })

  it('falls back to the regex when the flag is absent or unparseable', () => {
    expect(isPlaintextAddress('ledger.billie.loans:50051', undefined)).toBe(false)
    expect(isPlaintextAddress('ledger.billie.loans:50051', '')).toBe(false)
    expect(isPlaintextAddress('ledger.billie.loans:50051', 'maybe')).toBe(false)
    expect(isPlaintextAddress('localhost:50051', 'maybe')).toBe(true)
  })
})

describe('getDeadlineMs', () => {
  it('defaults: reads fail fast, writes get a long leash, batch longer still', () => {
    expect(getDeadlineMs('read')).toBe(10_000)
    expect(getDeadlineMs('write')).toBe(45_000)
    expect(getDeadlineMs('batch')).toBe(300_000)
  })

  it('is config-driven per class', () => {
    process.env.GRPC_READ_DEADLINE_MS = '2500'
    process.env.GRPC_WRITE_DEADLINE_MS = '60000'
    process.env.GRPC_BATCH_DEADLINE_MS = '90000'
    expect(getDeadlineMs('read')).toBe(2500)
    expect(getDeadlineMs('write')).toBe(60_000)
    expect(getDeadlineMs('batch')).toBe(90_000)
  })

  it('ignores junk and non-positive overrides rather than un-bounding a call', () => {
    process.env.GRPC_READ_DEADLINE_MS = 'soon'
    expect(getDeadlineMs('read')).toBe(10_000)
    process.env.GRPC_READ_DEADLINE_MS = '0'
    expect(getDeadlineMs('read')).toBe(10_000)
    process.env.GRPC_READ_DEADLINE_MS = '-5'
    expect(getDeadlineMs('read')).toBe(10_000)
  })
})

describe('promisifyGrpcCall', () => {
  /** Minimal stand-in for a generated unary stub: records the CallOptions it was handed. */
  function stubMethod(result: unknown, error?: unknown) {
    const calls: { request: unknown; options: any }[] = []
    const method = function (
      this: unknown,
      request: unknown,
      options: any,
      callback: (err: unknown, res: unknown) => void,
    ) {
      calls.push({ request, options })
      if (error) callback(error, undefined)
      else callback(null, result)
    }
    return { method, calls }
  }

  it('sets a deadline on every call, and the read deadline is shorter than the write one', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T00:00:00.000Z'))
    const now = Date.now()

    const read = stubMethod({ ok: true })
    const write = stubMethod({ ok: true })
    const batch = stubMethod({ ok: true })

    await promisifyGrpcCall(null, read.method as any, 'read')({})
    await promisifyGrpcCall(null, write.method as any, 'write')({})
    await promisifyGrpcCall(null, batch.method as any, 'batch')({})

    const readDeadline = read.calls[0].options.deadline as Date
    const writeDeadline = write.calls[0].options.deadline as Date
    const batchDeadline = batch.calls[0].options.deadline as Date

    // A deadline is present at all — the actual finding: ~40 RPCs had none.
    expect(readDeadline).toBeInstanceOf(Date)
    expect(writeDeadline).toBeInstanceOf(Date)
    expect(batchDeadline).toBeInstanceOf(Date)

    expect(readDeadline.getTime() - now).toBe(10_000)
    expect(writeDeadline.getTime() - now).toBe(45_000)
    expect(batchDeadline.getTime() - now).toBe(300_000)

    // The point of the classification: writes are NOT twitchy (XR-8), reads are.
    expect(readDeadline.getTime()).toBeLessThan(writeDeadline.getTime())
    expect(writeDeadline.getTime()).toBeLessThan(batchDeadline.getTime())
  })

  it('defaults to the read class when no kind is given', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T00:00:00.000Z'))
    const now = Date.now()
    const stub = stubMethod({ ok: true })
    await promisifyGrpcCall(null, stub.method as any)({})
    expect((stub.calls[0].options.deadline as Date).getTime() - now).toBe(10_000)
  })

  it('honours a fixed override (the marketing client keeps its own 5s bound)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T00:00:00.000Z'))
    const now = Date.now()
    const stub = stubMethod({ ok: true })
    await promisifyGrpcCall(null, stub.method as any, 'write', 5000)({})
    expect((stub.calls[0].options.deadline as Date).getTime() - now).toBe(5000)
  })

  it('picks up env-configured deadlines at call time, not at import time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T00:00:00.000Z'))
    const now = Date.now()
    process.env.GRPC_READ_DEADLINE_MS = '1234'
    const stub = stubMethod({ ok: true })
    await promisifyGrpcCall(null, stub.method as any, 'read')({})
    expect((stub.calls[0].options.deadline as Date).getTime() - now).toBe(1234)
  })

  it('calls the stub with the client as `this` and forwards the request untouched', async () => {
    const client = { marker: 'ledger-stub' }
    const seen: unknown[] = []
    const method = function (this: unknown, request: unknown, _o: any, cb: any) {
      seen.push(this)
      cb(null, request)
    }
    const request = { loanAccountId: 'acc_1' }
    const response = await promisifyGrpcCall(client, method as any, 'read')(request)
    expect(seen[0]).toBe(client)
    expect(response).toBe(request)
  })

  it('rejects with the raw gRPC ServiceError so { code, details } survives to handleApiError', async () => {
    // DEADLINE_EXCEEDED is code 4; api-error.ts branches on the numeric code.
    const serviceError = Object.assign(new Error('4 DEADLINE_EXCEEDED: Deadline exceeded'), {
      code: 4,
      details: 'Deadline exceeded',
    })
    const stub = stubMethod(undefined, serviceError)
    await expect(promisifyGrpcCall(null, stub.method as any, 'write')({})).rejects.toBe(
      serviceError,
    )
    await expect(promisifyGrpcCall(null, stub.method as any, 'write')({})).rejects.toMatchObject({
      code: 4,
      details: 'Deadline exceeded',
    })
  })
})
