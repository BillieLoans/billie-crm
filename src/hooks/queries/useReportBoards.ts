'use client'

import { useQuery } from '@tanstack/react-query'
import type { BoardSummary, BoardView } from '@/server/reporting/boards'

export type { BoardSummary, BoardView }

export const BOARDS_KEY = ['reports', 'boards'] as const

/** A refused board request, with the server's message. */
export class BoardFailure extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'BoardFailure'
  }
}

/** A request to the boards API; throws BoardFailure when refused. */
export async function sendBoardRequest<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json().catch(() => null)) as
    | (T & { error?: { code?: string; message?: string } })
    | null
  if (!res.ok) {
    throw new BoardFailure(
      json?.error?.message ?? 'That did not work. Try again.',
      json?.error?.code ?? 'FAILED',
    )
  }
  return json as T
}

/** The boards the signed-in user can open. */
export function useReportBoards(enabled = true) {
  return useQuery({
    queryKey: BOARDS_KEY,
    queryFn: async () =>
      (await sendBoardRequest<{ boards: BoardSummary[] }>('/api/reports/boards', 'GET')).boards,
    enabled,
    staleTime: 60_000,
  })
}

/** One board, with the tiles the signed-in user can run. */
export function useReportBoard(slug: string, enabled = true) {
  return useQuery({
    queryKey: [...BOARDS_KEY, slug],
    queryFn: async () =>
      (
        await sendBoardRequest<{ board: BoardView }>(
          `/api/reports/boards/${encodeURIComponent(slug)}`,
          'GET',
        )
      ).board,
    enabled: enabled && slug !== '',
    retry: false,
  })
}
