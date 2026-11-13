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
  placeDeleteMarkers,
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
      { key: 'p/a', versionId: 'v-a', isDeleteMarker: false },
      { key: 'p/b', versionId: 'v-b', isDeleteMarker: true },
      { key: 'p/c', versionId: 'null', isDeleteMarker: true },
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
      Deleted: [{ Key: 'a', VersionId: 'null' }],
      Errors: [{ Key: 'b', VersionId: 'null', Message: 'AccessDenied' }],
    })
    const res = await deleteObjectVersions([
      { key: 'a', versionId: 'null' },
      { key: 'b', versionId: 'null' },
    ])
    expect(res.deleted).toHaveLength(1)
    expect(res.failed[0]).toEqual({ key: 'b', versionId: 'null', message: 'AccessDenied' })
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

  it('sends VersionId null through to DeleteObjects', async () => {
    sendMock.mockResolvedValueOnce({ Deleted: [{ Key: 'a', VersionId: 'null' }] })
    await deleteObjectVersions([{ key: 'a', versionId: 'null' }])
    expect(sendMock.mock.calls[0][0].input.Delete.Objects).toEqual([
      { Key: 'a', VersionId: 'null' },
    ])
  })

  it('skips listed items without a VersionId', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    sendMock.mockResolvedValueOnce({ Versions: [{ Key: 'p/x' }, { Key: 'p/y', VersionId: 'v' }] })
    expect(await listObjectVersionsUnderPrefix('p/')).toEqual([
      { key: 'p/y', versionId: 'v', isDeleteMarker: false },
    ])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('fails refs the response does not report', async () => {
    sendMock.mockResolvedValueOnce({ Deleted: [{ Key: 'a', VersionId: 'v1' }] })
    const res = await deleteObjectVersions([
      { key: 'a', versionId: 'v1' },
      { key: 'b', versionId: 'v2' },
    ])
    expect(res.deleted).toHaveLength(1)
    expect(res.failed).toEqual([{ key: 'b', versionId: 'v2', message: 'No result returned' }])
  })

  it('marks versions and delete markers on the same page', async () => {
    sendMock.mockResolvedValueOnce({
      Versions: [{ Key: 'p/a', VersionId: 'v1' }],
      DeleteMarkers: [{ Key: 'p/a', VersionId: 'm1' }],
    })
    expect(await listObjectVersionsUnderPrefix('p/')).toEqual([
      { key: 'p/a', versionId: 'v1', isDeleteMarker: false },
      { key: 'p/a', versionId: 'm1', isDeleteMarker: true },
    ])
  })

  describe('placeDeleteMarkers', () => {
    it('sends plain deletes with no VersionId, Quiet false', async () => {
      sendMock.mockResolvedValueOnce({
        Deleted: [
          { Key: 'a', DeleteMarker: true, DeleteMarkerVersionId: 'm-a' },
          { Key: 'b', DeleteMarker: true, DeleteMarkerVersionId: 'm-b' },
        ],
      })
      const res = await placeDeleteMarkers(['a', 'b'])
      const cmd = sendMock.mock.calls[0][0]
      expect(cmd).toBeInstanceOf(DeleteObjectsCommand)
      expect(cmd.input.Bucket).toBe('b')
      expect(cmd.input.Delete.Quiet).toBe(false)
      expect(cmd.input.Delete.Objects).toEqual([{ Key: 'a' }, { Key: 'b' }])
      for (const o of cmd.input.Delete.Objects) expect(o).not.toHaveProperty('VersionId')
      expect(res).toEqual({ placed: ['a', 'b'], failed: [] })
    })

    it('chunks at 1000', async () => {
      sendMock.mockImplementation(async (cmd: { input: Input }) => ({
        Deleted: cmd.input.Delete.Objects.map((o: Input) => ({ Key: o.Key, DeleteMarker: true })),
      }))
      const keys = Array.from({ length: 2500 }, (_, i) => `k${i}`)
      const res = await placeDeleteMarkers(keys)
      expect(sendMock.mock.calls.map((c) => c[0].input.Delete.Objects.length)).toEqual([
        1000, 1000, 500,
      ])
      expect(res.placed).toHaveLength(2500)
      expect(res.failed).toHaveLength(0)
    })

    it('counts a key deleted without a marker (unversioned bucket) as placed', async () => {
      sendMock.mockResolvedValueOnce({ Deleted: [{ Key: 'a', DeleteMarker: false }] })
      expect(await placeDeleteMarkers(['a'])).toEqual({ placed: ['a'], failed: [] })
    })

    it('fails keys in Errors and keys the response does not report', async () => {
      sendMock.mockResolvedValueOnce({
        Deleted: [{ Key: 'a', DeleteMarker: true }],
        Errors: [{ Key: 'b', Code: 'AccessDenied', Message: 'Access Denied' }],
      })
      const res = await placeDeleteMarkers(['a', 'b', 'c'])
      expect(res.placed).toEqual(['a'])
      expect(res.failed).toEqual([
        { key: 'b', message: 'Access Denied' },
        { key: 'c', message: 'No result returned' },
      ])
    })

    it('a thrown chunk fails only that chunk', async () => {
      sendMock
        .mockRejectedValueOnce(new Error('boom'))
        .mockImplementationOnce(async (cmd: { input: Input }) => ({
          Deleted: cmd.input.Delete.Objects.map((o: Input) => ({ Key: o.Key, DeleteMarker: true })),
        }))
      const keys = Array.from({ length: 1500 }, (_, i) => `k${i}`)
      const res = await placeDeleteMarkers(keys)
      expect(res.failed).toHaveLength(1000)
      expect(res.failed[0]).toEqual({ key: 'k0', message: 'boom' })
      expect(res.placed).toHaveLength(500)
      expect(res.placed[0]).toBe('k1000')
    })

    it('sends nothing for no keys', async () => {
      expect(await placeDeleteMarkers([])).toEqual({ placed: [], failed: [] })
      expect(sendMock).not.toHaveBeenCalled()
    })
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
