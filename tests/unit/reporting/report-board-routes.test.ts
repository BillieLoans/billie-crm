/**
 * Unit tests for the board API routes: sign-in, request checks and error
 * mapping. The board logic is mocked here and covered in
 * tests/int/report-boards.int.spec.ts.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}))
const requireAuth = vi.fn()
vi.mock('@/lib/auth', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }))
const fns = vi.hoisted(() => ({
  listBoards: vi.fn(),
  createBoard: vi.fn(),
  getBoard: vi.fn(),
  updateBoard: vi.fn(),
  deleteBoard: vi.fn(),
  addTile: vi.fn(),
}))
vi.mock('@/server/reporting/boards', async () => {
  const actual = await vi.importActual<typeof import('@/server/reporting/boards')>(
    '@/server/reporting/boards',
  )
  return {
    BoardError: actual.BoardError,
    boardFailure: actual.boardFailure,
    ...Object.fromEntries(
      Object.keys(fns).map((k) => [
        k,
        (...a: unknown[]) => (fns as Record<string, (...x: unknown[]) => unknown>)[k](...a),
      ]),
    ),
  }
})

import { GET, POST } from '@/app/api/reports/boards/route'
import { GET as GET_ONE, PATCH } from '@/app/api/reports/boards/[slug]/route'
import { POST as ADD } from '@/app/api/reports/boards/[slug]/tiles/route'
import { BoardError } from '@/server/reporting/boards'

type Res = { status: number; body: Record<string, unknown> }
const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest
const params = { params: Promise.resolve({ slug: 'weekly' }) }

beforeEach(() => {
  requireAuth.mockResolvedValue({ user: { id: 'u', role: 'supervisor' }, payload: {} })
  for (const fn of Object.values(fns)) fn.mockReset().mockResolvedValue({ slug: 'weekly' })
})

describe('board routes', () => {
  test('need a signed-in staff member', async () => {
    requireAuth.mockResolvedValue({ error: { status: 401 } })
    expect(((await GET()) as unknown as Res).status).toBe(401)
    expect(fns.listBoards).not.toHaveBeenCalled()
  })

  test('check the request before calling the board logic', async () => {
    expect(((await POST(req({}))) as unknown as Res).status).toBe(400)
    expect(((await PATCH(req({ tiles: 'x' }), params)) as unknown as Res).status).toBe(400)
    expect(((await ADD(req({}), params)) as unknown as Res).status).toBe(400)
    expect(fns.createBoard).not.toHaveBeenCalled()
    expect(fns.updateBoard).not.toHaveBeenCalled()
    expect(fns.addTile).not.toHaveBeenCalled()
    expect(((await POST(req({ title: 'Weekly' }))) as unknown as Res).status).toBe(201)
    expect(((await ADD(req({ report: 'daily' }), params)) as unknown as Res).status).toBe(201)
    expect(fns.addTile.mock.calls[0][3]).toEqual({ report: 'daily', parameters: {} })
  })

  test('map refusals to their status and hide other failures', async () => {
    fns.getBoard.mockRejectedValueOnce(new BoardError(404, 'NOT_FOUND', 'No board'))
    const missing = (await GET_ONE(req(null), params)) as unknown as Res
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ error: { code: 'NOT_FOUND', message: 'No board' } })
    vi.spyOn(console, 'error').mockImplementationOnce(() => undefined)
    fns.getBoard.mockRejectedValueOnce(new Error('db detail'))
    const failed = (await GET_ONE(req(null), params)) as unknown as Res
    expect(failed.status).toBe(500)
    expect(JSON.stringify(failed.body)).not.toContain('db detail')
  })
})
