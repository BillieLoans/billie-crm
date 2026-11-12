/**
 * The statement-file deletion service: scope resolution, warnings, the S3
 * list → place delete markers → delete versions → verify cycle, and the
 * append-only log row per application.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Payload } from 'payload'

vi.mock('@/server/s3-client', () => ({
  listObjectVersionsUnderPrefix: vi.fn(),
  placeDeleteMarkers: vi.fn(),
  deleteObjectVersions: vi.fn(),
  getStatementBaseFolder: vi.fn(() => 'customer'),
}))

import {
  deleteObjectVersions,
  listObjectVersionsUnderPrefix,
  placeDeleteMarkers,
  type ObjectVersionRef,
  type VersionedKey,
} from '@/server/s3-client'
import {
  DeletionLogWriteError,
  executeDeletion,
  latestDeletion,
  previewDeletion,
} from '@/server/statement-deletion'

const listMock = vi.mocked(listObjectVersionsUnderPrefix)
const markerMock = vi.mocked(placeDeleteMarkers)
const deleteMock = vi.mocked(deleteObjectVersions)

type Row = Record<string, any>

/**
 * A versioned bucket held in memory. Listing reads it; a delete without a
 * VersionId adds a delete-marker version for the key; a delete by VersionId
 * removes that version.
 */
let bucket: ObjectVersionRef[] = []
let markerSeq = 0
const id = (r: VersionedKey) => `${r.key}\u0000${r.versionId}`
const data = (key: string, versionId: string): ObjectVersionRef => ({
  key,
  versionId,
  isDeleteMarker: false,
})
const marker = (key: string, versionId: string): ObjectVersionRef => ({
  key,
  versionId,
  isDeleteMarker: true,
})
const markerIds = () => new Set(bucket.filter((r) => r.isDeleteMarker).map(id))
const dataIn = (refs: ObjectVersionRef[]) => refs.filter((r) => !r.isDeleteMarker)

function seed(...keys: string[]) {
  bucket.push(...keys.map((key, i) => data(key, `v${i}`)))
}

function addMarkers(keys: string[]) {
  for (const key of keys) bucket.push(marker(key, `dm-${++markerSeq}`))
  return { placed: [...keys], failed: [] }
}

function makePayload(opts: { conversations?: Row[]; loanAccounts?: Row[]; deletions?: Row[] }) {
  const conversations = opts.conversations ?? []
  const loanAccounts = opts.loanAccounts ?? []
  const deletions = opts.deletions ?? []
  const find = vi.fn(async (args: Row) => {
    const where = args.where ?? {}
    if (args.collection === 'conversations') {
      const docs = conversations.filter((c) =>
        where.conversationId
          ? c.conversationId === where.conversationId.equals
          : c.customerIdString === where.customerIdString?.equals,
      )
      return { docs }
    }
    if (args.collection === 'loan-accounts') {
      const docs = loanAccounts
        .filter((l) => l.applicationNumber === where.applicationNumber?.equals)
        .slice(0, args.limit)
      return { docs }
    }
    if (args.collection === 'statement-file-deletions') {
      const statuses: string[] | undefined = where.status?.in
      const minDeleted: number | undefined = where.filesDeleted?.greater_than
      const docs = deletions
        .filter((d) => d.conversationId === where.conversationId?.equals)
        .filter((d) => !statuses || statuses.includes(d.status))
        .filter((d) => minDeleted === undefined || Number(d.filesDeleted) > minDeleted)
        .sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)))
        .slice(0, args.limit)
      return { docs }
    }
    throw new Error(`unexpected collection ${args.collection}`)
  })
  const create = vi.fn(async (args: Row) => ({ id: 'row', ...args.data }))
  return { payload: { find, create } as unknown as Payload, find, create }
}

const conv = (over: Row = {}): Row => ({
  conversationId: 'C-1',
  applicationNumber: 'APP-1',
  customerIdString: 'CUS-1',
  status: 'declined',
  statementCapture: null,
  ...over,
})

const actor = { id: 'u-1', email: 'sup@billie.loans', name: 'Sue Pervisor' }

beforeEach(() => {
  bucket = []
  markerSeq = 0
  listMock.mockReset()
  markerMock.mockReset()
  deleteMock.mockReset()
  listMock.mockImplementation(async (prefix: string) =>
    bucket.filter((r) => r.key.startsWith(prefix)).map((r) => ({ ...r })),
  )
  markerMock.mockImplementation(async (keys: string[]) => addMarkers(keys))
  deleteMock.mockImplementation(async (refs: VersionedKey[]) => {
    const markers = markerIds()
    if (refs.some((r) => markers.has(id(r)))) {
      throw new Error('test bucket: a delete marker was sent to deleteObjectVersions')
    }
    const gone = new Set(refs.map(id))
    bucket = bucket.filter((r) => !gone.has(id(r)))
    return { deleted: refs, failed: [] }
  })
})

describe('executeDeletion', () => {
  it('application scope lists both prefixes and logs one row', async () => {
    seed(
      'customer/APP-1/statements/a.json',
      'customer/APP-1/statements/b.pdf',
      'customer/APP-1/AffordabilityReports/r.pdf',
    )
    const { payload, create, find } = makePayload({ conversations: [conv()] })

    const results = await executeDeletion(
      payload,
      { scope: 'application', conversationId: 'C-1' },
      'Customer asked',
      actor,
    )

    expect(listMock).toHaveBeenCalledWith('customer/APP-1/statements/')
    expect(listMock).toHaveBeenCalledWith('customer/APP-1/AffordabilityReports/')
    expect(find.mock.calls[0][0]).toMatchObject({
      collection: 'conversations',
      where: { conversationId: { equals: 'C-1' } },
      overrideAccess: true,
      pagination: false,
    })
    expect(create).toHaveBeenCalledTimes(1)
    const row = create.mock.calls[0][0]
    expect(row.collection).toBe('statement-file-deletions')
    expect(row.overrideAccess).toBe(true)
    expect(row.data).toMatchObject({
      conversationId: 'C-1',
      applicationNumber: 'APP-1',
      customerIdString: 'CUS-1',
      scope: 'application',
      status: 'deleted',
      filesFound: 3,
      filesDeleted: 3,
      reason: 'Customer asked',
      actorId: 'u-1',
      actorEmail: 'sup@billie.loans',
      actorName: 'Sue Pervisor',
      failedKeys: [],
    })
    expect([...row.data.deletedKeys].sort()).toEqual([
      'customer/APP-1/AffordabilityReports/r.pdf',
      'customer/APP-1/statements/a.json',
      'customer/APP-1/statements/b.pdf',
    ])
    expect(typeof row.data.occurredAt).toBe('string')
    expect(results).toEqual([
      expect.objectContaining({
        conversationId: 'C-1',
        applicationNumber: 'APP-1',
        status: 'deleted',
        fileCount: 3,
        filesDeleted: 3,
        failedCount: 0,
        warnings: [],
      }),
    ])
  })

  it('customer scope resolves by exact customerIdString', async () => {
    seed('customer/APP-1/statements/a.json', 'customer/APP-2/statements/b.json')
    const { payload, find, create } = makePayload({
      conversations: [
        conv(),
        conv({ conversationId: 'C-2', applicationNumber: 'APP-2' }),
        conv({ conversationId: 'C-3', applicationNumber: 'APP-3', customerIdString: 'CUS-10' }),
      ],
    })

    const results = await executeDeletion(
      payload,
      { scope: 'customer', customerIdString: 'CUS-1' },
      'Customer asked',
      actor,
    )

    const args = find.mock.calls[0][0]
    expect(args.collection).toBe('conversations')
    expect(args.where).toEqual({ customerIdString: { equals: 'CUS-1' } })
    expect(args.pagination).toBe(false)
    expect(args.overrideAccess).toBe(true)
    expect(results.map((r) => r.conversationId)).toEqual(['C-1', 'C-2'])
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls.every((c) => c[0].data.scope === 'customer')).toBe(true)
  })

  it('drops keys outside the prefixes', async () => {
    seed('customer/APP-1/statements/a.json')
    const stray = data('customer/APP-10/statements/x', 'vx')
    listMock.mockImplementation(async (prefix: string) => {
      const real = bucket.filter((r) => r.key.startsWith(prefix))
      return prefix.endsWith('/statements/') ? [...real, stray] : real
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { payload, create } = makePayload({ conversations: [conv()] })

    await executeDeletion(payload, { scope: 'application', conversationId: 'C-1' }, 'r', actor)

    const passed = deleteMock.mock.calls.flatMap((c) => c[0])
    expect(passed.map((r) => r.key)).toEqual(['customer/APP-1/statements/a.json'])
    expect(markerMock.mock.calls.flatMap((c) => c[0])).toEqual(['customer/APP-1/statements/a.json'])
    expect(errSpy.mock.calls.some((c) => JSON.stringify(c).includes(stray.key))).toBe(true)
    expect(create.mock.calls[0][0].data).toMatchObject({
      status: 'deleted',
      filesFound: 1,
      filesDeleted: 1,
    })
    errSpy.mockRestore()
  })

  it('partial: 2 deleted and 1 failed', async () => {
    seed(
      'customer/APP-1/statements/a.json',
      'customer/APP-1/statements/b.json',
      'customer/APP-1/AffordabilityReports/c.pdf',
    )
    deleteMock.mockImplementation(async (refs: VersionedKey[]) => {
      const failed = refs.filter((r) => r.key.endsWith('c.pdf'))
      const deleted = refs.filter((r) => !r.key.endsWith('c.pdf'))
      const gone = new Set(deleted.map(id))
      bucket = bucket.filter((r) => !gone.has(id(r)))
      return { deleted, failed: failed.map((r) => ({ ...r, message: 'AccessDenied' })) }
    })
    const { payload, create } = makePayload({ conversations: [conv()] })

    const [result] = await executeDeletion(
      payload,
      { scope: 'application', conversationId: 'C-1' },
      'r',
      actor,
    )

    expect(result).toMatchObject({
      status: 'partial',
      fileCount: 3,
      filesDeleted: 2,
      failedCount: 1,
      error: 'Could not delete: AccessDenied',
    })
    expect(create.mock.calls[0][0].data).toMatchObject({
      status: 'partial',
      filesFound: 3,
      filesDeleted: 2,
      failedKeys: ['customer/APP-1/AffordabilityReports/c.pdf'],
      error: 'Could not delete: AccessDenied',
    })
  })

  it('partial when the delete response claims success but a version is still listed', async () => {
    seed(
      'customer/APP-1/statements/a.json',
      'customer/APP-1/statements/b.json',
      'customer/APP-1/AffordabilityReports/c.pdf',
    )
    deleteMock.mockImplementation(async (refs: VersionedKey[]) => {
      // Reports every ref deleted, but b.json survives (with its new marker).
      bucket = bucket.filter((r) => r.key.endsWith('b.json'))
      return { deleted: refs, failed: [] }
    })
    const { payload, create } = makePayload({ conversations: [conv()] })

    const [result] = await executeDeletion(
      payload,
      { scope: 'application', conversationId: 'C-1' },
      'r',
      actor,
    )

    expect(listMock).toHaveBeenCalledTimes(4) // two prefixes, listed then re-listed
    expect(result).toMatchObject({
      status: 'partial',
      fileCount: 3,
      filesDeleted: 2,
      failedCount: 1,
    })
    expect(create.mock.calls[0][0].data).toMatchObject({
      status: 'partial',
      filesFound: 3,
      filesDeleted: 2,
      failedKeys: ['customer/APP-1/statements/b.json'],
    })
    expect(create.mock.calls[0][0].data.deletedKeys).not.toContain(
      'customer/APP-1/statements/b.json',
    )
  })

  it('never reports deleted when the verification listing throws', async () => {
    seed('customer/APP-1/statements/a.json', 'customer/APP-1/statements/b.json')
    let calls = 0
    listMock.mockImplementation(async (prefix: string) => {
      calls += 1
      if (calls > 2) throw new Error('SlowDown')
      return bucket.filter((r) => r.key.startsWith(prefix))
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { payload, create } = makePayload({ conversations: [conv()] })

    const [result] = await executeDeletion(
      payload,
      { scope: 'application', conversationId: 'C-1' },
      'r',
      actor,
    )

    // Unverified: nothing is counted as deleted, and every found key is unconfirmed.
    expect(result).toMatchObject({
      status: 'partial',
      fileCount: 2,
      filesDeleted: 0,
      failedCount: 2,
      error: 'Could not confirm deletion: SlowDown',
    })
    const row = create.mock.calls[0][0].data
    expect(row).toMatchObject({
      status: 'partial',
      filesFound: 2,
      filesDeleted: 0,
      deletedKeys: [],
      error: 'Could not confirm deletion: SlowDown',
    })
    expect([...row.failedKeys].sort()).toEqual([
      'customer/APP-1/statements/a.json',
      'customer/APP-1/statements/b.json',
    ])
    errSpy.mockRestore()
  })

  it('deleted when the re-list is empty, whatever the delete response reported', async () => {
    seed('customer/APP-1/statements/a.json', 'customer/APP-1/statements/b.json')
    deleteMock.mockImplementation(async (refs: VersionedKey[]) => {
      // Every version goes, but the response still lists failures.
      bucket = []
      return { deleted: [], failed: refs.map((r) => ({ ...r, message: 'InternalError' })) }
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { payload, create } = makePayload({ conversations: [conv()] })

    const [result] = await executeDeletion(
      payload,
      { scope: 'application', conversationId: 'C-1' },
      'r',
      actor,
    )

    expect(result).toMatchObject({
      status: 'deleted',
      fileCount: 2,
      filesDeleted: 2,
      failedCount: 0,
    })
    expect(result.error).toBeUndefined()
    const row = create.mock.calls[0][0].data
    expect(row).toMatchObject({ status: 'deleted', filesDeleted: 2, failedKeys: [], error: null })
    expect([...row.deletedKeys].sort()).toEqual([
      'customer/APP-1/statements/a.json',
      'customer/APP-1/statements/b.json',
    ])
    errSpy.mockRestore()
  })

  it('a version written mid-delete counts as remaining', async () => {
    seed('customer/APP-1/statements/a.json', 'customer/APP-1/statements/b.json')
    const late = data('customer/APP-1/statements/late.json', 'v-late')
    deleteMock.mockImplementation(async (refs: VersionedKey[]) => {
      // Everything found goes, and a new file lands before the re-list.
      bucket = [late]
      return { deleted: refs, failed: [] }
    })
    const { payload, create } = makePayload({ conversations: [conv()] })

    const [result] = await executeDeletion(
      payload,
      { scope: 'application', conversationId: 'C-1' },
      'r',
      actor,
    )

    expect(result).toMatchObject({
      status: 'partial',
      fileCount: 2,
      filesDeleted: 2,
      failedCount: 1,
    })
    const row = create.mock.calls[0][0].data
    expect(row).toMatchObject({ status: 'partial', failedKeys: [late.key] })
    expect([...row.deletedKeys].sort()).toEqual([
      'customer/APP-1/statements/a.json',
      'customer/APP-1/statements/b.json',
    ])
  })

  it('failed when nothing found went but a new version also appeared', async () => {
    seed('customer/APP-1/statements/a.json')
    const late = data('customer/APP-1/statements/late.json', 'v-late')
    deleteMock.mockImplementation(async (refs: VersionedKey[]) => {
      bucket.push(late)
      return { deleted: [], failed: refs.map((r) => ({ ...r, message: 'AccessDenied' })) }
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { payload } = makePayload({ conversations: [conv()] })

    const [result] = await executeDeletion(
      payload,
      { scope: 'application', conversationId: 'C-1' },
      'r',
      actor,
    )

    expect(result).toMatchObject({
      status: 'failed',
      fileCount: 1,
      filesDeleted: 0,
      failedCount: 2,
      error: 'Could not delete: AccessDenied',
    })
    errSpy.mockRestore()
  })

  it('a delete call that throws fails only its own application', async () => {
    seed('customer/APP-1/statements/a.json', 'customer/APP-2/statements/b.json')
    deleteMock.mockImplementationOnce(async () => {
      throw new Error('boom')
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { payload, create } = makePayload({
      conversations: [conv(), conv({ conversationId: 'C-2', applicationNumber: 'APP-2' })],
    })

    const results = await executeDeletion(
      payload,
      { scope: 'customer', customerIdString: 'CUS-1' },
      'r',
      actor,
    )

    expect(results.map((r) => r.status)).toEqual(['failed', 'deleted'])
    expect(results[0].error).toBe('Could not delete: boom')
    expect(create.mock.calls[0][0].data).toMatchObject({
      status: 'failed',
      failedKeys: ['customer/APP-1/statements/a.json'],
    })
    errSpy.mockRestore()
  })

  it('failed: 0 deleted and 2 failed', async () => {
    seed('customer/APP-1/statements/a.json', 'customer/APP-1/statements/b.json')
    deleteMock.mockImplementation(async (refs: VersionedKey[]) => ({
      deleted: [],
      failed: refs.map((r) => ({ ...r, message: 'AccessDenied' })),
    }))
    const { payload, create } = makePayload({ conversations: [conv()] })

    const [result] = await executeDeletion(
      payload,
      { scope: 'application', conversationId: 'C-1' },
      'r',
      actor,
    )

    expect(result).toMatchObject({
      status: 'failed',
      fileCount: 2,
      filesDeleted: 0,
      failedCount: 2,
    })
    expect(create.mock.calls[0][0].data).toMatchObject({
      status: 'failed',
      filesFound: 2,
      filesDeleted: 0,
      deletedKeys: [],
    })
    expect([...create.mock.calls[0][0].data.failedKeys].sort()).toEqual([
      'customer/APP-1/statements/a.json',
      'customer/APP-1/statements/b.json',
    ])
  })

  it('nothing_found: 0 refs and no delete call', async () => {
    const { payload, create } = makePayload({ conversations: [conv()] })

    const [result] = await executeDeletion(
      payload,
      { scope: 'application', conversationId: 'C-1' },
      'r',
      actor,
    )

    expect(result).toMatchObject({ status: 'nothing_found', fileCount: 0, filesDeleted: 0 })
    expect(markerMock).not.toHaveBeenCalled()
    expect(deleteMock).not.toHaveBeenCalled()
    expect(create.mock.calls[0][0].data).toMatchObject({
      status: 'nothing_found',
      filesFound: 0,
      filesDeleted: 0,
    })
  })

  it('counts versions, not keys, while the key lists stay distinct', async () => {
    bucket.push(
      data('customer/APP-1/statements/a.json', 'v1'),
      data('customer/APP-1/statements/a.json', 'v2'),
      data('customer/APP-1/statements/a.json', 'null'),
    )
    const { payload, create } = makePayload({ conversations: [conv()] })

    await executeDeletion(payload, { scope: 'application', conversationId: 'C-1' }, 'r', actor)

    expect(create.mock.calls[0][0].data).toMatchObject({
      status: 'deleted',
      filesFound: 3,
      filesDeleted: 3,
      deletedKeys: ['customer/APP-1/statements/a.json'],
    })
    // One marker per key, not per version.
    expect(markerMock).toHaveBeenCalledTimes(1)
    expect(markerMock.mock.calls[0][0]).toEqual(['customer/APP-1/statements/a.json'])
  })

  it('invalid application number fails only that application', async () => {
    seed('customer/APP-2/statements/a.json')
    const { payload, create } = makePayload({
      conversations: [
        conv({ applicationNumber: 'APP/1' }),
        conv({ conversationId: 'C-2', applicationNumber: 'APP-2' }),
      ],
    })

    const results = await executeDeletion(
      payload,
      { scope: 'customer', customerIdString: 'CUS-1' },
      'r',
      actor,
    )

    expect(results[0]).toMatchObject({
      conversationId: 'C-1',
      status: 'failed',
      error: 'Missing or invalid application number',
      fileCount: 0,
      filesDeleted: 0,
    })
    expect(results[1]).toMatchObject({ conversationId: 'C-2', status: 'deleted', filesDeleted: 1 })
    expect(listMock.mock.calls.every((c) => !String(c[0]).includes('APP/1'))).toBe(true)
    expect(listMock.mock.calls.every((c) => String(c[0]).includes('APP-2'))).toBe(true)
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[0][0].data).toMatchObject({
      conversationId: 'C-1',
      applicationNumber: 'APP/1',
      status: 'failed',
      filesFound: 0,
      filesDeleted: 0,
      error: 'Missing or invalid application number',
    })
    expect(create.mock.calls[1][0].data.error).toBeNull()
  })

  it('missing application number fails with no S3 call and still logs', async () => {
    const { payload, create } = makePayload({
      conversations: [conv({ applicationNumber: null })],
    })

    const [result] = await executeDeletion(
      payload,
      { scope: 'application', conversationId: 'C-1' },
      'r',
      actor,
    )

    expect(result).toMatchObject({
      applicationNumber: null,
      status: 'failed',
      error: 'Missing or invalid application number',
    })
    expect(listMock).not.toHaveBeenCalled()
    expect(markerMock).not.toHaveBeenCalled()
    expect(deleteMock).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('a listing that throws fails only its own application', async () => {
    seed('customer/APP-2/statements/a.json')
    listMock.mockImplementation(async (prefix: string) => {
      if (prefix.includes('APP-1/')) throw new Error('Access Denied')
      return bucket.filter((r) => r.key.startsWith(prefix))
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { payload, create } = makePayload({
      conversations: [conv(), conv({ conversationId: 'C-2', applicationNumber: 'APP-2' })],
    })

    const results = await executeDeletion(
      payload,
      { scope: 'customer', customerIdString: 'CUS-1' },
      'r',
      actor,
    )

    expect(results[0]).toMatchObject({ conversationId: 'C-1', status: 'failed' })
    expect(results[0].error).toMatch(/Access Denied/)
    expect(results[1]).toMatchObject({ conversationId: 'C-2', status: 'deleted' })
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[0][0].data).toMatchObject({
      conversationId: 'C-1',
      status: 'failed',
      error: 'Could not list files: Access Denied',
    })
    errSpy.mockRestore()
  })

  it('logs the full outcome before rethrowing when the log row cannot be written', async () => {
    seed('customer/APP-1/statements/a.json', 'customer/APP-2/statements/b.json')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { payload, create } = makePayload({
      conversations: [conv(), conv({ conversationId: 'C-2', applicationNumber: 'APP-2' })],
    })
    create.mockRejectedValueOnce(new Error('db down'))

    const thrown = await executeDeletion(
      payload,
      { scope: 'customer', customerIdString: 'CUS-1' },
      'r',
      actor,
    ).catch((e: unknown) => e)
    expect(thrown).toBeInstanceOf(DeletionLogWriteError)
    expect((thrown as Error).message).toMatch(/db down/)

    const logged = errSpy.mock.calls.find((c) =>
      String(c[0]).includes('could not write the deletion log row'),
    )
    expect(logged?.[1]).toMatchObject({
      conversationId: 'C-1',
      applicationNumber: 'APP-1',
      status: 'deleted',
      filesFound: 1,
      filesDeleted: 1,
      deletedKeys: ['customer/APP-1/statements/a.json'],
      failedKeys: [],
    })
    // Nothing further is deleted once the audit trail cannot be written.
    expect(markerMock).toHaveBeenCalledTimes(1)
    expect(deleteMock).toHaveBeenCalledTimes(1)
    expect(dataIn(bucket).map((r) => r.key)).toEqual(['customer/APP-2/statements/b.json'])
    errSpy.mockRestore()
  })

  describe('delete markers first, so the backup learns of the delete', () => {
    it('places a marker for every key with a data version before any version delete', async () => {
      seed(
        'customer/APP-1/statements/a.json',
        'customer/APP-1/statements/b.json',
        'customer/APP-1/AffordabilityReports/c.pdf',
      )
      bucket.push(data('customer/APP-1/statements/a.json', 'v-old'))
      const { payload } = makePayload({ conversations: [conv()] })

      await executeDeletion(payload, { scope: 'application', conversationId: 'C-1' }, 'r', actor)

      expect([...markerMock.mock.calls.flatMap((c) => c[0])].sort()).toEqual([
        'customer/APP-1/AffordabilityReports/c.pdf',
        'customer/APP-1/statements/a.json',
        'customer/APP-1/statements/b.json',
      ])
      const lastMarkerCall = Math.max(...markerMock.mock.invocationCallOrder)
      const firstDeleteCall = Math.min(...deleteMock.mock.invocationCallOrder)
      expect(deleteMock).toHaveBeenCalled()
      expect(lastMarkerCall).toBeLessThan(firstDeleteCall)
      expect(
        deleteMock.mock.calls
          .flatMap((c) => c[0])
          .map(id)
          .sort(),
      ).toEqual(
        [
          'customer/APP-1/AffordabilityReports/c.pdf\u0000v2',
          'customer/APP-1/statements/a.json\u0000v-old',
          'customer/APP-1/statements/a.json\u0000v0',
          'customer/APP-1/statements/b.json\u0000v1',
        ].sort(),
      )
    })

    it('a key whose marker fails keeps all its versions and ends partial with an error', async () => {
      seed('customer/APP-1/statements/a.json', 'customer/APP-1/AffordabilityReports/c.pdf')
      bucket.push(data('customer/APP-1/AffordabilityReports/c.pdf', 'v-old'))
      markerMock.mockImplementation(async (keys: string[]) => {
        const ok = keys.filter((k) => !k.endsWith('c.pdf'))
        addMarkers(ok)
        return {
          placed: ok,
          failed: keys
            .filter((k) => k.endsWith('c.pdf'))
            .map((key) => ({ key, message: 'AccessDenied' })),
        }
      })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { payload, create } = makePayload({ conversations: [conv()] })

      const [result] = await executeDeletion(
        payload,
        { scope: 'application', conversationId: 'C-1' },
        'r',
        actor,
      )

      const sent = deleteMock.mock.calls.flatMap((c) => c[0])
      expect(sent.map((r) => r.key)).toEqual(['customer/APP-1/statements/a.json'])
      expect(dataIn(bucket).filter((r) => r.key.endsWith('c.pdf'))).toHaveLength(2)
      expect(result).toMatchObject({
        status: 'partial',
        fileCount: 3,
        filesDeleted: 1,
        failedCount: 2,
        error: 'Could not place delete marker: AccessDenied',
      })
      expect(create.mock.calls[0][0].data).toMatchObject({
        status: 'partial',
        filesFound: 3,
        filesDeleted: 1,
        deletedKeys: ['customer/APP-1/statements/a.json'],
        failedKeys: ['customer/APP-1/AffordabilityReports/c.pdf'],
        error: 'Could not place delete marker: AccessDenied',
      })
      errSpy.mockRestore()
    })

    it('a key the marker response does not report is not deleted', async () => {
      seed('customer/APP-1/statements/a.json', 'customer/APP-1/statements/b.json')
      markerMock.mockImplementation(async (keys: string[]) => addMarkers(keys.slice(0, 1)))
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { payload } = makePayload({ conversations: [conv()] })

      const [result] = await executeDeletion(
        payload,
        { scope: 'application', conversationId: 'C-1' },
        'r',
        actor,
      )

      expect(deleteMock.mock.calls.flatMap((c) => c[0]).map((r) => r.key)).toEqual([
        'customer/APP-1/statements/a.json',
      ])
      expect(result).toMatchObject({ status: 'partial', filesDeleted: 1, failedCount: 1 })
      expect(result.error).toMatch(/^Could not place delete marker/)
      errSpy.mockRestore()
    })

    it('when every marker fails, no version is deleted and the status is failed', async () => {
      seed('customer/APP-1/statements/a.json', 'customer/APP-1/statements/b.json')
      markerMock.mockImplementation(async (keys: string[]) => ({
        placed: [],
        failed: keys.map((key) => ({ key, message: 'AccessDenied' })),
      }))
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { payload, create } = makePayload({ conversations: [conv()] })

      const [result] = await executeDeletion(
        payload,
        { scope: 'application', conversationId: 'C-1' },
        'r',
        actor,
      )

      expect(deleteMock).not.toHaveBeenCalled()
      expect(result).toMatchObject({
        status: 'failed',
        fileCount: 2,
        filesDeleted: 0,
        failedCount: 2,
        error: 'Could not place delete marker: AccessDenied',
      })
      expect(create.mock.calls[0][0].data.deletedKeys).toEqual([])
      errSpy.mockRestore()
    })

    it('a marker call that throws deletes nothing and fails only its own application', async () => {
      seed('customer/APP-1/statements/a.json', 'customer/APP-2/statements/b.json')
      markerMock.mockImplementationOnce(async () => {
        throw new Error('boom')
      })
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { payload } = makePayload({
        conversations: [conv(), conv({ conversationId: 'C-2', applicationNumber: 'APP-2' })],
      })

      const results = await executeDeletion(
        payload,
        { scope: 'customer', customerIdString: 'CUS-1' },
        'r',
        actor,
      )

      expect(results.map((r) => r.status)).toEqual(['failed', 'deleted'])
      expect(results[0].error).toBe('Could not place delete marker: boom')
      expect(deleteMock).toHaveBeenCalledTimes(1)
      expect(deleteMock.mock.calls[0][0].map((r) => r.key)).toEqual([
        'customer/APP-2/statements/b.json',
      ])
      errSpy.mockRestore()
    })

    it('never sends an old delete marker to the version delete, nor counts it', async () => {
      seed('customer/APP-1/statements/a.json')
      bucket.push(
        marker('customer/APP-1/statements/a.json', 'old-1'),
        marker('customer/APP-1/statements/gone.json', 'old-2'),
      )
      const oldMarkers = markerIds()
      const { payload, create } = makePayload({ conversations: [conv()] })

      const [result] = await executeDeletion(
        payload,
        { scope: 'application', conversationId: 'C-1' },
        'r',
        actor,
      )

      const sent = deleteMock.mock.calls.flatMap((c) => c[0])
      expect(sent.map(id)).toEqual(['customer/APP-1/statements/a.json\u0000v0'])
      expect(sent.some((r) => oldMarkers.has(id(r)))).toBe(false)
      // A key with only markers has nothing to delete, so it gets no new marker.
      expect(markerMock.mock.calls[0][0]).toEqual(['customer/APP-1/statements/a.json'])
      expect(result).toMatchObject({ status: 'deleted', fileCount: 1, filesDeleted: 1 })
      expect(create.mock.calls[0][0].data).toMatchObject({
        filesFound: 1,
        filesDeleted: 1,
        deletedKeys: ['customer/APP-1/statements/a.json'],
        failedKeys: [],
      })
      // The old markers are still there, untouched.
      for (const m of oldMarkers) expect(markerIds().has(m)).toBe(true)
    })

    it('a key with only delete markers counts as nothing found', async () => {
      bucket.push(
        marker('customer/APP-1/statements/a.json', 'old-1'),
        marker('customer/APP-1/AffordabilityReports/r.pdf', 'old-2'),
      )
      const { payload, create } = makePayload({ conversations: [conv()] })

      const [result] = await executeDeletion(
        payload,
        { scope: 'application', conversationId: 'C-1' },
        'r',
        actor,
      )

      expect(result).toMatchObject({ status: 'nothing_found', fileCount: 0, filesDeleted: 0 })
      expect(markerMock).not.toHaveBeenCalled()
      expect(deleteMock).not.toHaveBeenCalled()
      expect(create.mock.calls[0][0].data).toMatchObject({
        status: 'nothing_found',
        filesFound: 0,
        deletedKeys: [],
        failedKeys: [],
      })
    })

    it('the re-list ignores the new markers, so a clean delete reads as deleted', async () => {
      seed('customer/APP-1/statements/a.json', 'customer/APP-1/AffordabilityReports/r.pdf')
      const { payload } = makePayload({ conversations: [conv()] })

      const [result] = await executeDeletion(
        payload,
        { scope: 'application', conversationId: 'C-1' },
        'r',
        actor,
      )

      // The bucket keeps one new marker per key, and no data versions.
      expect(dataIn(bucket)).toEqual([])
      expect(bucket.map((r) => r.key).sort()).toEqual([
        'customer/APP-1/AffordabilityReports/r.pdf',
        'customer/APP-1/statements/a.json',
      ])
      expect(result).toMatchObject({
        status: 'deleted',
        fileCount: 2,
        filesDeleted: 2,
        failedCount: 0,
      })
      expect(result.error).toBeUndefined()
    })
  })
})

describe('warnings', () => {
  const previewOne = async (c: Row, loanAccounts: Row[] = []) => {
    const { payload } = makePayload({ conversations: [c], loanAccounts })
    const [p] = await previewDeletion(payload, { scope: 'application', conversationId: 'C-1' })
    return p.warnings
  }

  it("status 'active' is in progress", async () => {
    expect(await previewOne(conv({ status: 'active' }))).toEqual(['in_progress'])
  })

  it("status 'paused' is in progress", async () => {
    expect(await previewOne(conv({ status: 'paused' }))).toEqual(['in_progress'])
  })

  it('consent complete with checks pending is in progress', async () => {
    expect(
      await previewOne(
        conv({ statementCapture: { consentStatus: 'complete', checksComplete: false } }),
      ),
    ).toEqual(['in_progress'])
  })

  it('consent complete with checks complete is not in progress', async () => {
    expect(
      await previewOne(
        conv({ statementCapture: { consentStatus: 'complete', checksComplete: true } }),
      ),
    ).toEqual([])
  })

  it('a loan account for the application is a funded loan', async () => {
    const { payload, find } = makePayload({
      conversations: [conv()],
      loanAccounts: [{ applicationNumber: 'APP-1' }],
    })
    const [p] = await previewDeletion(payload, { scope: 'application', conversationId: 'C-1' })
    expect(p.warnings).toEqual(['funded_loan'])
    const loanCall = find.mock.calls.find((c) => c[0].collection === 'loan-accounts')![0]
    expect(loanCall).toMatchObject({
      where: { applicationNumber: { equals: 'APP-1' } },
      limit: 1,
      overrideAccess: true,
    })
  })

  it('a declined conversation with no loan has no warnings', async () => {
    expect(await previewOne(conv({ status: 'declined' }))).toEqual([])
  })

  it('warnings are logged on the deletion row', async () => {
    const { payload, create } = makePayload({
      conversations: [conv({ status: 'active' })],
      loanAccounts: [{ applicationNumber: 'APP-1' }],
    })
    await executeDeletion(payload, { scope: 'application', conversationId: 'C-1' }, 'r', actor)
    expect(create.mock.calls[0][0].data.warnings).toEqual(['in_progress', 'funded_loan'])
  })
})

describe('previewDeletion', () => {
  it('counts versions within the prefixes and never deletes', async () => {
    seed('customer/APP-1/statements/a.json', 'customer/APP-1/AffordabilityReports/r.pdf')
    bucket.push(data('customer/APP-1/statements/a.json', 'v9'))
    const { payload, create } = makePayload({ conversations: [conv()] })

    const previews = await previewDeletion(payload, {
      scope: 'application',
      conversationId: 'C-1',
    })

    expect(previews).toEqual([
      { conversationId: 'C-1', applicationNumber: 'APP-1', fileCount: 3, warnings: [] },
    ])
    expect(markerMock).not.toHaveBeenCalled()
    expect(deleteMock).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('does not count delete markers as files', async () => {
    seed('customer/APP-1/statements/a.json')
    bucket.push(
      marker('customer/APP-1/statements/a.json', 'old-1'),
      marker('customer/APP-1/statements/gone.json', 'old-2'),
    )
    const { payload } = makePayload({ conversations: [conv()] })

    const [p] = await previewDeletion(payload, { scope: 'application', conversationId: 'C-1' })

    expect(p.fileCount).toBe(1)
  })

  it('reports an invalid application number without listing', async () => {
    const { payload } = makePayload({ conversations: [conv({ applicationNumber: '../x' })] })
    const [p] = await previewDeletion(payload, { scope: 'application', conversationId: 'C-1' })
    expect(p).toMatchObject({ fileCount: 0, error: 'Missing or invalid application number' })
    expect(listMock).not.toHaveBeenCalled()
  })
})

describe('latestDeletion', () => {
  it('ignores nothing_found and failed rows', async () => {
    const { payload, find } = makePayload({
      deletions: [
        {
          conversationId: 'C-1',
          status: 'partial',
          occurredAt: '2026-11-01T00:00:00.000Z',
          actorName: 'Old',
          actorEmail: 'old@billie.loans',
          filesDeleted: 2,
          reason: 'first',
        },
        {
          conversationId: 'C-1',
          status: 'deleted',
          occurredAt: '2026-11-05T00:00:00.000Z',
          actorName: null,
          actorEmail: 'sup@billie.loans',
          filesDeleted: 4,
          reason: 'second',
        },
        { conversationId: 'C-1', status: 'nothing_found', occurredAt: '2026-11-08T00:00:00.000Z' },
        { conversationId: 'C-1', status: 'failed', occurredAt: '2026-11-09T00:00:00.000Z' },
      ],
    })

    const latest = await latestDeletion(payload, 'C-1')

    expect(latest).toEqual({
      occurredAt: '2026-11-05T00:00:00.000Z',
      actorName: null,
      actorEmail: 'sup@billie.loans',
      filesDeleted: 4,
      reason: 'second',
      status: 'deleted',
    })
    const args = find.mock.calls[0][0]
    expect(args).toMatchObject({
      collection: 'statement-file-deletions',
      where: {
        conversationId: { equals: 'C-1' },
        status: { in: ['deleted', 'partial'] },
        filesDeleted: { greater_than: 0 },
      },
      sort: ['-occurredAt'],
      limit: 1,
      overrideAccess: true,
    })
  })

  it('ignores an unverified partial row that removed nothing, falling back to an older one', async () => {
    const { payload } = makePayload({
      deletions: [
        {
          conversationId: 'C-1',
          status: 'deleted',
          occurredAt: '2026-11-05T00:00:00.000Z',
          actorName: 'Sue',
          actorEmail: 'sup@billie.loans',
          filesDeleted: 4,
          reason: 'earlier',
        },
        {
          conversationId: 'C-1',
          status: 'partial',
          occurredAt: '2026-11-10T00:00:00.000Z',
          actorName: 'Sue',
          actorEmail: 'sup@billie.loans',
          filesDeleted: 0,
          reason: 'unverified',
          error: 'Could not confirm deletion: SlowDown',
        },
      ],
    })

    expect(await latestDeletion(payload, 'C-1')).toMatchObject({
      status: 'deleted',
      filesDeleted: 4,
      reason: 'earlier',
    })
  })

  it('returns null when the only partial row removed nothing', async () => {
    const { payload } = makePayload({
      deletions: [
        {
          conversationId: 'C-1',
          status: 'partial',
          occurredAt: '2026-11-10T00:00:00.000Z',
          filesDeleted: 0,
          reason: 'unverified',
        },
      ],
    })
    expect(await latestDeletion(payload, 'C-1')).toBeNull()
  })

  it('returns null when there is no qualifying row', async () => {
    const { payload } = makePayload({
      deletions: [{ conversationId: 'C-1', status: 'failed', occurredAt: '2026-11-09' }],
    })
    expect(await latestDeletion(payload, 'C-1')).toBeNull()
  })
})
