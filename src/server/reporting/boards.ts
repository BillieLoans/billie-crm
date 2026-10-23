/**
 * Report boards: list, open, make and change them. Anyone on staff can open
 * a board and sees only the tiles for reports they can run; report authors
 * make and change boards. Tiles are run by the browser through the usual
 * report route, so every run is checked and logged as usual.
 *
 * A change is written only if the board is still the version it was read
 * at, so an editor open on an old copy cannot silently undo someone else's
 * change: it is told to reload instead.
 */
import { randomUUID } from 'node:crypto'
import type { Payload } from 'payload'
import { NotFound, ValidationError } from 'payload'
import {
  MAX_BOARD_TILES,
  boardSlug,
  boardTileSchema,
  type BoardTile,
  type BoardTileShow,
  type BoardUpdate,
} from '@/lib/reports/boards'
import { dateRangeParameters } from '@/lib/reports/periods'
import { requirePgPool } from '@/lib/dashboard-aggregates'
import { errorResponse } from './route-auth'
import { isReportAuthor, listPublishedReports, type ReportSummary } from './run-report'

export class BoardError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'BoardError'
  }
}

/** The API response for a failed board request. */
export function boardFailure(error: unknown) {
  if (error instanceof BoardError) return errorResponse(error.status, error.code, error.message)
  // The collection's own validation refused the change.
  if (error instanceof ValidationError) {
    const field = (error.data as { errors?: Array<{ message?: string }> } | undefined)?.errors?.[0]
    return errorResponse(400, 'INVALID', field?.message ?? 'The board was not saved.')
  }
  console.error('[reports] board request failed:', error)
  return errorResponse(500, 'BOARD_FAILED', 'That did not work. Try again.')
}

export interface BoardSummary {
  slug: string
  title: string
  description: string | null
  /** Tiles this person can see. */
  tiles: number
}

export interface BoardTileView {
  id: string
  show: BoardTileShow
  parameters: Record<string, string | number | boolean>
  report: ReportSummary
}

export interface BoardView {
  id: string
  slug: string
  title: string
  description: string | null
  tiles: BoardTileView[]
  /** Tiles for reports this person cannot run, no longer published, or unreadable. */
  hiddenTiles: number
  canEdit: boolean
  /** Send back with a change: the change is refused if the board moved on since. */
  version: string
}

interface BoardDoc {
  id: string
  slug: string
  title: string
  description?: string | null
  tiles?: unknown
  updatedAt: string
}

const MAX_SETTING_LENGTH = 200
/** Attempts at adding a tile while other changes land at the same moment. */
const ADD_ATTEMPTS = 3

const notFound = () => new BoardError(404, 'NOT_FOUND', 'There is no board at this link.')

/** The readable tiles, one by one: one bad tile does not hide the others. */
function storedTiles(doc: BoardDoc): { tiles: BoardTile[]; unreadable: number } {
  const raw = Array.isArray(doc.tiles) ? doc.tiles : []
  const tiles: BoardTile[] = []
  for (const item of raw) {
    const parsed = boardTileSchema.safeParse(item)
    if (parsed.success) tiles.push(parsed.data)
  }
  return { tiles, unreadable: raw.length - tiles.length }
}

async function publishedFor(payload: Payload, user: unknown): Promise<Map<string, ReportSummary>> {
  return new Map((await listPublishedReports(payload, user)).map((r) => [r.slug, r]))
}

async function findBoard(payload: Payload, slug: string): Promise<BoardDoc | null> {
  const found = await payload.find({
    collection: 'report-boards',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return (found.docs[0] as unknown as BoardDoc | undefined) ?? null
}

function requireAuthor(user: unknown) {
  if (!isReportAuthor(user)) {
    throw new BoardError(403, 'FORBIDDEN', 'Only report authors can change boards.')
  }
}

/** The board as this person sees it. */
function viewOf(doc: BoardDoc, reports: Map<string, ReportSummary>, user: unknown): BoardView {
  const { tiles, unreadable } = storedTiles(doc)
  const visible = tiles.flatMap((t): BoardTileView[] => {
    const report = reports.get(t.report)
    return report ? [{ id: t.id, show: t.show, parameters: t.parameters, report }] : []
  })
  if (visible.length === 0 && !isReportAuthor(user)) throw notFound()
  return {
    id: String(doc.id),
    slug: doc.slug,
    title: doc.title,
    description: doc.description ?? null,
    tiles: visible,
    hiddenTiles: tiles.length - visible.length + unreadable,
    canEdit: isReportAuthor(user),
    version: doc.updatedAt,
  }
}

/** Tries at a board's write lock before answering that the board is busy. */
const LOCK_ATTEMPTS = 20
const LOCK_WAIT_MS = 50

/**
 * Write a change only if the board is still at the version read. Writers of
 * a board take a per-board advisory lock, check the version and write
 * through Payload (so the collection's validation and hooks apply): two
 * changes at the same moment cannot both win.
 *
 * The lock is tried, not waited for: a writer waiting would hold a pooled
 * connection while the lock holder needs others for its own reads and
 * write, and enough of them could exhaust the pool.
 *
 * @returns the board as written, or null when it changed in between.
 */
async function writeIfUnchanged(
  payload: Payload,
  doc: BoardDoc,
  data: { title?: string; description?: string | null; tiles?: BoardTile[] },
): Promise<BoardDoc | null> {
  const pool = requirePgPool(payload)
  const key = `report-board:${doc.id}`
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    const lock = await pool.connect()
    let held = false
    try {
      const { rows } = await lock.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [key])
      held = rows[0]?.ok === true
      if (held) {
        let current: BoardDoc | null
        try {
          current = (await payload.findByID({
            collection: 'report-boards',
            id: doc.id,
            depth: 0,
            overrideAccess: true,
          })) as unknown as BoardDoc
        } catch (error) {
          if (error instanceof NotFound) return null
          throw error
        }
        if (current.updatedAt !== doc.updatedAt) return null
        return (await payload.update({
          collection: 'report-boards',
          id: doc.id,
          data: data as never,
          depth: 0,
          overrideAccess: true,
        })) as unknown as BoardDoc
      }
    } finally {
      if (held) {
        // A session lock left on a pooled connection would block the board
        // for good: if the unlock fails, close the connection instead.
        const unlocked = await lock
          .query('SELECT pg_advisory_unlock(hashtext($1))', [key])
          .then(() => true)
          .catch(() => false)
        lock.release(unlocked ? undefined : true)
      } else {
        lock.release()
      }
    }
    await new Promise((r) => setTimeout(r, LOCK_WAIT_MS * (attempt + 1)))
  }
  throw new BoardError(409, 'BOARD_BUSY', 'The board is being changed. Try again in a moment.')
}

/**
 * A tile's saved settings: the report's declared parameters, not its period
 * (the board's period applies to every tile).
 */
export function tileParameters(
  report: ReportSummary,
  parameters: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const range = dateRangeParameters(report.parameters)
  const skip = new Set(range ? [range.from.name, range.to.name] : [])
  const out: Record<string, string | number | boolean> = {}
  for (const p of report.parameters) {
    const v = parameters[p.name]
    if (skip.has(p.name) || v === undefined || v === null || v === '') continue
    if (typeof v === 'string' && v.length > MAX_SETTING_LENGTH) {
      throw new BoardError(
        400,
        'SETTING_TOO_LONG',
        `"${p.label}" is too long to keep on a board (${MAX_SETTING_LENGTH} characters at most).`,
      )
    }
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[p.name] = v
  }
  return out
}

export async function listBoards(payload: Payload, user: unknown): Promise<BoardSummary[]> {
  const [found, reports] = await Promise.all([
    payload.find({
      collection: 'report-boards',
      sort: 'title',
      limit: 200,
      depth: 0,
      overrideAccess: true,
    }),
    publishedFor(payload, user),
  ])
  const author = isReportAuthor(user)
  return (found.docs as unknown as BoardDoc[])
    .map((doc) => ({
      slug: doc.slug,
      title: doc.title,
      description: doc.description ?? null,
      tiles: storedTiles(doc).tiles.filter((t) => reports.has(t.report)).length,
    }))
    .filter((b) => author || b.tiles > 0)
}

export async function getBoard(payload: Payload, user: unknown, slug: string): Promise<BoardView> {
  const [doc, reports] = await Promise.all([findBoard(payload, slug), publishedFor(payload, user)])
  if (!doc) throw notFound()
  return viewOf(doc, reports, user)
}

export async function createBoard(
  payload: Payload,
  user: { id: string | number },
  input: { title: string; description?: string },
): Promise<BoardSummary> {
  requireAuthor(user)
  const title = input.title.trim()
  if (!title) throw new BoardError(400, 'NO_TITLE', 'Give the board a title.')
  const base = boardSlug(title)
  for (let n = 1; n <= 20; n++) {
    const slug = n === 1 ? base : `${base}-${n}`
    if (await findBoard(payload, slug)) continue
    try {
      const doc = (await payload.create({
        collection: 'report-boards',
        data: { title, slug, description: input.description?.trim() || null, tiles: [] } as never,
        user,
        overrideAccess: true,
      })) as unknown as BoardDoc
      return { slug: doc.slug, title: doc.title, description: doc.description ?? null, tiles: 0 }
    } catch (error) {
      // Taken between the check and the save: try the next link. Anything
      // else is a real failure.
      if (!(await findBoard(payload, slug))) throw error
    }
  }
  throw new BoardError(409, 'SLUG_TAKEN', 'Choose a different title: that link is taken.')
}

/** Check new tiles against the reports the author can see. */
function checkTiles(
  tiles: readonly BoardTile[],
  existing: readonly BoardTile[],
  reports: Map<string, ReportSummary>,
): BoardTile[] {
  const kept = new Set(existing.map((t) => t.id))
  return tiles.map((tile) => {
    const report = reports.get(tile.report)
    // A tile already on the board may name a report now unpublished; keep it.
    if (!report) {
      if (kept.has(tile.id)) return tile
      throw new BoardError(400, 'NO_REPORT', `There is no published report "${tile.report}".`)
    }
    return { ...tile, parameters: tileParameters(report, tile.parameters) }
  })
}

const changed = () =>
  new BoardError(
    409,
    'BOARD_CHANGED',
    'Someone else changed this board since you opened it. Reload it, then make your change again.',
  )

export async function updateBoard(
  payload: Payload,
  user: unknown,
  slug: string,
  update: BoardUpdate,
): Promise<BoardView> {
  requireAuthor(user)
  const [doc, reports] = await Promise.all([findBoard(payload, slug), publishedFor(payload, user)])
  if (!doc) throw notFound()
  if (update.version !== undefined && update.version !== doc.updatedAt) throw changed()
  const data: { title?: string; description?: string | null; tiles?: BoardTile[] } = {}
  if (update.title !== undefined) data.title = update.title
  if (update.description !== undefined) data.description = update.description.trim() || null
  if (update.tiles !== undefined) {
    const given = checkTiles(update.tiles, storedTiles(doc).tiles, reports)
    // Tiles for reports not published now are not shown to the editor, so
    // they are kept: they come back when the report is published again.
    const ids = new Set(given.map((t) => t.id))
    const kept = storedTiles(doc).tiles.filter((t) => !reports.has(t.report) && !ids.has(t.id))
    data.tiles = [...given, ...kept]
    if (data.tiles.length > MAX_BOARD_TILES) {
      throw new BoardError(
        400,
        'TOO_MANY_TILES',
        `A board holds up to ${MAX_BOARD_TILES} reports. Remove one first.`,
      )
    }
  }
  const written = await writeIfUnchanged(payload, doc, data)
  if (!written) throw changed()
  return viewOf(written, reports, user)
}

export async function addTile(
  payload: Payload,
  user: unknown,
  slug: string,
  input: { report: string; parameters: Record<string, unknown>; show?: BoardTileShow },
): Promise<BoardView> {
  requireAuthor(user)
  const reports = await publishedFor(payload, user)
  const report = reports.get(input.report)
  if (!report) throw new BoardError(400, 'NO_REPORT', 'Only published reports go on a board.')
  const tile: BoardTile = {
    id: randomUUID().slice(0, 12),
    report: report.slug,
    parameters: tileParameters(report, input.parameters),
    show: input.show ?? 'both',
  }
  // Another change landing at the same moment: read again and retry.
  for (let attempt = 0; attempt < ADD_ATTEMPTS; attempt++) {
    const doc = await findBoard(payload, slug)
    if (!doc) throw notFound()
    const { tiles, unreadable } = storedTiles(doc)
    if (tiles.length >= MAX_BOARD_TILES) {
      throw new BoardError(
        400,
        'TOO_MANY_TILES',
        `A board holds up to ${MAX_BOARD_TILES} reports. Remove one first.`,
      )
    }
    if (unreadable > 0) {
      console.warn(`[reports] board ${slug}: dropping ${unreadable} unreadable tile(s)`)
    }
    const written = await writeIfUnchanged(payload, doc, { tiles: [...tiles, tile] })
    if (written) return viewOf(written, reports, user)
  }
  throw changed()
}

export async function deleteBoard(payload: Payload, user: unknown, slug: string): Promise<void> {
  requireAuthor(user)
  const doc = await findBoard(payload, slug)
  if (!doc) throw notFound()
  await payload.delete({ collection: 'report-boards', id: doc.id, overrideAccess: true })
}
