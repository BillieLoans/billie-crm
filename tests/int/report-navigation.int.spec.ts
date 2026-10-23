/**
 * Integration coverage for the Reports navigation data: pinned reports per
 * user (report-preferences) and the usage events (report-events), written
 * through the Local API as the routes do, and closed to everyone else.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readPins, writePins } from '@/server/reporting/preferences'

let payload: Payload
const users: Array<{ id: string; role: string }> = []

async function user(role: string) {
  const u = await payload.create({
    collection: 'users',
    data: {
      email: `test-nav-${role}-${Date.now()}-${users.length}@billie.loans`,
      password: 'Test1234!',
      role: role as 'operations',
      firstName: 'Test',
      lastName: role,
    },
  })
  const made = { id: String(u.id), role }
  users.push(made)
  return made
}

beforeAll(async () => {
  payload = await getPayload({ config })
}, 60_000)

afterAll(async () => {
  const ids = users.map((u) => u.id)
  await payload.delete({
    collection: 'report-preferences',
    where: { user: { in: ids } },
    overrideAccess: true,
  })
  await payload.delete({ collection: 'users', where: { id: { in: ids } }, overrideAccess: true })
})

describe('pinned reports', () => {
  it('keeps one list per person, replaced whole on each save', async () => {
    const a = await user('operations')
    const b = await user('readonly')
    expect(await readPins(payload, a.id)).toEqual([])
    await writePins(payload, a.id, ['decline-rate', 'gtm-numbers'])
    await writePins(payload, a.id, ['gtm-numbers'])
    await writePins(payload, b.id, ['loans-funded'])
    expect(await readPins(payload, a.id)).toEqual(['gtm-numbers'])
    expect(await readPins(payload, b.id)).toEqual(['loans-funded'])
    const rows = await payload.find({
      collection: 'report-preferences',
      where: { user: { equals: a.id } },
      overrideAccess: true,
    })
    expect(rows.totalDocs).toBe(1)
  })

  it('survives two first saves at once', async () => {
    const c = await user('operations')
    await Promise.all([
      writePins(payload, c.id, ['decline-rate']),
      writePins(payload, c.id, ['gtm-numbers']),
    ])
    expect((await readPins(payload, c.id)).length).toBe(1)
  })

  it('lets a person with pins be deleted', async () => {
    const d = await user('readonly')
    await writePins(payload, d.id, ['decline-rate'])
    await payload.delete({ collection: 'users', id: d.id, overrideAccess: true })
    users.splice(users.indexOf(d), 1)
  })

  it('cannot be read or written by staff through the API', async () => {
    const supervisor = await user('supervisor')
    await expect(
      payload.find({ collection: 'report-preferences', overrideAccess: false, user: supervisor }),
    ).rejects.toThrow()
    await expect(
      payload.create({
        collection: 'report-preferences',
        data: { user: supervisor.id, pinned: [] },
        overrideAccess: false,
        user: supervisor,
      }),
    ).rejects.toThrow()
  })
})

describe('report events', () => {
  it('are append-only: written by the server, read by admins only', async () => {
    const ops = await user('operations')
    const event = await payload.create({
      collection: 'report-events',
      data: { kind: 'search', query: 'churn', user: ops.id },
      overrideAccess: true,
    })
    await expect(
      payload.update({
        collection: 'report-events',
        id: event.id,
        data: { query: 'x' },
        overrideAccess: false,
        user: { ...ops, role: 'admin' },
      }),
    ).rejects.toThrow()
    await expect(
      payload.find({ collection: 'report-events', overrideAccess: false, user: ops }),
    ).rejects.toThrow()
    await payload.delete({ collection: 'report-events', id: event.id, overrideAccess: true })
  })
})
