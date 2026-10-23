/**
 * Integration coverage for report boards against the real Postgres: only
 * authors make and change boards; a tile keeps a report's settings but not
 * its period; staff see only the tiles for reports they can run, and a
 * board with none is not found for them.
 */
import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import type { Pool } from 'pg'
import { getDashboardPool } from '@/lib/dashboard-aggregates'
import { MAX_BOARD_TILES } from '@/lib/reports/boards'
import {
  BoardError,
  addTile,
  createBoard,
  deleteBoard,
  getBoard,
  listBoards,
  updateBoard,
} from '@/server/reporting/boards'

let payload: Payload
let pool: Pool
const PREFIX = 'rptbrd'
const users: Record<string, { id: string; role: string }> = {}

async function makeUser(role: string) {
  const user = await payload.create({
    collection: 'users',
    data: {
      email: `${PREFIX}-${role}-${Date.now()}@billie.loans`,
      password: 'Test1234!',
      role: role as 'admin',
      firstName: 'Board',
      lastName: role,
    },
  })
  return { id: String(user.id), role }
}

async function removeBoards() {
  await pool.query(`DELETE FROM report_boards WHERE slug LIKE '${PREFIX}%'`)
}

async function cleanup() {
  await removeBoards()
  const defs = await payload.find({
    collection: 'report-definitions',
    where: { slug: { like: PREFIX } },
    limit: 100,
    overrideAccess: true,
  })
  for (const doc of defs.docs) {
    await payload.delete({ collection: 'report-definitions', id: doc.id, overrideAccess: true })
  }
  await pool.query(`DELETE FROM users WHERE email LIKE '${PREFIX}-%'`)
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return (error as BoardError).code
  }
  throw new Error('expected a refusal')
}

function report(slug: string, roles: string[], parameters: unknown[] = []) {
  return payload.create({
    collection: 'report-definitions',
    data: {
      title: slug,
      slug,
      sql: parameters.length
        ? 'SELECT $1::date AS d, $2::date AS e, $3::text AS s'
        : 'SELECT 1 AS n',
      parameters,
      roles,
      _status: 'published',
    } as never,
    overrideAccess: true,
  })
}

beforeAll(async () => {
  payload = await getPayload({ config })
  pool = getDashboardPool(payload) as unknown as Pool
  await cleanup()
  for (const role of ['supervisor', 'operations', 'readonly']) users[role] = await makeUser(role)
  await report(
    `${PREFIX}-ops`,
    ['operations'],
    [
      { name: 'from', label: 'From', type: 'date', required: true, default: 'today-7' },
      { name: 'to', label: 'To', type: 'date', required: true, default: 'today-1' },
      { name: 'source', label: 'Source', type: 'text', required: false },
    ],
  )
  await report(`${PREFIX}-everyone`, ['operations', 'readonly'])
}, 60_000)

afterAll(async () => {
  await cleanup()
})

beforeEach(async () => {
  await removeBoards()
})

describe('report boards', () => {
  it('are made and changed by report authors only, each with its own link', async () => {
    expect(
      await errorCode(createBoard(payload, users.operations, { title: `${PREFIX} review` })),
    ).toBe('FORBIDDEN')
    const one = await createBoard(payload, users.supervisor, { title: `${PREFIX} review` })
    const two = await createBoard(payload, users.supervisor, { title: `${PREFIX} review` })
    expect(one.slug).toBe(`${PREFIX}-review`)
    expect(two.slug).toBe(`${PREFIX}-review-2`)
    const stored = await payload.find({
      collection: 'report-boards',
      where: { slug: { equals: one.slug } },
      depth: 0,
      overrideAccess: true,
    })
    expect(String(stored.docs[0].author)).toBe(users.supervisor.id)
    expect(
      await errorCode(
        addTile(payload, users.operations, one.slug, { report: `${PREFIX}-ops`, parameters: {} }),
      ),
    ).toBe('FORBIDDEN')
    expect(await errorCode(deleteBoard(payload, users.readonly, one.slug))).toBe('FORBIDDEN')
  })

  it('keep a report’s settings on a tile, but not its period', async () => {
    const board = await createBoard(payload, users.supervisor, { title: `${PREFIX} settings` })
    const view = await addTile(payload, users.supervisor, board.slug, {
      report: `${PREFIX}-ops`,
      parameters: { from: '2026-01-01', to: '2026-01-31', source: 'paid', junk: 'x' },
    })
    expect(view.tiles).toHaveLength(1)
    expect(view.tiles[0]).toMatchObject({
      show: 'both',
      parameters: { source: 'paid' },
      report: { slug: `${PREFIX}-ops`, title: `${PREFIX}-ops` },
    })
    expect(
      await errorCode(
        addTile(payload, users.supervisor, board.slug, {
          report: `${PREFIX}-nope`,
          parameters: {},
        }),
      ),
    ).toBe('NO_REPORT')
  })

  it(`hold up to ${MAX_BOARD_TILES} reports`, async () => {
    const board = await createBoard(payload, users.supervisor, { title: `${PREFIX} full` })
    for (let i = 0; i < MAX_BOARD_TILES; i++) {
      await addTile(payload, users.supervisor, board.slug, {
        report: `${PREFIX}-everyone`,
        parameters: {},
      })
    }
    expect(
      await errorCode(
        addTile(payload, users.supervisor, board.slug, {
          report: `${PREFIX}-everyone`,
          parameters: {},
        }),
      ),
    ).toBe('TOO_MANY_TILES')
  })

  it('show staff only the tiles they can run', async () => {
    const board = await createBoard(payload, users.supervisor, { title: `${PREFIX} mixed` })
    await addTile(payload, users.supervisor, board.slug, {
      report: `${PREFIX}-ops`,
      parameters: {},
    })
    await addTile(payload, users.supervisor, board.slug, {
      report: `${PREFIX}-everyone`,
      parameters: {},
    })
    const ops = await getBoard(payload, users.operations, board.slug)
    expect(ops.tiles.map((t) => t.report.slug)).toEqual([`${PREFIX}-ops`, `${PREFIX}-everyone`])
    expect(ops.canEdit).toBe(false)
    const readonly = await getBoard(payload, users.readonly, board.slug)
    expect(readonly.tiles.map((t) => t.report.slug)).toEqual([`${PREFIX}-everyone`])
    expect(readonly.hiddenTiles).toBe(1)
    expect(
      (await listBoards(payload, users.readonly)).find((b) => b.slug === board.slug)?.tiles,
    ).toBe(1)

    // A board with nothing this person can run is not found, and not listed.
    const opsOnly = await createBoard(payload, users.supervisor, { title: `${PREFIX} ops only` })
    await addTile(payload, users.supervisor, opsOnly.slug, {
      report: `${PREFIX}-ops`,
      parameters: {},
    })
    expect(await errorCode(getBoard(payload, users.readonly, opsOnly.slug))).toBe('NOT_FOUND')
    expect((await listBoards(payload, users.readonly)).map((b) => b.slug)).not.toContain(
      opsOnly.slug,
    )
    // Authors see empty boards, to fill them.
    const empty = await createBoard(payload, users.supervisor, { title: `${PREFIX} empty` })
    expect((await listBoards(payload, users.supervisor)).map((b) => b.slug)).toContain(empty.slug)
  })

  it('are renamed, reordered and trimmed with the whole tile list', async () => {
    const board = await createBoard(payload, users.supervisor, { title: `${PREFIX} order` })
    await addTile(payload, users.supervisor, board.slug, {
      report: `${PREFIX}-ops`,
      parameters: {},
    })
    const view = await addTile(payload, users.supervisor, board.slug, {
      report: `${PREFIX}-everyone`,
      parameters: {},
    })
    const [a, b] = view.tiles.map((t) => ({
      id: t.id,
      report: t.report.slug,
      parameters: t.parameters,
      show: t.show,
    }))
    const changed = await updateBoard(payload, users.supervisor, board.slug, {
      title: 'Renamed',
      tiles: [{ ...b, show: 'headline' }, a],
    })
    expect(changed.title).toBe('Renamed')
    expect(changed.tiles.map((t) => [t.report.slug, t.show])).toEqual([
      [`${PREFIX}-everyone`, 'headline'],
      [`${PREFIX}-ops`, 'both'],
    ])
    const trimmed = await updateBoard(payload, users.supervisor, board.slug, { tiles: [a] })
    expect(trimmed.tiles).toHaveLength(1)
    // A new tile must name a published report.
    expect(
      await errorCode(
        updateBoard(payload, users.supervisor, board.slug, {
          tiles: [a, { id: 'new', report: `${PREFIX}-nope`, parameters: {}, show: 'both' }],
        }),
      ),
    ).toBe('NO_REPORT')
    await deleteBoard(payload, users.supervisor, board.slug)
    expect(await errorCode(getBoard(payload, users.supervisor, board.slug))).toBe('NOT_FOUND')
  })

  it('refuse a change made on an old copy, and keep both of two quick adds', async () => {
    const board = await createBoard(payload, users.supervisor, { title: `${PREFIX} race` })
    const opened = await getBoard(payload, users.supervisor, board.slug)
    // Someone adds a report after the editor opened.
    await addTile(payload, users.supervisor, board.slug, {
      report: `${PREFIX}-ops`,
      parameters: {},
    })
    expect(
      await errorCode(
        updateBoard(payload, users.supervisor, board.slug, {
          tiles: [],
          version: opened.version,
        }),
      ),
    ).toBe('BOARD_CHANGED')
    expect((await getBoard(payload, users.supervisor, board.slug)).tiles).toHaveLength(1)
    await Promise.all([
      addTile(payload, users.supervisor, board.slug, {
        report: `${PREFIX}-everyone`,
        parameters: {},
      }),
      addTile(payload, users.supervisor, board.slug, {
        report: `${PREFIX}-everyone`,
        parameters: {},
      }),
    ])
    expect((await getBoard(payload, users.supervisor, board.slug)).tiles).toHaveLength(3)
  })

  it('refuse a setting too long to keep, and show the readable tiles beside a bad one', async () => {
    const board = await createBoard(payload, users.supervisor, { title: `${PREFIX} odd` })
    expect(
      await errorCode(
        addTile(payload, users.supervisor, board.slug, {
          report: `${PREFIX}-ops`,
          parameters: { source: 'x'.repeat(201) },
        }),
      ),
    ).toBe('SETTING_TOO_LONG')
    await addTile(payload, users.supervisor, board.slug, {
      report: `${PREFIX}-ops`,
      parameters: {},
    })
    await pool.query(
      `UPDATE report_boards SET tiles = tiles || '[{"id": "bad", "report": 7}]'::jsonb WHERE slug = $1`,
      [board.slug],
    )
    const view = await getBoard(payload, users.supervisor, board.slug)
    expect(view.tiles).toHaveLength(1)
    expect(view.hiddenTiles).toBe(1)
  })

  it('are not readable through the raw collection by staff who are not authors', async () => {
    const board = await createBoard(payload, users.supervisor, { title: `${PREFIX} raw` })
    const readonly = await payload.findByID({ collection: 'users', id: users.readonly.id })
    await expect(
      payload.find({
        collection: 'report-boards',
        where: { slug: { equals: board.slug } },
        overrideAccess: false,
        user: readonly,
      }),
    ).rejects.toThrow()
  })
})
