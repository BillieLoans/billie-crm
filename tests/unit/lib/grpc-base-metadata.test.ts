// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import * as grpc from '@grpc/grpc-js'

vi.mock('@/server/platform-auth', () => ({
  platformMetadata: vi.fn(async () => {
    const md = new grpc.Metadata()
    md.set('authorization', 'Bearer stub')
    return md
  }),
}))

import { promisifyGrpcCall } from '@/server/grpc-base'

describe('promisifyGrpcCall metadata', () => {
  it('passes platform metadata and a deadline to the stub method', async () => {
    const method = vi.fn((_req: unknown, md: grpc.Metadata, opts: grpc.CallOptions, cb: (e: unknown, r: string) => void) => {
      expect(md.get('authorization')).toEqual(['Bearer stub'])
      expect(opts.deadline).toBeInstanceOf(Date)
      cb(null, 'ok')
    })
    const client = {}
    await expect(promisifyGrpcCall<unknown, string>(client, method as never, 'read')({ a: 1 })).resolves.toBe('ok')
    expect(method).toHaveBeenCalledTimes(1)
  })

  it('rejects with the stub error', async () => {
    const method = vi.fn((_r: unknown, _m: grpc.Metadata, _o: grpc.CallOptions, cb: (e: unknown) => void) => cb(new Error('boom')))
    await expect(promisifyGrpcCall<unknown, string>({}, method as never)({})).rejects.toThrow('boom')
  })
})
