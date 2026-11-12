import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendMock = vi.fn()

vi.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    send = (cmd: unknown) => sendMock(cmd)
  }
  class ListObjectVersionsCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class DeleteObjectsCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class PutObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  class GetObjectCommand {
    constructor(public input: Record<string, unknown>) {}
  }
  return {
    S3Client,
    ListObjectVersionsCommand,
    DeleteObjectsCommand,
    PutObjectCommand,
    GetObjectCommand,
  }
})

import { DeleteObjectsCommand, ListObjectVersionsCommand } from '@aws-sdk/client-s3'
import {
  deleteObjectVersions,
  getStatementBaseFolder,
  listObjectVersionsUnderPrefix,
} from '@/server/s3-client'

type Input = Record<string, any>

describe('s3 statement delete helpers', () => {
  beforeEach(() => {
    sendMock.mockReset()
    process.env.S3_BUCKET_NAME = 'b'
  })

  it('lists all pages', async () => {
    sendMock
      .mockResolvedValueOnce({
        IsTruncated: true,
        NextKeyMarker: 'k1',
        NextVersionIdMarker: 'v1',
        Versions: [{ Key: 'p/a', VersionId: 'v-a' }],
      })
      .mockResolvedValueOnce({
        IsTruncated: false,
        DeleteMarkers: [
          { Key: 'p/b', VersionId: 'v-b' },
          { Key: 'p/c', VersionId: 'null' },
        ],
      })
    const refs = await listObjectVersionsUnderPrefix('p/')
    expect(refs).toEqual([
      { key: 'p/a', versionId: 'v-a' },
      { key: 'p/b', versionId: 'v-b' },
      { key: 'p/c' },
    ])
    expect(sendMock).toHaveBeenCalledTimes(2)
    const first = sendMock.mock.calls[0][0]
    const second = sendMock.mock.calls[1][0]
    expect(first).toBeInstanceOf(ListObjectVersionsCommand)
    expect(first.input).toMatchObject({ Bucket: 'b', Prefix: 'p/' })
    expect(second.input).toMatchObject({ KeyMarker: 'k1', VersionIdMarker: 'v1' })
  })

  it('chunks deletes at 1000', async () => {
    sendMock.mockImplementation(async (cmd: { input: Input }) => ({
      Deleted: cmd.input.Delete.Objects.map((o: Input) => ({ Key: o.Key, VersionId: o.VersionId })),
    }))
    const refs = Array.from({ length: 2500 }, (_, i) => ({ key: `k${i}`, versionId: `v${i}` }))
    const res = await deleteObjectVersions(refs)
    const sizes = sendMock.mock.calls.map((c) => {
      expect(c[0]).toBeInstanceOf(DeleteObjectsCommand)
      expect(c[0].input.Delete.Quiet).toBe(false)
      return c[0].input.Delete.Objects.length
    })
    expect(sizes).toEqual([1000, 1000, 500])
    expect(res.deleted).toHaveLength(2500)
    expect(res.failed).toHaveLength(0)
  })

  it('reports per-key errors from a 200 response', async () => {
    sendMock.mockResolvedValueOnce({
      Deleted: [{ Key: 'a' }],
      Errors: [{ Key: 'b', Message: 'AccessDenied' }],
    })
    const res = await deleteObjectVersions([{ key: 'a' }, { key: 'b' }])
    expect(res.deleted).toHaveLength(1)
    expect(res.failed[0]).toEqual({ key: 'b', message: 'AccessDenied' })
  })

  it('a thrown chunk fails only that chunk', async () => {
    sendMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementationOnce(async (cmd: { input: Input }) => ({
        Deleted: cmd.input.Delete.Objects.map((o: Input) => ({
          Key: o.Key,
          VersionId: o.VersionId,
        })),
      }))
    const refs = Array.from({ length: 1500 }, (_, i) => ({ key: `k${i}`, versionId: `v${i}` }))
    const res = await deleteObjectVersions(refs)
    expect(res.failed).toHaveLength(1000)
    expect(res.failed[0].message).toBe('boom')
    expect(res.deleted).toHaveLength(500)
  })

  it('getStatementBaseFolder throws when unset', () => {
    const prev = process.env.S3_STATEMENT_BASE_FOLDER
    delete process.env.S3_STATEMENT_BASE_FOLDER
    expect(() => getStatementBaseFolder()).toThrow(
      'S3_STATEMENT_BASE_FOLDER environment variable is not set',
    )
    process.env.S3_STATEMENT_BASE_FOLDER = 'demo'
    expect(getStatementBaseFolder()).toBe('demo')
    if (prev === undefined) delete process.env.S3_STATEMENT_BASE_FOLDER
    else process.env.S3_STATEMENT_BASE_FOLDER = prev
  })
})
